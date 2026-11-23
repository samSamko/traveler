import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createNewGame, getSceneChoices, processInput, renderCurrentScreen } from '../src/engine.ts';
import { RACES } from '../src/content/characters.ts';
import { EVENTS } from '../src/content/events.ts';
import { LOCATIONS } from '../src/content/locations.ts';
import { addItemToInventory, executeCombatAction, getCombatMenuOptions, startCombatEncounter } from '../src/combat.ts';
import { hasFlag, pronouns, setFlag, synthesizeEpilogue } from '../src/memory.ts';
import { loadGame, loadMetaProfile, recordRunCompletion, saveGame } from '../src/save.ts';
import type { BackgroundId, HeirloomId, RaceId, SexId } from '../src/types.ts';

function assertNoParensOrBrackets(text: string, context: string): void {
  const visible = text.replace(/\x1b\[[0-9;]*m/g, '');
  assert.equal(/[\[\]()]/.test(visible), false, `Found brackets or parentheses in ${context}:\n${visible}`);
}

describe('Minimalist Formatting & 1-2 Word Sub-Menus', () => {
  it('contains zero brackets or parentheses in screens, choices, and uses 1-2 word top verbs', () => {
    const state = createNewGame({
      name: 'Aelindra',
      sex: 'female',
      race: 'ael_thalor',
      background: 'root_scholar',
      heirloom: 'kiln_lantern',
      stealthMode: true,
      rngState: 42,
    });

    const rootScreen = renderCurrentScreen(state, state.lastMessages);
    assertNoParensOrBrackets(rootScreen, 'root location screen');

    const rootChoices = getSceneChoices(state);
    assert.deepEqual(
      rootChoices.map((c) => c.label),
      ['Explore', 'Talk', 'Trade', 'Rest', 'Pack', 'Travel'],
    );
    for (const c of rootChoices) {
      assert.ok(c.label.split(/\s+/).length <= 2, `Expected 1-2 words, got "${c.label}"`);
    }

    // Check every sub-menu renders cleanly with zero brackets/parens
    for (const sub of ['explore', 'talk', 'pack', 'pack_craft', 'travel'] as const) {
      state.subMenu = sub;
      const screen = renderCurrentScreen(state, []);
      assertNoParensOrBrackets(screen, `subMenu ${sub}`);
    }
  });
});

describe('Character Creation & Asymmetric Identities', () => {
  it('initializes all 4 original races, 2 sexes, 4 backgrounds, and 4 heirlooms cleanly', () => {
    const combos: Array<{
      sex: SexId;
      race: RaceId;
      background: BackgroundId;
      heirloom: HeirloomId;
      expectedRacialAbility: string;
    }> = [
      { sex: 'male', race: 'vaelorian', background: 'ashen_blade', heirloom: 'kiln_lantern', expectedRacialAbility: 'kiln_spark' },
      { sex: 'female', race: 'ael_thalor', background: 'root_scholar', heirloom: 'orin_bell_shard', expectedRacialAbility: 'gloam_weave' },
      { sex: 'male', race: 'durnfolk', background: 'shrine_penitent', heirloom: 'star_dew_vial', expectedRacialAbility: 'anvil_strike' },
      { sex: 'female', race: 'grixi', background: 'barrow_stalker', heirloom: 'grixi_chronometer', expectedRacialAbility: 'vesper_flask' },
    ];

    for (const c of combos) {
      const state = createNewGame({
        name: 'TestHero',
        sex: c.sex,
        race: c.race,
        background: c.background,
        heirloom: c.heirloom,
        rngState: 42,
      });

      assert.equal(state.player.sex, c.sex);
      assert.equal(state.player.race, c.race);
      assert.ok(state.player.abilities.includes(c.expectedRacialAbility));
      assert.ok(state.player.abilities.length >= 4);
      assert.equal(RACES[c.race].racialAbilityId, c.expectedRacialAbility);
      assert.equal(pronouns(c.sex).subj, c.sex === 'female' ? 'she' : 'he');
    }
  });
});

describe('Talk Dialogue Trees, Progressive Explore & Crafting', () => {
  it('handles multi-topic Captain Vane dialogue and sex/race reactivity', () => {
    const maleVael = createNewGame({
      name: 'Aldric',
      sex: 'male',
      race: 'vaelorian',
      background: 'ashen_blade',
      heirloom: 'kiln_lantern',
      rngState: 123,
    });

    processInput(maleVael, 'Talk');
    assert.equal(maleVael.subMenu, 'talk');
    processInput(maleVael, 'Captain Vane');
    assert.equal(maleVael.subMenu, 'dialogue');
    const resMale = processInput(maleVael, 'Blood Charter');
    assert.match(resMale.messages.join(' '), /Blood of the Charter/);
    assert.equal(maleVael.memory.factions.iron_vow, 2);
    assert.equal(maleVael.subMenu, 'dialogue');

    const femaleGrixi = createNewGame({
      name: 'Nyx',
      sex: 'female',
      race: 'grixi',
      background: 'barrow_stalker',
      heirloom: 'kiln_lantern',
      rngState: 999,
    });
    processInput(femaleGrixi, 'Talk');
    processInput(femaleGrixi, 'Captain Vane');
    const resFem = processInput(femaleGrixi, 'Challenge');
    assert.match(resFem.messages.join(' '), /seamstress hall/);
  });

  it('progressively unlocks Weeping Barrow chambers and supports Pack crafting', () => {
    const grixi = createNewGame({
      name: 'Kip',
      sex: 'male',
      race: 'grixi',
      background: 'barrow_stalker',
      heirloom: 'kiln_lantern',
      rngState: 10,
    });

    // Craft Poultice and Twin Fire-Pots via Pack -> Craft
    addItemToInventory(grixi, 'bog_herb', 1);
    addItemToInventory(grixi, 'ash_resin', 1);
    addItemToInventory(grixi, 'husk_gland', 1);

    processInput(grixi, 'Pack');
    assert.equal(grixi.subMenu, 'pack');
    processInput(grixi, 'Craft');
    assert.equal(grixi.subMenu, 'pack_craft');
    const craftChoices = getSceneChoices(grixi);
    assert.ok(craftChoices.some((c) => c.label === 'Twin Fire-Pots' && c.enabled));
    const craftRes = processInput(grixi, 'Twin Fire-Pots');
    assert.match(craftRes.messages.join(' '), /Crafted Fire-Pot/);

    // Progressive Weeping Barrow exploration
    grixi.subMenu = 'root';
    grixi.locationId = 'weeping_barrow';
    processInput(grixi, 'Explore');
    assert.ok(getSceneChoices(grixi).some((c) => c.label === 'Outer Steps'));
    assert.ok(!getSceneChoices(grixi).some((c) => c.label === 'Inner Crypt'));

    processInput(grixi, 'Outer Steps');
    processInput(grixi, 'Explore');
    assert.ok(getSceneChoices(grixi).some((c) => c.label === 'Inner Crypt'));
  });

  it('branches Silken Cistern reception by binary sex and carries Kale/Vorne to Malakor', () => {
    const fem = createNewGame({
      name: 'Lyra',
      sex: 'female',
      race: 'ael_thalor',
      background: 'root_scholar',
      heirloom: 'kiln_lantern',
      rngState: 777,
    });
    fem.locationId = 'silken_cistern';
    assert.match(LOCATIONS.silken_cistern.description(fem), /quiet sisterhood/i);

    const male = createNewGame({
      name: 'Bram',
      sex: 'male',
      race: 'vaelorian',
      background: 'ashen_blade',
      heirloom: 'kiln_lantern',
      rngState: 777,
    });
    male.locationId = 'silken_cistern';
    assert.match(LOCATIONS.silken_cistern.description(male), /masculine footstep/i);

    const savior = createNewGame({
      name: 'Cael',
      sex: 'male',
      race: 'vaelorian',
      background: 'ashen_blade',
      heirloom: 'kiln_lantern',
      rngState: 55,
    });
    setFlag(savior, 'kale_fate', 'redeemed');
    setFlag(savior, 'vorne_redeemed', true);
    setFlag(savior, 'seal_of_silence', true);
    setFlag(savior, 'root_conduit_severed', true);
    setFlag(savior, 'kiln_cipher_learned', true);
    savior.locationId = 'sunken_belfry';

    processInput(savior, 'Explore');
    const res = processInput(savior, 'Choir Pit');
    assert.equal(savior.scene, 'combat');
    assert.ok(savior.combat);
    assert.equal(savior.combat.enemies.length, 1);
    assert.ok(savior.combat.enemies[0].hp < savior.combat.enemies[0].maxHp);
    assert.match(res.messages.join('\n'), /Kale hurls chain-shot/);

    setFlag(savior, 'malakor_slain', true);
    savior.combat = null;
    savior.scene = 'location';
    const epilogue = synthesizeEpilogue(savior, 'rekindle_kiln');
    assertNoParensOrBrackets(epilogue, 'epilogue');
    assert.match(epilogue, /Kale the Oath-Breaker: Redeemed/);
  });
});

describe('Multi-Enemy Combat, Nested Sub-Menus & Leveling', () => {
  it('supports target sub-menu for single-target Strike and AoE Spells across multiple foes', () => {
    const state = createNewGame({
      name: 'Vael',
      sex: 'female',
      race: 'vaelorian',
      background: 'root_scholar',
      heirloom: 'kiln_lantern',
      rngState: 1234,
    });
    state.player.xp = 30;

    startCombatEncounter(state, { enemyIds: ['iron_deserter', 'chitin_weaver'], canFlee: true });
    assert.equal(state.combat?.enemies.length, 2);
    assert.equal(state.combat?.enemies[0].name, 'Levy-Brigand');
    assert.equal(state.combat?.enemies[1].name, 'Chitin-Weaver');

    const rootScreen = renderCurrentScreen(state, []);
    assertNoParensOrBrackets(rootScreen, 'multi-enemy combat screen');

    // Strike opens target selection sub-menu when 2+ foes live
    executeCombatAction(state, 'strike');
    assert.equal(state.combat?.subMenu, 'target');
    const targets = getCombatMenuOptions(state);
    assert.equal(targets[0].label, 'Levy-Brigand');
    assert.equal(targets[1].label, 'Chitin-Weaver');
    assert.equal(targets[2].label, 'Back');

    // Back returns cleanly to root combat menu
    executeCombatAction(state, 'menu:back');
    assert.equal(state.combat?.subMenu, 'root');

    // Spells sub-menu -> Wither-Bell hits BOTH foes at once
    executeCombatAction(state, 'menu:spells');
    assert.equal(state.combat?.subMenu, 'spells');
    const aoeRes = executeCombatAction(state, 'ability:wither_bell');
    assert.equal(state.combat?.subMenu, 'root');
    assert.match(aoeRes.messages.join('\n'), /Levy-Brigand/);
    assert.match(aoeRes.messages.join('\n'), /Chitin-Weaver/);

    // Finish remaining enemies cleanly
    let guard = 0;
    while (state.scene === 'combat' && guard < 15) {
      if (state.player.focus >= 4) {
        executeCombatAction(state, 'ability:wither_bell');
      } else {
        executeCombatAction(state, 'strike');
        if (state.combat?.subMenu === 'target') {
          const t = getCombatMenuOptions(state)[0];
          executeCombatAction(state, t.id);
        }
      }
      guard += 1;
    }

    assert.equal(state.scene, 'level_up');
    assert.equal(state.player.level, 2);
    processInput(state, '1');
    assert.equal(state.scene, 'location');
  });
});

describe('Non-Repeating Events, 14-Day Clock & Stealth Mode', () => {
  it('enforces event invariants, Day 15 Drowning Toll loss, and zero ANSI or brackets in stealth mode', () => {
    const state = createNewGame({
      name: 'Shadow',
      sex: 'male',
      race: 'grixi',
      background: 'barrow_stalker',
      heirloom: 'kiln_lantern',
      stealthMode: true,
      rngState: 321,
    });

    const rendered = renderCurrentScreen(state, ['Clean message.']);
    assert.equal(/\x1b\[/.test(rendered), false, 'Stealth output must contain no ANSI escape sequences');
    assertNoParensOrBrackets(rendered, 'stealth screen');

    const ids = new Set(EVENTS.map((e) => e.id));
    assert.equal(ids.size, EVENTS.length);
    for (const ev of EVENTS) {
      for (const locId of ev.locations) {
        assert.ok(LOCATIONS[locId], `Event ${ev.id} references unknown location ${locId}`);
      }
      for (const ch of ev.choices) {
        assert.ok(ch.label.split(/\s+/).length <= 2, `Event ${ev.id} choice "${ch.label}" exceeds 2 words`);
        assertNoParensOrBrackets(ch.label, `event ${ev.id} choice`);
      }
    }

    state.day = 14;
    const campRes = processInput(state, 'rest');
    assert.equal(state.scene, 'dead');
    assert.match(campRes.messages.join(' '), /Third Drowning Toll/);
  });
});

describe('Atomic Save, Permadeath & Meta-Profile Unlocks', () => {
  it('saves atomically, resumes cleanly, and unlocks heirlooms on run completion', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'traveler-test-'));
    try {
      const state = createNewGame({
        name: 'Kaelen',
        sex: 'male',
        race: 'durnfolk',
        background: 'ashen_blade',
        heirloom: 'kiln_lantern',
        rngState: 7,
      });
      state.day = 8;
      state.player.crowns = 120;
      setFlag(state, 'seal_of_silence', true);
      setFlag(state, 'kiln_cipher_learned', true);
      addItemToInventory(state, 'poultice', 1);

      saveGame(state, tempDir);
      const loaded = loadGame(tempDir);
      assert.ok(loaded);
      assert.equal(loaded.player.name, 'Kaelen');
      assert.equal(loaded.day, 8);
      assert.ok(hasFlag(loaded, 'seal_of_silence'));

      const completion = recordRunCompletion(loaded, 'victory', 'Heir of the First Kiln', tempDir);
      assert.equal(loadGame(tempDir), null);
      assert.ok(completion.newlyUnlocked.includes('orin_bell_shard'));
      assert.ok(completion.newlyUnlocked.includes('star_dew_vial'));
      assert.ok(completion.newlyUnlocked.includes('grixi_chronometer'));

      const meta = loadMetaProfile(tempDir);
      assert.equal(meta.runsPlayed, 1);
      assert.equal(meta.victories, 1);
      assert.equal(meta.bestDayReached, 8);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
