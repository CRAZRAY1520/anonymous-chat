import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRateLimiter,
  isValidIncoming,
  isValidTyping,
  nicknameKey,
  validateMessage,
  validateNickname,
} from '../src/validate.js';
import { PALETTE, colorFor } from '../src/color.js';

test('代號:空白、只有空格都不行', () => {
  assert.equal(validateNickname('').reason, 'empty');
  assert.equal(validateNickname('   ').reason, 'empty');
  assert.equal(validateNickname('　').reason, 'empty'); // 全形空格
});

test('代號:前後空格會被去掉', () => {
  assert.deepEqual(validateNickname('  小明 '), { ok: true, value: '小明' });
});

test('代號:12 字可以,13 字不行', () => {
  assert.equal(validateNickname('一二三四五六七八九十甲乙').ok, true);
  assert.equal(validateNickname('一二三四五六七八九十甲乙丙').reason, 'tooLong');
});

test('代號:emoji 算一個字,中英數都可以', () => {
  assert.equal(validateNickname('😀😀😀😀😀😀😀😀😀😀😀😀').ok, true);
  assert.equal(validateNickname('😀😀😀😀😀😀😀😀😀😀😀😀😀').reason, 'tooLong');
  assert.equal(validateNickname('Amy_01 小明').ok, true);
});

test('代號:控制字元與看不見的字元不行', () => {
  assert.equal(validateNickname('小\u0000明').reason, 'badChars');
  assert.equal(validateNickname('小' + String.fromCharCode(0x200b) + '明').reason, 'badChars');
  assert.equal(validateNickname('小' + String.fromCharCode(0x202e) + '明').reason, 'badChars');
});

test('代號:判斷重複時忽略大小寫、全形半形、多餘空格', () => {
  assert.equal(nicknameKey('Amy'), nicknameKey('aMY '));
  assert.equal(nicknameKey('Ａｍｙ'), nicknameKey('amy'));
  assert.equal(nicknameKey('a   b'), nicknameKey('a b'));
  assert.notEqual(nicknameKey('小明'), nicknameKey('小華'));
});

test('訊息:空白不行,前後空白會被去掉,中間換行保留', () => {
  assert.equal(validateMessage('  \n ').reason, 'empty');
  assert.deepEqual(validateMessage('  嗨\n你好  '), { ok: true, value: '嗨\n你好' });
});

test('訊息:200 字可以,201 字不行', () => {
  assert.equal(validateMessage('字'.repeat(200)).ok, true);
  const over = validateMessage('字'.repeat(201));
  assert.equal(over.reason, 'tooLong');
  assert.equal(over.message, '超過 1 字。');
});

test('訊息:換行以外的控制字元不行', () => {
  assert.equal(validateMessage('a\u0007b').reason, 'badChars');
  assert.equal(validateMessage('a\nb').ok, true);
});

test('收到的訊息:格式不對、欄位缺漏都會被丟掉', () => {
  const good = { id: 'x1', nickname: '小華', text: '嗨', sentAt: 1 };
  assert.equal(isValidIncoming(good), true);
  assert.equal(isValidIncoming(null), false);
  assert.equal(isValidIncoming('hi'), false);
  assert.equal(isValidIncoming({ ...good, id: undefined }), false);
  assert.equal(isValidIncoming({ ...good, sentAt: 'now' }), false);
  assert.equal(isValidIncoming({ ...good, text: '字'.repeat(201) }), false);
  assert.equal(isValidIncoming({ ...good, text: '   ' }), false);
  assert.equal(isValidIncoming({ ...good, nickname: '一二三四五六七八九十甲乙丙' }), false);
  assert.equal(isValidIncoming({ ...good, nickname: ' 小華' }), false);
  assert.equal(isValidIncoming({ ...good, text: ' 嗨' }), false);
});

test('頻率限制:視窗內超過次數就擋,過了視窗又可以', () => {
  let t = 0;
  const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => t });
  assert.equal(limiter.tryPass('a'), true);
  t = 500;
  assert.equal(limiter.tryPass('a'), false);
  assert.equal(limiter.tryPass('b'), true); // 不同人分開算
  t = 1000;
  assert.equal(limiter.tryPass('a'), true);
});

test('顏色:同一個代號永遠同一個顏色,且都在色盤裡', () => {
  assert.equal(colorFor('小華'), colorFor('小華'));
  assert.equal(colorFor('Amy'), colorFor('ａｍｙ'));
  for (const n of ['小華', '阿凱', '夜貓', 'x', '😀']) assert.ok(PALETTE.includes(colorFor(n)));
});

test('收訊息的最短間隔比送出端短,才容得下網路延遲', async () => {
  const { RECEIVE_INTERVAL_MS, SEND_INTERVAL_MS } = await import('../src/validate.js');
  assert.ok(RECEIVE_INTERVAL_MS < SEND_INTERVAL_MS);
  assert.ok(RECEIVE_INTERVAL_MS >= 500); // 也不能短到失去擋洗版的作用
});

test('正在輸入通知:格式正確才接受', () => {
  assert.equal(isValidTyping({ nickname: '小華', typing: true }), true);
  assert.equal(isValidTyping({ nickname: '小華', typing: false }), true);
  assert.equal(isValidTyping(null), false);
  assert.equal(isValidTyping('typing'), false);
  assert.equal(isValidTyping({ nickname: '小華' }), false); // 缺 typing
  assert.equal(isValidTyping({ nickname: '小華', typing: 'yes' }), false); // typing 不是布林
  assert.equal(isValidTyping({ nickname: 123, typing: true }), false);
  assert.equal(isValidTyping({ nickname: ' 小華', typing: true }), false); // 代號沒有去空格
  assert.equal(isValidTyping({ nickname: '一二三四五六七八九十甲乙丙', typing: true }), false); // 超過 12 字
});
