// [skilltree] Ability tooltips with the values RESOLVED for the character (variants, passives, Inaptitude, weapon —
// shared/skills.js resolveAbility), used by the action bar, the skill book and the tree screen.
import { ABILITY_DEFS, NODES, WEAPON_NEED_TEXT, RULES } from '@shared/skills.js';
import { h, fmt2 as fmt1 } from './dom.js';
import { specOf, treeState } from '../game/skillState.js';

export const KIND_LABEL = {
  melee: 'Corps à corps',
  projectile: 'Projectile',
  aoe_self: 'Zone autour de vous',
  aoe_target: 'Zone ciblée',
  self_heal: 'Soin personnel',
  dash: 'Déplacement',
  buff: 'Renforcement',
  channel: 'Canalisation',
  summon: 'Invocation',
  trap: 'Piège',
  debuff: 'Marque',
  jump: 'Fondamental',
  guard: 'Fondamental',
  charge: 'Fondamental',
  toggle: 'Fondamental',
};
const FOND = new Set(['roulade', 'sprint', 'saut', 'garde', 'attaque_chargee']);
const pw = (v) => (Array.isArray(v) ? v.map((x) => `×${fmt1(x)}`).join(' / ') : `×${fmt1(v)}`);
const line = (cls, ...kids) => h('div', { class: `tt-line ${cls || ''}`.trim() }, ...kids);

/** Names of the allocated variants of an ability. */
export function activeVariants(self, id) {
  const t = treeState(self);
  if (!t) return [];
  const out = [];
  for (const nid of Object.keys(t.alloc || {})) {
    const n = NODES.get(nid);
    if (n && n.type === 'variant' && (n.ability === id || n.effects?.some((e) => e.mod?.startsWith(`${id}.`)))) out.push(n.name);
  }
  return out;
}

/** Main numbers of a resolved ability: [label, value] rows (French). */
export function abilityNumbers(a) {
  const rows = [];
  if (!a) return rows;
  if ((typeof a.power === 'number' && a.power > 0) || Array.isArray(a.power)) rows.push(['Puissance', pw(a.power)]);
  if (a.hits > 1) rows.push(['Coups', String(a.hits)]);
  if (a.mp > 0) rows.push(['Mana', fmt1(a.mp)]);
  if (a.st > 0) rows.push(['Endurance', fmt1(a.st)]);
  if (a.stPerS > 0) rows.push(['Endurance par seconde', fmt1(a.stPerS)]);
  if (a.cd > 0) rows.push(['Recharge', `${fmt1(a.cd)} s`]);
  if (a.range > 0) rows.push(['Portée', `${fmt1(a.range)} m`]);
  if (a.radius > 0) rows.push(['Rayon', `${fmt1(a.radius)} m`]);
  if (a.cast > 0) rows.push(['Incantation', `${fmt1(a.cast)} s`]);
  if (a.hot?.pct > 0) rows.push(['Soin', `${Math.round(a.hot.pct * 100)} % des PV en ${fmt1(a.hot.dur)} s`]);
  else if (a.heal > 0) rows.push(['Soin', `${Math.round(a.heal * 100)} % des PV`]);
  if (a.iframeMs > 0) rows.push(['Invulnérable', `${fmt1(a.iframeMs / 1000)} s`]);
  if (a.airMs > 0) rows.push(['En l\'air', `${fmt1(a.airMs / 1000)} s`]);
  if (a.mult > 1 && a.id === 'sprint') rows.push(['Vitesse', `×${fmt1(a.mult)}`]);
  if (a.poise > 0) rows.push(['Déséquilibre', fmt1(a.poise)]);
  return rows;
}

/**
 * Tooltip of an ability for the character `self` (resolved values). ctx = { key?, compare?: spec, hint? }
 * compare = values before a change (tree preview): shown as « avant → après ».
 */
export function abilityTip(self, id, ctx = {}) {
  const def = ABILITY_DEFS.get(id);
  if (!def) return null;
  const a = (self && specOf(self, id)) || def;
  const box = h('div', { class: 'tt tt-ability tt-skill' });
  const tag = def.base ? 'Attaque de base' : FOND.has(id) ? 'Fondamental' : KIND_LABEL[def.kind] || '';
  box.appendChild(h('div', { class: 'tt-head' },
    h('div', { class: 'tt-name tt-gold', text: def.name }),
    tag ? h('span', { class: 'tt-tag', text: tag }) : null));
  box.appendChild(line('tt-desc tt-ab-desc', def.desc));
  const rows = abilityNumbers(a);
  const before = ctx.compare ? new Map(abilityNumbers(ctx.compare)) : null;
  if (rows.length) {
    box.appendChild(h('div', { class: 'tt-grid' }, rows.map(([k, v]) => {
      const was = before?.get(k);
      const changed = before && was !== undefined && was !== v;
      return [h('span', { class: 'tt-k', text: k }), h('span', { class: `tt-v${changed ? ' tt-up' : ''}`, text: changed ? `${was} → ${v}` : v })];
    })));
  }
  const variants = activeVariants(self, id);
  if (variants.length) box.appendChild(line('tt-variant', `Variante : ${variants.join(', ')}`));
  if (a.inapt > 0) {
    const pen = RULES.inaptitude;
    const k = a.inapt;
    box.appendChild(line('tt-inapt', `Inaptitude : puissance ${Math.round(pen.power * k * 100)} %, coûts +${Math.round(pen.cost * k * 100)} %, recharge +${Math.round(pen.cooldown * k * 100)} %`));
  }
  if (a.usable === false) box.appendChild(line('tt-bad', `Il faut ${WEAPON_NEED_TEXT[a.need] || 'une autre arme'}.`));
  else if (a.weaponMult && a.weaponMult < 1) box.appendChild(line('tt-inapt', `Arme inadaptée : puissance ×${fmt1(a.weaponMult)}`));
  if (self && a.mp > (self.mp || 0)) box.appendChild(line('tt-bad', 'Mana insuffisant'));
  if (def.souls) box.appendChild(line('tt-souls', def.souls));
  if (ctx.hint) box.appendChild(line('tt-hint', ctx.hint));
  if (ctx.key) box.appendChild(line('tt-hint', `Raccourci : ${ctx.key}`));
  return box;
}
