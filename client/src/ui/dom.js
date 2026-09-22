// Tiny DOM helpers. Every dynamic string goes through textContent / text nodes — never innerHTML.

/**
 * h('div', { class: 'a b', text: 'x', onclick: fn, style: {...}, dataset: {...}, title: '…' }, ...children)
 * Children may be Nodes, strings/numbers (inserted as text nodes), arrays, null/false (skipped).
 */
export function h(tag, props, ...children) {
  const e = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = String(v);
      else if (k === 'style' && typeof v === 'object') {
        for (const sk in v) {
          if (sk.startsWith('--')) e.style.setProperty(sk, v[sk]);
          else e.style[sk] = v[sk];
        }
      }
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (typeof v === 'boolean' || typeof v === 'number') {
        if (k in e) e[k] = v;
        else e.setAttribute(k, String(v));
      } else e.setAttribute(k, String(v));
    }
  }
  append(e, children);
  return e;
}

export function append(e, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(e, c);
    else e.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

export const clear = (e) => {
  e.replaceChildren();
  return e;
};

/** Set textContent only when it changed (avoids layout churn on 10 Hz updates). */
export function setText(e, t) {
  const s = t == null ? '' : String(t);
  if (e.textContent !== s) e.textContent = s;
}

export function toggleClass(e, cls, on) {
  if (e.classList.contains(cls) !== !!on) e.classList.toggle(cls, !!on);
}

const intFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const decFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
/** Integer with French digit grouping. */
export const fmt = (n) => intFmt.format(Math.round(Number(n) || 0));
/** Up to one decimal, French comma. */
export const fmt1 = (n) => decFmt.format(Number(n) || 0);
/** Percentage from a 0..1 ratio. */
export const pct = (r) => `${decFmt.format((Number(r) || 0) * 100)} %`;

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** French plural of a (possibly multi-word) monster name: "Loup gris" → "Loups gris". */
export function plural(name, n) {
  if (n <= 1) return name;
  return name
    .split(' ')
    .map((w) => (/[sxz]$/i.test(w) ? w : w + 's'))
    .join(' ');
}

/** French typography: non-breaking spaces before : ; ! ? » and after «, so lines never break there. */
export function frTypo(s) {
  return String(s ?? '')
    .replace(/ ([:;!?»])/g, ' $1')
    .replace(/« /g, '« ');
}

/** Safe localStorage wrappers (private windows may throw). */
export function lsGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}
export function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
