// 畫面更新:三個畫面的切換、訊息列表、線上名單、捲動、輸入區。
// 這裡只管「怎麼顯示」。要不要送出、能不能進去,是 main.js 的事。
// 所有來自別人的文字一律用 textContent 放進畫面,不會被當成 HTML 執行。

import { colorFor } from './color.js';
import {
  NICK_MAX,
  REACTIONS,
  ROOMS,
  isValidRoom,
  roomName,
  TEXT_MAX,
  TYPING_SEND_INTERVAL_MS,
  countChars,
  validateNickname,
  validateMessage,
} from './validate.js';

const MAX_ITEMS = 200; // 畫面上最多保留幾則(含系統提示),更舊的移除
const NEAR_BOTTOM_PX = 48;
const HINT_MS = 1500;

const $ = (id) => document.getElementById(id);

export function createUI({ onNickname, onRetry, onLeave, onSend, onTyping, onReact, onRecall, onSwitchRoom }) {
  const el = {
    login: $('screen-login'),
    full: $('screen-full'),
    chat: $('screen-chat'),
    form: $('login-form'),
    nick: $('nick'),
    nickCount: $('nick-count'),
    loginMsg: $('login-msg'),
    loginBtn: $('login-btn'),
    retryBtn: $('retry-btn'),
    fullBack: $('full-back'),
    room: $('room'),
    roomSwitch: $('room-switch'),
    fullMsg: $('full-msg'),
    pill: $('pill'),
    pillCaret: $('pill-caret'),
    leave: $('leave-btn'),
    banner: $('conn-banner'),
    log: $('log'),
    inner: $('log-inner'),
    empty: $('empty'),
    newMsg: $('new-msg'),
    newMsgText: $('new-msg-text'),
    backdrop: $('roster-backdrop'),
    panel: $('roster-panel'),
    panelList: $('roster-panel-list'),
    sideList: $('roster-side-list'),
    countPill: $('count-pill'),
    countPanel: $('count-panel'),
    countSide: $('count-side'),
    text: $('text'),
    send: $('send-btn'),
    hint: $('hint'),
    remain: $('remain'),
    typing: $('typing'),
  };

  // 聊天室選單(輸入代號畫面一個、聊天室頂部一個)的選項
  for (const sel of [el.room, el.roomSwitch]) {
    for (const r of ROOMS) {
      const o = document.createElement('option');
      o.value = r.id;
      o.textContent = r.name;
      sel.append(o);
    }
  }
  function setRoom(id) {
    if (isValidRoom(id)) el.room.value = el.roomSwitch.value = id;
  }

  // 觸控裝置(手機、平板)的 Enter 是換行,用按鈕送出
  const coarse = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const defaultHint = coarse ? '' : 'Enter 送出 · Shift+Enter 換行';

  let busy = false; // 正在連線,鎖住輸入
  let pending = 0; // 往上看舊訊息時累積的新訊息數
  let hintTimer = null;
  const byId = new Map(); // 訊息編號 → 畫面上的訊息元素(更新表情回應用)
  let typingActive = false; // 我正在輸入(已通知過大家)
  let lastTypingSent = 0;

  // ---------- 畫面切換 ----------

  function showScreen(name) {
    el.login.hidden = name !== 'login';
    el.full.hidden = name !== 'full';
    el.chat.hidden = name !== 'chat';
    setPanel(false);
    if (coarse) return;
    if (name === 'login') el.nick.focus();
    if (name === 'chat') el.text.focus();
  }

  // ---------- 畫面 A:輸入代號 ----------

  function refreshNickField() {
    const n = countChars(el.nick.value.trim());
    el.nickCount.textContent = `${n}/${NICK_MAX}`;
    el.nickCount.classList.toggle('over', n > NICK_MAX);
    const v = validateNickname(el.nick.value);
    // 空白時不顯示錯誤(按鈕直接是灰的),太長或有怪字元才說明原因
    const showError = !busy && !v.ok && v.reason !== 'empty';
    el.nick.setAttribute('aria-invalid', showError ? 'true' : 'false');
    if (!busy && (showError || el.loginMsg.dataset.kind === 'input')) {
      setLoginMessage(showError ? v.message : '', showError ? 'error' : '', 'input');
    }
    el.loginBtn.disabled = busy || !v.ok;
  }

  function setLoginMessage(text, kind = '', source = '') {
    el.loginMsg.textContent = text;
    el.loginMsg.className = `login-msg${kind === 'error' ? ' is-error' : ''}`;
    el.loginMsg.dataset.kind = source;
    el.loginMsg.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }

  function setLoginBusy(on) {
    busy = on;
    el.nick.disabled = on;
    el.room.disabled = on;
    el.loginBtn.replaceChildren();
    if (on) {
      el.loginBtn.append(spinner(), '連線中');
      el.loginBtn.disabled = true;
      setLoginMessage('正在連上聊天室…', '', 'system');
    } else {
      el.loginBtn.append('進入聊天室');
      if (el.loginMsg.dataset.kind === 'system') setLoginMessage('');
      refreshNickField();
    }
  }

  function spinner() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('spin');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M12 3a9 9 0 1 0 9 9');
    svg.append(path);
    return svg;
  }

  function showLogin({ nickname, room, message, busy: isBusy } = {}) {
    showScreen('login');
    if (nickname !== undefined) el.nick.value = nickname;
    if (room !== undefined) setRoom(room);
    setLoginBusy(false);
    if (message) setLoginMessage(message, 'error', 'server');
    if (isBusy) setLoginBusy(true);
  }

  function showFull(roomId) {
    showScreen('full');
    el.fullMsg.textContent = `「${roomName(roomId)}」已滿,請稍後再來,或換一個聊天室。`;
    setRetryBusy(false);
  }

  function setRetryBusy(on) {
    el.retryBtn.disabled = on;
    el.retryBtn.textContent = on ? '重試中…' : '重試';
  }

  el.nick.addEventListener('input', () => {
    if (el.loginMsg.dataset.kind === 'server') setLoginMessage('');
    refreshNickField();
  });
  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy || el.loginBtn.disabled) return;
    onNickname(el.nick.value, el.room.value);
  });
  el.retryBtn.addEventListener('click', () => {
    setRetryBusy(true);
    onRetry();
  });
  el.leave.addEventListener('click', onLeave);
  el.fullBack.addEventListener('click', () => showLogin({ nickname: el.nick.value }));
  el.roomSwitch.addEventListener('change', () => onSwitchRoom?.(el.roomSwitch.value));

  // ---------- 畫面 B:訊息列表 ----------

  const nearBottom = () => el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < NEAR_BOTTOM_PX;
  const toBottom = () => {
    el.log.scrollTop = el.log.scrollHeight;
  };

  function syncEmpty() {
    el.empty.hidden = el.inner.children.length > 0;
  }

  function hideNewMsg() {
    pending = 0;
    el.newMsg.hidden = true;
  }

  function append(node, { mine = false, countNew = false } = {}) {
    const stick = mine || nearBottom();
    node.classList.add('enter');
    el.inner.append(node);

    // 超過上限就從最舊的開始移除。如果使用者正在往上看,要補償捲動位置,畫面才不會跳
    if (el.inner.children.length > MAX_ITEMS) {
      const before = el.log.scrollHeight;
      while (el.inner.children.length > MAX_ITEMS) {
        const old = el.inner.firstElementChild;
        if (old.dataset.id) byId.delete(old.dataset.id);
        old.remove();
      }
      if (!stick) el.log.scrollTop -= before - el.log.scrollHeight;
    }
    syncEmpty();

    if (stick) {
      toBottom();
      hideNewMsg();
    } else if (countNew) {
      pending += 1;
      el.newMsgText.textContent = `有 ${pending} 則新訊息`;
      el.newMsg.hidden = false;
    }
  }

  function formatTime(ms) {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function addMessage({ id, nickname, text, sentAt, mine }) {
    const root = document.createElement('div');
    root.className = `msg ${mine ? 'mine' : 'theirs'}`;
    root.dataset.id = id;

    const head = document.createElement('div');
    head.className = 'msg-head';
    const name = document.createElement('span');
    name.className = 'msg-name';
    name.textContent = mine ? `${nickname}(你)` : nickname;
    if (!mine) name.style.color = colorFor(nickname);
    const time = document.createElement('span');
    time.className = 'msg-time';
    time.textContent = formatTime(sentAt);
    // 自己的訊息:時間在前、代號在後(靠右排列),最前面多一個「收回」按鈕
    if (mine) {
      const recall = document.createElement('button');
      recall.type = 'button';
      recall.className = 'recall';
      recall.textContent = '收回';
      recall.setAttribute('aria-label', '收回這則訊息');
      head.append(recall, time, name);
    } else {
      head.append(name, time);
    }

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;

    // 表情回應:三個按鈕,按一下加上、再按一下取消;有人回應時顯示人數
    const bar = document.createElement('div');
    bar.className = 'reactions';
    for (const emoji of REACTIONS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'react';
      b.dataset.emoji = emoji;
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', `${emoji} 回應`);
      const e = document.createElement('span');
      e.textContent = emoji;
      const n = document.createElement('span');
      n.className = 'n';
      b.append(e, n);
      bar.append(b);
    }

    root.append(head, bubble, bar);
    byId.set(id, root);
    append(root, { mine, countNew: !mine });
  }

  // summary: { 表情: { count, mine } }。更新某則訊息下面的表情回應
  function updateReactions(msgId, summary) {
    const root = byId.get(msgId);
    if (!root) return;
    for (const b of root.querySelectorAll('.react')) {
      const s = summary[b.dataset.emoji] ?? { count: 0, mine: false };
      b.querySelector('.n').textContent = s.count > 0 ? String(s.count) : '';
      b.classList.toggle('has', s.count > 0);
      b.setAttribute('aria-pressed', String(s.mine));
    }
  }

  // 訊息被收回:所有人的畫面都把內容換成「已收回」,拿掉表情回應與「收回」按鈕
  function markRecalled(msgId) {
    const root = byId.get(msgId);
    if (!root || root.classList.contains('recalled')) return;
    root.classList.add('recalled');
    root.querySelector('.bubble').textContent = '已收回';
    root.querySelector('.reactions')?.remove();
    root.querySelector('.recall')?.remove();
  }

  el.inner.addEventListener('click', (e) => {
    const root = e.target.closest?.('.msg');
    if (!root) return;
    const react = e.target.closest('.react');
    if (react) onReact?.(root.dataset.id, react.dataset.emoji);
    else if (e.target.closest('.recall')) onRecall?.(root.dataset.id);
  });

  function addSystem(text) {
    const node = document.createElement('div');
    node.className = 'sys';
    node.textContent = text;
    append(node);
  }

  function clearLog() {
    el.inner.replaceChildren();
    byId.clear();
    hideNewMsg();
    syncEmpty();
  }

  el.log.addEventListener('scroll', () => {
    if (nearBottom()) hideNewMsg();
  });
  el.newMsg.addEventListener('click', () => {
    toBottom();
    hideNewMsg();
    if (!coarse) el.text.focus();
  });

  // ---------- 線上名單 ----------

  function renderRoster(list, myKey, keyOf) {
    const sorted = [...list].sort((a, b) => {
      const am = keyOf(a.nickname) === myKey;
      const bm = keyOf(b.nickname) === myKey;
      if (am !== bm) return am ? -1 : 1;
      return a.joinedAt - b.joinedAt;
    });
    for (const ul of [el.panelList, el.sideList]) {
      ul.replaceChildren(
        ...sorted.map(({ nickname }) => {
          const mine = keyOf(nickname) === myKey;
          const color = mine ? 'var(--lamp)' : colorFor(nickname);
          const li = document.createElement('li');
          if (mine) li.className = 'me';
          const dot = document.createElement('span');
          dot.className = 'dot';
          dot.style.background = color;
          const name = document.createElement('span');
          name.className = 'name';
          name.style.color = color;
          name.textContent = nickname;
          li.append(dot, name);
          if (mine) {
            const tag = document.createElement('span');
            tag.className = 'tag';
            tag.textContent = '你';
            li.append(tag);
          }
          return li;
        }),
      );
    }
    const n = String(list.length);
    el.countPill.textContent = el.countPanel.textContent = el.countSide.textContent = n;
  }

  function setPanel(open) {
    el.panel.hidden = !open;
    el.backdrop.hidden = !open;
    el.pill.setAttribute('aria-expanded', String(open));
    el.pillCaret.textContent = open ? '▴' : '▾';
  }

  el.pill.addEventListener('click', () => setPanel(el.panel.hidden));
  el.backdrop.addEventListener('click', () => setPanel(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setPanel(false);
  });
  window.matchMedia('(min-width: 641px)').addEventListener('change', () => setPanel(false));

  function setBanner(on) {
    el.banner.hidden = !on;
  }

  // ---------- 輸入區 ----------

  function refreshComposer() {
    const ta = el.text;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
    ta.style.overflowY = ta.scrollHeight > 140 ? 'auto' : 'hidden';
    const n = countChars(ta.value.trim());
    const left = TEXT_MAX - n;
    el.remain.textContent = left >= 0 ? `還能輸入 ${left} 字` : `超過 ${-left} 字`;
    el.remain.classList.toggle('over', left < 0);
    el.send.disabled = !validateMessage(ta.value).ok;
  }

  function setHint(text, warn = false) {
    el.hint.textContent = text;
    el.hint.classList.toggle('warn', warn);
  }

  function flashHint(text) {
    setHint(text, true);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => setHint(defaultHint), HINT_MS);
  }

  function trySend() {
    if (!validateMessage(el.text.value).ok) return;
    const result = onSend(el.text.value);
    if (result === 'ok') {
      el.text.value = '';
      typingActive = false; // 訊息送出後,別人收到訊息就知道我不在輸入了
      refreshComposer();
    } else if (result === 'tooFast') {
      flashHint('送太快了,等一秒再送');
    } else if (result === 'offline') {
      flashHint('連線中斷,暫時無法送出');
    }
  }

  function resetComposer() {
    el.text.value = '';
    typingActive = false;
    setHint(defaultHint);
    refreshComposer();
  }

  // 輸入中:有內容時最多每 TYPING_SEND_INTERVAL_MS 通知一次;清空後通知一次「停了」
  function notifyTyping() {
    const has = el.text.value.trim() !== '';
    const now = Date.now();
    if (has) {
      if (!typingActive || now - lastTypingSent >= TYPING_SEND_INTERVAL_MS) {
        typingActive = true;
        lastTypingSent = now;
        onTyping?.(true);
      }
    } else if (typingActive) {
      typingActive = false;
      onTyping?.(false);
    }
  }

  // 顯示「某某 正在輸入…」。names 是目前正在輸入的人的代號
  function setTyping(names) {
    let text = '';
    if (names.length === 1) text = `${names[0]} 正在輸入…`;
    else if (names.length === 2) text = `${names[0]}、${names[1]} 正在輸入…`;
    else if (names.length > 2) text = `${names[0]}、${names[1]} 和其他 ${names.length - 2} 人正在輸入…`;
    el.typing.textContent = text;
  }

  el.text.addEventListener('input', () => {
    refreshComposer();
    notifyTyping();
  });
  el.text.addEventListener('keydown', (e) => {
    // 注音、倉頡等輸入法選字時按的 Enter 不能當成送出
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey && !coarse) {
      e.preventDefault();
      trySend();
    }
  });
  el.send.addEventListener('click', () => {
    trySend();
    if (!coarse) el.text.focus();
  });

  // 手機鍵盤彈出時,讓整個畫面高度跟著可見區域縮小,輸入框才不會被擋住
  if (window.visualViewport) {
    const fit = () => {
      document.documentElement.style.setProperty('--app-h', `${window.visualViewport.height}px`);
      window.scrollTo(0, 0);
      if (!el.chat.hidden && nearBottom()) toBottom();
    };
    window.visualViewport.addEventListener('resize', fit);
    fit();
  }

  setHint(defaultHint);
  refreshNickField();
  refreshComposer();
  syncEmpty();

  return {
    showLogin,
    showFull,
    setRoom,
    showChat: () => showScreen('chat'),
    setRetryBusy,
    setLoginBusy,
    addMessage,
    hasMessage: (id) => byId.has(id),
    updateReactions,
    markRecalled,
    addSystem,
    clearLog,
    renderRoster,
    setBanner,
    setTyping,
    resetComposer,
    getNicknameInput: () => el.nick.value,
  };
}
