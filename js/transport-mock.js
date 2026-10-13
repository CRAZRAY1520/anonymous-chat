// 階段一用的「假收發零件」。不連網路,在同一個瀏覽器的不同分頁之間用
// BroadcastChannel 互傳,行為遵守架構文件第 5 節的通訊約定。
// 階段二會換成 transport-supabase.js,兩者的對外介面完全相同:
//
//   join(nickname) → Promise<{ ok: true } | { ok: false, reason: 'taken' | 'full' | 'failed' }>
//   leave()
//   send(text)     → boolean(有沒有送出)
//   on(eventName, handler) → 取消訂閱用的函式
//
//   事件:onMessage、onJoin、onLeave、onRosterChange、onReconnect、onDisconnect、onKicked

import { nicknameKey, ROOM_LIMIT } from './validate.js';

const CHANNEL_NAME = 'anon-chat-mock-lobby';
// 時間設定。瀏覽器會把「背景分頁」的計時器放慢,所以光靠對方定時報到來判斷
// 「還在不在」會誤判。做法是:對方太久沒消息時,先主動問一次(收到詢問是事件,
// 不受計時器放慢影響,背景分頁也會立刻回答),問了還是沒回應才當作離開。
const DEFAULT_TIMING = {
  heartbeat: 2000, // 每隔多久告訴大家「我還在」
  expire: 6500, // 超過這麼久完全沒消息,就當作對方離開了(模擬斷線偵測)
  sweep: 1000, // 每隔多久檢查一次有沒有人太久沒消息
};
const GATHER_MS = 400; // 進入前等多久,收集目前的線上名單(模擬等 Presence 同步)
const RACE_MS = 300; // 登記後再檢查一次有沒有人同時搶同一個代號

const EVENTS = ['onMessage', 'onJoin', 'onLeave', 'onRosterChange', 'onReconnect', 'onDisconnect', 'onKicked'];

const BOT_NAMES = ['夜貓', '小華', '阿凱'];
const BOT_LINES = [
  '還沒睡嗎',
  '剛下班,今天好累',
  '大家晚安,這裡怎麼這麼安靜',
  '因為聊完就會消失啊,所以大家都隨便講',
  '這種感覺很像深夜的公車站',
  '有人在看星星嗎',
  '明天又要早起了',
  '剛剛想到一個很蠢的笑話,但我忘了',
  '你們今天吃了什麼?',
  '窗外在下雨,很適合發呆',
  '哈哈哈哈',
  '好像有人進來了',
  '我先去泡杯茶,等我一下\n馬上回來',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => min + Math.random() * (max - min);

export function createTransport({ bots = false, crowd = 0, timing = {} } = {}) {
  const T = { ...DEFAULT_TIMING, ...timing };
  const pingAfter = T.expire * 0.65; // 這麼久沒消息就先問一聲
  const id = crypto.randomUUID();
  const handlers = Object.fromEntries(EVENTS.map((e) => [e, new Set()]));
  const peers = new Map(); // peerId → { id, nickname, joinedAt, lastSeen, fake? }

  let channel = null;
  let heartbeatTimer = null;
  let sweepTimer = null;
  let botTimers = [];
  let me = null; // 已登記的自己
  let joined = false;
  let online = true;
  let racing = false;
  let lostRace = false;

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

  function rosterList() {
    return [...peers.values()].map(({ nickname, joinedAt }) => ({ nickname, joinedAt }));
  }
  const emitRoster = () => emit('onRosterChange', rosterList());

  // ---- 跨分頁收發 ----
  function post(msg) {
    if (channel && online) channel.postMessage({ ...msg, from: id });
  }

  function announce() {
    if (me) post({ type: 'presence', peer: { id, nickname: me.nickname, joinedAt: me.joinedAt } });
  }

  function open() {
    if (channel || typeof BroadcastChannel === 'undefined') return;
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (e) => handle(e.data);
  }

  function closeChannel() {
    channel?.close();
    channel = null;
  }

  function handle(data) {
    if (!data || data.from === id || !online) return;
    switch (data.type) {
      case 'who':
        announce();
        break;
      case 'presence': {
        const p = data.peer;
        if (!p || typeof p.id !== 'string' || typeof p.nickname !== 'string') return;
        const isNew = !peers.has(p.id);
        peers.set(p.id, { id: p.id, nickname: p.nickname, joinedAt: p.joinedAt, lastSeen: Date.now() });
        if (!me) return;
        // 同一瞬間有人搶同一個代號:登記時間較晚的人退出
        if (nicknameKey(p.nickname) === nicknameKey(me.nickname)) {
          const theyWin = p.joinedAt < me.joinedAt || (p.joinedAt === me.joinedAt && p.id < id);
          if (theyWin) return loseRace();
        }
        if (isNew && joined) {
          emit('onJoin', p.nickname);
          emitRoster();
        }
        break;
      }
      case 'bye': {
        const p = peers.get(data.id);
        if (p && !p.fake) {
          peers.delete(data.id);
          if (joined) {
            emit('onLeave', p.nickname);
            emitRoster();
          }
        }
        break;
      }
      case 'chat': {
        const msg = data.message;
        if (!msg || typeof msg.nickname !== 'string') return;
        // 對方能說話就代表還在:更新「最後一次有消息」的時間。
        // 如果我們已經誤把他移出名單,就補回去,才不會丟掉他說的話。
        const known = peers.get(data.from);
        if (known) known.lastSeen = Date.now();
        else if (me) {
          peers.set(data.from, { id: data.from, nickname: msg.nickname, joinedAt: msg.sentAt, lastSeen: Date.now() });
          if (joined) emitRoster();
        }
        if (joined) emit('onMessage', msg);
        break;
      }
    }
  }

  function loseRace() {
    if (racing) {
      lostRace = true;
      return;
    }
    if (!joined) return;
    teardown();
    emit('onKicked');
  }

  // ---- 計時器 ----
  function startTimers() {
    stopTimers();
    heartbeatTimer = setInterval(announce, T.heartbeat);
    sweepTimer = setInterval(() => {
      const now = Date.now();
      let needPing = false;
      for (const [pid, p] of peers) {
        if (p.fake || pid === id) continue;
        const age = now - p.lastSeen;
        if (age >= T.expire) {
          peers.delete(pid);
          if (joined) {
            emit('onLeave', p.nickname);
            emitRoster();
          }
        } else if (age >= pingAfter) {
          needPing = true;
        }
      }
      // 問一聲「還有誰在?」,還活著的分頁(包含背景分頁)會立刻回答
      if (needPing) post({ type: 'who' });
    }, T.sweep);
  }

  function stopTimers() {
    clearInterval(heartbeatTimer);
    clearInterval(sweepTimer);
    heartbeatTimer = sweepTimer = null;
  }

  // ---- 假機器人(?bots):只存在這個分頁,用來看熱鬧的樣子 ----
  function startBots() {
    BOT_NAMES.forEach((name, i) => {
      if (nicknameKey(name) === nicknameKey(me.nickname)) return;
      const botId = `bot-${name}`;
      const timer = (fn, ms) => botTimers.push(setTimeout(fn, ms));
      const enter = () => {
        if (!joined) return;
        peers.set(botId, { id: botId, nickname: name, joinedAt: Date.now(), lastSeen: Infinity, fake: true });
        emit('onJoin', name);
        emitRoster();
      };
      const speak = () => {
        if (!joined) return;
        if (peers.has(botId)) {
          const text = BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)];
          emit('onMessage', { id: crypto.randomUUID(), nickname: name, text, sentAt: Date.now() });
        }
        timer(speak, rand(5000, 12000));
      };
      const wander = () => {
        if (!joined) return;
        if (peers.has(botId)) {
          peers.delete(botId);
          emit('onLeave', name);
          emitRoster();
          timer(() => {
            enter();
            timer(wander, rand(25000, 50000));
          }, rand(4000, 8000));
        } else {
          timer(wander, rand(25000, 50000));
        }
      };
      timer(enter, 1200 + i * 1800);
      timer(speak, 3500 + i * 2500);
      timer(wander, rand(25000, 50000));
    });
  }

  function stopBots() {
    botTimers.forEach(clearTimeout);
    botTimers = [];
    for (const pid of [...peers.keys()]) if (pid.startsWith('bot-')) peers.delete(pid);
  }

  // ---- 假人群(?crowd=N):讓聊天室看起來已經有 N 個人,用來測「已滿」 ----
  function setCrowd(n) {
    for (const pid of [...peers.keys()]) if (pid.startsWith('crowd-')) peers.delete(pid);
    for (let i = 0; i < n; i++) {
      peers.set(`crowd-${i}`, { id: `crowd-${i}`, nickname: `路人${i + 1}`, joinedAt: 0, lastSeen: Infinity, fake: true });
    }
    if (joined) emitRoster();
  }

  function dropRealPeers() {
    for (const [pid, p] of peers) if (!p.fake) peers.delete(pid);
  }

  function teardown() {
    stopTimers();
    stopBots();
    closeChannel();
    dropRealPeers();
    me = null;
    joined = false;
    racing = false;
    lostRace = false;
  }

  // ---- 對外介面 ----
  async function join(nickname) {
    if (joined) leave();
    online = true;
    open();
    post({ type: 'who' });
    await sleep(GATHER_MS);

    const key = nicknameKey(nickname);
    const others = [...peers.values()];
    if (others.some((p) => nicknameKey(p.nickname) === key)) {
      teardown();
      return { ok: false, reason: 'taken' };
    }
    if (others.length >= ROOM_LIMIT) {
      teardown();
      return { ok: false, reason: 'full' };
    }

    me = { id, nickname, joinedAt: Date.now(), lastSeen: Date.now() };
    peers.set(id, me);
    racing = true;
    lostRace = false;
    announce();
    await sleep(RACE_MS);
    racing = false;
    if (lostRace) {
      teardown();
      return { ok: false, reason: 'taken' };
    }

    joined = true;
    startTimers();
    emitRoster();
    if (bots) startBots();
    return { ok: true };
  }

  function leave() {
    if (joined) post({ type: 'bye', id });
    teardown();
  }

  function send(text) {
    if (!joined || !online) return false;
    const message = { id: crypto.randomUUID(), nickname: me.nickname, text, sentAt: Date.now() };
    post({ type: 'chat', message });
    emit('onMessage', message); // 自己送的也從 onMessage 回來,畫面統一從這裡顯示
    return true;
  }

  // 關掉分頁時趕快說再見,別人就不用等逾時
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      if (joined) post({ type: 'bye', id });
    });
  }

  setCrowd(crowd);

  // 只有假零件才有的測試開關,在瀏覽器主控台用 __mock.xxx() 呼叫
  const dev = {
    // 模擬網路中斷
    disconnect() {
      if (!joined || !online) return;
      online = false;
      stopTimers();
      closeChannel();
      emit('onDisconnect');
    },
    // 模擬網路恢復。stolen: true 表示「中斷期間代號被別人占走」
    async reconnect({ stolen = false } = {}) {
      if (!joined || online) return;
      online = true;
      dropRealPeers();
      peers.set(id, me);
      open();
      post({ type: 'who' });
      await sleep(GATHER_MS);
      if (!joined) return; // 等待期間已經被請出去了
      const key = nicknameKey(me.nickname);
      const conflict = [...peers.values()].some((p) => p.id !== id && nicknameKey(p.nickname) === key);
      if (stolen || conflict) {
        teardown();
        emit('onKicked');
        return;
      }
      announce();
      startTimers();
      emit('onReconnect');
      emitRoster();
    },
    // 模擬背景分頁:計時器被瀏覽器放慢,不再定時報到,但還能即時回應別人
    pauseHeartbeat() {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    },
    setCrowd,
  };

  return { join, leave, send, on, dev };
}
