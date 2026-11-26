import type { GameState, RollMode, StatName } from './types.ts';
import { ITEMS } from './content/items.ts';
import { PERKS } from './content/characters.ts';
import { BODY_MODS } from './systems/bodymods.ts';
import { INJURIES } from './systems/injuries.ts';

export function nextRandom(state?: GameState): number {
  if (state && typeof state.rngState === 'number') {
    let t = (state.rngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return Math.random();
}

export function rollDie(sides: number, state?: GameState): number {
  return Math.floor(nextRandom(state) * sides) + 1;
}

export function rollDice(count: number, sides: number, state?: GameState): number {
  let sum = 0;
  for (let i = 0; i < count; i += 1) {
    sum += rollDie(sides, state);
  }
  return sum;
}

export function getEffectiveStat(state: GameState, stat: StatName): number {
  const p = state.player;
  let total = p.baseStats[stat];

  for (const itemId of Object.values(p.equipment)) {
    const item = itemId ? ITEMS[itemId] : undefined;
    if (item?.statBonus?.[stat]) {
      total += item.statBonus[stat] ?? 0;
    }
  }

  for (const perkId of p.perks) {
    const perk = PERKS[perkId];
    if (perk?.statBonus?.[stat]) {
      total += perk.statBonus[stat] ?? 0;
    }
  }

  for (const modId of Object.values(p.bodyMods)) {
    const mod = modId ? BODY_MODS[modId] : undefined;
    if (mod?.statMods?.[stat]) {
      total += mod.statMods[stat] ?? 0;
    }
  }

  for (const injId of p.injuries) {
    const inj = INJURIES[injId];
    if (inj?.statPenalty?.[stat]) {
      total += inj.statPenalty[stat] ?? 0;
    }
  }

  return total;
}

export function rollD20WithMode(
  mode: RollMode,
  state?: GameState,
): { roll: number; rolls: [number] | [number, number] } {
  const first = rollDie(20, state);
  if (mode === 'normal') {
    return { roll: first, rolls: [first] };
  }
  const second = rollDie(20, state);
  return {
    roll: mode === 'edge' ? Math.max(first, second) : Math.min(first, second),
    rolls: [first, second],
  };
}

export interface CheckResult {
  success: boolean;
  naturalRoll: number;
  rollMode: RollMode;
  statMod: number;
  traitBonus: number;
  total: number;
  dc: number;
  logLine: string;
}

export function resolveCheck(
  state: GameState,
  stat: StatName,
  dc: number,
  options?: {
    label?: string;
    extraBonus?: number;
    mode?: RollMode;
    isLoreOrPerception?: boolean;
    isCraftOrStealth?: boolean;
  },
): CheckResult {
  const p = state.player;
  const hasEdge =
    options?.mode === 'edge' || p.statuses.some((s) => s.type === 'blessed');
  const hasBurden =
    options?.mode === 'burden' ||
    p.statuses.some((s) => s.type === 'dazed' || s.type === 'staggered') ||
    (Boolean(options?.isLoreOrPerception) && state.clock?.weather === 'spore_fog');

  const rollMode: RollMode =
    hasEdge && hasBurden ? 'normal' : hasEdge ? 'edge' : hasBurden ? 'burden' : 'normal';

  let { roll } = rollD20WithMode(rollMode, state);
  const statMod = getEffectiveStat(state, stat);
  let traitBonus = options?.extraBonus ?? 0;

  if (p.race === 'vaelorian' && p.hp <= Math.floor(p.maxHp / 2)) {
    traitBonus += 2;
  }
  if (p.race === 'ael_thalor' && options?.isLoreOrPerception) {
    traitBonus += 2;
  }
  if (p.race === 'grixi' && options?.isCraftOrStealth) {
    traitBonus += 2;
  }

  const blessed = p.statuses.find((s) => s.type === 'blessed');
  if (blessed) {
    traitBonus += blessed.power;
  }

  let total = roll + statMod + traitBonus;

  let rerolled = false;
  if (total < dc && p.race === 'vaelorian' && p.determinationAvailable && roll < 14) {
    const second = rollDie(20, state);
    if (second > roll) {
      roll = second;
      total = roll + statMod + traitBonus;
      p.determinationAvailable = false;
      rerolled = true;
    }
  }

  const success = roll === 20 || (roll !== 1 && total >= dc);
  const actionLabel = options?.label ? `${options.label}: ` : '';
  const modeNote =
    rollMode === 'edge' ? 'With Edge, ' : rollMode === 'burden' ? 'Under Burden, ' : '';
  const rerollProse = rerolled ? 'Stubborn will pulls you through at the brink. ' : '';
  const outcomeProse = success
    ? `${rerollProse}${modeNote}${actionLabel}your nerve holds steady.`
    : `${modeNote}${actionLabel}your footing slips at the crucial moment.`;

  return {
    success,
    naturalRoll: roll,
    rollMode,
    statMod,
    traitBonus,
    total,
    dc,
    logLine: outcomeProse,
  };
}
