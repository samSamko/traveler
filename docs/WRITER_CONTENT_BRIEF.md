# Writer Agent Content Checklist & Master Prompt

Use this checklist and prompt to spawn content-authoring passes for **Traveler** (`data/*.json` -> `node:sqlite`).

---

## 1. Content Checklist (To Replace Placeholder Data & Fill the Northern Expanse)

### A. Places & Geography (`data/places.json`)
- [ ] **10 Scaling Frontier Areas** (`regionType: "area"`, `danger` 1–5): Rewrite placeholder Gloaming Reach places into the frozen Far North / overgrown Constantinian ruins beyond the Black Stone Gate (oversized marble arches, broken aqueducts, frosted hills, jagged passes, silent plazas leading toward the Pure Silver Capital).
- [ ] **3–5 Towns & Special Places** (`regionType: "town"` or `"special"`, **NO Explore**): Trapped southern survivor outposts, hermit camps, apostate shrines, and salvage markets trading in **Onyx** coins.
- [ ] **Site-Specific Interactions**: `actions` with 1–2 word labels, `ConditionSpec` visibility, and `EffectSpec` outcomes (setting world flags that ripple into other areas).

### B. NPCs, Dialogue & Reactions (`data/places.json`, `data/links.json`)
- [ ] **8–12 Trapped NPCs**: Deserters, hermits, witches, apostates, scavengers, and rare hollowed survivors.
- [ ] Every NPC must include: `unidentifiedLabel`, `firstSightProse` (no proper name), mirrored `AnatomyProfile`, `greetingVariants` (`ProseVariant[]`), and `topics` (1–2 word labels).
- [ ] **Systemic Friction & Appearance Reactions (`data/links.json` -> `npcReactions`)**: Reactions to Human/Elf/Dwarf/rare-Goblin race, sex, `Defilement`, body mods, scars, and equipped gear `visibleTags`.

### C. Bestiary (`data/enemies.json`)
- [ ] **20–30 Enemies across all 10 `CreatureCategory` types**:
  - `animal` / `beast` (frost-wolves, starving hounds, scavengers)
  - `humanoid` (trapped bandits, deserters, cultists)
  - `orc_kin` (100% barbaric, savage, animal-like northern raiders)
  - `husk` (vacant stupor remnants of the northern collapse)
  - `undead` (frozen/salt-preserved crypt dead)
  - `construct` (tall bronze/stone imperial wardens)
  - `demonic` (forbidden shrine horrors)
  - `lunar` (**strictly ultra-rare**, Full Moon / deep-ruin / high-Defilement only)
  - `boss` (dungeon & late-game apex threats)
- [ ] Every enemy must include: `unidentifiedName`, `firstSightProse` (no proper name), `returnSightProse`, mirrored `AnatomyProfile`, `visibleGear`, 10-type `resistances`, and `intents` with valid `damageType`.

### D. Encounters, Secret Sub-Areas & Dungeons (`data/encounters.json`, `data/dungeons.json`)
- [ ] **Camp Hub Explore Pool** (`scopeType: "camp_hub"`): Weighted enemies, wandering merchants, salvaged items, landscapes, curiosities, nothing, and discovery rolls for all 10 Areas & Towns.
- [ ] **Area Explore Pools** (`scopeType: "area"`): Unique encounter tables per area + weighted discovery rolls for **Secret Sub-Areas** and **Dungeons**.
- [ ] **4–6 Secret Sub-Areas** (`subAreas` + `scopeType: "sub_area"` encounters): Distinct local hazards and rare loot that rework exploration when toggled.
- [ ] **4–6 Multi-Room Dungeons** (`data/dungeons.json`): Node-graph rooms/corridors with traps (`trapDc`/`trapDamage`), switches (`switchId`), locked doors (`lockedBySwitchId`/`lockedByItemId`), loot vaults, and mini-bosses.

### E. Events, Storylets & Endings (`data/events.json`)
- [ ] **25–40 QBN Storylets**: Gated by `locations`, `periods`, `weathers`, `minDefilement`, `requiredTags`, and `ConditionSpec`—with ruthless/desperate high-stakes trade-offs.
- [ ] **Multiple Endings**: Design and wire 2–4 distinct endings (`triggerEnding` in `EffectSpec`) earned through late-game flags, factions, and deep northern discoveries.

### F. Gear, Draughts, Ancient Texts, Body Mods & Links (`data/items.json`, `data/bodymods.json`, `data/links.json`)
- [ ] **5-Slot Gear** (`mainHand`, `offHand`, `armor` with `armorTier` 1–3, `cloak`, `trinket`), **Weapon Coatings**, **Brewed Draughts** (Defilement-linked + Camp recipes), and **Ancient Texts**.
- [ ] **Body Mods & Injuries** (`data/bodymods.json`): Mutations, surgeries, and implants with explicit `bonusSummary`, `drawbackSummary`, `defilementLoad`, `anatomyOverlay`, and `excisionScar`.
- [ ] **Cross-Links (`data/links.json`)**: Register every relational tie (`commands`, `guards`, `prowls`, `holds`, `seeks`, `wields`, `yields`, `serves`, `based_at`).

---

## 2. Ready-to-Use Writer Agent Prompt

```text
You are a Writer Agent for Traveler, a zero-dependency Node.js CLI dark-frontier RPG backed by data/*.json compiled into an in-memory node:sqlite database (PRAGMA foreign_keys = ON).

BEFORE WRITING ANYTHING, READ:
1. docs/WRITER_AGENT.md (all non-negotiable style, database, and verification rules)
2. docs/lore/WORLD.md, RACES_AND_ANATOMY.md, CHARACTERS.md, BESTIARY.md, PLACES_AND_ITEMS.md
3. src/db/schema.ts and src/db/rules.ts (exact SQLite tables, foreign keys, and ConditionSpec/EffectSpec/ProseVariant DSL)

YOUR ASSIGNMENT:
Fill/replace content for: [INSERT TARGET DOMAIN: e.g., "Area 1-3 in data/places.json + their encounters in data/encounters.json" OR "6 new enemies in data/enemies.json"].

STRICT RULES:
- Actor's-eye view ONLY: describe what a living traveler physically sees, hears, smells, and feels right there—never world-building exposition or textbook history.
- NEVER copy, paraphrase, or recite phrasing from docs/lore/*. Every room, area, and event needs fresh local sensory detail.
- NEVER use cliché slop (ancient, whispers, palpable, obsidian, shadows dance, a testament to).
- STRICT LATE-GAME SECRECY: Do NOT mention or hint at the meteoric stone's origin, why the silver capital failed, or lunar entities in early/mid-game prose.
- Describe before naming: every enemy/NPC needs unidentifiedName/unidentifiedLabel, firstSightProse (without the proper name), and a full mirrored AnatomyProfile.
- Zero brackets [...] or parentheses (...) anywhere in player-facing text.
- All action/topic/choice labels MUST be 1-2 words max. Never use "Exit" as a label (use "Leave" or "Return").
- All data MUST live in data/*.json with valid foreign keys and canonical enums (10 damage types, 10 creature categories, 5 equip slots + consumables/draughts/coatings/ash_text/reagents).

VERIFICATION GATE (MANDATORY BEFORE FINISHING):
Run and verify both pass with exit code 0:
  node scripts/validate-lore.ts
  node --test test/engine.test.ts
```
