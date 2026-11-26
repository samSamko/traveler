import type { GameState, InjuryDef } from '../types.ts';
import { ENEMIES } from '../content/enemies.ts';
import { ITEMS } from '../content/items.ts';
import { adjustFaction, recordChronicle } from '../memory.ts';
import { resolveCheck } from '../dice.ts';
import { advanceHours } from './clock.ts';
import { installBodyMod } from './bodymods.ts';
import { addItemToInventory, consumeInventoryItem } from '../combat.ts';
import { loadWorldDatabase } from '../db/loader.ts';
import { renderProse } from '../writing/prose.ts';

export const INJURIES: Record<string, InjuryDef> = loadWorldDatabase().injuries;

export function inflictInjury(state: GameState, injuryId: string): string | null {
  const inj = INJURIES[injuryId];
  if (!inj) return null;
  const p = state.player;
  if (p.injuries.includes(injuryId)) return null;

  p.injuries.push(injuryId);
  if (inj.maxHpPenalty) {
    p.maxHp = Math.max(10, p.maxHp - inj.maxHpPenalty);
    p.hp = Math.min(p.hp, p.maxHp);
  }
  if (inj.maxStaminaPenalty) {
    p.maxStamina = Math.max(4, p.maxStamina - inj.maxStaminaPenalty);
    p.stamina = Math.min(p.stamina, p.maxStamina);
  }
  if (inj.maxResolvePenalty) {
    p.maxResolve = Math.max(6, p.maxResolve - inj.maxResolvePenalty);
    p.resolve = Math.min(p.resolve, p.maxResolve);
  }
  return `Sustained lasting injury: ${inj.name}. ${inj.description}`;
}

export function tendInjury(
  state: GameState,
  injuryId?: string,
  usePoultice = false,
): string[] {
  const p = state.player;
  const targetId = injuryId ?? p.injuries[0];
  if (!targetId || !INJURIES[targetId]) {
    return ['No lasting injuries require binding.'];
  }
  const inj = INJURIES[targetId];

  if (usePoultice) {
    if (!consumeInventoryItem(state, 'poultice', 1)) {
      return ['No Herb Poultice in pack.'];
    }
  } else {
    const check = resolveCheck(state, 'wit', inj.healDc, {
      label: 'Field Tending',
      isCraftOrStealth: true,
    });
    if (!check.success) {
      return [check.logLine, `${inj.name} refuses to close cleanly without herbs or steadier hands.`];
    }
  }

  p.injuries = p.injuries.filter((id) => id !== targetId);
  if (inj.maxHpPenalty) p.maxHp += inj.maxHpPenalty;
  if (inj.maxStaminaPenalty) p.maxStamina += inj.maxStaminaPenalty;
  if (inj.maxResolvePenalty) p.maxResolve += inj.maxResolvePenalty;

  p.anatomy.bodyScars = inj.scarOnHeal;
  if (!p.anatomy.visibleTags.includes('battle_worn')) {
    p.anatomy.visibleTags.push('battle_worn');
  }

  return [
    `Tended ${inj.name}. The wound knits shut, leaving ${inj.scarOnHeal.toLowerCase()} across your body.`,
  ];
}

export function resolvePlayerDefeat(
  state: GameState,
  cause: 'hp' | 'resolve',
): string[] {
  const p = state.player;
  const combat = state.combat;
  const leadCategory = combat?.enemies.find((e) => e.hp > 0)?.category ?? 'husk';
  const msgs: string[] = [];

  if (cause === 'resolve') {
    msgs.push('Your resolve shatters beneath the weight of the encounter.');
  } else {
    msgs.push('Your knees buckle into freezing slush as darkness rushes in.');
  }

  const fatalLoad =
    state.survivalMode === 'ironman' ||
    p.injuries.length >= 3 ||
    p.defilement >= 100;

  if (fatalLoad) {
    state.combat = null;
    state.scene = 'dead';
    msgs.push(
      state.survivalMode === 'ironman'
        ? 'Ironman claims the fallen. The northern frost swallows your bones.'
        : p.defilement >= 100
          ? 'Your defiled flesh calcifies where you fall.'
          : 'Too many untreated wounds finally bleed your life into the mud.',
    );
    return msgs;
  }

  state.combat = null;
  if (state.frontier) {
    state.frontier.activeDungeonId = null;
  }
  const defeatLoc = state.locationId;
  state.scene = 'defeat';
  state.subMenu = 'root';
  p.statuses = [];

  const summaryNotes: string[] = [];
  let beat1 = '';
  let beat2 = '';

  if (leadCategory === 'humanoid') {
    const stolen = Math.floor(p.crowns * 0.45);
    p.crowns -= stolen;
    const injMsg = inflictInjury(state, cause === 'resolve' ? 'shattered_nerve' : 'fractured_ribs');
    p.anatomy.facialScars = 'Boot-Split Brow';
    if (!p.anatomy.visibleTags.includes('scarred_face')) p.anatomy.visibleTags.push('scarred_face');
    beat1 = renderProse(
      'Your knees buckle into freezing slush as darkness rushes in. Before your eyes roll shut, iron-shod boots slam into your ribs to make sure you stay down.\n\nRough hands wrench your pack straps loose, dumping oilcloth and {weapon} aside into the slush.{if:female} Someone yanks your {hair} hair back to spit a sneer in your face before kicking your jaw sideways.{/if}{if:greenskin} A boot heel grinds across your {skin} cheek while someone laughs about goblin pelts.{/if}',
      state,
    );
    beat2 = renderProse(
      `Hours later you wake shivering and half-bound in a freezing ditch, dried blood crusted across a boot-split brow and ${stolen} Onyx lighter.{if:towering} Even your tall frame aches from being dragged across sharp gravel.{/if}\n\nYou saw your stiff wrists free against a jagged stone edge while sleet needles raw skin.`,
      state,
    );
    summaryNotes.push(`Lost ${stolen} Onyx to your captors.`);
    if (injMsg) summaryNotes.push(injMsg);
    summaryNotes.push(...advanceHours(state, 6));
  } else if (leadCategory === 'orc_kin') {
    const stolen = Math.floor(p.crowns * 0.35);
    const lostRations = Math.min(p.rations, 1);
    p.crowns -= stolen;
    p.rations -= lostRations;
    const injMsg = inflictInjury(state, 'deep_laceration');
    p.anatomy.bodyScars = 'Cleaver Welts';
    if (!p.anatomy.visibleTags.includes('battle_worn')) p.anatomy.visibleTags.push('battle_worn');
    beat1 = renderProse(
      'A heavy blow drops you face-first into gravel. Foul, rancid breath washes over your neck as heavy tusked brutes stomp your shoulders flat and tear open your ration pouch.\n\nOnly a distant howl draws the pack off your back before they crack your skull for marrow.',
      state,
    );
    beat2 = renderProse(
      `You come to groaning beneath a broken wall, ${lostRations} Ration and ${stolen} Onyx gone, with fresh cleaver-welts stiffening across your ribs.\n\nCold air burns raw along torn wool as you bind the worst gashes with dirty linen.`,
      state,
    );
    summaryNotes.push(`Lost ${stolen} Onyx and ${lostRations} Ration.`);
    if (injMsg) summaryNotes.push(injMsg);
    summaryNotes.push(...advanceHours(state, 6));
  } else if (leadCategory === 'beast' || leadCategory === 'animal') {
    const lostRations = Math.min(p.rations, 2);
    p.rations -= lostRations;
    const injMsg = inflictInjury(state, 'deep_laceration');
    p.anatomy.bodyScars = 'Maul Scars';
    if (!p.anatomy.visibleTags.includes('battle_worn')) p.anatomy.visibleTags.push('battle_worn');
    beat1 = renderProse(
      'Teeth clamp hard into your shoulder and drag you ten paces through freezing mud before your {armor} tears loose.\n\nYou curl tight over your throat while claws shred your pack straps and jaws snap at your rations.',
      state,
    );
    beat2 = renderProse(
      `When your eyes finally open under flat grey sky, the predator is gone with ${lostRations} Ration torn from your oilcloth.\n\nDark blood freezes stiff inside your sleeves while sharp pain pulses across fresh maul scars.`,
      state,
    );
    summaryNotes.push(`Lost ${lostRations} Ration torn from your pack.`);
    if (injMsg) summaryNotes.push(injMsg);
    summaryNotes.push(...advanceHours(state, 5));
  } else if (leadCategory === 'construct') {
    const injMsg = inflictInjury(state, 'concussion');
    beat1 = renderProse(
      'A crushing bronze blow flings your {build} frame clear across the stone threshold, knocking every ounce of air out of your lungs.\n\nHeavy clockwork footsteps grind back to their post, leaving you sprawled motionless in cold dust.',
      state,
    );
    beat2 = renderProse(
      'Hours later your vision swims back in painful double-images, dried blood matting your hair above one ear.\n\nEvery heartbeat hammers behind your eyes as you haul yourself upright against the cold wall.',
      state,
    );
    if (injMsg) summaryNotes.push(injMsg);
    summaryNotes.push(...advanceHours(state, 4));
  } else {
    p.defilement = Math.min(100, p.defilement + 18);
    const injMsg = inflictInjury(state, cause === 'resolve' ? 'shattered_nerve' : 'spore_burn');
    beat1 = renderProse(
      'Your limbs go dead-cold as frost and chalky rot close over your chest. Pale, unblinking silhouettes stand over you in silence without raising another blow.\n\nNumbness creeps straight under your {skin} skin while cold dust settles across your lips.',
      state,
    );
    beat2 = renderProse(
      'You wake trembling violently on the edge of the trail, teeth chattering against a bitter metallic taste in your throat.\n\nDark veins pulse faintly beneath your collar where the northern cold sank deep.',
      state,
    );
    summaryNotes.push(`Defilement rose to ${p.defilement}/100.`);
    if (injMsg) summaryNotes.push(injMsg);
    if (p.defilement >= 45 && !p.bodyMods.hands) {
      summaryNotes.push(...installBodyMod(state, 'pale_root_hands'));
    } else if (p.defilement >= 65 && !p.bodyMods.skin) {
      summaryNotes.push(...installBodyMod(state, 'chitin_skin'));
    }
    summaryNotes.push(...advanceHours(state, 6));
  }

  const beat3 = renderProse(
    'Limping mile after freezing mile with {weapon} slung crooked at your hip, you drag your bruised body back toward the banked coals of your Lone Camp before nightfall.',
    state,
  );

  p.hp = Math.max(4, Math.floor(p.maxHp * 0.35));
  p.resolve = Math.max(4, Math.floor(p.maxResolve * 0.5));
  p.stamina = Math.max(2, Math.floor(p.maxStamina * 0.5));
  recordChronicle(
    state,
    'Scarred Survival',
    `Survived brutal defeat at ${defeatLoc}, carrying fresh scars onward.`,
    'defeat',
  );

  state.defeatState = {
    beatIndex: 0,
    beats: [beat1, beat2, beat3],
    summaryNotes,
  };

  return msgs;
}

export function getAftermathChoices(state: GameState): Array<{ index: number; id: string; label: string; enabled: boolean }> {
  const after = state.aftermath;
  if (!after) return [];
  const current = after.downedEnemies[after.activeIndex];
  if (!current) {
    return [{ index: 1, id: 'after:done', label: 'Continue', enabled: true }];
  }

  const opts: Array<{ index: number; id: string; label: string; enabled: boolean }> = [];
  if (!current.stripped) {
    opts.push({ index: opts.length + 1, id: 'after:strip', label: 'Strip', enabled: true });
  }
  if (current.category === 'humanoid' && !current.questioned) {
    opts.push({ index: opts.length + 1, id: 'after:question', label: 'Question', enabled: true });
  }
  opts.push({ index: opts.length + 1, id: 'after:execute', label: 'Execute', enabled: true });
  opts.push({ index: opts.length + 1, id: 'after:spare', label: 'Spare', enabled: true });
  if (current.category !== 'humanoid') {
    opts.push({ index: opts.length + 1, id: 'after:harvest', label: 'Harvest', enabled: true });
  }
  return opts;
}

function advanceAftermathQueue(state: GameState): void {
  const after = state.aftermath;
  if (!after) return;
  const nextIdx = after.downedEnemies.findIndex((d) => !d.resolved);
  if (nextIdx >= 0) {
    after.activeIndex = nextIdx;
  } else {
    state.aftermath = null;
    if (state.pendingPerkIds.length > 0) {
      state.scene = 'level_up';
    } else {
      state.scene = state.frontier?.activeDungeonId
        ? 'dungeon'
        : state.locationId === 'camp_hub'
          ? 'camp_hub'
          : 'location';
      state.subMenu = 'root';
    }
  }
}

export function executeAftermathAction(state: GameState, actionId: string): string[] {
  const after = state.aftermath;
  if (!after) return [];
  const current = after.downedEnemies[after.activeIndex];
  if (!current || actionId === 'after:done') {
    state.aftermath = null;
    state.scene =
      state.pendingPerkIds.length > 0
        ? 'level_up'
        : state.frontier?.activeDungeonId
          ? 'dungeon'
          : state.locationId === 'camp_hub'
            ? 'camp_hub'
            : 'location';
    return [];
  }

  const tpl = ENEMIES[current.templateId];

  if (actionId === 'after:strip') {
    current.stripped = true;
    const bonusCoins = 6 + Math.floor((tpl?.crownReward[0] ?? 6) * 0.5);
    state.player.crowns += bonusCoins;
    return [
      `You strip ${current.displayName} clean of belt-silver and loose trinkets, claiming ${bonusCoins} Crowns.`,
    ];
  }

  if (actionId === 'after:question') {
    current.questioned = true;
    const bonus =
      state.player.anatomy.visibleTags.includes('scarred_face') ||
      state.player.anatomy.visibleTags.includes('towering')
        ? 1
        : 0;
    const check = resolveCheck(state, 'wit', 11, { label: 'Interrogation', extraBonus: bonus });
    if (check.success) {
      const reaction =
        state.player.race === 'grixi' || state.player.anatomy.visibleTags.includes('greenskin')
          ? 'Eyes wide at your sharp teeth, '
          : state.player.sex === 'female'
            ? 'Spitting red froth at your boots, '
            : '';
      return [
        check.logLine,
        `${reaction}${
          tpl?.interrogateHint ??
          `${current.displayName} gasps out rumors of hidden caches along the High Road and the Old Bathhouse below Salt Bog.`
        }`,
      ];
    }
    return [check.logLine, `${current.displayName} spits blood and refuses to speak.`];
  }

  if (actionId === 'after:execute') {
    current.resolved = true;
    state.player.defilement = Math.min(100, state.player.defilement + 2);
    if (current.category === 'humanoid') {
      adjustFaction(state, 'iron_vow', 1);
    }
    recordChronicle(
      state,
      `Executed ${current.displayName}`,
      'Ended a downed foe cleanly on the wet stone.',
      'aftermath',
    );
    advanceAftermathQueue(state);
    return [`One cold downward stroke finishes ${current.displayName} where it lies.`];
  }

  if (actionId === 'after:spare') {
    current.resolved = true;
    state.player.resolve = Math.min(state.player.maxResolve, state.player.resolve + 2);
    if (current.category === 'humanoid') {
      adjustFaction(state, 'silken_cistern', 1);
    }
    recordChronicle(
      state,
      `Spared ${current.displayName}`,
      'Left a beaten foe alive on the frontier trail.',
      'aftermath',
    );
    advanceAftermathQueue(state);
    return [`You sheathe steel and leave ${current.displayName} breathing in the slush.`];
  }

  if (actionId === 'after:harvest') {
    current.resolved = true;
    const harvestedId = tpl?.harvestItemId ?? 'husk_gland';
    addItemToInventory(state, harvestedId, 1);
    state.player.defilement = Math.min(100, state.player.defilement + 4);
    const msgs = [
      `You carve out ${ITEMS[harvestedId]?.name ?? harvestedId} while the body is still warm.`,
    ];
    advanceAftermathQueue(state);
    return msgs;
  }

  return ['Unknown aftermath action.'];
}
