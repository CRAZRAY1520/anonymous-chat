import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRateLimiter,
  isValidIncoming,
  isValidTyping,
  isValidReaction,
  isValidRecall,
  ROOMS,
  DEFAULT_ROOM,
  isValidRoom,
  roomName,
  roomChannelName,
  REACTIONS,
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

test('表情回應:只有三種表情,格式正確才接受', () => {
  assert.equal(REACTIONS.length, 3);
  const good = { msgId: 'm1', emoji: REACTIONS[0], nickname: '小華', on: true };
  assert.equal(isValidReaction(good), true);
  for (const emoji of REACTIONS) assert.equal(isValidReaction({ ...good, emoji }), true);
  assert.equal(isValidReaction({ ...good, on: false }), true);
  assert.equal(isValidReaction(null), false);
  assert.equal(isValidReaction({ ...good, emoji: '😡' }), false); // 不在清單內的表情
  assert.equal(isValidReaction({ ...good, emoji: '<b>' }), false);
  assert.equal(isValidReaction({ ...good, msgId: '' }), false);
  assert.equal(isValidReaction({ ...good, msgId: 'x'.repeat(65) }), false);
  assert.equal(isValidReaction({ ...good, msgId: 5 }), false);
  assert.equal(isValidReaction({ ...good, on: 'yes' }), false);
  assert.equal(isValidReaction({ ...good, nickname: ' 小華' }), false);
  assert.equal(isValidReaction({ msgId: 'm1', emoji: REACTIONS[0], nickname: '小華' }), false); // 缺 on
});

test('收回訊息:格式正確才接受', () => {
  assert.equal(isValidRecall({ msgId: 'm1', nickname: '小華' }), true);
  assert.equal(isValidRecall(null), false);
  assert.equal(isValidRecall('recall'), false);
  assert.equal(isValidRecall({ nickname: '小華' }), false);
  assert.equal(isValidRecall({ msgId: '', nickname: '小華' }), false);
  assert.equal(isValidRecall({ msgId: 'x'.repeat(65), nickname: '小華' }), false);
  assert.equal(isValidRecall({ msgId: 7, nickname: '小華' }), false);
  assert.equal(isValidRecall({ msgId: 'm1', nickname: ' 小華' }), false);
  assert.equal(isValidRecall({ msgId: 'm1', nickname: 5 }), false);
});

test('三種通知:邊界與奇怪的輸入', () => {
  const nick12 = '一二三四五六七八九十甲乙';
  const typing = (nickname) => isValidTyping({ nickname, typing: true });
  const reaction = (extra) => isValidReaction({ msgId: 'm1', emoji: REACTIONS[0], nickname: '小華', on: true, ...extra });
  const recall = (extra) => isValidRecall({ msgId: 'm1', nickname: '小華', ...extra });

  // 代號剛好 12 字可以;含控制字元、零寬字元、空字串不行
  assert.equal(typing(nick12), true);
  assert.equal(reaction({ nickname: nick12 }), true);
  assert.equal(recall({ nickname: nick12 }), true);
  for (const bad of ['小\u0000華', '小​華', '小‮華', '']) {
    assert.equal(typing(bad), false);
    assert.equal(reaction({ nickname: bad }), false);
    assert.equal(recall({ nickname: bad }), false);
  }

  // msgId 剛好 64 字可以
  assert.equal(reaction({ msgId: 'x'.repeat(64) }), true);
  assert.equal(recall({ msgId: 'x'.repeat(64) }), true);

  // 陣列、數字、布林、undefined 不是物件
  for (const bad of [[], 0, 1, true, undefined]) {
    assert.equal(isValidTyping(bad), false);
    assert.equal(isValidReaction(bad), false);
    assert.equal(isValidRecall(bad), false);
  }

  // 空物件(缺所有欄位)不行;多出來的欄位不影響結果
  assert.equal(isValidTyping({}), false);
  assert.equal(isValidReaction({}), false);
  assert.equal(isValidRecall({}), false);
  assert.equal(isValidRecall({ msgId: 'm1', nickname: '小華', extra: '<script>' }), true);

  // typing / on 只認真正的布林值,0 和 1 不行
  assert.equal(isValidTyping({ nickname: '小華', typing: 0 }), false);
  assert.equal(reaction({ on: 1 }), false);
});

test('聊天室:清單、預設、名稱與頻道名稱', () => {
  assert.deepEqual(ROOMS.map((r) => r.id), ['lobby', 'chat', 'night']);
  assert.equal(DEFAULT_ROOM, 'lobby');
  assert.equal(isValidRoom('chat'), true);
  assert.equal(isValidRoom('nope'), false);
  assert.equal(isValidRoom(undefined), false);
  assert.equal(isValidRoom('lobby; drop'), false);
  assert.equal(roomName('night'), '深夜');
  assert.equal(roomName('nope'), '大廳'); // 不認得的編號退回預設
  assert.equal(roomChannelName('lobby'), 'lobby'); // 大廳沿用原本的頻道名稱
  assert.equal(roomChannelName('chat'), 'room-chat');
  const names = ROOMS.map((r) => roomChannelName(r.id));
  assert.equal(new Set(names).size, names.length); // 每個聊天室的頻道名稱都不同
});
