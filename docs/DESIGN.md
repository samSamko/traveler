# Traveler — Setting Bible & Design Specification

## 1. Setting: The Gloaming Reach
Centuries ago, the **First Kiln of Aethel** shattered when the ancient Crown-Wrought hollowed out the deep root-veins of the earth to burn soul-amber (**Vesper**). Now, from the subterranean abyss rises **the Husk-Tide**: a slow calcifying curse of pale roots, chitin-ash, and resonant bronze chimes that hollows out the living.

In the **Sunken Belfry** at the heart of the Gloaming Reach, **Malakor, the Choir-Husk** prepares to sound the **Third Drowning Toll**. At sunset on **Day 14**, the toll will calcify every living soul in the valley unless a traveler crosses the frontier, uncovers the Belfry's three Counter-Seals/Weaknesses, and confronts Malakor.

## 2. Binary Sex & Social Reactivity
The frontier holds rigid ancient customs tied to bloodlines, priesthoods, and levies (`male` / `female`):
- Sets pronouns (`he/him/his` vs `she/her/hers`) and formal titles (`Brother/Lord/Master` vs `Sister/Lady/Mistress`).
- **The Matrons of the Silken Cistern** natively welcome women (`female` unlocks the *Unveiled Sisterhood* dialogue, lower DC, and lore gift) while distrusting men (`male` must pass a harder check or swear a blood-oath trial).
- **The Iron-Vow Garrison at Cinderford** operates under old patriarchal martial law (`male` receives immediate muster recognition from Captain Vane; `female` faces skepticism at the muster table, unlocking a unique defiance branch for veteran respect and a Grit boon).
- Road events (Mourning Widow, Hollow-Bride Shrine, Conscript Press-Gang) branch narration and tactical options by sex.

## 3. The Four Original Races
1. **Vaelorian** (*Ash-Born Inheritors — Human equivalent*): `Might +1, Wit +1, Grit +1`. Passive: *Unbound Will* (`+2` on all d20 rolls below 50% HP; `+1` free Inspiration reroll bonus per rest). Cantrip: **Kiln-Spark**. Unlocks Imperial Blood-Charter & High Vaelish seal actions.
2. **Ael-Thalor** (*Dusk-Woven Exiles — Elf equivalent*): `Agility +2, Wit +2, Grit -1`. Passive: *Star-Sight* (Immune to ambush; `+2` Lore/Perception/Arcane rolls; detects hidden root-blight). Cantrip: **Gloam-Weave**. Unlocks Memory-Canticle pacification & Star-Script translation.
3. **Durnfolk** (*Basalt-Kin — Dwarf equivalent*): `Might +2, Grit +2, Agility -1`. Passive: *Stone-Lung & Iron-Rib* (`+2` base Armor; 50% resistance to Poison/Blight/Bleed; can hone weapons at camp for `+1` damage). Technique/Cantrip: **Runic Anvil-Strike**. Unlocks counterweight vaults & relic re-forging.
4. **Grixi** (*Brass-Warren Guild-Clerks — Civilized Goblin equivalent*): `Agility +2, Wit +2, Might -1`. Passive: *Scrap-Savant & Under-Cant* (`+25%` Crowns looted; `+2` Alchemy/Trap/Stealth/Barter rolls; black-market stock access). Cantrip: **Vesper-Flask**. Unlocks chitin-vent bypasses, Under-Warren cipher, & organ harvesting.

## 4. Backgrounds & Heirlooms
- **Backgrounds**: *Ashen Blade*, *Root-Scholar*, *Barrow-Stalker*, *Shrine-Penitent* — each supplying starting gear, martial skills, spells/cantrips, and story tags.
- **Heirlooms** (1/combat encounter + special world hooks):
  1. *Lantern of the First Kiln* (Starter)
  2. *Bell-Shard of St. Orin* (Unlock: reach Day 7 or defeat an elite)
  3. *Vial of Star-Dew* (Unlock: uncover 2+ lore secrets or aid the Silken Cistern)
  4. *Grixi Chronometer-Compass* (Unlock: hold 100+ Crowns in a run or win a run)

## 5. Deep Memory, Factions & Three Counter-Seals
All decisions mutate `WorldMemory` (`flags`, `factions`, `chronicle`):
- **Factions** (`-5` to `+5`): `iron_vow`, `silken_cistern`, `under_warren`, `husk_choir`.
- **Major Consequence Chains**:
  - **Cinderford Granary**: Burn vs Purify vs Cover-Up (affects food prices, Cinderford survival on Day 8+, and Iron-Vow attitude).
  - **Kale the Deserter**: Execute vs Redeem vs Rob (redeeming Kale weakens Malakor by 20% HP at the Belfry; abandoning him spawns Husk-Stalker Kale ambush).
  - **Silken Cistern**: Earn *Seal of Silence* vs Steal the Vesper-Font (hunted by Silk-Assassins).
  - **Sir Vorne**: Discover oath at Weeping Barrow (`vorne_oath_known`) to redeem him instead of fighting, gaining his *Bell-Cleaver* and aid at the Belfry.
  - **Counter-Seals vs Malakor**: *Seal of Silence* (`seal_of_silence`), *Root Conduit Severed* (`root_conduit_severed`), and *Kiln Cipher* (`kiln_cipher_learned`) strip Malakor's final-boss mechanics and open 3 distinct endings.
