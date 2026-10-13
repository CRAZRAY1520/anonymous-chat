// 階段二用的「真收發零件」:透過 Supabase Realtime 收發。
// 對外介面和 transport-mock.js 完全相同(見架構文件第 5 節):
//
//   join(nickname) → Promise<{ ok: true } | { ok: false, reason: 'taken' | 'full' | 'failed' }>
//   leave()
//   send(text)     → 送出的訊息編號(id);沒送出(還沒進入、連線中斷)就回傳 false
//   on(eventName, handler)
//   事件:onMessage、onJoin、onLeave、onRosterChange、onReconnect、onDisconnect、onKicked
//
// 只用 Realtime 的兩個功能:
//   Broadcast:傳聊天訊息(事件名稱 message,Supabase 不保存)
//   Presence :線上名單、進出提示、斷線偵測

// Supabase 官方函式庫 @supabase/supabase-js,從 jsDelivr CDN 載入,所以不需要 npm install 或打包。
// 版本固定(不要寫成 @2 或 latest,避免哪天悄悄換版本)。如果 CDN 連不上,整支程式都載入不了,
// index.html 會在輸入代號畫面顯示「程式載入失敗」的提示(見 chatLoadFailed)。
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
import { nicknameKey, validateNickname, ROOM_LIMIT } from './validate.js';

const CHANNEL_NAME = 'lobby';
const SUBSCRIBE_TIMEOUT_MS = 10000; // 連上頻道最多等多久
const SYNC_WAIT_MS = 3000; // 等線上名單同步最多等多久
const RACE_MS = 700; // 登記後再等一下,看有沒有人同一瞬間搶同一個代號

const EVENTS = ['onMessage', 'onJoin', 'onLeave', 'onRosterChange', 'onReconnect', 'onDisconnect', 'onKicked'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createTransport() {
  const id = crypto.randomUUID(); // 這個分頁在 Presence 裡的識別碼
  const handlers = Object.fromEntries(EVENTS.map((e) => [e, new Set()]));

  let client = null;
  let channel = null;
  let closing = Promise.resolve(); // 上一次離開還沒做完的話,要等它
  let me = null; // { nickname, joinedAt }
  let joined = false;
  let online = true;
  let known = new Map(); // 目前的線上名單:presence key → { nickname, joinedAt }
  let syncWaiters = [];

  function emit(name, ...args) {
    for (const fn of handlers[name]) {
      try {
        fn(...args);
      } catch (err) {
        console.error(err);
      }
    }
  }

  function on(name, fn) {
    if (!handlers[name]) throw new Error(`未知的事件:${name}`);
    handlers[name].add(fn);
    return () => handlers[name].delete(fn);
  }

  // ---------- 線上名單 ----------

  // 從 Presence 讀出目前的名單。別人登記的內容不能信任:格式不對的不顯示,
  // 但還是算進人數(它們確實佔了一個連線)。
  function readRoster(ch) {
    const state = ch.presenceState();
    const roster = new Map();
    let total = 0;
    for (const [key, metas] of Object.entries(state)) {
      total += 1;
      const meta = Array.isArray(metas) ? metas[0] : null;
      if (!meta || typeof meta.nickname !== 'string' || typeof meta.joinedAt !== 'number') continue;
      const v = validateNickname(meta.nickname);
      if (!v.ok || v.value !== meta.nickname) continue;
      roster.set(key, { nickname: meta.nickname, joinedAt: meta.joinedAt });
    }
    return { roster, total };
  }

  // 我是不是輸給了同一瞬間搶同一個代號的人?(登記時間較晚的人退出)
  function lostRace(roster) {
    const myKey = nicknameKey(me.nickname);
    for (const [key, p] of roster) {
      if (key === id || nicknameKey(p.nickname) !== myKey) continue;
      if (p.joinedAt < me.joinedAt || (p.joinedAt === me.joinedAt && key < id)) return true;
    }
    return false;
  }

  function emitRoster() {
    emit('onRosterChange', [...known.values()]);
  }

  // 名單同步事件:和上一份名單比對,推算出誰進來、誰離開
  function handleSync(ch) {
    if (ch !== channel) return;
    for (const wake of syncWaiters.splice(0)) wake();
    if (!joined) return;

    const { roster } = readRoster(ch);
    if (lostRace(roster)) {
      kick();
      return;
    }
    const before = known;
    known = roster;
    for (const [key, p] of roster) if (!before.has(key) && key !== id) emit('onJoin', p.nickname);
    for (const [key, p] of before) if (!roster.has(key) && key !== id) emit('onLeave', p.nickname);
    emitRoster();
  }

  function waitSync(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      syncWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  // ---------- 連線 ----------

  async function getClient() {
    if (client) return client;
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw new Error('js/config.js 還沒填入專案網址與公開金鑰');
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      // 這個專案沒有登入,不需要也不要把任何登入資料存進瀏覽器
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      // 心跳(定時告訴伺服器「我還連著」)放到 Web Worker 裡。背景分頁的計時器會被瀏覽器放慢,
      // 不這樣做的話,放在背景的分頁會被伺服器誤判成斷線。
      realtime: { worker: true },
    });
    return client;
  }

  function subscribe(ch) {
    return new Promise((resolve, reject) => {
      let first = true;
      ch.subscribe((status, err) => {
        if (first) {
          if (status === 'SUBSCRIBED') {
            first = false;
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            first = false;
            reject(err ?? new Error(status));
          }
          return;
        }
        onStatus(ch, status);
      }, SUBSCRIBE_TIMEOUT_MS);
    });
  }

  function closeChannel() {
    const ch = channel;
    channel = null;
    syncWaiters.splice(0).forEach((wake) => wake());
    if (ch && client) closing = client.removeChannel(ch).catch(() => {});
  }

  // 連線上的狀態變化。函式庫會自己重連,我們只負責回報、重連後重新登記。
  async function onStatus(ch, status) {
    if (ch !== channel || !joined) return;
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      if (online) {
        online = false;
        emit('onDisconnect');
      }
    } else if (status === 'SUBSCRIBED' && !online) {
      await recover(ch);
    }
  }

  // 斷線後重新連上:先看看自己的代號有沒有被別人占走,沒有才重新登記
  async function recover(ch) {
    await waitSync(SYNC_WAIT_MS);
    if (ch !== channel || !joined) return;
    const { roster } = readRoster(ch);
    const myKey = nicknameKey(me.nickname);
    const taken = [...roster].some(([key, p]) => key !== id && nicknameKey(p.nickname) === myKey);
    if (taken) {
      kick();
      return;
    }
    await ch.track({ nickname: me.nickname, joinedAt: me.joinedAt });
    if (ch !== channel || !joined) return;
    online = true;
    known = readRoster(ch).roster;
    emit('onReconnect');
    emitRoster();
  }

  // 輸掉搶代號、或重連後代號已被占走:退出並通知畫面
  function kick() {
    joined = false;
    online = true;
    me = null;
    known = new Map();
    closeChannel();
    emit('onKicked');
  }

  // ---------- 對外介面 ----------

  async function join(nickname) {
    if (joined || channel) leave();
    await closing;
    let ch = null;
    try {
      const c = await getClient();
      ch = c.channel(CHANNEL_NAME, {
        config: {
          // self: 自己送的訊息也會從伺服器回來,畫面統一從 onMessage 顯示
          broadcast: { self: true },
          presence: { key: id },
        },
      });
      channel = ch;
      ch.on('broadcast', { event: 'message' }, ({ payload }) => {
        if (ch === channel && joined) emit('onMessage', payload);
      });
      ch.on('presence', { event: 'sync' }, () => handleSync(ch));

      await subscribe(ch);
      await waitSync(SYNC_WAIT_MS);

      const { roster, total } = readRoster(ch);
      const key = nicknameKey(nickname);
      if ([...roster.values()].some((p) => nicknameKey(p.nickname) === key)) {
        closeChannel();
        return { ok: false, reason: 'taken' };
      }
      if (total >= ROOM_LIMIT) {
        closeChannel();
        return { ok: false, reason: 'full' };
      }

      me = { nickname, joinedAt: Date.now() };
      const res = await ch.track({ nickname: me.nickname, joinedAt: me.joinedAt });
      if (res !== 'ok') throw new Error(`登記失敗:${res}`);
      await sleep(RACE_MS);
      if (ch !== channel) throw new Error('連線在登記途中中斷');

      const after = readRoster(ch).roster;
      if (lostRace(after)) {
        me = null;
        closeChannel();
        return { ok: false, reason: 'taken' };
      }

      known = after;
      online = true;
      joined = true;
      emitRoster();
      return { ok: true };
    } catch (err) {
      console.error('加入聊天室失敗', err);
      me = null;
      joined = false;
      if (ch && ch === channel) closeChannel();
      return { ok: false, reason: 'failed' };
    }
  }

  function leave() {
    joined = false;
    online = true;
    me = null;
    known = new Map();
    closeChannel();
  }

  function send(text) {
    if (!joined || !online || !channel) return false;
    const payload = { id: crypto.randomUUID(), nickname: me.nickname, text, sentAt: Date.now() };
    channel.send({ type: 'broadcast', event: 'message', payload }).catch((err) => console.error('送出失敗', err));
    return payload.id;
  }

  return { join, leave, send, on };
}
