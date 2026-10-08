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

## Level sync in groups

Like EverQuest 2's mentoring: in a dungeon, every hero above the lowest-level hero there fights at that level. Very deep floors also have their own cap (floor × 1.5 + 2), so the lower of the two applies.

- **What changes:** stats and gear are scaled down. All skills and skill ranks are kept.
- **Bonus:** synced heroes earn +15% XP.
- **On screen:** the party list shows e.g. `Lv 13 ⇣18`. The character sheet shows "synced down from 18".
- **Lifting:** the sync lifts in town, when the lowest hero leaves, or as they level up.

## Motion-captured heroes (Mixamo)

All four classes use Mixamo characters with motion-captured animation packs:

| Class | Character | Pack |
|---|---|---|
| Knight | Knight D Pelegrini | Sword and Shield |
| Berserker | Brute | Great Sword (played with the game's axes) |
| Alchemist | Nightshade J Friedrich | Magic Spell |
| Druid | Arissa | Magic Spell |

The casters borrow walk, run, hit and death from the Sword and Shield pack, with the hip motion rescaled to their height. The older Blender-built heroes remain as a fallback and are used for inventory icons.

**Source files.** The raw Mixamo files live in `art-source/mixamo/{sns,gs,mag_ns,mag_ar}`. That folder is git-ignored: Mixamo allows its characters in games, but not redistributing the raw files.

**Configuration.** `tools/blender/mixamo_heroes.json` lists, for each hero:
- the character file and any prop meshes to drop;
- which pack clip plays each game action (`swing0..2` combo, `cast0..2` random variants, `throw`, skill clips, `hit`, `death`);
- how each one-shot clip is trimmed.

**Building.** `tools/blender/build_mixamo_hero.py` builds every hero GLB (1.7–2.5 MB each) and records height, walk/run speed and trims in `public/models/manifest.json`. It:
- strips root motion so every clip plays in place;
- turns the specular map into roughness/metal;
- keeps the emissive glows;
- downsizes the textures to WebP;
- writes one Draco-compressed file per hero.

```
pip install bpy==5.2.2      # Blender as a Python module (Python 3.13)
python tools/blender/build_mixamo_hero.py -- art-source/mixamo public/models            # all heroes
python tools/blender/build_mixamo_hero.py -- art-source/mixamo public/models hero_druid_mx
```

**Playback.** `public/js/render/skinned.js` plays the clips through a three.js AnimationMixer:
- **Movement:** idle, walk and run blend by speed, with playback matched to the hero's ground speed.
- **Attacks while moving:** play on the upper body only, so the legs keep running.
- **Gear:** the game's own weapons and shields attach to the hand and forearm bones (`GRIP` in models.js; the axe grip was measured from the Brute's original axe).
- **Loading:** the hero models load in the background behind the title screen.

**Armor on the new models.** `public/js/render/armorfit.js` lifts the tiered armor pieces from the older Blender heroes onto the Mixamo bones: helm, pauldrons, bracers, gloves, thigh plates, greaves and boots.
- **Fit:** measured automatically. The old body part is compared with the Mixamo body: bone lengths, and how far the skinned vertices sit from each bone. Each piece is then rotated into the T-pose, placed using the length ratio, and sized by the thickness ratio. Growth is capped where clothing or hair overstate the body.
- **Helms:** placed relative to the eye line (the eye bone where the rig has one).
- **Materials:** pieces use each item's own palette.
- **Draw calls:** everything on the same bone and material is merged, about 30 meshes per hero.
- **Outfit tint:** the Knight's red cloth and the Alchemist's purple robes take the chest item's color (a shader hue shift that leaves skin and metal alone).
- **Not yet:** chest plates, which would need real skinning.

**Viewer and toggle.** `/dev/anim.html?cls=druid` previews each class. The menu option "Motion-captured hero models" switches back to the old ones.

## Admin console

Type `/console` (or `/admin`) in chat while playing, then enter the admin password. The console stays unlocked until you press **Lock** or disconnect.

- **Turn it on:** set the environment variable `ADMIN_PASSWORD` to at least 8 characters. On Render: Dashboard → your service → Environment → Add `ADMIN_PASSWORD`. Without it the console is off.
- **Online:** everyone playing, their level, floor and party. Click a player to open their account.
- **Accounts:** search by username, email, hero name or `#id`. From an account you can:
  - reset the password (type one, or leave it blank to get a random one to send them);
  - kick or ban/unban the account (a ban disconnects them and blocks sign-in);
  - give gold, XP or levels to any of their heroes that are online.
- **Announce:** sends a message to every player online.

Wrong passwords are limited to 5 tries per 10 minutes per IP. Every admin action is written to the server log (`[admin] …`).

## Buffs, debuffs, bank and mail

**Buff and debuff timers.** Icons above your health bar show what's on you and how long it lasts (the ring empties as it runs out; a number in the corner is poison stacks or the ward's shield left). Hover for a description. Your target's (and a boss's) stun, slow, chill, burning and poison show under its health bar.
- Monsters now put debuffs on you: Cave Spiders, Spiderlings and the Broodmother poison (stacks up to 3), Fire Imps' fireballs set you burning, and a boss slam dazes you (slower movement for 2.5s). Tune them in `MONSTER_DEBUFF` in `shared/rules.js`.

**Bank (Odo the Banker, north-west of the town square).** Shared by every hero on your account, so it's also how you pass gear and gold to your other heroes.
- 30 slots per tab; tabs 2–4 cost 2,500 / 10,000 / 40,000 gold (`BANK` in `shared/rules.js`). Gold can be stored too.
- Click an item, then Store / Take; double-click (or X on a controller) moves it straight away; click an empty bank slot to put the picked item there. LB/RB switch tabs.
- Every change writes the hero and the bank in one database transaction, so an item can't be lost or copied if the server stops halfway.

**Mail (the mailbox by the spawn point).** Write to any hero by name: up to 6 items and any amount of gold, 10 gold postage plus 10 per item (`MAIL` in `shared/rules.js`).
- Names aren't unique, so **Find** lists every hero with that name (with level, class and when they last played) and you pick one. Party members and your own heroes are offered as quick picks.
- Attached items and gold stay on the letter until taken (one at a time or **Take all**). A letter can be sent back; unclaimed letters with something attached go back to the sender after 30 days (or straight away if the hero was deleted). Empty letters are thrown away after 30 days.
- You're told about new letters as they arrive and when you log in, and an ✉ badge shows unread letters.
- On a controller, press A on a text box to type with the on-screen keyboard.

## Players online and the group finder

The top right of the screen (under the map) shows how many players are in a game right now; the hero screen shows it too. Click it, the **🔍 Find a group** button on the hero screen, or the one in the 👥 party window to open the group finder.

- It lists every party whose leader chose to list it: the leader, a short note, where they are (town or which floor), their levels, who's in it and how full it is. **Join** takes you straight there, even from inside another game.
- **Host co-op party** has a "List my party in the group finder" box (ticked by default, and remembered). The leader can turn listing on or off and write the note from the 👥 party window at any time.
- Solo games never show up.

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

**Two-handed weapons.** There are three two-handed bases: Great Axe, Greatsword and Maul.
- **Stats:** 1.35–1.55× damage, 0.72–0.85s per swing, 2.5–2.9 m reach. The Maul also has a stun chance.
- **No shield:** equipping one moves your shield to your pack, and equipping a shield moves the two-hander back. If your pack has no room, the swap is refused.
- **Berserker:** starts with a Great Axe.
- **Looks:** each is a bigger version of the matching one-hand family, with a long two-hand grip.
- **Where to get them:** they drop and are sold and crafted like other weapons.
