# AGENTS.md — Traveler

## Runtime & TypeScript Rules (Node.js v26+ Native `strip` Mode)
- This project runs directly on Node.js (`v26.5.0`) using native type-stripping with **zero external npm dependencies**.
- **CRITICAL TypeScript constraints**:
  1. All local relative imports MUST include the `.ts` extension (e.g., `import { rollD20 } from './dice.ts';`).
  2. All type/interface imports MUST use explicit `type` syntax (`import type { GameState } from './types.ts';` or `import { type GameState } from './types.ts';`).
  3. Do NOT use TypeScript `enum`, `namespace`, or constructor parameter properties (`constructor(public x: number)`). Use string literal union types and `as const` objects instead.

## Verification Gate
Run the automated test suite after every change:
```powershell
node --test test/engine.test.ts
```
And verify CLI startup in stealth mode:
```powershell
"1`n2`n2`n1`nAelindra`nlook`nmap`nstats`nmemory`nquit`n" | node src/index.ts --stealth
```

## Architecture Overview
- `src/types.ts`: Domain contracts for characters, combat, memory flags, factions, locations, events, and saves.
- `src/dice.ts`: Transparent `d20 + stat + bonus vs DC` check resolution and dice roller.
- `src/memory.ts`: WorldMemory flags, faction reputation (`-5` to `+5`), chronicle log, and reactive epilogue synthesizer.
- `src/ui.ts`: Output formatting, compact status bar, ASCII map renderer, and `--stealth` plain-text toggle.
- `src/content/characters.ts`: 2 binary sexes, 4 original races (`vaelorian`, `ael_thalor`, `durnfolk`, `grixi`), 4 backgrounds, 4 active heirlooms, spells/cantrips/skills, and level-up perks.
- `src/content/items.ts`: Weapons, armor, trinkets, consumables, and relics.
- `src/content/enemies.ts`: Frontier monsters, mini-bosses (including Sir Vorne and Husk-Stalker Kale), and final boss Malakor.
- `src/content/locations.ts`: 9 interconnected locations of the Gloaming Reach with sex/race/memory-reactive dialogue and shops.
- `src/content/events.ts`: Non-repeating frontier event deck with asymmetric sex/race/background/spell branches.
- `src/combat.ts`: Turn-based combat with telegraphed enemy intents, stances, stamina/focus abilities, status effects, and XP leveling.
- `src/save.ts`: Atomic save/load (`temp -> rename`) in `.traveler-saves/` for permadeath runs and meta-profile unlocks.
- `src/engine.ts`: Hybrid command parser (`1/2/3` numbered choices + CLI commands) and deterministic state machine.
- `src/index.ts`: Interactive readline entrypoint.

## Extending Content
- **New Race / Spell**: Add ID to `src/types.ts`, register definition and abilities in `src/content/characters.ts`, and add `[Race-Only]` branches in `src/content/events.ts` and `src/content/locations.ts`.
- **New Event**: Add an `EventCard` entry in `src/content/events.ts` with `requiredLocations` / `condition` / `choices`. Use `setFlag`, `adjustFaction`, and `recordChronicle` so player choices leave lasting scars on the world.
