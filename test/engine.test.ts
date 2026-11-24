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
import type { BackgroundId, HeirloomId, RaceId, SexId } from '../src/types.ts';

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
      distinguishingMark: 'Kiln-Ember Brand',
    });

    const state = createNewGame({
      name: 'Valeria',
      sex: 'female',
      race: 'vaelorian',
      background: 'ashen_blade',
      heirloom: 'kiln_lantern',
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
    assert.match(templated, /ash-rain beads on Valeria's bronze skin at morning/);
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
      heirloom: 'kiln_lantern',
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
      heirloom: 'kiln_lantern',
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
    state.locationId = 'cinderford';
    state.scene = 'location';
    const failCamp = processInput(state, 'camp');
    assert.match(failCamp.messages.join(' '), /town walls/);

    // Move to wild area -> Camp state opens cleanly
    state.locationId = 'kings_causeway';
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
      heirloom: 'kiln_lantern',
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
      heirloom: 'kiln_lantern',
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
    assert.match(spareRes.messages.join(' '), /breathing in the ash/);
    assert.equal(state.scene, 'camp_hub');

    // Scarred Survival player defeat inflicts injury & scar instead of game over
    startCombatEncounter(state, { enemyId: 'iron_deserter', canFlee: true });
    state.player.crowns = 40;
    const defMsgs = resolvePlayerDefeat(state, 'hp');
    assert.equal(state.scene, 'camp_hub');
    assert.ok(state.player.injuries.length >= 1);
    assert.ok(state.player.crowns < 40);
    assert.match(defMsgs.join(' '), /Fractured Ribs/);

    // Ironman mode defeat kills immediately
    const ironman = createNewGame({
      name: 'Grim',
      sex: 'male',
      race: 'vaelorian',
      background: 'ashen_blade',
      heirloom: 'kiln_lantern',
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
      heirloom: 'kiln_lantern',
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
    assert.match(artsScreen, /Resonant/);
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

      const completion = recordRunCompletion(loaded, 'victory', 'Heir of the First Kiln', tempDir);
      assert.equal(loadGame(tempDir), null);
      assert.ok(completion.newlyUnlocked.includes('grixi_chronometer'));
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
    assert.equal(placeCount.cnt, 13);
    assert.equal(eventCount.cnt, 18);

    const state = createNewGame({
      name: 'Kael',
      sex: 'male',
      race: 'grixi',
      background: 'barrow_stalker',
      heirloom: 'grixi_chronometer',
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
      heirloom: 'kiln_lantern',
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
      heirloom: 'grixi_chronometer',
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
    state.locationId = 'kings_causeway';
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
      heirloom: 'kiln_lantern',
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
    if (state.scene === 'combat') {
      state.combat = null;
      state.scene = 'camp_hub';
    } else if (state.scene === 'shop') {
      processInput(state, 'Leave');
    }
    assert.equal(state.scene, 'camp_hub');

    // Unlock Cinderford Town -> verify NO Explore action inside town
    state.frontier.unlockedTowns.push('cinderford');
    processInput(state, 'Travel');
    processInput(state, 'Cinderford Keep');
    assert.equal(state.scene, 'location');
    assert.equal(state.locationId, 'cinderford');
    const townLabels = getSceneChoices(state).map((c) => c.label);
    assert.equal(townLabels.includes('Explore'), false);
    assert.ok(townLabels.includes('Talk'));
    assert.ok(townLabels.includes('Return'));

    // Return to Camp, Travel to Weeping Barrow (Area), toggle Sub-Area, Enter Dungeon
    processInput(state, 'Return');
    assert.equal(state.scene, 'camp_hub');
    state.frontier.unlockedAreas.push('weeping_barrow');
    state.frontier.unlockedSubAreas.push('barrow_crypt_ledge');
    state.frontier.unlockedDungeons.push('barrow_undercroft');

    processInput(state, 'Travel');
    processInput(state, 'Weeping Barrow');
    if (state.scene === 'combat') {
      state.combat = null;
      state.scene = 'location';
    }
    assert.equal(state.scene, 'location');
    const areaLabels = getSceneChoices(state).map((c) => c.label);
    assert.ok(areaLabels.includes('Explore'));
    assert.ok(areaLabels.includes('Sub-Area'));
    assert.ok(areaLabels.includes('Dungeon'));

    // Toggle Sub-Area
    processInput(state, 'Sub-Area');
    assert.equal(state.frontier.activeSubArea.weeping_barrow, 'barrow_crypt_ledge');

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

    // Backtrack South -> West -> Leave back to Weeping Barrow
    processInput(state, 'South');
    processInput(state, 'West');
    processInput(state, 'Leave');
    assert.equal(state.scene, 'location');
    assert.equal(state.locationId, 'weeping_barrow');
  });
});
