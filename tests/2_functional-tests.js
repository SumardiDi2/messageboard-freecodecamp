const chaiHttp = require('chai-http');
const chai = require('chai');
const assert = chai.assert;
const server = require('../server');

chai.use(chaiHttp);

const board = 'fcc_test_board';
const stamp = Date.now();
const mainText = `main thread ${stamp}`;
const delText = `thread to delete ${stamp}`;
const reply1Text = `reply one ${stamp}`;
const reply2Text = `reply two ${stamp}`;

const send = agent => new Promise(resolve => agent.end((err, res) => resolve(res)));
const post = (path, data) => send(chai.request(server).post(path).type('form').redirects(0).send(data));
const del = (path, data) => send(chai.request(server).delete(path).type('form').send(data));
const put = (path, data) => send(chai.request(server).put(path).type('form').send(data));
const get = (path, query) => send(chai.request(server).get(path).query(query || {}));

suite('Functional Tests', function () {
  this.timeout(15000);

  let mainId, delId, reply1Id, reply2Id;

  test('Creating a new thread: POST request to /api/threads/{board}', async function () {
    const a = await post(`/api/threads/${board}`, { text: delText, delete_password: 'delpass' });
    assert.equal(a.status, 302);
    const b = await post(`/api/threads/${board}`, { text: mainText, delete_password: 'mainpass' });
    assert.equal(b.status, 302);
  });

  test('Viewing the 10 most recent threads with 3 replies each: GET request to /api/threads/{board}', async function () {
    const res = await get(`/api/threads/${board}`);
    assert.equal(res.status, 200);
    assert.isArray(res.body);
    assert.isAtMost(res.body.length, 10);
    res.body.forEach(t => {
      assert.isAtMost(t.replies.length, 3);
      assert.notProperty(t, 'reported');
      assert.notProperty(t, 'delete_password');
      assert.property(t, '_id');
      assert.property(t, 'text');
      assert.property(t, 'created_on');
      assert.property(t, 'bumped_on');
    });
    mainId = res.body.find(t => t.text === mainText)._id;
    delId = res.body.find(t => t.text === delText)._id;
  });

  test('Deleting a thread with the incorrect password: DELETE request to /api/threads/{board} with an invalid delete_password', async function () {
    const res = await del(`/api/threads/${board}`, { thread_id: delId, delete_password: 'wrong' });
    assert.equal(res.text, 'incorrect password');
  });

  test('Deleting a thread with the correct password: DELETE request to /api/threads/{board} with a valid delete_password', async function () {
    const res = await del(`/api/threads/${board}`, { thread_id: delId, delete_password: 'delpass' });
    assert.equal(res.text, 'success');
  });

  test('Reporting a thread: PUT request to /api/threads/{board}', async function () {
    const res = await put(`/api/threads/${board}`, { thread_id: mainId });
    assert.equal(res.text, 'reported');
  });

  test('Creating a new reply: POST request to /api/replies/{board}', async function () {
    const a = await post(`/api/replies/${board}`, { thread_id: mainId, text: reply1Text, delete_password: 'r1pass' });
    assert.equal(a.status, 302);
    const b = await post(`/api/replies/${board}`, { thread_id: mainId, text: reply2Text, delete_password: 'r2pass' });
    assert.equal(b.status, 302);
  });

  test('Viewing a single thread with all replies: GET request to /api/replies/{board}', async function () {
    const res = await get(`/api/replies/${board}`, { thread_id: mainId });
    assert.equal(res.status, 200);
    assert.equal(res.body._id, mainId);
    assert.equal(res.body.text, mainText);
    assert.notProperty(res.body, 'reported');
    assert.notProperty(res.body, 'delete_password');
    assert.isArray(res.body.replies);
    assert.lengthOf(res.body.replies, 2);
    res.body.replies.forEach(r => {
      assert.notProperty(r, 'reported');
      assert.notProperty(r, 'delete_password');
    });
    reply1Id = res.body.replies.find(r => r.text === reply1Text)._id;
    reply2Id = res.body.replies.find(r => r.text === reply2Text)._id;
  });

  test('Deleting a reply with the incorrect password: DELETE request to /api/replies/{board} with an invalid delete_password', async function () {
    const res = await del(`/api/replies/${board}`, { thread_id: mainId, reply_id: reply1Id, delete_password: 'wrong' });
    assert.equal(res.text, 'incorrect password');
  });

  test('Deleting a reply with the correct password: DELETE request to /api/replies/{board} with a valid delete_password', async function () {
    const res = await del(`/api/replies/${board}`, { thread_id: mainId, reply_id: reply1Id, delete_password: 'r1pass' });
    assert.equal(res.text, 'success');
    const check = await get(`/api/replies/${board}`, { thread_id: mainId });
    assert.equal(check.body.replies.find(r => r._id === reply1Id).text, '[deleted]');
  });

  test('Reporting a reply: PUT request to /api/replies/{board}', async function () {
    const res = await put(`/api/replies/${board}`, { thread_id: mainId, reply_id: reply2Id });
    assert.equal(res.text, 'reported');
  });
});
