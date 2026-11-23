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

describe('World Memory, Sex Reactivity & Race-Only Actions', () => {
  it('branches Cinderford muster reaction by sex and Vaelorian race', () => {
    const maleVael = createNewGame({
      name: 'Aldric',
      sex: 'male',
      race: 'vaelorian',
      background: 'ashen_blade',
      heirloom: 'kiln_lantern',
      rngState: 123,
    });
    const choicesMale = getSceneChoices(maleVael);
    const musterMale = choicesMale.find((c) => c.id === 'loc:cf_muster_yard');
    assert.ok(musterMale);
    const resMale = processInput(maleVael, String(musterMale.index));
    assert.match(resMale.messages.join(' '), /Blood of the Charter/);
    assert.equal(maleVael.memory.factions.iron_vow, 2);

    const femaleGrixi = createNewGame({
      name: 'Nyx',
      sex: 'female',
      race: 'grixi',
      background: 'barrow_stalker',
      heirloom: 'kiln_lantern',
      rngState: 999,
    });
    const choicesFem = getSceneChoices(femaleGrixi);
    const musterFem = choicesFem.find((c) => c.id === 'loc:cf_muster_yard');
    assert.ok(musterFem);
    const resFem = processInput(femaleGrixi, String(musterFem.index));
    assert.match(resFem.messages.join(' '), /seamstress hall/);
  });

  it('branches Silken Cistern reception by binary sex and unlocks female Unveiled Sisterhood', () => {
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
  });

  it('provides race-exclusive actions for all 4 races and carries Kale consequence to Malakor', () => {
    // Durnfolk vault in Weeping Barrow
    const durn = createNewGame({
      name: 'Thorek',
      sex: 'male',
      race: 'durnfolk',
      background: 'shrine_penitent',
      heirloom: 'kiln_lantern',
      rngState: 10,
    });
    durn.locationId = 'weeping_barrow';
    const durnChoices = getSceneChoices(durn);
    assert.ok(durnChoices.some((c) => c.id === 'loc:wb_durnfolk_vault'));

    // Ael-Thalor Star-Stag pacification in Petrified Star-Wood
    const elf = createNewGame({
      name: 'Saelis',
      sex: 'female',
      race: 'ael_thalor',
      background: 'root_scholar',
      heirloom: 'kiln_lantern',
      rngState: 10,
    });
    elf.locationId = 'petrified_starwood';
    const stagAction = getSceneChoices(elf).find((c) => c.id === 'loc:sw_star_stag');
    assert.ok(stagAction);
    const stagRes = processInput(elf, String(stagAction.index));
    assert.match(stagRes.messages.join(' '), /Memory-Canticle/);
    assert.ok(elf.player.inventory.some((i) => i.id === 'star_glaive'));

    // Grixi chitin vent in Ash-Fen
    const grixi = createNewGame({
      name: 'Kip',
      sex: 'male',
      race: 'grixi',
      background: 'barrow_stalker',
      heirloom: 'kiln_lantern',
      rngState: 10,
    });
    grixi.locationId = 'ash_fen';
    assert.ok(getSceneChoices(grixi).some((c) => c.id === 'loc:af_grixi_salvage'));

    // Redeemed Kale + Seal of Silence + Kiln Cipher weaken Malakor
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

    const malakorAction = getSceneChoices(savior).find((c) => c.id === 'loc:sb_confront_malakor');
    assert.ok(malakorAction);
    const res = processInput(savior, String(malakorAction.index));
    assert.equal(savior.scene, 'combat');
    assert.ok(savior.combat);
    assert.ok(savior.combat.enemy.hp < savior.combat.enemy.maxHp);
    assert.match(res.messages.join('\n'), /Kale.*-20% Boss HP/);
    assert.match(res.messages.join('\n'), /Sir Vorne.*-15% Boss HP/);

    // Verify endings synthesize chronicle & fates
    setFlag(savior, 'malakor_slain', true);
    savior.combat = null;
    savior.scene = 'location';
    const epilogue = synthesizeEpilogue(savior, 'rekindle_kiln');
    assert.match(epilogue, /Kale the Oath-Breaker: Redeemed/);
    assert.match(epilogue, /Sir Vorne: Freed from hollowing/);
  });
});

describe('Tactical Combat, Heirlooms, Spells & Leveling', () => {
  it('resolves telegraphed intents, racial cantrip, heirloom, and victory XP/level-up', () => {
    const state = createNewGame({
      name: 'Vael',
      sex: 'female',
      race: 'vaelorian',
      background: 'root_scholar',
      heirloom: 'kiln_lantern',
      rngState: 1234,
    });
    state.player.xp = 30; // Next kill (18 XP) will trigger Level 2!

    startCombatEncounter(state, { enemyId: 'root_husk', canFlee: true });
    assert.equal(state.scene, 'combat');
    assert.ok(state.combat);

    const options = getCombatMenuOptions(state);
    assert.ok(options.some((o) => o.id === 'ability:kiln_spark'));
    assert.ok(options.some((o) => o.id === 'heirloom'));

    // Use Heirloom (Lantern of the First Kiln: 8 damage + 3 focus)
    const hRes = executeCombatAction(state, 'heirloom');
    assert.match(hRes.messages.join(' '), /Lantern of the First Kiln/);
    assert.ok(state.combat?.heirloomUsedThisFight);

    // Finish enemy with Soul-Dart / Kiln-Spark
    let guard = 0;
    while (state.scene === 'combat' && guard < 10) {
      executeCombatAction(state, state.player.focus >= 2 ? 'ability:soul_dart' : 'strike');
      guard += 1;
    }

    assert.equal(state.scene, 'level_up');
    assert.equal(state.player.level, 2);
    assert.ok(state.pendingPerkIds.length > 0);
    const perkPick = processInput(state, '1');
    assert.match(perkPick.messages.join(' '), /Gained Perk/);
    assert.equal(state.scene, 'location');
  });
});

describe('Non-Repeating Events, 14-Day Clock & Stealth Mode', () => {
  it('enforces non-repeating events, Day 15 Drowning Toll loss, and zero ANSI in stealth mode', () => {
    const state = createNewGame({
      name: 'Shadow',
      sex: 'male',
      race: 'grixi',
      background: 'barrow_stalker',
      heirloom: 'kiln_lantern',
      stealthMode: true,
      rngState: 321,
    });

    const rendered = renderCurrentScreen(state, ['Test message']);
    assert.equal(/\x1b\[/.test(rendered), false, 'Stealth output must contain no ANSI escape sequences');

    // Verify all events have unique IDs and valid locations
    const ids = new Set(EVENTS.map((e) => e.id));
    assert.equal(ids.size, EVENTS.length);
    for (const ev of EVENTS) {
      for (const locId of ev.locations) {
        assert.ok(LOCATIONS[locId], `Event ${ev.id} references unknown location ${locId}`);
      }
    }

    // Advance past Day 14 via camp without killing Malakor -> Day 15 triggers doom
    state.day = 14;
    const campRes = processInput(state, 'camp');
    assert.equal(state.scene, 'dead');
    assert.match(campRes.messages.join(' '), /THIRD DROWNING TOLL SOUNDS/);
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
      assert.equal(loadGame(tempDir), null, 'Active run save must be erased after run completion');
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
