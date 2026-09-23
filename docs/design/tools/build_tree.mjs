// Merge the four tree drafts (docs/design/drafts/tree_*.json) into ONE shared tree: docs/design/skilltree.json.
// Run: node docs/design/tools/build_tree.mjs
// What it does (lead-designer decisions, see ARBRE_COMPETENCES.md §11 "Décisions de synthèse"):
//  - one frame (x right, y UP; the ranger draft was in screen y-down -> flipped)
//  - canonical ids (class start nodes, per-region prefixes), undirected links, bridge/hub junctions
//  - canonical abilities (home, mp, st, seconds, weapon requirement tags, tags without accents)
//  - canonical effects (fractions everywhere, one stat vocabulary, "<ability>.<field>" mods)
//  - costs per class, exclusive groups, keystones, statuses, rules, migration presets
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLASS_START, nodeCost, cheapestPath } from './lib/treelib.mjs';
import { describeStat } from './lib/vocab.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESIGN = path.resolve(HERE, '..');
const DRAFTS = path.join(DESIGN, 'drafts');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DRAFTS, f), 'utf8'));

const S = read('tree_survie.json');
const W = read('tree_warrior.json');
const M = read('tree_mage.json');
const R = read('tree_ranger.json');

const warnings = [];

// ------------------------------------------------------------------ id renames
const ABILITY_RENAME = { 'survie:riposte': 'riposte_parfaite', 'ranger:estocade': 'coup_epieu' };
function renameNode(draft, id) {
  if (draft === 'warrior') {
    if (id === 'g_depart') return 'guerrier_depart';
    if (id.startsWith('g_')) return 'gu_' + id.slice(2);
    if (id.startsWith('gd_')) return 'gu_ga_' + id.slice(3); // Gardien
    if (id.startsWith('bk_')) return 'gu_be_' + id.slice(3); // Berserker
    if (id.startsWith('ma_')) return 'gu_md_' + id.slice(3); // Maître d'armes
    if (id.startsWith('pg_')) return 'gm_' + id.slice(3); // passerelle Lame spirituelle
  }
  if (draft === 'ranger') {
    if (id === 'rodeur_origine') return 'rodeur_depart';
    if (id.startsWith('tir_')) return 'ro_' + id; // Tir variants near the start
    if (id.startsWith('t_')) return 'ro_ti_' + id.slice(2); // Tireur
    if (id.startsWith('q_')) return 'ro_tq_' + id.slice(2); // Traqueur
    if (id.startsWith('v_')) return 'ro_ve_' + id.slice(2); // Venin
    if (id.startsWith('c_')) return 'rg_' + id.slice(2); // passerelle Chasseur
  }
  return id;
}
const renameAbility = (draft, id) => ABILITY_RENAME[`${draft}:${id}`] || id;

// ------------------------------------------------------------------ vocab helpers
const TAG_FIX = { 'mêlée': 'melee', 'mobilité': 'mobilite', 'contrôle': 'controle', 'piège': 'piege', lourd: 'lourd' };
const fixTag = (t) => TAG_FIX[t] || t;
const HOME = { warrior: 'warrior', hybrid_gm: ['warrior', 'mage'], mage: 'mage', rodeur: 'ranger', pont_rg: ['ranger', 'warrior'] };
const WEAPON = {
  arme_melee: 'melee', melee: 'melee', any: null, null: null, undefined: null,
  arc: 'arc', focus: 'focus', focus_ou_arc: 'focus_ou_arc', dague: 'dague',
  "arme de l'attaque de base": 'base',
};
const FAMILY = {
  courte: 'epee_courte', longue: 'epee_longue', batarde: 'epee_batarde', rapiere: 'rapiere', cimeterre: 'cimeterre',
  lame_courbe: 'lame_courbe', espadon: 'espadon', runique: 'epee_runique',
};

function normAbility(a, draft) {
  const o = { ...a };
  o.id = renameAbility(draft, a.id);
  // home
  if (draft === 'survie') o.home = null;
  else if (draft === 'warrior') o.home = HOME[a.cls];
  else if (draft === 'ranger') o.home = HOME[a.classOrigin];
  else o.home = a.home;
  delete o.cls;
  delete o.classOrigin;
  // costs
  if (draft === 'ranger') {
    o.mp = a.mana ?? 0;
    o.st = a.stamina ?? 0;
    delete o.mana;
    delete o.stamina;
    for (const k of ['windup', 'delayMs', 'channelMs', 'dashMs', 'armMs']) {
      if (typeof o[k] === 'number' && k !== 'windup') {
        o[k.replace('Ms', '')] = +(o[k] / 1000).toFixed(3);
        delete o[k];
      }
    }
    if (typeof o.windup === 'number' && o.windup > 5) o.windup = +(o.windup / 1000).toFixed(3);
    if (Array.isArray(o.power)) {
      o.powerSeq = o.power;
      o.power = +(o.power.reduce((s, x) => s + x, 0) / o.power.length).toFixed(3);
    }
    delete o.branch;
  }
  o.mp = o.mp ?? 0;
  o.st = o.st ?? 0;
  // weapon requirement
  const w = WEAPON[String(a.weapon)];
  if (w === undefined) warnings.push(`arme inconnue ${a.weapon} pour ${o.id}`);
  o.weapon = w ?? null;
  if (o.weapon === 'focus_ou_arc') o.weapon = 'focus_ou_arc';
  // tags
  o.tags = [...new Set((a.tags || []).map(fixTag))];
  if (o.weapon === 'melee' && !o.tags.includes('melee')) o.tags.push('melee');
  if (o.weapon === 'focus' && !o.tags.includes('sort')) o.tags.push('sort');
  // universal charged attack: class base attacks keep only their specific extras
  if (o.charged) {
    const c = o.charged;
    o.charged = {
      note: 'Profil propre à cette attaque de base pour le Fondamental « Attaque chargée » (puissance max ×1,8 pour toutes les classes).',
      ...(c.pierceAtFull ? { pierceAtFull: c.pierceAtFull } : {}),
      ...(c.moveWhileDrawing ? { moveWhileCharging: c.moveWhileDrawing } : {}),
      ...(draft === 'ranger' ? { fullMs: 1000 } : {}),
    };
  }
  if (a.v02 || a.legacy) o.v02 = true;
  delete o.legacy;
  return o;
}

// ------------------------------------------------------------------ effects
const PCT_POINT_DRAFTS = new Set(['survie', 'mage']);
const W_STAT = { hpPct: 'mhpPct', mpPct: 'mmpPct', staminaMax: 'mst', staminaRegenPct: 'stRegenPct', critAdd: 'crit', poiseDmgPct: 'poisePct' };
const R_STAT = {
  crit: 'crit', crit_dmg: 'critDmgPct', mp_max: 'mmp', hp_max_pct: 'mhpPct', st_regen: 'stRegenPct',
  guard_st: 'guardStaminaPct', move_speed: 'speedPct', res_poison: 'resPoison', potion_heal: 'potionPct',
  charge_speed: 'chargeSpeedPct', dmg_vs: 'dmgVsPct', dmg_vs_family: 'dmgVsFamilyPct', dmg_vs_unmarked: 'dmgVsUnmarkedPct',
  dot_taken_dur: 'dotTakenDurPct', bleed_build: 'bleedBuildPct', poison_tick: 'poisonTickPct', poison_max_stacks: 'poisonMaxStacks',
  dmg_direct: 'dmgDirectPct', gather_herb_extra: 'gatherHerbPct', beast_material_extra: 'beastMaterialPct',
  st_on_melee_hit: 'stOnMeleeHit', tele_early_marked: 'teleEarlyMarkedMs',
};

function normWhen(when) {
  if (!when) return undefined;
  const o = { ...when };
  if (o.weaponFamily) {
    const f = Array.isArray(o.weaponFamily) ? o.weaponFamily : [o.weaponFamily];
    o.weaponFamily = f.map((x) => FAMILY[x] || x);
  }
  return o;
}

function normEffects(effects, draft, node, abilityIds) {
  const out = [];
  const nodeAb = node.ability ? renameAbility(draft, node.ability) : null;
  for (const e0 of effects || []) {
    const e = { ...e0 };
    // ---------- unlock
    if (e.mod === 'unlock') {
      out.push({ mod: 'unlock', op: 'set', value: renameAbility(draft, e.value || e.ability) });
      continue;
    }
    // ---------- warrior formats
    if (draft === 'warrior') {
      if (e.mod) {
        const ab = renameAbility(draft, e.ability);
        const op = e.mod;
        const r = { mod: `${ab}.${e.key}`, op, value: op === 'mul' ? +(e.value - 1).toFixed(4) : e.value };
        for (const k of Object.keys(e)) if (!['mod', 'ability', 'key', 'value'].includes(k)) r[k] = e[k];
        if (r.when) r.when = normWhen(r.when);
        out.push(r);
        continue;
      }
      const extra = {};
      for (const k of Object.keys(e)) if (!['stat', 'value', 'tag', 'abilities'].includes(k)) extra[k] = e[k];
      if (extra.when) extra.when = normWhen(extra.when);
      const op = typeof e.value === 'number' ? 'add' : 'set';
      if (e.stat === 'dmgPct' && e.abilities) {
        for (const ab of e.abilities) out.push({ mod: `${ab}.power`, op: 'mul', value: e.value, ...extra });
        continue;
      }
      if (e.stat === 'dmgPct' && e.tag) {
        for (const t of [].concat(e.tag)) out.push({ stat: `dmgPct.${fixTag(t)}`, op, value: e.value, ...extra });
        continue;
      }
      if (e.stat === 'inaptitudeMult') {
        out.push({ stat: 'inaptitudeReduce', op: 'add', value: e.value, classes: e.classes });
        continue;
      }
      out.push({ stat: W_STAT[e.stat] || e.stat, op, value: e.value, ...extra });
      continue;
    }
    // ---------- ranger formats
    if (draft === 'ranger') {
      if (e.stat) {
        const extra = {};
        for (const k of Object.keys(e)) if (!['stat', 'value', 'tag', 'op'].includes(k)) extra[k] = e[k];
        if (extra.cond) {
          extra.when = { cond: extra.cond };
          delete extra.cond;
        }
        const tag = e.tag ? fixTag(e.tag) : null;
        let r;
        switch (e.stat) {
          case 'dmg_tag': r = { stat: `dmgPct.${tag}`, op: 'add', value: e.value }; break;
          case 'proj_speed_tag': r = { stat: `projSpeedPct.${tag}`, op: 'add', value: e.value }; break;
          case 'range_tag': r = { stat: `range.${tag}`, op: 'add', value: e.value }; break;
          case 'cost_tag': r = { stat: `costPct.${tag}`, op: 'add', value: e.value }; break;
          case 'roll_st': r = { mod: 'roulade.st', op: 'add', value: e.value }; break;
          case 'sprint_st': r = { mod: 'sprint.stPerS', op: 'mul', value: e.value }; break;
          case 'jump_air': r = { mod: 'saut.airMs', op: 'add', value: Math.round(e.value * 1000) }; break;
          case 'st_cost_ranged': r = { stat: 'stCostPct.projectile', op: 'add', value: e.value }; break;
          case 'inaptitude_reduce': {
            // Frère d'armes : rôdeur -> compétences guerrier de mêlée ; guerrier -> compétences rôdeur d'arc
            r = { stat: 'inaptitudeReduce', op: 'add', value: e.value, classes: ['warrior', 'ranger'], forClass: ['warrior', 'ranger'] };
            delete extra.forClass;
            break;
          }
          default: r = { stat: R_STAT[e.stat] || e.stat, op: typeof e.value === 'number' ? 'add' : 'set', value: e.value };
        }
        out.push({ ...r, ...extra });
        continue;
      }
      if (e.mod) {
        let mod = e.mod;
        const first = mod.split('.')[0];
        let op = e.op || 'set';
        let value = e.value;
        if (op === 'mul' && typeof value === 'number') value = +(value - 1).toFixed(4);
        const extra = {};
        for (const k of Object.keys(e)) if (!['mod', 'op', 'value'].includes(k)) extra[k] = e[k];
        if (!abilityIds.has(renameAbility(draft, first))) {
          if (nodeAb) mod = `${nodeAb}.${mod}`;
          else {
            out.push({ stat: mod, op: 'set', value, ...extra });
            continue;
          }
        } else {
          const parts = mod.split('.');
          parts[0] = renameAbility(draft, parts[0]);
          mod = parts.join('.');
        }
        out.push({ mod, op, value, ...extra });
        continue;
      }
    }
    // ---------- survie & mage (percentage points -> fractions)
    if (PCT_POINT_DRAFTS.has(draft)) {
      if (e.stat) {
        let stat = e.stat === 'powerPct.sort' ? 'dmgPct.sort' : e.stat;
        let op = e.op || 'add';
        let value = e.value;
        if (stat === 'inaptitudeMult') {
          out.push({ stat: 'inaptitudeReduce', op: 'add', value: Math.abs(value) });
          continue;
        }
        if (stat === 'inaptitudeMult.warrior') {
          out.push({ stat: 'inaptitudeReduce', op: 'add', value: Math.abs(value), classes: ['warrior'] });
          continue;
        }
        if (op === 'pct') {
          stat = stat.endsWith('Pct') ? stat : stat + 'Pct';
          op = 'add';
          value = value / 100;
        } else if (/Pct(\.|$)/.test(stat) && typeof value === 'number') {
          value = value / 100;
        } else if (/^res(Feu|Givre|Arcane|Poison)$/.test(stat)) {
          value = value / 100;
        }
        const r = { stat, op, value: typeof value === 'number' ? +value.toFixed(4) : value };
        for (const k of Object.keys(e)) if (!['stat', 'op', 'value'].includes(k)) r[k] = e[k];
        out.push(r);
        continue;
      }
      if (e.mod) {
        const parts = e.mod.split('.');
        parts[0] = renameAbility(draft, parts[0]);
        out.push({ ...e, mod: parts.join('.'), op: e.op || 'set' });
        continue;
      }
    }
    warnings.push(`effet non converti (${draft} ${node.id}) ${JSON.stringify(e0)}`);
    out.push(e);
  }
  return out;
}

// ------------------------------------------------------------------ nodes
const allAbilitiesRaw = [
  ...S.abilities.map((a) => normAbility(a, 'survie')),
  ...W.abilities.map((a) => normAbility(a, 'warrior')),
  ...M.abilities.map((a) => normAbility(a, 'mage')),
  ...R.abilities.map((a) => normAbility(a, 'ranger')),
];
const abilityIds = new Set(allAbilitiesRaw.map((a) => a.id));
// ranger mods reference raw ability ids such as "estocade" -> accept both
abilityIds.add('estocade');
abilityIds.add('poison'); // not an ability: poison.* of fleche_empoisonnee is prefixed below
abilityIds.delete('poison');

const nodes = [];
function addNodes(list, draft) {
  for (const n0 of list) {
    const n = { ...n0 };
    n.id = renameNode(draft, n0.id);
    if (draft === 'ranger') n.y = -n0.y;
    n.x = Math.round(n.x);
    n.y = Math.round(n.y);
    n.links = (n0.links || []).map((l) => renameNode(draft, l));
    if (n0.ability) n.ability = renameAbility(draft, n0.ability);
    if (n0.exclusiveGroup) n.exclusiveGroup = n0.exclusiveGroup;
    n.effects = normEffects(n0.effects, draft, n0, abilityIds);
    if (n0.start) n.start = { survie: null, warrior: 'warrior', mage: 'mage', ranger: 'ranger' }[draft];
    if (n0.reqPoints) {
      n.reqRegionPoints = { region: n0.reqPoints.zone, min: n0.reqPoints.min };
    }
    // skill nodes always carry an explicit unlock
    if (n.type === 'skill' && n.ability && !n.effects.some((e) => e.mod === 'unlock')) {
      n.effects.unshift({ mod: 'unlock', op: 'set', value: n.ability });
    }
    for (const k of ['cost', 'class', 'externalLinks', 'polar', 'minPointsFromStart', 'reqPoints', 'anchor', 'note']) delete n[k];
    n.maxRank = n.maxRank || 1;
    n._draft = draft;
    nodes.push(n);
  }
}
addNodes(S.nodes, 'survie');
addNodes(W.nodes, 'warrior');
addNodes(M.nodes, 'mage');
addNodes(R.nodes, 'ranger');

const byId = new Map(nodes.map((n) => [n.id, n]));

// ranger mods like "estocade.*" -> "coup_epieu.*"
for (const n of nodes) for (const e of n.effects) if (e.mod && e.mod.startsWith('estocade.') && n._draft === 'ranger') e.mod = 'coup_epieu' + e.mod.slice(8);

// ------------------------------------------------------------------ fixes decided by the lead designer
// 1) Cadence (Maître d'armes) grants no new ability -> passive that carries the 2nd Frappe variant group.
byId.get('gu_md_cadence').type = 'passive';
byId.get('gu_md_cadence').effects = byId.get('gu_md_cadence').effects.filter((e) => e.mod !== 'unlock');
// 2) Ranger "Estocade" renamed to avoid two different skills called "Estocade".
for (const a of allAbilitiesRaw) if (a.id === 'coup_epieu') a.name = "Coup d'épieu";
byId.get('rg_estocade').name = "Coup d'épieu";
// 3) Survie "Riposte" buff renamed (the warrior skill keeps "Riposte").
for (const a of allAbilitiesRaw) if (a.id === 'riposte_parfaite') {
  a.name = 'Contre parfait';
  a.desc = "Après une esquive parfaite ou une parade parfaite, votre prochain coup est renforcé (état « Contre parfait »).";
  a.derivedFrom = ['roulade', 'garde'];
}

// ------------------------------------------------------------------ links: undirected + junctions
const JUNCTIONS = [
  ['sv_seuil_acier', 'guerrier_depart'],
  ['sv_seuil_arcanes', 'mage_depart'],
  ['sv_seuil_bois', 'rodeur_depart'],
  ['mr_p_oeil_sylvestre', 'ro_ve_cueilleur'], // Arcaniste sylvestre -> Venin
];
for (const n of nodes) n.links = n.links.filter((l) => byId.has(l));
for (const [a, b] of JUNCTIONS) {
  byId.get(a).links.push(b);
  byId.get(b).links.push(a);
}
for (const n of nodes) for (const l of n.links) if (!byId.get(l).links.includes(n.id)) byId.get(l).links.push(n.id);
for (const n of nodes) n.links = [...new Set(n.links)];

// layout fixes (a link passed over a node / two links crossed in the ranger draft)
const LAYOUT_FIX = { rg_javelot_harpon: [700, 425], ro_tq_bout_portant: [850, -60], rg_estocade_balayante: [965, 365], ro_ve_nuage_rampant: [745, -700] };
for (const [id, [x, y]] of Object.entries(LAYOUT_FIX)) Object.assign(byId.get(id), { x, y });
const LINK_REMOVE = [['ro_tq_acrobate', 'ro_tq_coup_de_dague']]; // ran over Marque de meute; Acrobate stays reachable via Marque
for (const [a, b] of LINK_REMOVE) {
  byId.get(a).links = byId.get(a).links.filter((l) => l !== b);
  byId.get(b).links = byId.get(b).links.filter((l) => l !== a);
}

// geometry helpers
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function segPointDist(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(a.x + t * vx - p.x, a.y + t * vy - p.y);
}
function segCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  if ([a, b].some((p) => p === c || p === d)) return false;
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
function allLinks() {
  const out = [];
  for (const n of nodes) for (const l of n.links) if (n.id < l) out.push([n, byId.get(l)]);
  return out;
}
function linkIsClean(a, b, minClear = 40) {
  for (const n of nodes) if (n !== a && n !== b && segPointDist(n, a, b) < minClear) return false;
  for (const [c, d] of allLinks()) if (segCross(a, b, c, d)) return false;
  return true;
}
/** Best clean link between two node sets (non-variant, non-keystone), shortest first. */
function junction(setA, setB, label) {
  const ok = (n) => n.type !== 'variant' && n.type !== 'keystone';
  const cands = [];
  for (const a of nodes.filter((n) => setA(n) && ok(n)))
    for (const b of nodes.filter((n) => setB(n) && ok(n))) cands.push([d2(a, b), a, b]);
  cands.sort((x, y) => x[0] - y[0]);
  for (const [len, a, b] of cands) {
    if (len > 520) break;
    if (linkIsClean(a, b)) {
      if (!a.links.includes(b.id)) a.links.push(b.id);
      if (!b.links.includes(a.id)) b.links.push(a.id);
      return `${label}: ${a.id} <-> ${b.id} (${Math.round(len)})`;
    }
  }
  warnings.push(`aucune jonction propre pour ${label}`);
  return null;
}
// automatic leaf nudging: a leaf (variant / keystone with a single link) that sits on another link, or whose own
// link runs over a node, is rotated around its parent (same distance) to the nearest clean position.
function nodeClean(n, minNode = 62, minClear = 35) {
  for (const o of nodes) if (o !== n && d2(o, n) < minNode) return false;
  const ls = allLinks();
  for (const [a, b] of ls) {
    if (a === n || b === n) {
      for (const o of nodes) if (o !== a && o !== b && segPointDist(o, a, b) < minClear) return false;
      for (const [c, d] of ls) if (c !== n && d !== n && segCross(a, b, c, d)) return false;
    } else if (segPointDist(n, a, b) < minClear) return false;
  }
  return true;
}
const nudged = [];
for (let pass = 0; pass < 3; pass++) {
  for (const n of nodes) {
    if (n.links.length !== 1 || nodeClean(n)) continue;
    const p = byId.get(n.links[0]);
    const r = d2(n, p);
    const a0 = Math.atan2(n.y - p.y, n.x - p.x);
    let done = false;
    for (let k = 1; k <= 24 && !done; k++) {
      for (const sgn of [1, -1]) {
        for (const rr of [r, r * 1.15, r * 0.9]) {
          const a = a0 + (sgn * k * 5 * Math.PI) / 180;
          const old = { x: n.x, y: n.y };
          n.x = Math.round(p.x + rr * Math.cos(a));
          n.y = Math.round(p.y + rr * Math.sin(a));
          if (nodeClean(n)) {
            nudged.push(`${n.id} (${old.x},${old.y}) -> (${n.x},${n.y})`);
            done = true;
            break;
          }
          Object.assign(n, old);
        }
        if (done) break;
      }
    }
    if (!done && pass === 2) warnings.push(`impossible de dégager ${n.id}`);
  }
}

const junctionLog = [
  ...JUNCTIONS.map(([a, b]) => `fixe: ${a} <-> ${b}`),
  junction((n) => n.region === 'pont_gm', (n) => n.region === 'mage', 'Lame spirituelle -> Mage'),
  junction((n) => n.region === 'pont_rg', (n) => n.region === 'guerrier', 'Chasseur -> Guerrier'),
];

// ------------------------------------------------------------------ regions, branches, costs
for (const n of nodes) {
  n.costs = { warrior: nodeCost(n, 'warrior'), mage: nodeCost(n, 'mage'), ranger: nodeCost(n, 'ranger') };
  if (n.type === 'root') n.costs = { warrior: 0, mage: 0, ranger: 0 };
}

// exclusive groups
const groupMap = new Map();
for (const n of nodes) {
  if (!n.exclusiveGroup) continue;
  if (!groupMap.has(n.exclusiveGroup)) groupMap.set(n.exclusiveGroup, { id: n.exclusiveGroup, ability: n.ability, region: n.region, nodes: [] });
  groupMap.get(n.exclusiveGroup).nodes.push(n.id);
}

// keystones (single shape)
function ksFrom(k, draft) {
  const id = renameNode(draft, k.id);
  const n = byId.get(id);
  let upside = k.upside || k.effect || k.desc || '';
  let drawback = k.drawback || '';
  if (!drawback && /CONTREPARTIE/i.test(upside)) {
    const [u, d] = upside.split(/CONTREPARTIE\s*:?/i);
    upside = u.trim().replace(/[.;]\s*$/, '.');
    drawback = d.trim();
  }
  return {
    id, name: k.name, region: n.region, branch: n.branch, upside, drawback,
    intent: k.intent || '', minLevel: n.minLevel || k.minLevel, reqRegionPoints: n.reqRegionPoints,
  };
}
const keystones = [
  ...S.keystones.map((k) => ksFrom(k, 'survie')),
  ...W.keystones.map((k) => ksFrom(k, 'warrior')),
  ...M.keystones.map((k) => ksFrom(k, 'mage')),
  ...R.keystones.map((k) => ksFrom(k, 'ranger')),
];
// icon keys (ASSET_REQUESTS.md): ks_<short name>, unique
const ksShort = (id) => id.replace(/^(gu_(ga|be|md)_ks_|gm_ks_|ma_ks_|mr_ks_|ro_(ti|tq|ve)_|rg_|ks_)/, "");
const ksSeen = new Map();
for (const k of keystones) {
  let key = `ks_${ksShort(k.id)}`;
  if (ksSeen.has(key)) key = `${key}_${k.region}`;
  ksSeen.set(key, k.id);
  k.icon = key;
}
for (const k of keystones) if (k.icon === "ks_serment") k.icon = "ks_serment_guerrier";
for (const k of keystones) if (k.icon === "ks_serment_pont_gm") k.icon = "ks_serment_lame";

// statuses (mage list + ranger poison/bleed definitions + survie stagger)
const statuses = M.statuses.map((s) => ({ ...s }));
const bleed = statuses.find((s) => s.id === 'saignement');
bleed.desc =
  "Deux effets sous un même nom. (1) Plaie : un coup « saignant » inflige un pourcentage de ses dégâts en quelques secondes (ex. Entaille : 180 % en 6 s). (2) Jauge d'hémorragie sous la barre de vie : chaque coup saignant ajoute des points (Flèche barbelée 30) ; à 100 la plaie éclate (×1,5 du coup + 6 % des PV max ; boss 2 %, joueurs 4 %) et la jauge se vide. Elle redescend de 10/s après 3 s sans nouvelle entaille.";
statuses.push({
  id: 'poison', name: 'Empoisonné', tags: ['poison'],
  desc: "Charges (3 au maximum, 6 avec « Vénéneux ») : chaque charge inflige 25 % de l'attaque du lanceur par seconde pendant 6 s. Le poison n'inflige jamais de déséquilibre (poise).",
});
statuses.push({
  id: 'vacillement', name: 'Vacillement (joueur)', tags: ['defense'],
  desc: "Nouveau : un coup télégraphié qui touche fait vaciller le joueur 0,4 s (boss 0,6 s) — ni attaque, ni roulade, ni garde. Durée × (1 − Équilibre / 100). Annule une incantation en cours. Garde brisée : 1 s.",
});

// ------------------------------------------------------------------ abilities: base + variants coverage
const abilities = allAbilitiesRaw;
const baseAbility = { warrior: 'strike', mage: 'firebolt', ranger: 'shot' };
for (const a of abilities) if (Object.values(baseAbility).includes(a.id)) a.base = true;
for (const a of abilities) a.icon = `ab_${a.id}`;

// ------------------------------------------------------------------ balance changes (tools/balance.mjs)
// Every change is listed in skilltree.meta.balanceChanges and in ARBRE_COMPETENCES.md §9.
const balanceChanges = [];
function tuneAbility(id, patch, why) {
  const a = abilities.find((x) => x.id === id);
  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, a[k]]));
  Object.assign(a, patch);
  balanceChanges.push({ target: id, before, after: patch, why });
}
function tuneNode(id, fn, why) {
  const n = byId.get(id);
  const before = JSON.stringify(n.effects);
  fn(n);
  balanceChanges.push({ target: id, before, after: JSON.stringify(n.effects), why });
}
const redesc = (obj, from, to) => {
  if (!obj.desc.includes(from)) warnings.push(`équilibrage : texte « ${from} » introuvable dans ${obj.id}`);
  obj.desc = obj.desc.replace(from, to);
};
const abById = (id) => abilities.find((x) => x.id === id);
// Mage : sustain and control were far above the other classes at level 15
tuneAbility('heal', { heal: 0.25, cd: 15 }, 'Soin : 30 % toutes les 12 s donnait au mage une survie solo très supérieure aux autres classes dès le niveau 15.');
redesc(abById('heal'), '30 %', '25 %');
redesc(byId.get('ma_heal'), '30 %', '25 %');
redesc(byId.get('ma_v_heal_remanence'), '12 → 16 s', '15 → 18 s');
tuneNode('ma_v_heal_remanence', (n) => { n.effects.find((e) => e.mod === 'heal.cd').value = 18; }, 'Suit la nouvelle recharge du Soin (15 s).');
redesc(byId.get('ma_v_heal_sursaut'), 'recharge 12 s', 'recharge 15 s');
tuneNode('ma_v_heal_sursaut', (n) => { n.effects.push({ mod: 'heal.cd', op: 'set', value: 15 }); }, 'Recharge explicite, alignée sur le Soin de base.');
redesc(byId.get('ma_v_heal_cercle'), 'vous 30 %', 'vous 25 %');
tuneAbility('frost_nova', { applies: [{ id: 'froid', stacks: 2 }] }, 'Nova de givre : 3 charges de Froid d’un coup (−45 % de vitesse d’attaque) rendaient le mage de givre presque intouchable au contact.');
redesc(abById('frost_nova'), '3 charges', '2 charges');
redesc(byId.get('ma_frost_nova'), '3 charges', '2 charges');
redesc(byId.get('ma_v_nova_glaciale'), 'reçoivent 3 charges', 'reçoivent 2 charges');
const froid = statuses.find((x) => x.id === 'froid');
froid.desc = 'Charges (max 3), 3 s : −15 % de vitesse de déplacement et −10 % de vitesse d’attaque par charge. Boss : moitié d’effet.';
balanceChanges.push({ target: 'statut froid', before: '−15 % vitesse d’attaque par charge', after: '−10 % vitesse d’attaque par charge (déplacement inchangé : −15 %)', why: 'Le contrôle du givre réduisait les dégâts subis de plus de 30 % en continu.' });
// Rôdeur : no sustain and little control, fell 25-30 % behind at level 15
tuneAbility('marque_de_chasse', { dmgTakenFromYou: 0.15 }, 'Marque du chasseur : l’outil principal du Rôdeur en solo (+10 % → +15 %).');
redesc(abById('marque_de_chasse'), '+10 %', '+15 %');
redesc(byId.get('ro_tq_marque'), '+10 %', '+15 %');
redesc(byId.get('ro_tq_marque_sang'), '+10 %', '+15 %');
tuneNode('ro_ti_main_sure', (n) => { n.effects[0].value = 0.05; }, 'Main sûre : +4 % → +5 % par rang (enveloppe de dégâts du Rôdeur au niveau du Guerrier et du Mage).');
redesc(byId.get('ro_ti_main_sure'), '+4 %', '+5 %');
tuneNode('ro_ti_oeil_exerce', (n) => { n.effects[0].value = 0.03; }, 'Œil exercé : +2 % → +3 % de critique par rang.');
redesc(byId.get('ro_ti_oeil_exerce'), '+2 %', '+3 %');
// Guerrier Berserker : no shield, no heal but the Cri : 35 % behind the Gardien at level 15
tuneNode('gu_be_chair', (n) => { n.effects[0].value = 0.05; }, 'Chair endurcie : +4 % → +5 % de PV par rang.');
redesc(byId.get('gu_be_chair'), '+4 %', '+5 %');
tuneNode('gu_be_soif', (n) => { n.effects[0].value = 0.03; }, 'Soif de sang : +2 % → +3 % de vol de vie par rang (plafond global inchangé : 9 %).');
redesc(byId.get('gu_be_soif'), '+2 %', '+3 %');
// Mage de givre : 60 % des dégâts d'un pyromancien au niveau 30, trop peu même pour une branche de contrôle
tuneAbility('ice_lance', { power: 1.6 }, 'Lance de glace : ×1,5 → ×1,6 (la branche Givre manquait de dégâts au niveau 30).');
tuneNode('ma_v_lance_trio', (n) => { n.effects.find((e) => e.mod === 'ice_lance.power').value = 0.75; }, 'Trio : suit la hausse de la Lance (×0,7 → ×0,75 par lance).');
redesc(byId.get('ma_v_lance_trio'), '×0,7', '×0,75');
tuneAbility('blizzard', { power: 0.35 }, 'Blizzard : ×0,25 → ×0,35 par tic.');
tuneAbility('frost_nova', { power: 1.3 }, 'Nova de givre : ×1,1 → ×1,3 (compense la charge de Froid retirée).');
abById('frost_nova').souls = abById('frost_nova').souls.replace('3 charges de Froid = −45 % de vitesse (v0.2 : −50 %)', '2 charges de Froid = −30 % de déplacement et −20 % de vitesse d’attaque (v0.2 : −50 %)');
// Rôdeur Tireur : l'ultime faisait passer le Tireur 25 % au-dessus des autres au niveau 30
tuneAbility('trait_fatal', { power: 4.0 }, 'Trait fatal : ×5,0 → ×4,0 (toujours le plus gros coup du jeu, mais le Tireur dépassait la cible de 25 % au niveau 30).');
// Guerrier : Gardien trop sûr, Berserker trop fragile au niveau 15
tuneAbility('shield_bash', { cd: 12 }, 'Coup de bouclier : recharge 10 → 12 s (le Gardien étourdissait presque en continu).');
redesc(byId.get('gu_ga_charge_bouclier'), 'recharge 10 → 12 s', 'recharge 12 → 14 s');
tuneNode('gu_ga_charge_bouclier', (n) => { const e = n.effects.find((x) => x.mod === 'shield_bash.cd'); if (e) e.value = 14; }, 'Suit la recharge du Coup de bouclier.');
redesc(byId.get('gu_ga_bouclier_ecrasant'), 'recharge 10 → 14 s', 'recharge 12 → 16 s');
tuneNode('gu_ga_bouclier_ecrasant', (n) => { n.effects.find((x) => x.mod === 'shield_bash.cd').value = 16; }, 'Suit la recharge du Coup de bouclier.');
tuneAbility('rage', { cd: 30, buff: { dmgPct: 0.3, attackSpeedPct: 0.1, defPct: -0.2 } }, 'Rage sanguinaire : +25 % → +30 % de dégâts, recharge 35 → 30 s (le Berserker restait 30 % sous le Gardien).');
// Pass 3 : Givre trop fort au niveau 15, Rôdeur au-dessus au niveau 30, Berserker sous le Gardien au niveau 15
tuneNode('ma_v_bolt_givre', (n) => { n.effects.find((e) => e.mod === 'firebolt.applies').value = [{ id: 'froid', stacks: 1, dur: 2.5, every: 2 }]; }, 'Trait de givre : 1 charge de Froid tous les 2 traits (et non à chaque trait) : le Froid permanent au niveau 15 rendait le mage de givre intouchable.');
redesc(byId.get('ma_v_bolt_givre'), 'inflige 1 charge de Froid (2,5 s)', 'un trait sur deux inflige 1 charge de Froid (2,5 s)');
tuneNode('ro_ti_posture_archer', (n) => { n.effects.find((e) => e.stat === 'crit').value = 0.2; }, 'Posture de l’archer : +30 % → +20 % de critique à l’arrêt.');
redesc(byId.get('ro_ti_posture_archer'), '+30 % de chances de critique', '+20 % de chances de critique');
tuneNode('ro_ti_point_faible', (n) => { n.effects[0].value = 0.1; }, 'Point faible : +12 % → +10 % de dégâts critiques par rang.');
redesc(byId.get('ro_ti_point_faible'), '+12 %', '+10 %');
tuneAbility('fleche_barbelee', { bleedBuild: 30 }, 'Flèche barbelée : 35 → 30 de saignement (le Venin dépassait la cible au niveau 30).');
redesc(abById('fleche_barbelee'), 'Ajoute 35', 'Ajoute 30');
redesc(byId.get('ro_ve_fleche_barbelee'), 'Ajoute 35', 'Ajoute 30');
tuneAbility('rage', { buff: { dmgPct: 0.3, attackSpeedPct: 0.1, defPct: -0.1 } }, 'Rage sanguinaire : −20 % → −10 % de défense.');
abById('rage').souls = abById('rage').souls.replace('−20 % de défense', '−10 % de défense');
// Pass 4 : passerelles (hybrides trop faibles), Givre et Berserker encore un peu bas
tuneAbility('blade_wave', { power: 1.7 }, 'Onde tranchante : ×1,3 → ×1,7 (attaque signature de la Lame spirituelle ; l’hybride restait à 60 % d’un mage pur).');
tuneAbility('rune_arrow', { power: 1.7 }, 'Flèche runique : ×1,4 → ×1,7 (signature de l’Arcaniste sylvestre, sans Inaptitude pour Mage et Rôdeur).');
tuneAbility('frost_brambles', { power: 1.0 }, 'Ronces givrées : ×0,8 → ×1,0 sur 3 s.');
redesc(abById('frost_brambles'), '(×0,8 sur 3 s)', '(×1,0 sur 3 s)');
redesc(byId.get('mr_frost_brambles'), '(×0,8 sur 3 s)', '(×1,0 sur 3 s)');
tuneNode('ma_p_coeur_gele', (n) => { n.effects[0].value = 0.08; }, 'Cœur gelé : +5 % → +8 % de dégâts contre les cibles ralenties par rang.');
redesc(byId.get('ma_p_coeur_gele'), '+5 %', '+8 %');
// Pass 5 : Garde (cohérence avec les boucliers d'items.json), Gardien/Berserker, passerelles
tuneAbility('garde', { reduce: { bouclier: 'valeur « blocage » du bouclier (61 à 90 %)', melee: 0.5, autre: 0.3 } }, 'Garde : un bouclier bloque sa valeur de blocage (61 à 90 %, items.json) au lieu de 100 % ; arme de mêlée 70 → 50 %, autre 50 → 30 %. Seule la clé Mur vivant atteint 100 %.');
redesc(byId.get('sv_bras'), '(sans dépasser 100 %)', '(sans dépasser 90 %, ou 100 % avec Mur vivant)');
tuneAbility('whirlwind', { power: 1.9 }, 'Tourbillon : ×1,7 → ×1,9 (racine du Berserker, qui restait 27 % sous le Gardien au niveau 15).');
tuneAbility('frost_armor', { buff: { defPct: 0.2, meleeAttackerFroid: 1 } }, 'Armure de givre : +25 % → +20 % de défense.');
redesc(abById('frost_armor'), '+25 %', '+20 %');
redesc(byId.get('ma_frost_armor'), '+25 %', '+20 %');
tuneNode('gm_maitrise_runique', (n) => { for (const e of n.effects) if (e.stat && e.stat.startsWith('dmgPct.')) e.value = 0.15; }, 'Maîtrise runique : +10 % → +15 % de dégâts élémentaires avec une épée runique.');
redesc(byId.get('gm_maitrise_runique'), '+10 %', '+15 %');
tuneNode('gm_ks_serment', (n) => { n.effects.find((e) => e.stat === 'inaptitudeReduce').value = 0.33; }, 'Serment de la lame spirituelle : Inaptitude divisée par deux → réduite d’un tiers (l’hybride Guerrier/Mage dépassait le mage pur au niveau 30).');
redesc(byId.get('gm_ks_serment'), 'est divisée par deux', 'est réduite d’un tiers');
tuneNode('mr_p_seve_arcanique', (n) => { for (const e of n.effects) e.value = 0.06; }, 'Sève arcanique : +4 % → +6 % par rang.');
redesc(byId.get('mr_p_seve_arcanique'), '+4 %', '+6 %');
tuneNode('mr_p_oeil_sylvestre', (n) => { n.effects[0].value = 0.04; }, 'Œil sylvestre : +3 % → +4 % de critique des projectiles par rang.');
redesc(byId.get('mr_p_oeil_sylvestre'), '+3 %', '+4 %');
// Pass 6
tuneNode('gu_be_tourbillon_sanglant', (n) => { n.effects[0].value = 1.6; n.effects[1].value = { type: 'saignement', total: 0.8, dur: 5 }; }, 'Tourbillon sanglant : suit la hausse du Tourbillon (×1,6, saignement 80 %).');
redesc(byId.get('gu_be_tourbillon_sanglant'), '(60 % de l’attaque sur 5 s) ; puissance 1,7 → 1,4', '(80 % de l’attaque sur 5 s) ; puissance 1,9 → 1,6');
tuneAbility('riposte', { power: 1.9 }, 'Riposte : ×2,2 → ×1,9 (critique garanti : le Gardien dépassait la cible de 25 %).');
tuneNode('ma_ks_coeur_de_braise', (n) => { n.effects.find((e) => e.stat === 'dmgPct.feu').value = 0.2; }, 'Cœur de braise : +15 % → +20 % de dégâts de feu (le mage restait 15 % sous les autres classes au niveau 30).');
redesc(byId.get('ma_ks_coeur_de_braise'), 'augmentent de 15 %', 'augmentent de 20 %');
tuneNode('mr_ks_arc_des_astres', (n) => { n.effects = n.effects.filter((e) => e.stat !== 'mmpPct'); n.effects.find((e) => e.stat === 'stCostPct').value = 0.15; }, 'Arc des astres : plus de −15 % de mana, mais +15 % (au lieu de +10 %) d’endurance sur les tirs et sorts : l’hybride Rôdeur/givre, à court de mana, restait à 70 % d’un pur.');
redesc(byId.get('mr_ks_arc_des_astres'), "mana maximale −15 % et +10 % de coût d'endurance", "+15 % de coût d'endurance");
// Pass 7
tuneNode('ma_ks_hiver_eternel', (n) => { n.effects.push({ stat: 'dmgPct.givre', op: 'add', value: 0.2, final: true }); }, 'Hiver éternel : gagne +20 % de dégâts de givre (le mage de givre manquait de dégâts au niveau 30 ; la Lance de glace reste à ×1,6).');
redesc(byId.get('ma_ks_hiver_eternel'), 'un boss subit +25 % de déséquilibre pendant 3 s.', 'un boss subit +25 % de déséquilibre pendant 3 s ; vos dégâts de givre augmentent de 20 %.');
tuneAbility('rage', { dur: 12 }, 'Rage sanguinaire : durée 10 → 12 s.');
// Pass 8
tuneAbility('enchant_blade', { buff: { meleeBonusDmg: 0.4, element: 'arcane' } }, 'Lame enchantée : +35 % → +40 % de dégâts sur les coups de mêlée et l’Onde tranchante.');
redesc(byId.get('gm_lame_arcanique'), 'bonus 35 % → 25 %', 'bonus 40 % → 30 %');
tuneNode('gm_lame_arcanique', (n) => { n.effects[0].value = { meleeBonusDmg: 0.3, element: 'arcane' }; }, 'Suit la Lame enchantée (+30 % avec l’élément arcane).');
tuneNode('gu_ga_constitution', (n) => { n.effects[0].value = 0.035; }, 'Constitution : +4 % → +3,5 % de PV par rang (le Gardien restait 25 % au-dessus au niveau 15).');
redesc(byId.get('gu_ga_constitution'), '+4 %', '+3,5 %');
tuneAbility('shield_bash', { poise: 48 }, 'Coup de bouclier : poise 55 → 48 (le Gardien déséquilibrait presque en continu au niveau 15).');
// Pass 10 : variants follow their retuned base ability (same relative change as in the drafts)
const setMod = (id, mod, value) => { const e = byId.get(id).effects.find((x) => x.mod === mod); e.value = value; };
tuneNode('gu_be_tourbillon_aspirant', () => setMod('gu_be_tourbillon_aspirant', 'whirlwind.power', 1.6), 'Suit le Tourbillon ×1,9.');
redesc(byId.get('gu_be_tourbillon_aspirant'), 'puissance 1,7 → 1,4', 'puissance 1,9 → 1,6');
tuneNode('gu_be_entaille_profonde', () => setMod('gu_be_entaille_profonde', 'rend.dot', { type: 'saignement', total: 2.7, dur: 8 }), 'Suit l’Entaille (saignement ×1,5 : 180 % → 270 %).');
tuneNode('gu_ga_charge_bouclier', () => setMod('gu_ga_charge_bouclier', 'shield_bash.poise', 40), 'Suit le Coup de bouclier (poise 48).');
redesc(byId.get('gu_ga_charge_bouclier'), 'poise 55 → 45', 'poise 48 → 40');
tuneNode('gu_ga_riposte_vengeresse', () => setMod('gu_ga_riposte_vengeresse', 'riposte.power', 1.55), 'Suit la Riposte ×1,9.');
redesc(byId.get('gu_ga_riposte_vengeresse'), 'puissance 2,2 → 1,8', 'puissance 1,9 → 1,55');
tuneNode('gm_lance_spectrale', () => setMod('gm_lance_spectrale', 'blade_wave.power', 2.1), 'Suit l’Onde tranchante ×1,7.');
redesc(byId.get('gm_lance_spectrale'), 'puissance 1,3 → 1,6', 'puissance 1,7 → 2,1');
tuneNode('gm_croissant', () => setMod('gm_croissant', 'blade_wave.power', 1.45), 'Suit l’Onde tranchante ×1,7.');
redesc(byId.get('gm_croissant'), 'puissance 1,3 → 1,1', 'puissance 1,7 → 1,45');
tuneNode('ma_v_nova_eclats', () => setMod('ma_v_nova_eclats', 'frost_nova.power', 1.8), 'Suit la Nova de givre ×1,3.');
redesc(byId.get('ma_v_nova_eclats'), 'Puissance 1,1 → 1,6', 'Puissance 1,3 → 1,8');
tuneNode('ma_v_lance_glacier', () => setMod('ma_v_lance_glacier', 'ice_lance.power', 1.4), 'Suit la Lance de glace ×1,6.');
redesc(byId.get('ma_v_lance_glacier'), 'puissance 1,5 → 1,3', 'puissance 1,6 → 1,4');
tuneNode('ro_ve_barbes_profondes', () => setMod('ro_ve_barbes_profondes', 'fleche_barbelee.bleedBuild', 45), 'Suit la Flèche barbelée (30 de saignement).');
redesc(byId.get('ro_ve_barbes_profondes'), 'saignement 35 → 50', 'saignement 30 → 45');
redesc(byId.get('ro_tq_marque_meute'), 'les +10 %', 'les +15 %');
tuneNode('ro_ti_visee_eclair', () => setMod('ro_ti_visee_eclair', 'trait_fatal.power', 2.9), 'Suit le Trait fatal ×4,0.');
redesc(byId.get('ro_ti_visee_eclair'), '×5,0 → ×3,6', '×4,0 → ×2,9');
// Arcaniste sylvestre : l'hybride Rôdeur/givre manquait de mana et de dégâts (70 % d'un pur)
tuneAbility('rune_arrow', { mp: 10 }, 'Flèche runique : 14 → 10 mana.');
tuneAbility('wisp', { power: 0.4 }, 'Feu follet : ×0,3 → ×0,4 par trait.');
redesc(abById('wisp'), '(×0,3)', '(×0,4)');
redesc(byId.get('mr_wisp'), '(×0,3)', '(×0,4)');
tuneAbility('blade_wave', { cd: 7 }, 'Onde tranchante : recharge 8 → 7 s.');
redesc(byId.get('gm_lance_spectrale'), 'recharge 8 → 12 s', 'recharge 7 → 11 s');
tuneNode('gm_lance_spectrale', () => setMod('gm_lance_spectrale', 'blade_wave.cd', 11), 'Suit la recharge de l’Onde (7 s).');
tuneAbility('rend', { power: 1.0, dot: { type: 'saignement', total: 1.8, dur: 6 } }, 'Entaille : ×0,9 → ×1,0 et saignement 180 % de l’attaque en 6 s (outil principal du Berserker avant le niveau 20).');




// ------------------------------------------------------------------ rules
const rules = {
  maxLevel: 30,
  points: {
    formula: '(niveau − 1) + floor(niveau / 5)',
    table: Object.fromEntries([1, 2, 3, 4, 5, 10, 15, 20, 25, 30].map((l) => [l, l - 1 + Math.floor(l / 5)])),
    maxRank: 3,
    unspentKept: true,
  },
  gate: { fondamentaux: 3, text: "Tant qu'un personnage a moins de 3 Fondamentaux, seuls les Fondamentaux sont allouables." },
  costs: {
    ownRegion: 1, survie: 1, nearBridge: 1, farBridge: 2, otherRegion: 2, otherKeystone: 3, farBridgeKeystone: 3, otherStart: 2,
    matrix: {
      survie: { warrior: 1, mage: 1, ranger: 1 },
      guerrier: { warrior: 1, mage: 2, ranger: 2 },
      mage: { warrior: 2, mage: 1, ranger: 2 },
      rodeur: { warrior: 2, mage: 2, ranger: 1 },
      pont_gm: { warrior: 1, mage: 1, ranger: 2 },
      pont_mr: { warrior: 2, mage: 1, ranger: 1 },
      pont_rg: { warrior: 1, mage: 2, ranger: 1 },
    },
    note: "Clé de voûte d'une autre classe ou d'une passerelle non voisine : 3 points. Nœud de départ d'une autre classe : 2 points (donne son attaque de base, avec Inaptitude). Chaque rang coûte le coût du nœud.",
  },
  inaptitude: {
    power: -0.25, cost: 0.25, cooldown: 0.2, maxReduction: 0.6,
    referenceAttack: "Une capacité hors classe utilise min(attaque du personnage, attaque qu'aurait un personnage de sa classe d'origine au même niveau avec le même équipement).",
    reducers: ['ks_touche_a_tout (0,5, toutes classes)', 'gm_ks_serment (0,33, capacités Guerrier et Mage)', 'ma_ks_erudit_martial (0,5, capacités Guerrier)', "rg_frere_armes (0,15, Guerrier ↔ Rôdeur)"],
    stacking: 'Les réductions s’additionnent, plafond 0,6 : il reste toujours au moins 40 % de la pénalité (−10 % puissance, +10 % coût, +8 % recharge).',
  },
  weapon: {
    melee: { needs: "arme portant l'étiquette « melee » et pas « focalisateur » (épées, haches, masses, lances, dagues) ; bâton et sceptre seulement avec la clé « Érudit martial »", otherwise: 'grisée' },
    arc: { needs: "arme portant l'étiquette « distance » (arc court, arc long, arbalète)", otherwise: 'grisée' },
    dague: { needs: 'couteau de ceinture : toujours disponible avec une arme « distance » (dégâts de l’arme ×0,8) ou une arme de mêlée à une main', otherwise: 'grisée' },
    focus: { needs: 'focalisateur (bâton, sceptre) : pleine puissance ; épée runique ou grimoire en main gauche : −10 %', otherwise: '−20 % de puissance' },
    focus_ou_arc: { needs: 'focalisateur ou arme « distance »', otherwise: '−20 % de puissance' },
    base: { needs: "l'arme de l'attaque de base utilisée", otherwise: '—' },
    null: { needs: 'rien', otherwise: '—' },
  },
  caps: {
    treeDamagePct: 0.75, rollIframeMs: 450, rollIframeShareOfCd: 0.75, rollMinSt: 12, stMax: 180, stRegenMax: 55,
    stRegenDelayMinMs: 500, sprintMinStPerS: 10, sprintMaxMult: 1.65, cdrMax: 0.3, equilibreMax: 60, resistMax: 0.6,
    lifestealMax: 0.09, rangedMoveMax: 0.4, guardFullBlockNeedsShield: true, ccImmunityS: 8, bossNeverStunned: true,
  },
  respec: {
    freeUntilLevel: 10, npc: 'npc_master (Maître des arts)', fullGold: '25 × niveau', leafGold: '5 × niveau × coût du nœud',
    forbidden: ['combat', 'mort', 'zone rouge'],
  },
  migration: {
    gift: ['fond_roulade', 'fond_sprint'],
    respecFree: 1,
    legacyFloor: 5,
    text: "Roulade et Sprint offerts (ils comptent pour la porte), une réinitialisation gratuite, un plancher de points (Guerrier 4, Mage 5, Rôdeur 6 : le coût du préréglage) tant que points(niveau) est plus petit, et le préréglage « Reprendre mon style » appliqué automatiquement à la première connexion : chacun retrouve ses 4 compétences v0.2.",
  },
  loadout: { slots: 8, defaults: { 0: 'attaque de base', 4: 'item:potion_hp_s', 5: 'item:potion_mp_s' } },
  keys: {
    roulade: 'Space', sprint: 'ShiftLeft (maintenir)', saut: 'KeyC', garde: 'KeyE (maintenir)', attaque_chargee: "maintenir l'attaque de base",
    slots: 'Digit1..Digit8', arbre: 'KeyN', livre: 'KeyK', carte: 'KeyM', cible: 'Tab',
  },
  damageFormula: 'dégâts = atk × puissance × (0,85..1,15) × crit × K / (K + déf), K = 60 + 6 × max(0, niveau de l’attaquant − 10)',
};

// ------------------------------------------------------------------ assemble + migration presets
for (const n of nodes) delete n._draft;
const regionOrder = { survie: 0, guerrier: 1, pont_gm: 2, mage: 3, pont_mr: 4, rodeur: 5, pont_rg: 6 };
const typeOrder = { root: 0, skill: 1, passive: 2, variant: 3, keystone: 4 };
nodes.sort((a, b) => regionOrder[a.region] - regionOrder[b.region] || Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
const KEY_ORDER = ['id', 'region', 'branch', 'type', 'name', 'desc', 'x', 'y', 'links', 'maxRank', 'costs', 'start', 'fondamental', 'migrationGift', 'minLevel', 'reqRegionPoints', 'ability', 'exclusiveGroup', 'effects', 'vfx', 'drawback'];
const orderKeys = (o) => {
  const r = {};
  for (const k of KEY_ORDER) if (o[k] !== undefined) r[k] = o[k];
  for (const k of Object.keys(o)) if (!(k in r)) r[k] = o[k];
  return r;
};

const tree = {
  meta: {
    title: "L'Arbre des Brumes",
    version: 'v0.3-final-1',
    frame: "x vers la droite, y vers le HAUT ; angles trigonométriques depuis +x (Guerrier 90°, Mage 210°, Rôdeur 330°). L'interface affiche (x, −y).",
    generatedBy: 'docs/design/tools/build_tree.mjs (à partir de docs/design/drafts/tree_*.json)',
    balanceChanges: null,
    units: "Fractions partout (0,04 = +4 %) ; durées en secondes sauf champs suffixés Ms ; power = multiplicateur de l'attaque ; mp/st en points.",
  },
  rules,
  classes: {
    warrior: { name: 'Guerrier', region: 'guerrier', start: 'guerrier_depart', baseAbility: 'strike', angle: 90, bridges: ['pont_gm', 'pont_rg'], color: '#c0392b' },
    mage: { name: 'Mage', region: 'mage', start: 'mage_depart', baseAbility: 'firebolt', angle: 210, bridges: ['pont_gm', 'pont_mr'], color: '#2e6fd8' },
    ranger: { name: 'Rôdeur', region: 'rodeur', start: 'rodeur_depart', baseAbility: 'shot', angle: 330, bridges: ['pont_mr', 'pont_rg'], color: '#2e9e4f' },
  },
  regions: {
    survie: { name: 'Survie', desc: 'Cœur des Brumes, Fondamentaux et anneau de Survie', r: [0, 460] },
    guerrier: { name: 'Guerrier', angle: 90, branches: { tronc: 'Tronc', gardien: 'Gardien', berserker: 'Berserker', maitre: "Maître d'armes" } },
    mage: { name: 'Mage', angle: 210, branches: { tronc: 'Tronc', pyromancie: 'Pyromancie', arcanes: 'Arcanes', givre: 'Givre' } },
    rodeur: { name: 'Rôdeur', angle: 330, branches: { origine: 'Départ', tireur: 'Tireur', traqueur: 'Traqueur', venin: 'Venin' } },
    pont_gm: { name: 'Lame spirituelle', angle: 150, between: ['guerrier', 'mage'] },
    pont_mr: { name: 'Arcaniste sylvestre', angle: 270, between: ['mage', 'rodeur'] },
    pont_rg: { name: 'Chasseur', angle: 30, between: ['rodeur', 'guerrier'] },
  },
  statuses,
  abilities,
  exclusiveGroups: [...groupMap.values()],
  nodes: nodes.map(orderKeys),
  keystones,
};

tree.meta.balanceChanges = balanceChanges;
const posture = tree.keystones.find((k) => k.id === 'ro_ti_posture_archer');
posture.upside = posture.upside.replace('+30 % de chances de critique', '+20 % de chances de critique');
tree.keystones.find((k) => k.id === 'ma_ks_coeur_de_braise').upside = 'Brûlures cumulables jusqu’à 3 fois (durées séparées) ; +20 % de dégâts de feu.';
tree.keystones.find((k) => k.id === 'ma_ks_hiver_eternel').upside = '3 charges de Froid gèlent un non-boss 1,2 s (immunité 8 s) ; un boss subit +25 % de déséquilibre 3 s ; +20 % de dégâts de givre.';
tree.keystones.find((k) => k.id === 'mr_ks_arc_des_astres').drawback = '+15 % de coût d’endurance des tirs et des sorts.';
tree.keystones.find((k) => k.id === 'gm_ks_serment').upside = 'La pénalité d’Inaptitude des compétences de Guerrier ET de Mage est réduite d’un tiers.';

// ------------------------------------------------------------------ critic pass (final review, ARBRE_COMPETENCES.md §15 bis)
// Three readings: new casual player, soulslike veteran, exploiter. Every change is listed in tree.meta.criticChanges.
const criticChanges = [];
const tn = (id) => tree.nodes.find((n) => n.id === id);
const tk = (id) => tree.keystones.find((k) => k.id === id);
const ta = (id) => tree.abilities.find((a) => a.id === id);
const critic = (target, what, why) => criticChanges.push({ target, what, why });
// (soulslike) Danseur des brumes + Esquive parfaite = endurance infinie : le remboursement ne dépasse jamais le coût payé.
{
  const n = tn('sv_esquive_parfaite');
  n.effects.find((e) => e.mod === 'roulade.perfectRefundSt').capToPaid = true;
  n.desc = "Esquiver un coup dans les 150 dernières ms avant l'impact rend 15 d'endurance (jamais plus que le coût de la roulade : rien avec Danseur des brumes) et donne Contre parfait 1 s : prochain coup ×1,5 et +20 de déséquilibre.";
  critic('sv_esquive_parfaite', 'remboursement plafonné au coût payé', 'Avec Danseur des brumes (roulade gratuite), chaque esquive parfaite créait 15 d’endurance : endurance infinie.');
}
// (soulslike) Fantôme des brumes : un boss ne perd jamais sa cible (sinon 1,5 s sans attaque toutes les 8 s).
{
  const n = tn('ro_tq_fantome_brumes');
  Object.assign(n.effects.find((e) => e.stat === 'onPerfectDodge').value, { bosses: false, elites: 0.5 });
  n.desc = 'Une roulade qui évite un coup (esquive parfaite) vous rend invisible 1,5 s : les monstres perdent votre trace (élites 0,75 s ; les boss ne vous perdent jamais ; JcJ : 0,8 s, silhouette visible à 5 m). Recharge interne 8 s. (Demande 14 points dépensés dans la région Rôdeur.)';
  tk('ro_tq_fantome_brumes').upside = 'Esquive parfaite = invisible 1,5 s (élites 0,75 s, jamais contre un boss ; JcJ 0,8 s). Recharge interne 8 s.';
  critic('ro_tq_fantome_brumes', 'sans effet sur les boss, moitié sur les élites', 'Un boss qui perd sa cible 1,5 s toutes les 8 s = 19 % du combat sans danger.');
}
// (soulslike) Sang pour sang : une seule guérison toutes les 4 s (sinon soin en chaîne dans un groupe de monstres).
{
  const n = tn('ro_ve_sang_pour_sang');
  n.effects.find((e) => e.stat === 'onBleedBurst').value.icd = 4;
  n.desc = 'Chaque plaie qui éclate sous vos coups vous rend 8 % de vos PV max (au plus une fois toutes les 4 s). (Demande 8 points dépensés dans la région Rôdeur.)';
  tk('ro_ve_sang_pour_sang').upside = 'Une plaie qui éclate vous rend 8 % de vos PV max (une fois toutes les 4 s au plus).';
  critic('ro_ve_sang_pour_sang', 'recharge interne 4 s', 'Dans un groupe de monstres, les plaies éclatent en série : 8 % de PV par cible, soin quasi continu.');
}
// (soulslike) Frénésie du chasseur : jamais plus de la moitié du coût de l'attaque (Frappe éclair coûte 4 : attaques gratuites).
{
  const n = tn('rg_frenesie');
  n.effects.find((e) => e.stat === 'stOnMeleeHit').maxShareOfCost = 0.5;
  n.desc = "Chaque coup de mêlée qui touche rend 4 d'endurance (une fois par attaque, jamais plus de la moitié de ce qu'elle a coûté). (Demande 5 points dépensés dans la passerelle Chasseur.)";
  tk('rg_frenesie').upside = "Chaque attaque de mêlée qui touche rend 4 d'endurance (au plus la moitié de son coût).";
  critic('rg_frenesie', 'remboursement ≤ 50 % du coût de l’attaque', 'Frappe éclair (4 d’endurance) + 4 rendus = attaques gratuites : toute l’endurance restait pour les roulades.');
}
// (soulslike) Dernier souffle en JcJ / zone rouge : recharge doublée (question ouverte tranchée).
{
  const n = tn('ks_dernier_souffle');
  n.effects.find((e) => e.stat === 'cheatDeath').value.cdPvpS = 240;
  n.desc = "Une fois toutes les 120 s (240 s contre un joueur), un coup mortel vous laisse à 1 PV avec 0,6 s d'invulnérabilité et 30 d'endurance. En contrepartie : −12 % de PV maximum.";
  tk('ks_dernier_souffle').upside = "Survit à un coup mortel toutes les 120 s (240 s en JcJ) : 1 PV, 0,6 s d'invulnérabilité, 30 d'endurance.";
  critic('ks_dernier_souffle', 'recharge 240 s contre un joueur', 'En zone rouge, une seconde vie garantie par combat décidait trop de duels.');
}
// (soulslike) Attaque sautée : la recharge de l'attaque de base ne repart qu'à la fin de la réception (sinon +30 à +70 % de DPS gratuit).
{
  const a = ta('attaque_sautee');
  a.cdStartsAfterLanding = true;
  a.souls = a.souls.replace("Relance la recharge de l'attaque de base.", "Comme l'Attaque chargée, la recharge de l'attaque de base ne repart qu'après la réception : ce n'est pas un gain de DPS, c'est un outil de déséquilibre et d'esquive des rasants.");
  critic('attaque_sautee', 'recharge de l’attaque de base après la réception', 'Sauter à chaque attaque donnait ×1,3 (×1,7 avec Frappe plongeante) de DPS et une zone pour 20 d’endurance.');
}
// (soulslike) Éventail à distance : un même ennemi n'est touché que par un projectile.
{
  const n = tn('sv_eventail');
  const e = n.effects.find((x) => x.mod === 'attaque_chargee.projCount');
  e.oneHitPerTarget = true;
  critic('sv_eventail', 'un seul projectile par cible', 'À bout portant, les 3 projectiles ×0,6 touchaient la même cible : ×1,8 de plus que la charge normale.');
}
// (accessibilité) Les variantes de Survie disent leurs chiffres (les autres régions le faisaient déjà).
const SURVIE_DESC = {
  sv_frappe_plongeante: "Attaque sautée : ×1,3 → ×1,7, déséquilibre ×1,5 → ×2,5, zone 1,5 → 2,5 m (projectile : explosion de 1,5 m) ; réception 0,3 → 0,45 s, à 20 % de vitesse.",
  sv_envol: 'Saut : 0,35 → 0,55 s en l’air, distance ×1,4, réception 0,1 → 0,05 s ; coûte 3 d’endurance de plus (18).',
  sv_course_vent: 'Hors combat depuis 5 s, le sprint passe de ×1,45 à ×1,65 (voyage). En combat, sprint normal.',
  sv_elan: "Après 0,8 s de sprint, l'attaque de base devient un Assaut : bond de 3 m vers la cible, ×1,4, +25 de déséquilibre, +10 d'endurance, récupération 0,45 s.",
  sv_course_feutree: 'Sprint ×1,45 → ×1,35 mais −30 % d’endurance par seconde, et les monstres vous remarquent à 60 % de leur distance habituelle.',
  sv_charge_vive: 'Attaque chargée pleine en 0,8 s au lieu de 1,2 s ; puissance max ×1,8 → ×1,55, déséquilibre max ×2 → ×1,6.',
  sv_eventail: "Attaque chargée : arc de 180° en mêlée ; à distance, 3 projectiles en éventail de 30° (×0,6 de la charge chacun, un seul par ennemi) ; déséquilibre par cible −40 %.",
  sv_charge_ecrasante: 'Attaque chargée pleine en 1,6 s ; puissance max ×2,2, déséquilibre ×3, super-armure 0,5 s ; récupération 0,5 → 0,7 s.',
  sv_garde_fer: 'Garde : −35 % d’endurance par coup bloqué, +15 points de réduction (plafonds inchangés), mais on se déplace à 35 % au lieu de 55 %.',
  sv_parade: 'Lever la garde dans les 180 ms avant l’impact annule le coup, inflige 60 de déséquilibre et donne Contre parfait 1,5 s (prochain coup ×2, ×1,5 à distance). Garde levée en 0,25 s au lieu de 0,15 s.',
  sv_egide: 'La garde devient un demi-dôme de 180° qui réduit TOUS les dégâts de 75 %, sorts compris ; −20 % d’endurance par coup bloqué, mais 6 mana par coup.',
  sv_roulade_lourde: 'Roulade de 4 m en 0,65 s (invulnérable à partir de 50 ms), 34 d’endurance ; +50 d’Équilibre pendant 0,4 s après, poids d’armure ignoré, 15 de déséquilibre à 1,5 m à l’arrivée.',
  sv_pas_ombre: 'La roulade devient un bond d’ombre de 3 m en 0,15 s : invulnérable 0,2 s (au lieu de 0,35 s), 22 d’endurance, action possible après 0,25 s, recharge 0,5 s.',
};
for (const [id, d] of Object.entries(SURVIE_DESC)) tn(id).desc = d;
critic('survie (13 variantes)', 'descriptions chiffrées', 'Les variantes de Survie étaient seulement qualitatives (« bien plus fort ») : impossible à comparer sans wiki.');
// (accessibilité) Noms en double entre deux nœuds différents.
const RENAME_NODE = {
  gu_md_elan: 'Enchaînement',
  gu_ga_garde_de_fer: 'Poigne de fer',
  ro_ve_entaille_profonde: 'Lame barbelée',
  ro_ti_point_faible: 'Défaut de la cuirasse',
  ro_ve_contagion: 'Épidémie',
};
for (const [id, name] of Object.entries(RENAME_NODE)) {
  critic(id, `${tn(id).name} → ${name}`, 'Même nom qu’un autre nœud (Élan, Garde de fer, Entaille profonde, Point faible, Contagion).');
  tn(id).name = name;
  const k = tk(id);
  if (k) k.name = name;
}
// (accessibilité) Parcours conseillé des niveaux 2 à 10, un par classe (bouton « Suivre le parcours conseillé »).
tree.rules.guide = {
  text: "À chaque montée de niveau jusqu'au niveau 10, la fenêtre propose le prochain nœud du parcours conseillé de la classe (un clic : « Apprendre »). Le joueur peut toujours choisir autre chose ; le parcours reprend au nœud suivant encore libre. Réinitialisation gratuite jusqu'au niveau 10.",
  paths: {
    warrior: [
      { level: 2, nodes: ['fond_roulade'], why: 'Esquiver les coups télégraphiés.' },
      { level: 3, nodes: ['fond_garde'], why: 'Bloquer les coups de face.' },
      { level: 4, nodes: ['fond_sprint'], why: 'La région du Guerrier s’ouvre.' },
      { level: 5, nodes: ['gu_coup_puissant', 'gu_ga_cri'], why: 'Un gros coup et un soin.' },
      { level: 6, nodes: ['gu_be_tourbillon'], why: 'Contre les groupes.' },
      { level: 7, nodes: ['fond_charge'], why: 'Briser les postures.' },
      { level: 8, nodes: ['fond_saut'], why: 'Sauter les ondes de choc.' },
      { level: 9, nodes: ['gu_frappe_eclair'], why: 'Première variante de la Frappe.' },
      { level: 10, nodes: ['sv_seuil_acier', 'sv_alchimiste'], why: 'Plus de PV et des potions plus fortes. Ensuite : choisissez Gardien, Berserker ou Maître d’armes.' },
    ],
    mage: [
      { level: 2, nodes: ['fond_roulade'], why: 'Esquiver les coups télégraphiés.' },
      { level: 3, nodes: ['fond_sprint'], why: 'Garder ses distances.' },
      { level: 4, nodes: ['fond_saut'], why: 'La région du Mage s’ouvre.' },
      { level: 5, nodes: ['ma_fireball', 'ma_heal'], why: 'Dégâts de zone et soin.' },
      { level: 6, nodes: ['ma_frost_nova'], why: 'Repousser ce qui vous colle.' },
      { level: 7, nodes: ['ma_v_bolt_feu'], why: 'Le Trait arcanique devient Trait de feu.' },
      { level: 8, nodes: ['fond_charge'], why: 'Un trait chargé pour briser les postures.' },
      { level: 9, nodes: ['sv_seuil_arcanes'], why: 'Plus de mana.' },
      { level: 10, nodes: ['sv_recuperation', 'sv_souplesse'], why: 'Endurance. Ensuite : choisissez Pyromancie, Givre ou Arcanes.' },
    ],
    ranger: [
      { level: 2, nodes: ['fond_roulade'], why: 'Esquiver les coups télégraphiés.' },
      { level: 3, nodes: ['fond_sprint'], why: 'Garder ses distances.' },
      { level: 4, nodes: ['fond_saut'], why: 'La région du Rôdeur s’ouvre.' },
      { level: 5, nodes: ['ro_ti_main_sure', 'ro_ti_tir_percant'], why: 'Plus de dégâts et un tir qui traverse.' },
      { level: 6, nodes: ['ro_ti_tir_rapide'], why: 'Une rafale de trois flèches.' },
      { level: 7, nodes: ['fond_charge'], why: 'Bander l’arc pour un gros tir.' },
      { level: 8, nodes: ['ro_ti_oeil_exerce'], why: 'Plus de critiques.' },
      { level: 9, nodes: ['ro_ti_pluie'], why: 'Une zone contre les groupes.' },
      { level: 10, nodes: ['sv_seuil_bois', 'sv_peau'], why: 'Critique et résistances. Ensuite : choisissez Tireur, Traqueur ou Venin.' },
    ],
  },
};
critic('rules.guide', 'parcours conseillé niveaux 2 à 10 pour chaque classe', 'Un nouveau joueur ne peut pas lire 318 nœuds : un clic par niveau suffit, sans wiki.');
tree.meta.criticChanges = criticChanges;

// migration presets: 3rd Fondamental + cheapest path to the v0.2 abilities (+ Trait de feu for mages)
const V02 = {
  warrior: { fond: 'fond_garde', targets: ['gu_coup_puissant', 'gu_ga_cri', 'gu_be_tourbillon'] },
  mage: { fond: 'fond_saut', targets: ['ma_fireball', 'ma_v_bolt_feu', 'ma_frost_nova', 'ma_heal'] },
  ranger: { fond: 'fond_saut', targets: ['ro_ti_tir_percant', 'ro_ti_tir_rapide', 'ro_ti_pluie'] },
};
tree.migration = { presets: {} };
for (const cls of Object.keys(V02)) {
  const owned = new Set(['coeur', CLASS_START[cls], ...rules.migration.gift, V02[cls].fond]);
  const alloc = [V02[cls].fond];
  for (const t of V02[cls].targets) {
    const p = cheapestPath(tree, cls, owned, t);
    if (!p) {
      warnings.push(`préréglage ${cls}: ${t} inaccessible`);
      continue;
    }
    for (const id of p.path) {
      owned.add(id);
      alloc.push(id);
    }
  }
  const cost = alloc.reduce((s, id) => s + nodeCost(tree.nodes.find((n) => n.id === id), cls), 0);
  tree.migration.presets[cls] = { nodes: alloc, cost };
}
rules.migration.legacyFloor = Object.fromEntries(Object.entries(tree.migration.presets).map(([c, p]) => [c, p.cost]));
rules.migration.text = rules.migration.text.replace('Guerrier 4, Mage 5, Rôdeur 6', `Guerrier ${rules.migration.legacyFloor.warrior}, Mage ${rules.migration.legacyFloor.mage}, Rôdeur ${rules.migration.legacyFloor.ranger}`);

// effect vocabulary (every stat used, with its French description)
const usedStats = new Set();
for (const n of tree.nodes) for (const e of n.effects) if (e.stat) usedStats.add(e.stat);
tree.effectVocabulary = {
  ops: { add: 'ajoute la valeur', mul: 'ajoute à un multiplicateur : valeur finale = base × (1 + Σ mul)', set: 'remplace la valeur (variantes)', pct: '(non utilisé : converti en stat…Pct + add)' },
  mods: '"<idCapacité>.<champ>" modifie un champ de la capacité ; "unlock" débloque la capacité value.',
  flags: { perRank: 'multiplié par le rang', atRank: 'seulement à partir du rang n', cap: 'borne', final: 'appliqué en dernier (clés de voûte)', when: 'condition (famille d’arme, main gauche, PV…)' },
  stats: Object.fromEntries([...usedStats].sort().map((s) => [s, describeStat(s)])),
};

fs.writeFileSync(path.join(DESIGN, 'skilltree.json'), JSON.stringify(tree, null, 1) + '\n');
console.log(`skilltree.json : ${tree.nodes.length} nœuds, ${tree.abilities.length} capacités, ${tree.exclusiveGroups.length} groupes, ${tree.keystones.length} clés de voûte`);
for (const j of junctionLog) console.log('  jonction', j);
console.log(`  ${nudged.length} feuille(s) déplacée(s) :`, nudged.join(' ; '));
console.log('  préréglages v0.2 :', JSON.stringify(tree.migration.presets));
if (warnings.length) {
  console.log(`${warnings.length} avertissement(s) :`);
  for (const w of warnings) console.log('  - ' + w);
}
