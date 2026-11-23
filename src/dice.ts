import type { GameState, StatName } from './types.ts';
import { ITEMS } from './content/items.ts';
import { PERKS } from './content/characters.ts';

export function nextRandom(state?: GameState): number {
  if (state && typeof state.rngState === 'number') {
    // Mulberry32 deterministic PRNG for reproducible tests when rngState is seeded.
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

  const equipped = [ITEMS[p.weaponId], ITEMS[p.armorId], p.trinketId ? ITEMS[p.trinketId] : undefined];
  for (const item of equipped) {
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

  return total;
}

export interface CheckResult {
  success: boolean;
  naturalRoll: number;
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
    isLoreOrPerception?: boolean;
    isCraftOrStealth?: boolean;
  },
): CheckResult {
  const p = state.player;
  let roll = rollDie(20, state);
  const statMod = getEffectiveStat(state, stat);
  let traitBonus = options?.extraBonus ?? 0;
  const traitNotes: string[] = [];

  if (p.race === 'vaelorian' && p.hp <= Math.floor(p.maxHp / 2)) {
    traitBonus += 2;
    traitNotes.push('+2 Unbound Will');
  }
  if (p.race === 'ael_thalor' && options?.isLoreOrPerception) {
    traitBonus += 2;
    traitNotes.push('+2 Star-Sight');
  }
  if (p.race === 'grixi' && options?.isCraftOrStealth) {
    traitBonus += 2;
    traitNotes.push('+2 Scrap-Savant');
  }

  const blessed = p.statuses.find((s) => s.type === 'blessed');
  if (blessed) {
    traitBonus += blessed.power;
    traitNotes.push(`+${blessed.power} Blessed`);
  }

  let total = roll + statMod + traitBonus;

  // Vaelorian determination auto-reroll if failed and available.
  let rerolledNote = '';
  if (total < dc && p.race === 'vaelorian' && p.determinationAvailable && roll < 14) {
    const second = rollDie(20, state);
    if (second > roll) {
      rerolledNote = ` [Unbound Will reroll ${roll}->${second}]`;
      roll = second;
      total = roll + statMod + traitBonus;
      p.determinationAvailable = false;
    }
  }

  const success = roll === 20 || (roll !== 1 && total >= dc);
  const statLabel = stat.charAt(0).toUpperCase() + stat.slice(1);
  const labelPrefix = options?.label ? `${options.label} — ` : '';
  const extraText = traitNotes.length > 0 ? ` (${traitNotes.join(', ')})` : '';
  const outcomeTag = roll === 20 ? 'CRITICAL SUCCESS' : roll === 1 ? 'CRITICAL FAIL' : success ? 'SUCCESS' : 'FAIL';

  const logLine = `[CHECK ${labelPrefix}${statLabel}: d20(${roll}) + ${statMod}${extraText} = ${total} vs DC ${dc} -> ${outcomeTag}]${rerolledNote}`;

  return {
    success,
    naturalRoll: roll,
    statMod,
    traitBonus,
    total,
    dc,
    logLine,
  };
}
