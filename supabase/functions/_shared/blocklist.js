// 字詞過濾。訊息或代號含有清單裡的字詞,伺服器就不轉發。
//
// 這份清單是示範用的小清單,放在 repo 裡,所以任何人都看得到。要增減字詞直接改這裡,
// 再重新部署函式(npx supabase functions deploy send)。
// 過濾是盡力而為:無法擋住所有變形(諧音、拆字、圖片),只是擋掉明顯的字眼。

export const BLOCKED_WORDS = [
  // 中文
  '幹你娘',
  '幹你媽',
  '操你媽',
  '操你娘',
  '他媽的',
  '你媽的',
  '去死吧',
  '死全家',
  '白痴',
  '智障',
  '婊子',
  '賤人',
  // English
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'bastard',
  'nigger',
  'faggot',
];

// 比對前先整理成統一的樣子:全形轉半形、轉小寫、拿掉空白與常見的分隔符號,
// 這樣「f u c k」「F.U.C.K」「ｆｕｃｋ」都會被認出來。
export function normalizeForFilter(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s​-‍⁠﻿.,_\-*+'"`~|\\/]+/g, '');
}

const NORMALIZED = BLOCKED_WORDS.map(normalizeForFilter);

// 回傳第一個命中的字詞;沒有命中回傳 null
export function findBlocked(text) {
  const t = normalizeForFilter(text);
  for (let i = 0; i < NORMALIZED.length; i++) if (t.includes(NORMALIZED[i])) return BLOCKED_WORDS[i];
  return null;
}

export const containsBlocked = (text) => findBlocked(text) !== null;
