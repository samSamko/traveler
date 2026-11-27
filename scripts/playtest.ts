import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWorldDatabase, type WorldDatabase } from '../src/db/loader.ts';
import { initializeOpeningScene, processPlayerInput } from '../src/engine.ts';
import { finishCombatIfEnded, startCombat } from '../src/combat.ts';
import { createInitialGameState } from '../src/rules/chargen.ts';
import { verifyDungeonSolvable } from '../src/rules/dungeon.ts';
import { deleteActiveSave, loadGame, saveGame } from '../src/save.ts';
import { renderGameScreen } from '../src/ui.ts';
import type { ClassId, GameState } from '../src/types.ts';
import { assertSaveRoundtrip, assertStateInvariants } from './invariants.ts';

function bfsNextStep(state: GameState, targetPredicate: (roomId: number) => boolean): number | null {
  const d = state.activeDungeon;
  if (!d) return null;
  const start = d.currentRoomId;
  if (targetPredicate(start)) return null;
  const q: number[][] = [[start]];
  const vis = new Set<number>([start]);
  while (q.length > 0) {
    const path = q.shift()!;
    const cur = path[path.length - 1];
    if (targetPredicate(cur)) return path[1] ?? null;
    for (const ex of d.rooms[cur].exits) {
      const dest = d.rooms[ex];
      if (!dest || vis.has(ex)) continue;
      if (dest.secretHidden && !d.puzzleSolved) continue;
      if (dest.lockedByKey && !d.hasBossKey && d.rooms[cur].role !== 'boss_lair') continue;
      if (dest.requiresNoHeavyArmor && state.party.members.some((m) => m.status === 'alive' && m.armorTier === 3)) {
        continue;
      }
      vis.add(ex);
      q.push([...path, ex]);
    }
  }
  return null;
}

function chooseTacticalCommand(state: GameState, step: number, shopChecked: Set<number>, seedIdx: number): string {
  if (state.mode === 'combat' && state.activeCombat) {
    const pc = state.party.members[state.party.activePcIndex] ?? state.party.members.find((m) => m.status === 'alive');
    if (!pc) return 'attack 1';
    if (pc.hp <= Math.ceil(pc.maxHp / 2)) {
      const medIdx = pc.inventory.findIndex((i) => i.kind === 'medicine' || i.name.toLowerCase().includes('elixir vitalis'));
      if (medIdx >= 0) return `use ${medIdx + 1}`;
    }
    if (pc.hp <= 3 && pc.omens > 0 && pc.featureState?.omenArmed !== 'reduce_dmg') {
      return 'omen dmg';
    }
    const bombIdx = pc.inventory.findIndex((i) => i.name.toLowerCase().includes('bomb') || i.name.toLowerCase().includes('gunpowder'));
    if (bombIdx >= 0) return `use ${bombIdx + 1}`;
    const scrollIdx = pc.inventory.findIndex((i) => i.kind === 'unclean_scroll' || i.kind === 'sacred_scroll');
    if (
      scrollIdx >= 0 &&
      pc.powersRemaining > 0 &&
      pc.classId !== 'fanged_deserter' &&
      pc.dizzyHours <= 0 &&
      !(pc.armorTier >= 2 && !(pc.classId === 'heretical_priest' && pc.armorTier === 2)) &&
      step % 3 === 0
    ) {
      return `cast ${scrollIdx + 1}`;
    }
    const activeCount = state.activeCombat.enemies.filter((e) => e.status === 'active').length;
    const enemy = state.activeCombat.enemies.find((e) => e.status === 'active');
    const isBossOrTough = enemy && enemy.hp >= 14;
    if (isBossOrTough && pc.omens > 0) {
      return activeCount <= 1 ? '2' : String(activeCount + 1);
    }
    if (pc.classId === 'fanged_deserter' && step % 4 === 0) return 'bite';
    return '1';
  }

  if (state.activeContract.phase === 'briefing') {
    if (!shopChecked.has(seedIdx)) {
      shopChecked.add(seedIdx);
      const leader = state.party.members[0];
      if (leader && leader.inventory.some((i) => i.kind === 'treasure')) return 'sell all';
      if (leader && leader.silver >= 35 && leader.weapon.damageDie === 'd4') return 'buy sword';
      if (leader && leader.silver >= 20 && leader.armorTier === 0) return 'buy armor_1';
      if (leader && leader.silver >= 15 && !leader.inventory.some((i) => i.kind === 'medicine')) return 'buy medicine';
    }
    const pressOpt = state.pendingChoiceOptions.findIndex((o) => o.actionId === 'briefing_question_seer');
    if (pressOpt >= 0 && !state.activeContract.prophecyRevealed && step === 1) return String(pressOpt + 1);
    const depIdx = state.pendingChoiceOptions.findIndex((o) => o.actionId === 'briefing_depart');
    return String(depIdx >= 0 ? depIdx + 1 : 1);
  }

  if (state.activeContract.phase === 'travel') {
    const aliveLow = state.party.members.some((m) => m.status === 'alive' && m.hp < Math.ceil(m.maxHp / 2));
    if (aliveLow) return 'breathe';
    const vigIdx = state.pendingChoiceOptions.findIndex((o) => o.actionId === 'vignette_act');
    if (vigIdx >= 0) return String(vigIdx + 1);
    const advIdx = state.pendingChoiceOptions.findIndex((o) => o.actionId === 'travel_advance');
    return String(advIdx >= 0 ? advIdx + 1 : 1);
  }

  if (state.mode === 'dungeon' && state.activeDungeon) {
    const d = state.activeDungeon;
    const opts = state.pendingChoiceOptions;
    const leader = state.party.members[state.party.activePcIndex] ?? state.party.members.find((m) => m.status === 'alive');
    if (leader && leader.hp < Math.ceil(leader.maxHp / 2)) {
      const medIdx = leader.inventory.findIndex((i) => i.kind === 'medicine' || i.name.toLowerCase().includes('elixir vitalis'));
      if (medIdx >= 0) return `use ${medIdx + 1}`;
    }

    const leaveComplete = opts.findIndex((o) => o.actionId === 'dungeon_leave' && o.label.includes('COMPLETE'));
    if (leaveComplete >= 0) return String(leaveComplete + 1);

    const objIdx = opts.findIndex((o) => o.targetId === 'objective' || o.targetId === 'sabotage_altar');
    if (objIdx >= 0) return String(objIdx + 1);

    const hasSocket = state.party.members.some((m) => m.inventory.some((i) => i.name.includes(d.puzzleSocketItemName)));
    const sockIdx = opts.findIndex(
      (o) =>
        (o.targetId === 'statue_socket' && hasSocket) ||
        o.targetId === 'inscription_cipher' ||
        o.targetId === 'blood_altar' ||
        o.targetId === 'offering_scale' ||
        o.actionId === 'riddle_force',
    );
    if (sockIdx >= 0) return String(sockIdx + 1);

    const usefulIdx = opts.findIndex(
      (o) =>
        o.targetId === 'ransack' ||
        o.targetId === 'prisoners' ||
        o.targetId === 'butterflies' ||
        o.targetId === 'shrine_offering' ||
        o.targetId === 'ossuary_loot' ||
        o.targetId === 'read_graffiti' ||
        o.targetId === 'stray_beast',
    );
    if (usefulIdx >= 0) return String(usefulIdx + 1);

    const done = state.activeContract.objectiveSecured || (state.activeContract.objectiveKind === 'slay_boss' && state.activeContract.bossSlain);
    if (done) {
      const nextToExit = bfsNextStep(state, (id) => id === 0);
      if (nextToExit !== null) {
        const idx = opts.findIndex((o) => o.actionId === 'dungeon_move' && o.targetId === nextToExit);
        if (idx >= 0) return String(idx + 1);
      }
    }

    if (opts.some((o) => o.actionId === 'doff_heavy_armor')) {
      return String(opts.findIndex((o) => o.actionId === 'doff_heavy_armor') + 1);
    }

    const targetRoomId =
      d.puzzleKind === 'socket_statue' && !hasSocket
        ? bfsNextStep(state, (id) => d.rooms[id].role === 'guard_post' || d.rooms[id].role === 'cells')
        : !d.puzzleSolved && (state.activeContract.objectiveKind === 'rescue_heir' || state.activeContract.objectiveKind === 'steal_relic')
          ? bfsNextStep(state, (id) => d.rooms[id].role === 'puzzle_statue')
          : state.activeContract.objectiveKind === 'slay_boss'
            ? bfsNextStep(state, (id) => d.rooms[id].role === 'boss_lair')
            : state.activeContract.objectiveKind === 'sabotage'
              ? bfsNextStep(state, (id) => d.rooms[id].role === 'ritual_sanctum')
              : bfsNextStep(state, (id) => d.rooms[id].role === 'locked_vault');

    if (targetRoomId !== null) {
      const mIdx = opts.findIndex((o) => o.actionId === 'dungeon_move' && o.targetId === targetRoomId);
      if (mIdx >= 0) return String(mIdx + 1);
    }

    const unvisited = opts.findIndex((o) => o.actionId === 'dungeon_move' && o.label.includes('Unexplored') && !o.label.includes('[LOCKED]'));
    if (unvisited >= 0) return String(unvisited + 1);

    const anyMove = opts.findIndex((o) => o.actionId === 'dungeon_move' && !o.label.includes('[LOCKED]'));
    return String(anyMove >= 0 ? anyMove + 1 : 1);
  }

  return '1';
}

function runGeneralFuzz200(world: WorldDatabase) {
  const classes: ClassId[] = [
    'classless',
    'fanged_deserter',
    'gutterborn_scum',
    'esoteric_hermit',
    'wretched_royalty',
    'heretical_priest',
    'occult_herbmaster',
  ];

  const metrics = {
    runs: 200,
    soloRuns: 100,
    partyRuns: 100,
    combats: 0,
    contractsCompleted: 0,
    bossesSlain: 0,
    scrollsCast: 0,
    shopPurchases: 0,
    deaths: 0,
    apocalypses: 0,
  };

  const shopChecked = new Set<number>();
  for (let i = 1; i <= 200; i += 1) {
    const solo = i <= 100;
    const cls = classes[i % classes.length];
    const state = createInitialGameState(world, {
      seed: i * 1009,
      calendarDie: 20,
      solo,
      useRandomClasses: !solo,
      classChoices: solo ? [cls] : undefined,
    });
    initializeOpeningScene(state, world);
    assert.ok(verifyDungeonSolvable(state.activeDungeon!, state.activeContract.objectiveKind), `Seed ${i} dungeon unsolvable`);
    assertStateInvariants(state, world, `Run ${i} init`);

    const openingRender = renderGameScreen(state, true);
    assert.ok(!openingRender.includes('(true)') && !openingRender.includes('(false)'), 'Prophecies must never leak truth tags');

    for (let step = 0; step < 90 && state.mode !== 'game_over'; step += 1) {
      const prevContract = state.activeContract.contractNumber;
      const wasBossSlain = state.activeContract.bossSlain;
      const cmd = chooseTacticalCommand(state, step, shopChecked, i);

      if (cmd.startsWith('buy ')) metrics.shopPurchases += 1;
      if (cmd.startsWith('cast')) metrics.scrollsCast += 1;
      if (state.mode === 'combat') metrics.combats += 1;

      processPlayerInput(state, world, cmd, true);
      assertStateInvariants(state, world, `Run ${i} step ${step} cmd "${cmd}"`);

      if (state.activeContract.contractNumber > prevContract) metrics.contractsCompleted += 1;
      if (!wasBossSlain && state.activeContract.bossSlain) metrics.bossesSlain += 1;
    }

    if (state.mode === 'game_over') {
      if (state.calendar.worldEnded) metrics.apocalypses += 1;
      else metrics.deaths += 1;
    }
  }
  return metrics;
}

function scenarioApocalypseD2(world: WorldDatabase): { apocalypses: number; miseriesActivated: number } {
  let apocalypses = 0;
  let miseriesActivated = 0;
  for (let i = 1; i <= 20; i += 1) {
    const st = createInitialGameState(world, { seed: i * 733, solo: false, calendarDie: 2, useRandomClasses: true });
    st.party.members.forEach((m) => {
      m.foodDays = 40;
      m.waterDays = 40;
      m.hp = 30;
      m.maxHp = 30;
    });
    initializeOpeningScene(st, world);
    for (let d = 0; d < 40 && st.mode !== 'game_over'; d += 1) {
      processPlayerInput(st, world, 'rest', true);
      assertStateInvariants(st, world, `Apoc d2 seed ${i} day ${d}`);
    }
    miseriesActivated += st.calendar.triggeredMiseries.length;
    if (st.calendar.worldEnded) apocalypses += 1;
  }
  assert.ok(apocalypses >= 15, `Expected most d2 runs to reach 7:7 apocalypse, got ${apocalypses}/20`);
  return { apocalypses, miseriesActivated };
}

function scenarioBossAndVault(world: WorldDatabase): { bossesSlain: number; trophiesSold: number } {
  let bossesSlain = 0;
  let trophiesSold = 0;
  const kinds = ['slay_boss', 'steal_relic', 'sabotage'] as const;

  for (let i = 1; i <= 18; i += 1) {
    const st = createInitialGameState(world, {
      seed: i * 409,
      solo: false,
      calendarDie: 100,
      classChoices: ['fanged_deserter', 'heretical_priest', 'wretched_royalty', 'esoteric_hermit'],
    });
    st.party.members.forEach((m) => {
      m.hp = 35;
      m.maxHp = 35;
      m.abilities.strength = 3;
      m.abilities.presence = 3;
      m.abilities.agility = 2;
      m.armorTier = 2;
      m.armorMaxTier = 2;
      m.weapon = { ...world.weaponsById.flail };
      m.omens = 4;
    });
    initializeOpeningScene(st, world);
    st.activeContract.objectiveKind = kinds[i % kinds.length];
    st.activeContract.phase = 'dungeon';
    st.mode = 'dungeon';
    // Jump boss fight directly on half of the runs to exercise boss powers, trophies, sell, and completion
    if (st.activeContract.objectiveKind === 'slay_boss') {
      const bossCombat = startCombat(st, world, [st.activeDungeon!.bossEnemyId], false);
      assert.ok(bossCombat.enemies.length >= 1);
      for (let t = 0; t < 40 && st.mode === 'combat'; t += 1) {
        processPlayerInput(st, world, '1', true);
        assertStateInvariants(st, world, `Boss scenario ${i} turn ${t}`);
      }
      if (st.activeContract.bossSlain) {
        bossesSlain += 1;
        st.activeDungeon!.currentRoomId = 0;
        processPlayerInput(st, world, 'leave dungeon', true);
        const holderIdx = st.party.members.findIndex((m) => m.status === 'alive' && m.inventory.some((it) => it.kind === 'treasure'));
        if (holderIdx >= 0) {
          processPlayerInput(st, world, `pc ${holderIdx + 1}`, true);
        }
        processPlayerInput(st, world, 'sell all', true);
        assertStateInvariants(st, world, `Boss scenario ${i} post-sell`);
        if (st.lastEvents.some((e) => e.includes('sells '))) {
          trophiesSold += 1;
        }
      }
    }
  }
  assert.ok(bossesSlain >= 4, `Expected >= 4 geared boss kills, got ${bossesSlain}`);
  assert.ok(trophiesSold >= 4, `Expected >= 4 boss trophy sales, got ${trophiesSold}`);
  return { bossesSlain, trophiesSold };
}

function scenarioAllyMortalityAndTargeting(world: WorldDatabase): { targetedSecond: boolean; allyCasualties: number } {
  let targetedSecond = false;
  let allyCasualties = 0;
  for (let i = 1; i <= 12; i += 1) {
    const st = createInitialGameState(world, { seed: i * 911, solo: false, calendarDie: 100 });
    st.party.members.forEach((m) => {
      m.hp = 30;
      m.maxHp = 30;
      m.silver = 100;
      m.featureState = { ...(m.featureState ?? {}), dogHp: 4, hawkHp: 4 };
    });
    processPlayerInput(st, world, 'recruit', true);
    processPlayerInput(st, world, 'recruit', true);
    const combat = startCombat(st, world, ['crooked_guard', 'berserker', 'troll'], false);
    combat.enemies.forEach((e) => {
      e.hp = Math.max(e.hp, 20);
      e.maxHp = Math.max(e.maxHp, 20);
    });
    const screen = renderGameScreen(st, true);
    assert.ok(screen.includes('Attack [2]'), 'Multi-enemy screen should list target #2');
    const hp2Before = combat.enemies[1].hp;
    processPlayerInput(st, world, '2', true);
    if (combat.enemies[1].hp < hp2Before || st.lastEvents.some((e) => e.includes(combat.enemies[1].name))) {
      targetedSecond = true;
    }
    for (let t = 0; t < 20 && st.mode === 'combat'; t += 1) {
      processPlayerInput(st, world, '1', true);
      assertStateInvariants(st, world, `Ally scenario ${i} turn ${t}`);
    }
    allyCasualties += st.party.followers.filter((f) => f.status !== 'alive').length;
    allyCasualties += st.party.members.filter((m) => (m.featureState?.dogHp ?? 1) === 0 || (m.featureState?.hawkHp ?? 1) === 0).length;
  }
  assert.ok(targetedSecond, 'Dynamic combat target #2 should target enemy #2');
  assert.ok(allyCasualties >= 1, `Expected >= 1 ally/beast casualty or flee, got ${allyCasualties}`);
  return { targetedSecond, allyCasualties };
}

function scenarioSaveLoadRoundtrip(world: WorldDatabase): void {
  const tmpDir = mkdtempSync(join(tmpdir(), 'mb-playtest-save-'));
  try {
    const st = createInitialGameState(world, { seed: 2026, solo: false });
    initializeOpeningScene(st, world);
    saveGame(st, tmpDir);
    assertSaveRoundtrip(loadGame(tmpDir)!, 'briefing roundtrip');

    processPlayerInput(st, world, 'depart', true);
    saveGame(st, tmpDir);
    assertSaveRoundtrip(loadGame(tmpDir)!, 'travel roundtrip');

    st.activeContract.phase = 'dungeon';
    st.mode = 'dungeon';
    saveGame(st, tmpDir);
    assertSaveRoundtrip(loadGame(tmpDir)!, 'dungeon roundtrip');

    startCombat(st, world, ['goblin', 'scum'], false);
    saveGame(st, tmpDir);
    assertSaveRoundtrip(loadGame(tmpDir)!, 'combat roundtrip');
    deleteActiveSave(tmpDir);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function scenarioFreeformFuzzer(world: WorldDatabase): number {
  const fuzzInputs = [
    '',
    '   ',
    '-1',
    '0',
    '999',
    'NaN',
    'null',
    'undefined',
    'buy -1',
    'buy 999',
    'buy nonexistent_item_xyz',
    'sell -5',
    'sell 99',
    'sell all',
    'use -1',
    'use 999',
    'drop 0',
    'drop 99',
    'attack -1',
    'attack 999',
    'attack abc',
    'cast 0',
    'cast 999',
    'pc 0',
    'pc 99',
    'move -1',
    'move 999',
    'omen invalid_mode',
    'sheet 99',
    'use drop attack',
    'smash lift dodge endure steal secret cipher blood shrine',
  ];

  const st = createInitialGameState(world, { seed: 9999, solo: false });
  initializeOpeningScene(st, world);
  let executed = 0;

  for (const inp of fuzzInputs) {
    processPlayerInput(st, world, inp, true);
    assertStateInvariants(st, world, `Fuzz briefing input "${inp}"`);
    executed += 1;
  }

  processPlayerInput(st, world, 'depart', true);
  for (const inp of fuzzInputs) {
    if (st.mode === 'game_over') break;
    processPlayerInput(st, world, inp, true);
    assertStateInvariants(st, world, `Fuzz travel input "${inp}"`);
    executed += 1;
  }

  if (st.mode !== 'game_over') {
    st.activeContract.phase = 'dungeon';
    st.mode = 'dungeon';
    st.activeCombat = null;
    for (const inp of fuzzInputs) {
      if (st.mode === 'game_over' || st.mode === 'combat') break;
      processPlayerInput(st, world, inp, true);
      assertStateInvariants(st, world, `Fuzz dungeon input "${inp}"`);
      executed += 1;
    }
  }

  if (st.mode !== 'game_over') {
    startCombat(st, world, ['goblin', 'skeleton'], false);
    for (const inp of fuzzInputs) {
      if (st.mode !== 'combat') break;
      processPlayerInput(st, world, inp, true);
      assertStateInvariants(st, world, `Fuzz combat input "${inp}"`);
      executed += 1;
    }
    if (st.activeCombat) {
      st.activeCombat.enemies.forEach((e) => {
        e.status = 'dead';
      });
      finishCombatIfEnded(st);
    }
  }

  return executed;
}

function main(): void {
  const world = loadWorldDatabase();
  const general = runGeneralFuzz200(world);
  const apoc = scenarioApocalypseD2(world);
  const boss = scenarioBossAndVault(world);
  const allies = scenarioAllyMortalityAndTargeting(world);
  scenarioSaveLoadRoundtrip(world);
  const fuzzCount = scenarioFreeformFuzzer(world);

  console.log('MÖRK BORG Playtest & Scenario Fuzz Summary:');
  console.log(
    JSON.stringify(
      {
        general200: general,
        scenarioApocalypseD2: apoc,
        scenarioBossAndVault: boss,
        scenarioAllyMortalityAndTargeting: allies,
        freeformInputsFuzzed: fuzzCount,
        saveLoadRoundtrips: 4,
      },
      null,
      2,
    ),
  );

  assert.ok(general.contractsCompleted >= 15, `Expected >= 15 contracts across 200 runs, got ${general.contractsCompleted}`);
  console.log('Playtest verification PASSED.');
}

main();
