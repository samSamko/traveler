import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadWorldDatabase } from '../src/db/loader.ts';
import { resolveEnemyAttack, applyBrokenOrDead, finishCombatIfEnded, resolvePcAttack, rollReaction, startCombat } from '../src/combat.ts';
import { parseDiceExpr, rollAbilityTest, scoreToAbilityMod } from '../src/dice.ts';
import { initializeOpeningScene, processPlayerInput } from '../src/engine.ts';
import {
  buildProceduralScene,
  enterDungeonRoom,
  matchFreeformAction,
  resolveChoiceOption,
} from '../src/gm/procedural.ts';
import { improveCharacter } from '../src/rules/advancement.ts';
import { getActiveMiseryEffects, rollDawnMisery, triggerSpecificOrRandomMisery } from '../src/rules/calendar.ts';
import { grantBeastToPc } from '../src/rules/class_features.ts';
import { createInitialGameState, generateCharacter } from '../src/rules/chargen.ts';
import { generateProceduralDungeon, verifyDungeonSolvable } from '../src/rules/dungeon.ts';
import { castScroll } from '../src/rules/powers.ts';
import { advanceWorldHours, catchBreath, fullNightsRest } from '../src/rules/rest.ts';
import {
  getCharacterTraitProfiles,
  getTraitReactionModifier,
  getUnlockedTraitChoices,
  pickTraitProseCallout,
  rollTroublingTalePursuer,
} from '../src/rules/traits.ts';
import { deleteActiveSave, loadGame, recordRunCompletion, saveGame } from '../src/save.ts';
import type { ClassId } from '../src/types.ts';
import { getGameScreenParts, inferDiceSpecs } from '../src/ui.ts';

test('SQLite Bare Bones + Sludge database loads all expanded tables accurately', () => {
  const world = loadWorldDatabase();
  assert.equal(world.names.length, 48);
  assert.equal(world.classes.length, 6);
  assert.equal(world.creatures.length, 32);
  assert.equal(world.traitProfiles.length, 80);
  assert.equal(world.campaigns.patrons.length, 12);
  assert.equal(world.campaigns.objectives.length, 12);
  assert.equal(world.campaigns.centralHazards.length, 10);
  assert.equal(world.campaigns.rivalFactions.length, 8);
  assert.equal(world.campaigns.puzzleStatues.length, 6);
  assert.equal(world.campaigns.bosses.length, 8);
  assert.equal(world.calendarPsalms.length, 37);
});

test('Dice helpers and ability modifier table match Bare Bones p. 27', () => {
  assert.equal(scoreToAbilityMod(3), -3);
  assert.equal(scoreToAbilityMod(6), -2);
  assert.equal(scoreToAbilityMod(8), -1);
  assert.equal(scoreToAbilityMod(11), 0);
  assert.equal(scoreToAbilityMod(14), 1);
  assert.equal(scoreToAbilityMod(16), 2);
  assert.equal(scoreToAbilityMod(18), 3);

  const rng = { rngState: 42 };
  const silver = parseDiceExpr('2d6*10', rng);
  assert.ok(silver >= 20 && silver <= 120 && silver % 10 === 0);
});

test('Chargen rolls 2-4 PCs by d3+1, supports solo, and supports all 6 optional classes', () => {
  const world = loadWorldDatabase();
  const sizes = new Set<number>();
  for (let s = 1; s <= 30; s += 1) {
    const st = createInitialGameState(world, { seed: s * 997, useRandomClasses: true });
    assert.equal(st.version, 2);
    assert.ok(st.party.members.length >= 2 && st.party.members.length <= 4);
    sizes.add(st.party.members.length);
  }
  assert.equal(sizes.size, 3);

  const soloState = createInitialGameState(world, { seed: 606, solo: true });
  assert.equal(soloState.party.members.length, 1);

  const classes: ClassId[] = [
    'classless',
    'fanged_deserter',
    'gutterborn_scum',
    'esoteric_hermit',
    'wretched_royalty',
    'heretical_priest',
    'occult_herbmaster',
  ];
  const rng = { rngState: 12345 };
  for (let i = 0; i < classes.length; i += 1) {
    const pc = generateCharacter(world, classes[i], rng, i + 1);
    assert.ok(pc.maxHp >= 1);
    assert.equal(getCharacterTraitProfiles(pc, world).length, 5, 'All 5 trait slots should map to trait_profiles');
  }
});

test('All 80 trait profiles resolve, unlock contextual choices, modify reactions, and spawn pursuers', () => {
  const world = loadWorldDatabase();
  const state = createInitialGameState(world, { seed: 88, solo: true });
  const pc = state.party.members[0];

  pc.traits.terrible = [world.terribleTraits[9].text, world.terribleTraits[13].text]; // Shrewd (+1), Suspicious
  pc.traits.brokenBody = world.brokenBodies[7].text; // Hauntingly beautiful (+2)
  pc.traits.badHabit = world.badHabits[13].text; // Pyromaniac
  pc.traits.troublingTale = world.troublingTales[0].text; // Pursued for manslaughter (-1, bounty_hunter)

  assert.equal(getTraitReactionModifier(pc, world), 2);
  const unlocked = getUnlockedTraitChoices(pc, new Set(['always', 'parley', 'burnable']), world);
  assert.ok(unlocked.some((c) => c.actionId === 'trait:shrewd_read'));
  assert.ok(unlocked.some((c) => c.actionId === 'trait:pyro_burn'));
  assert.ok(unlocked.some((c) => c.actionId === 'trait:suspicious_probe'));

  const callout1 = pickTraitProseCallout(pc, state, world);
  const callout2 = pickTraitProseCallout(pc, state, world);
  assert.ok(callout1 && callout2 && callout1 !== callout2, 'Trait callouts should vary without repeating');

  let pursuerTriggered = false;
  for (let i = 0; i < 30; i += 1) {
    const p = rollTroublingTalePursuer(state, world);
    if (p) {
      assert.equal(p.creatureId, 'bounty_hunter');
      pursuerTriggered = true;
      break;
    }
  }
  assert.ok(pursuerTriggered, 'Expected Troubling Tale #1 pursuer to trigger across travel rolls');
});

test('Bad Habit #19 whistles on stealth rolls 5/7/9/11/13 and Armor/Carry DR penalties apply', () => {
  const world = loadWorldDatabase();
  const state = createInitialGameState(world, { seed: 77 });
  const pc = state.party.members[0];
  pc.abilities.agility = 6;
  pc.armorTier = 3;
  pc.inventory = [];
  pc.carryingCapacity = 8;

  const agiCheck = rollAbilityTest(pc, 'agility', 12, state);
  assert.equal(agiCheck.effectiveDr, 16);

  pc.traits.badHabit = world.badHabits[18].text;
  let whistleSeen = false;
  for (let i = 0; i < 40; i += 1) {
    const res = rollAbilityTest(pc, 'agility', 10, state, { label: 'Hide in shadows' });
    if (res.logLine.includes('[WHISTLED WHILE HIDING!]')) {
      assert.equal(res.success, false);
      whistleSeen = true;
      break;
    }
  }
  assert.ok(whistleSeen);
});

test('Procedural sized dungeons (1-2 floors) are always solvable across objectives/puzzles and enforce locks, tunnel, & secret vault', () => {
  const world = loadWorldDatabase();
  const seenPuzzleKinds = new Set<string>();
  const kinds = ['rescue_heir', 'slay_boss', 'steal_relic', 'sabotage'] as const;
  for (let s = 1; s <= 24; s += 1) {
    const st = createInitialGameState(world, { seed: s * 313 });
    st.activeContract.objectiveKind = kinds[s % kinds.length];
    const { dungeon } = generateProceduralDungeon(st, world);
    assert.ok(dungeon.rooms.length >= 4 && dungeon.rooms.length <= 20);
    assert.equal(
      verifyDungeonSolvable(dungeon, st.activeContract.objectiveKind),
      true,
      `Seed ${s} (${st.activeContract.objectiveKind}) dungeon should be fully solvable`,
    );
    seenPuzzleKinds.add(dungeon.puzzleKind);
    assert.ok(st.activeContract.prophecies[0].length > 10);
  }
  assert.ok(seenPuzzleKinds.size >= 3, 'Procedural generator should vary puzzle archetypes across seeds');

  // Test heavy-armor tunnel block & puzzle vault unlock on standard medium dungeon
  const state = createInitialGameState(world, { seed: 909, solo: true });
  state.activeContract.contractSize = 'medium';
  const { dungeon } = generateProceduralDungeon(state, world);
  state.mode = 'dungeon';
  state.activeContract.phase = 'dungeon';

  const rim = dungeon.rooms.find((r) => r.role === 'hazard_rim')!;
  const tunnel = dungeon.rooms.find((r) => r.role === 'tight_tunnel')!;
  dungeon.currentRoomId = rim.id;
  state.party.members[0].armorTier = 3;

  const blocked = enterDungeonRoom(state, world, tunnel.id);
  assert.equal(blocked.entered, false);
  assert.ok(blocked.logs[0].includes('Heavy Armor'));

  // Puzzle unlock (supports any rolled puzzleKind)
  const statueRoom = dungeon.rooms.find((r) => r.role === 'puzzle_statue')!;
  const vault = dungeon.rooms.find((r) => r.role === 'locked_vault')!;
  dungeon.currentRoomId = statueRoom.id;
  const lockedVault = enterDungeonRoom(state, world, vault.id);
  assert.equal(lockedVault.entered, false);

  if (dungeon.puzzleKind === 'socket_statue') {
    state.party.members[0].inventory.push({
      id: 'eye_token',
      name: dungeon.puzzleSocketItemName,
      kind: 'treasure',
    });
  } else if (dungeon.puzzleKind === 'inscription_cipher') {
    dungeon.puzzleCluesFound = 2;
  } else if (dungeon.puzzleKind === 'offering_scale') {
    state.party.members[0].silver = 25;
  } else {
    state.party.members[0].hp = 20;
    state.party.members[0].maxHp = 20;
  }
  buildProceduralScene(state, world);
  const puzzleOpt = state.pendingChoiceOptions.find(
    (o) =>
      o.targetId === 'statue_socket' ||
      o.targetId === 'inscription_cipher' ||
      o.targetId === 'blood_altar' ||
      o.targetId === 'offering_scale' ||
      o.actionId === 'riddle_force',
  )!;
  if (puzzleOpt.actionId === 'riddle_force') {
    state.party.members[0].abilities.strength = 3;
    while (!dungeon.puzzleSolved) {
      state.party.members[0].hp = 20;
      resolveChoiceOption(state, world, puzzleOpt);
    }
    assert.equal(dungeon.puzzleSolved, true);
  } else {
    const unlockLogs = resolveChoiceOption(state, world, puzzleOpt);
    assert.equal(dungeon.puzzleSolved, true);
    assert.ok(unlockLogs.length >= 1);
  }

  const enteredVault = enterDungeonRoom(state, world, vault.id);
  assert.equal(enteredVault.entered, true);
});

test('Boss death pacifies Apex Beast and unlocks Boss key', () => {
  const world = loadWorldDatabase();
  const state = createInitialGameState(world, { seed: 515, solo: true });
  const { dungeon } = generateProceduralDungeon(state, world);
  state.mode = 'dungeon';

  const combat = startCombat(state, world, [dungeon.bossEnemyId]);
  assert.equal(dungeon.apexPacified, false);
  combat.enemies[0].hp = 0;
  combat.enemies[0].status = 'dead';
  const logs = finishCombatIfEnded(state);
  assert.equal(dungeon.apexPacified, true);
  assert.equal(dungeon.hasBossKey, true);
  assert.equal(state.activeContract.bossSlain, true);
  assert.ok(logs.some((l) => l.includes('Looted')));
});

test('Combat, Protean Scroll dawn mutation, Calendar 7:7, and Rest work cleanly', () => {
  const world = loadWorldDatabase();
  const state = createInitialGameState(world, { seed: 101 });
  const pc = state.party.members[0];
  pc.inventory.push({
    id: 'prot_1',
    name: `Protean Scroll: ${world.uncleanScrolls[0].name}`,
    kind: 'unclean_scroll',
    scrollKind: 'unclean',
    scrollRoll: 1,
    proteanScroll: true,
    notes: 'Mutates at dawn',
  });
  const nightLogs = fullNightsRest(state, world);
  assert.ok(nightLogs.some((l) => l.includes('Protean Scroll shifts at dawn')));

  // Calendar 7:7
  for (let i = 0; i < 6; i += 1) triggerSpecificOrRandomMisery(state, world);
  const fin = triggerSpecificOrRandomMisery(state, world);
  assert.equal(fin.code, '7:7');
  assert.equal(state.calendar.worldEnded, true);
  assert.equal(state.mode, 'game_over');
});

test('Freeform verb-keyword parser & full Contract -> Dungeon -> Turn-In -> Next Contract loop', () => {
  const world = loadWorldDatabase();
  const state = createInitialGameState(world, { seed: 303, solo: true });
  initializeOpeningScene(state, world);
  assert.equal(state.activeContract.contractNumber, 1);
  assert.equal(state.activeContract.phase, 'briefing');

  // Depart -> travel until dungeon
  processPlayerInput(state, world, 'depart', true);
  assert.equal(state.activeContract.phase, 'travel');
  let guard = 0;
  while (state.activeContract.phase === 'travel' && guard < 10) {
    state.activeContract.travelLegsRemaining = 1;
    const travelOpt = state.pendingChoiceOptions.find((o) => o.actionId === 'travel_advance')!;
    resolveChoiceOption(state, world, travelOpt);
    if (state.mode === 'combat' && state.activeCombat) {
      for (const e of state.activeCombat.enemies) {
        e.hp = 0;
        e.status = 'dead';
      }
      finishCombatIfEnded(state);
    }
    guard += 1;
  }
  assert.equal(state.activeContract.phase, 'dungeon');
  assert.equal(state.mode, 'dungeon');

  // Test freeform matching on entrance interactable (plus explicit butterflies check)
  const entranceInter = state.activeDungeon!.rooms[0].interactables[0];
  if (entranceInter.kind === 'butterflies') {
    const match = matchFreeformAction('eat the butterflies', state);
    assert.ok(match !== null && match.targetId === 'butterflies');
  } else {
    state.activeDungeon!.rooms[0].interactables.push({ id: 'test_but', kind: 'butterflies', label: 'Eat moths', used: false });
    buildProceduralScene(state, world);
    const match = matchFreeformAction('eat the butterflies', state);
    assert.ok(match !== null && match.targetId === 'butterflies');
  }

  // Mark objective secured and leave dungeon from room 0 -> triggers Getting Better & Contract #2
  state.activeContract.objectiveSecured = true;
  state.activeDungeon!.currentRoomId = 0;
  const startSilver = state.party.members[0].silver;
  processPlayerInput(state, world, 'leave dungeon', true);
  assert.equal(state.activeContract.contractNumber, 2);
  assert.equal(state.activeContract.phase, 'briefing');
  assert.ok(state.party.members[0].silver > startSilver);

  // Save/load v2 roundtrip & spoiler-free screen check
  const tmpDir = mkdtempSync(join(tmpdir(), 'mb-save-v2-'));
  try {
    saveGame(state, tmpDir);
    const loaded = loadGame(tmpDir);
    assert.ok(loaded !== null && loaded.version === 2);
    const parts = getGameScreenParts(state, true);
    assert.ok(!parts.beforeNarration.includes('CAL d'));
    recordRunCompletion(state, 'abandoned', tmpDir);
    deleteActiveSave(tmpDir);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Roll prompts have >= 100 variants and Silenced room blocks scrolls', () => {
  const promptsJson = JSON.parse(readFileSync(join(process.cwd(), 'data', 'roll_prompts.json'), 'utf8')) as { prompts: string[] };
  assert.ok(new Set(promptsJson.prompts).size >= 100);

  const world = loadWorldDatabase();
  const state = createInitialGameState(world, { seed: 444, solo: true, classChoices: ['esoteric_hermit'] });
  const { dungeon } = generateProceduralDungeon(state, world);
  state.mode = 'dungeon';
  dungeon.rooms[0].silenced = true;

  const sc = world.uncleanScrolls[0];
  const res = castScroll(state, world, 0, {
    id: 's1',
    name: `Unclean Scroll: ${sc.name}`,
    kind: 'unclean_scroll',
    scrollKind: 'unclean',
    scrollRoll: sc.roll,
    notes: sc.effect,
  });
  assert.equal(res.castAttempted, false);
  assert.ok(res.logs[0].includes('Terrible Silence'));
});

test('inferDiceSpecs parses multi-dice, cross-dice, d66, d100, and fallback labels accurately', () => {
  assert.deepEqual(inferDiceSpecs('Presence (3d6+2): +0'), [6, 6, 6]);
  assert.deepEqual(inferDiceSpecs('Name (d6+d8): Margar'), [6, 8]);
  assert.deepEqual(inferDiceSpecs('Name (d6x8): Margar'), [6, 8]);
  assert.deepEqual(inferDiceSpecs('Gear (d6+d12+d12): Backpack'), [6, 12, 12]);
  assert.deepEqual(inferDiceSpecs('Terrible Traits (2d20): Cruel'), [20, 20]);
  assert.deepEqual(inferDiceSpecs('Terrible Traits (d20x2): Cruel'), [20, 20]);
  assert.deepEqual(inferDiceSpecs('Reaction (2d6): Neutral'), [6, 6]);
  assert.deepEqual(inferDiceSpecs('Loot (d66): Silver'), [6, 6]);
  assert.deepEqual(inferDiceSpecs('Spark (d100): Sacrifice'), [100]);
  assert.deepEqual(inferDiceSpecs('Party size (d3+1): 3'), [3]);
  assert.deepEqual(inferDiceSpecs('Unknown roll without formula'), [20]);
});

test('chargen records exact dice rolls and totals in creationRolls and hook.rolls', () => {
  const world = loadWorldDatabase();
  const state = createInitialGameState(world, {
    seed: 12345,
    solo: true,
    classChoices: ['heretical_priest'],
  });
  const pc = state.party.members[0];
  assert.ok(pc.creationRolls);
  assert.match(pc.creationRolls.presence, /^\[\d+, \d+, \d+\] \+ 2 = \d+ -> [+-]?\d+$/);
  assert.match(pc.creationRolls.strength, /^\[\d+, \d+, \d+\] - 2 = \d+ -> [+-]?\d+$/);
  assert.match(pc.creationRolls.hp, /^\([+-]?\d+\) \+ \[\d+\] = \d+ HP$/);
  assert.ok(state.hook.rolls);
  assert.ok(state.hook.rolls.where >= 1 && state.hook.rolls.spark >= 1);

  const classlessState = createInitialGameState(world, {
    seed: 54321,
    solo: true,
    classChoices: ['classless'],
  });
  const cr = classlessState.party.members[0].creationRolls ?? {};
  const formulas = [cr.agilityFormula, cr.presenceFormula, cr.strengthFormula, cr.toughnessFormula];
  assert.equal(formulas.filter((f) => f === '4d6 drop lowest').length, 2);
  assert.equal(formulas.filter((f) => f === '3d6').length, 2);

  const tablesOut = processPlayerInput(state, world, 'tables', true);
  assert.ok(tablesOut.immediateText?.includes('Ability Modifier Table'));
  assert.ok(tablesOut.immediateText?.includes('DR, Armor & Combat Modifier Tables'));
});

test('Opening Fate unifies with Contract #1, Seer omens hide truth tags, and class features/decoctions/origins work mechanically', () => {
  const world = loadWorldDatabase();
  const state = createInitialGameState(world, {
    seed: 777,
    solo: true,
    classChoices: ['occult_herbmaster'],
  });
  initializeOpeningScene(state, world);

  // 1. Contract #1 uses rolled Contact and Spark
  assert.equal(state.activeContract.patronName, state.hook.who);
  assert.ok(state.activeContract.patronHook.includes(state.hook.spark));

  // 2. Seer prophecies do NOT leak (true)/(false)/(uncertain)
  for (const p of state.activeContract.prophecies) {
    assert.ok(!p.includes('(true)') && !p.includes('(false)') && !p.includes('(uncertain)'));
  }
  assert.ok(state.activeContract.prophecyTruthIndex === 0 || state.activeContract.prophecyTruthIndex === 1);

  // 3. Occult Herbmaster starts with dawn-expiring decoctions and can use them via "use <#>"
  const pc = state.party.members[0];
  const decIdx = pc.inventory.findIndex((i) => i.kind === 'decoction');
  assert.ok(decIdx >= 0, 'Herbmaster should start with decoctions');
  assert.equal(pc.inventory[decIdx].expiresAtDawn, true);
  processPlayerInput(state, world, `use ${decIdx + 1}`, true);
  assert.ok(state.lastEvents.length > 0);

  // 4. Origin home-region familiarity grants -2 DR on non-combat Presence tests
  pc.traits.origin = 'Raised in Sarkash dark.';
  state.currentRegionName = 'Sarkash';
  const regTest = rollAbilityTest(pc, 'presence', 12, state, { label: 'Scout road' });
  assert.equal(regTest.effectiveDr, 10);
  assert.ok(regTest.logLine.includes('Origin Familiarity'));

  // 5. Speaker of Truths & Fanged Bite
  const priestState = createInitialGameState(world, {
    seed: 888,
    solo: true,
    classChoices: ['esoteric_hermit'],
  });
  const hermit = priestState.party.members[0];
  hermit.classFeatures = ['Speaker of Truths: Twice per day lower DR by 4.'];
  processPlayerInput(priestState, world, 'feature', true);
  assert.equal(hermit.featureState?.nextTestDrBonus, -4);
  const buffedTest = rollAbilityTest(hermit, 'presence', 12, priestState, { label: 'Read inscription' });
  assert.equal(buffedTest.effectiveDr, 8);
  assert.equal(hermit.featureState?.nextTestDrBonus, 0);
});

test('Multi-PC combat cycles every living PC in Agility+d6 initiative order before enemies respond', () => {
  const world = loadWorldDatabase();
  const state = createInitialGameState(world, {
    seed: 101,
    solo: false,
    classChoices: ['fanged_deserter', 'heretical_priest', 'gutterborn_scum'],
  });
  // Ensure exactly 2 living PCs with high HP and a tough enemy so combat lasts > 1 round
  state.party.members = state.party.members.slice(0, 2);
  state.party.members.forEach((m) => {
    m.hp = 30;
    m.maxHp = 30;
  });
  const combat = startCombat(state, world, ['troll'], false);
  combat.enemies[0].hp = 40;
  combat.enemies[0].maxHp = 40;

  assert.equal(combat.turnOrderPcIds.length, 2);
  assert.equal(combat.round, 1);
  const firstId = combat.turnOrderPcIds[0];
  const secondId = combat.turnOrderPcIds[1];
  assert.equal(state.party.members[state.party.activePcIndex].id, firstId);

  // Manual "pc 2" switch must be blocked during combat
  const switchAttempt = processPlayerInput(state, world, 'pc 2', true);
  assert.ok(switchAttempt.immediateText?.includes('Cannot manually switch PCs during combat'));

  // First PC acts -> still round 1, advances to second PC
  processPlayerInput(state, world, '1', true);
  assert.equal(state.activeCombat?.round, 1);
  assert.equal(state.party.members[state.party.activePcIndex].id, secondId);

  // Second PC acts -> enemies respond, round advances to 2, resets to first PC
  processPlayerInput(state, world, '1', true);
  assert.equal(state.activeCombat?.round, 2);
  assert.equal(state.party.members[state.party.activePcIndex].id, firstId);
});

test('Damaged armor retains armorMaxTier DR penalty until ruined, and Broken Hemorrhage ticks & heals via Medicine', () => {
  const world = loadWorldDatabase();
  const state = createInitialGameState(world, { seed: 303, solo: true, classChoices: ['wretched_royalty'] });
  const pc = state.party.members[0];
  pc.armorTier = 1;
  pc.armorMaxTier = 3; // Damaged Heavy Armor -> still +4 AGI DR / +2 Def DR per p. 31
  pc.inventory = [];
  pc.carryingCapacity = 10;

  assert.equal(rollAbilityTest(pc, 'agility', 12, state).effectiveDr, 16);
  assert.equal(rollAbilityTest(pc, 'agility', 12, state, { isDefence: true }).effectiveDr, 14);

  // Hemorrhage test: conscious at 1 HP, DR16/18, curable by Medicine, or dies if untreated
  pc.featureState = { hemorrhageHoursLeft: 2 };
  pc.hp = 1;
  pc.status = 'alive';
  assert.equal(rollAbilityTest(pc, 'presence', 10, state).effectiveDr, 16);
  advanceWorldHours(state, 1);
  assert.equal(pc.featureState.hemorrhageHoursLeft, 1);
  assert.equal(rollAbilityTest(pc, 'presence', 10, state).effectiveDr, 18);

  pc.inventory.push({ id: 'med_1', name: 'Medicine box', kind: 'medicine', uses: 2 });
  processPlayerInput(state, world, 'use 1', true);
  assert.equal(pc.featureState.hemorrhageHoursLeft, undefined);
  assert.equal(pc.status, 'alive');

  // Untreated hemorrhage kills on timer expiry
  pc.featureState.hemorrhageHoursLeft = 1;
  advanceWorldHours(state, 1);
  assert.equal(pc.status, 'dead');
});

test('Scrolls deal real damage/healing, Skeleton piercing is DR14, and slay_boss vaults do not duplicate objective', () => {
  const world = loadWorldDatabase();
  const state = createInitialGameState(world, { seed: 505, solo: true, classChoices: ['esoteric_hermit'] });
  const pc = state.party.members[0];
  pc.abilities.presence = 6;
  pc.powersRemaining = 5;
  pc.armorTier = 0;
  pc.armorMaxTier = 0;

  const combat = startCombat(state, world, ['skeleton'], false);
  combat.enemies[0].hp = 20;
  combat.enemies[0].maxHp = 20;
  const glareRes = castScroll(state, world, 0, {
    id: 'sc_glare',
    name: "Sacred Scroll: Roskoe's Consuming Glare",
    kind: 'sacred_scroll',
    scrollKind: 'sacred',
    scrollRoll: 9,
  });
  assert.equal(glareRes.castAttempted, true);
  if (glareRes.success) {
    assert.ok(combat.enemies[0].hp < 20, 'Roskoe Consuming Glare should deal real HP damage');
  }

  // Piercing weapon vs Blood-drenched Skeleton has minimum DR14
  pc.weapon = { ...world.weaponsById.knife };
  const atkLogs = resolvePcAttack(state, 0, 0);
  assert.ok(atkLogs[0].includes('vs DR14'));

  // slay_boss contract must not spawn objective interactable inside locked_vault
  state.activeContract.objectiveKind = 'slay_boss';
  const { dungeon } = generateProceduralDungeon(state, world);
  const vault = dungeon.rooms.find((r) => r.role === 'locked_vault')!;
  assert.ok(!vault.interactables.some((i) => i.kind === 'objective'));
});

test('Quartermaster shop, repair cap, Omen modes, and Gutterborn Scum 2nd specialty work per Bare Bones rules', () => {
  const world = loadWorldDatabase();
  const state = createInitialGameState(world, { seed: 606, solo: true, classChoices: ['gutterborn_scum'] });
  const pc = state.party.members[0];
  pc.silver = 200;
  pc.armorTier = 1;
  pc.armorMaxTier = 2;

  const shopView = processPlayerInput(state, world, 'shop', true);
  assert.ok(shopView.immediateText?.includes('Quartermaster & Services'));

  processPlayerInput(state, world, 'buy sword', true);
  assert.equal(pc.weapon.id, 'sword');
  assert.equal(pc.silver, 170);

  // Repair restores Tier 1 -> Tier 2 (25s), and refuses going past original Tier 2
  processPlayerInput(state, world, 'repair', true);
  assert.equal(pc.armorTier, 2);
  assert.equal(pc.silver, 145);
  processPlayerInput(state, world, 'repair', true);
  assert.equal(pc.armorTier, 2);

  // Omen arming lowers DR
  pc.omens = 2;
  processPlayerInput(state, world, 'omen dr', true);
  assert.equal(pc.featureState?.omenArmed, 'lower_dr');
  const testRes = rollAbilityTest(pc, 'presence', 14, state);
  assert.ok(testRes.logLine.includes('[Omen -4 DR'));
  assert.equal(pc.featureState?.omenArmed, undefined);

  // Gutterborn Scum first improvement adds a 2nd specialty
  assert.equal(pc.classFeatures.length, 1);
  const impLogs = improveCharacter(pc, state, world);
  assert.equal(pc.classFeatures.length, 2);
  assert.ok(impLogs.some((l) => l.includes('gains 2nd specialty')));

  // Wraith touch drains abilities during combat & resets after
  const wState = createInitialGameState(world, { seed: 919, solo: true, classChoices: ['fanged_deserter'] });
  const wPc = wState.party.members[0];
  wPc.hp = 20;
  wPc.maxHp = 20;
  wPc.abilities.agility = -3;
  const wCombat = startCombat(wState, world, ['wraith'], false);
  wCombat.enemies[0].defenceDr = 30;
  resolveEnemyAttack(wState, 0, 0);
  assert.ok((wPc.featureState?.wraithDrainFight ?? 0) >= 1);
  wCombat.enemies[0].status = 'dead';
  finishCombatIfEnded(wState);
  assert.equal(wPc.featureState?.wraithDrainFight, 0);
});

test('Contracts hook into PC specifics, offer class-specific briefing actions, weave Basilisks Demand, and enforce Entrance-only leave', () => {
  const world = loadWorldDatabase();
  const classIds: ClassId[] = [
    'fanged_deserter',
    'gutterborn_scum',
    'esoteric_hermit',
    'wretched_royalty',
    'heretical_priest',
    'occult_herbmaster',
  ];

  for (const cid of classIds) {
    const st = createInitialGameState(world, { seed: 404, solo: true, classChoices: [cid] });
    initializeOpeningScene(st, world);
    assert.ok(st.activeContract.personalHookNote && st.activeContract.personalHookNote.length > 10);
    assert.ok(st.pendingNarration.includes('Personal Stake:'));
    const classOpt = st.pendingChoiceOptions.find((o) => o.actionId.startsWith('briefing_class_'));
    assert.ok(classOpt, `Expected class-specific briefing action for ${cid}`);
    const logs = resolveChoiceOption(st, world, classOpt);
    assert.ok(logs.length >= 1);
    assert.equal(st.activeContract.negotiated, true);
  }

  // Contract #3 always includes a Basilisks Demand (Bare Bones p. 36) and leave dungeon blocks non-entrance rooms
  const st2 = createInitialGameState(world, { seed: 707, solo: true, classChoices: ['wretched_royalty'] });
  initializeOpeningScene(st2, world);
  st2.activeContract.contractNumber = 2;
  st2.activeContract.objectiveSecured = true;
  st2.mode = 'dungeon';
  st2.activeDungeon!.currentRoomId = 2;

  const blockedLeave = processPlayerInput(st2, world, 'leave dungeon', true);
  assert.ok(blockedLeave.immediateText?.includes('Room #1'));

  st2.activeDungeon!.currentRoomId = 0;
  processPlayerInput(st2, world, 'leave dungeon', true);
  assert.equal(st2.activeContract.contractNumber, 3);
  assert.ok(st2.activeContract.basiliskDemand && st2.activeContract.basiliskDemand.length > 5);
  assert.ok(st2.pendingNarration.includes("Basilisks' Demand"));
});

test('Quartermaster sell, Boss trophy drops, Calendar Misery rules, Occult Treasures, Beasts & Combat targeting', () => {
  const world = loadWorldDatabase();
  const state = createInitialGameState(world, { seed: 4242, solo: true, classChoices: ['wretched_royalty'] });
  const pc = state.party.members[0];
  pc.silver = 100;
  pc.hp = 20;
  pc.maxHp = 20;
  pc.abilities.presence = 3;
  pc.abilities.agility = 3;

  // 1. Calendar Misery world modifiers (Poison Mist +1 TOU DR, Price Inflation +50% shop, Famine 2x food)
  state.calendar.triggeredMiseries.push('1:2', '3:4', '3:3');
  const mis = getActiveMiseryEffects(state);
  assert.equal(mis.counts.poison_mist, 1);
  assert.equal(mis.counts.price_inflation, 1);
  assert.equal(mis.counts.famine, 1);
  assert.equal(rollAbilityTest(pc, 'toughness', 12, state).effectiveDr, 13);
  const preShopSilver = pc.silver;
  processPlayerInput(state, world, 'buy sword', true); // 30s * 1.5 = 45s
  assert.equal(preShopSilver - pc.silver, 45);

  pc.foodDays = 5;
  pc.waterDays = 5;
  fullNightsRest(state, world);
  assert.equal(pc.foodDays, 3);
  assert.equal(pc.waterDays, 3);

  // 2. Beasts & Occult Treasures
  const baseCap = pc.carryingCapacity;
  grantBeastToPc(pc, 'Horse', state);
  assert.equal(pc.carryingCapacity, baseCap + 12);
  grantBeastToPc(pc, 'Rat (tame)', state);
  assert.equal(rollAbilityTest(pc, 'presence', 12, state, { label: 'Spot trap' }).effectiveDr, 10);

  pc.inventory.push(
    { id: 'r1', name: 'Ash-grey ring', kind: 'relic', silverValue: 60 },
    { id: 'r2', name: 'Immortal torch', kind: 'relic', silverValue: 60 },
    { id: 'r3', name: 'Black Crown of the Crippled King', kind: 'relic', silverValue: 60 },
    { id: 'r4', name: 'Ancient blindfold', kind: 'relic', silverValue: 60 },
  );
  const torchIdx = pc.inventory.findIndex((i) => i.name === 'Immortal torch');
  processPlayerInput(state, world, `use ${torchIdx + 1}`, true);
  assert.equal(pc.featureState?.immortalTorchMinutes, 60);
  pc.hp = -2;
  applyBrokenOrDead(pc, state);
  assert.equal(pc.status, 'alive', 'Immortal Torch should keep holder alive below 0 HP');
  pc.hp = 20;
  pc.featureState!.immortalTorchMinutes = 0;

  // 3. Boss bounty trophy drop + Quartermaster sell all
  const { dungeon } = generateProceduralDungeon(state, world);
  state.mode = 'dungeon';
  const bCombat = startCombat(state, world, [dungeon.bossEnemyId, 'goblin'], false);
  const screen = renderCombatCheck(state);
  assert.ok(screen.includes('Attack [2]'), 'Multi-enemy combat should show dynamic target #2');
  bCombat.enemies[0].status = 'dead';
  bCombat.enemies[1].status = 'dead';
  finishCombatIfEnded(state);
  assert.ok(pc.inventory.some((i) => i.kind === 'treasure'), 'Boss kill should drop guaranteed trophy');

  state.mode = 'exploration';
  state.activeDungeon = null;
  const silverBeforeSell = pc.silver;
  processPlayerInput(state, world, 'sell all', true);
  assert.ok(pc.silver > silverBeforeSell, 'sell all should convert treasures/trophies into silver');
});

test('Fog-of-war map, equip, give, cross-PC use, graveyard, combatAftermaths, Briefing recruit cap, & Round-1 parley', () => {
  const world = loadWorldDatabase();
  const state = createInitialGameState(world, {
    seed: 1313,
    solo: false,
    classChoices: ['wretched_royalty', 'heretical_priest'],
  });
  state.party.members = state.party.members.slice(0, 2);
  const [pc1, pc2] = state.party.members;
  pc1.silver = 100;
  pc2.silver = 10;
  pc1.hp = 12;
  pc1.maxHp = 12;
  pc2.hp = 3;
  pc2.maxHp = 12;
  pc2.infected = true;

  // 1. Briefing recruit: 25s cost and max 2 living followers cap
  initializeOpeningScene(state, world);
  assert.ok(state.pendingChoiceOptions.some((o) => o.actionId === 'briefing_hire_outcast'));
  processPlayerInput(state, world, 'recruit', true);
  processPlayerInput(state, world, 'recruit', true);
  assert.equal(state.party.followers.filter((f) => f.status === 'alive').length, 2);
  assert.equal(pc1.silver, 50);
  processPlayerInput(state, world, 'recruit', true);
  assert.equal(state.party.followers.filter((f) => f.status === 'alive').length, 2, 'Cap of 2 followers enforced');
  assert.equal(pc1.silver, 50);

  // 2. Give silver & item, equip backup weapon, cross-PC use medicine
  const giveSilverOut = processPlayerInput(state, world, 'give 15s 2', true);
  assert.ok(giveSilverOut.immediateText?.includes('hands 15s'));
  assert.equal(pc1.silver, 35);
  assert.equal(pc2.silver, 25);

  pc1.inventory.push(
    { id: 'med_cross', name: 'Medicine box', kind: 'medicine', uses: 2 },
    { id: 'eq_flail', name: 'Flail (d8)', kind: 'gear' },
    { id: 'spare_rope', name: 'Rope', kind: 'gear' },
  );
  const medNum = pc1.inventory.findIndex((i) => i.id === 'med_cross') + 1;
  processPlayerInput(state, world, `use ${medNum} 2`, true);
  assert.ok(pc2.hp > 3 && !pc2.infected, 'use <item#> 2 should heal & cure PC #2');

  const flailNum = pc1.inventory.findIndex((i) => i.id === 'eq_flail') + 1;
  processPlayerInput(state, world, `equip ${flailNum}`, true);
  assert.equal(pc1.weapon.id, 'flail');

  const ropeNum = pc1.inventory.findIndex((i) => i.id === 'spare_rope') + 1;
  const ropeBefore = pc2.inventory.length;
  processPlayerInput(state, world, `give ${ropeNum} 2`, true);
  assert.equal(pc2.inventory.length, ropeBefore + 1);

  // 3. Graveyard command reads meta_profile.json without throwing
  const gy = processPlayerInput(state, world, 'graveyard', true);
  assert.ok(gy.immediateText?.includes('Graveyard & Past Runs'));

  // 4. Fog-of-war map hides unvisited exits as [?] and shows [YOU,EXIT]
  const { dungeon } = generateProceduralDungeon(state, world);
  state.mode = 'dungeon';
  state.activeContract.phase = 'dungeon';
  const mapOut = processPlayerInput(state, world, 'map', true).immediateText ?? '';
  assert.ok(mapOut.includes('Fog-of-War Map'));
  assert.ok(mapOut.includes('[YOU,EXIT]'));
  assert.ok(mapOut.includes('[?]'));

  // 5. Combat aftermaths on victory & Round-1 parley
  const vCombat = startCombat(state, world, ['goblin'], false);
  vCombat.enemies[0].status = 'dead';
  const vicLogs = finishCombatIfEnded(state, world);
  assert.ok(
    vicLogs.some((l) => world.proseFragments.combatAftermaths.includes(l)),
    'Victory should include a combatAftermaths prose line',
  );

  // Round-1 parley blocked on boss, allowed on goblin until bloodDrawn
  const bossCombat = startCombat(state, world, [dungeon.bossEnemyId], false);
  assert.ok(!getGameScreenParts(state, true).afterNarration.includes('parley'));
  bossCombat.enemies[0].status = 'dead';
  finishCombatIfEnded(state, world);

  dungeon.previousRoomId = 0;
  dungeon.currentRoomId = dungeon.rooms[0].exits[0];
  startCombat(state, world, ['goblin'], false);
  assert.ok(getGameScreenParts(state, true).afterNarration.includes('parley'));
  processPlayerInput(state, world, 'parley', true);
  assert.ok(
    state.mode === 'dungeon' || state.activeCombat?.parleyAttempted === true,
    'parley should either resolve/withdraw out of combat or mark parleyAttempted',
  );
  if (state.mode === 'combat' && state.activeCombat) {
    assert.ok(!getGameScreenParts(state, true).afterNarration.includes('parley'), 'parley cannot be retried in the same fight');
    state.activeCombat.enemies.forEach((e) => {
      e.status = 'dead';
    });
    finishCombatIfEnded(state, world);
  }
});

function renderCombatCheck(state: ReturnType<typeof createInitialGameState>): string {
  return getGameScreenParts(state, true).afterNarration;
}

test('Contract sizes (small/medium/large 2-floor), look/revisit, riddles, offering_scale, road vignettes, and HUD polish', () => {
  const world = loadWorldDatabase();
  const state = createInitialGameState(world, { seed: 4242, solo: false });

  // 1. Small dungeon sizing
  state.activeContract.contractSize = 'small';
  const smallRes = generateProceduralDungeon(state, world);
  assert.ok(smallRes.dungeon.rooms.length >= 4 && smallRes.dungeon.rooms.length <= 6);
  assert.equal(smallRes.dungeon.floors, 1);
  assert.equal(verifyDungeonSolvable(smallRes.dungeon, state.activeContract.objectiveKind), true);

  // 2. Large dungeon sizing (2 floors + stairwell_down + map output)
  state.activeContract.contractSize = 'large';
  const largeRes = generateProceduralDungeon(state, world);
  const ld = largeRes.dungeon;
  assert.ok(ld.rooms.length >= 16 && ld.rooms.length <= 20);
  assert.equal(ld.floors, 2);
  assert.ok(ld.rooms.some((r) => r.role === 'stairwell_down' && r.floor === 1));
  assert.ok(ld.rooms.some((r) => r.floor === 2));
  assert.equal(verifyDungeonSolvable(ld, state.activeContract.objectiveKind), true);

  // 3. Persistent room sensory, revisit recap, and look command
  state.mode = 'dungeon';
  state.activeContract.phase = 'dungeon';
  const r0 = ld.rooms[0];
  const exitId = r0.exits[0];
  const targetRoom = ld.rooms[exitId];
  targetRoom.enemyIds = [];
  targetRoom.trap = null;
  enterDungeonRoom(state, world, exitId);
  buildProceduralScene(state, world);
  const firstVisitText = state.pendingNarration;
  assert.ok(targetRoom.sensory && firstVisitText.includes(targetRoom.sensory.light));

  // Revisit shows short recap + look restores full description
  enterDungeonRoom(state, world, 0);
  enterDungeonRoom(state, world, exitId);
  buildProceduralScene(state, world);
  assert.ok(state.pendingNarration.includes('You stand again in'), 'Revisit should show recap');
  const lookOut = processPlayerInput(state, world, 'look', true);
  assert.ok(lookOut.immediateText?.includes(targetRoom.sensory!.light), 'look command should display full sensory text');

  // Dungeon Status Strip visible
  const dHud = getGameScreenParts(state, true).beforeNarration;
  assert.ok(dHud.includes('Party HP:') && dHud.includes('Silver:') && dHud.includes('Hazard:'));

  // 4. Riddle-door puzzle (wrong answer shocks, right answer unlocks)
  const statRoom = ld.rooms.find((r) => r.role === 'puzzle_statue')!;
  ld.puzzleKind = 'riddle_door';
  ld.riddleIndex = 0;
  ld.puzzleSolved = false;
  statRoom.interactables = [{ id: 'test_riddle', kind: 'riddle_door', label: 'Riddle Door', used: false }];
  ld.currentRoomId = statRoom.id;
  buildProceduralScene(state, world);
  const riddleWrong = state.pendingChoiceOptions.find((o) => o.actionId === 'riddle_answer' && o.targetId === 1)!;
  const riddleRight = state.pendingChoiceOptions.find((o) => o.actionId === 'riddle_answer' && o.targetId === 0)!;
  state.party.members[0].hp = 20;
  state.party.members[0].maxHp = 20;
  resolveChoiceOption(state, world, riddleWrong);
  assert.equal(ld.puzzleSolved, false);
  resolveChoiceOption(state, world, riddleRight);
  assert.equal(ld.puzzleSolved, true);

  // 5. Offering scale puzzle accepts 15s silver
  ld.puzzleKind = 'offering_scale';
  ld.puzzleSolved = false;
  statRoom.interactables = [{ id: 'test_scale', kind: 'offering_scale', label: 'Bronze Scales', used: false }];
  state.party.members[0].inventory = state.party.members[0].inventory.filter((i) => i.kind !== 'treasure');
  state.party.members[0].silver = 25;
  buildProceduralScene(state, world);
  const scaleOpt = state.pendingChoiceOptions.find((o) => o.targetId === 'offering_scale')!;
  resolveChoiceOption(state, world, scaleOpt);
  assert.equal(ld.puzzleSolved, true);
  assert.equal(state.party.members[0].silver, 10);

  // 6. Overland road vignettes
  state.activeDungeon = null;
  state.mode = 'exploration';
  state.activeContract.phase = 'travel';
  state.activeContract.travelLegsRemaining = 2;
  state.activeContract.activeVignetteId = null;
  state.activeContract.vignetteResolved = false;
  buildProceduralScene(state, world);
  assert.ok(state.activeContract.activeVignetteId, 'Travel should roll a road vignette');
  assert.ok(state.pendingNarration.includes('Roadside Encounter:'));
  const bypassOpt = state.pendingChoiceOptions.find((o) => o.actionId === 'vignette_bypass')!;
  resolveChoiceOption(state, world, bypassOpt);
  assert.equal(state.activeContract.vignetteResolved, true);

  // 7. Combat HUD round-1 table rule + party combat strip + [Roll] prefix
  const com = startCombat(state, world, ['bone_margrave'], false);
  assert.equal(com.enemies[0].name, 'Hollow Bone-Margrave');
  const round1Hud = getGameScreenParts(state, true).beforeNarration;
  assert.ok(round1Hud.includes('DR, Armor & Combat Modifier Tables'));
  assert.ok(round1Hud.includes('Party Combat Strip:'));
  com.round = 2;
  const round2Hud = getGameScreenParts(state, true).beforeNarration;
  assert.ok(!round2Hud.includes('DR, Armor & Combat Modifier Tables'), 'DR table should hide after Round 1');
});
