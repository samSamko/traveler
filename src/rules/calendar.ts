import type { WorldDatabase } from '../db/loader.ts';
import type { GameState } from '../types.ts';
import { rollD66, rollDie } from '../dice.ts';

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
    const raw = rollD66(state);
    const formatted = `${raw[0]}:${raw[1]}`;
    const match = nonFinal.find((p) => p.code === formatted);
    if (match) {
      chosen = match;
      break;
    }
  }
  if (!chosen && nonFinal.length > 0) {
    chosen = nonFinal[rollDie(nonFinal.length, state) - 1];
  }

  state.calendar.triggeredMiseries.push(chosen.code);
  return { code: chosen.code, text: chosen.text, worldEnded: false };
}

export function rollDawnMisery(state: GameState, world: WorldDatabase): MiseryCheckResult {
  const die = state.calendar.die;
  const roll = rollDie(die, state);
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
