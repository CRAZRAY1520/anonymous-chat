import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIMITS, handleSend } from '../supabase/functions/_shared/handle.js';
import { BLOCKED_WORDS, containsBlocked, findBlocked } from '../supabase/functions/_shared/blocklist.js';
import { REACTIONS } from '../src/validate.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// 假的依賴:計數用固定時間窗(和資料庫函式 check_rate_limit 的規則相同),轉發只是記下來
function makeDeps(opts = {}) {
  let t = 1_000_000;
  const counters = new Map();
  const sent = [];
  const deps = {
    now: () => t,
    async checkRate(key, max, windowMs) {
      if (opts.rateError) throw new Error('db down');
      const c = counters.get(key);
      if (!c || t - c.start >= windowMs) {
        counters.set(key, { start: t, count: 1 });
        return 1 <= max;
      }
      c.count += 1;
      return c.count <= max;
    },
    async broadcast(topic, event, payload) {
      if (opts.broadcastError) throw new Error('realtime down');
      sent.push({ topic, event, payload });
    },
  };
  return { deps, sent, advance: (ms) => (t += ms) };
}

const msg = (over = {}) => ({
  room: 'lobby',
  event: 'message',
  payload: { id: 'm1', nickname: '小華', text: '大家好', sentAt: 1, ...over },
});

test('檢查規則的複本和 src/validate.js 一致(改了 validate.js 要執行 npm run sync:shared)', () => {
  const src = read('../src/validate.js');
  const copy = read('../supabase/functions/_shared/rules.js');
  assert.ok(copy.endsWith(src), 'supabase/functions/_shared/rules.js 和 src/validate.js 不一致,請執行 npm run sync:shared');
});

test('正常的訊息:轉發到對的頻道,sentAt 由伺服器決定,多餘欄位被丟掉', async () => {
  const { deps, sent } = makeDeps();
  const body = msg();
  body.payload.admin = true;
  const r = await handleSend(body, { ip: '1.1.1.1' }, deps);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.id, 'm1');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].topic, 'lobby');
  assert.equal(sent[0].event, 'message');
  assert.deepEqual(sent[0].payload, { id: 'm1', nickname: '小華', text: '大家好', sentAt: 1_000_000 });
});

test('頻道名稱:閒聊和深夜轉發到 room-chat、room-night', async () => {
  const { deps, sent } = makeDeps();
  await handleSend({ ...msg(), room: 'chat' }, { ip: 'a' }, deps);
  await handleSend({ ...msg({ id: 'm2', nickname: '小明' }), room: 'night' }, { ip: 'b' }, deps);
  assert.deepEqual(
    sent.map((s) => s.topic),
    ['room-chat', 'room-night'],
  );
});

test('格式不對:不轉發,回 400', async () => {
  const bad = [
    null,
    'hello',
    [],
    {},
    { room: 'nowhere', event: 'message', payload: msg().payload },
    { room: 'lobby', event: 'hack', payload: msg().payload },
    { room: 'lobby', event: 'constructor', payload: msg().payload }, // 不能用物件原型上的名字
    { room: 'lobby', event: 'message' }, // 沒有 payload
    { room: 'lobby', event: 'message', payload: [] },
    msg({ text: '' }),
    msg({ text: '   ' }),
    msg({ text: 'x'.repeat(201) }), // 超過 200 字
    msg({ text: 5 }),
    msg({ nickname: '' }),
    msg({ nickname: '一二三四五六七八九十甲乙丙' }), // 超過 12 字
    msg({ nickname: ' 小華' }),
    msg({ text: '控制\u0000字元' }),
    msg({ id: '' }),
    msg({ id: 'x'.repeat(65) }),
    msg({ id: 7 }),
  ];
  for (const body of bad) {
    const { deps, sent } = makeDeps();
    const r = await handleSend(body, { ip: 'x' }, deps);
    assert.equal(r.status === 400, true, `應該回 400:${JSON.stringify(body)}`);
    assert.equal(sent.length, 0);
  }
});

test('200 字剛好可以,送出的是整理過(去前後空白)的內容', async () => {
  const { deps, sent } = makeDeps();
  const r = await handleSend(msg({ text: 'x'.repeat(200) }), { ip: 'x' }, deps);
  assert.equal(r.status, 200);
  assert.equal(sent[0].payload.text.length, 200);
});

test('頻率:同一個代號 0.7 秒內第二則被擋(429),過了時間窗又可以', async () => {
  const { deps, sent, advance } = makeDeps();
  assert.equal((await handleSend(msg({ id: 'a' }), { ip: 'x' }, deps)).status, 200);
  const r = await handleSend(msg({ id: 'b' }), { ip: 'x' }, deps);
  assert.equal(r.status, 429);
  assert.equal(r.body.reason, 'rateLimited');
  assert.equal(sent.length, 1);
  advance(LIMITS.message.nick.windowMs);
  assert.equal((await handleSend(msg({ id: 'c' }), { ip: 'x' }, deps)).status, 200);
  assert.equal(sent.length, 2);
});

test('頻率:不同代號、不同聊天室各算各的', async () => {
  const { deps } = makeDeps();
  assert.equal((await handleSend(msg({ id: 'a' }), { ip: '1' }, deps)).status, 200);
  assert.equal((await handleSend(msg({ id: 'b', nickname: '小明' }), { ip: '2' }, deps)).status, 200);
  assert.equal((await handleSend({ ...msg({ id: 'c' }), room: 'chat' }, { ip: '3' }, deps)).status, 200);
});

test('頻率:代號大小寫、全形半形不同也算同一個人(不能靠換寫法繞過)', async () => {
  const { deps } = makeDeps();
  assert.equal((await handleSend(msg({ id: 'a', nickname: 'Amy' }), { ip: '1' }, deps)).status, 200);
  assert.equal((await handleSend(msg({ id: 'b', nickname: 'ＡＭＹ' }), { ip: '2' }, deps)).status, 429);
  assert.equal((await handleSend(msg({ id: 'c', nickname: 'amy' }), { ip: '3' }, deps)).status, 429);
});

test('頻率:換不同代號也繞不過同一個來源位址的上限', async () => {
  const { deps, sent } = makeDeps();
  let blocked = 0;
  for (let i = 0; i < LIMITS.message.ip.max + 10; i++) {
    const r = await handleSend(msg({ id: `m${i}`, nickname: `人${i}` }), { ip: '9.9.9.9' }, deps);
    if (r.status === 429) blocked += 1;
  }
  assert.equal(sent.length, LIMITS.message.ip.max);
  assert.equal(blocked, 10);
  // 別的來源不受影響
  assert.equal((await handleSend(msg({ id: 'other', nickname: '路人' }), { ip: '8.8.8.8' }, deps)).status, 200);
});

test('字詞過濾:含禁用字詞的訊息被擋(422),不轉發', async () => {
  for (const text of ['你這個白痴', 'What the FUCK', 'f u c k', 'F.u.C.k', 'ｆｕｃｋ', '他 媽 的', 'xxshitxx']) {
    const { deps, sent } = makeDeps();
    const r = await handleSend(msg({ text }), { ip: 'x' }, deps);
    assert.equal(r.status, 422, text);
    assert.equal(r.body.reason, 'filtered');
    assert.equal(sent.length, 0);
  }
});

test('字詞過濾:代號含禁用字詞也被擋;正常內容不誤擋', async () => {
  const a = makeDeps();
  assert.equal((await handleSend(msg({ nickname: 'fuckyou' }), { ip: 'x' }, a.deps)).status, 422);
  for (const text of ['今天天氣真好', 'hello world', 'Passed the class', '我們去吃飯吧', 'shift 鍵壞了']) {
    const { deps } = makeDeps();
    assert.equal((await handleSend(msg({ text }), { ip: 'x' }, deps)).status, 200, text);
  }
});

test('字詞清單:每個字詞都能被自己認出來', () => {
  for (const w of BLOCKED_WORDS) assert.equal(containsBlocked(`前面${w}後面`), true, w);
  assert.equal(findBlocked('今天天氣真好'), null);
});

test('正在輸入、表情回應、收回:通過就轉發,多餘欄位被丟掉', async () => {
  const { deps, sent } = makeDeps();
  const ip = 'x';
  assert.equal((await handleSend({ room: 'lobby', event: 'typing', payload: { nickname: '小華', typing: true, x: 1 } }, { ip }, deps)).status, 200);
  assert.equal(
    (await handleSend({ room: 'lobby', event: 'reaction', payload: { msgId: 'm1', emoji: REACTIONS[0], nickname: '小華', on: true } }, { ip }, deps)).status,
    200,
  );
  assert.equal((await handleSend({ room: 'lobby', event: 'recall', payload: { msgId: 'm1', nickname: '小華', y: 2 } }, { ip }, deps)).status, 200);
  assert.deepEqual(sent.map((s) => s.event), ['typing', 'reaction', 'recall']);
  assert.deepEqual(sent[0].payload, { nickname: '小華', typing: true });
  assert.deepEqual(sent[2].payload, { msgId: 'm1', nickname: '小華' });
});

test('正在輸入、表情回應、收回:格式不對回 400,頻率超過回 429', async () => {
  const { deps, sent } = makeDeps();
  const ip = 'x';
  const r = (event, payload) => handleSend({ room: 'lobby', event, payload }, { ip }, deps);
  assert.equal((await r('typing', { nickname: '小華', typing: 'yes' })).status, 400);
  assert.equal((await r('reaction', { msgId: 'm1', emoji: '😡', nickname: '小華', on: true })).status, 400);
  assert.equal((await r('recall', { msgId: 7, nickname: '小華' })).status, 400);
  assert.equal(sent.length, 0);
  // typing 每秒最多 3 次
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await r('typing', { nickname: '小華', typing: true })).status);
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
});

test('檢查不了就不放行:資料庫出錯回 503,轉發出錯回 502', async () => {
  const a = makeDeps({ rateError: true });
  const r1 = await handleSend(msg(), { ip: 'x' }, a.deps);
  assert.equal(r1.status, 503);
  assert.equal(a.sent.length, 0);
  const b = makeDeps({ broadcastError: true });
  const r2 = await handleSend(msg(), { ip: 'x' }, b.deps);
  assert.equal(r2.status, 502);
});

test('被擋下的請求不會洩漏內部錯誤細節', async () => {
  const a = makeDeps({ rateError: true });
  const r = await handleSend(msg(), { ip: 'x' }, a.deps);
  assert.doesNotMatch(JSON.stringify(r.body), /db down/);
});
