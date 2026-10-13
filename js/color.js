// 代號對應顏色。同一個代號永遠是同一種顏色。
// 自己的代號固定用琥珀色(--lamp),不在這組裡。
import { nicknameKey } from './validate.js';

export const PALETTE = ['#85CDCA', '#C3A6E0', '#F2C879', '#9BC995', '#8EB8F0', '#EF9AA8'];

// FNV-1a 雜湊
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function colorFor(nickname) {
  return PALETTE[hash(nicknameKey(nickname)) % PALETTE.length];
}
