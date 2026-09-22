// NPC interactions: dialogs, quests (accept / turn in) and the merchant shop (buy / sell).
import { ITEMS, QUESTS, INV_SIZE } from '../../../shared/data.js';
import { S2C, INTERACT_RANGE } from '../../../shared/protocol.js';
import { DIALOG_CLOSE_DIST, INTERACT_TOLERANCE } from '../config.js';
import { dialogQuests, acceptQuest, checkTurnIn, rewardItems, completeQuest, isQuest } from '../quests.js';
import { addItem, canAdd, canAddAll, removeAt, formatItem } from '../inventory.js';
import { dist, isId, isInt, isStr } from '../util.js';
import { grantXp, giveItem, giveGold } from './players.js';

export function openDialog(game, p, npc, text) {
  p.dialogNpc = npc.id;
  game.send(p, {
    t: S2C.DIALOG,
    id: npc.id,
    npc: npc.key,
    name: npc.name,
    text: text || npc.def.greeting,
    quests: dialogQuests(p.quests, p.level, npc.key),
    shop: npc.isShop ? [...npc.def.shop] : null,
  });
}

export function closeDialog(game, p) {
  if (!p.dialogNpc) return;
  p.dialogNpc = 0;
  game.send(p, { t: S2C.CLOSE_DIALOG });
}

/** Close the dialog when the player walked more than DIALOG_CLOSE_DIST away from the NPC. */
export function checkDialogDistance(game, p) {
  if (!p.dialogNpc) return;
  const npc = game.npcs.get(p.dialogNpc);
  if (!npc || dist(p.x, p.z, npc.x, npc.z) > DIALOG_CLOSE_DIST) closeDialog(game, p);
}

/** Resolve an NPC for a dialog action (quest / shop). Sends the error and returns null when refused. */
function actionNpc(game, p, id, needShop) {
  if (!isId(id)) { game.error(p, 'bad_request', 'Requête invalide.'); return null; }
  if (p.dead) { game.error(p, 'dead', 'Vous êtes mort.'); return null; }
  const npc = game.npcs.get(id);
  if (!npc) { game.error(p, 'bad_target', 'Personnage introuvable.'); return null; }
  // The dialog stays open up to DIALOG_CLOSE_DIST, so actions are allowed within that distance.
  if (dist(p.x, p.z, npc.x, npc.z) > DIALOG_CLOSE_DIST + 0.5) { game.error(p, 'too_far', 'Trop loin'); return null; }
  if (needShop && !npc.isShop) { game.error(p, 'bad_target', 'Ce personnage ne fait pas de commerce.'); return null; }
  return npc;
}

export function handleInteract(game, p, msg) {
  if (!isId(msg.id)) return game.error(p, 'bad_request', 'Requête invalide.');
  if (p.dead) return game.error(p, 'dead', 'Vous êtes mort.');
  const npc = game.npcs.get(msg.id);
  if (!npc) {
    const e = game.entities.get(msg.id);
    return game.error(p, e ? 'bad_target' : 'no_target', e ? 'Vous ne pouvez pas parler à cette cible.' : 'Personnage introuvable.');
  }
  if (dist(p.x, p.z, npc.x, npc.z) > INTERACT_RANGE + INTERACT_TOLERANCE) return game.error(p, 'too_far', 'Trop loin');
  openDialog(game, p, npc);
}

export function handleQuestAccept(game, p, msg) {
  const npc = actionNpc(game, p, msg.id, false);
  if (!npc) return;
  if (!isStr(msg.q, 64) || !isQuest(msg.q)) return game.error(p, 'bad_request', 'Quête inconnue.');
  const err = acceptQuest(p.quests, p.level, npc.key, msg.q);
  if (err) return game.error(p, 'bad_request', err);
  p.markDirty('quests');
  game.notify(p, 'quest', `Quête acceptée : ${QUESTS[msg.q].name}`);
  game.store?.markDirty();
  openDialog(game, p, npc);
}

export function handleQuestTurnin(game, p, msg) {
  const npc = actionNpc(game, p, msg.id, false);
  if (!npc) return;
  if (!isStr(msg.q, 64) || !isQuest(msg.q)) return game.error(p, 'bad_request', 'Quête inconnue.');
  const q = QUESTS[msg.q];
  const err = checkTurnIn(p.quests, npc.key, msg.q);
  if (err) return game.error(p, 'bad_request', err);
  const items = rewardItems(msg.q, p.cls);
  if (!canAddAll(p.inv, items)) return game.error(p, 'inv_full', 'Inventaire plein : libérez de la place pour recevoir la récompense.');
  completeQuest(p.quests, msg.q);
  p.markDirty('quests');
  game.notify(p, 'quest', `Quête terminée : ${q.name}`);
  giveGold(game, p, q.reward.gold || 0);
  for (const [id, qty] of items) giveItem(game, p, id, qty);
  grantXp(game, p, q.reward.xp || 0);
  game.store?.markDirty();
  game.log.info(`${p.name} termine la quête « ${q.name} »`);
  openDialog(game, p, npc, q.done);
}

export function handleBuy(game, p, msg) {
  const npc = actionNpc(game, p, msg.id, true);
  if (!npc) return;
  if (!isStr(msg.item, 64) || !npc.def.shop.includes(msg.item)) return game.error(p, 'bad_request', 'Cet objet n\'est pas en vente ici.');
  const qty = msg.qty === undefined || msg.qty === null ? 1 : msg.qty;
  if (!isInt(qty, 1, 20)) return game.error(p, 'bad_request', 'Quantité invalide.');
  const item = ITEMS[msg.item];
  const cost = item.price * qty;
  if (p.gold < cost) return game.error(p, 'no_gold', 'Pas assez d\'or.');
  if (!canAdd(p.inv, msg.item, qty)) return game.error(p, 'inv_full', 'Inventaire plein');
  p.gold -= cost;
  addItem(p.inv, msg.item, qty);
  p.markDirty('gold', 'inv');
  game.notify(p, 'gold', `Vous avez acheté : ${formatItem(msg.item, qty)} (−${cost} or)`);
  game.store?.markDirty();
}

export function handleSell(game, p, msg) {
  const npc = actionNpc(game, p, msg.id, true);
  if (!npc) return;
  if (!isInt(msg.slot, 0, INV_SIZE - 1)) return game.error(p, 'bad_request', 'Emplacement invalide.');
  const s = p.inv[msg.slot];
  if (!s) return game.error(p, 'bad_request', 'Emplacement vide.');
  const qty = msg.qty === undefined || msg.qty === null ? s.q : msg.qty;
  if (!isInt(qty, 1, s.q)) return game.error(p, 'bad_request', 'Quantité invalide.');
  const item = ITEMS[s.id];
  if (!(item.sell > 0)) return game.error(p, 'cant_use', 'Cet objet ne peut pas être vendu.');
  const id = s.id;
  removeAt(p.inv, msg.slot, qty);
  const gain = item.sell * qty;
  p.gold += gain;
  p.markDirty('gold', 'inv');
  game.notify(p, 'gold', `Vous avez vendu : ${formatItem(id, qty)} (+${gain} or)`);
  game.store?.markDirty();
}
