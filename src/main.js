// 總指揮:決定現在顯示哪個畫面,把「畫面」和「收發零件」串起來。
// 這裡是唯一知道現在用的是哪一個收發零件的地方。
// 階段一用假零件 './transport-mock.js',階段二換成下面這行真零件,其餘程式不用改。
import { createTransport } from './transport-supabase.js';
import { createUI } from './ui.js';
import {
  RECEIVE_INTERVAL_MS,
  SEND_INTERVAL_MS,
  TYPING_EXPIRE_MS,
  createRateLimiter,
  isValidIncoming,
  isValidReaction,
  isValidTyping,
  nicknameKey,
  validateMessage,
  validateNickname,
} from './validate.js';

const TITLE = '匿名聊天室';
const STORE_KEY = 'anon-chat:nickname';
const AUTO_RETRIES = 6; // 重新整理後自動進入遇到「代號重複」時,最多再試幾次
const AUTO_RETRY_MS = 1500; // 每次重試前等多久
const RECONNECT_NOTE = '已重新連線,中斷期間的訊息看不到';
const TAKEN_AFTER_LOST = '你的代號已被使用,請重新取一個。';

// 代號記在「這個分頁自己的」sessionStorage:重新整理還在,關掉分頁就消失,
// 開多個分頁也不會互相影響。讀寫失敗(例如無痕模式)時照常運作,只是不會記住。
const store = {
  get() {
    try {
      return sessionStorage.getItem(STORE_KEY);
    } catch {
      return null;
    }
  },
  set(v) {
    try {
      sessionStorage.setItem(STORE_KEY, v);
    } catch {}
  },
  clear() {
    try {
      sessionStorage.removeItem(STORE_KEY);
    } catch {}
  },
};

// 網址加 ?bots 會有幾個假機器人自動說話;?crowd=50 會假裝已經有 50 人(測「已滿」)
const params = new URLSearchParams(location.search);
const transport = createTransport({
  bots: params.has('bots'),
  crowd: Math.max(0, Math.min(60, Number(params.get('crowd')) || 0)),
});
if (transport.dev) window.__mock = transport.dev;

const sendLimiter = createRateLimiter({ max: 1, windowMs: SEND_INTERVAL_MS });
// 收訊息時,同一個代號兩則訊息間隔不到 RECEIVE_INTERVAL_MS 的,後到的直接丟掉(架構文件 9.2)。
// 比送出端的一秒短一點,是為了容許網路延遲,避免誤丟正常的訊息。
const receiveLimiter = createRateLimiter({ max: 1, windowMs: RECEIVE_INTERVAL_MS });

// 自己送出的訊息編號。收到「代號是自己」的訊息時,只有編號在這裡的才算自己說的,
// 別人冒用我的代號送來的訊息會被丟掉。
const sentIds = new Set();
function rememberSent(id) {
  sentIds.add(id);
  if (sentIds.size > 100) sentIds.delete(sentIds.values().next().value);
}

// 正在輸入的人:代號比對值 → { name, timer }。收到「正在輸入」後 TYPING_EXPIRE_MS 沒更新就自動消失
const typingUsers = new Map();
const typingLimiter = createRateLimiter({ max: 3, windowMs: 1000 });
function renderTyping() {
  ui.setTyping([...typingUsers.values()].map((u) => u.name));
}
function setTypingUser(key, name) {
  clearTimeout(typingUsers.get(key)?.timer);
  typingUsers.set(key, { name, timer: setTimeout(() => clearTypingUser(key), TYPING_EXPIRE_MS) });
  renderTyping();
}
function clearTypingUser(key) {
  const u = typingUsers.get(key);
  if (!u) return;
  clearTimeout(u.timer);
  typingUsers.delete(key);
  renderTyping();
}
function clearAllTyping() {
  for (const u of typingUsers.values()) clearTimeout(u.timer);
  typingUsers.clear();
  renderTyping();
}

// 表情回應:訊息編號 → 表情 → 回應的人(代號比對值)。訊息不保存,所以這些也只存在這個頁面的記憶體裡
const reactions = new Map();
const pendingReactions = new Set(); // 我送出、還在等事件回來的回應(msgId|表情|加上或取消)
const reactionLimiter = createRateLimiter({ max: 5, windowMs: 1000 });
function reactionSummary(msgId) {
  const out = {};
  for (const [emoji, who] of reactions.get(msgId) ?? []) out[emoji] = { count: who.size, mine: who.has(me.key) };
  return out;
}
function applyReaction(msgId, emoji, key, on) {
  if (!ui.hasMessage(msgId)) return; // 這則訊息我沒有(進來之前的、或已被移除),忽略
  let byEmoji = reactions.get(msgId);
  if (!byEmoji) reactions.set(msgId, (byEmoji = new Map()));
  let who = byEmoji.get(emoji);
  if (!who) byEmoji.set(emoji, (who = new Set()));
  if (on) who.add(key);
  else who.delete(key);
  if (reactions.size > 300) reactions.delete(reactions.keys().next().value); // 最舊的不要了,避免一直長大
  ui.updateReactions(msgId, reactionSummary(msgId));
}

let me = null; // { nickname, key }
let inChat = false;
let online = true;
let roster = [];
let pendingNickname = '';
let unread = 0;

// ---------- 分頁標題的未讀數 ----------

function updateTitle() {
  document.title = unread > 0 ? `(${unread}) ${TITLE}` : TITLE;
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    unread = 0;
    updateTitle();
  }
});

// ---------- 畫面 ----------

const ui = createUI({
  onNickname(raw) {
    const v = validateNickname(raw);
    if (v.ok) tryJoin(v.value, 'login');
  },
  onRetry() {
    tryJoin(pendingNickname, 'retry');
  },
  onLeave() {
    transport.leave();
    store.clear();
    resetSession();
    ui.showLogin({ nickname: '' });
  },
  onSend(raw) {
    if (!online) return 'offline';
    const v = validateMessage(raw);
    if (!v.ok) return 'invalid';
    if (!sendLimiter.tryPass('me')) return 'tooFast';
    const sentId = transport.send(v.value);
    if (!sentId) return 'offline';
    rememberSent(sentId);
    return 'ok';
  },
  onTyping(isTyping) {
    if (online) transport.sendTyping(isTyping);
  },
  onReact(msgId, emoji) {
    if (!online || !inChat) return;
    const mineNow = reactions.get(msgId)?.get(emoji)?.has(me.key) ?? false;
    const on = !mineNow;
    const pending = `${msgId}|${emoji}|${on}`;
    if (pendingReactions.has(pending) || !reactionLimiter.tryPass('me')) return;
    if (transport.sendReaction(msgId, emoji, on)) pendingReactions.add(pending);
  },
});

function resetSession() {
  me = null;
  inChat = false;
  online = true;
  roster = [];
  sentIds.clear();
  reactions.clear();
  pendingReactions.clear();
  clearAllTyping();
  unread = 0;
  updateTitle();
}

function enterChat(reconnected) {
  ui.clearLog();
  ui.resetComposer();
  ui.setBanner(false);
  inChat = true;
  online = true;
  unread = 0;
  updateTitle();
  ui.showChat();
  ui.renderRoster(roster, me.key, nicknameKey);
  if (reconnected) ui.addSystem(RECONNECT_NOTE);
}

// from: 'login' 使用者按進入、'auto' 重新整理後自動回來、'retry' 在「已滿」畫面按重試
async function tryJoin(nickname, from) {
  pendingNickname = nickname;
  if (from === 'login') ui.setLoginBusy(true);
  if (from === 'auto') ui.showLogin({ nickname, busy: true });

  const attempt = async () => {
    try {
      return await transport.join(nickname);
    } catch (err) {
      console.error(err);
      return { ok: false, reason: 'failed' };
    }
  };

  let result = await attempt();
  // 重新整理後自動進入時,伺服器可能還沒清掉「這個分頁上一個連線」留下的登記,
  // 會誤以為代號被別人占走。所以先等一下再試幾次,仍然重複才當作真的被占走。
  for (let i = 0; from === 'auto' && i < AUTO_RETRIES && !result.ok && result.reason === 'taken'; i++) {
    await new Promise((r) => setTimeout(r, AUTO_RETRY_MS));
    result = await attempt();
  }

  if (result.ok) {
    me = { nickname, key: nicknameKey(nickname) };
    store.set(nickname);
    enterChat(from === 'auto');
    return;
  }
  if (result.reason === 'full') {
    ui.showFull();
    return;
  }
  store.clear();
  const message =
    result.reason === 'taken'
      ? from === 'auto'
        ? TAKEN_AFTER_LOST
        : '這個代號有人用了,請換一個。'
      : '連線失敗,請稍後再試。';
  ui.showLogin({ nickname, message });
}

// ---------- 收發零件回報的事件 ----------

transport.on('onMessage', (msg) => {
  if (!inChat || !isValidIncoming(msg)) return;
  const key = nicknameKey(msg.nickname);
  const mine = key === me.key;
  if (mine) {
    // 代號是自己的,但不是我送出的:有人冒用我的代號,丟掉
    if (!sentIds.delete(msg.id)) return;
  } else {
    // 不在線上名單裡的人說的話、或說太快的部分,直接丟掉
    if (!roster.some((p) => nicknameKey(p.nickname) === key)) return;
    if (!receiveLimiter.tryPass(key)) return;
  }
  if (!mine) clearTypingUser(key); // 他的訊息送出了,就不再顯示他正在輸入
  ui.addMessage({ id: msg.id, nickname: msg.nickname, text: msg.text, sentAt: msg.sentAt, mine });
  if (!mine && document.hidden) {
    unread += 1;
    updateTitle();
  }
});

transport.on('onTyping', (p) => {
  if (!inChat || !isValidTyping(p)) return;
  const key = nicknameKey(p.nickname);
  if (key === me.key) return; // 自己的不用顯示
  if (!roster.some((r) => nicknameKey(r.nickname) === key)) return; // 不在線上名單的人,丟掉
  if (!typingLimiter.tryPass(key)) return;
  if (p.typing) setTypingUser(key, p.nickname);
  else clearTypingUser(key);
});

transport.on('onReaction', (p) => {
  if (!inChat || !isValidReaction(p)) return;
  const key = nicknameKey(p.nickname);
  if (key === me.key) {
    // 代號是自己的,但不是我送出的:有人冒用我的代號,丟掉
    if (!pendingReactions.delete(`${p.msgId}|${p.emoji}|${p.on}`)) return;
  } else {
    if (!roster.some((r) => nicknameKey(r.nickname) === key)) return; // 不在線上名單的人,丟掉
    if (!reactionLimiter.tryPass(key)) return;
  }
  applyReaction(p.msgId, p.emoji, key, p.on);
});

transport.on('onJoin', (nickname) => {
  if (inChat && nicknameKey(nickname) !== me.key) ui.addSystem(`${nickname} 進來了`);
});

transport.on('onLeave', (nickname) => {
  clearTypingUser(nicknameKey(nickname));
  if (inChat && nicknameKey(nickname) !== me.key) ui.addSystem(`${nickname} 離開了`);
});

transport.on('onRosterChange', (list) => {
  roster = list;
  if (inChat) ui.renderRoster(roster, me.key, nicknameKey);
});

transport.on('onDisconnect', () => {
  if (!inChat) return;
  online = false;
  ui.setBanner(true);
});

transport.on('onReconnect', () => {
  if (!inChat) return;
  online = true;
  ui.setBanner(false);
  ui.addSystem(RECONNECT_NOTE);
});

// 重新連線時發現代號被別人占走了,或同時搶同一個代號輸掉了
transport.on('onKicked', () => {
  if (!inChat) return;
  const nickname = me.nickname;
  store.clear();
  resetSession();
  ui.showLogin({ nickname, message: TAKEN_AFTER_LOST });
});

// ---------- 開始 ----------

const saved = store.get();
if (saved && validateNickname(saved).ok) {
  tryJoin(saved, 'auto');
}
