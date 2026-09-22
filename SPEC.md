# Brumeval Online — Technical specification

A small but complete **multiplayer browser MMORPG**: Node.js authoritative game server + Three.js client,
with every 3D model and icon generated procedurally by **Blender 5.0.1 (headless Python / bpy)**.
All player-facing text is **French**.

> The files in `shared/` are the contract between the server, the client and the assets. They are already
> written and tested. **Do not change their exported names or semantics.** If you find a real bug in `shared/`,
> fix it minimally and say so in your final report.
> - `shared/protocol.js` — every network message, field and constant (read it fully).
> - `shared/data.js` — classes, abilities, monsters, items, NPCs, quests, formulas (`playerStats`, `computeDamage`, …).
> - `shared/world.js` — terrain height, roads, lakes, regions, spawn zones, NPC placement, `generateWorldObjects()`.
> - `shared/collision.js` — `CollisionWorld` (static circle obstacles; used by client AND server).
> - `shared/noise.js` — deterministic RNG / noise.

## 1. Stack & layout

| Path | Owner | Content |
|---|---|---|
| `shared/` | architect (done) | Pure ES modules, no dependencies, imported by both sides |
| `server/` | server agent | Node 22 ESM, only dependency `ws` (installed). `server/src/index.js` entry |
| `tests/` | server agent | `tests/bot.mjs` end-to-end headless multiplayer test |
| `client/` (except `client/src/ui/`) | client-core agent | Vite 8 + three 0.186 (installed). `client/index.html`, `client/src/**` |
| `client/src/ui/` | client-ui agent | DOM/CSS HUD, menus, panels. Public API in §5 |
| `assets/blender/common.py` | architect (done) | bpy helpers: materials, primitives, `export_glb`, `render_preview`, `render_icon` |
| `assets/blender/<group>/build.py` | one asset agent per group | Builds that group's models/icons |
| `client/public/models/*.glb` | asset agents (generated) | Loaded by the client at `/models/<key>.glb` |
| `client/public/icons/*.png` | icons agent (generated) | `/icons/<key>.png` |
| `client/public/ui/*.png` | characters agent (generated) | Class portraits for the UI |
| `assets/previews/*.png` | asset agents (generated) | Preview renders for humans/review |

Imports: server uses relative paths (`../../shared/data.js`); the client uses the Vite alias `@shared/…`
(`import { ITEMS } from '@shared/data.js'`). Everything is ESM.

Commands (repo root):
- `npm run dev` → game server on :3000 + Vite on :5173 (proxy `/ws` → :3000). Play at http://localhost:5173
- `npm run build` → `client/dist`; `npm start` → server on :3000 also serves `client/dist` (play at http://localhost:3000)
- `npm run assets [-- <group>…] [--only k1,k2] [--no-preview]` → runs Blender for each group
- `npm run inspect -- client/public/models/*.glb` → GLB summary (bbox, tris, bones, animations)
- `npm test` → server unit tests (`node --test server/test/`) + `node tests/bot.mjs`

Blender: `C:\Program Files\Blender Foundation\Blender 5.0\blender.exe` (env `BLENDER` overrides).
Run one group: `"<blender>" --background --factory-startup --python-exit-code 1 --python assets/blender/<group>/build.py -- [--only k] [--no-preview]`.

## 2. Game design (summary)

- **Accounts**: name + password (scrypt-hashed server-side). Registration creates a character of a class:
  `warrior` (Guerrier), `mage` (Mage), `ranger` (Rôdeur). Persistence in `server/data/accounts.json`.
- **World**: one 360×360 m open zone (`shared/world.js`): safe village *Brumeval* in the centre (NPCs, well,
  houses, fence ring), dirt roads to the east plains (slimes), SW prairie (slimes), north forest (wolves),
  west goblin camp, NE graveyard (skeletons) and the golem boss lair beyond it. Lakes, mountains at the edge.
- **Combat**: tab/click targeting, auto-attack (ability slot 0) + 3 abilities (slots 1-3, keys 2-4) with mana
  and cooldowns; projectiles with travel time; area effects; crits; slow. Monsters aggro, chase, leash, respawn.
  The golem boss has a periodic area slam. No PvP. No combat inside the village.
- **Progression**: XP & levels (max 20, `xpToNext`), gold, loot (drops go straight to the inventory),
  24-slot inventory, weapon + armor slots with class/level restrictions, merchant (buy/sell), potions.
- **Quests**: chain of 5 kill quests from *Ancien Aldric* (`shared/data.js` QUESTS).
- **Social**: global chat, whispers (`/w nom message`), `/who`, `/help`, player names above heads, online count.
- **Day/night** cycle driven by server `tod` (0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset).

## 3. Conventions

- Units: metres. Ground plane (x, z), Y up. North = −Z (top of minimap).
- **Yaw**: `ry = Math.atan2(dirX, dirZ)`; `ry = 0` faces +Z. In Three.js: `object.rotation.y = ry`.
- Models are authored in Blender facing **−Y**, which the glTF exporter turns into **+Z** → a loaded model with
  `rotation.y = ry` faces the right way with no extra offset.
- Model origin at the feet / base centre (y = 0 is the ground). Humanoids ≈ 1.8 m tall.
- Entity y on the client = `terrainHeight(x, z)` (from `shared/world.js`).

## 4. Server requirements (`server/`)

Architecture is up to you, but keep it modular (e.g. `index.js`, `net.js`, `game.js`, `entities/`, `systems/combat.js`,
`systems/ai.js`, `quests.js`, `inventory.js`, `persistence.js`, `auth.js`, `chat.js`). It must:

1. Export `startServer({ port = 3000, dataDir = 'server/data', staticDir = 'client/dist', quiet = false })`
   → `Promise<{ port, close() }>` (port 0 = random, used by tests). `node server/src/index.js` starts it
   (`PORT` env var respected) and logs the URL.
2. One `http` server: WebSocket (`ws`, `maxPayload` 8 KB) on path `/ws`; static files from `staticDir` for every
   other path (index.html fallback, correct MIME types incl. `.glb` → `model/gltf-binary`, `.js`, `.css`, `.png`,
   `.svg`, `.json`, `.woff2`), path-traversal safe. If `staticDir` is missing, answer with a small French HTML page
   telling to run `npm run build` or use `npm run dev`.
3. Fixed tick loop at `TICK_RATE` (20 Hz); `snap` every `SNAPSHOT_EVERY` ticks per client, with area-of-interest
   (`VIEW_RADIUS`) and the delta rule for static fields (`k n m lv c sc b mt nk` only on first sight or change);
   `gone` for entities that left the AOI or were removed. `tod` from `DAY_LENGTH_S`; `on` = players online.
4. **Auth**: validate name `^[A-Za-zÀ-ÖØ-öø-ÿ0-9_]{3,16}$` (case-insensitive uniqueness), password 4-64 chars,
   class id. scrypt + random salt + `timingSafeEqual`. One session per account (`already_online`). Messages other
   than register/login/ping before auth are ignored. New character: level 1, `START_GOLD`, class start gear
   equipped + start items, position `SPAWN_POINT`.
5. **Persistence**: atomic JSON writes (tmp + rename) of all accounts every 30 s, on logout/disconnect and on
   shutdown (SIGINT). Save: level, xp, gold, hp, mp, inv, eq, quests, x, z (dead → saved at spawn).
6. **Movement validation**: accept `move` if the distance since the last accepted position ≤
   `speed × elapsed × 1.35 + 0.6` (elapsed capped at 1 s), destination `isWalkable`, and
   `CollisionWorld.penetration(x, z, PLAYER_RADIUS) < 0.15`. Otherwise keep the old position and send `correct`
   (at most one per 250 ms). Dead players cannot move. Track `s` = MOVE for 250 ms after a real move.
7. **Monsters**: spawn `SPAWN_ZONES` at random free points of their zone, level random in `MONSTERS[t].level`.
   AI states idle/wander (slow random walk inside the zone) → aggro when a live player is within `aggro` m
   (0 = passive until attacked) → chase (use `CollisionWorld.move` in ≤ 1 m steps, never enter `VILLAGE` circle)
   → attack in `range` every `atkCd` s → leash back (full heal, invulnerable while returning) when farther than
   `zone.r + 18` from its zone centre or its target is dead/gone/in the village. Threat: attack whoever dealt the
   most damage. Death: `death` event, XP to every player who damaged it (full XP to each, `monsterXp`),
   gold+drops to the killer (top damage dealer), quest kill credit to every damager with the quest active; corpse
   for `CORPSE_TIME_S` then removed; respawn after `respawn` s as a NEW entity id. Golem `slam` hits all players
   within `radius` every `cd` s while in combat (send `fx` AOE). Slow (`sl`) halves speed for its duration.
8. **Abilities**: validate slot, target (alive, hostile monster, within `range` + 0.5 m of the attacker's server
   position), mana, cooldown (server authoritative; send `cd` to the caster on success), not in village
   (`safe_zone` error). Kinds: `melee` (instant damage + `fx` SWING), `projectile` (`fx` CAST + PROJ with
   `ms = dist / speed × 1000`, damage applied when it lands if the target is still alive; `hits` > 1 = repeat
   every 250 ms), `aoe_self` (all monsters within `radius`; `fx` AOE; frost nova applies slow), `aoe_target`
   (needs x,z within `range`; all monsters within `radius` of that point), `self_heal`.
   Slot 0 (`auto`) also sets the auto-attack target: the server keeps swinging whenever it is off cooldown and
   in range, until the target dies, `stop` is received, or another target is chosen. Damage =
   `computeDamage(atk, power, def, crit, rand, rand)`. Every damage → `dmg` to all clients in AOI of the target.
   Players die at 0 hp (`death`), can `respawn` (any time while dead) at `SPAWN_POINT` with full hp/mp.
9. **Regen** per `REGEN` (out of combat after `restDelay` s). **Level-up**: `fx` LEVEL, full heal, `notify`
   'level', system chat to everyone "X a atteint le niveau N !".
10. **Items**: `use_item` (potion: heal/mana, `heal` event; equipment → equip), `equip`/`unequip` with class/level
    checks (`canUse`), stacking up to `stack`, `inv_full` handling (loot that doesn't fit is lost with a notify),
    `drop`. Recompute stats (`playerStats`) on equipment/level change; clamp hp/mp.
11. **NPCs**: NPC entities from `NPC_SPAWNS` (kind npc, `nk` = key, `m` = model). `interact` within
    `INTERACT_RANGE` → `dialog` with quest states for this player (available = requirements met & level ≥ `lvl`;
    active; ready = count reached; done quests omitted) and `shop` list for merchants. `quest_accept`,
    `quest_turnin` (rewards: xp, gold, items, `classItem[cls]`), `buy` (price × qty, `no_gold`), `sell` (item
    `sell` × qty; not equipped items; must be near a shop NPC). Send `close_dialog` when the player moves > 8 m
    away from the NPC they talked to. After each change send the relevant `self` partial + a French `notify`.
    Quest kill progress → `notify` kind 'quest' ("Gluants éliminés : 3/8") and `self.quests`.
12. **Chat**: trim, max `CHAT_MAX_LEN`, rate limit 5 messages / 5 s (`err` rate_limit), global broadcast
    `{ch:'global', from, text}`; `/w nom msg` → `whisper_in` to target and `whisper_out` echo to sender (error if
    offline); `/who`; `/help` (French). Join/leave system messages.
13. **Robustness**: every field type-checked (finite numbers, integer slots in range, strings); unknown types
    ignored; > 60 messages/s → `kick`; exceptions in one handler never crash the server; clean disconnect removes
    the player entity (`gone` to others) and saves.
14. **Tests**: `server/test/*.test.js` (node:test) for formulas/inventory/movement validation/quest logic, and
    `tests/bot.mjs`: starts the server on port 0 with a temp data dir, connects 2 bots (register A and B),
    asserts `auth_ok`, B sees A in `snap`, global chat and whisper delivery, A walks legitimately (small steps at
    real speed) to the east slime zone, kills a slime with ability 0 (auto-attack) and gets `xp`, A talks to the
    elder, accepts `q_slimes` and sees quest progress on a kill, buys a potion from the merchant, a speed-hack
    `move` gets `correct`, relogin after disconnect keeps level/xp/gold. Exit code 0 on success, 1 on failure,
    total runtime < 90 s.

## 5. Client

### 5.1 client-core (`client/index.html`, `client/src/**` except `ui/`)

Files (suggested): `main.js` (bootstrap/wiring), `net.js`, `state.js` (self state merge, entity store,
snapshot buffer), `render/scene.js` (renderer, lights, sky, fog, day/night), `render/terrain.js`,
`render/worldObjects.js` (instanced static objects), `render/assets.js` (GLTF cache + fallbacks),
`render/entities.js` (models, animation mixers, nameplates, hp bars, selection ring), `render/effects.js`
(projectiles, AOE rings, heal sparkles, level-up, floating damage numbers), `game/player.js` (local movement +
collision + camera-relative input), `game/camera.js`, `game/input.js`, `game/targeting.js`, `audio.js`
(optional WebAudio-synthesised SFX).

Requirements:
- `index.html`: `<canvas id="game">` full-screen + `<div id="ui-root">` overlay; title "Brumeval Online";
  French `lang`. `main.js` calls `createUI(document.getElementById('ui-root'), handlers)` from `./ui/index.js`.
- Loading screen via `ui.setLoading(p, text)` while GLBs load (`/models/<key>.glb` for every model key used in
  `shared/data.js` + `OBJECT_TYPES`). **Every model must have a fallback** (coloured primitive: capsule for
  humanoids, blob for slime, box for props…) if the GLB is missing or fails — the game must be playable with zero
  assets.
- Renderer: WebGL, antialias, sRGB output, ACES tone mapping, PCF soft shadows (one directional sun following the
  player, shadow camera ±60 m), hemisphere light, exponential fog, gradient sky dome with sun/moon and night stars,
  day/night driven by `tod` (smooth colour/intensity interpolation). `devicePixelRatio` capped at 2.
- Terrain: single mesh over `[-WORLD_HALF, WORLD_HALF]` at `TERRAIN_STEP` using `terrainHeight`, vertex colours
  (grass tones via noise, darker forest floor inside the forest region, dirt on `roadDistance` < `ROAD_WIDTH/2`
  and in camps, grey-ish graveyard, sand near water, rock on steep slopes & mountains, snow on peaks). Water
  plane at `WATER_LEVEL` (transparent, slightly animated). Flat shading or smooth — keep it pretty.
- World objects: `generateWorldObjects()` → one `InstancedMesh` per (type, sub-mesh) for everything (≈ 960
  objects), y = `terrainHeight`, `rotation.y = ry`, uniform scale `s`, cast/receive shadows. Lamp posts and the
  campfire emit a warm glow at night (a few `PointLight`s near the player at most, or emissive only).
- Entities: from `snap`. Skinned models cloned with `SkeletonUtils.clone`, one `AnimationMixer` each, clips by
  name (`Idle`, `Walk`, `Attack`, `Cast`, `Hit`, `Death`; missing clips tolerated). Locomotion: Walk when moving
  (timeScale ∝ speed), Idle otherwise, cross-fades 0.15 s; one-shots on `fx` SWING (Attack), CAST (Cast), `dmg`
  taken (Hit, not while attacking), `death` (Death, clamped). Monsters use `sc` scale. Remote entities
  interpolated `INTERP_DELAY_MS` in the past (position lerp, shortest-arc yaw). Dead monsters fade/sink after
  `death`, removed on `gone`. Dispose clones on removal (no leaks).
- Nameplates above heads (name + level; hp bar for monsters/players when damaged or targeted; colour: self
  white, players light blue, NPC gold, monsters by level difference grey/green/yellow/orange/red; bosses bigger).
  NPC quest markers: gold "!" above the elder when a quest is available for the player, "?" when one is ready
  (compute from `self.quests` + `QUESTS` + level).
- Local player: movement is client-simulated with `CollisionWorld.move` (same as server) at `self.stats.speed`
  (×0.5 while slowed? no — slow applies to monsters only), camera-relative **WASD / ZQSD via `KeyboardEvent.code`**
  (KeyW/KeyA/KeyS/KeyD so AZERTY works) + arrows; character turns to face movement; send `move` at most
  `MOVE_SEND_HZ` while moving and once when stopping; apply `correct` immediately. Ignore gameplay keys when
  `ui.isTyping()`. No movement while dead.
- Camera: third person orbit — right-mouse drag (or left-drag on empty ground) rotates yaw/pitch, wheel zooms
  (3–28 m), smoothing, never below terrain. Pointer events on the canvas only (UI panels sit above it).
- Targeting & actions: left-click an entity → select (raycast against invisible hit cylinders); left-click an NPC
  in range → `interact` (out of range → `ui.notify('Trop loin', 'error')`); right-click a monster → select +
  ability slot 0; `Tab` cycles the nearest hostile monsters in front; `Escape` clears target; keys `1-4` →
  ability slots 0-3 (slot for `aoe_target` uses the selected target's position, else the point under the mouse);
  `5` = best HP potion, `6` = mana potion (`use_item`). Keep the selected target's frame updated via `ui.setTarget`.
  Selection ring decal under the target (red hostile / gold NPC / blue player). Client-side pre-checks
  (range/mana/cooldown) only for instant feedback; the server decides.
- Effects on `fx`/`dmg`/`heal`/`death`: fire projectiles (glowing sphere + point light + particle trail), arrows,
  AOE rings (fire/frost/arrow rain/golem slam), heal sparkles, level-up golden pillar, hit flash, floating
  combat text (white, yellow crits, red on self, green heals) — CSS2D or sprites, pooled.
- Networking: `ws(s)://<host>/ws`; reconnect screen on close (`ui.showLogin(true)` + error). `ping` every 2 s →
  `ui.setStatus({ping, fps, online})`. Zone change → `ui.showZone(regionAt(x,z).name)`.
  Minimap feed at 5 Hz → `ui.updateMinimap(...)`.
- Dev convenience: URL `?autologin=Nom&cls=mage` registers (password `test1234`) or logs in automatically.
  Expose `window.__game` (state, scene, camera, entity store) for debugging/tests.
- Performance: 60 fps with ~50 entities on a mid laptop; reuse geometries/materials; frustum culling; no per-frame
  allocations in hot loops.

### 5.2 client-ui (`client/src/ui/`) — public API (must match exactly)

`client/src/ui/index.js` exports `createUI(root, handlers)` and returns an object with these methods.
The UI builds its own DOM inside `root` and imports its own CSS (`import './ui.css'`). Fonts via CSS `@import`
from Google Fonts (e.g. "Cinzel" titles, "Nunito"/"Inter" body) with safe fallbacks. It may import from
`@shared/*.js` for static data (names, descriptions, icons, prices, quest texts, world layout for the minimap).

`handlers` (implemented by core, called by the UI):
```
login(name, password)            register(name, password, cls)
chat(text)                       ability(slot)                 // action bar click, slot 0..3
useItem(slot)  equip(slot)  unequip(eqSlot)  drop(slot)  sell(slot)     // sell only while a shop dialog is open
buy(npcId, itemId)               acceptQuest(npcId, questId)   turnInQuest(npcId, questId)
respawn()                        closeDialog()
```
Methods (called by core):
```
setLoading(progress|null, text?)   // 0..1 progress bar; null hides the loading screen
showLogin(show)                    // login / character-creation screen
setLoginError(msg|null)            setLoginBusy(busy)
setSelf(self)                      // full SelfState after every merge (see shared/protocol.js)
setTarget(t|null)                  // { id, name, level, hp, mhp, kind:'monster'|'player'|'npc', boss, hostile }
setCooldown(slot, ms)              // start a cooldown sweep of ms on action slot 0..3
addChat({ ch, from, to, text })    // ch: global | whisper_in | whisper_out | system
notify(text, kind)                 // kind: info|error|xp|loot|quest|level|gold — toast + chat log line
showDialog(d|null)                 // payload of S2C dialog (null closes); shop list => shop tab
showDeath(show)                    showZone(name)
updateMinimap({ x, z, ry, ents: [{ x, z, k: 'player'|'monster'|'npc', boss }] })
setStatus({ ping, fps, online })
isTyping() -> boolean              // true while a text input of the UI has focus
```
Requirements (French text everywhere, medieval-fantasy look: dark translucent panels, gold borders, serif titles,
consistent spacing, crisp at 1280×720 → 2560×1440, no layout overflow; all user text inserted with
`textContent`, **never** `innerHTML` with dynamic strings):
- **Login screen**: game title "Brumeval Online", tabs *Connexion* / *Nouveau personnage*, name + password
  fields, class cards (warrior/mage/ranger) with name, description, key stats and portrait `/ui/class_<cls>.png`
  (fallback: coloured emblem), error line, busy state, Enter submits.
- **Loading screen** with progress bar and hint texts.
- **HUD**: player frame (portrait `/ui/portrait_<cls>.png` fallback emblem, name, level, HP and mana bars with
  numbers), target frame (name, level, hp bar, colour by kind/level, boss badge), XP bar along the bottom with
  "Niveau N — x / y XP", action bar with 4 ability slots (icons `/icons/ab_<abilityId>.png`, fallback letter/
  gradient; key numbers 1-4; cooldown sweep via conic-gradient + seconds left; greyed when not enough mana;
  tooltip with name, description, mana, cooldown, range) + potion quick slots 5/6 showing remaining counts,
  gold counter, online/ping/fps line, menu buttons (Sac [I], Personnage [C], Quêtes [L], Aide [H]).
- **Chat** bottom-left: scrolling log (colours per channel, system in yellow, whispers in pink, errors red),
  input opens with Enter, sends with Enter, Escape cancels; `/w` hint; keeps last 100 lines.
- **Panels** (draggable optional, closable with Escape / their key): Inventory (24 slots, icons `/icons/<icon>.png`
  fallback, quantities, rarity borders, tooltip with stats/requirements/sell price, left-click → use/equip,
  right-click → context (Utiliser/Équiper, Vendre when shop open, Jeter with confirmation), gold); Character
  (class, level, weapon & armor slots — click to unequip — and stats); Quest log (active with progress,
  ready, done list; texts from `QUESTS`); Help (controls: ZQSD/WASD, clic, Tab, 1-6, I/C/L/H, Entrée, /w).
- **NPC dialog**: NPC name, greeting text, list of quests with state (available → details + rewards + *Accepter*;
  active → progress; ready → *Rendre la quête*), shop tab (items with icon, name, price, *Acheter*; sell by
  right-click in the inventory while open), *Au revoir* button → `handlers.closeDialog()`.
- **Toasts** (top centre, stacked, auto-fade) for notify; zone name banner on `showZone`; level-up banner.
- **Death overlay**: "Vous êtes mort" + *Réapparaître au village* button.
- **Minimap** (top-right, ~200 px round or square): static map pre-rendered once from `shared/world.js`
  (terrain height colours, water, roads, village, regions) + dynamic dots (self arrow with `ry`, players blue,
  monsters red, boss purple, NPC gold), north up (−Z), zone name above and coordinates.
- UI owns keys: Enter, I, C, L, H, Escape (close top-most panel first). It must not react to game keys while the
  chat input is not focused except those.

### 5.3 Assets (Blender, `assets/blender/<group>/build.py`)

Every build script: `sys.path.insert(0, <assets/blender>)`, `import common as C`, `args = C.parse_args()`,
loop over its keys with `C.selected(args, KEYS)`, `C.reset()` per model, build, `C.export_glb(key, args)`,
then `C.render_preview(key, args)` (animated models: preview in a meaningful pose, e.g. `action='Walk', frame=6`).
Low-poly stylised look (flat shading, 200–4000 triangles per model, bosses/houses up to ~6000), cohesive palette,
Principled materials only (colour/roughness/metallic/emission), no image textures. Everything must be generated
from code (no downloads). Scripts must be re-runnable and deterministic.

**Animated models** (one Armature named `Rig`; meshes skinned with vertex groups — rigid 100 % weights per body
part is fine; one Action per clip; clip names EXACTLY as listed; loops start/end on the same pose; 24 fps):

| key | group | description | clips |
|---|---|---|---|
| `warrior` | characters | armoured human, red/steel, sword in right hand, shield optional | Idle, Walk, Attack, Cast, Hit, Death |
| `mage` | characters | robed human, blue/purple, pointed hat, staff | Idle, Walk, Attack, Cast, Hit, Death |
| `ranger` | characters | hooded human, green/brown leather, bow in left hand, quiver | Idle, Walk, Attack, Cast, Hit, Death |
| `npc_elder` | characters | old man, long white beard, brown robe, walking stick | Idle, Walk |
| `npc_merchant` | characters | woman merchant, apron, colourful clothes | Idle, Walk |
| `goblin` | characters | small (≈1.2 m) green goblin, big ears, crude club | Idle, Walk, Attack, Hit, Death |
| `skeleton` | characters | bony undead, rusty sword, glowing eyes (emission) | Idle, Walk, Attack, Hit, Death |
| `slime` | creatures | translucent-looking green blob (≈0.8 m), eyes; squash/stretch animation | Idle, Walk, Attack, Hit, Death |
| `wolf` | creatures | grey wolf quadruped (≈0.9 m at shoulder, 1.6 m long) | Idle, Walk, Attack, Hit, Death |
| `golem` | creatures | huge stone golem boss (≈4 m), mossy rocks, glowing runes/core | Idle, Walk, Attack, Hit, Death |

Clip guidance: Idle 2 s breathing loop; Walk ≈ 0.8 s run/walk cycle in place (no root motion); Attack ≈ 0.6 s
swing/strike; Cast ≈ 0.8 s raise arms / draw bow; Hit ≈ 0.35 s flinch; Death ≈ 1.2 s fall down (ends lying on
the ground). Humanoid bones: `root, hips, spine, chest, neck, head, upper_arm.L/R, forearm.L/R, hand.L/R,
thigh.L/R, shin.L/R, foot.L/R`.
The characters agent also renders UI images: `client/public/ui/class_<cls>.png` (512×512, full-body, transparent
background, 3/4 view) and `client/public/ui/portrait_<cls>.png` (256×256 head & shoulders) for the three classes.

**Static models** (no armature, pivot at base centre, "front" = −Y in Blender):

| key | group | size / notes |
|---|---|---|
| `tree_pine` | nature | 5–7 m tall conifer, 2–3 tiers of foliage |
| `tree_oak` | nature | ≈5 m, round leafy crown ≈4.5 m wide, thick trunk |
| `tree_dead` | nature | ≈4 m bare twisted grey tree (graveyard) |
| `rock_a` | nature | ≈1.8 m wide boulder |
| `rock_b` | nature | ≈3 m wide rock cluster / tall standing rock |
| `bush` | nature | ≈1 m round bush (may have berries) |
| `flowers` | nature | ≈1 m patch of small colourful flowers + grass blades (no collision) |
| `house` | structures | ≈6×6 m footprint, ≈5.5 m tall; timber-frame walls, stone base, pitched roof, chimney, door on the FRONT (−Y), windows |
| `well` | structures | ≈2.4 m diameter stone well with little roof and bucket |
| `fence` | structures | ONE segment 2.0 m long along the X axis, ≈1 m tall, wooden posts + rails |
| `lamp_post` | structures | ≈3 m iron/wood post with lantern (emissive warm glass) |
| `crate` | structures | ≈1 m wooden crate |
| `barrel` | structures | ≈1.1 m tall wooden barrel with metal bands |
| `campfire` | structures | ≈1.6 m stone ring, logs, emissive flame shapes |
| `tent` | structures | ≈3.5 m wide goblin tent (patched hides), entrance on the front (−Y) |
| `gravestone` | structures | ≈1 m tall weathered stone headstone (front −Y) |
| `stall` | structures | ≈3 m market stall with striped canvas roof, counter with goods, front (−Y) |

**Icons** (`icons` group → `client/public/icons/<key>.png`, 128×128 RGBA, rendered with `C.render_icon`):
one per item icon in `shared/data.js` ITEMS (`potion_hp_s`, `potion_hp_l`, `potion_mp_s`, `slime_gel`,
`wolf_pelt`, `goblin_trinket`, `ancient_bone`, `golem_core`, `rusty_sword`, `steel_sword`, `runeblade`,
`apprentice_staff`, `arcane_staff`, `ember_staff`, `short_bow`, `long_bow`, `elven_bow`, `leather_tunic`,
`mage_robe`, `chainmail`, `golem_plate`), plus `gold` (coin pile) and one per ability `ab_<abilityId>` (12:
strike, heavy_blow, whirlwind, war_cry, firebolt, fireball, frost_nova, heal, shot, piercing_shot, arrow_rain,
rapid_fire) — ability icons are square with an opaque coloured background (class colour tint) and a clear
symbolic 3D object/emblem. Item icons: transparent background, object fills ~85 % of the frame, readable at 40 px.

## 6. Quality bar / acceptance

- `npm run assets` builds all groups without errors; `npm run inspect` shows every GLB with correct size/bbox and
  the exact clip names; previews look good (check them visually!).
- `npm test` passes. `npm run build` succeeds with no errors.
- Two browser tabs can log in, see each other move smoothly, chat, fight monsters together, gain XP, loot,
  complete the first quest, buy/sell, level up, die and respawn; no console errors; reload keeps progress.
