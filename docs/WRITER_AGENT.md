# Writer Agent Protocol — Traveler

This document governs all narrative, anatomical, environmental, and relational authoring for **Traveler: The Gloaming Reach**. Every new location, creature, NPC, event, or item MUST follow these rules and pass `node scripts/validate-lore.ts`.

## 1. Narrative Voice & Inspirations
- **Tone**: Grounded, elegiac, tactile dark frontier fantasy. Blend Middle-earth antiquity, Dark Souls / Elden Ring decayed majesty, Hollow Knight subterranean melancholy, and D&D tactical concreteness.
- **Sensory First**: Ground every scene in cold rain, ash, damp stone, copper/bronze scent, dim lantern light, and physical weight before introducing abstractions.
- **Concision via Links**: Keep scene prose tight and evocative; store deep history, anatomy, and cross-references inside the structured registry (`src/writing/links.ts`, `src/writing/anatomy.ts`, `docs/lore/`), surfaced on demand in the **Journal**.

## 2. Non-Negotiable Authoring Rules
1. **Describe Before Naming (Plain Sensory Grounding First)**:
   - Never print a creature's or NPC's proper name on first sight before describing surroundings and observable form.
   - Never stack unexplained capitalized proper nouns (`First Kiln of Aethel`, `Third Drowning Toll`, `Pale Root`, `Iron-Vow`, `Vesper-Scribe`) in opening prose, scene descriptions, or event prompts. Always describe what the player **sees, hears, smells, and understands physically** in plain English first (a massive cracked underground furnace, pale spore-choked roots splitting the road, a ragged border garrison in soot-stained mail), and introduce proper names sparingly only after the thing is grounded.
   - Author an `unidentifiedName` / `unidentifiedLabel` (e.g., `Ember-Jawed Hound`, `Scarred Officer`), a full `firstSightProse` (which MUST NOT contain the proper name), and a concise `returnSightProse` for repeat encounters.
2. **Mirrored Full-Body Anatomy**:
   - Player, NPCs, and Enemies share `AnatomyProfile` (`height`, `weight`, `skinColor`, `hairLength`, `hairStyle`, `hairColor`, `eyeShape`, `eyeColor`, `musculature`, `bodyShape`, `facialScars`, `bodyScars`, `faceDetail`, `chestTorsoDetail`, `armsHandsDetail`, `legsStanceDetail`, `distinguishingMark`, `visibleTags`).
   - Every visible trait should make sense at a glance and feed into NPC reactions (`getNpcAppearanceReaction`) or combat appraisal (`appraisal.ts`).
3. **Zero Brackets or Parentheses**:
   - Never use `[...]` or `(...)` in choices, headers, prose, or Journal text.
   - Never print `(DC 13)` or `(+18 Crowns)` in story text or choices.
   - Keep exact numbers strictly inside `Journal -> Self`, `Journal -> Arts`, and `Journal -> Items`.
4. **1-2 Word Action Labels**:
   - Top-level and sub-menu verbs/choices MUST be 1-2 words max (`Explore`, `Talk`, `Observe`, `Journal`, `Cure Kale`, `Flash Charter`).
   - Whenever multiple actions, skills, spells, items, or enemies exist, branch into a clean sub-menu with `Back`.
5. **Cross-Link Everything**:
   - Register every relational tie (`commands`, `guards`, `prowls`, `holds`, `seeks`, `wields`, `yields`, `serves`, `based_at`) in `src/writing/links.ts` (`ENTITY_LINKS`).
6. **Variable Prose & QBN Storylets**:
   - Use `renderProse(template, state)` from `src/writing/prose.ts` (`{name}`, `{skin}`, `{hair}`, `{eyes}`, `{height}`, `{weapon}`, `{weather}`, `{period}`, `{if:tag}...{/if}`, `{if:defilement>=N}...{/if}`) so scenes stay concise yet reflect customized anatomy, scars, body mods, weather, and Defilement.
   - Gate new `EventCard`s cleanly with `periods`, `weathers`, `minDefilement`, `maxDefilement`, `requiredTags`, `repeatable`, and `cooldownHours`.
7. **Damage Types, Resolve, Defilement & Body Mods**:
   - Assign one of the 10 damage types (`slashing`, `piercing`, `bludgeoning`, `fire`, `cold`, `lightning`, `acid`, `poison`, `blight`, `resonant`) to every weapon, offensive ability, and enemy intent.
   - Every `BodyModDef` in `src/systems/bodymods.ts` MUST declare its `kind` (`mutation` | `surgery` | `implant`), anatomical `slot`, explicit `bonusSummary` AND `drawbackSummary`, `defilementLoad`, `anatomyOverlay`, and `excisionScar`.
   - Update the matching internal canon dossier under `docs/lore/`:
     - [WORLD.md](file:///c:/Users/samael.samoilenko/Desktop/Projs/traveler/docs/lore/WORLD.md)
     - [RACES_AND_ANATOMY.md](file:///c:/Users/samael.samoilenko/Desktop/Projs/traveler/docs/lore/RACES_AND_ANATOMY.md)
     - [CHARACTERS.md](file:///c:/Users/samael.samoilenko/Desktop/Projs/traveler/docs/lore/CHARACTERS.md)
     - [BESTIARY.md](file:///c:/Users/samael.samoilenko/Desktop/Projs/traveler/docs/lore/BESTIARY.md)
     - [PLACES_AND_ITEMS.md](file:///c:/Users/samael.samoilenko/Desktop/Projs/traveler/docs/lore/PLACES_AND_ITEMS.md)

## 3. Verification Gate
Run both gates after every narrative or structural edit:
```powershell
node scripts/validate-lore.ts
node --test test/engine.test.ts
```
