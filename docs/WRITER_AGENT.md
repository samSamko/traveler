# Writer Agent Protocol — Traveler

This document governs all narrative, anatomical, environmental, and relational authoring for **Traveler**. Every new location, creature, NPC, event, or item MUST live in `data/*.json`, pass SQLite foreign-key compilation, and pass `node scripts/validate-lore.ts`.

## 1. Perspective & Anti-Repetition (Mandatory)
- **Actor's-Eye View, Never World-Building Exposition**:
  - Always write every scene strictly through **what a living actor physically sees, hears, smells, and feels right there on the ground**—never how the world was built, never textbook history, never omniscient narrator lore dumps.
  - Wrong: *"The Lost Northern Builders constructed Constantinian aqueducts using a meteoric stone before their empire fell."*
  - Right: *"Broken marble arches tower twice the height of a man above the frozen reeds. Chipped stair treads, built for a longer stride, vanish under drifted ash."*
- **Do Not Recite Reference Docs (`docs/lore/`)**:
  - `docs/lore/` files are internal background truth for your own consistency—**never copy, paraphrase, or recite their phrasing** into game prose.
  - Never repeat stock environmental lines across rooms or areas. Every place, room, and event must carry fresh, concrete local details (a frozen boot wedged under a cartwheel, sour brine dripping off rusted iron, salt crusted on a dead hound's muzzle).
- **No Cliché Slop**:
  - Never use *ancient, whispers, palpable, obsidian, shadows dance,* or *a testament to*.
  - Keep scene descriptions tight (6–10 lines across 2–3 short paragraphs for major sites; 2–4 lines for rooms and combat beats).
- **Strict Late-Game Secrecy**:
  - Never mention or hint at the meteoric stone's origin, why the silver capital collapsed, or lunar entities in opening prose, early areas, or everyday NPC chatter. Write only what a traveler can witness.

## 2. Strict Database Compliance (`data/*.json` -> `node:sqlite`)
All narrative content MUST conform to `src/db/schema.ts` and `src/db/rules.ts` so `src/db/loader.ts` compiles cleanly into `node:sqlite` with `PRAGMA foreign_keys = ON`:
1. **No Hardcoded Prose in TypeScript**: Put all places, NPCs, shops, events, enemies, items, recipes, body mods, injuries, encounters, dungeons, and cross-links in `data/*.json` (`characters.json`, `items.json`, `bodymods.json`, `enemies.json`, `places.json`, `events.json`, `encounters.json`, `dungeons.json`, `links.json`).
2. **Valid Foreign Keys Only**: Every `itemId`, `enemyId`, `parentAreaId`, `grantedAbilityId`, `harvestItemId`, `fromRoomId`/`toRoomId`, and `entityLinks` target MUST exist in its parent table. Missing references fail SQLite compilation.
3. **Declarative DSL Only**: Express conditional text with `ProseVariant[]` (`when: ConditionSpec`), menu visibility with `visible: ConditionSpec`, and rewards/checks/combat with `EffectSpec` (`setFlags`, `adjustFactions`, `giveItems`, `check`, `startCombat`).
4. **Canonical Enums & Types**:
   - Damage types (`10`): `slashing`, `piercing`, `bludgeoning`, `fire`, `cold`, `lightning`, `acid`, `poison`, `blight`, `resonant`.
   - Creature categories (`10`): `animal`, `beast`, `humanoid`, `orc_kin`, `husk`, `undead`, `construct`, `demonic`, `lunar`, `boss`.
   - Item slots: `mainHand`, `offHand`, `armor`, `cloak`, `trinket`, `consumable`, `draught`, `coating`, `ash_text`, `relic`, `reagent`.

## 3. Non-Negotiable Authoring Rules
1. **Describe Before Naming**:
   - Never print a creature's or NPC's proper name on first sight before describing surroundings and observable form.
   - Do not stack capitalized proper nouns in opening prose or scene prompts; ground sensory reality first.
   - Supply `unidentifiedName` / `unidentifiedLabel`, `firstSightProse` (no proper name), and `returnSightProse`.
2. **Mirrored Full-Body Anatomy & Stigmata**:
   - Player, NPCs, and Enemies share `AnatomyProfile` (`height`, `weight`, `skinColor`, `hairLength`, `hairStyle`, `hairColor`, `eyeShape`, `eyeColor`, `musculature`, `bodyShape`, `facialScars`, `bodyScars`, `faceDetail`, `chestTorsoDetail`, `armsHandsDetail`, `legsStanceDetail`, `distinguishingMark`, `visibleTags`).
   - Keep entries functional and concrete, feeding into NPC reactions and `Observe` appraisal.
3. **Zero Brackets or Parentheses**:
   - Never use `[...]` or `(...)` in choices, headers, prose, or Journal text.
   - Never leak DCs, dice, or raw numbers in story prose or choice labels; keep stats/mechanics inside `Journal -> Self`, `Journal -> Arts`, and `Journal -> Items`.
4. **1-2 Word Action Labels & Diegetic Telegraphing**:
   - All action labels, topics, and choices MUST be 1–2 words max (`Explore`, `Talk`, `Observe`, `Journal`, `Force Gate`, `Pull Chain`). Never use `Exit` as an option label (use `Leave` or `Return`, since `exit` is a global quit command).
   - Telegraph severe risk, starvation/cold, `Defilement` spikes, or one-way thresholds through physical sensory cues in the preceding prose.
5. **Cross-Linking & Template Safety**:
   - Register relational ties in `data/links.json`.
   - Keep `renderProse` tokens (`{name}`, `{skin}`, `{hair}`, `{eyes}`, `{height}`, `{weapon}`, `{weather}`, `{period}`, `{if:tag}...{/if}`) clean without broken articles or dangling punctuation.

## 4. Verification Gate
Run both checks after every edit:
```powershell
node scripts/validate-lore.ts
node --test test/engine.test.ts
```
