import type { AbilityName, Character, GameState } from './types.ts';

export function nextRandom(state?: { rngState: number }): number {
  if (state && typeof state.rngState === 'number') {
    let t = (state.rngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return Math.random();
}

export function rollDie(sides: number, state?: { rngState: number }): number {
  if (sides <= 1) return 1;
  return Math.floor(nextRandom(state) * sides) + 1;
}

export function rollDice(count: number, sides: number, state?: { rngState: number }): number {
  let sum = 0;
  for (let i = 0; i < count; i += 1) {
    sum += rollDie(sides, state);
  }
  return sum;
}

export function rollD66(state?: { rngState: number }): string {
  const tens = rollDie(6, state);
  const ones = rollDie(6, state);
  return `${tens}${ones}`;
}

export interface DetailedDiceResult {
  total: number;
  dice: number[];
  modifier: number;
  detail: string;
}

export function roll4d6DropLowestDetailed(state?: { rngState: number }): DetailedDiceResult {
  const raw = [
    rollDie(6, state),
    rollDie(6, state),
    rollDie(6, state),
    rollDie(6, state),
  ];
  const sorted = [...raw].sort((a, b) => a - b);
  const total = sorted[1] + sorted[2] + sorted[3];
  return {
    total,
    dice: raw,
    modifier: 0,
    detail: `[${sorted[3]}, ${sorted[2]}, ${sorted[1]}, drop ${sorted[0]}] = ${total}`,
  };
}

export function roll4d6DropLowest(state?: { rngState: number }): number {
  return roll4d6DropLowestDetailed(state).total;
}

export function scoreToAbilityMod(sum: number): number {
  if (sum <= 4) return -3;
  if (sum <= 6) return -2;
  if (sum <= 8) return -1;
  if (sum <= 12) return 0;
  if (sum <= 14) return 1;
  if (sum <= 16) return 2;
  return 3;
}

export function parseDiceExprDetailed(expr: string, state?: { rngState: number }): DetailedDiceResult {
  const clean = expr.trim().toLowerCase().replace(/\s+/g, '');
  if (!clean) return { total: 0, dice: [], modifier: 0, detail: '0' };

  if (clean.includes('*')) {
    const [left, right] = clean.split('*');
    const leftRes = parseDiceExprDetailed(left, state);
    const mult = Number.parseInt(right, 10);
    const total = leftRes.total * mult;
    return {
      total,
      dice: leftRes.dice,
      modifier: leftRes.modifier,
      detail: `[${leftRes.dice.join(', ')}] x ${mult} = ${total}`,
    };
  }

  let total = 0;
  let modifier = 0;
  const dice: number[] = [];
  const tokens = clean.replace(/-/g, '+-').split('+').filter(Boolean);
  for (const tok of tokens) {
    const sign = tok.startsWith('-') ? -1 : 1;
    const body = tok.startsWith('-') ? tok.slice(1) : tok;
    if (body.includes('d')) {
      const [countStr, sidesStr] = body.split('d');
      const count = countStr === '' ? 1 : Number.parseInt(countStr, 10);
      const sides = Number.parseInt(sidesStr, 10);
      for (let i = 0; i < count; i += 1) {
        const r = rollDie(sides, state);
        dice.push(sign * r);
        total += sign * r;
      }
    } else {
      const val = sign * Number.parseInt(body, 10);
      modifier += val;
      total += val;
    }
  }

  let detail = `${total}`;
  if (dice.length > 0 && modifier !== 0) {
    const modPart = modifier > 0 ? `+ ${modifier}` : `- ${Math.abs(modifier)}`;
    detail = `[${dice.join(', ')}] ${modPart} = ${total}`;
  } else if (dice.length > 0) {
    detail = `[${dice.join(', ')}] = ${total}`;
  }

  return { total, dice, modifier, detail };
}

export function parseDiceExpr(expr: string, state?: { rngState: number }): number {
  return parseDiceExprDetailed(expr, state).total;
}

export interface AbilityTestResult {
  success: boolean;
  naturalRoll: number;
  isCrit: boolean;
  isFumble: boolean;
  abilityMod: number;
  extraMod: number;
  total: number;
  baseDr: number;
  effectiveDr: number;
  logLine: string;
}

export function getEffectiveTestDrBreakdown(
  pc: Character,
  ability: AbilityName,
  baseDr: number,
  options?: { isDefence?: boolean },
): { dr: number; modifiers: string[] } {
  let dr = baseDr;
  const modifiers: string[] = [];
  const isDef = Boolean(options?.isDefence);

  // Armor penalties (p. 23)
  if (ability === 'agility') {
    if (pc.armorTier === 2) {
      dr += 2;
      modifiers.push('+2 Medium Armor');
    } else if (pc.armorTier === 3) {
      const delta = isDef ? 2 : 4;
      dr += delta;
      modifiers.push(`+${delta} Heavy Armor`);
    }
  }

  // Carrying capacity penalty: over Strength+8 increases Strength and Agility DR by 2 (p. 28)
  if ((ability === 'strength' || ability === 'agility') && pc.inventory.length > pc.carryingCapacity) {
    dr += 2;
    modifiers.push('+2 Encumbered');
  }

  // Class modifiers
  if (pc.classId === 'gutterborn_scum' && (ability === 'agility' || ability === 'presence')) {
    dr -= 2;
    modifiers.push('-2 Gutterborn Scum');
  }
  if (pc.classId === 'fanged_deserter' && ability === 'agility' && !isDef && baseDr === 12) {
    dr = 14 + (dr - baseDr);
    modifiers.push('Normal AGI->DR14 Fanged Deserter');
  }

  // Broken condition #3 (Hemorrhage) raises all tests to DR16+
  if (pc.status === 'broken' && pc.brokenNote?.includes('Hemorrhage')) {
    if (dr < 16) {
      dr = 16;
      modifiers.push('min DR16 Hemorrhage');
    }
  }

  return { dr: Math.max(2, dr), modifiers };
}

export function getEffectiveTestDr(
  pc: Character,
  ability: AbilityName,
  baseDr: number,
  options?: { isDefence?: boolean },
): number {
  return getEffectiveTestDrBreakdown(pc, ability, baseDr, options).dr;
}

export function rollAbilityTest(
  pc: Character,
  ability: AbilityName,
  baseDr: number,
  state?: GameState,
  options?: { label?: string; extraMod?: number; isDefence?: boolean },
): AbilityTestResult {
  const naturalRoll = rollDie(20, state);
  const abilityMod = pc.abilities[ability];
  const extraMod = options?.extraMod ?? 0;
  const drInfo = getEffectiveTestDrBreakdown(pc, ability, baseDr, { isDefence: options?.isDefence });
  const effectiveDr = drInfo.dr;
  const total = naturalRoll + abilityMod + extraMod;
  const isCrit = naturalRoll === 20;
  const isFumble = naturalRoll === 1;
  let success = !isFumble && (isCrit || total >= effectiveDr);

  // Bad Habit #19: whistle while trying to hide on 5, 7, 9, 11, or 13
  const lowerLabel = (options?.label ?? '').toLowerCase();
  const isStealth = lowerLabel.includes('hide') || lowerLabel.includes('sneak') || lowerLabel.includes('stealth');
  let whistleNote = '';
  if (
    isStealth &&
    pc.traits.badHabit.includes('whistle while trying to hide') &&
    (naturalRoll === 5 || naturalRoll === 7 || naturalRoll === 9 || naturalRoll === 11 || naturalRoll === 13)
  ) {
    success = false;
    whistleNote = ' [WHISTLED WHILE HIDING!]';
  }

  const label = options?.label ?? `${ability.toUpperCase()} test`;
  const signMod = abilityMod >= 0 ? `+${abilityMod}` : `${abilityMod}`;
  const extraStr = extraMod === 0 ? '' : extraMod > 0 ? `+${extraMod}` : `${extraMod}`;
  const drNote = drInfo.modifiers.length > 0 ? ` (base ${baseDr}, ${drInfo.modifiers.join(', ')})` : '';
  const tag = isCrit ? ' [CRIT!]' : isFumble ? ' [FUMBLE!]' : success ? ' [PASS]' : ' [FAIL]';
  const logLine = `${pc.name} ${label}: d20(${naturalRoll})${signMod}${extraStr} = ${total} vs DR${effectiveDr}${drNote}${tag}${whistleNote}`;

  return {
    success,
    naturalRoll,
    isCrit,
    isFumble,
    abilityMod,
    extraMod,
    total,
    baseDr,
    effectiveDr,
    logLine,
  };
}
