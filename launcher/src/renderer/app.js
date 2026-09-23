// Brumeval Launcher — UI logic. Talks to the main process only through window.brumeval (preload bridge).
'use strict';

(() => {
  const api = window.brumeval;
  const $ = (id) => document.getElementById(id);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const CLASSES = {
    warrior: 'Guerrier — en première ligne, il encaisse les coups et fait tournoyer sa lame au cœur de la mêlée.',
    mage: 'Mage — maître du feu et du givre, il foudroie ses ennemis à distance et soigne ses alliés.',
    ranger: 'Rôdeur — archer agile et précis, il crible ses proies de flèches avant qu\'elles ne l\'atteignent.',
  };
  const CLASS_ORDER = ['warrior', 'mage', 'ranger'];

  const state = {
    settings: null,
    defaults: null,
    playing: false,
    launching: false,
    releasesUrl: '',
    newsTimer: null,
    statusTimer: null,
  };

  // ------------------------------------------------------------------------------------ helpers

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c) node.append(c);
    return node;
  }

  let toastTimer = null;
  function toast(msg, kind = 'info') {
    const t = $('toast');
    t.textContent = msg;
    t.dataset.kind = kind;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
  }

  const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  function formatDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return DATE_FMT.format(new Date(y, m - 1, d));
  }

  function formatBytes(n) {
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} Ko`;
    return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0).replace('.', ',')} Mo`;
  }

  function hostOf(url) {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  // ------------------------------------------------------------------------------------ hero

  let heroIndex = 0;
  let heroTimer = null;
  function showClass(cls, user = false) {
    heroIndex = CLASS_ORDER.indexOf(cls);
    for (const tab of document.querySelectorAll('.class-tab')) {
      const on = tab.dataset.cls === cls;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    const order = [CLASS_ORDER[(heroIndex + 2) % 3], cls, CLASS_ORDER[(heroIndex + 1) % 3]];
    for (const img of document.querySelectorAll('.hero-char')) {
      img.dataset.slot = ['left', 'center', 'right'][order.indexOf(img.dataset.cls)];
    }
    $('class-desc').textContent = CLASSES[cls];
    if (user) restartHeroTimer();
  }
  function restartHeroTimer() {
    clearInterval(heroTimer);
    if (reducedMotion) return;
    heroTimer = setInterval(() => showClass(CLASS_ORDER[(heroIndex + 1) % 3]), 9000);
  }

  // ------------------------------------------------------------------------------------ news

  function renderNews(res) {
    const list = $('news-list');
    list.replaceChildren();
    list.setAttribute('aria-busy', 'false');
    $('news-offline').hidden = !res?.offline;
    const items = res?.items || [];
    if (!items.length) {
      list.append(el('p', { class: 'news-empty', text: 'Aucune nouvelle pour le moment.' }));
      return;
    }
    items.forEach((it, i) => {
      const body = it.body.length ? el('ul', { class: 'news-body' }, ...it.body.map((line) => el('li', { text: line }))) : null;
      const link = it.url ? el('a', { class: 'news-link', href: it.url, text: 'En savoir plus', onclick: (e) => { e.preventDefault(); api.openExternal(it.url); } }) : null;
      const details = body || link ? el('div', { class: 'news-details' }, body, link) : null;
      const head = el('div', { class: 'news-meta' },
        it.tag ? el('span', { class: 'news-tag', text: it.tag }) : null,
        it.date ? el('time', { datetime: it.date, text: formatDate(it.date) }) : null);
      const item = el('article', { class: 'news-item' + (i === 0 ? ' is-open' : '') },
        head,
        el('h3', { class: 'news-title', text: it.title }),
        it.summary ? el('p', { class: 'news-summary', text: it.summary }) : null,
        details);
      if (details) {
        const toggle = el('button', { class: 'news-more', type: 'button', text: i === 0 ? 'Réduire' : 'Lire la suite' });
        toggle.setAttribute('aria-expanded', i === 0 ? 'true' : 'false');
        toggle.addEventListener('click', () => {
          const open = item.classList.toggle('is-open');
          toggle.textContent = open ? 'Réduire' : 'Lire la suite';
          toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        item.append(toggle);
      }
      list.append(item);
    });
  }

  async function loadNews() {
    try {
      renderNews(await api.fetchNews());
    } catch {
      renderNews(null);
    }
  }

  // ------------------------------------------------------------------------------------ server status

  function renderStatus(s) {
    const box = $('status');
    let text;
    if (!s) {
      box.dataset.state = 'unknown';
      text = 'État du serveur inconnu';
    } else if (!s.online) {
      box.dataset.state = 'offline';
      text = s.message || 'Serveur hors ligne';
    } else {
      box.dataset.state = 'online';
      const parts = ['En ligne'];
      if (Number.isFinite(s.players)) {
        parts.push(`${s.players}${Number.isFinite(s.maxPlayers) ? ` / ${s.maxPlayers}` : ''} joueur${s.players > 1 ? 's' : ''}`);
      }
      if (Number.isFinite(s.ms)) parts.push(`${s.ms} ms`);
      text = parts.join(' · ');
    }
    $('status-text').textContent = text;
    const server = hostOf(state.settings?.serverUrl || '');
    $('status-server').textContent = s?.version ? `${server} · v${s.version}` : server;
    box.title = s?.message && s.online ? s.message : 'État du serveur';
  }

  async function loadStatus() {
    try {
      renderStatus(await api.fetchStatus());
    } catch {
      renderStatus(null);
    }
  }

  function refreshRemote() {
    $('status').dataset.state = 'unknown';
    $('status-text').textContent = 'Connexion au serveur…';
    loadNews();
    loadStatus();
    clearInterval(state.statusTimer);
    clearInterval(state.newsTimer);
    state.statusTimer = setInterval(loadStatus, 30000);
    state.newsTimer = setInterval(loadNews, 10 * 60000);
  }

  // ------------------------------------------------------------------------------------ updater

  function renderUpdater(u) {
    const box = $('update');
    const btn = $('update-btn');
    box.dataset.state = u?.state || 'idle';
    $('update-text').textContent = u?.state === 'downloading'
      ? `${u.message} ${Math.floor(u.percent || 0)} %`
      : u?.message || '';
    $('update-fill').style.width = `${u?.state === 'downloaded' ? 100 : Math.max(0, Math.min(100, u?.percent || 0))}%`;
    if (u?.state === 'downloaded') {
      btn.hidden = false;
      btn.textContent = 'Redémarrer pour mettre à jour';
    } else if (u?.manual && (u.state === 'available' || u.state === 'error' || u.state === 'disabled')) {
      btn.hidden = false;
      btn.textContent = 'Télécharger';
    } else {
      btn.hidden = true;
    }
  }

  // ------------------------------------------------------------------------------------ play

  function renderPlaying() {
    document.body.classList.toggle('is-playing', state.playing);
    const btn = $('play');
    btn.disabled = state.launching;
    $('play-label').textContent = state.launching ? 'Lancement…' : state.playing ? 'En jeu' : 'Jouer';
    btn.title = state.playing ? 'Afficher la fenêtre du jeu' : 'Lancer Brumeval Online';
  }

  async function play() {
    if (state.launching) return;
    state.launching = true;
    renderPlaying();
    try {
      const r = await api.play();
      if (!r?.ok) toast('Impossible de lancer le jeu.', 'error');
      else state.playing = true;
    } catch {
      toast('Impossible de lancer le jeu.', 'error');
    } finally {
      state.launching = false;
      renderPlaying();
    }
  }

  // ------------------------------------------------------------------------------------ options

  let lastFocus = null;
  function openOptions() {
    const s = state.settings;
    $('opt-url').value = s.serverUrl;
    $('opt-fullscreen').checked = s.fullscreen;
    $('opt-close').checked = s.closeOnPlay;
    $('opt-url-error').textContent = '';
    $('opt-cache-result').textContent = 'Modèles, textures et scripts téléchargés par le jeu.';
    lastFocus = document.activeElement;
    $('options').hidden = false;
    $('opt-url').focus();
  }
  function closeOptions() {
    $('options').hidden = true;
    lastFocus?.focus?.();
  }

  async function saveOptions(e) {
    e.preventDefault();
    const prevUrl = state.settings.serverUrl;
    const r = await api.saveSettings({
      serverUrl: $('opt-url').value,
      fullscreen: $('opt-fullscreen').checked,
      closeOnPlay: $('opt-close').checked,
    });
    if (!r?.ok) {
      $('opt-url-error').textContent = r?.error || 'Réglages invalides.';
      $('opt-url').focus();
      return;
    }
    state.settings = r.settings;
    closeOptions();
    if (r.settings.serverUrl !== prevUrl) {
      toast(state.playing ? 'Serveur enregistré : il sera utilisé à la prochaine partie.' : 'Serveur enregistré.');
      refreshRemote();
    } else {
      toast('Options enregistrées.');
    }
  }

  async function clearCache() {
    const btn = $('opt-cache');
    const out = $('opt-cache-result');
    btn.disabled = true;
    out.textContent = 'Vidage en cours…';
    try {
      const r = await api.clearGameCache();
      if (!r?.ok) throw new Error();
      const size = formatBytes(r.freedBytes);
      out.textContent = `Cache vidé${size ? ` (${size} libérés)` : ''}.${r.playing ? ' Rechargez le jeu (F5) pour en profiter.' : ''}`;
    } catch {
      out.textContent = 'Le cache n\'a pas pu être vidé.';
    } finally {
      btn.disabled = false;
    }
  }

  // ------------------------------------------------------------------------------------ init

  async function init() {
    for (const tab of document.querySelectorAll('.class-tab')) tab.addEventListener('click', () => showClass(tab.dataset.cls, true));
    showClass('warrior');
    restartHeroTimer();

    $('play').addEventListener('click', play);
    $('options-btn').addEventListener('click', openOptions);
    $('options-form').addEventListener('submit', saveOptions);
    for (const c of document.querySelectorAll('[data-close]')) c.addEventListener('click', closeOptions);
    $('opt-url-reset').addEventListener('click', () => {
      $('opt-url').value = state.defaults.serverUrl;
      $('opt-url-error').textContent = '';
    });
    $('opt-cache').addEventListener('click', clearCache);
    $('about-releases').addEventListener('click', (e) => { e.preventDefault(); api.openExternal(state.releasesUrl); });
    $('about-site').addEventListener('click', (e) => { e.preventDefault(); api.openExternal(state.settings.serverUrl + '/'); });
    $('update-btn').addEventListener('click', () => api.installUpdate());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('options').hidden) closeOptions();
      else if (e.key === 'Enter' && $('options').hidden && document.activeElement === document.body) play();
    });
    // Any other link in the UI opens in the system browser (the main process also enforces it).
    document.addEventListener('click', (e) => {
      const a = e.target.closest?.('a[href^="http"]');
      if (a && !e.defaultPrevented) {
        e.preventDefault();
        api.openExternal(a.href);
      }
    });

    api.onUpdater(renderUpdater);
    api.onPlaying((playing) => {
      state.playing = !!playing;
      renderPlaying();
    });

    const s = await api.getState();
    state.settings = s.settings;
    state.defaults = s.defaults;
    state.playing = s.playing;
    state.releasesUrl = s.releasesUrl;
    document.body.classList.add(s.platform === 'darwin' ? 'platform-mac' : 'platform-other');
    $('about-version').textContent = `Launcher v${s.version}`;
    renderUpdater(s.updater);
    renderPlaying();
    refreshRemote();
  }

  init().catch((err) => {
    console.error(err);
    toast('Le launcher n\'a pas pu démarrer correctement.', 'error');
  });
})();
