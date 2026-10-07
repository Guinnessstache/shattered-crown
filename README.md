# Shattered Crown

A co-op dungeon-crawling action RPG for the browser, inspired by the PSP launch title *Untold Legends: Brotherhood of the Blade*. Every dungeon floor is procedurally generated, heroes persist between sessions, and up to 4 friends can play together with voice chat. It plays on PC (keyboard + mouse or an Xbox controller) and on phones (touch controls).

> "Shattered Crown" is a working title. Change `GAME_TITLE` in `shared/rules.js` and the text in `public/index.html`.

## What's in this first build (vertical slice)

- **Knight** class with 4 skills (Cleave, Shield Bash, Charge, War Cry), levels, attribute and skill points
- **Emberfall Village** hub with a trader (potions, rings, amulets), a smith (weapons and armor) and the dungeon gate
- **Endless procedural floors**: rooms, corridors, pillared halls, torches and monster packs; a new layout every descent
  - Floors 1–5 Crypts, 6–10 Caverns, 11–15 Burning Halls, then the cycle repeats with harder monsters
  - A **guardian boss** every 5th floor (Gravemaw the Ogre, the Broodmother) that seals the stairs until it dies
- 8 monster types plus elite "Champion" packs
- **Loot**: common / magic / rare / legendary items with random affixes, 8 equipment slots, and gear that shows on your hero. Each player gets their own drops.
- **Saves**: accounts with username + password or Google sign-in; heroes, items, gold and the deepest floor reached are saved to the server
- **Co-op**: host a party and share the 5-letter code; voice chat through WebRTC (reused from High Roller Hold'em)
- **Controls**: keyboard + mouse, Xbox/PlayStation controllers, and on-screen touch controls

## Run it locally

```bash
npm install
npm start          # http://localhost:3000
```

Locally, saves go to `data/db.json`. Set `DATABASE_URL` to use Postgres instead.

Tests: `npm test` (an end-to-end server test). There's also `node test/balance.mjs`, a headless autopilot knight that clears floors and prints level, deaths and gear per floor for tuning difficulty.

For testing in the browser, start with `DEV_CMDS=1 npm start` and use the console:
`__sc.socket.emit('dev', { cmd: 'floor', floor: 5 })`, `{ cmd: 'xp', n: 5000 }`, `{ cmd: 'gold', n: 5000 }`, `{ cmd: 'town' }`. **Never set DEV_CMDS on the live server.**

## Deploy on Render

1. Push this folder to a GitHub repo.
2. On Render: **New → Blueprint**, then pick the repo. `render.yaml` creates the web service, a Postgres database, and a random `SESSION_SECRET`.
3. Open the site, create an account, and play.

**About free plans:** Render's free Postgres expires **30 days** after you create it, with a 14-day grace period before it's deleted. Free web services also go to sleep after 15 minutes without traffic, and take about a minute to wake up. To keep heroes saved for good, either:
- upgrade the Render database to a paid plan, or
- use an outside Postgres (for example Neon or Supabase): delete the `databases:` block and the `fromDatabase` env var, and set `DATABASE_URL` yourself.

## Google sign-in (optional)

1. In Google Cloud Console → APIs & Services → Credentials, create an **OAuth client ID** (type: Web application).
2. Add your site under **Authorized JavaScript origins**, for example `https://shattered-crown.onrender.com` and `http://localhost:3000`.
3. Set `GOOGLE_CLIENT_ID` on Render to the client ID. The "Continue with Google" button appears on its own.

## Controls

| | Keyboard + mouse | Controller | Touch |
|---|---|---|---|
| Move | WASD | Left stick | Left-side joystick |
| Attack | Left click / Space (hold to keep swinging) | A | ⚔ |
| Skills | 1–4, right click = Cleave | X, Y, B, RB | Skill buttons |
| Potions | Q (health), R (mana) | LT, RT | ❤ ✦ |
| Use / pick up | E | LB | ✋ (appears when needed) |
| Camera | Hold right mouse button and move the mouse (or Z/X), wheel to zoom | Right stick | Swipe empty space |
| Character | I | View | 🎒 |
| Map | Tab | R3 | Tap the minimap |

## Project layout

```
server/      Express + Socket.IO: accounts, saves, parties, and the game simulation (zone.js)
shared/      Code used by both server and browser: map generation, collision, items, monsters, rules
public/      The browser game: Three.js renderer, models and animation, UI, input, audio, voice chat
public/models/  Optional Blender-made .glb models (see manifest.json); built-in models are used otherwise
public/tex/     Pre-baked procedural textures (WebP); see "Textures" below
test/        Server end-to-end test and the balance autopilot
```

The server is the authority for combat, loot, XP and items, so players can't give themselves gear. Players move their own heroes (for responsive controls), and the server checks those moves for speed and walls.

## Toward a Steam version

The same structure as High Roller Hold'em applies: wrap `public/` + `server/` in Electron, run the server inside the app, and save to a local file (the JSON store already does this). Co-op would go player-hosted over Steam networking instead of Render.

## Models from Blender

`tools/blender/build_models.py` builds the Knight, Skeleton (also used for archers), Goblin and Ogre in Blender and exports them to `public/models/*.glb`, along with `manifest.json`. To rebuild after editing the script:

- In Blender: Scripting tab → open the file → Run Script, or
- From a terminal: `blender --background --python tools/blender/build_models.py`

The game uses any model listed in `public/models/manifest.json`. Monsters without one (rats, spiders, imps, the Broodmother) use the built-in models in `public/js/render/models.js`. Joint names and material names are documented at the top of the script, so a hand-made model with the same names will drop in too.

## Textures and level art

Every surface texture (stone, rock, cobbles, grass, roofs, wood, lava) is generated by the painters in `public/js/render/textures.js`. To keep zone loads instant they are pre-baked to small WebP files in `public/tex/` (about 3 MB in total). After changing a painter or a palette:

1. Bump `PAINT_VERSION` in `textures.js` (so stale bakes are ignored).
2. Run `node tools/bake_textures.mjs` (needs Python 3 with Pillow: `pip install pillow`).

If the bake is missing or out of date, the game paints the textures in the browser instead, which works but makes the first visit to each area slower.

Level art lives in `public/js/render/`:

- `level.js`: floors, walls with trim and pilasters (displaced rock in caverns), and the cutaway that lowers walls between the camera and your hero
- `dress.js`: per-theme dungeon dressing (coffins, statues, chains, cobwebs, stalagmites, crystals, mine shoring, obsidian spikes, lava falls, floor decals, torch light pools)
- `town.js`: the village ground blend, grass and flowers, sky, mountains, clutter and chimney smoke
- `post.js`: bloom and per-zone colour grading (off on the Low graphics setting)

## Weapons, shields and armor

- **Weapons and shields** are built in the browser by `public/js/render/forge.js`. Each item's tier picks the shape family (Short Sword … Kingsfall, Buckler … Dragonguard); the item's id seeds the part choices (blade outline, tip, fuller, guard, grip wrap, pommel, metal, heraldry); its strongest bonuses colour the gems, runes and paint; rarity adds flair (gem → glowing runes → glowing edge and a rune halo). No two items look the same.
- **Armor** comes from the Blender hero models. `tools/blender/armor_kit.py` adds six tiers of chest, shoulder, bracer, glove, thigh, greave and boot pieces to every hero in that class's style (plate, brute, robe, wild). The game shows the piece matching each equipped item's tier and dresses it from that item (`gearPalette` in forge.js): its own metal, trim by rarity, enamel and runes in its stat colours.
- Rebuild the hero models after editing the kit: run `tools/blender/build_models.py` in Blender. Exports are Draco-compressed; the game decodes them with three.js's bundled decoder.
- **Gear gallery:** open `/dev/gallery.html` on your running server to see every weapon, shield and armor tier side by side (`?view=sword`, `axe`, `mace`, `staff`, `shield`, `variety`, `heroes`, `armor`). Drag to orbit.
