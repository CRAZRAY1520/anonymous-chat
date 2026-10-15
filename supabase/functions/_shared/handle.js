// 發送訊息的核心邏輯。Edge Function(send/index.ts)只負責接網路和環境變數,
// 真正的檢查都在這裡。依賴(計數、轉發)由外面傳進來,所以可以直接用 Node 測試。
//
// 瀏覽器送來:{ room, event, payload }。event 是 message / typing / reaction / recall。
// 通過所有檢查才轉發給頻道;不通過就回傳狀態碼與原因,不轉發。

import {
  TEXT_MAX,
  isValidIncoming,
  isValidReaction,
  isValidRecall,
  isValidRoom,
  isValidTyping,
  nicknameKey,
  roomChannelName,
} from './rules.js';
import { containsBlocked } from './blocklist.js';

// 每種事件的頻率上限。nick:同一個聊天室裡同一個代號;ip:同一個來源網路位址。
// nick 的數字對應收訊端的過濾(見架構文件 9.2),ip 的數字故意放寬,
// 因為學校、公司的許多人可能共用同一個位址。
export const LIMITS = {
  message: { nick: { max: 1, windowMs: 700 }, ip: { max: 20, windowMs: 10000 } },
  typing: { nick: { max: 3, windowMs: 1000 }, ip: { max: 60, windowMs: 10000 } },
  reaction: { nick: { max: 5, windowMs: 1000 }, ip: { max: 60, windowMs: 10000 } },
  recall: { nick: { max: 3, windowMs: 1000 }, ip: { max: 30, windowMs: 10000 } },
};

export const MAX_BODY_BYTES = 2000; // 200 字加上其他欄位綽綽有餘;超過直接拒絕

const fail = (status, reason, message) => ({ status, body: { ok: false, reason, message } });

// 各事件檢查格式,並且重新組出要轉發的內容(只留需要的欄位,多餘的丟掉)
function build(event, p, now) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  switch (event) {
    case 'message': {
      const msg = { id: p.id, nickname: p.nickname, text: p.text, sentAt: now };
      return isValidIncoming(msg) ? { out: msg, nickname: msg.nickname, texts: [msg.nickname, msg.text] } : null;
    }
    case 'typing':
      return isValidTyping(p) ? { out: { nickname: p.nickname, typing: p.typing }, nickname: p.nickname, texts: [] } : null;
    case 'reaction':
      return isValidReaction(p)
        ? { out: { msgId: p.msgId, emoji: p.emoji, nickname: p.nickname, on: p.on }, nickname: p.nickname, texts: [] }
        : null;
    case 'recall':
      return isValidRecall(p) ? { out: { msgId: p.msgId, nickname: p.nickname }, nickname: p.nickname, texts: [] } : null;
    default:
      return null;
  }
}

// deps:
//   checkRate(key, max, windowMs) → Promise<boolean>   true 表示通過;出錯就丟例外
//   broadcast(topic, event, payload) → Promise<void>   轉發給頻道;失敗就丟例外
//   now() → 毫秒時間戳記
export async function handleSend(body, { ip = 'unknown' } = {}, deps) {
  const { checkRate, broadcast, now = Date.now } = deps;

  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'badRequest', '格式不正確。');
  const { room, event, payload } = body;
  if (!isValidRoom(room)) return fail(400, 'badRoom', '聊天室不存在。');
  if (typeof event !== 'string' || !Object.hasOwn(LIMITS, event)) return fail(400, 'badEvent', '不支援的事件。');

  const t = now();
  const built = build(event, payload, t);
  if (!built) {
    return fail(400, 'invalid', event === 'message' ? `訊息格式不正確(最多 ${TEXT_MAX} 字)。` : '格式不正確。');
  }

  // 頻率:先查來源位址,再查這個代號。被擋的請求不轉發。
  const limit = LIMITS[event];
  try {
    const okIp = await checkRate(`ip:${ip}:${event}`, limit.ip.max, limit.ip.windowMs);
    const okNick = okIp && (await checkRate(`nick:${room}:${nicknameKey(built.nickname)}:${event}`, limit.nick.max, limit.nick.windowMs));
    if (!okIp || !okNick) return fail(429, 'rateLimited', '送太快了,請稍後再送。');
  } catch (err) {
    console.error('頻率檢查失敗', err);
    return fail(503, 'unavailable', '伺服器暫時無法處理,請稍後再試。'); // 檢查不了就不放行
  }

  // 字詞過濾(只有訊息有文字內容;代號也一併檢查)
  if (built.texts.some((s) => containsBlocked(s))) {
    return fail(422, 'filtered', '訊息含有不允許的字詞。');
  }

  try {
    await broadcast(roomChannelName(room), event, built.out);
  } catch (err) {
    console.error('轉發失敗', err);
    return fail(502, 'unavailable', '伺服器暫時無法處理,請稍後再試。');
  }
  return { status: 200, body: { ok: true, id: event === 'message' ? built.out.id : undefined } };
}
