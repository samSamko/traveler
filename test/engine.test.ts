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
import { buildPlayerAnatomy, getAppearanceOptionsFor, getNpcAppearanceReaction } from '../src/writing/anatomy.ts';
import { getHealthConditionLabel } from '../src/writing/appraisal.ts';
import { getIntroBeat } from '../src/writing/intro.ts';
import type { BackgroundId, HeirloomId, RaceId, SexId } from '../src/types.ts';

function assertNoParensOrBrackets(text: string, context: string): void {
  const visible = text.replace(/\x1b\[[0-9;]*m/g, '');
  assert.equal(/[\[\]()]/.test(visible), false, `Found brackets or parentheses in ${context}:\n${visible}`);
}

describe('Writing Framework: Customizer, Compositional Intro & Formatting', () => {
  it('enforces race-bounded appearance palettes, visible reaction tags, and unique skippable intro', () => {
    const elfOpts = getAppearanceOptionsFor('female', 'ael_thalor');
    const grixiOpts = getAppearanceOptionsFor('male', 'grixi');
    assert.ok(elfOpts.skinColor.includes('Moon-Pale'));
    assert.ok(!grixiOpts.skinColor.includes('Moon-Pale'));
    assert.ok(grixiOpts.skinColor.includes('Mossy Olive'));
    assert.ok(elfOpts.bodyShape.includes('Curved'));
    assert.ok(grixiOpts.bodyShape.includes('Broad-Chested'));

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

    assert.ok(customAnatomy.visibleTags.includes('towering'));
    assert.ok(customAnatomy.visibleTags.includes('muscular'));
    assert.ok(customAnatomy.visibleTags.includes('scarred_face'));
    assert.ok(customAnatomy.visibleTags.includes('curvaceous'));
    assert.ok(customAnatomy.visibleTags.includes('kiln_branded'));

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

    // Starts in 4-beat skippable intro
    assert.equal(state.scene, 'intro');
    assert.equal(state.introBeat, 0);
    const beat0Screen = renderCurrentScreen(state, []);
    assertNoParensOrBrackets(beat0Screen, 'intro beat 0');

    // Beat 1 weaves custom anatomy into prose
    processInput(state, 'Continue');
    assert.equal(state.introBeat, 1);
    const beat1 = getIntroBeat(state, 1);
    assert.match(beat1.body, /bronze skin/i);
    assert.match(beat1.body, /cheek slash/i);
    assert.match(beat1.body, /kiln-ember brand/i);

    // Skip jumps straight to Cinderford Keep with first-sight prose
    const skipRes = processInput(state, 'Skip');
    assert.equal(state.scene, 'location');
    assert.match(skipRes.messages.join(' '), /Blackened timber palisades/);

    // NPC appearance reaction reacts to scarred face + corded muscle
    const vaneReaction = getNpcAppearanceReaction(state, 'captain_vane');
    assert.ok(vaneReaction);
    assert.match(vaneReaction, /scar across your face/i);
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
    assertNoParensOrBrackets(rootScreen, 'root location screen');
    assert.match(rootScreen, /1\. Explore\s+2\. Talk/);

    const rootChoices = getSceneChoices(state);
    assert.deepEqual(
      rootChoices.map((c) => c.label),
      ['Explore', 'Talk', 'Trade', 'Rest', 'Pack', 'Journal', 'Travel'],
    );
    for (const c of rootChoices) {
      assert.ok(c.label.split(/\s+/).length <= 2, `Expected 1-2 words, got "${c.label}"`);
    }

    for (const sub of ['explore', 'talk', 'pack', 'pack_craft', 'travel'] as const) {
      state.subMenu = sub;
      const screen = renderCurrentScreen(state, []);
      assertNoParensOrBrackets(screen, `subMenu ${sub}`);
    }
  });
});

describe('Always-Accessible Journal & Discovery System', () => {
  it('renders all 7 Journal tabs cleanly without brackets and preserves prior scene on return', () => {
    const state = createNewGame({
      name: 'Saelis',
      sex: 'female',
      race: 'ael_thalor',
      background: 'root_scholar',
      heirloom: 'kiln_lantern',
      skipIntro: true,
      stealthMode: true,
      rngState: 99,
    });

    // Unmet NPC appears under observable moniker first
    processInput(state, 'Talk');
    const talkChoices = getSceneChoices(state);
    assert.ok(talkChoices.some((c) => c.label === 'Scarred Officer'));
    const meetRes = processInput(state, 'Scarred Officer');
    assert.match(meetRes.messages.join(' '), /sabre slash splits his left eyebrow/i);
    assert.ok(state.discovery.knownNpcs.includes('captain_vane'));

    // Open Journal via command from dialogue
    processInput(state, 'journal');
    assert.equal(state.scene, 'journal');
    assertNoParensOrBrackets(renderCurrentScreen(state, []), 'journal root');

    // Inspect Self (mirrored anatomy), Arts (exact attack rules), People, Places, Items, Chronicle
    for (const tab of ['Self', 'Arts', 'People', 'Places', 'Items', 'Chronicle']) {
      processInput(state, tab);
      const tabScreen = renderCurrentScreen(state, []);
      assertNoParensOrBrackets(tabScreen, `journal tab ${tab}`);
      if (tab === 'Self') {
        assert.match(tabScreen, /Chest and Torso:/);
        assert.match(tabScreen, /Arms and Hands:/);
      }
      if (tab === 'Arts') {
        assert.match(tabScreen, /Gloam-Weave/);
        assert.match(tabScreen, /Wither-Bell/);
        assert.match(tabScreen, /Hits all enemies/);
      }
      processInput(state, 'Back');
    }

    // Back from Journal root returns directly to the prior dialogue
    processInput(state, 'Back');
    assert.equal(state.scene, 'location');
    assert.equal(state.subMenu, 'dialogue');
    assert.equal(state.activeNpcId, 'captain_vane');
  });
});

describe('Combat Qualitative UI, Skill-Check Appraisal & Mid-Combat Journal', () => {
  it('hides raw enemy HP, describes before naming, lets free Observe identify, and allows mid-combat Journal', () => {
    const state = createNewGame({
      name: 'Vael',
      sex: 'female',
      race: 'vaelorian',
      background: 'root_scholar',
      heirloom: 'kiln_lantern',
      skipIntro: true,
      rngState: 1234,
    });
    state.player.xp = 30;

    assert.equal(getHealthConditionLabel(20, 20), 'Unscathed');
    assert.equal(getHealthConditionLabel(10, 20), 'Wounded');
    assert.equal(getHealthConditionLabel(6, 20), 'Bloodied');
    assert.equal(getHealthConditionLabel(1, 20), 'Near Death');

    const { introMessages } = startCombatEncounter(state, {
      enemyIds: ['iron_deserter', 'chitin_weaver'],
      canFlee: true,
    });

    // First-sight prose describes physically before naming
    assert.match(introMessages.join('\n'), /stocky soldier steps into the road/i);
    assert.match(introMessages.join('\n'), /six-legged carapace drops onto the flagstones/i);

    const combatScreen = renderCurrentScreen(state, introMessages);
    assertNoParensOrBrackets(combatScreen, 'combat screen');
    assert.equal(/HP 23\/23/.test(combatScreen), false, 'Combat screen must not expose raw enemy HP numbers');
    assert.match(combatScreen, /Rusted Pike-Man - Unscathed/);

    // Mid-combat Journal check costs 0 turns
    processInput(state, 'Journal');
    assert.equal(state.scene, 'journal');
    processInput(state, 'Arts');
    assert.match(renderCurrentScreen(state, []), /Soul-Dart/);
    processInput(state, 'Back');
    processInput(state, 'Back');
    assert.equal(state.scene, 'combat');
    assert.equal(state.combat?.round, 1);

    // Free Observe opens target sub-menu and does NOT advance round
    executeCombatAction(state, 'observe');
    assert.equal(state.combat?.subMenu, 'target');
    const obsTargets = getCombatMenuOptions(state);
    assert.equal(obsTargets[0].label, 'Rusted Pike-Man');
    const obsRes = executeCombatAction(state, obsTargets[0].id);
    assert.equal(state.combat?.round, 1, 'Observe must not consume combat turn');
    assert.equal(state.combat?.observedUsedThisRound, true);
    assert.ok(obsRes.messages.length > 0);

    // Strike opens target selection sub-menu when 2+ foes live
    executeCombatAction(state, 'strike');
    assert.equal(state.combat?.subMenu, 'target');
    executeCombatAction(state, 'menu:back');
    assert.equal(state.combat?.subMenu, 'root');

    // Spells sub-menu -> Wither-Bell hits BOTH foes at once
    executeCombatAction(state, 'menu:spells');
    const aoeRes = executeCombatAction(state, 'ability:wither_bell');
    assert.equal(state.combat?.subMenu, 'root');
    assert.equal(state.combat?.round, 2);
    assert.equal(state.combat?.observedUsedThisRound, false);
    assert.ok(aoeRes.messages.length >= 2);

    // Finish combat to verify level-up still works
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

describe('Character Creation, World Memory, Crafting & Endings', () => {
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
        skipIntro: true,
        rngState: 42,
      });

      assert.equal(state.player.sex, c.sex);
      assert.equal(state.player.race, c.race);
      assert.ok(state.player.abilities.includes(c.expectedRacialAbility));
      assert.equal(RACES[c.race].racialAbilityId, c.expectedRacialAbility);
      assert.equal(pronouns(c.sex).subj, c.sex === 'female' ? 'she' : 'he');
    }
  });

  it('supports crafting, progressive delving, Kale/Vorne consequences, and Day 15 doom', () => {
    const grixi = createNewGame({
      name: 'Kip',
      sex: 'male',
      race: 'grixi',
      background: 'barrow_stalker',
      heirloom: 'kiln_lantern',
      skipIntro: true,
      rngState: 10,
    });

    addItemToInventory(grixi, 'bog_herb', 1);
    addItemToInventory(grixi, 'ash_resin', 1);
    addItemToInventory(grixi, 'husk_gland', 1);

    processInput(grixi, 'Pack');
    processInput(grixi, 'Craft');
    const craftRes = processInput(grixi, 'Twin Fire-Pots');
    assert.match(craftRes.messages.join(' '), /Crafted Fire-Pot/);

    grixi.subMenu = 'root';
    grixi.locationId = 'weeping_barrow';
    processInput(grixi, 'Explore');
    assert.ok(getSceneChoices(grixi).some((c) => c.label === 'Outer Steps'));
    processInput(grixi, 'Outer Steps');
    processInput(grixi, 'Explore');
    assert.ok(getSceneChoices(grixi).some((c) => c.label === 'Inner Crypt'));

    setFlag(grixi, 'kale_fate', 'redeemed');
    setFlag(grixi, 'vorne_redeemed', true);
    setFlag(grixi, 'seal_of_silence', true);
    setFlag(grixi, 'root_conduit_severed', true);
    setFlag(grixi, 'kiln_cipher_learned', true);
    grixi.subMenu = 'root';
    grixi.locationId = 'sunken_belfry';
    processInput(grixi, 'Explore');
    const res = processInput(grixi, 'Choir Pit');
    assert.equal(grixi.scene, 'combat');
    assert.equal(grixi.combat?.enemies.length, 1);
    assert.match(res.messages.join('\n'), /Kale hurls chain-shot/);

    setFlag(grixi, 'malakor_slain', true);
    grixi.combat = null;
    grixi.scene = 'location';
    const epilogue = synthesizeEpilogue(grixi, 'rekindle_kiln');
    assertNoParensOrBrackets(epilogue, 'epilogue');
    assert.match(epilogue, /Kale the Oath-Breaker: Redeemed/);

    // Verify all events stay 1-2 words & Day 15 triggers doom
    for (const ev of EVENTS) {
      for (const ch of ev.choices) {
        assert.ok(ch.label.split(/\s+/).length <= 2);
        assertNoParensOrBrackets(ch.label, `event ${ev.id}`);
      }
    }
    const doomed = createNewGame({
      name: 'Late',
      sex: 'male',
      race: 'vaelorian',
      background: 'ashen_blade',
      heirloom: 'kiln_lantern',
      skipIntro: true,
      stealthMode: true,
      rngState: 5,
    });
    doomed.day = 14;
    const restRes = processInput(doomed, 'rest');
    assert.equal(doomed.scene, 'dead');
    assert.match(restRes.messages.join(' '), /Third Drowning Toll/);
  });
});

describe('Atomic Save, Permadeath & Meta-Profile Unlocks', () => {
  it('persists anatomy, discovery state, and unlocks heirlooms on run completion', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'traveler-test-'));
    try {
      const state = createNewGame({
        name: 'Kaelen',
        sex: 'male',
        race: 'durnfolk',
        background: 'ashen_blade',
        heirloom: 'kiln_lantern',
        skipIntro: true,
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
      assert.ok(loaded.player.anatomy.skinColor.length > 0);
      assert.ok(loaded.discovery.knownPlaces.includes('cinderford'));
      assert.ok(hasFlag(loaded, 'seal_of_silence'));

      const completion = recordRunCompletion(loaded, 'victory', 'Heir of the First Kiln', tempDir);
      assert.equal(loadGame(tempDir), null);
      assert.ok(completion.newlyUnlocked.includes('orin_bell_shard'));
      assert.ok(completion.newlyUnlocked.includes('star_dew_vial'));
      assert.ok(completion.newlyUnlocked.includes('grixi_chronometer'));

      const meta = loadMetaProfile(tempDir);
      assert.equal(meta.runsPlayed, 1);
      assert.equal(meta.victories, 1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
