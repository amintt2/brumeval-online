// Context menu (right-click) and confirmation modal.
import { h, frTypo } from './dom.js';

export function createMenus(layer) {
  // ---------------------------------------------------------------- context menu
  const menu = h('div', { class: 'bv-ctx bv-frame', role: 'menu' });
  layer.appendChild(menu);
  let menuOpen = false;

  function closeMenu() {
    if (!menuOpen) return false;
    menuOpen = false;
    menu.classList.remove('show');
    return true;
  }

  /**
   * items: [{ label, onClick, disabled?, danger?, note? }] ; title optional (coloured header).
   */
  function contextMenu(x, y, items, title, titleColor) {
    menu.replaceChildren();
    if (title) menu.appendChild(h('div', { class: 'bv-ctx-title', style: titleColor ? { color: titleColor } : null, text: title }));
    for (const it of items) {
      const b = h('button', {
        class: `bv-ctx-item${it.danger ? ' danger' : ''}`,
        role: 'menuitem',
        type: 'button',
        disabled: !!it.disabled,
        onclick: (e) => {
          e.stopPropagation();
          closeMenu();
          it.onClick?.();
        },
      }, h('span', { text: it.label }), it.note ? h('span', { class: 'bv-ctx-note', text: it.note }) : null);
      menu.appendChild(b);
    }
    menu.classList.add('show');
    menuOpen = true;
    const r = menu.getBoundingClientRect();
    const px = Math.min(x, window.innerWidth - r.width - 8);
    const py = Math.min(y, window.innerHeight - r.height - 8);
    menu.style.left = `${Math.max(8, Math.round(px))}px`;
    menu.style.top = `${Math.max(8, Math.round(py))}px`;
    const first = menu.querySelector('.bv-ctx-item:not(:disabled)');
    first?.focus({ preventScroll: true });
  }

  document.addEventListener('pointerdown', (e) => {
    if (menuOpen && !menu.contains(e.target)) closeMenu();
  }, true);
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', closeMenu);

  // ---------------------------------------------------------------- confirm modal
  const veil = h('div', { class: 'bv-modal-veil' });
  const modal = h('div', { class: 'bv-modal bv-frame', role: 'alertdialog', 'aria-modal': 'true' });
  veil.appendChild(modal);
  layer.appendChild(veil);
  let modalCb = null;

  function closeModal(result = false) {
    if (!modalCb) return false;
    const cb = modalCb;
    modalCb = null;
    veil.classList.remove('show');
    cb(result);
    return true;
  }

  /** confirm({ title, text, ok, cancel, danger }, cb(boolean)) */
  function confirm(opts, cb) {
    if (modalCb) closeModal(false);
    closeMenu();
    const okBtn = h('button', { class: `bv-btn ${opts.danger ? '' : 'gold'}`, type: 'button', text: opts.ok || 'Confirmer', onclick: () => closeModal(true) });
    const cancelBtn = h('button', { class: 'bv-btn secondary', type: 'button', text: opts.cancel || 'Annuler', onclick: () => closeModal(false) });
    modal.replaceChildren(
      h('h3', { class: 'bv-modal-title', text: opts.title || 'Confirmation' }),
      h('p', { class: 'bv-modal-text', text: frTypo(opts.text || '') }),
      h('div', { class: 'bv-modal-actions' }, cancelBtn, okBtn),
    );
    modalCb = cb;
    veil.classList.add('show');
    okBtn.focus({ preventScroll: true });
  }
  veil.addEventListener('pointerdown', (e) => {
    if (e.target === veil) closeModal(false);
  });
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const focused = document.activeElement;
      if (focused && modal.contains(focused) && focused.tagName === 'BUTTON') focused.click();
      else closeModal(true);
    }
  });

  return {
    contextMenu,
    confirm,
    closeMenu,
    closeModal: () => closeModal(false),
    /** Close the top-most transient layer (modal first). Returns true when something closed. */
    closeTop() {
      return closeModal(false) || closeMenu();
    },
    get modalOpen() { return !!modalCb; },
  };
}
