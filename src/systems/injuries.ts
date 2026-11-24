import type { GameState, InjuryDef } from '../types.ts';
import { ENEMIES } from '../content/enemies.ts';
import { ITEMS } from '../content/items.ts';
import { adjustFaction, recordChronicle } from '../memory.ts';
import { resolveCheck } from '../dice.ts';
import { advanceHours } from './clock.ts';
import { installBodyMod } from './bodymods.ts';
import { addItemToInventory, consumeInventoryItem } from '../combat.ts';

export const INJURIES: Record<string, InjuryDef> = {
  fractured_ribs: {
    id: 'fractured_ribs',
    name: 'Fractured Ribs',
    severity: 'severe',
    description: 'Sharp bone pain catches every breath and heavy swing.',
    statPenalty: { might: -1 },
    maxHpPenalty: 4,
    healDc: 13,
    scarOnHeal: 'Crooked Rib-Seam',
  },
  torn_tendon: {
    id: 'torn_tendon',
    name: 'Torn Tendon',
    severity: 'severe',
    description: 'A ragged tear behind knee or shoulder slows footwork.',
    statPenalty: { agility: -1 },
    maxStaminaPenalty: 2,
    healDc: 13,
    scarOnHeal: 'Ragged Tendon-Scar',
  },
  deep_laceration: {
    id: 'deep_laceration',
    name: 'Deep Laceration',
    severity: 'minor',
    description: 'An open slash that weeps whenever armor shifts.',
    maxHpPenalty: 3,
    healDc: 11,
    scarOnHeal: 'Jagged Blade-Scar',
  },
  concussion: {
    id: 'concussion',
    name: 'Cracked Crown',
    severity: 'minor',
    description: 'Ringing skull pain blurs concentration and spellcraft.',
    statPenalty: { wit: -1 },
    maxResolvePenalty: 3,
    healDc: 12,
    scarOnHeal: 'Temple Dent',
  },
  spore_burn: {
    id: 'spore_burn',
    name: 'Spore Burn',
    severity: 'severe',
    description: 'Chalky mycelial blisters sear flesh beneath bandages.',
    statPenalty: { grit: -1 },
    maxHpPenalty: 3,
    healDc: 14,
    scarOnHeal: 'Pale Spore-Pits',
  },
  shattered_nerve: {
    id: 'shattered_nerve',
    name: 'Shattered Nerve',
    severity: 'minor',
    description: 'Phantom bell-tones leave hands trembling under threat.',
    maxResolvePenalty: 4,
    healDc: 12,
    scarOnHeal: 'Cold Unblinking Gaze',
  },
};

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
    msgs.push('Your knees buckle into wet ash as darkness rushes in.');
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
        ? 'Ironman claims the fallen. The Gloaming Reach swallows your bones.'
        : p.defilement >= 100
          ? 'Your defiled flesh calcifies where you fall.'
          : 'Too many untreated wounds finally bleed your life into the mud.',
    );
    return msgs;
  }

  state.combat = null;
  state.scene = 'location';
  state.subMenu = 'root';
  p.statuses = [];

  if (leadCategory === 'humanoid') {
    const stolen = Math.floor(p.crowns * 0.45);
    p.crowns -= stolen;
    const injMsg = inflictInjury(state, cause === 'resolve' ? 'shattered_nerve' : 'fractured_ribs');
    p.anatomy.facialScars = 'Boot-Split Brow';
    if (!p.anatomy.visibleTags.includes('scarred_face')) p.anatomy.visibleTags.push('scarred_face');
    msgs.push(
      `Hours later you wake bruised and bound beside a ditch, ${stolen} Crowns lighter and stripped of dignity.`,
    );
    if (injMsg) msgs.push(injMsg);
    msgs.push(...advanceHours(state, 6));
  } else if (leadCategory === 'beast') {
    const lostRations = Math.min(p.rations, 2);
    p.rations -= lostRations;
    const injMsg = inflictInjury(state, 'deep_laceration');
    p.anatomy.bodyScars = 'Maul Scars';
    if (!p.anatomy.visibleTags.includes('battle_worn')) p.anatomy.visibleTags.push('battle_worn');
    msgs.push(
      'Teeth drag you through mire before the predator tears into your pack and leaves you bleeding among broken reeds.',
    );
    if (injMsg) msgs.push(injMsg);
    msgs.push(...advanceHours(state, 5));
  } else if (leadCategory === 'construct') {
    const injMsg = inflictInjury(state, 'concussion');
    msgs.push(
      'A crushing stone blow flings you clear of the chamber threshold; you wake hours later with blood drying in your hair.',
    );
    if (injMsg) msgs.push(injMsg);
    msgs.push(...advanceHours(state, 4));
  } else {
    p.defilement = Math.min(100, p.defilement + 18);
    const injMsg = inflictInjury(state, cause === 'resolve' ? 'shattered_nerve' : 'spore_burn');
    msgs.push(
      'Pale tendrils crawl across your unconscious chest, branding chalky spores deep into your blood before leaving you shivering on the edge of the road.',
    );
    if (injMsg) msgs.push(injMsg);
    if (p.defilement >= 45 && !p.bodyMods.hands) {
      msgs.push(...installBodyMod(state, 'pale_root_hands'));
    } else if (p.defilement >= 65 && !p.bodyMods.skin) {
      msgs.push(...installBodyMod(state, 'chitin_skin'));
    }
    msgs.push(...advanceHours(state, 6));
  }

  if (state.scene !== 'dead') {
    p.hp = Math.max(4, Math.floor(p.maxHp * 0.35));
    p.resolve = Math.max(4, Math.floor(p.maxResolve * 0.5));
    p.stamina = Math.max(2, Math.floor(p.maxStamina * 0.5));
    recordChronicle(
      state,
      'Scarred Survival',
      `Survived brutal defeat at ${state.locationId}, carrying fresh scars onward.`,
      'defeat',
    );
  }

  return msgs;
}

export function getAftermathChoices(state: GameState): Array<{ index: number; id: string; label: string; enabled: boolean }> {
  const after = state.aftermath;
  if (!after) return [];
  const current = after.downedEnemies[after.activeIndex];
  if (!current) {
    return [{ index: 1, id: 'after:done', label: 'Move On', enabled: true }];
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
      state.scene = 'location';
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
    state.scene = state.pendingPerkIds.length > 0 ? 'level_up' : 'location';
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
    const check = resolveCheck(state, 'wit', 11, { label: 'Interrogation' });
    if (check.success) {
      return [
        check.logLine,
        tpl?.interrogateHint ??
          `${current.displayName} gasps out rumors of hidden caches along the old Causeway and the Silken Cistern below Ash-Fen.`,
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
    return [`You sheathe steel and leave ${current.displayName} breathing in the ash.`];
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
