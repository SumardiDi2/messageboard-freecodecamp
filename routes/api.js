'use strict';
const crypto = require('crypto');
const mongoose = require('mongoose');
const { Schema } = mongoose;

const hash = pw =>
  crypto.createHash('sha256').update(String(pw) + (process.env.PW_SALT || 'messageboard')).digest('hex');
const samePassword = (plain, hashed) =>
  crypto.timingSafeEqual(Buffer.from(hash(plain)), Buffer.from(hashed));

const replySchema = new Schema({
  text: { type: String, required: true },
  created_on: { type: Date, default: Date.now },
  delete_password: { type: String, required: true },
  reported: { type: Boolean, default: false },
});

const threadSchema = new Schema({
  board: { type: String, required: true, index: true },
  text: { type: String, required: true },
  created_on: { type: Date, default: Date.now },
  bumped_on: { type: Date, default: Date.now },
  reported: { type: Boolean, default: false },
  delete_password: { type: String, required: true },
  replies: [replySchema],
});

const Thread = mongoose.models.Thread || mongoose.model('Thread', threadSchema);

const publicReply = r => ({ _id: r._id, text: r.text, created_on: r.created_on });
const publicThread = (t, replyLimit) => {
  const replies = replyLimit ? t.replies.slice(-replyLimit) : t.replies;
  return {
    _id: t._id,
    text: t.text,
    created_on: t.created_on,
    bumped_on: t.bumped_on,
    replycount: t.replies.length,
    replies: replies.map(publicReply),
  };
};

const wrap = fn => (req, res) =>
  fn(req, res).catch(err => {
    console.error(err);
    res.status(500).type('text').send('server error');
  });

const bad = (res, msg) => res.status(400).type('text').send(msg);
const isId = id => typeof id === 'string' && mongoose.isValidObjectId(id);

module.exports = function (app) {
  app
    .route('/api/threads/:board')
    .post(wrap(async (req, res) => {
      const board = req.params.board;
      const { text, delete_password } = req.body;
      if (!text || !delete_password) return bad(res, 'missing required field(s)');
      const now = new Date();
      await Thread.create({
        board, text, created_on: now, bumped_on: now,
        reported: false, delete_password: hash(delete_password), replies: [],
      });
      res.redirect(`/b/${encodeURIComponent(board)}/`);
    }))
    .get(wrap(async (req, res) => {
      const threads = await Thread.find({ board: req.params.board })
        .sort({ bumped_on: -1 }).limit(10).lean();
      res.json(threads.map(t => publicThread(t, 3)));
    }))
    .delete(wrap(async (req, res) => {
      const { thread_id, delete_password } = req.body;
      if (!isId(thread_id) || !delete_password) return bad(res, 'missing required field(s)');
      const thread = await Thread.findOne({ _id: thread_id, board: req.params.board });
      if (!thread) return res.status(404).type('text').send('thread not found');
      if (!samePassword(delete_password, thread.delete_password)) {
        return res.type('text').send('incorrect password');
      }
      await thread.deleteOne();
      res.type('text').send('success');
    }))
    .put(wrap(async (req, res) => {
      const thread_id = req.body.thread_id || req.body.report_id;
      if (!isId(thread_id)) return bad(res, 'missing required field(s)');
      const thread = await Thread.findOneAndUpdate(
        { _id: thread_id, board: req.params.board }, { reported: true });
      if (!thread) return res.status(404).type('text').send('thread not found');
      res.type('text').send('reported');
    }));

  app
    .route('/api/replies/:board')
    .post(wrap(async (req, res) => {
      const board = req.params.board;
      const { thread_id, text, delete_password } = req.body;
      if (!isId(thread_id) || !text || !delete_password) return bad(res, 'missing required field(s)');
      const thread = await Thread.findOne({ _id: thread_id, board });
      if (!thread) return res.status(404).type('text').send('thread not found');
      const now = new Date();
      thread.replies.push({
        text, created_on: now, delete_password: hash(delete_password), reported: false,
      });
      thread.bumped_on = now;
      await thread.save();
      res.redirect(`/b/${encodeURIComponent(board)}/${thread_id}`);
    }))
    .get(wrap(async (req, res) => {
      const { thread_id } = req.query;
      if (!isId(thread_id)) return bad(res, 'missing thread_id');
      const thread = await Thread.findOne({ _id: thread_id, board: req.params.board }).lean();
      if (!thread) return res.status(404).type('text').send('thread not found');
      res.json(publicThread(thread));
    }))
    .delete(wrap(async (req, res) => {
      const { thread_id, reply_id, delete_password } = req.body;
      if (!isId(thread_id) || !isId(reply_id) || !delete_password) return bad(res, 'missing required field(s)');
      const thread = await Thread.findOne({ _id: thread_id, board: req.params.board });
      const reply = thread && thread.replies.id(reply_id);
      if (!reply) return res.status(404).type('text').send('reply not found');
      if (!samePassword(delete_password, reply.delete_password)) {
        return res.type('text').send('incorrect password');
      }
      reply.text = '[deleted]';
      await thread.save();
      res.type('text').send('success');
    }))
    .put(wrap(async (req, res) => {
      const { thread_id, reply_id } = req.body;
      if (!isId(thread_id) || !isId(reply_id)) return bad(res, 'missing required field(s)');
      const thread = await Thread.findOne({ _id: thread_id, board: req.params.board });
      const reply = thread && thread.replies.id(reply_id);
      if (!reply) return res.status(404).type('text').send('reply not found');
      reply.reported = true;
      await thread.save();
      res.type('text').send('reported');
    }));
};
