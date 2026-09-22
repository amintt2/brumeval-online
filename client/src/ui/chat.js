// Chat: scrolling log (last 100 lines, colour per channel) + input opened with Enter.
import { CHAT_MAX_LEN } from '@shared/protocol.js';
import { h, frTypo } from './dom.js';

const MAX_LINES = 100;
const NOTIFY_LABEL = { error: null, xp: null, loot: 'Butin', quest: 'Quête', level: null, gold: null, info: null };

export function createChat(parent, { handlers, onOpenChange }) {
  const log = h('div', { class: 'bv-chat-log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Discussion' });
  const input = h('input', {
    class: 'bv-chat-input', type: 'text', maxLength: CHAT_MAX_LEN, spellcheck: 'false', autocomplete: 'off',
    placeholder: 'Écrire un message…', 'aria-label': 'Message',
  });
  const chanLabel = h('span', { class: 'bv-chat-chan', text: 'Dire :' });
  const inputRow = h('div', { class: 'bv-chat-inrow' }, chanLabel, input);
  const hint = h('div', { class: 'bv-chat-hint' },
    h('kbd', { text: 'Entrée' }), ' envoyer  ', h('kbd', { text: 'Échap' }), ' annuler  ·  ',
    h('b', { text: '/w nom' }), ' chuchoter  ·  ', h('b', { text: '/r' }), ' répondre  ·  ', h('b', { text: '/who' }));
  const newMsgs = h('button', { class: 'bv-chat-new', type: 'button', text: 'Nouveaux messages ▾', onclick: () => scrollBottom(true) });
  const el = h('div', { class: 'bv-chat' }, h('div', { class: 'bv-chat-logwrap' }, log, newMsgs), hint, inputRow);
  parent.appendChild(el);

  let open = false;
  let lastWhisper = null;
  const history = [];
  let histIdx = -1;
  let draft = '';

  function atBottom() {
    return log.scrollHeight - log.scrollTop - log.clientHeight < 24;
  }
  function scrollBottom(force) {
    log.scrollTop = log.scrollHeight;
    if (force) newMsgs.classList.remove('show');
  }
  log.addEventListener('scroll', () => {
    if (atBottom()) newMsgs.classList.remove('show');
  });

  function nameSpan(name) {
    const s = h('button', { class: 'bv-chat-name', type: 'button', text: `[${name}]`, title: `Chuchoter à ${name}` });
    s.addEventListener('click', (e) => {
      e.stopPropagation();
      openInput(`/w ${name} `);
    });
    return s;
  }

  function push(line) {
    const stick = atBottom();
    log.appendChild(line);
    while (log.childNodes.length > MAX_LINES) log.removeChild(log.firstChild);
    if (stick) scrollBottom();
    else newMsgs.classList.add('show');
    el.classList.add('fresh');
    clearTimeout(push.t);
    push.t = setTimeout(() => el.classList.remove('fresh'), 8000);
  }

  function addChat(m) {
    if (!m || m.text == null) return;
    const text = String(m.text);
    const ch = m.ch || 'global';
    const line = h('div', { class: `bv-line ch-${ch}` });
    if (ch === 'global') {
      line.append(h('span', { class: 'bv-chat-tag', text: '[Général] ' }), m.from ? nameSpan(m.from) : '', m.from ? ' : ' : '', h('span', { class: 'bv-chat-text', text }));
    } else if (ch === 'whisper_in') {
      if (m.from) lastWhisper = m.from;
      line.append(m.from ? nameSpan(m.from) : '', ' chuchote : ', h('span', { class: 'bv-chat-text', text }));
    } else if (ch === 'whisper_out') {
      line.append('À ', m.to ? nameSpan(m.to) : '', ' : ', h('span', { class: 'bv-chat-text', text }));
    } else {
      line.append(h('span', { class: 'bv-chat-text', text: frTypo(text) }));
    }
    push(line);
  }

  function addNotify(text, kind) {
    const label = NOTIFY_LABEL[kind];
    const line = h('div', { class: `bv-line nt-${kind || 'info'}` },
      label ? h('span', { class: 'bv-chat-tag', text: `[${label}] ` }) : null,
      h('span', { class: 'bv-chat-text', text: frTypo(text) }));
    push(line);
  }

  // Whisper mode: typing "/w nom " (or /r) turns the prefix into the "À nom :" channel label.
  let whisperTo = null;
  function setWhisper(name) {
    whisperTo = name || null;
    chanLabel.textContent = whisperTo ? `À ${whisperTo} :` : 'Dire :';
    el.classList.toggle('whisper', !!whisperTo);
  }
  function updateChanLabel() {
    const m = /^\/(?:w|whisper|msg|m)\s+(\S+)\s(.*)$/is.exec(input.value);
    if (m) {
      setWhisper(m[1]);
      input.value = m[2];
      return;
    }
    const r = /^\/r\s(.*)$/is.exec(input.value);
    if (r && lastWhisper) {
      setWhisper(lastWhisper);
      input.value = r[1];
    }
  }

  function openInput(prefill) {
    open = true;
    el.classList.add('open');
    if (prefill != null) {
      setWhisper(null);
      input.value = prefill;
    }
    updateChanLabel();
    input.focus({ preventScroll: true });
    const len = input.value.length;
    input.setSelectionRange(len, len);
    scrollBottom(true);
    onOpenChange?.(true);
  }
  function closeInput() {
    open = false;
    input.value = '';
    histIdx = -1;
    setWhisper(null);
    el.classList.remove('open');
    if (document.activeElement === input) input.blur();
    onOpenChange?.(false);
  }
  function send() {
    let text = input.value.trim();
    if (text && whisperTo && !text.startsWith('/')) text = `/w ${whisperTo} ${text}`;
    if (text) {
      const r = /^\/r(?:\s+(.*))?$/i.exec(text);
      if (r) {
        if (!lastWhisper) {
          addNotify('Personne ne vous a chuchoté pour l\'instant.', 'error');
          closeInput();
          return;
        }
        text = `/w ${lastWhisper} ${r[1] || ''}`.trim();
      }
      text = text.slice(0, CHAT_MAX_LEN);
      if (history[history.length - 1] !== text) history.push(text);
      if (history.length > 30) history.shift();
      handlers.chat?.(text);
    }
    closeInput();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      send();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeInput();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!history.length) return;
      e.preventDefault();
      if (histIdx === -1) draft = input.value;
      if (e.key === 'ArrowUp') histIdx = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1);
      else histIdx = histIdx === -1 ? -1 : histIdx + 1;
      if (histIdx >= history.length) histIdx = -1;
      setWhisper(null);
      input.value = histIdx === -1 ? draft : history[histIdx];
      updateChanLabel();
    } else if (e.key === 'Backspace' && whisperTo && input.selectionStart === 0 && input.selectionEnd === 0) {
      // leave whisper mode, like deleting the channel prefix
      e.preventDefault();
      const name = whisperTo;
      setWhisper(null);
      input.value = `/w ${name}${input.value ? ` ${input.value}` : ''}`;
      input.setSelectionRange(3 + name.length, 3 + name.length);
    }
  });
  input.addEventListener('input', updateChanLabel);
  input.addEventListener('blur', () => {
    // clicking elsewhere closes an empty input; a draft stays open
    setTimeout(() => {
      if (open && document.activeElement !== input && !input.value.trim()) closeInput();
    }, 0);
  });
  return {
    addChat,
    addNotify,
    open: openInput,
    close: closeInput,
    get isOpen() { return open; },
    input,
  };
}
