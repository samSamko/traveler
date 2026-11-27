import type { WorldDatabase } from '../db/loader.ts';
import type { ChoiceOption, DungeonRoom, GameState, InventoryItem } from '../types.ts';
import { applyBrokenOrDead, rollReaction, startCombat } from '../combat.ts';
import { ensureFeatureState, parseDiceExpr, rollAbilityTest, rollDice, rollDie } from '../dice.ts';
import { improveCharacter } from '../rules/advancement.ts';
import { buildPersonalContractHook } from '../rules/chargen.ts';
import { getActiveMiseryEffects } from '../rules/calendar.ts';
import { grantBeastToPc, recruitOutcastFollower } from '../rules/class_features.ts';
import { generateProceduralDungeon, rollContractRewards, rollContractSize } from '../rules/dungeon.ts';
import { DUNGEON_RIDDLES, ROAD_VIGNETTES, pickRoadVignette } from './narration.ts';
import { advanceWorldHours } from '../rules/rest.ts';
import {
  getTraitDrModifier,
  getTraitReactionModifier,
  getUnlockedTraitChoices,
  hasTraitTag,
  pickTraitProseCallout,
  rollTroublingTalePursuer,
} from '../rules/traits.ts';

function pickProse(state: GameState, category: string, list: string[]): string {
  if (list.length === 0) return '';
  const candidates = list.map((text, idx) => ({ id: `${category}_${idx}`, text }));
  const fresh = candidates.filter((c) => !state.recentProseIds.includes(c.id));
  const pool = fresh.length > 0 ? fresh : candidates;
  const chosen = pool[rollDie(pool.length, state) - 1];
  state.recentProseIds.push(chosen.id);
  if (state.recentProseIds.length > 24) {
    state.recentProseIds = state.recentProseIds.slice(-24);
  }
  return chosen.text;
}

function getActivePcIndex(state: GameState): number {
  const active = state.party.members[state.party.activePcIndex];
  if (active && active.status === 'alive') return state.party.activePcIndex;
  const idx = state.party.members.findIndex((m) => m.status === 'alive');
  return idx >= 0 ? idx : 0;
}

function getContextTagsForRoom(state: GameState, room: DungeonRoom): Set<string> {
  const tags = new Set<string>(['always']);
  if (room.corpsesRemaining > 0 || room.role === 'cells' || room.role === 'debris_room' || room.role === 'ossuary') tags.add('corpses');
  if (room.role === 'rival_sanctuary' || room.role === 'cells' || room.role === 'shrine') tags.add('parley');
  if (room.role === 'rival_sanctuary') tags.add('brew');
  if (room.role === 'hazard_rim' || room.role === 'boss_lair' || room.role === 'puzzle_statue' || room.role === 'trap_gallery' || room.role === 'ritual_sanctum') tags.add('hazard');
  if (room.role === 'dining_hall' || room.role === 'library' || room.role === 'guard_post' || room.role === 'rival_sanctuary' || room.role === 'ritual_sanctum') {
    tags.add('burnable');
  }
  if (state.activeDungeon?.centralHazardId === 'sulfuric_tar_vats') tags.add('burnable');
  return tags;
}

const COMBAT_USEFUL_RELIC_NAMES = new Set([
  'Ash-grey ring',
  'Vile flute',
  'Malevolently-accurate mirror',
  'Vampiric phurba',
  'Black pearl',
  'Immortal torch',
  'Black Crown of the Crippled King',
  'Ancient blindfold',
]);

function grantOccultRelic(
  pc: GameState['party']['members'][number],
  state: GameState,
  world: WorldDatabase,
  preferCombatUseful = true,
): { item: InventoryItem; name: string } {
  const pool = preferCombatUseful
    ? world.occultTreasures.filter((t) => COMBAT_USEFUL_RELIC_NAMES.has(t.name))
    : world.occultTreasures;
  const source = pool.length > 0 ? pool : world.occultTreasures;
  const relic = source[rollDie(source.length, state) - 1];
  const isFlavorOnly = !COMBAT_USEFUL_RELIC_NAMES.has(relic.name);
  const item: InventoryItem = {
    id: `relic_${Date.now()}_${rollDie(999, state)}`,
    name: isFlavorOnly ? `${relic.name} (50s)` : relic.name,
    kind: isFlavorOnly ? 'treasure' : 'relic',
    silverValue: isFlavorOnly ? 50 : 60,
    notes: relic.effect,
  };
  pc.inventory.push(item);
  return { item, name: relic.name };
}

function triggerGuardAlertIfNoisy(state: GameState, world: WorldDatabase, room: DungeonRoom): string[] {
  const d = state.activeDungeon;
  if (!d || room.silenced || room.noiseAlertsRoomId === null || room.noiseAlertsRoomId === undefined) return [];
  if (d.guardsAlerted) return [];

  const guardRoom = d.rooms[room.noiseAlertsRoomId];
  if (!guardRoom || guardRoom.enemyIds.length === 0) return [];

  d.guardsAlerted = true;
  const sentCount = Math.min(2, guardRoom.enemyIds.length);
  const incoming = guardRoom.enemyIds.splice(0, sentCount);
  const combat = startCombat(state, world, incoming, false);
  return [
    `The noise carries to ${guardRoom.label}! ${sentCount} Crooked Guard(s) storm into the room!`,
    ...combat.log,
  ];
}

function ensureSocketItemInParty(state: GameState): boolean {
  const d = state.activeDungeon;
  if (!d) return false;
  return state.party.members.some((m) =>
    m.inventory.some((i) => i.name.includes(d.puzzleSocketItemName)),
  );
}

export function rollNextContract(state: GameState, world: WorldDatabase): string[] {
  const patron = world.campaigns.patrons[rollDie(world.campaigns.patrons.length, state) - 1];
  const obj = world.campaigns.objectives[rollDie(world.campaigns.objectives.length, state) - 1];
  const d1 = world.dungeonTables.nameFirst[rollDie(world.dungeonTables.nameFirst.length, state) - 1];
  const d2 = world.dungeonTables.nameSecond[rollDie(world.dungeonTables.nameSecond.length, state) - 1];
  const nextNum = state.activeContract.contractNumber + 1;
  const personal = buildPersonalContractHook(state.party.members, state, world);
  const useOriginRegion = Boolean(personal.preferredRegionId) && rollDie(5, state) <= 2;
  const region =
    (useOriginRegion && world.regionsById[personal.preferredRegionId!]) ||
    world.regions[rollDie(world.regions.length, state) - 1];

  const includeDemand = nextNum >= 3 || rollDie(10, state) <= 3;
  const basiliskDemand = includeDemand
    ? world.basilisksDemand[rollDie(world.basilisksDemand.length, state) - 1].text
    : undefined;
  const contractSize = rollContractSize(nextNum, state);
  const sized = rollContractRewards(contractSize, state);
  const rewardSilver = sized.rewardSilver + nextNum * 15 + (basiliskDemand ? 40 : 0);

  state.currentRegionId = region.id;
  state.currentRegionName = region.name;
  state.activeDungeon = null;
  state.mode = 'exploration';

  state.activeContract = {
    contractNumber: nextNum,
    patronName: patron.name,
    patronHook: patron.hookIntro,
    objectiveId: obj.id,
    objectiveKind: obj.kind,
    objectiveTitle: obj.title,
    targetName: obj.targetName,
    objectiveBrief: obj.brief,
    refusesLeave: obj.refusesLeave,
    dungeonName: `The ${d1} ${d2}`,
    rewardSilver,
    prophecies: ['A hidden idol demands a grisly offering.', 'Flesh and oil await beneath the earth.'],
    prophecyTruthIndex: 0,
    prophecyRevealed: false,
    phase: 'briefing',
    travelLegsRemaining: sized.travelLegsRemaining,
    objectiveSecured: false,
    bossSlain: false,
    shopVisited: false,
    personalHookPcId: personal.pcId,
    personalHookNote: personal.note,
    basiliskDemand,
    negotiated: false,
    contractSize,
    activeVignetteId: null,
    vignetteResolved: false,
  };

  generateProceduralDungeon(state, world);
  state.chronicle.push(`Contract #${nextNum}: ${obj.title} at ${state.activeContract.dungeonName} (${rewardSilver}s).`);
  return [
    `Word of your survival spreads beneath the Blind Seer's curtain (${state.calendar.triggeredMiseries.length}/7 Miseries fulfilled).`,
    `New Contract #${nextNum} from ${patron.name}: ${obj.title} in ${region.name} (${rewardSilver}s).`,
  ];
}

export function buildProceduralScene(state: GameState, world: WorldDatabase): void {
  const pc = state.party.members[getActivePcIndex(state)] ?? state.party.members[0];
  const contract = state.activeContract;
  const traitCallout = pickTraitProseCallout(pc, state, world);
  const options: ChoiceOption[] = [];

  if (state.mode === 'game_over' || state.mode === 'combat') {
    state.pendingChoiceOptions = [];
    state.pendingChoices = [];
    return;
  }

  // Phase 1: Contract & Seer Briefing
  if (contract.phase === 'briefing') {
    if (!state.activeDungeon) {
      generateProceduralDungeon(state, world);
    }
    const seerIntro = pickProse(state, 'seer', world.proseFragments.seerIntros);
    const tagFor = (idx: number) => {
      if (!contract.prophecyRevealed || contract.prophecyTruthIndex === undefined) return '';
      return contract.prophecyTruthIndex === idx ? ' [VERIFIED TRUE]' : ' [FALSE RUMOR]';
    };
    const sizeTag =
      contract.contractSize === 'small'
        ? 'Quick Hunt'
        : contract.contractSize === 'large'
          ? 'Deep Descent, 2 Floors'
          : 'Standard Delve';
    const lines = [
      `--- Contract #${contract.contractNumber} (via ${contract.patronName}) ---`,
      `${contract.patronHook}`,
      `Target (${sizeTag}): ${contract.objectiveTitle} inside ${contract.dungeonName} (Bounty: ${contract.rewardSilver}s). ${contract.objectiveBrief}`,
    ];
    if (contract.personalHookNote) {
      lines.push(`Personal Stake: ${contract.personalHookNote}`);
    }
    if (contract.basiliskDemand) {
      lines.push(`Basilisks' Demand (p. 36): The patron also whispers of "${contract.basiliskDemand}" (+40s tithe included).`);
    }
    lines.push(
      '',
      `--- The Seer's Omens (one true, one false) ---`,
      `${seerIntro}`,
      `  1) "${contract.prophecies[0]}"${tagFor(0)}`,
      `  2) "${contract.prophecies[1]}"${tagFor(1)}`,
    );
    if (traitCallout) {
      lines.push('', `--- ${pc.name} ---`, traitCallout);
    }

    options.push({ label: `Press the Seer for details about ${contract.dungeonName} (Presence DR10)`, actionId: 'briefing_question_seer', requiresRoll: true });
    if (!contract.shopVisited) {
      options.push({ label: 'Buy travel rations & waterskin refill before departing (6s) — or type "shop"', actionId: 'briefing_buy_supplies' });
    }
    if (!contract.outcastHired && state.party.followers.filter((f) => f.status === 'alive').length < 2) {
      options.push({ label: 'Hire a wandering Outcast sellsword for the delve (25s)', actionId: 'briefing_hire_outcast' });
    }
    options.push({ label: `Depart into ${state.currentRegionName} toward ${contract.dungeonName}`, actionId: 'briefing_depart' });

    if (!contract.negotiated) {
      if (pc.classId === 'wretched_royalty') {
        options.push({ label: '[Wretched Royalty] Invoke noble bloodline to demand +30% bounty (Presence DR12)', actionId: 'briefing_class_royalty', requiresRoll: true });
      } else if (pc.classId === 'fanged_deserter') {
        options.push({ label: '[Fanged Deserter] Bare your teeth and extort 20s advance silver (Strength DR12)', actionId: 'briefing_class_deserter', requiresRoll: true });
      } else if (pc.classId === 'gutterborn_scum') {
        options.push({ label: '[Gutterborn Scum] Tap gutter informants for a hidden shortcut (-1 travel leg, Agility DR10)', actionId: 'briefing_class_scum', requiresRoll: true });
      } else if (pc.classId === 'esoteric_hermit') {
        options.push({ label: "[Esoteric Hermit] Read Verhu's stars to expose the false Seer omen (Presence DR8)", actionId: 'briefing_class_hermit', requiresRoll: true });
      } else if (pc.classId === 'heretical_priest') {
        options.push({ label: '[Heretical Priest] Scrutinize the seal & chant a dark ward (+d4 temp HP, Presence DR10)', actionId: 'briefing_class_priest', requiresRoll: true });
      } else if (pc.classId === 'occult_herbmaster') {
        options.push({ label: "[Occult Herbmaster] Sniff residual spores to identify the dungeon's central hazard (Presence DR10)", actionId: 'briefing_class_herbmaster', requiresRoll: true });
      }
    }

    const traitChoices = getUnlockedTraitChoices(pc, new Set(['always', 'parley']), world);
    options.push(...traitChoices.slice(0, 2));

    state.pendingNarration = lines.join('\n');
    state.pendingChoiceOptions = options;
    state.pendingChoices = options.map((o) => o.label);
    return;
  }

  // Phase 2: Overland Travel
  if (contract.phase === 'travel') {
    const open = pickProse(state, 'overland', world.proseFragments.overlandOpenings);
    const mood = pickProse(state, 'weather', world.proseFragments.weatherMoods);
    const regionSummary = world.regionsById[state.currentRegionId]?.summary;
    if (!contract.activeVignetteId && !contract.vignetteResolved) {
      const usedVig = state.recentProseIds.filter((id) => id.startsWith('vig_')).map((id) => id.slice(4));
      const picked = pickRoadVignette(state.currentRegionId, usedVig, state);
      contract.activeVignetteId = picked.id;
      state.recentProseIds.push(`vig_${picked.id}`);
      if (state.recentProseIds.length > 24) state.recentProseIds = state.recentProseIds.slice(-24);
    }
    const vignette =
      contract.activeVignetteId && !contract.vignetteResolved
        ? ROAD_VIGNETTES.find((v) => v.id === contract.activeVignetteId) ?? null
        : null;

    const lines = [
      `[${state.currentRegionName} — ${state.currentWeather}]`,
      ...(regionSummary ? [`${regionSummary}`] : []),
      `${open} ${mood} (${contract.travelLegsRemaining} travel leg(s) remain before ${contract.dungeonName}.)`,
    ];
    if (vignette) {
      lines.push(`Roadside Encounter: ${vignette.setup}`);
    }
    if (traitCallout) lines.push(traitCallout);

    if (vignette) {
      options.push({ label: vignette.actLabel, actionId: 'vignette_act', requiresRoll: true });
      options.push({ label: vignette.bypassLabel, actionId: 'vignette_bypass' });
    }
    options.push({ label: `March onward toward ${contract.dungeonName}`, actionId: 'travel_advance', requiresRoll: true });
    options.push({ label: 'Scout the roadside wreckage for silver or ambushes (Presence DR12)', actionId: 'travel_scout', requiresRoll: true });
    options.push({ label: 'Catch your breath and search for a trailside shelter', actionId: 'travel_rest', requiresRoll: true });

    const traitChoices = getUnlockedTraitChoices(pc, new Set(['always', 'burnable']), world);
    options.push(...traitChoices.slice(0, 2));

    state.pendingNarration = lines.join('\n');
    state.pendingChoiceOptions = options;
    state.pendingChoices = options.map((o) => o.label);
    return;
  }

  // Phase 3: Inside Procedural Sludge-style Dungeon
  const d = state.activeDungeon ?? generateProceduralDungeon(state, world).dungeon;
  const room = d.rooms[d.currentRoomId];
  const light = room.sensory?.light ?? pickProse(state, 'light', world.proseFragments.lightingDetails);
  const smell = room.sensory?.smell ?? pickProse(state, 'smell', world.proseFragments.sensorySmells);
  const sound = room.silenced
    ? 'Total, suffocating silence presses against your eardrums; even footsteps make no noise.'
    : room.sensory?.sound ??
      (room.role === 'hazard_rim' || room.role === 'boss_lair' || room.role === 'puzzle_statue'
        ? `${d.centralHazardName} fumes thick in the air.`
        : pickProse(state, 'sound', world.proseFragments.sensorySounds));
  const atmo = room.sensory?.atmo ?? pickProse(state, 'atmo', world.proseFragments.roomAtmospheres);

  const lines: string[] = [];
  if ((room.revisitCount ?? 0) === 0) {
    lines.push(`${room.feature}`, `${light} ${smell} ${sound} ${atmo}`);
  } else {
    const openNotes: string[] = [];
    if (room.silenced) openNotes.push('A heavy unnatural silence blankets the stone.');
    const unused = room.interactables.filter((i) => !i.used);
    if (unused.length > 0) openNotes.push(`${unused.length} point(s) of interest remain.`);
    if (room.corpsesRemaining > 0) openNotes.push(`${room.corpsesRemaining} unplundered corpse(s) lie here.`);
    if (room.trapSpotted && !room.trapTriggered && room.trap) openNotes.push(`Spotted hazard: ${room.trap}.`);
    if (openNotes.length === 0) openNotes.push('Picked clean; only cold echoes remain.');
    lines.push(`You stand again in ${room.label}. ${openNotes.join(' ')} (Type "look" for full details.)`);
  }
  if (traitCallout) lines.push(traitCallout);

  for (const inter of room.interactables) {
    if (inter.used) continue;
    if (inter.kind === 'riddle_door') {
      const riddle = DUNGEON_RIDDLES[d.riddleIndex ?? 0] ?? DUNGEON_RIDDLES[0];
      lines.push(`Riddle-Door: ${riddle.prompt}`);
      riddle.options.forEach((ans, idx) => {
        options.push({
          label: `Answer Riddle: "${ans}"`,
          actionId: 'riddle_answer',
          targetId: idx,
        });
      });
      options.push({
        label: `Brute-force ${d.puzzleStatueName}'s riddle-door open (Strength DR14)`,
        actionId: 'riddle_force',
        requiresRoll: true,
      });
      continue;
    }
    const needsRoll =
      inter.kind === 'bookshelf' ||
      inter.kind === 'pit_trap' ||
      inter.kind === 'hazard_cross' ||
      inter.kind === 'prisoners' ||
      inter.kind === 'rival_camp' ||
      inter.kind === 'objective' ||
      inter.kind === 'sabotage_altar' ||
      inter.kind === 'inscription_cipher' ||
      inter.kind === 'blood_altar' ||
      inter.kind === 'offering_scale' ||
      inter.kind === 'shrine_offering' ||
      inter.kind === 'ossuary_loot' ||
      inter.kind === 'stray_beast';
    options.push({
      label: inter.label,
      actionId: `interact:${inter.id}`,
      targetId: inter.kind,
      requiresRoll: needsRoll,
    });
  }

  if (room.corpsesRemaining > 0) {
    options.push({ label: `Plunder corpse in this room (${room.corpsesRemaining} remaining)`, actionId: 'dungeon_plunder', requiresRoll: true });
  }

  const contextTags = getContextTagsForRoom(state, room);
  const traitChoices = getUnlockedTraitChoices(pc, contextTags, world);
  options.push(...traitChoices.slice(0, 2));

  // Add armor doff/re-don option if adjacent to tight tunnel or stashed armor exists
  const nearTunnel = room.exits.some((id) => d.rooms[id]?.requiresNoHeavyArmor);
  if (nearTunnel && state.party.members.some((m) => m.status === 'alive' && m.armorTier === 3)) {
    options.push({ label: 'Stash heavy armor temporarily to fit through the tight crawlway', actionId: 'doff_heavy_armor' });
  }
  if (state.party.members.some((m) => m.status === 'alive' && m.stashedArmorTier !== undefined)) {
    options.push({ label: 'Re-equip your stashed heavy armor', actionId: 'don_heavy_armor' });
  }

  for (const exitId of room.exits) {
    const dest = d.rooms[exitId];
    if (!dest) continue;
    if (dest.secretHidden && !d.puzzleSolved) continue;
    const lockTag = dest.lockedByKey && !d.hasBossKey && room.role !== 'boss_lair' ? ' [LOCKED]' : '';
    options.push({
      label: `Move to Room #${exitId + 1}: ${dest.visited ? dest.label : 'Unexplored passage'}${lockTag}`,
      actionId: 'dungeon_move',
      targetId: exitId,
    });
  }

  if (room.id === 0) {
    const turnInTag =
      contract.objectiveSecured || (contract.objectiveKind === 'slay_boss' && contract.bossSlain)
        ? ' [COMPLETE CONTRACT]'
        : ' (Abandon / Surface)';
    options.push({ label: `Climb out to the surface${turnInTag}`, actionId: 'dungeon_leave' });
  }

  state.pendingNarration = lines.join('\n');
  state.pendingChoiceOptions = options;
  state.pendingChoices = options.map((o) => o.label);
}

export function describeCurrentRoomFull(state: GameState, world: WorldDatabase): string {
  if (state.mode !== 'dungeon' || !state.activeDungeon) {
    return state.pendingNarration || 'Nothing remarkable shifts around you.';
  }
  const d = state.activeDungeon;
  const room = d.rooms[d.currentRoomId];
  const light = room.sensory?.light ?? pickProse(state, 'light', world.proseFragments.lightingDetails);
  const smell = room.sensory?.smell ?? pickProse(state, 'smell', world.proseFragments.sensorySmells);
  const sound = room.silenced
    ? 'Total, suffocating silence presses against your eardrums; even footsteps make no noise.'
    : room.sensory?.sound ?? pickProse(state, 'sound', world.proseFragments.sensorySounds);
  const atmo = room.sensory?.atmo ?? pickProse(state, 'atmo', world.proseFragments.roomAtmospheres);
  const lines = [
    `[${d.name} | ${room.label}${(d.floors ?? 1) > 1 ? ` | Floor ${room.floor ?? 1}/${d.floors}` : ''}]`,
    room.feature,
    `${light} ${smell} ${sound} ${atmo}`,
  ];
  if (room.graffiti) lines.push(`Wall Scrawl: ${room.graffiti}`);
  return lines.join('\n');
}

export function enterDungeonRoom(
  state: GameState,
  world: WorldDatabase,
  targetId: number,
): { entered: boolean; logs: string[] } {
  const d = state.activeDungeon;
  if (!d) return { entered: false, logs: ['No active dungeon.'] };
  const cur = d.rooms[d.currentRoomId];
  const dest = d.rooms[targetId];
  if (!dest || !cur.exits.includes(targetId)) {
    return { entered: false, logs: [`Cannot reach Room #${targetId + 1} from here.`] };
  }

  if (dest.secretHidden && !d.puzzleSolved) {
    return { entered: false, logs: ['Only seamless stone stands there—the secret passage has not been opened.'] };
  }

  if (dest.lockedByKey && !d.hasBossKey && cur.role !== 'boss_lair') {
    return { entered: false, logs: [`The heavy door is locked! Only ${d.bossName}'s ${d.bossKeyName} opens it from this side.`] };
  }

  if (dest.requiresNoHeavyArmor && state.party.members.some((m) => m.status === 'alive' && m.armorTier === 3)) {
    return { entered: false, logs: ['The crawlway is too narrow for Heavy Armor (Tier 3)! Stash heavy armor first or choose another route.'] };
  }

  d.previousRoomId = cur.id;
  d.currentRoomId = targetId;
  const wasVisited = dest.visited;
  dest.visited = true;
  dest.revisitCount = wasVisited ? (dest.revisitCount ?? 0) + 1 : 0;
  d.movesSinceDanger = (d.movesSinceDanger ?? 0) + 1;
  const floorPrefix = (d.floors ?? 1) > 1 && (dest.floor ?? 1) !== (cur.floor ?? 1) ? `Descended/climbed to Floor ${dest.floor}: ` : '';
  const logs: string[] = [`${floorPrefix}Entered ${dest.label}.`];
  const pcIdx = getActivePcIndex(state);
  const pc = state.party.members[pcIdx];

  // Room traps (corridor pit trap vs procedural trapsAndDevilry in trap_gallery)
  if (dest.trap && !dest.trapTriggered) {
    const pcFs = ensureFeatureState(pc);
    if ((pcFs.hermeticTrapSteps ?? 0) > 0) {
      pcFs.hermeticTrapSteps! -= 1;
      dest.trapSpotted = true;
      logs.push(`Hermetic Step reveals & avoids trap: ${dest.trap}.`);
    } else if (dest.role === 'corridor') {
      const trapBonus = getTraitDrModifier(pc, 'trap', world);
      const spot = rollAbilityTest(pc, 'presence', 14, state, { label: 'Spot hidden pit trap', extraMod: trapBonus });
      logs.push(spot.logLine);
      if (spot.success) {
        dest.trapSpotted = true;
        logs.push(`Spotted trap: ${dest.trap}.`);
      } else {
        dest.trapTriggered = true;
        const dmg = rollDie(6, state);
        pc.hp -= dmg;
        logs.push(`PIT TRAP TRIGGERED! ${pc.name} drops into the lower crawlway for ${dmg} dmg (${pc.hp}/${pc.maxHp} HP).`);
        logs.push(...applyBrokenOrDead(pc, state));
        const tunnel = d.rooms.find((r) => r.role === 'tight_tunnel');
        if (tunnel && pc.status !== 'dead') {
          d.currentRoomId = tunnel.id;
          tunnel.visited = true;
          logs.push(`You crawl bruised into ${tunnel.label}.`);
          return { entered: true, logs };
        }
      }
    } else {
      const trapBonus = getTraitDrModifier(pc, 'trap', world);
      const spot = rollAbilityTest(pc, 'agility', 12, state, { label: `Evade trap: ${dest.trap}`, extraMod: trapBonus });
      logs.push(spot.logLine);
      dest.trapTriggered = true;
      if (spot.success) {
        dest.trapSpotted = true;
        logs.push(`${pc.name} deftly bypasses ${dest.trap}.`);
      } else {
        const dmg = rollDie(4, state);
        pc.hp -= dmg;
        logs.push(`TRAP TRIGGERED (${dest.trap})! ${pc.name} takes ${dmg} dmg (${pc.hp}/${pc.maxHp} HP)!`);
        logs.push(...applyBrokenOrDead(pc, state));
      }
    }
  }

  // Room resident enemies
  if (dest.enemyIds.length > 0) {
    const combat = startCombat(state, world, [...dest.enemyIds], false);
    dest.enemyIds = [];
    logs.push(...combat.log);
    return { entered: true, logs };
  }

  // Imminent Danger ticking pulse every 3 dungeon moves
  if (d.movesSinceDanger >= 3 && state.mode !== 'game_over') {
    d.movesSinceDanger = 0;
    if (rollDie(4, state) === 1) {
      d.dangerTicks = (d.dangerTicks ?? 0) + 1;
      const lowerDanger = d.imminentDanger.toLowerCase();
      const ab = lowerDanger.includes('spores') || lowerDanger.includes('senses') ? 'toughness' : 'agility';
      const test = rollAbilityTest(pc, ab, 10, state, { label: `Imminent Danger: ${d.imminentDanger}` });
      logs.push(`IMMINENT DANGER PULSE: ${d.imminentDanger}!`, test.logLine);
      if (!test.success) {
        const dmg = rollDie(4, state);
        pc.hp -= dmg;
        logs.push(`${pc.name} suffers ${dmg} dmg (${pc.hp}/${pc.maxHp} HP)!`);
        logs.push(...applyBrokenOrDead(pc, state));
        if (state.party.members.every((m) => m.status === 'dead')) {
          state.mode = 'game_over';
          state.gameOverReason = `Killed by ${d.imminentDanger}.`;
          return { entered: true, logs };
        }
      }
    }
  }

  // Rare stray beast spawn inside quiet side-rooms
  if (
    !dest.encounterRolled &&
    (dest.role === 'debris_room' || dest.role === 'shrine' || dest.role === 'pump_room') &&
    rollDie(8, state) === 1 &&
    !dest.interactables.some((i) => i.kind === 'stray_beast')
  ) {
    const strayOptions = world.beasts.filter((b) => !b.name.toLowerCase().includes('horse') && !b.name.toLowerCase().includes('trained'));
    const chosenBeast = strayOptions[rollDie(strayOptions.length, state) - 1] ?? world.beasts[world.beasts.length - 1];
    dest.interactables.push({
      id: `beast_${dest.id}`,
      kind: 'stray_beast',
      label: `Coax the cowering ${chosenBeast.name} into joining you (Presence DR10)`,
      used: false,
    });
    logs.push(`Huddled behind fallen masonry trembles a starved ${chosenBeast.name}.`);
  }

  // Random encounter rooms -> Table A / Table B
  if (
    !dest.encounterRolled &&
    (dest.role === 'pump_room' || dest.role === 'chain_room' || dest.role === 'debris_room' || dest.role === 'ossuary' || dest.role === 'trap_gallery')
  ) {
    dest.encounterRolled = true;
    const roll = rollDie(6, state);
    const undeadSurge = getActiveMiseryEffects(state).counts.undead_surge;
    if (roll <= 3) {
      d.tableBTriggered = true;
      const anom = world.campaigns.tableBAnomalies[rollDie(world.campaigns.tableBAnomalies.length, state) - 1];
      logs.push(`[Anomaly] ${anom.name}: ${anom.description}`);
      if (anom.id === 'terrible_silence') {
        dest.silenced = true;
      } else if (anom.id === 'sagsobuth_bazaar') {
        dest.interactables.push({
          id: `bazaar_${dest.id}`,
          kind: 'bazaar',
          label: 'Trade with Sagsobuth (Violet Poison 30s / Protean Scroll Tube 30s)',
          used: false,
        });
      } else if (anom.id === 'teleport_sarcophagus') {
        dest.interactables.push({
          id: `sarc_${dest.id}`,
          kind: 'sarcophagus',
          label: 'Open the humming stone sarcophagus',
          used: false,
        });
      } else if (anom.id === 'distraught_spirit') {
        logs.push(`The spirit weeps: "Slay ${d.bossName} and the horror in ${d.centralHazardName} will sink dead!"`);
      } else if (anom.id === 'weeping_bell') {
        if (rollDie(2, state) === 1) {
          pc.omens += 1;
          logs.push(`The bell tolls once like cracked bone — ${pc.name} gains +1 Omen (${pc.omens}).`);
        } else {
          logs.push('The bell tolls wildly into the dark!');
          logs.push(...triggerGuardAlertIfNoisy(state, world, dest));
        }
      } else if (anom.id === 'blood_mirror') {
        const puzzleRoom = d.rooms.find((r) => r.role === 'puzzle_statue');
        const bossRoom = d.rooms.find((r) => r.role === 'boss_lair');
        d.puzzleCluesFound = (d.puzzleCluesFound ?? 0) + 1;
        logs.push(`Crimson glass reveals Room #${(puzzleRoom?.id ?? 0) + 1} (${d.puzzleStatueName}) and Room #${(bossRoom?.id ?? 0) + 1} (${d.bossName}) (+1 puzzle clue).`);
      } else if (anom.id === 'hanging_censers') {
        const tCenser = rollAbilityTest(pc, 'toughness', 10, state, { label: 'Inhale censer smoke' });
        logs.push(tCenser.logLine);
        if (tCenser.success) {
          const heal = rollDie(4, state);
          const prev = pc.hp;
          pc.hp = Math.min(pc.maxHp, pc.hp + heal);
          logs.push(`Sweet poppy smoke soothes ${pc.name}: +${pc.hp - prev} HP (${pc.hp}/${pc.maxHp}).`);
        } else {
          pc.dizzyHours = Math.max(pc.dizzyHours, 1);
          logs.push(`${pc.name} gags on rot-incense (dizzy 1h)!`);
        }
      } else if (anom.id === 'whispering_well') {
        const coin = rollDice(2, 6, state);
        pc.silver += coin;
        d.puzzleCluesFound = (d.puzzleCluesFound ?? 0) + 1;
        logs.push(`${pc.name} fishes ${coin}s from the well-lip and hears a whispered secret (+1 puzzle clue).`);
      } else if (anom.id === 'rotting_oracle') {
        if (state.activeContract.prophecyTruthIndex !== undefined) {
          state.activeContract.prophecyRevealed = true;
          logs.push(`The wax oracle clicks its jaw: "Omen #${state.activeContract.prophecyTruthIndex + 1} is TRUE!"`);
        }
      } else if (anom.id === 'salt_circle') {
        dest.cleared = true;
        ensureFeatureState(pc).nextTestDrBonus = (pc.featureState?.nextTestDrBonus ?? 0) - 2;
        logs.push(`Stepping inside the salt ward steadies ${pc.name} (-2 DR on next test).`);
      }
    } else if (roll >= 4 || (undeadSurge > 0 && roll === 3)) {
      if (undeadSurge > 0 && rollDie(2, state) === 1) {
        const uPool = ['skeleton', 'zombie', 'wraith'];
        const uId = uPool[rollDie(uPool.length, state) - 1];
        const count = uId === 'wraith' ? 1 : rollDie(2, state);
        const ids = Array.from({ length: count }, () => uId);
        const combat = startCombat(state, world, ids, false);
        logs.push('Undead Surge Misery stirs the restless dead!', ...combat.log);
        return { entered: true, logs };
      }
      const enc = world.campaigns.tableAEncounters[rollDie(world.campaigns.tableAEncounters.length, state) - 1];
      const count = Math.max(1, parseDiceExpr(enc.countFormula, state));
      const ids = Array.from({ length: count }, () => enc.creatureId);
      const combat = startCombat(state, world, ids, false);
      logs.push(enc.intro, ...combat.log);
      return { entered: true, logs };
    }
  }

  return { entered: true, logs };
}

function executeInteractable(
  state: GameState,
  world: WorldDatabase,
  room: DungeonRoom,
  inter: RoomInteractable,
): string[] {
  const d = state.activeDungeon!;
  const pcIdx = getActivePcIndex(state);
  const pc = state.party.members[pcIdx];
  const logs: string[] = [];

  if (inter.kind === 'butterflies') {
    inter.used = true;
    const heal = rollDie(6, state);
    const prev = pc.hp;
    pc.hp = Math.min(pc.maxHp, pc.hp + heal);
    logs.push(`${pc.name} catches and swallows the black-violet moths: +${pc.hp - prev} HP (${pc.hp}/${pc.maxHp}).`);
    return logs;
  }

  if (inter.kind === 'feast_table') {
    inter.used = true;
    const puzzleRoom = d.rooms.find((r) => r.role === 'puzzle_statue');
    const bossRoom = d.rooms.find((r) => r.role === 'boss_lair');
    logs.push('Everyone sits at the long table. The catatonic elder erupts with rumbling laughter before fading back into his stupor:');
    logs.push(`"Seek ${d.puzzleSocketItemName} among the watchmen or cells, feed it to ${d.puzzleStatueName} (Room #${(puzzleRoom?.id ?? 0) + 1})! And beware ${d.bossName} in Room #${(bossRoom?.id ?? 0) + 1}!"`);
    logs.push(...triggerGuardAlertIfNoisy(state, world, room));
    return logs;
  }

  if (inter.kind === 'bookshelf') {
    inter.used = true;
    const r = rollDie(4, state);
    if (r === 1) {
      const sc = world.uncleanScrolls[rollDie(world.uncleanScrolls.length, state) - 1];
      pc.inventory.push({
        id: `lib_scroll_${Date.now()}`,
        name: `Unclean Scroll: ${sc.name}`,
        kind: 'unclean_scroll',
        scrollKind: 'unclean',
        scrollRoll: sc.roll,
        notes: sc.effect,
      });
      d.puzzleCluesFound = (d.puzzleCluesFound ?? 0) + 1;
      logs.push(`${pc.name} translates a booklet without disturbing the skeletons: gained Unclean Scroll (${sc.name}) and a cipher clue!`);
    } else if (r === 2) {
      pc.notes.push('Book-induced dizziness (+2 DR for 30 min)');
      ensureFeatureState(pc).bookDizzyHours = 1;
      logs.push(`${pc.name} grows terribly light-headed reading the frenzied script (+2 DR for 1 hour).`);
    } else if (r === 3) {
      d.puzzleCluesFound = (d.puzzleCluesFound ?? 0) + 1;
      logs.push('Behind twisted script lies a scratched stone diagram—you record a puzzle clue!');
    } else {
      logs.push(`${pc.name} involuntarily shrieks: "YOU DEAD, ARISE!" A Tired Crystal Demon materializes!`);
      const scrollIdx = pc.inventory.findIndex((i) => i.kind === 'unclean_scroll' || i.kind === 'sacred_scroll');
      if (scrollIdx >= 0) {
        const drained = pc.inventory.splice(scrollIdx, 1)[0];
        logs.push(`The crystal demon drains the ink right off ${drained.name}!`);
      }
      for (const m of state.party.members) {
        if (m.status !== 'alive') continue;
        const shock = rollAbilityTest(m, 'presence', 12, state, { label: 'Resist Crystal Demon shockwave' });
        logs.push(shock.logLine);
        if (!shock.success) {
          const dmg = rollDie(6, state);
          m.hp -= dmg;
          m.powersRemaining = 0;
          logs.push(`${m.name} loses ${dmg} HP and all Power uses today!`);
          logs.push(...applyBrokenOrDead(m, state));
        }
      }
    }
    return logs;
  }

  if (inter.kind === 'ransack') {
    inter.used = true;
    for (let rollNum = 0; rollNum < 2; rollNum += 1) {
      const r = rollDie(6, state);
      if (r === 1) {
        pc.foodDays += 1;
        logs.push('Ransack (1): Found dog-bone meat scraps (+1 day food).');
      } else if (r === 2) {
        pc.inventory.push({ id: `loot_token_${Date.now()}_${rollNum}`, name: d.puzzleSocketItemName, kind: 'treasure' });
        logs.push(`Ransack (2): Found a black-stone trinket & ${d.puzzleSocketItemName}!`);
      } else if (r === 3) {
        const s = rollDice(3, 10, state);
        pc.silver += s;
        logs.push(`Ransack (3): Found ${s} silver!`);
      } else if (r === 4) {
        const t = rollAbilityTest(pc, 'toughness', 14, state, { label: 'Inhale fine urn powder' });
        logs.push(`Ransack (4): Cracked open a powder urn! ${t.logLine}`);
        if (!t.success) {
          const dmg = rollDie(8, state);
          pc.hp -= dmg;
          logs.push(`${pc.name} chokes on poison (-${dmg} HP)!`);
          logs.push(...applyBrokenOrDead(pc, state));
        }
      } else if (r === 5) {
        if (rollDie(2, state) === 1) {
          const sc = world.sacredScrolls[rollDie(world.sacredScrolls.length, state) - 1];
          pc.inventory.push({
            id: `guard_sc_${Date.now()}`,
            name: `Sacred Scroll: ${sc.name}`,
            kind: 'sacred_scroll',
            scrollKind: 'sacred',
            scrollRoll: sc.roll,
            notes: sc.effect,
          });
          logs.push(`Ransack (5): Found Sacred Scroll (${sc.name})!`);
        } else {
          logs.push('Ransack (5): Opened a small wooden box—a harmless beetle bites your thumb.');
        }
      } else {
        const xbow = world.weaponsById.crossbow;
        pc.weapon = { ...xbow, name: 'Small crossbow', damageDie: 'd6' };
        pc.ammo = Math.max(1, pc.abilities.presence + 6);
        logs.push(`Ransack (6): Found a Small crossbow (d6) with ${pc.ammo} bolts!`);
      }
    }
    if (!ensureSocketItemInParty(state) && d.puzzleKind === 'socket_statue') {
      pc.inventory.push({ id: `guard_eye_${Date.now()}`, name: d.puzzleSocketItemName, kind: 'treasure' });
      logs.push(`Tucked in a guard's purse lies ${d.puzzleSocketItemName}.`);
    }
    if (room.role === 'locked_vault') {
      const g = grantOccultRelic(pc, state, world, true);
      logs.push(`Inside the reliquary chest gleams an Occult Treasure: ${g.name}!`);
    }
    return logs;
  }

  if (inter.kind === 'prisoners') {
    inter.used = true;
    const agi = rollAbilityTest(pc, 'agility', 12, state, { label: 'Dodge strangling prisoner hands' });
    logs.push(agi.logLine);
    if (!agi.success) {
      const dmg = rollDie(4, state);
      pc.hp -= dmg;
      logs.push(`Starving hands seize ${pc.name}'s throat through the bars (-${dmg} HP)!`);
      logs.push(...applyBrokenOrDead(pc, state));
      if (pc.status === 'alive' && rollDie(2, state) === 1) {
        const combat = startCombat(state, world, ['mad_prisoner', 'mad_prisoner'], false);
        logs.push('A rusted cell latch snaps—emaciated Mad Prisoners lunge straight at your throat!', ...combat.log);
        return logs;
      }
    } else {
      logs.push(`${pc.name} jerks back from grasping fingers and snatches ${d.puzzleSocketItemName} from a dead cellmate!`);
      if (!ensureSocketItemInParty(state)) {
        pc.inventory.push({ id: `cell_eye_${Date.now()}`, name: d.puzzleSocketItemName, kind: 'treasure' });
      }
      if (state.party.followers.filter((f) => f.status === 'alive').length < 2 && rollDie(2, state) === 1) {
        const res = recruitOutcastFollower(state, world);
        if (res.ok) logs.push('From the end cell steps a gaunt survivor begging a blade:', res.message);
      }
    }
    logs.push(...triggerGuardAlertIfNoisy(state, world, room));
    return logs;
  }

  if (inter.kind === 'pit_trap') {
    inter.used = true;
    const spot = rollAbilityTest(pc, 'presence', 14, state, { label: 'Examine painting seams' });
    logs.push(spot.logLine);
    if (spot.success) {
      room.trapSpotted = true;
      room.trapTriggered = true;
      logs.push(`${pc.name} spots the hidden pit-trap mechanism cleanly and wedges it shut.`);
    } else {
      room.trapTriggered = true;
      const dmg = rollDie(6, state);
      pc.hp -= dmg;
      logs.push(`The floor snaps open! ${pc.name} plunges into the lower tunnel (-${dmg} HP)!`);
      logs.push(...applyBrokenOrDead(pc, state));
      const tunnel = d.rooms.find((r) => r.role === 'tight_tunnel');
      if (tunnel && pc.status !== 'dead') {
        d.currentRoomId = tunnel.id;
        tunnel.visited = true;
      }
    }
    return logs;
  }

  if (inter.kind === 'pump') {
    inter.used = true;
    const heal = rollDie(4, state);
    const prev = pc.hp;
    pc.hp = Math.min(pc.maxHp, pc.hp + heal);
    logs.push(`${pc.name} drinks muddy water from the rusty pump: +${pc.hp - prev} HP (${pc.hp}/${pc.maxHp}).`);
    return logs;
  }

  if (inter.kind === 'hatch') {
    const bossRoom = d.rooms.find((r) => r.role === 'boss_lair');
    if (bossRoom) {
      return enterDungeonRoom(state, world, bossRoom.id).logs;
    }
    return ['The hatch leads nowhere.'];
  }

  if (inter.kind === 'hazard_cross') {
    const strTest = rollAbilityTest(pc, 'strength', 12, state, { label: `Pry gems above ${d.centralHazardName}` });
    logs.push(strTest.logLine);
    if (strTest.success) {
      inter.used = true;
      const gems = rollDie(4, state) * 200;
      pc.silver += gems;
      logs.push(`${pc.name} wrenches loose brilliant gems worth ${gems}s!`);
    } else {
      logs.push(`${pc.name} slips into ${d.centralHazardName}!`);
    }

    const hazTest = rollAbilityTest(pc, d.centralHazardAbility, d.centralHazardDr, state, {
      label: `Endure ${d.centralHazardName}`,
    });
    logs.push(hazTest.logLine);
    if (!hazTest.success) {
      const dmg = parseDiceExpr(d.centralHazardFailDie, state);
      pc.hp -= dmg;
      logs.push(`${d.centralHazardName} scorches/batters ${pc.name} for ${dmg} dmg!`);
      logs.push(...applyBrokenOrDead(pc, state));
    }

    if (!d.apexPacified && rollDie(6, state) <= 2) {
      const combat = startCombat(state, world, [d.apexEnemyId], true);
      logs.push(`Something colossal surges out of ${d.centralHazardName}!`, ...combat.log);
    }
    return logs;
  }

  if (inter.kind === 'rival_camp') {
    inter.used = true;
    const reactMod = getTraitReactionModifier(pc, world);
    const react = rollReaction(state, reactMod);
    logs.push(`${d.rivalLeaderName} eyes ${pc.name} (Reaction 2d6${reactMod >= 0 ? `+${reactMod}` : reactMod} = ${react.roll}: ${react.label}).`);

    if (react.roll >= 9) {
      const heal = rollDie(6, state);
      for (const m of state.party.members) {
        if (m.status !== 'dead') m.hp = Math.min(m.maxHp, m.hp + heal);
      }
      const bossRoom = d.rooms.find((r) => r.role === 'boss_lair');
      logs.push(`${d.rivalLeaderName} serves ${d.rivalBrewName} (+${heal} HP to the party) and whispers: "Kill ${d.bossName} in Room #${(bossRoom?.id ?? 0) + 1}, and take ${d.bossKeyName}!"`);
      d.rivalBrewTaken = true;
    } else {
      const heal = rollDie(6, state);
      pc.hp = Math.min(pc.maxHp, pc.hp + heal);
      logs.push(`${pc.name} drinks ${d.rivalBrewName} (+${heal} HP)—then the room ripples! The zealots draw long knives!`);
      const combat = startCombat(state, world, [d.rivalZealotId, d.rivalZealotId, d.rivalZealotId], true);
      logs.push(...combat.log);
    }
    return logs;
  }

  if (inter.kind === 'statue_socket') {
    if (ensureSocketItemInParty(state)) {
      inter.used = true;
      d.puzzleSolved = true;
      logs.push(d.puzzleUnlockText);
      return logs;
    }
    const agi = rollAbilityTest(pc, 'agility', 16, state, { label: 'Keep footing as the stone floor tilts' });
    logs.push(agi.logLine);
    if (!agi.success) {
      const dmg = parseDiceExpr(d.centralHazardFailDie, state);
      pc.hp -= dmg;
      logs.push(`The floor tilts! ${pc.name} slides into ${d.centralHazardName} (-${dmg} HP)!`);
      logs.push(...applyBrokenOrDead(pc, state));
    } else {
      logs.push(`You need ${d.puzzleSocketItemName} (likely carried by guards or prisoners) to unlock ${d.puzzleStatueName}.`);
    }
    return logs;
  }

  if (inter.kind === 'objective') {
    inter.used = true;
    state.activeContract.objectiveSecured = true;
    if (state.activeContract.refusesLeave) {
      const persuade = rollAbilityTest(pc, 'presence', 10, state, { label: `Persuade ${state.activeContract.targetName} to leave` });
      logs.push(persuade.logLine);
      if (persuade.success) {
        logs.push(`${state.activeContract.targetName} scoffs, then grudgingly follows you toward the exit.`);
      } else {
        logs.push(`${state.activeContract.targetName} refuses to budge—you bind their wrists and haul them out anyway!`);
      }
    } else {
      logs.push(`Secured ${state.activeContract.targetName}! Escape to the Entrance (Room #1) to claim ${state.activeContract.rewardSilver}s.`);
    }
    return logs;
  }

  if (inter.kind === 'bazaar') {
    const hasProtean = state.party.members.some((m) => m.inventory.some((i) => i.proteanScroll));
    if (!hasProtean && pc.silver >= 30) {
      pc.silver -= 30;
      const sc = world.uncleanScrolls[rollDie(world.uncleanScrolls.length, state) - 1];
      pc.inventory.push({
        id: `protean_${Date.now()}`,
        name: `Protean Scroll: ${sc.name}`,
        kind: 'unclean_scroll',
        scrollKind: 'unclean',
        scrollRoll: sc.roll,
        proteanScroll: true,
        notes: `${sc.effect} (Mutates each dawn; catastrophes on 1-3.)`,
      });
      logs.push(`${pc.name} pays Sagsobuth 30s for the Beechwood Tube containing a Foul Protean Scroll (${sc.name})!`);
    } else if (pc.silver >= 30) {
      inter.used = true;
      pc.silver -= 30;
      pc.inventory.push({
        id: `violet_poison_${Date.now()}`,
        name: 'Violet Poison (2 doses)',
        kind: 'poison',
        uses: 2,
        notes: 'Potent arcane venom from Sagsobuth (+d6 damage).',
      });
      logs.push(`${pc.name} pays Sagsobuth 30s for a vial of Violet Poison (2 doses)!`);
    } else {
      inter.used = true;
      logs.push(`Sagsobuth's vortex-face flickers: "30 silver for the Beechwood Tube or Violet Poison, beggar."`);
    }
    return logs;
  }

  if (inter.kind === 'sarcophagus') {
    inter.used = true;
    const sanc = d.rooms.find((r) => r.role === 'rival_sanctuary');
    if (sanc) {
      d.currentRoomId = sanc.id;
      sanc.visited = true;
      logs.push(`Opening the lid sucks the entire party into blackness—spitting you out inside ${sanc.label}!`);
    }
    return logs;
  }

  if (inter.kind === 'inscription_cipher') {
    const clues = d.puzzleCluesFound ?? 0;
    if (clues >= 2) {
      inter.used = true;
      d.puzzleSolved = true;
      logs.push(`Using the ${clues} dungeon clues gathered, ${pc.name} aligns the wheels cleanly! ${d.puzzleUnlockText}`);
      return logs;
    }
    const dr = Math.max(6, 12 - clues * 2);
    const t = rollAbilityTest(pc, 'presence', dr, state, { label: 'Decipher rotating Verhu cipher' });
    logs.push(t.logLine);
    if (t.success) {
      inter.used = true;
      d.puzzleSolved = true;
      logs.push(d.puzzleUnlockText);
    } else {
      const dmg = rollDie(2, state);
      pc.hp -= dmg;
      logs.push(`The stone teeth snap shut on ${pc.name}'s fingers (-${dmg} HP)! Search libraries or shrines for clues.`);
      logs.push(...applyBrokenOrDead(pc, state));
    }
    return logs;
  }

  if (inter.kind === 'blood_altar') {
    inter.used = true;
    const t = rollAbilityTest(pc, 'toughness', 12, state, { label: 'Feed blood basin without faltering' });
    logs.push(t.logLine);
    const bloodLoss = t.success ? 1 : rollDie(4, state);
    pc.hp -= bloodLoss;
    d.puzzleSolved = true;
    logs.push(`${pc.name} sheds ${bloodLoss} HP into the basin (${pc.hp}/${pc.maxHp} HP). ${d.puzzleUnlockText}`);
    logs.push(...applyBrokenOrDead(pc, state));
    return logs;
  }

  if (inter.kind === 'sabotage_altar') {
    const bombIdx = pc.inventory.findIndex((i) => i.name.toLowerCase().includes('bomb') || i.name.toLowerCase().includes('gunpowder'));
    if (bombIdx >= 0) {
      const usedBomb = pc.inventory.splice(bombIdx, 1)[0];
      inter.used = true;
      state.activeContract.objectiveSecured = true;
      logs.push(`${pc.name} packs ${usedBomb.name} beneath ${state.activeContract.targetName} and blasts it to rubble! Return to the Entrance (Room #1)!`);
      return logs;
    }
    const t = rollAbilityTest(pc, 'strength', 12, state, { label: `Smash ${state.activeContract.targetName}` });
    logs.push(t.logLine);
    if (t.success) {
      inter.used = true;
      state.activeContract.objectiveSecured = true;
      logs.push(`${pc.name} wrecks ${state.activeContract.targetName}! Escape to the Entrance (Room #1) to claim ${state.activeContract.rewardSilver}s.`);
      logs.push(...triggerGuardAlertIfNoisy(state, world, room));
    } else {
      const backlash = rollDie(4, state);
      pc.hp -= backlash;
      logs.push(`Cursed ward-sparks hurl ${pc.name} backward (-${backlash} HP)!`);
      logs.push(...applyBrokenOrDead(pc, state));
    }
    return logs;
  }

  if (inter.kind === 'shrine_offering') {
    inter.used = true;
    if (pc.silver >= 10) {
      pc.silver -= 10;
      pc.omens += 1;
      d.puzzleCluesFound = (d.puzzleCluesFound ?? 0) + 1;
      logs.push(`${pc.name} drops 10s into the soot-bowl: +1 Omen (${pc.omens}) and a puzzle clue etched in tallow.`);
    } else {
      const pray = rollAbilityTest(pc, 'presence', 12, state, { label: 'Pray silently at shrine' });
      logs.push(pray.logLine);
      if (pray.success) {
        d.puzzleCluesFound = (d.puzzleCluesFound ?? 0) + 1;
        logs.push('The Two-Headed icon leaks dry whispers: +1 puzzle clue.');
      } else {
        logs.push('Only cold ash blows across the basin.');
      }
    }
    return logs;
  }

  if (inter.kind === 'ossuary_loot') {
    inter.used = true;
    const r = rollDie(6, state);
    if (r <= 2) {
      const s = rollDice(2, 10, state);
      pc.silver += s;
      logs.push(`${pc.name} digs ${s} tarnished silver out of shattered skulls.`);
    } else if (r <= 4) {
      d.puzzleCluesFound = (d.puzzleCluesFound ?? 0) + 1;
      logs.push(`${pc.name} recovers an etched rib-map (+1 puzzle clue).`);
    } else if (r === 5) {
      const g = grantOccultRelic(pc, state, world, true);
      logs.push(`Wrapped in grave-cloth lies an Occult Treasure: ${g.name}!`);
    } else {
      const combat = startCombat(state, world, ['slumbering_skeleton'], true);
      logs.push('Disturbed bones knit together and surge up!', ...combat.log);
    }
    return logs;
  }

  if (inter.kind === 'stray_beast') {
    inter.used = true;
    const beastName = inter.label.includes('Mule')
      ? 'Mule'
      : inter.label.includes('Dog')
        ? 'Dog (wild)'
        : 'Rat (tame)';
    const t = rollAbilityTest(pc, 'presence', 10, state, { label: `Tame ${beastName}` });
    logs.push(t.logLine);
    if (t.success) {
      logs.push(grantBeastToPc(pc, beastName, state));
    } else {
      logs.push(`The startled ${beastName} bolts into a crack in the stone.`);
    }
    return logs;
  }

  if (inter.kind === 'offering_scale') {
    let treasureOwner: (typeof state.party.members)[number] | undefined;
    let treasureIdx = -1;
    for (const m of state.party.members) {
      if (m.status === 'dead') continue;
      const idx = m.inventory.findIndex((i) => i.kind === 'treasure');
      if (idx >= 0) {
        treasureOwner = m;
        treasureIdx = idx;
        break;
      }
    }
    if (treasureOwner && treasureIdx >= 0) {
      const sac = treasureOwner.inventory.splice(treasureIdx, 1)[0];
      inter.used = true;
      d.puzzleSolved = true;
      logs.push(`${treasureOwner.name} places ${sac.name} on the bronze scale. ${d.puzzleUnlockText}`);
      return logs;
    }
    const payer =
      pc.silver >= 15
        ? pc
        : state.party.members.find((m) => m.status !== 'dead' && m.silver >= 15);
    if (payer) {
      payer.silver -= 15;
      inter.used = true;
      d.puzzleSolved = true;
      logs.push(`${payer.name} counts 15s onto the bronze pan until it clicks level. ${d.puzzleUnlockText}`);
      return logs;
    }
    const force = rollAbilityTest(pc, 'strength', 14, state, { label: 'Wrench offering-scale counterweight' });
    logs.push(`[Roll] ${force.logLine}`);
    if (force.success) {
      inter.used = true;
      d.puzzleSolved = true;
      logs.push(`${pc.name} wrenches the bronze beam flat by brute strength! ${d.puzzleUnlockText}`);
    } else {
      const dmg = rollDie(4, state);
      pc.hp -= dmg;
      logs.push(`The counterweight snaps back, smashing ${pc.name}'s ribs (-${dmg} HP, ${pc.hp}/${pc.maxHp} HP)!`);
      logs.push(...applyBrokenOrDead(pc, state));
    }
    return logs;
  }

  if (inter.kind === 'read_graffiti') {
    inter.used = true;
    logs.push(room.graffiti ?? 'Dried chalk smudges away beneath your thumb.');
    if (d.puzzleKind === 'inscription_cipher' && rollDie(2, state) === 1) {
      d.puzzleCluesFound = (d.puzzleCluesFound ?? 0) + 1;
      logs.push('Half-rubbed cipher notches match the idol room (+1 puzzle clue).');
    }
    return logs;
  }

  return logs;
}

function executeTraitChoice(state: GameState, world: WorldDatabase, effectKey: string): string[] {
  const pc = state.party.members[getActivePcIndex(state)];
  const d = state.activeDungeon;
  const logs: string[] = [];

  if (effectKey === 'eat_bugs') {
    if (state.dailyBugEatenDay === state.calendar.day) {
      return [`${pc.name} already scavenged every bug worth eating today.`];
    }
    state.dailyBugEatenDay = state.calendar.day;
    const prev = pc.hp;
    pc.hp = Math.min(pc.maxHp, pc.hp + 1);
    return [`${pc.name} crunches down cave-beetles: +${pc.hp - prev} HP (${pc.hp}/${pc.maxHp}).`];
  }

  if (effectKey === 'skull_counsel') {
    const t = rollAbilityTest(pc, 'presence', 10, state, { label: 'Consult skull-friend' });
    logs.push(t.logLine);
    if (t.success && d) {
      const cur = d.rooms[d.currentRoomId];
      const dangerous = cur.exits.filter((id) => d.rooms[id].enemyIds.length > 0 || d.rooms[id].trap);
      logs.push(
        dangerous.length > 0
          ? `The skull chatters softly: "Blood or teeth wait in Room(s) ${dangerous.map((x) => `#${x + 1}`).join(', ')}..."`
          : 'The skull rests quiet—no immediate ambush lies behind the next doors.',
      );
    } else {
      logs.push('The skull only stares back with empty, mocking eye-holes.');
    }
    return logs;
  }

  if (effectKey === 'suspicious_probe') {
    const t = rollAbilityTest(pc, 'presence', 10, state, { label: 'Probe shadows & flagstones' });
    logs.push(t.logLine);
    if (t.success && d) {
      const cur = d.rooms[d.currentRoomId];
      if (cur.trap && !cur.trapSpotted) {
        cur.trapSpotted = true;
        logs.push(`${pc.name} spots a hidden trap: ${cur.trap}!`);
      } else {
        logs.push(`${pc.name} finds nothing rigged inside this chamber.`);
      }
    }
    return logs;
  }

  if (effectKey === 'hook_pry') {
    const t = rollAbilityTest(pc, 'strength', 10, state, { label: 'Pry with rusting hook' });
    logs.push(t.logLine);
    if (t.success) {
      const coin = rollDice(2, 6, state);
      pc.silver += coin;
      logs.push(`${pc.name} pries loose a rotted stone hiding ${coin}s!`);
    }
    return logs;
  }

  if (effectKey === 'gamble_wager') {
    const bet = Math.min(10, pc.silver);
    if (bet <= 0) return [`${pc.name} has no silver to wager.`];
    const t = rollAbilityTest(pc, 'presence', 12, state, { label: 'Bone-dice wager' });
    logs.push(t.logLine);
    if (t.success) {
      pc.silver += bet;
      logs.push(`${pc.name} pockets ${bet}s from a gullible fool!`);
    } else {
      pc.silver = Math.max(0, pc.silver - bet);
      logs.push(`${pc.name} loses ${bet}s on crooked bone dice — and by Bad Habit #4 doubles the bet!`);
      if (pc.silver > 0) {
        const doubleBet = Math.min(20, pc.silver);
        const t2 = rollAbilityTest(pc, 'presence', 12, state, { label: 'Double-or-nothing bone dice' });
        logs.push(t2.logLine);
        if (t2.success) {
          pc.silver += doubleBet;
          logs.push(`${pc.name} wins back ${doubleBet}s!`);
        } else {
          pc.silver = Math.max(0, pc.silver - doubleBet);
          logs.push(`${pc.name} loses another ${doubleBet}s!`);
        }
      }
    }
    return logs;
  }

  if (effectKey === 'drink_compulsion') {
    const heal = rollDie(4, state);
    const prev = pc.hp;
    pc.hp = Math.min(pc.maxHp, pc.hp + heal);
    pc.dizzyHours = Math.max(pc.dizzyHours, 1);
    return [`${pc.name} drains an entire flask without stopping: +${pc.hp - prev} HP (${pc.hp}/${pc.maxHp}), dizzy 1h!`];
  }

  if (effectKey === 'pyro_burn') {
    logs.push(`${pc.name} touches fire to dry rags, cobwebs, and tallow!`);
    if (d) {
      logs.push(...triggerGuardAlertIfNoisy(state, world, d.rooms[d.currentRoomId]));
    }
    return logs;
  }

  if (effectKey === 'worm_listen') {
    const t = rollAbilityTest(pc, 'presence', 10, state, { label: 'Listen to worms & rot' });
    logs.push(t.logLine);
    if (t.success && d) {
      logs.push(
        d.apexPacified
          ? 'The worms sing of silence: the great beast in the depths is dead.'
          : `The worms shudder: "The beast in ${d.centralHazardName} still obeys ${d.bossName}..."`,
      );
    }
    return logs;
  }

  if (effectKey === 'harvest_teeth') {
    const cur = d?.rooms[d.currentRoomId];
    if (cur && cur.corpsesRemaining > 0) {
      pc.inventory.push({ id: `teeth_${Date.now()}`, name: 'Necklace of human teeth (4s)', kind: 'treasure' });
      return [`${pc.name} pulls yellow molars from a corpse and strings them onto leather cord.`];
    }
    return [`No fresh teeth remain to harvest here.`];
  }

  if (effectKey === 'shrewd_read' || effectKey === 'deceitful_bluff') {
    const t = rollAbilityTest(pc, 'presence', 10, state, { label: effectKey === 'shrewd_read' ? 'Read motive' : 'Spin bluff' });
    logs.push(t.logLine);
    if (t.success) {
      logs.push(`${pc.name} reads the crooked tension in the room and gains leverage.`);
    }
    return logs;
  }

  return [`${pc.name} indulges their foul habit.`];
}

export function matchFreeformAction(rawInput: string, state: GameState): ChoiceOption | null {
  const lower = rawInput.toLowerCase();
  const opts = state.pendingChoiceOptions;

  const keywordPairs: Array<[string[], string[]]> = [
    [['butterfly', 'butterflies', 'moth', 'eat'], ['butterflies']],
    [['sit', 'table', 'elder', 'chair'], ['feast_table']],
    [['book', 'books', 'study', 'read', 'library'], ['bookshelf']],
    [['ransack', 'crates', 'guard room'], ['ransack']],
    [['prisoner', 'cell', 'bars'], ['prisoners']],
    [['painting', 'pit', 'seam', 'inspect floor'], ['pit_trap']],
    [['pump', 'muddy', 'drink'], ['pump']],
    [['hatch', 'ladder', 'stepladder'], ['hatch']],
    [['swim', 'cross', 'sludge', 'gem', 'chasm', 'cistern'], ['hazard_cross']],
    [['eye', 'socket', 'statue', 'idol', 'insert', 'place'], ['statue_socket', 'inscription_cipher', 'blood_altar', 'offering_scale']],
    [['cipher', 'wheel', 'decipher', 'glyph'], ['inscription_cipher']],
    [['blood', 'basin', 'feed'], ['blood_altar']],
    [['riddle', 'answer'], ['riddle_answer']],
    [['force door', 'pry door'], ['riddle_force']],
    [['scale', 'offer', 'weigh'], ['offering_scale']],
    [['graffiti', 'scrawl', 'wall'], ['read_graffiti']],
    [['sabotage', 'destroy', 'smash', 'wreck'], ['sabotage_altar']],
    [['shrine', 'pray', 'offering'], ['shrine_offering']],
    [['ossuary', 'bone-pile', 'sift', 'skull'], ['ossuary_loot', 'trait:skull_counsel']],
    [['beast', 'mule', 'dog', 'rat', 'coax', 'tame'], ['stray_beast']],
    [['heir', 'aldon', 'claim', 'relic', 'altar', 'objective', 'extract'], ['objective', 'sabotage_altar']],
    [['lesdy', 'brew', 'talk', 'speak', 'camp', 'faction'], ['rival_camp']],
    [['sagsobuth', 'tube', 'bazaar', 'buy', 'violet'], ['bazaar', 'briefing_buy_supplies']],
    [['sarcophagus', 'coffin', 'lid'], ['sarcophagus']],
    [['doff', 'remove armor', 'stash armor'], ['doff_heavy_armor']],
    [['equip armor', 'don armor', 'put on armor'], ['don_heavy_armor']],
    [['burn', 'torch', 'fire'], ['trait:pyro_burn']],
    [['skull'], ['trait:skull_counsel']],
    [['bug', 'insect'], ['trait:eat_bugs']],
    [['gamble', 'bet', 'wager'], ['trait:gamble_wager']],
    [['depart', 'leave', 'enter dungeon', 'march', 'travel'], ['briefing_depart', 'travel_advance', 'dungeon_leave']],
  ];

  for (const [words, targetKeys] of keywordPairs) {
    if (words.some((w) => lower.includes(w))) {
      for (const opt of opts) {
        if (targetKeys.some((k) => opt.actionId === k || opt.targetId === k)) {
          return opt;
        }
      }
    }
  }

  return null;
}

export function resolveChoiceOption(
  state: GameState,
  world: WorldDatabase,
  option: ChoiceOption,
): string[] {
  const pcIdx = getActivePcIndex(state);
  const pc = state.party.members[pcIdx];
  const logs: string[] = [];

  if (option.actionId === 'briefing_question_seer') {
    const t = rollAbilityTest(pc, 'presence', 10, state, { label: 'Press the Seer for truth' });
    logs.push(t.logLine);
    if (t.success && state.activeDungeon) {
      state.activeContract.prophecyRevealed = true;
      const truthNum = (state.activeContract.prophecyTruthIndex ?? 0) + 1;
      logs.push(`The Seer's eyes roll white: "Omen #${truthNum} is TRUE — the other is a lie!"`);
      const pHint =
        state.activeDungeon.puzzleKind === 'socket_statue'
          ? `Seek ${state.activeDungeon.puzzleSocketItemName} to open ${state.activeDungeon.puzzleStatueName}.`
          : state.activeDungeon.puzzleKind === 'inscription_cipher'
            ? `Collect dungeon clues to crack ${state.activeDungeon.puzzleStatueName}'s cipher.`
            : state.activeDungeon.puzzleKind === 'blood_altar'
              ? `${state.activeDungeon.puzzleStatueName} opens only for living blood.`
              : state.activeDungeon.puzzleKind === 'riddle_door'
                ? `${state.activeDungeon.puzzleStatueName} seals an iron riddle-door — wit or Strength opens it.`
                : `Offer 15s silver, treasure, or Strength to balance ${state.activeDungeon.puzzleStatueName}'s scales.`;
      logs.push(`The Seer hisses: "${pHint} Beware ${state.activeDungeon.bossName}."`);
    } else {
      logs.push('The Seer only cackles and wipes blood from beneath their hood.');
    }
    buildProceduralScene(state, world);
    return logs;
  }

  if (option.actionId === 'briefing_buy_supplies') {
    state.activeContract.shopVisited = true;
    if (pc.silver >= 6) {
      pc.silver -= 6;
      pc.foodDays += 2;
      pc.waterDays = Math.max(pc.waterDays, 4);
      logs.push(`${pc.name} spends 6s on dried food (+2 days) and fresh water.`);
    } else {
      logs.push(`${pc.name} lacks 6s for rations.`);
    }
    buildProceduralScene(state, world);
    return logs;
  }

  if (option.actionId === 'briefing_hire_outcast') {
    const res = recruitOutcastFollower(state, world, { costSilver: 25, pcIndex: pcIdx });
    if (res.ok) {
      state.activeContract.outcastHired = true;
    }
    logs.push(res.message);
    buildProceduralScene(state, world);
    return logs;
  }

  if (option.actionId === 'briefing_depart') {
    state.activeContract.phase = 'travel';
    logs.push(`You set out toward ${state.activeContract.dungeonName}.`);
    buildProceduralScene(state, world);
    return logs;
  }

  if (option.actionId.startsWith('briefing_class_')) {
    state.activeContract.negotiated = true;
    if (option.actionId === 'briefing_class_royalty') {
      const t = rollAbilityTest(pc, 'presence', 12, state, { label: 'Invoke noble bloodline' });
      logs.push(t.logLine);
      if (t.success) {
        const extra = Math.round(state.activeContract.rewardSilver * 0.3);
        state.activeContract.rewardSilver += extra;
        logs.push(`Your haughty contempt works — the patron raises the bounty by +${extra}s (now ${state.activeContract.rewardSilver}s)!`);
      } else {
        logs.push('The patron spits at your tattered crest. The bounty stays as offered.');
      }
    } else if (option.actionId === 'briefing_class_deserter') {
      const t = rollAbilityTest(pc, 'strength', 12, state, { label: 'Extort advance silver' });
      logs.push(t.logLine);
      if (t.success) {
        pc.silver += 20;
        logs.push(`Seeing your protruding fangs, the courier tosses 20s upfront (${pc.silver}s total)!`);
      } else {
        logs.push('Hidden guards click crossbows behind the curtain — no advance silver.');
      }
    } else if (option.actionId === 'briefing_class_scum') {
      const t = rollAbilityTest(pc, 'agility', 10, state, { label: 'Tap gutter shortcut' });
      logs.push(t.logLine);
      if (t.success) {
        state.activeContract.travelLegsRemaining = Math.max(1, state.activeContract.travelLegsRemaining - 1);
        logs.push(`Gutter runners mark a back-alley track: travel shortened to ${state.activeContract.travelLegsRemaining} leg(s)!`);
      } else {
        logs.push('Your informants have already been hanged; you must take the long road.');
      }
    } else if (option.actionId === 'briefing_class_hermit') {
      const t = rollAbilityTest(pc, 'presence', 8, state, { label: "Read Verhu's stars" });
      logs.push(t.logLine);
      if (t.success) {
        state.activeContract.prophecyRevealed = true;
        const truthNum = (state.activeContract.prophecyTruthIndex ?? 0) + 1;
        logs.push(`The stars align: Omen #${truthNum} is unequivocally TRUE!`);
      } else {
        logs.push('Cloud-ash swallows the constellations; the omens stay murky.');
      }
    } else if (option.actionId === 'briefing_class_priest') {
      const t = rollAbilityTest(pc, 'presence', 10, state, { label: 'Chant heretical ward' });
      logs.push(t.logLine);
      if (t.success) {
        const ward = rollDie(4, state);
        for (const m of state.party.members) {
          if (m.status === 'alive') {
            const fs = ensureFeatureState(m);
            fs.tempHp = (fs.tempHp ?? 0) + ward;
          }
        }
        logs.push(`Blasphemous litanies harden your skin: living party gains +${ward} temporary HP!`);
      } else {
        logs.push('The ward curdles on your tongue; nothing answers.');
      }
    } else if (option.actionId === 'briefing_class_herbmaster') {
      const t = rollAbilityTest(pc, 'presence', 10, state, { label: 'Identify dungeon spores' });
      logs.push(t.logLine);
      if (t.success && state.activeDungeon) {
        logs.push(`Residue reveals the pit's core hazard: ${state.activeDungeon.centralHazardName} (${state.activeDungeon.centralHazardAbility.toUpperCase()} DR${state.activeDungeon.centralHazardDr}) — guarded by ${state.activeDungeon.bossName}!`);
      } else {
        logs.push('The damp reek masks any usable spore trace.');
      }
    }
    buildProceduralScene(state, world);
    return logs;
  }

  if (option.actionId === 'vignette_act') {
    const vig = ROAD_VIGNETTES.find((v) => v.id === state.activeContract.activeVignetteId);
    state.activeContract.vignetteResolved = true;
    if (!vig) {
      buildProceduralScene(state, world);
      return ['The roadside figure has already slipped into the mist.'];
    }
    const t = rollAbilityTest(pc, vig.actCheck, vig.actDr, state, { label: vig.actLabel.slice(0, 48) });
    logs.push(`[Roll] ${t.logLine}`);
    if (t.success) {
      logs.push(vig.actSuccessText);
      if (vig.rewardSilver) {
        pc.silver += vig.rewardSilver;
        logs.push(`${pc.name} pockets ${vig.rewardSilver}s.`);
      }
      if (vig.rewardRation) {
        pc.foodDays += vig.rewardRation;
        logs.push(`${pc.name} claims +${vig.rewardRation} day(s) of dry rations.`);
      }
    } else {
      logs.push(vig.actFailText);
      if (vig.failDamageDie) {
        const dmg = parseDiceExpr(vig.failDamageDie, state);
        pc.hp -= dmg;
        logs.push(`${pc.name} takes ${dmg} dmg (${pc.hp}/${pc.maxHp} HP).`);
        logs.push(...applyBrokenOrDead(pc, state));
      }
    }
    if (state.mode !== 'game_over') buildProceduralScene(state, world);
    return logs;
  }

  if (option.actionId === 'vignette_bypass') {
    const vig = ROAD_VIGNETTES.find((v) => v.id === state.activeContract.activeVignetteId);
    state.activeContract.vignetteResolved = true;
    logs.push(vig?.bypassText ?? 'You skirt past in grim silence.');
    buildProceduralScene(state, world);
    return logs;
  }

  if (option.actionId === 'riddle_answer' && state.activeDungeon) {
    const d = state.activeDungeon;
    const room = d.rooms[d.currentRoomId];
    const inter = room.interactables.find((i) => i.kind === 'riddle_door' && !i.used);
    const riddle = DUNGEON_RIDDLES[d.riddleIndex ?? 0] ?? DUNGEON_RIDDLES[0];
    if (option.targetId === riddle.correctIndex) {
      if (inter) inter.used = true;
      d.puzzleSolved = true;
      logs.push(riddle.solveText);
    } else {
      const shock = rollDie(4, state);
      pc.hp -= shock;
      logs.push(`${riddle.failText} (-${shock} HP, ${pc.hp}/${pc.maxHp} HP)`);
      logs.push(...applyBrokenOrDead(pc, state));
    }
    if (state.mode !== 'game_over') buildProceduralScene(state, world);
    return logs;
  }

  if (option.actionId === 'riddle_force' && state.activeDungeon) {
    const d = state.activeDungeon;
    const room = d.rooms[d.currentRoomId];
    const inter = room.interactables.find((i) => i.kind === 'riddle_door' && !i.used);
    const t = rollAbilityTest(pc, 'strength', 14, state, { label: `Force ${d.puzzleStatueName} riddle-door` });
    logs.push(`[Roll] ${t.logLine}`);
    if (t.success) {
      if (inter) inter.used = true;
      d.puzzleSolved = true;
      logs.push(`${pc.name} shears the iron bolts off! ${d.puzzleUnlockText}`);
    } else {
      const dmg = rollDie(2, state);
      pc.hp -= dmg;
      logs.push(`The iron frame refuses to budge and cuts ${pc.name}'s hands (-${dmg} HP)!`);
      logs.push(...applyBrokenOrDead(pc, state));
    }
    if (state.mode !== 'game_over') buildProceduralScene(state, world);
    return logs;
  }

  if (option.actionId === 'travel_advance') {
    logs.push(...advanceWorldHours(state, 4));
    if (state.mode === 'game_over') return logs;
    state.activeContract.travelLegsRemaining -= 1;
    state.activeContract.activeVignetteId = null;
    state.activeContract.vignetteResolved = false;

    // Troubling Tale Pursuer check
    const pursuer = rollTroublingTalePursuer(state, world);
    if (pursuer) {
      const combat = startCombat(state, world, [pursuer.creatureId], true);
      logs.push(pursuer.intro, ...combat.log);
      return logs;
    }

    if (state.activeContract.travelLegsRemaining <= 0) {
      state.activeContract.phase = 'dungeon';
      state.mode = 'dungeon';
      if (!state.activeDungeon) {
        generateProceduralDungeon(state, world);
      }
      logs.push(`You arrive at the gaping mouth of ${state.activeDungeon!.name}!`);
      buildProceduralScene(state, world);
      return logs;
    }

    // Mid-travel hazard or stray beast (Horse can skip 1 hazard per contract; Travel Peril raises DR)
    const horseOwner = state.party.members.find(
      (m) =>
        m.status === 'alive' &&
        m.inventory.some((i) => i.name.toLowerCase().includes('horse')) &&
        m.featureState?.horseSkipUsedContract !== state.activeContract.contractNumber,
    );
    const travelPeril = getActiveMiseryEffects(state).counts.travel_peril;
    if (rollDie(3, state) === 1) {
      if (horseOwner) {
        ensureFeatureState(horseOwner).horseSkipUsedContract = state.activeContract.contractNumber;
        logs.push(`${horseOwner.name}'s Horse bolts safely past a muddy roadside hazard!`);
      } else {
        const t = rollAbilityTest(pc, 'toughness', 10 + travelPeril * 2, state, { label: `Endure ${state.currentWeather}` });
        logs.push(t.logLine);
        if (!t.success) {
          const dmg = rollDie(2, state);
          pc.hp -= dmg;
          logs.push(`${pc.name} suffers ${dmg} exposure damage!`);
          logs.push(...applyBrokenOrDead(pc, state));
        }
      }
    } else if (rollDie(6, state) === 1) {
      if (state.party.followers.filter((f) => f.status === 'alive').length < 2 && rollDie(2, state) === 1) {
        const reactMod = getTraitReactionModifier(pc, world);
        const test = rollAbilityTest(pc, 'presence', 10, state, { label: 'Parley with stray outcast', extraMod: reactMod });
        logs.push(test.logLine);
        if (test.success) {
          const rec = recruitOutcastFollower(state, world);
          logs.push(rec.message);
        } else {
          logs.push('A ragged wanderer watches you from a ditch, then bolts into the mist.');
        }
      } else {
        const chosenBeast = world.beasts[rollDie(world.beasts.length, state) - 1];
        logs.push(`An abandoned ${chosenBeast.name} trails your lantern down the muddy track!`);
        logs.push(grantBeastToPc(pc, chosenBeast.name, state));
      }
    } else {
      logs.push('The road groans under bleak skies, yet nothing ambushes you.');
    }
    buildProceduralScene(state, world);
    return logs;
  }

  if (option.actionId === 'travel_scout') {
    const misery = getActiveMiseryEffects(state).counts;
    const t = rollAbilityTest(pc, 'presence', 12 + misery.travel_peril * 2, state, { label: 'Scout roadside wreckage' });
    logs.push(t.logLine);
    if (t.success) {
      if (rollDie(5, state) === 1) {
        const chosen = world.beasts[rollDie(world.beasts.length, state) - 1];
        logs.push(grantBeastToPc(pc, chosen.name, state));
      } else {
        const s = rollDie(20, state);
        pc.silver += s;
        logs.push(`${pc.name} scavenges ${s} silver from a wrecked cart!`);
      }
    } else {
      const roadPool =
        misery.undead_surge > 0
          ? ['skeleton', 'zombie', 'wraith', 'bounty_hunter', 'scum']
          : state.activeContract.contractNumber >= 2
            ? ['goblin', 'scum', 'bounty_hunter', 'berserker', 'zombie', 'wraith', 'troll', 'wyvern', 'mongrel']
            : ['goblin', 'scum', 'bounty_hunter', 'zombie', 'mongrel', 'berserker', 'wraith'];
      const ambushId = roadPool[rollDie(roadPool.length, state) - 1];
      const def = world.creaturesById[ambushId];
      const combat = startCombat(state, world, [ambushId], false);
      logs.push(`${def?.name ?? ambushId} ambushes you from the roadside ditches!`, ...combat.log);
      return logs;
    }
    buildProceduralScene(state, world);
    return logs;
  }

  if (option.actionId === 'travel_rest') {
    const heal = rollDie(4, state);
    const prev = pc.hp;
    pc.hp = Math.min(pc.maxHp, pc.hp + heal);
    logs.push(`${pc.name} catches breath beside a cold stone: +${pc.hp - prev} HP (${pc.hp}/${pc.maxHp}).`);
    buildProceduralScene(state, world);
    return logs;
  }

  if (option.actionId === 'dungeon_move' && typeof option.targetId === 'number') {
    const res = enterDungeonRoom(state, world, option.targetId);
    logs.push(...res.logs);
    if (res.entered && state.mode !== 'game_over') {
      logs.push(...advanceWorldHours(state, 1));
    }
    if (state.mode !== 'combat' && state.mode !== 'game_over') {
      buildProceduralScene(state, world);
    }
    return logs;
  }

  if (option.actionId === 'doff_heavy_armor') {
    for (const m of state.party.members) {
      if (m.status === 'alive' && m.armorTier === 3) {
        m.stashedArmorTier = m.armorTier;
        m.stashedArmorName = m.armorName;
        m.armorTier = 0;
        m.armorName = 'No armor (Heavy armor stashed)';
        logs.push(`${m.name} unbuckles and stashes their Heavy Armor to fit through the crawlway.`);
      }
    }
    buildProceduralScene(state, world);
    return logs;
  }

  if (option.actionId === 'don_heavy_armor') {
    for (const m of state.party.members) {
      if (m.status === 'alive' && m.stashedArmorTier !== undefined) {
        m.armorTier = m.stashedArmorTier;
        m.armorName = m.stashedArmorName ?? 'Heavy armor';
        delete m.stashedArmorTier;
        delete m.stashedArmorName;
        logs.push(`${m.name} straps back into ${m.armorName}.`);
      }
    }
    buildProceduralScene(state, world);
    return logs;
  }

  if (option.actionId === 'dungeon_leave') {
    const contract = state.activeContract;
    const completed =
      contract.objectiveSecured || (contract.objectiveKind === 'slay_boss' && contract.bossSlain);
    if (completed) {
      const share = Math.max(10, Math.floor(contract.rewardSilver / Math.max(1, state.party.members.filter((m) => m.status !== 'dead').length)));
      for (const m of state.party.members) {
        if (m.status !== 'dead') {
          m.silver += share;
          logs.push(`${m.name} receives ${share}s contract payout!`);
          logs.push(...improveCharacter(m, state, world));
        }
      }
      if (contract.contractSize === 'large' || rollDie(2, state) === 1) {
        const g = grantOccultRelic(
          pc,
          state,
          world,
          contract.contractSize === 'large' ? true : rollDie(5, state) <= 4,
        );
        logs.push(
          `${contract.contractSize === 'large' ? 'Deep Descent patron relic bonus' : 'Patron bonus'}: ${pc.name} receives Occult Treasure — ${g.name}!`,
        );
      }
      logs.push(...rollNextContract(state, world));
    } else {
      state.activeDungeon = null;
      state.mode = 'exploration';
      contract.phase = 'travel';
      contract.travelLegsRemaining = 1;
      logs.push('You flee back to the surface without completing the contract.');
    }
    buildProceduralScene(state, world);
    return logs;
  }

  if (option.actionId.startsWith('interact:') && state.activeDungeon) {
    const interId = option.actionId.slice('interact:'.length);
    const room = state.activeDungeon.rooms[state.activeDungeon.currentRoomId];
    const inter = room.interactables.find((i) => i.id === interId);
    if (inter && !inter.used) {
      logs.push(...executeInteractable(state, world, room, inter));
    }
    if (state.mode !== 'combat' && state.mode !== 'game_over') {
      buildProceduralScene(state, world);
    }
    return logs;
  }

  if (option.actionId.startsWith('trait:')) {
    const key = option.actionId.slice('trait:'.length);
    logs.push(...executeTraitChoice(state, world, key));
    if (state.mode !== 'combat' && state.mode !== 'game_over') {
      buildProceduralScene(state, world);
    }
    return logs;
  }

  // Fallback freeform test
  const fallback = rollAbilityTest(pc, 'presence', 12, state, { label: option.label });
  logs.push(fallback.logLine);
  buildProceduralScene(state, world);
  return logs;
}

export function resolveFreeformProceduralInput(
  state: GameState,
  world: WorldDatabase,
  rawInput: string,
): string[] {
  const matched = matchFreeformAction(rawInput, state);
  if (matched) {
    return resolveChoiceOption(state, world, matched);
  }

  const pc = state.party.members[getActivePcIndex(state)];
  const lower = rawInput.toLowerCase();
  const ability =
    lower.includes('lift') || lower.includes('break') || lower.includes('smash') || lower.includes('force')
      ? 'strength'
      : lower.includes('dodge') || lower.includes('climb') || lower.includes('sneak') || lower.includes('hide')
        ? 'agility'
        : lower.includes('endure') || lower.includes('resist') || lower.includes('drink')
          ? 'toughness'
          : 'presence';

  const test = rollAbilityTest(pc, ability, 12, state, { label: rawInput.slice(0, 48) });
  const logs: string[] = [test.logLine];
  if (test.success && hasTraitTag(pc, 'shrewd', world) && rollDie(4, state) === 1) {
    pc.silver += 5;
    logs.push(`${pc.name}'s shrewd eye spots 5s tucked behind loose stone.`);
  }
  buildProceduralScene(state, world);
  return logs;
}
