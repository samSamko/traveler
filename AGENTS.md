# AGENTS.md — Traveler

## Runtime & TypeScript Rules (Node.js v26+ Native `strip` Mode)
- This project runs directly on Node.js (`v26.5.0`) using native type-stripping with **zero external npm dependencies**.
- **CRITICAL TypeScript constraints**:
  1. All local relative imports MUST include the `.ts` extension (e.g., `import { rollD20 } from './dice.ts';`).
  2. All type/interface imports MUST use explicit `type` syntax (`import type { GameState } from './types.ts';` or `import { type GameState } from './types.ts';`).
  3. Do NOT use TypeScript `enum`, `namespace`, or constructor parameter properties (`constructor(public x: number)`). Use string literal union types and `as const` objects instead.

## Verification Gate
Run the lore validator and automated test suite after every change:
```powershell
node scripts/validate-lore.ts
node --test test/engine.test.ts
```
And verify CLI startup in stealth mode:
```powershell
"1`n1`n2`n2`n1`n1`n1`nAelindra`n1`n2`nJournal`nSelf`nBack`nArts`nBack`nBack`nquit`n" | node src/index.ts --stealth
```

## Writing Framework & Writer Agent
Read `docs/WRITER_AGENT.md` and `docs/lore/` before authoring new prose, creatures, NPCs, or locations. **Realistic-grimdark** (bleak survival realism, visceral body-horror/gore, moral cynicism, and 3-tier escalation from mundane surface to late-game dread) is the mandatory theme for all prose and world content. Every entity must supply `firstSightProse`, `unidentifiedName` / `unidentifiedLabel`, mirrored `AnatomyProfile`, and `entityLinks` entries in `data/links.json`.

## World Database Architecture (`data/*.json` -> `node:sqlite`)
- All narrative prose, dialogue, places, NPCs, events, enemies, items, recipes, abilities, races, backgrounds, heirlooms, perks, body mods, injuries, NPC appearance reactions, and entity links live in human-readable `data/*.json` files (`characters.json`, `items.json`, `bodymods.json`, `enemies.json`, `places.json`, `events.json`, `links.json`), NOT hardcoded in `.ts` files.
- At startup, `src/db/loader.ts` compiles `data/*.json` into an in-memory `node:sqlite` (`DatabaseSync(':memory:')`) relational database with `PRAGMA foreign_keys = ON` defined in `src/db/schema.ts`.
- Conditional branches, prose variants, and choice outcomes use the declarative DSL (`ConditionSpec`, `ProseVariant`, `EffectSpec`) interpreted by `src/db/rules.ts`.
- `src/content/*.ts`, `src/systems/bodymods.ts`, `src/systems/injuries.ts`, and `src/writing/links.ts` are thin adapters over `loadWorldDatabase()`.

## Architecture Overview
- `src/types.ts`: Domain contracts for characters, combat, memory flags, factions, locations, events, and saves.
- `src/db/schema.ts`: 21-table SQLite DDL (`WORLD_DB_SCHEMA`) with `PRAGMA foreign_keys = ON`.
- `src/db/rules.ts`: Declarative `ConditionSpec`, `ProseVariant`, and `EffectSpec` evaluator/executor.
- `src/db/loader.ts`: Compiles `data/*.json` into SQLite `:memory:` and exposes `loadWorldDatabase()` / `getWorldDatabase()`.
- `src/dice.ts`: Transparent `d20 + stat + bonus vs DC` check resolution and dice roller.
- `src/memory.ts`: WorldMemory flags, faction reputation (`-5` to `+5`), chronicle log, and reactive epilogue synthesizer.
- `src/ui.ts`: Output formatting, compact status bar, ASCII map renderer, and `--stealth` plain-text toggle.
- `src/content/*.ts`: Thin adapters over `loadWorldDatabase()` for characters, items, enemies, locations, and events.
- `src/combat.ts`: Turn-based combat with telegraphed enemy intents, stances, stamina/focus abilities, status effects, and XP leveling.
- `src/save.ts`: Atomic save/load (`temp -> rename`) in `.traveler-saves/` for permadeath runs and meta-profile unlocks.
- `src/engine.ts`: Hybrid command parser (`1/2/3` numbered choices + CLI commands) and deterministic state machine.
- `src/index.ts`: Interactive readline entrypoint.

## Extending Content
- **New Race / Spell / Item / Enemy / Body Mod / Injury**: Add ID to `src/types.ts` if needed, then add the normalized record to the corresponding `data/*.json` file (`data/characters.json`, `data/items.json`, `data/enemies.json`, `data/bodymods.json`).
- **New Place / NPC / Event**: Add the record and its `ConditionSpec` / `ProseVariant[]` / `EffectSpec` entries to `data/places.json` or `data/events.json`, and register cross-references in `data/links.json`. Use `setFlags`, `adjustFactions`, and `chronicles` in `EffectSpec` so player choices leave lasting scars on the world.
