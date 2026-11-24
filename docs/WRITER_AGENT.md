# Writer Agent Protocol — Traveler

This document governs all narrative, anatomical, environmental, and relational authoring for **Traveler**. Every new location, creature, NPC, event, or item MUST follow these rules and pass `node scripts/validate-lore.ts`.

## 1. Narrative Voice & World Tone
- **Tone**: Bleak, tactile dark frontier survival with gothic weight and late-imperial ruined grandeur. Contrast rough early-medieval frontier grit and systemic inter-racial friction in the south against overgrown Constantinian-scale ruins and the hollowing aftermath of the northern collapse.
- **Sensory First**: Ground every scene in cold air, freezing lung-burn, jagged stone, wet timber, rot, copper/iron, or overgrown marble before introducing abstractions or proper names.
- **No Cliché Slop**: Never use *ancient, whispers, palpable, obsidian, shadows dance,* or *a testament to*. Keep scene descriptions at 6–10 lines (2–3 short paragraphs) for locations and key thresholds; keep combat beats tight.
- **Strict Late-Game Secrecy**: Never reveal the true origin of the lunar stone, why the Pure Silver Capital failed, or the existence of ultra-rare Lunar Entities in opening prose, early areas, or casual NPC dialogue. Describe only what a traveler physically sees, hears, and feels.
- **Concision via Links**: Store deep history, anatomy, and cross-references in `data/links.json`, `src/writing/anatomy.ts`, and `docs/lore/` (`WORLD.md`, `RACES_AND_ANATOMY.md`, `CHARACTERS.md`, `BESTIARY.md`, `PLACES_AND_ITEMS.md`), surfaced on demand in the **Journal**.

## 2. Non-Negotiable Authoring Rules
1. **Describe Before Naming**:
   - Never print a creature's or NPC's proper name on first sight before describing surroundings and observable form.
   - Do not stack unexplained capitalized proper nouns in opening prose, scene blocks, or event prompts. Ground the player in physical observation first; introduce names only after sensory context or when learned.
   - Author `unidentifiedName` / `unidentifiedLabel`, `firstSightProse` (no proper name), and `returnSightProse` (no premature name leak).
2. **Mirrored Full-Body Anatomy & Stigmata**:
   - Player, NPCs, and Enemies share `AnatomyProfile` (`height`, `weight`, `skinColor`, `hairLength`, `hairStyle`, `hairColor`, `eyeShape`, `eyeColor`, `musculature`, `bodyShape`, `facialScars`, `bodyScars`, `faceDetail`, `chestTorsoDetail`, `armsHandsDetail`, `legsStanceDetail`, `distinguishingMark`, `visibleTags`).
   - Keep entries concise and functional. Reflect racial tension, frostbite/impairment, `Defilement` stigmata, and `BodyModDef` scars (`anatomyOverlay`, `excisionScar`) in `getNpcAppearanceReaction` and `appraisal.ts`.
3. **Zero Brackets or Parentheses**:
   - Never use `[...]` or `(...)` in choices, headers, prose, or Journal text.
   - Never print DCs, damage dice, or numeric deltas in story prose or choices. Keep exact numbers strictly inside `Journal -> Self`, `Journal -> Arts`, and `Journal -> Items`.
4. **1-2 Word Action Labels & Diegetic Telegraphing**:
   - Top-level and sub-menu action labels MUST be 1–2 words max (`Explore`, `Talk`, `Observe`, `Journal`, `Force Gate`, `Press North`).
   - Branch multi-option lists into sub-menus with `Back`.
   - Telegraph severe risk, time passage, starvation/impairment strain, `Defilement` spikes, or irreversible thresholds (such as passing the Black Stone Gate) through concrete sensory cues in the preceding prose.
5. **Cross-Linking & Template Safety**:
   - Register every relational tie (`commands`, `guards`, `prowls`, `holds`, `seeks`, `wields`, `yields`, `serves`, `based_at`) in `data/links.json`.
   - In `renderProse(template, state)` (`src/writing/prose.ts`), ensure every variable (`{name}`, `{skin}`, `{hair}`, `{eyes}`, `{height}`, `{weapon}`, `{weather}`, `{period}`, `{if:tag}...{/if}`, `{if:defilement>=N}...{/if}`) handles empty/unarmed values cleanly without double spaces, broken articles, or dangling punctuation.
6. **QBN Storylets & High-Stakes Trade-Offs**:
   - Gate `EventCard`s cleanly (`periods`, `weathers`, `minDefilement`, `maxDefilement`, `requiredTags`, `repeatable`, `cooldownHours`). Avoid mutually exclusive dead locks and ensure repeatable cards vary phrasing.
   - Pair ruthless, greedy, or desperate choices with real tactical/material upside AND harsh, deterministic blowback or world-state fallout.
7. **Damage Types, Creature Types, Defilement & Body Mods**:
   - Assign one of the 10 damage types (`slashing`, `piercing`, `bludgeoning`, `fire`, `cold`, `lightning`, `acid`, `poison`, `blight`, `resonant`) to every weapon, offensive ability, and enemy intent.
   - Assign a canonical creature type (`animal`, `humanoid`, `orc_kin`, `husk`, `undead`, `construct`, `demonic`, `lunar`, `boss`) to every enemy template.
   - Every `BodyModDef` in `data/bodymods.json` must declare `kind` (`mutation` | `surgery` | `implant`), `slot`, `bonusSummary`, `drawbackSummary`, `defilementLoad`, `anatomyOverlay`, and `excisionScar`.

## 3. Verification Gate
Run both checks after every narrative or structural edit:
```powershell
node scripts/validate-lore.ts
node --test test/engine.test.ts
```
