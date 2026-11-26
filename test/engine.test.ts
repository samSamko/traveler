import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadWorldDatabase } from '../src/db/loader.ts';
import {
  applyBrokenOrDead,
  finishCombatIfEnded,
  resolvePcAttack,
  rollReaction,
  startCombat,
} from '../src/combat.ts';
import { parseDiceExpr, rollAbilityTest, scoreToAbilityMod } from '../src/dice.ts';
import { initializeOpeningScene, processPlayerInput } from '../src/engine.ts';
import {
  buildProceduralScene,
  enterDungeonRoom,
  matchFreeformAction,
  resolveChoiceOption,
} from '../src/gm/procedural.ts';
import { improveCharacter } from '../src/rules/advancement.ts';
import { rollDawnMisery, triggerSpecificOrRandomMisery } from '../src/rules/calendar.ts';
import { createInitialGameState, generateCharacter } from '../src/rules/chargen.ts';
import { generateProceduralDungeon, verifyDungeonSolvable } from '../src/rules/dungeon.ts';
import { castScroll } from '../src/rules/powers.ts';
import { catchBreath, fullNightsRest } from '../src/rules/rest.ts';
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
  assert.equal(world.creatures.length, 28);
  assert.equal(world.traitProfiles.length, 80);
  assert.equal(world.campaigns.patrons.length, 12);
  assert.equal(world.campaigns.objectives.length, 12);
  assert.equal(world.campaigns.centralHazards.length, 6);
  assert.equal(world.campaigns.rivalFactions.length, 8);
  assert.equal(world.campaigns.puzzleStatues.length, 6);
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

test('Procedural 12-15 room dungeon is always solvable and enforces locks, heavy-armor tunnel, & puzzle vault', () => {
  const world = loadWorldDatabase();
  for (let s = 1; s <= 15; s += 1) {
    const st = createInitialGameState(world, { seed: s * 313 });
    const { dungeon } = generateProceduralDungeon(st, world);
    assert.ok(dungeon.rooms.length >= 12 && dungeon.rooms.length <= 15);
    assert.equal(verifyDungeonSolvable(dungeon), true, `Seed ${s} dungeon should be fully connected`);
    assert.ok(st.activeContract.prophecies[0].length > 10);
  }

  // Test heavy-armor tunnel block & statue eye puzzle unlock
  const state = createInitialGameState(world, { seed: 909, solo: true });
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

  // Puzzle statue unlock
  const statueRoom = dungeon.rooms.find((r) => r.role === 'puzzle_statue')!;
  const vault = dungeon.rooms.find((r) => r.role === 'locked_vault')!;
  dungeon.currentRoomId = statueRoom.id;
  const lockedVault = enterDungeonRoom(state, world, vault.id);
  assert.equal(lockedVault.entered, false);

  state.party.members[0].inventory.push({
    id: 'eye_token',
    name: dungeon.puzzleSocketItemName,
    kind: 'treasure',
  });
  buildProceduralScene(state, world);
  const puzzleOpt = state.pendingChoiceOptions.find((o) => o.targetId === 'statue_socket')!;
  const unlockLogs = resolveChoiceOption(state, world, puzzleOpt);
  assert.equal(dungeon.puzzleSolved, true);
  assert.ok(unlockLogs.length >= 1);

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

  // Test freeform 'eat butterflies' at entrance
  const match = matchFreeformAction('eat the butterflies', state);
  assert.ok(match !== null && match.targetId === 'butterflies');

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
