import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createNewGame, getSceneChoices, processInput, renderCurrentScreen } from '../src/engine.ts';
import { RACES } from '../src/content/characters.ts';
import { EVENTS } from '../src/content/events.ts';
import { addItemToInventory, executeCombatAction, getCombatMenuOptions, startCombatEncounter } from '../src/combat.ts';
import { hasFlag, pronouns, setFlag, synthesizeEpilogue } from '../src/memory.ts';
import { loadGame, loadMetaProfile, recordRunCompletion, saveGame } from '../src/save.ts';
import { buildPlayerAnatomy, getAppearanceOptionsFor, getNpcAppearanceReaction } from '../src/writing/anatomy.ts';
import { getHealthConditionLabel } from '../src/writing/appraisal.ts';
import { getIntroBeat } from '../src/writing/intro.ts';
import { renderProse } from '../src/writing/prose.ts';
import { advanceHours, getTimePeriod } from '../src/systems/clock.ts';
import { computeDamageAfterResistance, getEffectivePlayerResistances } from '../src/systems/damage.ts';
import { exciseBodyMod, installBodyMod } from '../src/systems/bodymods.ts';
import { inflictInjury, resolvePlayerDefeat, tendInjury } from '../src/systems/injuries.ts';
import { getEffectiveStat, resolveCheck, rollD20WithMode } from '../src/dice.ts';
import { getWorldDatabase } from '../src/db/loader.ts';
import { evaluateCondition, executeEffect, selectProseVariant } from '../src/db/rules.ts';
import { enterMobileCamp, executeCampAction } from '../src/systems/camp.ts';
import {
  applyWeaponCoating,
  degradeArmor,
  drinkDraught,
  repairEquippedArmor,
  rollArmorTierReduction,
} from '../src/systems/frontier.ts';
import type { BackgroundId, RaceId, SexId } from '../src/types.ts';

function assertNoParensOrBrackets(text: string, context: string): void {
  const visible = text.replace(/\x1b\[[0-9;]*m/g, '');
  assert.equal(/[\[\]()]/.test(visible), false, `Found brackets or parentheses in ${context}:\n${visible}`);
}

describe('Writing Framework: Customizer, Prose Interpolator & Compositional Intro', () => {
  it('enforces race-bounded palettes, variable prose tokens, and skippable endless intro', () => {
    const elfOpts = getAppearanceOptionsFor('female', 'ael_thalor');
    const grixiOpts = getAppearanceOptionsFor('male', 'grixi');
    assert.ok(elfOpts.skinColor.includes('Moon-Pale'));
    assert.ok(!grixiOpts.skinColor.includes('Moon-Pale'));
    assert.ok(grixiOpts.skinColor.includes('Mossy Olive'));

    const customAnatomy = buildPlayerAnatomy('female', 'vaelorian', 'ashen_blade', {
      height: 'Towering',
      weight: 'Solid',
      skinColor: 'Bronze',
      hairLength: 'Long',
      hairStyle: 'Braided',
      hairColor: 'Raven Black',
      eyeShape: 'Narrow',
      eyeColor: 'Storm-Grey',
      musculature: 'Corded',
      bodyShape: 'Curved',
      facialScars: 'Cheek Slash',
      bodyScars: 'Old Spear-Mark',
      distinguishingMark: 'Hearth-Brand',
    });

    const state = createNewGame({
      name: 'Valeria',
      sex: 'female',
      race: 'vaelorian',
      background: 'ashen_blade',
      anatomy: customAnatomy,
      stealthMode: true,
      rngState: 42,
    });

    // Inline variable prose interpolator
    state.player.defilement = 42;
    const templated = renderProse(
      'Cold {weather} beads on {name}\'s {skin} skin at {period}.{if:scarred_face} A fresh glint catches the scar.{/if}{if:defilement>=40} Pale hum stirs in {his} blood.{/if}',
      state,
    );
    assert.match(templated, /sleet-rain beads on Valeria's bronze skin at morning/);
    assert.match(templated, /fresh glint catches the scar/);
    assert.match(templated, /Pale hum stirs in her blood/);

    // 4-beat skippable intro with Endless Sandbox text
    assert.equal(state.scene, 'intro');
    assertNoParensOrBrackets(renderCurrentScreen(state, []), 'intro beat 0');
    processInput(state, 'Continue');
    const beat1 = getIntroBeat(state, 1);
    assert.match(beat1.body, /bronze skin/i);
    assert.match(beat1.body, /cheek slash/i);

    const skipRes = processInput(state, 'Skip');
    assert.equal(state.scene, 'camp_hub');
    assert.match(skipRes.messages.join(' '), /lone camp/);

    const vaneReaction = getNpcAppearanceReaction(state, 'captain_vane');
    assert.ok(vaneReaction);
  });

  it('uses clean 1-2 word verbs, 2-column grid, and zero brackets/parentheses', () => {
    const state = createNewGame({
      name: 'Aelindra',
      sex: 'female',
      race: 'ael_thalor',
      background: 'root_scholar',
      skipIntro: true,
      stealthMode: true,
      rngState: 42,
    });

    const rootScreen = renderCurrentScreen(state, state.lastMessages);
    assertNoParensOrBrackets(rootScreen, 'root camp_hub screen');
    assert.match(rootScreen, /1\. Explore\s+2\. Travel/);

    const rootChoices = getSceneChoices(state);
    assert.deepEqual(
      rootChoices.map((c) => c.label),
      ['Explore', 'Travel', 'Rest', 'Stash', 'Pack', 'Journal'],
    );
  });
});

describe('24-Hour Clock, Dynamic Weather & Mobile Solo Camp', () => {
  it('advances 24h periods without Day 14 doom and supports full mobile solo Camp state', () => {
    const state = createNewGame({
      name: 'Roran',
      sex: 'male',
      race: 'durnfolk',
      background: 'barrow_stalker',
      skipIntro: true,
      stealthMode: true,
      rngState: 88,
    });

    assert.equal(getTimePeriod(state.clock.hour), 'morning');
    advanceHours(state, 10); // 08:00 -> 18:00 Dusk
    assert.equal(getTimePeriod(state.clock.hour), 'dusk');

    // Endless Sandbox: advancing 20 days does NOT kill the player
    state.player.rations = 30;
    advanceHours(state, 24 * 16);
    assert.ok(state.day >= 17);
    assert.equal(state.scene, 'camp_hub');

    // Cannot wild camp inside town
    state.locationId = 'frostwall_redoubt';
    state.scene = 'location';
    const failCamp = processInput(state, 'camp');
    assert.match(failCamp.messages.join(' '), /town walls/);

    // Move to wild area -> Camp state opens cleanly
    state.locationId = 'imperial_viaduct';
    assert.ok(getSceneChoices(state).some((c) => c.label === 'Camp'));
    processInput(state, 'Camp');
    assert.equal(state.scene, 'camp');
    assertNoParensOrBrackets(renderCurrentScreen(state, []), 'camp screen');

    // Inflict an injury and tend it at Camp
    inflictInjury(state, 'deep_laceration');
    assert.equal(state.player.injuries.length, 1);
    const tendRes = processInput(state, 'Tend');
    assert.match(tendRes.messages.join(' '), /Tended Deep Laceration/);
    assert.equal(state.player.injuries.length, 0);

    // Forage & Pack Up
    processInput(state, 'Forage');
    processInput(state, 'Pack Up');
    assert.equal(state.scene, 'location');
    assert.equal(state.camp, null);
  });
});

describe('Body Modifications (Mutations, Surgeries, Implants) & Defilement', () => {
  it('installs slot-based mods with bonuses, drawbacks, anatomy rewrites, and surgical excision', () => {
    const state = createNewGame({
      name: 'Mirek',
      sex: 'male',
      race: 'grixi',
      background: 'barrow_stalker',
      skipIntro: true,
      stealthMode: true,
      rngState: 21,
    });

    const baseWit = getEffectiveStat(state, 'wit');
    const msgs1 = installBodyMod(state, 'star_sap_eyes');
    assert.match(msgs1.join(' '), /Star-Sap Lenses/);
    assert.equal(getEffectiveStat(state, 'wit'), baseWit + 2);
    assert.equal(state.player.anatomy.eyeColor, 'Star-Sap Silver');
    assert.equal(state.player.defilement, 10);
    assert.equal(getEffectivePlayerResistances(state).lightning, 'vulnerable');

    const msgs2 = installBodyMod(state, 'pale_root_hands');
    assert.match(msgs2.join(' '), /Pale-Root Claws/);
    assert.ok(state.player.abilities.includes('root_snare'));
    assert.equal(state.player.defilement, 30);

    // Journal -> Self displays active Body Modifications cleanly without brackets
    processInput(state, 'Journal');
    processInput(state, 'Self');
    const selfScreen = renderCurrentScreen(state, []);
    assertNoParensOrBrackets(selfScreen, 'journal self with body mods');
    assert.match(selfScreen, /Star-Sap Lenses/);
    assert.match(selfScreen, /Pale-Root Claws/);
    processInput(state, 'Back');
    processInput(state, 'Back');

    // Surgical excision removes mod, drops Defilement, and leaves permanent scar
    const exMsgs = exciseBodyMod(state, 'eyes');
    assert.match(exMsgs.join(' '), /Pale Corneal Scar/i);
    assert.equal(state.player.bodyMods.eyes, undefined);
    assert.equal(state.player.anatomy.facialScars, 'Pale Corneal Scar');
    assert.equal(state.player.defilement, 25);
  });
});

describe('10 Damage Types, Subdue Aftermath & Scarred Survival Defeat', () => {
  it('applies 10-type resistance multipliers, weather modifiers, Subdue -> Aftermath, and Scarred Survival', () => {
    // Resistance & weather math
    const rainFire = computeDamageAfterResistance(10, 'fire', { fire: 'vulnerable' }, 'ash_rain');
    assert.equal(rainFire.finalDamage, 11); // floor(10 * 0.75) = 7 -> ceil(7 * 1.5) = 11
    const rainLight = computeDamageAfterResistance(10, 'lightning', { lightning: 'vulnerable' }, 'ash_rain');
    assert.equal(rainLight.finalDamage, 20); // ceil(10 * 1.25) = 13 -> ceil(13 * 1.5) = 20
    const immune = computeDamageAfterResistance(15, 'poison', { poison: 'immune' }, 'clear');
    assert.equal(immune.finalDamage, 0);

    // Subdue leaves humanoid downed alive -> Aftermath scene
    const state = createNewGame({
      name: 'Talia',
      sex: 'female',
      race: 'durnfolk',
      background: 'ashen_blade',
      survivalMode: 'scarred',
      skipIntro: true,
      stealthMode: true,
      rngState: 300,
    });

    startCombatEncounter(state, { enemyId: 'iron_deserter', canFlee: true });
    assert.ok(state.combat);
    state.combat.enemies[0].hp = 3; // Low HP so Subdue knocks them down without huge overkill
    executeCombatAction(state, 'subdue');
    assert.equal(state.scene, 'aftermath');
    assert.ok(state.aftermath);
    assertNoParensOrBrackets(renderCurrentScreen(state, []), 'aftermath screen');

    const stripRes = processInput(state, 'Strip');
    assert.match(stripRes.messages.join(' '), /Crowns/);
    const qRes = processInput(state, 'Question');
    assert.ok(qRes.messages.length > 0);
    const spareRes = processInput(state, 'Spare');
    assert.match(spareRes.messages.join(' '), /breathing in the slush/);
    assert.equal(state.scene, 'camp_hub');

    // Scarred Survival player defeat opens 3-beat defeat cutscene -> camp_hub
    startCombatEncounter(state, { enemyId: 'iron_deserter', canFlee: true });
    state.player.crowns = 40;
    resolvePlayerDefeat(state, 'hp');
    assert.equal(state.scene, 'defeat');
    assert.ok(state.defeatState);
    assert.equal(state.defeatState.beats.length, 3);
    assertNoParensOrBrackets(renderCurrentScreen(state, []), 'defeat beat 0');
    processInput(state, 'Continue');
    assert.equal(state.defeatState?.beatIndex, 1);
    processInput(state, 'Continue');
    assert.equal(state.defeatState?.beatIndex, 2);
    const finalDefRes = processInput(state, 'Continue');
    assert.equal(state.scene, 'camp_hub');
    assert.ok(state.player.injuries.length >= 1);
    assert.ok(state.player.crowns < 40);
    assert.match(finalDefRes.messages.join(' '), /Fractured Ribs/);

    // Ironman mode defeat kills immediately
    const ironman = createNewGame({
      name: 'Grim',
      sex: 'male',
      race: 'vaelorian',
      background: 'ashen_blade',
      survivalMode: 'ironman',
      skipIntro: true,
      rngState: 9,
    });
    startCombatEncounter(ironman, { enemyId: 'ash_hound', canFlee: true });
    resolvePlayerDefeat(ironman, 'hp');
    assert.equal(ironman.scene, 'dead');
  });
});

describe('Combat Qualitative UI, Appraisal, Mid-Combat Journal & Persistence', () => {
  it('hides raw enemy HP, lets free Observe and mid-combat Journal run cleanly, and persists state', () => {
    const state = createNewGame({
      name: 'Vael',
      sex: 'female',
      race: 'vaelorian',
      background: 'root_scholar',
      skipIntro: true,
      rngState: 1234,
    });

    assert.equal(getHealthConditionLabel(20, 20), 'Unscathed');
    assert.equal(getHealthConditionLabel(6, 20), 'Bloodied');

    const { introMessages } = startCombatEncounter(state, {
      enemyIds: ['iron_deserter', 'chitin_weaver'],
      canFlee: true,
    });
    const combatScreen = renderCurrentScreen(state, introMessages);
    assertNoParensOrBrackets(combatScreen, 'combat screen');
    assert.equal(/HP 23\/23/.test(combatScreen), false);

    // Mid-combat Journal -> Arts shows exact damage types
    processInput(state, 'Journal');
    processInput(state, 'Arts');
    const artsScreen = renderCurrentScreen(state, []);
    assertNoParensOrBrackets(artsScreen, 'mid-combat arts');
    assert.match(artsScreen, /Bludgeoning/);
    assert.match(artsScreen, /Subdue/);
    processInput(state, 'Back');
    processInput(state, 'Back');
    assert.equal(state.scene, 'combat');
    assert.equal(state.combat?.round, 1);

    // Free Observe does not advance combat round
    executeCombatAction(state, 'observe');
    const targets = getCombatMenuOptions(state);
    executeCombatAction(state, targets[0].id);
    assert.equal(state.combat?.round, 1);
    assert.equal(state.combat?.observedUsedThisRound, true);

    // Verify all 4 races and atomic persistence
    const races: RaceId[] = ['vaelorian', 'ael_thalor', 'durnfolk', 'grixi'];
    for (const r of races) {
      assert.ok(RACES[r].resistances);
    }

    const tempDir = mkdtempSync(join(tmpdir(), 'traveler-test-'));
    try {
      setFlag(state, 'seal_of_silence', true);
      setFlag(state, 'kiln_cipher_learned', true);
      state.player.crowns = 120;
      installBodyMod(state, 'vesper_ribs');
      saveGame(state, tempDir);
      const loaded = loadGame(tempDir);
      assert.ok(loaded);
      assert.equal(loaded.player.bodyMods.chest, 'vesper_ribs');
      assert.equal(loaded.clock.day, 1);
      assert.ok(hasFlag(loaded, 'seal_of_silence'));

      const completion = recordRunCompletion(loaded, 'victory', 'Keeper of the Silver Dome', tempDir);
      assert.equal(loadGame(tempDir), null);
      const meta = loadMetaProfile(tempDir);
      assert.equal(meta.victories, 1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('compiles world JSON into SQLite with intact foreign keys and evaluates Condition/Effect DSL', () => {
    const db = getWorldDatabase();
    const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
    assert.equal(fkCheck.length, 0);

    const placeCount = db.prepare('SELECT COUNT(*) AS cnt FROM places').get() as { cnt: number };
    const eventCount = db.prepare('SELECT COUNT(*) AS cnt FROM events').get() as { cnt: number };
    assert.equal(placeCount.cnt, 14);
    assert.equal(eventCount.cnt, 36);

    const state = createNewGame({
      name: 'Kael',
      sex: 'male',
      race: 'grixi',
      background: 'barrow_stalker',
      skipIntro: true,
      rngState: 99,
    });

    assert.equal(evaluateCondition(state, { races: ['grixi', 'durnfolk'] }), true);
    assert.equal(evaluateCondition(state, { sex: 'female' }), false);

    const prose = selectProseVariant(state, [
      { when: { race: 'ael_thalor' }, text: 'Elf prose' },
      { text: 'Default prose for {name}' },
    ]);
    assert.equal(prose, 'Default prose for Kael');

    const outcome = executeEffect(state, {
      setFlags: { dsl_test_flag: true },
      giveCrowns: 15,
      giveItems: [{ id: 'poultice', qty: 1 }],
      messages: ['DSL executed cleanly.'],
    });
    assert.equal(hasFlag(state, 'dsl_test_flag'), true);
    assert.equal(outcome.messages[0], 'DSL executed cleanly.');
  });
});

describe('5-Slot Equipment, Action Economy, Draughts & Tabletop Mechanics', () => {
  it('supports 5-slot equipment, two-handed lock, gear visibleTags, and legacy save migration', () => {
    const state = createNewGame({
      name: 'Vane',
      sex: 'male',
      race: 'vaelorian',
      background: 'ashen_blade',
      skipIntro: true,
      rngState: 12,
    });

    assert.equal(state.player.equipment.mainHand, 'notched_broadsword');
    assert.equal(state.player.equipment.armor, 'chain_hauberk');
    assert.equal(state.player.armorTierCurrent, 2);

    // Equip off-hand buckler and cistern veil cloak
    addItemToInventory(state, 'iron_buckler', 1);
    addItemToInventory(state, 'cistern_veil', 1);
    processInput(state, 'equip Iron Buckler');
    processInput(state, 'equip Cistern Shroud');
    assert.equal(state.player.equipment.offHand, 'iron_buckler');
    assert.equal(state.player.equipment.cloak, 'cistern_veil');
    assert.equal(evaluateCondition(state, { hasTag: 'cistern_garb' }), true);

    // Equipping two-handed weapon auto-unequips offHand
    addItemToInventory(state, 'runic_warhammer', 1);
    const twoHandRes = processInput(state, 'equip Runic Warhammer');
    assert.ok(twoHandRes.messages.some((m) => m.includes('two-handed')));
    assert.equal(state.player.equipment.mainHand, 'runic_warhammer');
    assert.equal(state.player.equipment.offHand, null);
    assert.ok(state.player.inventory.some((i) => i.id === 'iron_buckler'));

    // Legacy save migration
    const tempDir = mkdtempSync(join(tmpdir(), 'traveler-legacy-'));
    try {
      const legacyPayload = {
        ...state,
        player: {
          ...state.player,
          weaponId: 'notched_broadsword',
          armorId: 'chain_hauberk',
          trinketId: 'imperial_signet',
        },
      } as Record<string, unknown>;
      delete (legacyPayload.player as Record<string, unknown>).equipment;
      delete (legacyPayload.player as Record<string, unknown>).reserves;
      delete (legacyPayload.player as Record<string, unknown>).grace;
      saveGame(legacyPayload as unknown as typeof state, tempDir);
      const migrated = loadGame(tempDir);
      assert.ok(migrated);
      assert.equal(migrated.player.equipment.mainHand, 'notched_broadsword');
      assert.equal(migrated.player.equipment.trinket, 'imperial_signet');
      assert.equal(migrated.player.reserves, 2);
      assert.equal(migrated.player.grace, 2);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('enforces Main/Swift/Free action economy, Grace max damage, Armor Tiers, Draughts, and Rests', () => {
    const state = createNewGame({
      name: 'Sable',
      sex: 'female',
      race: 'grixi',
      background: 'barrow_stalker',
      skipIntro: true,
      rngState: 77,
    });
    state.player.perks.push('relentless_tempo');

    // Edge/Burden dice check
    const edge = rollD20WithMode('edge', state);
    assert.equal(edge.rolls.length, 2);
    assert.equal(edge.roll, Math.max(edge.rolls[0], edge.rolls[1]));
    const check = resolveCheck(state, 'wit', 10, { mode: 'burden', label: 'Trap' });
    assert.equal(check.rollMode, 'burden');

    // Draughts raise/purge Defilement
    const beforeDef = state.player.defilement;
    const drinkMsgs = drinkDraught(state, 'amber_tonic');
    assert.ok(drinkMsgs.some((m) => m.includes('Defilement')));
    assert.equal(state.player.defilement, beforeDef + 8);
    drinkDraught(state, 'ash_purge_draught');
    assert.equal(state.player.defilement, beforeDef);

    // Armor Tier DR, degradation, and repair
    state.player.equipment.armor = 'basalt_plate';
    state.player.armorTierCurrent = 3;
    const dr = rollArmorTierReduction(state.player.armorTierCurrent, state);
    assert.ok(dr >= 1 && dr <= 6);
    const degMsg = degradeArmor(state);
    assert.ok(degMsg?.includes('Tier 2'));
    assert.equal(state.player.armorTierCurrent, 2);
    const repMsgs = repairEquippedArmor(state, false);
    assert.ok(repMsgs[0].includes('Tier 3'));
    assert.equal(state.player.armorTierCurrent, 3);

    // Brief Rest & Full Rest at Camp
    state.locationId = 'imperial_viaduct';
    enterMobileCamp(state);
    executeCampAction(state, 'camp:kindle');
    state.player.hp = 10;
    state.player.grace = 0;
    const briefMsgs = executeCampAction(state, 'camp:brief_rest');
    assert.ok(briefMsgs.some((m) => m.includes('Reserve')));
    assert.equal(state.player.reserves, 1);
    assert.ok(state.player.hp > 10);
    const fullMsgs = executeCampAction(state, 'camp:full_rest');
    assert.ok(fullMsgs.some((m) => m.includes('Reserves and Grace')));
    assert.ok(state.player.grace >= 1);
    executeCampAction(state, 'camp:pack_up');

    // Combat Action Economy (1 Main, 2 Swift from relentless_tempo, 1 Free)
    applyWeaponCoating(state, 'kiln_pitch');
    startCombatEncounter(state, { enemyId: 'ash_hound', canFlee: true });
    assert.equal(state.combat?.mainLeft, 1);
    assert.equal(state.combat?.swiftLeft, 2);
    assert.equal(state.combat?.freeLeft, 1);

    // Free action: Spend Grace
    executeCombatAction(state, 'grace');
    assert.equal(state.combat?.freeLeft, 0);
    assert.equal(state.combat?.graceMaxDamagePending, true);

    // Main action: Strike (does not end turn yet because Swift actions remain)
    const strikeRes = executeCombatAction(state, 'strike');
    assert.ok(strikeRes.messages.some((m) => m.includes('Grace guides')));
    if (state.combat) {
      assert.equal(state.combat.round, 1);
      assert.equal(state.combat.mainLeft, 0);
      assert.ok(getCombatMenuOptions(state).some((o) => o.id === 'end_turn'));
      executeCombatAction(state, 'end_turn');
      if (state.combat) {
        assert.equal(state.combat.round, 2);
        assert.equal(state.combat.mainLeft, 1);
        assert.equal(state.combat.swiftLeft, 2);
      }
    }
  });
});

describe('Core Frontier Loop: Hub, 10 Areas, Sub-Areas, Dungeons & Towns', () => {
  it('runs Camp Hub Explore -> Travel -> Town (no Explore) -> Area Sub-Area -> Dungeon Map', () => {
    const state = createNewGame({
      name: 'Rowan',
      sex: 'male',
      race: 'vaelorian',
      background: 'ashen_blade',
      skipIntro: true,
      stealthMode: true,
      rngState: 5,
    });

    assert.equal(state.scene, 'camp_hub');
    // Stash put/take
    addItemToInventory(state, 'poultice', 1);
    processInput(state, 'Stash');
    processInput(state, 'Store');
    processInput(state, 'Herb Poultice');
    assert.ok(state.frontier.stash.some((s) => s.id === 'poultice'));
    processInput(state, 'Take');
    processInput(state, 'Herb Poultice');
    assert.equal(state.frontier.stash.length, 0);
    processInput(state, 'Back');

    // Camp Explore unlocks areas/towns or triggers encounter
    processInput(state, 'Explore');
    if (state.scene === 'combat' || state.scene === 'combat_approach') {
      state.combat = null;
      state.combatApproach = null;
      state.scene = 'camp_hub';
    } else if (state.scene === 'explore_beat') {
      if (state.exploreBeat && !state.exploreBeat.resolved && state.exploreBeat.kind === 'salvage') {
        processInput(state, 'Search');
      }
      processInput(state, 'Continue');
    } else if (state.scene === 'shop') {
      processInput(state, 'Leave');
    }
    assert.equal(state.scene, 'camp_hub');

    // Unlock Timber Post Town -> verify NO Explore action inside town
    state.frontier.unlockedTowns.push('frostwall_redoubt');
    processInput(state, 'Travel');
    processInput(state, 'Timber Post');
    assert.equal(state.scene, 'travel');
    for (let i = 0; i < 5 && state.scene === 'travel'; i++) processInput(state, 'Continue');
    assert.equal(state.scene, 'location');
    assert.equal(state.locationId, 'frostwall_redoubt');
    const townLabels = getSceneChoices(state).map((c) => c.label);
    assert.equal(townLabels.includes('Explore'), false);
    assert.ok(townLabels.includes('Talk'));
    assert.ok(townLabels.includes('Return'));

    // Return to Camp, Travel to Long Steps (Area), toggle Sub-Area, Enter Dungeon
    processInput(state, 'Return');
    assert.equal(state.scene, 'camp_hub');
    state.frontier.unlockedAreas.push('stepped_barrow');
    state.frontier.unlockedSubAreas.push('barrow_crypt_ledge');
    state.frontier.unlockedDungeons.push('barrow_undercroft');

    processInput(state, 'Travel');
    processInput(state, 'Long Steps');
    for (let i = 0; i < 5 && state.scene === 'travel'; i++) processInput(state, 'Continue');
    if (state.scene === 'combat' || state.scene === 'combat_approach') {
      state.combat = null;
      state.combatApproach = null;
      state.scene = 'location';
    }
    assert.equal(state.scene, 'location');
    const areaLabels = getSceneChoices(state).map((c) => c.label);
    assert.ok(areaLabels.includes('Explore'));
    assert.ok(areaLabels.includes('Sub-Area'));
    assert.ok(areaLabels.includes('Dungeon'));

    // Toggle Sub-Area
    processInput(state, 'Sub-Area');
    assert.equal(state.frontier.activeSubArea.stepped_barrow, 'barrow_crypt_ledge');

    // Enter Dungeon -> Room-by-Room navigation + ASCII fog-of-war + Switch + Exit
    processInput(state, 'Dungeon');
    assert.equal(state.scene, 'dungeon');
    const dungScreen = renderCurrentScreen(state, []);
    assertNoParensOrBrackets(dungScreen, 'dungeon map screen');
    assert.match(dungScreen, /MAP - BARROW UNDERCROFT/);

    // Move East to Bone Corridor (clear enemy if combat triggers)
    processInput(state, 'East');
    if (state.scene === 'combat') {
      state.combat = null;
      state.scene = 'dungeon';
    }
    // Move North to Chain Alcove & pull switch
    processInput(state, 'North');
    processInput(state, 'Pull Chain');
    assert.ok(state.frontier.dungeonStates.barrow_undercroft.pulledSwitches.includes('bu_gate_switch'));

    // Backtrack South -> West -> Leave back to Stepped Barrow
    processInput(state, 'South');
    processInput(state, 'West');
    processInput(state, 'Leave');
    assert.equal(state.scene, 'location');
    assert.equal(state.locationId, 'stepped_barrow');
  });

  it('cycles all 4 Lunar Phases over 12 days, shows Onyx currency, and keeps intro free of spoilers', () => {
    const state = createNewGame({
      name: 'Torin',
      sex: 'male',
      race: 'durnfolk',
      background: 'barrow_stalker',
      skipIntro: false,
      stealthMode: true,
      rngState: 21,
    });

    for (let i = 0; i < 5; i += 1) {
      const beat = getIntroBeat(state, i);
      assertNoParensOrBrackets(beat.body, `intro beat ${i}`);
      assert.equal(/meteoric|philosopher|lunar entity/i.test(beat.body), false);
    }

    processInput(state, 'Skip');
    const hubScreen = renderCurrentScreen(state, []);
    assert.match(hubScreen, /Onyx 14/);
    assert.match(hubScreen, /Waxing Moon/);

    state.player.rations = 20;
    const phasesSeen = new Set<string>([state.clock.lunarPhase]);
    for (let d = 0; d < 12; d += 1) {
      advanceHours(state, 24);
      phasesSeen.add(state.clock.lunarPhase);
    }
    assert.ok(phasesSeen.has('new_moon'));
    assert.ok(phasesSeen.has('waxing_moon'));
    assert.ok(phasesSeen.has('full_moon'));
    assert.ok(phasesSeen.has('waning_moon'));
  });

  it('recovers cleanly via fallbacks on unknown enemy IDs, broken locations, or missing dungeons', () => {
    const state = createNewGame({
      name: 'Bram',
      sex: 'male',
      race: 'vaelorian',
      background: 'ashen_blade',
      skipIntro: true,
      stealthMode: true,
      rngState: 33,
    });

    // Fallback when unknown enemy template requested
    const { combat } = startCombatEncounter(state, { enemyId: 'nonexistent_monster_id', canFlee: true });
    assert.ok(combat.enemies.length === 1);
    assert.equal(combat.enemies[0].templateId, 'root_husk');
    state.combat = null;

    // Fallback when corrupted location scene is rendered
    state.scene = 'location';
    state.locationId = 'nonexistent_place_id';
    const locFallbackScreen = renderCurrentScreen(state, []);
    assert.equal(state.scene, 'camp_hub');
    assert.equal(state.locationId, 'camp_hub');
    assert.match(locFallbackScreen, /Lone Camp/i);

    // Fallback when corrupted dungeon state is queried
    state.scene = 'dungeon';
    state.frontier.activeDungeonId = 'missing_dungeon_id';
    const choices = getSceneChoices(state);
    assert.equal(state.scene, 'camp_hub');
    assert.ok(choices.some((c) => c.label === 'Explore'));

    // Wild camp from camp_hub renders safely
    processInput(state, 'Rest');
    assert.equal(state.scene, 'camp');
    const campScreen = renderCurrentScreen(state, []);
    assert.match(campScreen, /CAMP - LONE CAMP/);
  });

  it('paces multi-beat event cutscenes with Continue before revealing choices', () => {
    const state = createNewGame({
      name: 'Sable',
      sex: 'female',
      race: 'vaelorian',
      background: 'root_scholar',
      skipIntro: true,
      stealthMode: true,
      rngState: 77,
    });

    state.locationId = 'stepped_barrow';
    state.scene = 'event';
    state.activeEvent = { eventId: 'star_glass_obelisk', beatIndex: 0, resolved: false };

    const beat0Screen = renderCurrentScreen(state, []);
    assertNoParensOrBrackets(beat0Screen, 'cutscene beat 0');
    assert.deepEqual(
      getSceneChoices(state).map((c) => c.label),
      ['Continue'],
    );

    processInput(state, 'Continue');
    assert.equal(state.activeEvent?.beatIndex, 1);
    const beat1Screen = renderCurrentScreen(state, []);
    assertNoParensOrBrackets(beat1Screen, 'cutscene beat 1');
    assert.deepEqual(
      getSceneChoices(state).map((c) => c.label),
      ['Continue'],
    );

    processInput(state, 'Continue');
    assert.equal(state.activeEvent?.beatIndex, 2);
    const finalLabels = getSceneChoices(state).map((c) => c.label);
    assert.ok(finalLabels.includes('Trace Notches'));
    assert.ok(finalLabels.includes('Chip Resin'));
  });

  it('always transitions to aftermath after lethal combat victory with Continue', () => {
    const state = createNewGame({
      name: 'Bram',
      sex: 'male',
      race: 'vaelorian',
      background: 'ashen_blade',
      skipIntro: true,
      stealthMode: true,
      rngState: 88,
    });

    startCombatEncounter(state, { enemyId: 'gaunt_wolf', canFlee: true });
    assert.ok(state.combat);
    state.combat.enemies[0].hp = 1;
    executeCombatAction(state, 'strike');
    assert.equal(state.scene, 'aftermath');
    assert.ok(state.aftermath);
    assert.deepEqual(
      getSceneChoices(state).map((c) => c.label),
      ['Continue'],
    );
    const screen = renderCurrentScreen(state, []);
    assertNoParensOrBrackets(screen, 'lethal aftermath screen');
    assert.match(screen, /Silence settles back over the cold stone/);
    processInput(state, 'Continue');
    assert.equal(state.scene, 'camp_hub');
  });

  it('categorizes appearance into semantic visibleTags and drives reactive prose', () => {
    const goblinAnat = buildPlayerAnatomy('female', 'grixi', 'barrow_stalker', {
      height: 'Wiry-Short',
      weight: 'Lean',
      skinColor: 'Soot-Green',
      hairLength: 'Shaved',
      hairStyle: 'Unkempt',
      hairColor: 'Soot Black',
      eyeShape: 'Wide',
      eyeColor: 'Lantern-Yellow',
      musculature: 'Wiry',
      bodyShape: 'Spare',
      facialScars: 'Frost-Burn',
      bodyScars: 'Unmarked',
      distinguishingMark: 'Notched Ears',
    });
    assert.ok(goblinAnat.visibleTags.includes('greenskin'));
    assert.ok(goblinAnat.visibleTags.includes('lantern_eyes'));
    assert.ok(goblinAnat.visibleTags.includes('small_stature'));
    assert.ok(goblinAnat.visibleTags.includes('burn_scarred'));
    assert.ok(goblinAnat.visibleTags.includes('shaved_head'));

    const dwarfAnat = buildPlayerAnatomy('male', 'durnfolk', 'ashen_blade', {
      height: 'Stout',
      weight: 'Burly',
      skinColor: 'Slate-Grey',
      hairLength: 'Long',
      hairStyle: 'Braided',
      hairColor: 'Soot-White',
      eyeShape: 'Deep-Set',
      eyeColor: 'Mist-Grey',
      musculature: 'Broad',
      bodyShape: 'Barrel-Chested',
      facialScars: 'Unmarked',
      bodyScars: 'Unmarked',
      distinguishingMark: 'None',
    });
    assert.ok(dwarfAnat.visibleTags.includes('stone_skin'));
    assert.ok(dwarfAnat.visibleTags.includes('heavy_build'));
    assert.ok(dwarfAnat.visibleTags.includes('long_hair'));
    assert.ok(dwarfAnat.visibleTags.includes('white_hair'));
    assert.ok(dwarfAnat.visibleTags.includes('unmarked_face'));

    const state = createNewGame({
      name: 'Skra',
      sex: 'female',
      race: 'grixi',
      background: 'barrow_stalker',
      anatomy: goblinAnat,
      skipIntro: true,
      stealthMode: true,
      rngState: 91,
    });
    const campScreen = renderCurrentScreen(state, []);
    assert.match(campScreen, /narrow iron-barred drain grate/);
    assert.match(campScreen, /burn-scars/);

    state.locationId = 'imperial_viaduct';
    state.scene = 'event';
    state.activeEvent = { eventId: 'press_gang', beatIndex: 1, resolved: false };
    const gangScreen = renderCurrentScreen(state, []);
    assert.match(gangScreen, /stray woman/);
    assert.match(gangScreen, /greenskin hide/);
  });

  it('applies Southern Past standard array stats and starting scrap', () => {
    const baseState = createNewGame({
      name: 'Kaelen',
      sex: 'male',
      race: 'vaelorian',
      background: 'ashen_blade',
      skipIntro: true,
      stealthMode: true,
      rngState: 12,
    });
    const pastState = createNewGame({
      name: 'Kaelen',
      sex: 'male',
      race: 'vaelorian',
      background: 'ashen_blade',
      southernPast: 'fence_smuggler',
      skipIntro: true,
      stealthMode: true,
      rngState: 12,
    });
    assert.equal(pastState.player.baseStats.wit, baseState.player.baseStats.wit + 2);
    assert.equal(pastState.player.baseStats.agility, baseState.player.baseStats.agility + 1);
    assert.equal(pastState.player.baseStats.might, baseState.player.baseStats.might - 1);
    assert.equal(pastState.player.crowns, baseState.player.crowns + 8);
    assert.ok(pastState.player.inventory.some((i) => i.id === 'iron_wire_kit'));
    const intro0 = getIntroBeat(pastState, 0);
    assert.match(intro0.body, /forged road-writs/);
  });

  it('starts Lv1 with 0 abilities and unlocks racial ability on level-up', () => {
    const state = createNewGame({
      name: 'Nora',
      sex: 'female',
      race: 'ael_thalor',
      background: 'root_scholar',
      skipIntro: true,
      stealthMode: true,
      rngState: 55,
    });
    assert.equal(state.player.abilities.length, 0);
    state.player.xp = state.player.xpToNext;
    startCombatEncounter(state, { enemyId: 'gaunt_wolf', canFlee: true });
    state.combat!.enemies[0].hp = 1;
    const winRes = executeCombatAction(state, 'strike');
    assert.equal(state.player.level, 2);
    assert.ok(state.player.abilities.includes('gloam_weave'));
    assert.ok(winRes.messages.some((m) => m.includes('Learned Silver-Weave')));
  });
});
