import type {
  ActionOutcome,
  FactionId,
  GameState,
  StatName,
  StatusEffect,
} from '../types.ts';
import { adjustFaction, hasFlag, recordChronicle, setFlag } from '../memory.ts';

export interface RuleRuntime {
  resolveCheck: (
    state: GameState,
    stat: StatName,
    dc: number,
    options?: {
      label?: string;
      extraBonus?: number;
      isLoreOrPerception?: boolean;
      isCraftOrStealth?: boolean;
    },
  ) => { success: boolean; logLine: string };
  addItem: (state: GameState, itemId: string, qty: number) => void;
  consumeItem: (state: GameState, itemId: string, qty: number) => boolean;
  renderProse: (template: string, state: GameState) => string;
}

let runtime: RuleRuntime = {
  resolveCheck: () => ({ success: false, logLine: '' }),
  addItem: (state, itemId, qty) => {
    const existing = state.player.inventory.find((e) => e.id === itemId);
    if (existing) existing.qty += qty;
    else state.player.inventory.push({ id: itemId, qty });
  },
  consumeItem: (state, itemId, qty) => {
    const idx = state.player.inventory.findIndex((e) => e.id === itemId);
    if (idx < 0 || state.player.inventory[idx].qty < qty) return false;
    state.player.inventory[idx].qty -= qty;
    if (state.player.inventory[idx].qty <= 0) state.player.inventory.splice(idx, 1);
    return true;
  },
  renderProse: (template) => template,
};

export function registerRuleRuntime(rt: RuleRuntime): void {
  runtime = rt;
}

export interface ConditionSpec {
  sex?: 'male' | 'female';
  race?: string;
  races?: string[];
  notRace?: string;
  background?: string;
  backgrounds?: string[];
  heirloom?: string;
  hasFlag?: string;
  notFlag?: string;
  flagEquals?: { key: string; value: string | number | boolean };
  hasItem?: string;
  hasAbility?: string;
  hasAnyAbility?: string[];
  hasTag?: string;
  minCrowns?: number;
  minRations?: number;
  minTorches?: number;
  minHp?: number;
  minDefilement?: number;
  minFaction?: { faction: FactionId; value: number };
  allOf?: ConditionSpec[];
  anyOf?: ConditionSpec[];
  not?: ConditionSpec;
}

export interface ProseVariant {
  when?: ConditionSpec;
  text: string;
}

export interface EffectSpec {
  messages?: string[];
  conditionalMessages?: Array<{ when: ConditionSpec; messages: string[] }>;
  setFlags?: Record<string, boolean | number | string>;
  adjustFactions?: Partial<Record<FactionId, number>>;
  giveCrowns?: number;
  giveRations?: number;
  giveTorches?: number;
  giveXp?: number;
  giveItems?: Array<{ id: string; qty: number }>;
  consumeItems?: Array<{ id: string; qty: number }>;
  consumeTorchIfNotHeirloomOrAbility?: {
    heirloomId: string;
    abilityId: string;
    onHeirloomMsg: string;
    onTorchMsg: string;
    onDarkDamage: number;
    onDarkMsg: string;
  };
  healHp?: number;
  healFull?: boolean;
  grantMaxHp?: number;
  grantMaxFocus?: number;
  restoreFocus?: number;
  restoreStamina?: number;
  damageHp?: number;
  honeWeapon?: boolean;
  addStatuses?: StatusEffect[];
  recordChronicle?: { title: string; summary: string; tag: string };
  advanceHours?: number;
  advanceDay?: number;
  stayInDialogue?: boolean;
  startCombat?: {
    enemyId?: string;
    enemyIds?: string[];
    canFlee?: boolean;
    onVictoryFlag?: string;
    onVictoryChronicle?: { title: string; summary: string; tag: string };
  };
  triggerEnding?: {
    endingId: 'shatter_belfry' | 'rekindle_kiln' | 'ascend_warden';
    title: string;
    openingText: string;
  };
  check?: {
    stat: StatName;
    dc: number;
    label: string;
    isLoreOrPerception?: boolean;
    isCraftOrStealth?: boolean;
    onSuccess: EffectSpec;
    onFail: EffectSpec;
  };
  branch?: Array<{ when?: ConditionSpec; effect: EffectSpec }>;
  sunkenBelfryEncounter?: boolean;
}

export function evaluateCondition(
  state: GameState,
  cond?: ConditionSpec | null,
): boolean {
  if (!cond) return true;
  const p = state.player;

  if (cond.sex && p.sex !== cond.sex) return false;
  if (cond.race && p.race !== cond.race) return false;
  if (cond.races && !cond.races.includes(p.race)) return false;
  if (cond.notRace && p.race === cond.notRace) return false;
  if (cond.background && p.background !== cond.background) return false;
  if (cond.backgrounds && !cond.backgrounds.includes(p.background)) return false;
  if (cond.heirloom && p.heirloom !== cond.heirloom) return false;
  if (cond.hasFlag && !hasFlag(state, cond.hasFlag)) return false;
  if (cond.notFlag && hasFlag(state, cond.notFlag)) return false;
  if (cond.flagEquals && !hasFlag(state, cond.flagEquals.key, cond.flagEquals.value)) {
    return false;
  }
  if (
    cond.hasItem &&
    !p.inventory.some((e) => e.id === cond.hasItem && e.qty > 0)
  ) {
    return false;
  }
  if (cond.hasAbility && !p.abilities.includes(cond.hasAbility)) return false;
  if (
    cond.hasAnyAbility &&
    !cond.hasAnyAbility.some((ab) => p.abilities.includes(ab))
  ) {
    return false;
  }
  if (cond.hasTag && !p.anatomy.visibleTags.includes(cond.hasTag)) return false;
  if (cond.minCrowns !== undefined && p.crowns < cond.minCrowns) return false;
  if (cond.minRations !== undefined && p.rations < cond.minRations) return false;
  if (cond.minTorches !== undefined && p.torches < cond.minTorches) return false;
  if (cond.minHp !== undefined && p.hp < cond.minHp) return false;
  if (cond.minDefilement !== undefined && p.defilement < cond.minDefilement) return false;
  if (
    cond.minFaction &&
    (state.memory.factions[cond.minFaction.faction] ?? 0) < cond.minFaction.value
  ) {
    return false;
  }
  if (cond.allOf && !cond.allOf.every((c) => evaluateCondition(state, c))) return false;
  if (cond.anyOf && !cond.anyOf.some((c) => evaluateCondition(state, c))) return false;
  if (cond.not && evaluateCondition(state, cond.not)) return false;

  return true;
}

export function selectProseVariant(
  state: GameState,
  variants: ProseVariant[],
): string {
  for (const v of variants) {
    if (evaluateCondition(state, v.when)) {
      return runtime.renderProse(v.text, state);
    }
  }
  return '';
}

export function executeEffect(state: GameState, spec: EffectSpec): ActionOutcome {
  if (spec.sunkenBelfryEncounter) {
    return resolveSunkenBelfryEncounter(state);
  }

  const msgs: string[] = [];
  const outcome: ActionOutcome = { messages: msgs };
  const p = state.player;

  if (spec.messages) {
    for (const m of spec.messages) {
      msgs.push(runtime.renderProse(m, state));
    }
  }

  if (spec.conditionalMessages) {
    for (const cm of spec.conditionalMessages) {
      if (evaluateCondition(state, cm.when)) {
        for (const m of cm.messages) {
          msgs.push(runtime.renderProse(m, state));
        }
      }
    }
  }

  if (spec.consumeTorchIfNotHeirloomOrAbility) {
    const t = spec.consumeTorchIfNotHeirloomOrAbility;
    if (p.heirloom === t.heirloomId || p.abilities.includes(t.abilityId)) {
      msgs.push(runtime.renderProse(t.onHeirloomMsg, state));
    } else if (p.torches > 0) {
      p.torches -= 1;
      msgs.push(runtime.renderProse(t.onTorchMsg, state));
    } else {
      p.hp = Math.max(1, p.hp - t.onDarkDamage);
      msgs.push(runtime.renderProse(t.onDarkMsg, state));
    }
  }

  if (spec.setFlags) {
    for (const [k, v] of Object.entries(spec.setFlags)) {
      setFlag(state, k, v);
    }
  }
  if (spec.adjustFactions) {
    for (const [f, delta] of Object.entries(spec.adjustFactions)) {
      if (typeof delta === 'number') {
        adjustFaction(state, f as FactionId, delta);
      }
    }
  }
  if (spec.giveCrowns) p.crowns = Math.max(0, p.crowns + spec.giveCrowns);
  if (spec.giveRations) p.rations = Math.max(0, p.rations + spec.giveRations);
  if (spec.giveTorches) p.torches = Math.max(0, p.torches + spec.giveTorches);
  if (spec.giveXp) p.xp += spec.giveXp;

  if (spec.consumeItems) {
    for (const item of spec.consumeItems) {
      runtime.consumeItem(state, item.id, item.qty);
    }
  }
  if (spec.giveItems) {
    for (const item of spec.giveItems) {
      runtime.addItem(state, item.id, item.qty);
    }
  }

  if (spec.grantMaxHp) {
    p.maxHp += spec.grantMaxHp;
    p.hp += spec.grantMaxHp;
  }
  if (spec.grantMaxFocus) {
    p.maxFocus += spec.grantMaxFocus;
    p.focus += spec.grantMaxFocus;
  }
  if (spec.healFull) {
    p.hp = p.maxHp;
    p.stamina = p.maxStamina;
    p.focus = p.maxFocus;
    p.resolve = p.maxResolve;
    p.statuses = [];
  } else {
    if (spec.healHp) p.hp = Math.min(p.maxHp, p.hp + spec.healHp);
    if (spec.restoreFocus) p.focus = Math.min(p.maxFocus, p.focus + spec.restoreFocus);
    if (spec.restoreStamina) p.stamina = Math.min(p.maxStamina, p.stamina + spec.restoreStamina);
  }
  if (spec.damageHp) {
    p.hp = Math.max(1, p.hp - spec.damageHp);
  }
  if (spec.honeWeapon) {
    p.weaponHoned = true;
  }
  if (spec.addStatuses) {
    for (const st of spec.addStatuses) {
      p.statuses.push({ ...st });
    }
  }
  if (spec.recordChronicle) {
    recordChronicle(
      state,
      spec.recordChronicle.title,
      spec.recordChronicle.summary,
      spec.recordChronicle.tag,
    );
  }

  if (spec.advanceHours) outcome.advanceHours = spec.advanceHours;
  if (spec.advanceDay) outcome.advanceDay = spec.advanceDay;
  if (spec.stayInDialogue) outcome.stayInDialogue = true;
  if (spec.startCombat) outcome.startCombat = spec.startCombat;
  if (spec.triggerEnding) outcome.triggerEnding = spec.triggerEnding;

  if (spec.branch) {
    for (const b of spec.branch) {
      if (evaluateCondition(state, b.when)) {
        const sub = executeEffect(state, b.effect);
        msgs.push(...sub.messages);
        if (sub.startCombat) outcome.startCombat = sub.startCombat;
        if (sub.triggerEnding) outcome.triggerEnding = sub.triggerEnding;
        if (sub.advanceHours) outcome.advanceHours = sub.advanceHours;
        if (sub.advanceDay) outcome.advanceDay = sub.advanceDay;
        if (sub.stayInDialogue) outcome.stayInDialogue = true;
        break;
      }
    }
  }

  if (spec.check) {
    const res = runtime.resolveCheck(state, spec.check.stat, spec.check.dc, {
      label: spec.check.label,
      isLoreOrPerception: spec.check.isLoreOrPerception,
      isCraftOrStealth: spec.check.isCraftOrStealth,
    });
    msgs.push(res.logLine);
    const sub = executeEffect(state, res.success ? spec.check.onSuccess : spec.check.onFail);
    msgs.push(...sub.messages);
    if (sub.startCombat) outcome.startCombat = sub.startCombat;
    if (sub.triggerEnding) outcome.triggerEnding = sub.triggerEnding;
    if (sub.advanceHours) outcome.advanceHours = sub.advanceHours;
    if (sub.advanceDay) outcome.advanceDay = sub.advanceDay;
    if (sub.stayInDialogue) outcome.stayInDialogue = true;
  }

  return outcome;
}

function resolveSunkenBelfryEncounter(state: GameState): ActionOutcome {
  const brokenSeals: string[] = [];
  const msgs: string[] = [
    'You descend onto the cracked bronze dais. Above you, the great drowned bell trembles with gathered air.',
  ];
  let preDamageRatio = 0;
  let thrallCleared = false;

  if (hasFlag(state, 'kale_fate', 'redeemed')) {
    preDamageRatio += 0.2;
    thrallCleared = true;
    msgs.push(
      "A shout echoes from the upper gallery as Kale hurls chain-shot into the choir pillars, cutting down Malakor's acolyte guard.",
    );
  }
  if (hasFlag(state, 'vorne_redeemed')) {
    preDamageRatio += 0.15;
    thrallCleared = true;
    msgs.push(
      'Heavy bronze footsteps thunder beside you as Sir Vorne charges into the pale choir, breaking their outer guard.',
    );
  }
  if (hasFlag(state, 'seal_of_silence')) {
    brokenSeals.push('seal_of_silence');
    msgs.push('Your Seal of Silence hums against the air, dampening the bell.');
  }
  if (hasFlag(state, 'root_conduit_severed')) {
    brokenSeals.push('root_conduit_severed');
    msgs.push("With the deep Root Conduit severed, Malakor's bark-shield crumbles.");
  }
  if (hasFlag(state, 'kiln_cipher_learned')) {
    brokenSeals.push('kiln_cipher_learned');
    preDamageRatio += 0.12;
    msgs.push("Speaking the First Kiln Cipher sears Malakor's throne with pale fire.");
  }

  return {
    messages: msgs,
    startCombat: {
      enemyIds: thrallCleared ? ['malakor'] : ['malakor', 'blight_acolyte'],
      canFlee: false,
      preDamageRatio: Math.min(0.55, preDamageRatio),
      brokenSeals,
      onVictoryFlag: 'malakor_slain',
      onVictoryChronicle: {
        title: 'Slew Malakor',
        summary: 'Defeated the Choir-Husk beneath the Sunken Belfry.',
        tag: 'boss',
      },
    },
  };
}
