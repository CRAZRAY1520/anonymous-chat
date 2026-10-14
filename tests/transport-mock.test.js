import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTransport } from '../src/transport-mock.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function record(t) {
  const log = [];
  for (const name of ['onMessage', 'onJoin', 'onLeave', 'onRosterChange', 'onKicked', 'onDisconnect', 'onReconnect']) {
    t.on(name, (...a) => log.push([name, ...a]));
  }
  return log;
}

test('第一個人可以進入;第二個人用同代號被擋,換代號可以', async () => {
  const a = createTransport();
  const b = createTransport();
  try {
    assert.deepEqual(await a.join('小明'), { ok: true });
    assert.deepEqual(await b.join('小明'), { ok: false, reason: 'taken' });
    assert.deepEqual(await b.join('Ｘ'), { ok: true });
  } finally {
    a.leave();
    b.leave();
  }
});

test('代號重複判斷忽略大小寫與全形半形;對方離開後代號可以再用', async () => {
  const a = createTransport();
  const b = createTransport();
  try {
    await a.join('Amy');
    assert.equal((await b.join('ａＭｙ')).reason, 'taken');
    a.leave();
    await sleep(50);
    assert.equal((await b.join('Amy')).ok, true);
  } finally {
    a.leave();
    b.leave();
  }
});

test('訊息:自己和對方都收得到,後來的人看不到之前的訊息', async () => {
  const a = createTransport();
  const b = createTransport();
  const c = createTransport();
  try {
    await a.join('甲');
    await b.join('乙');
    const logA = record(a);
    const logB = record(b);
    const sentId = a.send('哈囉');
    assert.equal(typeof sentId, 'string'); // 回傳訊息編號,讓畫面辨認哪些是自己送的
    await sleep(50);
    const msgA = logA.filter((e) => e[0] === 'onMessage');
    const msgB = logB.filter((e) => e[0] === 'onMessage');
    assert.equal(msgA.length, 1); // 自己送的也從 onMessage 回來
    assert.equal(msgA[0][1].id, sentId); // 編號和 send() 回傳的相同
    assert.equal(msgB.length, 1);
    assert.equal(msgB[0][1].text, '哈囉');
    assert.equal(msgB[0][1].nickname, '甲');

    await c.join('丙');
    const logC = record(c);
    await sleep(50);
    assert.equal(logC.filter((e) => e[0] === 'onMessage').length, 0);
  } finally {
    a.leave();
    b.leave();
    c.leave();
  }
});

test('進出:有人進來、離開時,其他人收到事件和最新名單', async () => {
  const a = createTransport();
  const b = createTransport();
  try {
    await a.join('甲');
    const log = record(a);
    await b.join('乙');
    await sleep(50);
    assert.ok(log.some((e) => e[0] === 'onJoin' && e[1] === '乙'));
    const roster = log.filter((e) => e[0] === 'onRosterChange').at(-1)[1];
    assert.deepEqual(roster.map((p) => p.nickname).sort(), ['乙', '甲']);

    b.leave();
    await sleep(50);
    assert.ok(log.some((e) => e[0] === 'onLeave' && e[1] === '乙'));
  } finally {
    a.leave();
    b.leave();
  }
});

test('已滿:線上 50 人時,第 51 位被擋下', async () => {
  const t = createTransport({ crowd: 50 });
  assert.deepEqual(await t.join('新人'), { ok: false, reason: 'full' });
  t.dev.setCrowd(49);
  assert.equal((await t.join('新人')).ok, true);
  t.leave();
});

test('斷線與重連:收到事件;重連時代號被占走就被請出', async () => {
  const a = createTransport();
  const b = createTransport();
  try {
    await a.join('甲');
    const log = record(a);
    a.dev.disconnect();
    assert.equal(a.send('沒送出去'), false);
    await a.dev.reconnect();
    assert.ok(log.some((e) => e[0] === 'onDisconnect'));
    assert.ok(log.some((e) => e[0] === 'onReconnect'));

    a.dev.disconnect();
    await a.dev.reconnect({ stolen: true });
    assert.ok(log.some((e) => e[0] === 'onKicked'));
  } finally {
    a.leave();
    b.leave();
  }
});

// 瀏覽器會把背景分頁的計時器放慢。這裡用 pauseHeartbeat() 模擬:不再定時報到,但還能即時回應。
test('背景分頁(不再定時報到)不會被誤判成離開,說的話對方還看得到', async () => {
  const timing = { heartbeat: 100, expire: 800, sweep: 100 };
  const a = createTransport({ timing });
  const b = createTransport({ timing });
  try {
    await a.join('甲');
    await b.join('乙');
    const logB = record(b);
    a.dev.pauseHeartbeat();
    await sleep(2500); // 遠超過 expire,以前這時 B 會把 A 移出名單
    assert.equal(logB.some((e) => e[0] === 'onLeave'), false);
    a.send('我還在');
    await sleep(100);
    const got = logB.filter((e) => e[0] === 'onMessage');
    assert.equal(got.length, 1);
    assert.equal(got[0][1].text, '我還在');
  } finally {
    a.leave();
    b.leave();
  }
});

test('真的斷線(完全沒回應)的人,還是會在逾時後被判定離開', async () => {
  const timing = { heartbeat: 100, expire: 800, sweep: 100 };
  const a = createTransport({ timing });
  const b = createTransport({ timing });
  try {
    await a.join('甲');
    await b.join('乙');
    const logB = record(b);
    a.dev.disconnect(); // 不說再見,也不再回應
    await sleep(1800);
    assert.ok(logB.some((e) => e[0] === 'onLeave' && e[1] === '甲'));
    const roster = logB.filter((e) => e[0] === 'onRosterChange').at(-1)[1];
    assert.deepEqual(roster.map((p) => p.nickname), ['乙']);
  } finally {
    a.leave();
    b.leave();
  }
});

test('還沒進入聊天室時 send() 回傳 false', () => {
  const t = createTransport();
  assert.equal(t.send('嗨'), false);
});
