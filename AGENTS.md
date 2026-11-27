# AGENTS.md — MÖRK BORG Bare Bones Simulator

## Runtime & TypeScript Rules (Node.js v26+ Native `strip` Mode)
- This project runs directly on Node.js (`v26.5.0+`) using native type-stripping with **zero external npm dependencies** and **100% offline procedural execution**.
- **CRITICAL TypeScript constraints**:
  1. All local relative imports MUST include the `.ts` extension (e.g., `import { rollDie } from './dice.ts';`).
  2. All type/interface imports MUST use explicit `type` syntax (`import type { GameState } from './types.ts';`).
  3. Do NOT use TypeScript `enum`, `namespace`, or constructor parameter properties (`constructor(public x: number)`). Use string literal union types and `as const` objects instead.

## Verification Gate
Run the SQLite data validator and automated test suite after every change:
```powershell
node scripts/validate-data.ts
node --test test/engine.test.ts
```
And verify offline CLI startup in stealth mode:
```powershell
"3`n2`n1`nsummary`n1`n1`n2`nsheet 1`nrest`nquit`n" | node src/index.ts --stealth
```

## Architecture Overview
- `data/*.json`: Normalized MÖRK BORG Bare Bones Edition + *Rotblack Sludge*-inspired procedural tables (`names.json`, `classes.json`, `equipment.json`, `powers.json`, `traits.json`, `trait_profiles.json`, `creatures.json`, `outcasts.json`, `world.json`, `dungeons.json`, `campaigns.json`, `prose_fragments.json`, `roll_prompts.json`).
- `src/db/schema.ts` & `src/db/loader.ts`: Compiles `data/*.json` into an in-memory `node:sqlite` (`DatabaseSync(':memory:')`) database with `PRAGMA foreign_keys = ON`.
- `src/types.ts`: Domain contracts (`GameState.version = 2`) for PCs, Outcasts, Contracts, Calendar of Nechrubel, 12–15 room Dungeons, Violence combat, and dynamic choices.
- `src/dice.ts`: Seeded `mulberry32` PRNG, dice parser, `d66`, `4d6 drop lowest`, Bad Habit #19 whistle-on-stealth checks, and MÖRK BORG DR tests.
- `src/rules/chargen.ts`: Solo or `d3 + 1` party creation, classless + 6 Optional Classes, mechanical trait items, and initial Contract seeding.
- `src/rules/class_features.ts`: All 30 Optional Class features, Fanged Deserter bite, all 8 Occult Herbmaster decoctions + dawn re-brewing, combat companions, and `use` item handlers.
- `src/rules/shop.ts`: Quartermaster catalog, equipment/weapon/armor/ammo purchasing, armor tier repair (p. 25), and hospice recovery.
- `src/rules/traits.ts`: 80-entry trait reactivity (tags, non-repeating prose callouts, Reaction/DR modifiers, contextual `[Trait]` choices, and *Troubling Tale* pursuers).
- `src/rules/calendar.ts`, `src/rules/rest.ts`, `src/rules/advancement.ts`, `src/rules/powers.ts`: Dawn Misery `7:7`, rest/starvation/infection/curse/hemorrhage/Protean Scroll dawn updates, *Getting Better* (including Scum 2nd specialty), and all 20 Scrolls + 20 Arcane Catastrophes.
- `src/rules/dungeon.ts`: Procedural 12–15 room *Rotblack Sludge*-style dungeon graph (noise-alerted guards, pit traps into narrow crawlways, rival factions, central hazards + apex beasts, puzzle statues -> secret vaults, key-bearing bosses).
- `src/combat.ts`: Player-facing *Violence*, Boss round-3 Powers & sympathy backlash, Boss death pacifying the Apex Beast, Apex devour checks, Creature specials, Broken `d4` recovery, Morale, and all 5 Omen uses.
- `src/gm/procedural.ts`: 100% offline Procedural GM driving Contract/Seer briefings, overland travel, multi-layered room prose, cross-room puzzles, freeform verb-keyword matching, and campaign progression.
- `src/engine.ts`, `src/ui.ts`, `src/save.ts`, `src/index.ts`: State machine, muted grimdark ANSI / `--stealth` UI, 5.5s decelerating dice animations, skip-on-key typewriter, atomic v2 saves in `.morkborg-saves/`, and CLI entrypoint.
- `scripts/playtest.ts`: Multi-seed tactical playtest simulator & rule verification harness.
