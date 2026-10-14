// 代號與訊息的檢查規則。全是純函式,不碰畫面也不碰網路,可以直接用 Node 測試。

export const NICK_MAX = 12;
export const TEXT_MAX = 200;
export const SEND_INTERVAL_MS = 1000;
// 收訊息時,同一個代號兩則訊息的最短間隔。比送出端的 1 秒短,留出空間給網路延遲:
// 兩則本來隔 1 秒送出的訊息,有時會在不到 1 秒內先後到達。
export const RECEIVE_INTERVAL_MS = 700;
export const ROOM_LIMIT = 50;
export const TYPING_SEND_INTERVAL_MS = 2000; // 輸入中時,最多每隔這麼久通知一次大家
export const TYPING_EXPIRE_MS = 4000; // 收到「正在輸入」後,這麼久沒再收到更新就當作停了

// 控制字元與看不見的方向/零寬字元不能出現在代號或訊息裡。
// 零寬連字(U+200D)是組合 emoji 需要的,所以不擋。
const FORBIDDEN = { test: hasForbidden };

// 用數字碼點判斷:控制字元(0x00-0x1F、0x7F-0x9F)、零寬與方向控制字元、行/段分隔符。
function hasForbidden(s) {
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return true;
    if (c === 0x200b || c === 0x200e || c === 0x200f || c === 0xfeff || c === 0x2028 || c === 0x2029) return true;
    if ((c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) return true;
  }
  return false;
}

export function countChars(s) {
  return Array.from(s).length;
}

export function normalizeNickname(raw) {
  return String(raw ?? '').trim();
}

// 判斷「代號是否重複」用的比較值:去空格、全形轉半形、忽略大小寫。
export function nicknameKey(raw) {
  return normalizeNickname(raw).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
}

export function validateNickname(raw) {
  const value = normalizeNickname(raw);
  if (value === '') return { ok: false, reason: 'empty', message: '請輸入代號。' };
  if (countChars(value) > NICK_MAX) {
    return { ok: false, reason: 'tooLong', message: `代號最多 ${NICK_MAX} 個字。` };
  }
  if (FORBIDDEN.test(value)) {
    return { ok: false, reason: 'badChars', message: '代號含有不能使用的字元。' };
  }
  return { ok: true, value };
}

export function validateMessage(raw) {
  const value = String(raw ?? '').replace(/\r\n?/g, '\n').trim();
  if (value === '') return { ok: false, reason: 'empty', message: '訊息不能是空的。' };
  const n = countChars(value);
  if (n > TEXT_MAX) {
    return { ok: false, reason: 'tooLong', message: `超過 ${n - TEXT_MAX} 字。` };
  }
  // 訊息允許換行(Shift+Enter),換行以外的控制字元不行
  if (FORBIDDEN.test(value.replace(/\n/g, ''))) {
    return { ok: false, reason: 'badChars', message: '訊息含有不能使用的字元。' };
  }
  return { ok: true, value };
}

// 收到別人的訊息時先檢查格式,不合格的丟掉。
export function isValidIncoming(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (typeof msg.id !== 'string' || msg.id === '' || msg.id.length > 64) return false;
  if (typeof msg.nickname !== 'string' || typeof msg.text !== 'string') return false;
  if (typeof msg.sentAt !== 'number' || !Number.isFinite(msg.sentAt)) return false;
  const nick = validateNickname(msg.nickname);
  if (!nick.ok || nick.value !== msg.nickname) return false;
  const text = validateMessage(msg.text);
  if (!text.ok || text.value !== msg.text) return false;
  return true;
}

// 收到別人的「正在輸入」通知時先檢查格式。
export function isValidTyping(p) {
  if (!p || typeof p !== 'object' || typeof p.typing !== 'boolean') return false;
  if (typeof p.nickname !== 'string') return false;
  const nick = validateNickname(p.nickname);
  return nick.ok && nick.value === p.nickname;
}

// 滑動時間窗的頻率限制:windowMs 內最多通過 max 次。
export function createRateLimiter({ max = 1, windowMs = SEND_INTERVAL_MS, now = Date.now } = {}) {
  const hits = new Map();
  return {
    tryPass(key = '') {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      return true;
    },
    forget(key) {
      hits.delete(key);
    },
  };
}
