import type { WorldDatabase } from '../db/loader.ts';
import type { ChoiceOption, DungeonRoom, GameState, InventoryItem } from '../types.ts';
import { applyBrokenOrDead, rollReaction, startCombat } from '../combat.ts';
import { parseDiceExpr, rollAbilityTest, rollDice, rollDie } from '../dice.ts';
import { improveCharacter } from '../rules/advancement.ts';
import { generateProceduralDungeon } from '../rules/dungeon.ts';
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
  if (room.corpsesRemaining > 0 || room.role === 'cells' || room.role === 'debris_room') tags.add('corpses');
  if (room.role === 'rival_sanctuary' || room.role === 'cells') tags.add('parley');
  if (room.role === 'rival_sanctuary') tags.add('brew');
  if (room.role === 'hazard_rim' || room.role === 'boss_lair' || room.role === 'puzzle_statue') tags.add('hazard');
  if (room.role === 'dining_hall' || room.role === 'library' || room.role === 'guard_post' || room.role === 'rival_sanctuary') {
    tags.add('burnable');
  }
  if (state.activeDungeon?.centralHazardId === 'sulfuric_tar_vats') tags.add('burnable');
  return tags;
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
  const rewardSilver = (rollDie(6, state) + 4) * 20 + nextNum * 15;

  const region = world.regions[rollDie(world.regions.length, state) - 1];
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
    phase: 'briefing',
    travelLegsRemaining: rollDie(2, state),
    objectiveSecured: false,
    bossSlain: false,
    shopVisited: false,
  };

  generateProceduralDungeon(state, world);
  state.chronicle.push(`Contract #${nextNum}: ${obj.title} at ${state.activeContract.dungeonName} (${rewardSilver}s).`);
  return [`New Contract #${nextNum} from ${patron.name}: ${obj.title} (${rewardSilver}s).`];
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
    const lines = [
      `[Contract #${contract.contractNumber} — ${contract.patronName}]`,
      `${contract.patronHook} Target: ${contract.objectiveTitle} inside ${contract.dungeonName} (Bounty: ${contract.rewardSilver}s). ${contract.objectiveBrief}`,
      `${seerIntro}`,
      `  1) "${contract.prophecies[0]}"`,
      `  2) "${contract.prophecies[1]}"`,
    ];
    if (traitCallout) lines.push(traitCallout);

    options.push({ label: `Press the Seer for details about ${contract.dungeonName} (Presence DR10)`, actionId: 'briefing_question_seer', requiresRoll: true });
    if (!contract.shopVisited) {
      options.push({ label: 'Buy travel rations & waterskin refill before departing (6s)', actionId: 'briefing_buy_supplies' });
    }
    options.push({ label: `Depart into ${state.currentRegionName} toward ${contract.dungeonName}`, actionId: 'briefing_depart' });

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
    const lines = [
      `[${state.currentRegionName} — ${state.currentWeather}]`,
      `${open} ${mood} (${contract.travelLegsRemaining} travel leg(s) remain before ${contract.dungeonName}.)`,
    ];
    if (traitCallout) lines.push(traitCallout);

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
  const light = pickProse(state, 'light', world.proseFragments.lightingDetails);
  const smell = pickProse(state, 'smell', world.proseFragments.sensorySmells);
  const sound = room.silenced
    ? 'Total, suffocating silence presses against your eardrums; even footsteps make no noise.'
    : room.role === 'hazard_rim' || room.role === 'boss_lair' || room.role === 'puzzle_statue'
      ? `${d.centralHazardName} fumes thick in the air.`
      : pickProse(state, 'sound', world.proseFragments.sensorySounds);
  const atmo = pickProse(state, 'atmo', world.proseFragments.roomAtmospheres);

  const lines = [
    `${room.feature}`,
    `${light} ${smell} ${sound} ${atmo}`,
  ];
  if (traitCallout) lines.push(traitCallout);

  for (const inter of room.interactables) {
    if (inter.used) continue;
    const needsRoll =
      inter.kind === 'bookshelf' ||
      inter.kind === 'pit_trap' ||
      inter.kind === 'hazard_cross' ||
      inter.kind === 'prisoners' ||
      inter.kind === 'rival_camp' ||
      inter.kind === 'objective';
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

  d.currentRoomId = targetId;
  dest.visited = true;
  const logs: string[] = [`Entered ${dest.label}.`];
  const pcIdx = getActivePcIndex(state);
  const pc = state.party.members[pcIdx];

  // Corridor pit trap
  if (dest.trap && !dest.trapTriggered) {
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
  }

  // Room resident enemies
  if (dest.enemyIds.length > 0) {
    const combat = startCombat(state, world, [...dest.enemyIds], false);
    dest.enemyIds = [];
    logs.push(...combat.log);
    return { entered: true, logs };
  }

  // Random encounter rooms (Pump room, Chain room, Debris room) -> Table A / Table B
  if (
    !dest.encounterRolled &&
    (dest.role === 'pump_room' || dest.role === 'chain_room' || dest.role === 'debris_room')
  ) {
    dest.encounterRolled = true;
    const roll = rollDie(6, state);
    if (roll <= 2 && !d.tableBTriggered) {
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
      }
    } else if (roll >= 4) {
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
      logs.push(`${pc.name} translates a booklet without disturbing the skeletons: gained Unclean Scroll (${sc.name})!`);
    } else if (r === 2) {
      pc.notes.push('Book-induced dizziness (+2 DR for 30 min)');
      logs.push(`${pc.name} grows terribly light-headed reading the frenzied script (+2 DR for half an hour).`);
    } else if (r === 3) {
      logs.push('The script twists like worms and remains utterly incomprehensible.');
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
    if (!ensureSocketItemInParty(state)) {
      pc.inventory.push({ id: `guard_eye_${Date.now()}`, name: d.puzzleSocketItemName, kind: 'treasure' });
      logs.push(`Tucked in a guard's purse lies ${d.puzzleSocketItemName}.`);
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
    } else {
      logs.push(`${pc.name} jerks back from grasping fingers and snatches ${d.puzzleSocketItemName} from a dead cellmate!`);
      if (!ensureSocketItemInParty(state)) {
        pc.inventory.push({ id: `cell_eye_${Date.now()}`, name: d.puzzleSocketItemName, kind: 'treasure' });
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
    inter.used = true;
    if (pc.silver >= 30) {
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
    } else {
      logs.push(`Sagsobuth's vortex-face flickers: "30 silver for the Beechwood Tube, beggar. Come back with coin."`);
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
    const t = rollAbilityTest(pc, 'presence', 12, state, { label: 'Bone-dice wager' });
    logs.push(t.logLine);
    if (t.success) {
      pc.silver += 15;
      logs.push(`${pc.name} pockets 15s from a gullible fool!`);
    } else {
      const lost = Math.min(pc.silver, 10);
      pc.silver -= lost;
      logs.push(`${pc.name} loses ${lost}s on crooked bone dice.`);
    }
    return logs;
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
    [['eye', 'socket', 'statue', 'idol', 'insert', 'place'], ['statue_socket']],
    [['heir', 'aldon', 'claim', 'relic', 'altar', 'objective', 'extract'], ['objective']],
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
      logs.push(`The Seer hisses: "Seek ${state.activeDungeon.puzzleSocketItemName} to open ${state.activeDungeon.puzzleStatueName}. Beware ${state.activeDungeon.bossName}."`);
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

  if (option.actionId === 'briefing_depart') {
    state.activeContract.phase = 'travel';
    logs.push(`You set out toward ${state.activeContract.dungeonName}.`);
    buildProceduralScene(state, world);
    return logs;
  }

  if (option.actionId === 'travel_advance') {
    state.calendar.hour = (state.calendar.hour + 4) % 24;
    state.activeContract.travelLegsRemaining -= 1;

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

    // Mid-travel hazard
    if (rollDie(3, state) === 1) {
      const t = rollAbilityTest(pc, 'toughness', 10, state, { label: `Endure ${state.currentWeather}` });
      logs.push(t.logLine);
      if (!t.success) {
        const dmg = rollDie(2, state);
        pc.hp -= dmg;
        logs.push(`${pc.name} suffers ${dmg} exposure damage!`);
        logs.push(...applyBrokenOrDead(pc, state));
      }
    } else {
      logs.push('The road groans under bleak skies, yet nothing ambushes you.');
    }
    buildProceduralScene(state, world);
    return logs;
  }

  if (option.actionId === 'travel_scout') {
    const t = rollAbilityTest(pc, 'presence', 12, state, { label: 'Scout roadside wreckage' });
    logs.push(t.logLine);
    if (t.success) {
      const s = rollDie(20, state);
      pc.silver += s;
      logs.push(`${pc.name} scavenges ${s} silver from a wrecked cart!`);
    } else {
      const combat = startCombat(state, world, ['goblin'], false);
      logs.push('A filthy goblin springs from the ditch!', ...combat.log);
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
      if (rollDie(2, state) === 1) {
        const relic = world.occultTreasures[rollDie(world.occultTreasures.length, state) - 1];
        pc.inventory.push({ id: `relic_${Date.now()}`, name: relic.name, kind: 'relic', notes: relic.effect });
        logs.push(`Patron bonus: ${pc.name} receives Occult Treasure — ${relic.name}!`);
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
