// 示範「繞過網頁也擋得住」:不經過網頁,直接對 Supabase 嘗試各種繞過,印出每一項的結果。
//
//   npm run demo:bypass
//
// 需要 .env.local(或環境變數)有 VITE_SUPABASE_URL 與 VITE_SUPABASE_PUBLISHABLE_KEY。
// 只用公開金鑰,和任何一個打開網頁的人手上的東西一樣。
//
// 會在「閒聊」聊天室做測試,使用代號「bypass-demo」。這個代號不在任何人的線上名單裡,
// 所以即使有訊息通過,真人的畫面也會把它丟掉(見架構文件 9.2)。
// 結束時如果有任何一項不如預期,結束碼是 1。
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i > 0 && !line.startsWith('#') && !(line.slice(0, i).trim() in env)) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch {}
  return env;
}

const env = loadEnv();
const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!URL_ || !KEY) {
  console.error('缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_PUBLISHABLE_KEY(放在 .env.local)');
  process.exit(2);
}

const ROOM = 'chat';
const TOPIC = 'room-chat'; // 聊天室「閒聊」的頻道名稱(見 src/validate.js 的 roomChannelName)
const NICK = 'bypass-demo';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

function open(client, priv, got) {
  const ch = client.channel(TOPIC, { config: { private: priv, broadcast: { self: true } } });
  ch.on('broadcast', { event: 'message' }, ({ payload }) => got.push(payload));
  return new Promise((resolve) => {
    ch.subscribe((status) => {
      if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) resolve({ ch, status });
    }, 8000);
  });
}

const callFn = async (body, raw) => {
  const res = await fetch(`${URL_}/functions/v1/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: KEY },
    body: raw ?? JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? '通過' : '失敗'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const msg = (id, text, extra = {}) => ({ id, nickname: NICK, text, sentAt: Date.now(), ...extra });
const run = Date.now().toString(36);
const id = (n) => `demo-${run}-${n}`;

const listenerClient = mk();
const got = [];
const listener = await open(listenerClient, true, got);
check('接收端用公開金鑰連上私有頻道', listener.status === 'SUBSCRIBED', listener.status);
const seen = (mid) => got.some((m) => m.id === mid);

console.log('\n── 一、繞過網頁,直接對頻道發送 ──');
const attacker = mk();
const atk = await open(attacker, true, []);
await atk.ch.send({ type: 'broadcast', event: 'message', payload: msg(id('direct'), '直接對私有頻道發送') }).catch(() => {});
await sleep(2000);
check('直接在私有頻道發送「格式完全正確」的訊息:別人沒有收到', !seen(id('direct')));

const pubClient = mk();
const pub = await open(pubClient, false, []);
await pub.ch.send({ type: 'broadcast', event: 'message', payload: msg(id('public'), '改開公開頻道發送') }).catch(() => {});
await sleep(2000);
check('改開同名的公開頻道發送:私有頻道的人沒有收到', !seen(id('public')));

console.log('\n── 二、繞過網頁,直接呼叫發送函式 ──');
const bad = [
  ['超過 200 字', { room: ROOM, event: 'message', payload: msg(id('b1'), '字'.repeat(201)) }],
  ['空白訊息', { room: ROOM, event: 'message', payload: msg(id('b2'), '   ') }],
  ['代號超過 12 字', { room: ROOM, event: 'message', payload: msg(id('b3'), '嗨', { nickname: '一二三四五六七八九十甲乙丙' }) }],
  ['代號含控制字元', { room: ROOM, event: 'message', payload: msg(id('b4'), '嗨', { nickname: 'a\u0007b' }) }],
  ['缺少欄位', { room: ROOM, event: 'message', payload: { id: id('b5'), nickname: NICK } }],
  ['不存在的聊天室', { room: 'nowhere', event: 'message', payload: msg(id('b6'), '嗨') }],
  ['不存在的事件', { room: ROOM, event: 'admin', payload: msg(id('b7'), '嗨') }],
  ['不在清單裡的表情', { room: ROOM, event: 'reaction', payload: { msgId: 'x', emoji: '😡', nickname: NICK, on: true } }],
];
for (const [label, body] of bad) {
  const r = await callFn(body);
  check(`${label}:被拒絕(HTTP ${r.status})`, r.status >= 400 && r.status < 500, r.body?.reason);
  await sleep(150);
}
const big = await callFn(null, JSON.stringify({ room: ROOM, event: 'message', payload: msg(id('big'), 'x'), pad: 'y'.repeat(5000) }));
check(`請求內容過大:被拒絕(HTTP ${big.status})`, big.status === 413);
await sleep(700);

const word = await callFn({ room: ROOM, event: 'message', payload: msg(id('word'), '你這個白痴') });
await sleep(1500);
check(`含禁用字詞:被拒絕(HTTP ${word.status}),別人沒有收到`, word.status === 422 && !seen(id('word')), word.body?.reason);
await sleep(700);

console.log('\n── 三、頻率限制 ──');
const burst = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => callFn({ room: ROOM, event: 'message', payload: msg(id(`rl${n}`), `快速第 ${n} 則`) })));
const passed = burst.filter((r) => r.status === 200).length;
const limited = burst.filter((r) => r.status === 429).length;
await sleep(2000);
const arrived = got.filter((m) => m.text.startsWith('快速第')).length;
check('同一個代號同時連送 6 則:只有 1 則通過,其餘 429', passed === 1 && limited === 5, burst.map((r) => r.status).join(','));
check('別人實際收到的只有通過的那 1 則', arrived === 1, `收到 ${arrived} 則`);

console.log('\n── 四、對照:正常使用不受影響 ──');
await sleep(1000);
const okId = id('ok');
const ok = await callFn({ room: ROOM, event: 'message', payload: msg(okId, '這是一則正常的測試訊息') });
await sleep(2000);
check(`正常的訊息:通過(HTTP ${ok.status}),別人收得到`, ok.status === 200 && seen(okId));

await Promise.all([listenerClient, attacker, pubClient].map((c) => c.removeAllChannels()));
const pass = results.every(Boolean);
console.log(`\n${results.filter(Boolean).length}/${results.length} 項符合預期${pass ? '' : ',有項目失敗'}`);
process.exit(pass ? 0 : 1);
