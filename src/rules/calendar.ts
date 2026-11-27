import type { WorldDatabase } from '../db/loader.ts';
import type { GameState } from '../types.ts';

export type MiseryEffectKey =
  | 'famine'
  | 'poison_mist'
  | 'arcane_fade'
  | 'undead_surge'
  | 'price_inflation'
  | 'betrayal_morale'
  | 'rest_hazard'
  | 'travel_peril'
  | 'dread_omen';

export const PSALM_EFFECT_MAP: Record<string, MiseryEffectKey> = {
  '3:3': 'famine',
  '5:1': 'famine',
  '5:2': 'famine',
  '5:3': 'famine',
  '1:2': 'poison_mist',
  '1:6': 'poison_mist',
  '2:1': 'poison_mist',
  '2:2': 'poison_mist',
  '2:4': 'arcane_fade',
  '2:5': 'arcane_fade',
  '6:3': 'arcane_fade',
  '6:6': 'arcane_fade',
  '1:4': 'undead_surge',
  '3:1': 'undead_surge',
  '4:1': 'undead_surge',
  '5:4': 'undead_surge',
  '6:5': 'undead_surge',
  '3:4': 'price_inflation',
  '5:6': 'price_inflation',
  '1:3': 'price_inflation',
  '4:3': 'price_inflation',
  '1:5': 'betrayal_morale',
  '3:6': 'betrayal_morale',
  '4:4': 'betrayal_morale',
  '6:4': 'betrayal_morale',
  '1:1': 'rest_hazard',
  '4:2': 'rest_hazard',
  '6:1': 'rest_hazard',
  '6:2': 'rest_hazard',
  '2:3': 'travel_peril',
  '3:2': 'travel_peril',
  '3:5': 'travel_peril',
  '4:5': 'travel_peril',
  '4:6': 'travel_peril',
  '2:6': 'dread_omen',
  '5:5': 'dread_omen',
} as const;

export interface ActiveMiseryEffects {
  counts: Record<MiseryEffectKey, number>;
  summaries: string[];
}

export function getActiveMiseryEffects(state: GameState): ActiveMiseryEffects {
  const counts: Record<MiseryEffectKey, number> = {
    famine: 0,
    poison_mist: 0,
    arcane_fade: 0,
    undead_surge: 0,
    price_inflation: 0,
    betrayal_morale: 0,
    rest_hazard: 0,
    travel_peril: 0,
    dread_omen: 0,
  };
  for (const code of state.calendar.triggeredMiseries) {
    const key = PSALM_EFFECT_MAP[code];
    if (key) counts[key] += 1;
  }

  const summaries: string[] = [];
  if (counts.famine > 0) summaries.push(`Famine x${counts.famine}: +${counts.famine} ration/water per night rest`);
  if (counts.poison_mist > 0) summaries.push(`Poison Mist x${counts.poison_mist}: +${counts.poison_mist} Toughness DR`);
  if (counts.arcane_fade > 0) summaries.push(`Arcane Fade x${counts.arcane_fade}: +${counts.arcane_fade * 2} Power casting DR`);
  if (counts.undead_surge > 0) summaries.push(`Undead Surge x${counts.undead_surge}: higher undead encounters`);
  if (counts.price_inflation > 0) summaries.push(`Price Inflation x${counts.price_inflation}: +${counts.price_inflation * 50}% Quartermaster prices`);
  if (counts.betrayal_morale > 0) summaries.push(`Betrayal x${counts.betrayal_morale}: -${counts.betrayal_morale * 2} Reaction & -${counts.betrayal_morale} Outcast Morale`);
  if (counts.rest_hazard > 0) summaries.push(`Rest Hazard x${counts.rest_hazard}: -${counts.rest_hazard} night rest HP`);
  if (counts.travel_peril > 0) summaries.push(`Travel Peril x${counts.travel_peril}: +${counts.travel_peril * 2} overland travel DR`);
  if (counts.dread_omen > 0) summaries.push(`Dread Omen x${counts.dread_omen}: +${counts.dread_omen} Defence DR`);

  return { counts, summaries };
}

function localRollDie(sides: number, state: GameState): number {
  let t = (state.rngState += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const rand = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return Math.floor(rand * sides) + 1;
}

function localRollD66(state: GameState): string {
  return `${localRollDie(6, state)}${localRollDie(6, state)}`;
}

export interface MiseryCheckResult {
  triggered: boolean;
  roll: number;
  die: number;
  psalmCode: string | null;
  psalmText: string | null;
  worldEnded: boolean;
  logLine: string;
}

export function triggerSpecificOrRandomMisery(
  state: GameState,
  world: WorldDatabase,
): { code: string; text: string; worldEnded: boolean } {
  const already = new Set(state.calendar.triggeredMiseries);
  if (already.size >= 6) {
    const finalPsalm = world.calendarPsalms.find((p) => p.isFinal) ?? {
      code: '7:7',
      text: 'The seventh seal is broken. Burn the book.',
      isFinal: true,
    };
    state.calendar.triggeredMiseries.push(finalPsalm.code);
    state.calendar.worldEnded = true;
    state.mode = 'game_over';
    state.gameOverReason = `The Seventh Misery (${finalPsalm.code}) has come to pass. ${finalPsalm.text} Burn the book.`;
    return { code: finalPsalm.code, text: finalPsalm.text, worldEnded: true };
  }

  const nonFinal = world.calendarPsalms.filter((p) => !p.isFinal && !already.has(p.code));
  let chosen = nonFinal[0];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const raw = localRollD66(state);
    const formatted = `${raw[0]}:${raw[1]}`;
    const match = nonFinal.find((p) => p.code === formatted);
    if (match) {
      chosen = match;
      break;
    }
  }
  if (!chosen && nonFinal.length > 0) {
    chosen = nonFinal[localRollDie(nonFinal.length, state) - 1];
  }

  state.calendar.triggeredMiseries.push(chosen.code);
  return { code: chosen.code, text: chosen.text, worldEnded: false };
}

export function rollDawnMisery(state: GameState, world: WorldDatabase): MiseryCheckResult {
  const die = state.calendar.die;
  const roll = localRollDie(die, state);
  if (roll !== 1) {
    return {
      triggered: false,
      roll,
      die,
      psalmCode: null,
      psalmText: null,
      worldEnded: false,
      logLine: `Dawn Day ${state.calendar.day}: Calendar roll d${die}(${roll}) — the end holds off one more day.`,
    };
  }

  const misery = triggerSpecificOrRandomMisery(state, world);
  const logLine = misery.worldEnded
    ? `Dawn Day ${state.calendar.day}: Calendar roll d${die}(1)! FINAL MISERY ${misery.code}: ${misery.text} Burn the book.`
    : `Dawn Day ${state.calendar.day}: Calendar roll d${die}(1)! MISERY ${misery.code}: ${misery.text}`;

  state.chronicle.push(`Misery ${misery.code}: ${misery.text}`);

  return {
    triggered: true,
    roll,
    die,
    psalmCode: misery.code,
    psalmText: misery.text,
    worldEnded: misery.worldEnded,
    logLine,
  };
}
