import type { WorldDatabase } from '../db/loader.ts';
import type {
  AbilityName,
  ActiveContract,
  ArmorTier,
  CalendarDie,
  Character,
  ClassId,
  GameState,
  InventoryItem,
  OpeningHook,
  WeaponDef,
} from '../types.ts';
import {
  ensureFeatureState,
  parseDiceExprDetailed,
  roll4d6DropLowestDetailed,
  rollDie,
  scoreToAbilityMod,
} from '../dice.ts';
import { applyClassFeatureStartingLoadout } from './class_features.ts';
import { rollContractRewards, rollContractSize } from './dungeon.ts';

export function buildPersonalContractHook(
  members: Character[],
  rng: { rngState: number },
  world: WorldDatabase,
): { pcId: string; note: string; preferredRegionId?: string } {
  const living = members.filter((m) => m.status !== 'dead');
  const pc = living[rollDie(Math.max(1, living.length), rng) - 1] ?? members[0];
  if (!pc) return { pcId: 'pc_1', note: 'Only silver keeps the hangman and starvation at bay for one more dawn.' };

  const tale = pc.traits.troublingTale.toLowerCase();
  const origin = pc.traits.origin;

  // Detect region referenced in PC's origin for campaign continuity
  const matchedRegion = world.regions.find((r) =>
    origin.toLowerCase().includes(r.name.toLowerCase()) ||
    (r.id === 'wastland_schleswig' && (origin.toLowerCase().includes('wästland') || origin.toLowerCase().includes('schleswig'))) ||
    (r.id === 'valley_undead' && origin.toLowerCase().includes('valley of the unfortunate')),
  );

  if (tale.includes('massive debt')) {
    return {
      pcId: pc.id,
      note: `${pc.name}'s traded debt ledger has landed in this patron's hands — finish the job or lose your fingers.`,
      preferredRegionId: matchedRegion?.id,
    };
  }
  if (tale.includes('manslaughter') || tale.includes('deserted military') || tale.includes('murdered a close relative')) {
    return {
      pcId: pc.id,
      note: `They know the blood on ${pc.name}'s name and promise silence — and forged papers — only if you return with the prize.`,
      preferredRegionId: matchedRegion?.id,
    };
  }
  if (tale.includes('escaped cult')) {
    return {
      pcId: pc.id,
      note: `${pc.name} recognizes the same crooked cult marks on the wax seal — running is no longer an option.`,
      preferredRegionId: matchedRegion?.id,
    };
  }
  if (tale.includes('royal family')) {
    return {
      pcId: pc.id,
      note: `Whispers of ${pc.name}'s treasonous royal affair have reached the wrong ears; this contract buys another week of breath.`,
      preferredRegionId: matchedRegion?.id,
    };
  }
  if (tale.includes('rare, sought after')) {
    return {
      pcId: pc.id,
      note: `Word of ${pc.name}'s coveted relic drew hungry eyes — take this dive into the dark or face hired knives in the alley.`,
      preferredRegionId: matchedRegion?.id,
    };
  }

  // Class-driven personal stakes
  if (pc.classId === 'heretical_priest') {
    return {
      pcId: pc.id,
      note: `Galgenbeck's Inquisition is closing on ${pc.name}; surviving another night requires silver and darker relics than theirs.`,
      preferredRegionId: matchedRegion?.id,
    };
  }
  if (pc.classId === 'wretched_royalty') {
    return {
      pcId: pc.id,
      note: `What little remains of ${pc.name}'s ruined bloodline demands coin — or at least a blade sharp enough to keep the peons back.`,
      preferredRegionId: matchedRegion?.id,
    };
  }
  if (pc.classId === 'esoteric_hermit') {
    return {
      pcId: pc.id,
      note: `The stars above ${pc.name}'s cave warned that this vault hides a shard of causality worth bleeding for.`,
      preferredRegionId: matchedRegion?.id,
    };
  }
  if (pc.classId === 'occult_herbmaster') {
    return {
      pcId: pc.id,
      note: `Only the rot below yields rare spores for ${pc.name}'s portable laboratory — and the patron's silver buys clean glass.`,
      preferredRegionId: matchedRegion?.id,
    };
  }
  if (pc.classId === 'fanged_deserter') {
    return {
      pcId: pc.id,
      note: `No army will take ${pc.name} back; only filthy jobs in forgotten pits still pay for teeth and iron.`,
      preferredRegionId: matchedRegion?.id,
    };
  }
  if (pc.classId === 'gutterborn_scum') {
    return {
      pcId: pc.id,
      note: `${pc.name} knows every gutter fence in the Dying World — and knows refusing this mark means floating face-down by dawn.`,
      preferredRegionId: matchedRegion?.id,
    };
  }

  return {
    pcId: pc.id,
    note: `With the Seventh Seal creeping closer, ${pc.name} takes the only coin still warm in the Dying World — blood silver beneath the earth.`,
    preferredRegionId: matchedRegion?.id,
  };
}

function pickInitialContract(
  world: WorldDatabase,
  rng: { rngState: number },
  hook: OpeningHook,
  members: Character[],
): ActiveContract {
  const obj = world.campaigns.objectives[rollDie(world.campaigns.objectives.length, rng) - 1];
  const d1 = world.dungeonTables.nameFirst[rollDie(world.dungeonTables.nameFirst.length, rng) - 1];
  const d2 = world.dungeonTables.nameSecond[rollDie(world.dungeonTables.nameSecond.length, rng) - 1];
  const contractSize = rollContractSize(1, rng);
  const { rewardSilver, travelLegsRemaining } = rollContractRewards(contractSize, rng);
  const personal = buildPersonalContractHook(members, rng, world);

  return {
    contractNumber: 1,
    patronName: hook.who,
    patronHook: `While ${hook.where.toLowerCase()}, ${hook.who} corners you beneath a grey sky. The crisis: ${hook.spark}. Desperate for disposable necks, they point you toward ${`The ${d1} ${d2}`} and promise silver if you crawl back alive.`,
    objectiveId: obj.id,
    objectiveKind: obj.kind,
    objectiveTitle: obj.title,
    targetName: obj.targetName,
    objectiveBrief: obj.brief,
    refusesLeave: obj.refusesLeave,
    dungeonName: `The ${d1} ${d2}`,
    rewardSilver,
    prophecies: ['A hollow eye watches from stone.', 'Something vast hungers beneath the black mud.'],
    prophecyTruthIndex: 0,
    prophecyRevealed: false,
    phase: 'briefing',
    travelLegsRemaining,
    objectiveSecured: false,
    bossSlain: false,
    shopVisited: false,
    personalHookPcId: personal.pcId,
    personalHookNote: personal.note,
    negotiated: false,
    contractSize,
    activeVignetteId: null,
    vignetteResolved: false,
  };
}

function pickName(world: WorldDatabase, rng: { rngState: number }): { name: string; d6: number; d8: number } {
  const d6 = rollDie(6, rng);
  const d8 = rollDie(8, rng);
  const found = world.names.find((n) => n.d6 === d6 && n.d8 === d8);
  return { name: found ? found.name : 'Wemut', d6, d8 };
}

function pickScrollItem(
  world: WorldDatabase,
  kind: 'unclean' | 'sacred',
  rng: { rngState: number },
  uid: string,
): InventoryItem {
  const list = kind === 'unclean' ? world.uncleanScrolls : world.sacredScrolls;
  const roll = rollDie(list.length, rng);
  const scroll = list.find((s) => s.roll === roll) ?? list[0];
  return {
    id: uid,
    name: `${kind === 'unclean' ? 'Unclean' : 'Sacred'} Scroll: ${scroll.name}`,
    kind: kind === 'unclean' ? 'unclean_scroll' : 'sacred_scroll',
    scrollKind: kind,
    scrollRoll: scroll.roll,
    notes: scroll.effect,
  };
}

export function generateCharacter(
  world: WorldDatabase,
  classId: ClassId,
  rng: { rngState: number },
  index: number,
  options?: { customName?: string },
): Character {
  const namePick = pickName(world, rng);
  const name = options?.customName?.trim() || namePick.name;
  const classDef = classId === 'classless' ? null : world.classesById[classId];
  const creationRolls: Record<string, string> = {
    name: `[${namePick.d6}, ${namePick.d8}] -> ${name}`,
  };

  // 1. Abilities
  const abilities: Record<AbilityName, number> = {
    agility: 0,
    presence: 0,
    strength: 0,
    toughness: 0,
  };
  const fmtSigned = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

  if (!classDef) {
    // Classless PCs: roll 4d6 drop lowest for two abilities, 3d6 for the other two (p. 27)
    const keys: AbilityName[] = ['agility', 'presence', 'strength', 'toughness'];
    const boosted = new Set<number>();
    while (boosted.size < 2) {
      boosted.add(rollDie(4, rng) - 1);
    }
    keys.forEach((k, idx) => {
      const isBoosted = boosted.has(idx);
      const res = isBoosted ? roll4d6DropLowestDetailed(rng) : parseDiceExprDetailed('3d6', rng);
      abilities[k] = scoreToAbilityMod(res.total);
      creationRolls[`${k}Formula`] = isBoosted ? '4d6 drop lowest' : '3d6';
      creationRolls[k] = `${res.detail} -> ${fmtSigned(abilities[k])}`;
    });
  } else {
    for (const k of ['agility', 'presence', 'strength', 'toughness'] as const) {
      const res = parseDiceExprDetailed(classDef.abilityRolls[k], rng);
      abilities[k] = scoreToAbilityMod(res.total);
      creationRolls[`${k}Formula`] = classDef.abilityRolls[k];
      creationRolls[k] = `${res.detail} -> ${fmtSigned(abilities[k])}`;
    }
  }

  // 2. Starting container, gear A & gear B
  const inventory: InventoryItem[] = [];
  let itemSeq = 1;
  const nextUid = () => `pc${index}_item_${itemSeq++}`;

  const contRoll = rollDie(6, rng);
  const container =
    world.startingContainers.find((c) => contRoll >= c.rollMin && contRoll <= c.rollMax) ??
    world.startingContainers[0];

  let gearARoll = rollDie(12, rng);
  if (classDef && !classDef.canUseScrolls && gearARoll === 5) {
    // Fanged Deserter is illiterate: reroll starting scroll (p. 46)
    while (gearARoll === 5) gearARoll = rollDie(12, rng);
  }
  const gearA = world.startingGearA.find((g) => g.roll === gearARoll) ?? world.startingGearA[0];

  let gearBRoll = rollDie(12, rng);
  if (classDef && !classDef.canUseScrolls && gearBRoll === 2) {
    while (gearBRoll === 2) gearBRoll = rollDie(12, rng);
  }
  const gearB = world.startingGearB.find((g) => g.roll === gearBRoll) ?? world.startingGearB[0];

  let hasShield = false;
  let extraFood = 0;

  const pushGearEntry = (entry: { name: string; kind: string }) => {
    if (entry.kind === 'unclean_scroll') {
      inventory.push(pickScrollItem(world, 'unclean', rng, nextUid()));
    } else if (entry.kind === 'sacred_scroll') {
      inventory.push(pickScrollItem(world, 'sacred', rng, nextUid()));
    } else if (entry.kind === 'shield') {
      hasShield = true;
      inventory.push({ id: nextUid(), name: entry.name, kind: 'shield' });
    } else if (entry.kind === 'food') {
      extraFood += 5;
      inventory.push({ id: nextUid(), name: entry.name, kind: 'food' });
    } else {
      const lower = entry.name.toLowerCase();
      let uses: number | undefined;
      if (entry.kind === 'medicine') {
        uses = lower.includes('life elixir') ? rollDie(4, rng) : Math.max(1, abilities.presence + 4);
      } else if (entry.kind === 'poison') {
        uses = rollDie(4, rng);
      }
      inventory.push({
        id: nextUid(),
        name: entry.name,
        kind: entry.kind as InventoryItem['kind'],
        uses,
      });
    }
  };

  pushGearEntry(gearA);
  pushGearEntry(gearB);

  // Esoteric Hermit begins with an extra random scroll (p. 50)
  if (classId === 'esoteric_hermit') {
    const kind = rollDie(2, rng) === 1 ? 'sacred' : 'unclean';
    inventory.push(pickScrollItem(world, kind, rng, nextUid()));
  }

  // Occult Herbmaster brews 2 random decoctions (d4 total doses) (p. 56)
  if (classId === 'occult_herbmaster') {
    inventory.push({ id: nextUid(), name: 'Portable laboratory', kind: 'gear' });
    const doses = rollDie(4, rng);
    const r1 = rollDie(8, rng);
    const r2 = rollDie(8, rng);
    const d1 = world.herbmasterDecoctions.find((d) => d.roll === r1) ?? world.herbmasterDecoctions[0];
    const d2 = world.herbmasterDecoctions.find((d) => d.roll === r2) ?? world.herbmasterDecoctions[1];
    inventory.push({
      id: nextUid(),
      name: `Decoction: ${d1.name}`,
      kind: 'decoction',
      uses: Math.ceil(doses / 2),
      notes: d1.effect,
      expiresAtDawn: true,
    });
    if (doses > 1) {
      inventory.push({
        id: nextUid(),
        name: `Decoction: ${d2.name}`,
        kind: 'decoction',
        uses: Math.floor(doses / 2) || 1,
        notes: d2.effect,
        expiresAtDawn: true,
      });
    }
  }

  // Check if character starts with any scroll -> weapon d6, armor d2 (p. 23)
  const startsWithScroll = inventory.some(
    (i) => i.kind === 'unclean_scroll' || i.kind === 'sacred_scroll',
  );

  // 3. Weapon & Armor
  const baseWeaponDie = classDef ? classDef.weaponDie : 10;
  const weaponDie = startsWithScroll ? Math.min(baseWeaponDie, 6) : baseWeaponDie;
  const weaponRoll = rollDie(weaponDie, rng);
  const weapon: WeaponDef =
    world.weapons.find((w) => w.tableRoll === weaponRoll) ?? world.weaponsById.knife;
  const ammo = weapon.ranged ? Math.max(1, abilities.presence + 10) : 0;

  const baseArmorDie = classDef ? classDef.armorDie : 4;
  const armorDie = startsWithScroll ? Math.min(baseArmorDie, 2) : baseArmorDie;
  let armorRoll = rollDie(armorDie, rng);
  if (classDef?.canRerollHeavyArmor && armorRoll === 4) {
    while (armorRoll === 4) armorRoll = rollDie(armorDie, rng);
  }
  const armorDef = world.armors.find((a) => a.tableRoll === armorRoll) ?? world.armorsByTier[0];

  // 4. HP, Silver, Omens, Powers
  const hpDie = classDef ? classDef.hpDie : 8;
  const hpRoll = rollDie(hpDie, rng);
  const maxHp = Math.max(1, abilities.toughness + hpRoll);
  const silverRes = parseDiceExprDetailed(classDef ? classDef.silverFormula : '2d6*10', rng);
  const silver = silverRes.total;
  const omenDie = classDef ? classDef.omenDie : 2;
  const omens = rollDie(omenDie, rng);
  const powersRoll = rollDie(4, rng);
  const powersMaxToday = Math.max(0, abilities.presence + powersRoll);

  // 5. Traits & Class features
  const t1Roll = rollDie(world.terribleTraits.length, rng);
  const t1 = world.terribleTraits[t1Roll - 1].text;
  let t2Roll = rollDie(world.terribleTraits.length, rng);
  let t2 = world.terribleTraits[t2Roll - 1].text;
  if (t2 === t1) {
    const fallbackIdx = rollDie(world.terribleTraits.length, rng) % world.terribleTraits.length;
    t2Roll = fallbackIdx + 1;
    t2 = world.terribleTraits[fallbackIdx].text;
  }
  const bbRoll = rollDie(world.brokenBodies.length, rng);
  const bbEntry = world.brokenBodies[bbRoll - 1];
  const bhRoll = rollDie(world.badHabits.length, rng);
  const bhEntry = world.badHabits[bhRoll - 1];
  const ttRoll = rollDie(world.troublingTales.length, rng);
  const ttEntry = world.troublingTales[ttRoll - 1];
  const brokenBody = bbEntry.text;
  const badHabit = bhEntry.text;
  const troublingTale = ttEntry.text;

  // Mechanical items/hooks from Broken Bodies, Bad Habits, and Troubling Tales
  if (bbEntry.roll === 6) {
    inventory.push({ id: nextUid(), name: 'Rusting hook hand (d6 damage)', kind: 'gear' });
  }
  if (bhEntry.roll === 7) {
    inventory.push({ id: nextUid(), name: 'Skull (your best friend)', kind: 'gear' });
  }
  if (ttEntry.roll === 3) {
    inventory.push({ id: nextUid(), name: 'Rare sought-after relic', kind: 'treasure' });
  }
  if (ttEntry.roll === 16) {
    inventory.push({ id: nextUid(), name: 'Sling (d4, war with all corvids)', kind: 'gear' });
  }

  let origin = 'Drifter of the Dying World';
  const classFeatures: string[] = [];
  const featureRolls: number[] = [];
  if (classDef) {
    const oRoll = rollDie(classDef.originsDie, rng);
    const oEntry = classDef.origins.find((o) => oRoll >= o.rollMin && oRoll <= o.rollMax) ?? classDef.origins[0];
    origin = `${classDef.originsTitle}: ${oEntry.text}`;
    creationRolls.origin = `[${oRoll}] -> ${origin}`;

    const pickedRolls = new Set<number>();
    while (classFeatures.length < classDef.featuresCount && pickedRolls.size < classDef.features.length) {
      const fRoll = rollDie(classDef.features.length, rng);
      if (pickedRolls.has(fRoll)) continue;
      pickedRolls.add(fRoll);
      featureRolls.push(fRoll);
      const feat = classDef.features.find((f) => f.roll === fRoll);
      if (feat) {
        classFeatures.push(`${feat.name}: ${feat.description}`);
        if (feat.name === 'Filthy Fingersmith') {
          inventory.push({ id: nextUid(), name: 'Lockpicks', kind: 'gear' });
        }
      }
    }
  }

  creationRolls.hp = `(${fmtSigned(abilities.toughness)}) + [${hpRoll}] = ${maxHp} HP`;
  creationRolls.omens = `[${omens}] = ${omens} Omen${omens === 1 ? '' : 's'}`;
  creationRolls.powers = `(${fmtSigned(abilities.presence)}) + [${powersRoll}] = ${powersMaxToday}`;
  creationRolls.silver = `${silverRes.detail}s`;
  creationRolls.weaponFormula = startsWithScroll && weaponDie < baseWeaponDie ? `d${weaponDie} (scroll cap)` : `d${weaponDie}`;
  creationRolls.armorFormula = startsWithScroll && armorDie < baseArmorDie ? `d${armorDie} (scroll cap)` : `d${armorDie}`;
  creationRolls.weapon = `[${weaponRoll}] -> ${weapon.name}`;
  creationRolls.armor = `[${armorRoll}] -> ${armorDef.name} (Tier ${armorDef.tier})`;
  creationRolls.gear = `[${contRoll}, ${gearARoll}, ${gearBRoll}] -> ${container.name}, ${inventory.map((i) => i.name).join('; ')}`;
  creationRolls.terrible = `[${t1Roll}, ${t2Roll}] -> ${t1} / ${t2}`;
  creationRolls.brokenBody = `[${bbRoll}] -> ${brokenBody}`;
  creationRolls.badHabit = `[${bhRoll}] -> ${badHabit}`;
  creationRolls.troublingTale = `[${ttRoll}] -> ${troublingTale}`;
  if (featureRolls.length > 0) {
    creationRolls.classFeatures = `[${featureRolls.join(', ')}] -> ${classFeatures.join(' | ')}`;
  }

  const pc: Character = {
    id: `pc_${index}`,
    name,
    classId,
    className: classDef ? classDef.name : 'Classless Scvm',
    abilities,
    hp: maxHp,
    maxHp,
    status: 'alive',
    brokenNote: null,
    omens,
    omenDie,
    powersRemaining: powersMaxToday,
    powersMaxToday,
    dizzyHours: 0,
    silver,
    weapon,
    weaponBroken: false,
    ammo,
    armorTier: armorDef.tier as ArmorTier,
    armorMaxTier: armorDef.tier as ArmorTier,
    armorName: armorDef.name,
    hasShield,
    containerName: container.name,
    carryingCapacity: Math.max(1, abilities.strength + 8 + container.capacityBonus),
    inventory,
    foodDays: rollDie(4, rng) + extraFood,
    waterDays: 4,
    daysWithoutFood: 0,
    infected: false,
    traits: {
      terrible: [t1, t2],
      brokenBody,
      badHabit,
      troublingTale,
      origin,
    },
    classFeatures,
    arcaneCatastrophes: [],
    notes: [],
    creationRolls,
  };
  if (pc.inventory.some((i) => i.name.toLowerCase().includes('vicious dog'))) {
    ensureFeatureState(pc).dogHp = rollDie(6, rng) + 2;
  }
  if (pc.inventory.some((i) => i.name.toLowerCase().includes('monkeys'))) {
    ensureFeatureState(pc).monkeyCount = rollDie(4, rng);
  }
  applyClassFeatureStartingLoadout(pc);
  return pc;
}

export function rollOpeningHook(world: WorldDatabase, rng: { rngState: number }): OpeningHook {
  const whereRoll = rollDie(world.whereDoYouWander.length, rng);
  const whereEntry = world.whereDoYouWander.find((w) => w.roll === whereRoll) ?? world.whereDoYouWander[0];
  const region = world.regionsById[whereEntry.regionId] ?? world.regions[0];

  const whoRoll = rollDie(world.whoContactsYou.length, rng);
  const whoEntry = world.whoContactsYou.find((w) => w.roll === whoRoll) ?? world.whoContactsYou[0];

  const sparkRoll = rollDie(100, rng);
  const sparkEntry =
    world.adventureSparks.find((s) => sparkRoll >= s.rollMin && sparkRoll <= s.rollMax) ??
    world.adventureSparks[0];

  const weatherRoll = rollDie(world.weather.length, rng);
  const weatherEntry = world.weather.find((w) => w.roll === weatherRoll) ?? world.weather[0];

  return {
    regionId: region.id,
    regionName: region.name,
    where: whereEntry.text,
    who: whoEntry.text,
    spark: sparkEntry.text,
    weather: weatherEntry.text,
    rolls: {
      where: whereRoll,
      weather: weatherRoll,
      who: whoRoll,
      spark: sparkRoll,
    },
  };
}

export function rollPartySize(rng: { rngState: number }): { dieRoll: number; count: number } {
  const dieRoll = rollDie(3, rng);
  return { dieRoll, count: dieRoll + 1 };
}

export function createInitialGameState(
  world: WorldDatabase,
  options?: {
    seed?: number;
    calendarDie?: CalendarDie;
    classChoices?: ClassId[];
    useRandomClasses?: boolean;
    solo?: boolean;
  },
): GameState {
  const rng = { rngState: (options?.seed ?? Date.now()) >>> 0 };
  const sizeRoll = options?.solo ? { dieRoll: 0, count: 1 } : rollPartySize(rng);
  const allClassIds: ClassId[] = [
    'fanged_deserter',
    'gutterborn_scum',
    'esoteric_hermit',
    'wretched_royalty',
    'heretical_priest',
    'occult_herbmaster',
  ];

  const members: Character[] = [];
  for (let i = 0; i < sizeRoll.count; i += 1) {
    let chosenClass: ClassId = 'classless';
    if (options?.classChoices && options.classChoices[i]) {
      chosenClass = options.classChoices[i];
    } else if (options?.useRandomClasses) {
      const r = rollDie(7, rng); // 1-6 optional classes, 7 classless
      chosenClass = r <= 6 ? allClassIds[r - 1] : 'classless';
    }
    members.push(generateCharacter(world, chosenClass, rng, i + 1));
  }

  const hook = rollOpeningHook(world, rng);
  const calendarDie: CalendarDie = options?.calendarDie ?? 10;
  const activeContract = pickInitialContract(world, rng, hook, members);

  return {
    version: 2,
    mode: 'exploration',
    rngState: rng.rngState,
    party: {
      rolledSizeDie: sizeRoll.dieRoll,
      members,
      followers: [],
      activePcIndex: 0,
    },
    calendar: {
      die: calendarDie,
      day: 1,
      hour: 8,
      triggeredMiseries: [],
      worldEnded: false,
    },
    hook,
    currentRegionId: hook.regionId,
    currentRegionName: hook.regionName,
    currentWeather: hook.weather,
    activeContract,
    activeDungeon: null,
    activeCombat: null,
    chronicle: [
      options?.solo
        ? `Solo wretch enters the Dying World: ${members[0].name} (${members[0].className}).`
        : `Rolled d3(${sizeRoll.dieRoll})+1 = ${sizeRoll.count} wretched souls: ${members.map((m) => `${m.name} (${m.className})`).join(', ')}.`,
      `Hook: ${hook.where}. Contact: ${hook.who}. Spark: ${hook.spark}. Weather: ${hook.weather}.`,
      `Contract #1: ${activeContract.objectiveTitle} at ${activeContract.dungeonName} (${activeContract.rewardSilver}s).`,
    ],
    lastEvents: [
      options?.solo
        ? `Solo run: 1 PC (${members[0].name}).`
        : `Party size rolled: d3(${sizeRoll.dieRoll}) + 1 = ${sizeRoll.count} PCs.`,
      `Calendar of Nechrubel set to d${calendarDie}.`,
    ],
    pendingNarration: '',
    pendingChoices: [],
    pendingChoiceOptions: [],
    recentProseIds: [],
    gameOverReason: null,
  };
}
