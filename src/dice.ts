import type { AbilityName, Character, CharacterFeatureState, GameState } from './types.ts';
import { getActiveMiseryEffects } from './rules/calendar.ts';

export function hasClassFeature(pc: Character, prefix: string): boolean {
  return pc.classFeatures.some((f) => f.toLowerCase().startsWith(prefix.toLowerCase()));
}

export function ensureFeatureState(pc: Character): CharacterFeatureState {
  if (!pc.featureState) pc.featureState = {};
  return pc.featureState;
}

const KNOWN_REGIONS = [
  'Sarkash',
  'Galgenbeck',
  'Grift',
  'Bergen Chrypt',
  'Alliáns',
  'Graven-Tosk',
  'Wästland',
  'Lake Onda',
  'Schleswig',
  'Tveland',
  'Valley of the Unfortunate Undead',
];

export function getOriginRegionBonus(pc: Character, currentRegionName: string): number {
  if (!currentRegionName || !pc.traits?.origin) return 0;
  const originLower = pc.traits.origin.toLowerCase();
  const regionLower = currentRegionName.toLowerCase();
  if (originLower.includes(regionLower)) return -2;
  for (const r of KNOWN_REGIONS) {
    if (regionLower.includes(r.toLowerCase()) && originLower.includes(r.toLowerCase())) {
      return -2;
    }
  }
  return 0;
}

export function canCarryMoreItems(pc: Character): boolean {
  return pc.inventory.length < pc.carryingCapacity * 2;
}

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
  options?: { isDefence?: boolean; state?: GameState; label?: string },
): { dr: number; modifiers: string[] } {
  let dr = baseDr;
  const modifiers: string[] = [];
  const isDef = Boolean(options?.isDefence);
  const lowerLabel = (options?.label ?? '').toLowerCase();
  const isStealth = lowerLabel.includes('hide') || lowerLabel.includes('sneak') || lowerLabel.includes('stealth');
  const isLockOrTrap = lowerLabel.includes('lock') || lowerLabel.includes('trap') || lowerLabel.includes('ransack');
  const isScout = lowerLabel.includes('scout') || lowerLabel.includes('search') || lowerLabel.includes('spot');
  const fs = pc.featureState;

  // Armor penalties (p. 23 & p. 31: damaged armor keeps original penalties until ruined)
  if (ability === 'agility') {
    const penaltyTier = pc.armorTier > 0 ? Math.max(pc.armorTier, pc.armorMaxTier) : 0;
    if (penaltyTier === 2) {
      dr += 2;
      modifiers.push('+2 Medium Armor');
    } else if (penaltyTier === 3) {
      const delta = isDef ? 2 : 4;
      dr += delta;
      modifiers.push(`+${delta} Heavy Armor`);
    }
  }

  // Carrying capacity penalty: over Strength+8+container increases Strength and Agility DR by 2 (p. 28)
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

  // Class feature & item DR modifiers
  if (isDef && hasClassFeature(pc, 'Stolen Mitre') && dr > 10) {
    dr = Math.max(10, dr - 2);
    modifiers.push('-2 Stolen Mitre');
  }
  if (isStealth && hasClassFeature(pc, 'Stolen Mitre')) {
    dr -= 4;
    modifiers.push('-4 Stolen Mitre stealth');
  }
  if (isStealth && hasClassFeature(pc, 'Excretal Stealth')) {
    dr -= 4;
    modifiers.push('-4 Excretal Stealth');
  }
  if (isLockOrTrap && ability === 'agility' && hasClassFeature(pc, 'Filthy Fingersmith') && dr > 8) {
    dr = 8;
    modifiers.push('DR8 Filthy Fingersmith');
  }
  if (isScout && hasClassFeature(pc, 'Hawk as Weapon')) {
    dr -= 2;
    modifiers.push('-2 Hawk Scout');
  }
  if (isDef && fs?.listOfSinsActive) {
    dr -= 2;
    modifiers.push('-2 List of Sins');
  }
  if (isDef && fs?.berserkFight && dr < 14) {
    dr = 14;
    modifiers.push('DR14 Berserk');
  }
  if (fs?.hallucinationDay && options?.state && fs.hallucinationDay === options.state.calendar.day) {
    dr += 2;
    modifiers.push('+2 Bible Hallucinations');
  }
  if ((fs?.spiderVenomHours ?? 0) > 0) {
    dr += 2;
    modifiers.push('+2 Spider Venom');
  }
  if ((fs?.bookDizzyHours ?? 0) > 0) {
    dr += 2;
    modifiers.push('+2 Book Dizziness');
  }
  if ((fs?.blindedHours ?? 0) > 0 && (ability === 'presence' || !isDef)) {
    dr += 4;
    modifiers.push('+4 Blinded');
  }
  if (fs?.flailBurnDay && options?.state && fs.flailBurnDay === options.state.calendar.day && ability === 'agility') {
    dr += 2;
    modifiers.push('+2 Flail Burn');
  }
  if (fs?.nextTestDrBonus) {
    dr += fs.nextTestDrBonus;
    modifiers.push(`${fs.nextTestDrBonus} Active Buff`);
  }
  if (options?.state?.mode === 'combat' && (fs?.invisibleRounds ?? 0) > 0 && dr > 6) {
    dr = 6;
    modifiers.push('DR6 Invisible');
  }

  // Origin home-region familiarity (-2 DR on non-combat exploration/Presence checks in home region)
  if (!isDef && options?.state && options.state.mode !== 'combat' && ability === 'presence') {
    const regionMod = getOriginRegionBonus(pc, options.state.currentRegionName);
    if (regionMod !== 0) {
      dr += regionMod;
      modifiers.push(`${regionMod} Origin Familiarity`);
    }
  }

  // Outcast follower & Beast passive field bonuses
  if (!isDef && options?.state && options.state.mode !== 'combat') {
    const aliveFollowers = options.state.party.followers.filter((f) => f.status === 'alive');
    if (isLockOrTrap && aliveFollowers.some((f) => f.specialty.includes('Disarm traps'))) {
      dr -= 2;
      modifiers.push('-2 Prowler Traps');
    }
    if (isScout && aliveFollowers.some((f) => f.specialty.includes('Finds the right path') || f.specialty.includes('Senses danger'))) {
      dr -= 2;
      modifiers.push('-2 Earthbound');
    }
  }
  if ((isLockOrTrap || isScout) && fs?.ratScout) {
    dr -= 2;
    modifiers.push('-2 Tame Rat');
  }

  // Stacking Calendar of Nechrubel Misery modifiers
  if (options?.state) {
    const misery = getActiveMiseryEffects(options.state).counts;
    if (misery.poison_mist > 0 && ability === 'toughness') {
      dr += misery.poison_mist;
      modifiers.push(`+${misery.poison_mist} Poison Mist Misery`);
    }
    if (misery.dread_omen > 0 && isDef) {
      dr += misery.dread_omen;
      modifiers.push(`+${misery.dread_omen} Dread Omen Misery`);
    }
  }

  // Broken condition #3 (Hemorrhage) raises all tests to DR16 (1st hour) / DR18 (final hour)
  const hemHours = fs?.hemorrhageHoursLeft;
  if (hemHours !== undefined && hemHours > 0) {
    const minDr = hemHours <= 1 ? 18 : 16;
    if (dr < minDr) {
      dr = minDr;
      modifiers.push(hemHours <= 1 ? 'min DR18 Hemorrhage (last hour)' : 'min DR16 Hemorrhage');
    }
  } else if (pc.status === 'broken' && pc.brokenNote?.includes('Hemorrhage')) {
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
  options?: { isDefence?: boolean; state?: GameState; label?: string },
): number {
  return getEffectiveTestDrBreakdown(pc, ability, baseDr, options).dr;
}

function trySpendOmenInline(pc: Character, state?: GameState): { spent: boolean; preserved: boolean } {
  if (pc.omens <= 0) return { spent: false, preserved: false };
  if (hasClassFeature(pc, 'Escaping Fate') && rollDie(2, state) === 1) {
    return { spent: true, preserved: true };
  }
  pc.omens -= 1;
  return { spent: true, preserved: false };
}

export function rollAbilityTest(
  pc: Character,
  ability: AbilityName,
  baseDr: number,
  state?: GameState,
  options?: { label?: string; extraMod?: number; isDefence?: boolean },
): AbilityTestResult {
  const fs = pc.featureState;
  const label = options?.label ?? `${ability.toUpperCase()} test`;

  // Horn of the Schleswig Lords! auto-success on next non-combat test
  if (fs?.autoPassNextTest && !options?.isDefence && state?.mode !== 'combat') {
    fs.autoPassNextTest = false;
    return {
      success: true,
      naturalRoll: 20,
      isCrit: false,
      isFumble: false,
      abilityMod: pc.abilities[ability],
      extraMod: 0,
      total: baseDr,
      baseDr,
      effectiveDr: baseDr,
      logLine: `${pc.name} ${label}: [Horn of the Schleswig Lords! AUTO-PASS vs DR${baseDr}]`,
    };
  }

  let naturalRoll = rollDie(20, state);
  const abilityMod = pc.abilities[ability];
  let extraMod = options?.extraMod ?? 0;
  if (ability === 'presence' && hasClassFeature(pc, 'Barbarister the Incredible Horse') && state?.mode !== 'combat') {
    extraMod += 2;
  }
  if (ability === 'presence' && fs?.presenceBuffActive) {
    extraMod += 2;
  }
  if (
    state?.mode === 'combat' &&
    (fs?.wraithDrainFight ?? 0) > 0 &&
    (ability === 'strength' || ability === 'presence' || ability === 'agility')
  ) {
    extraMod -= fs!.wraithDrainFight!;
  }
  if (fs?.graceRollBonus) {
    fs.graceRollBonus = false;
    extraMod += rollDie(6, state);
  }
  if (fs?.blackCrownWorn && state?.mode === 'combat') {
    extraMod += options?.isDefence ? -10 : 10;
  }

  const drInfo = getEffectiveTestDrBreakdown(pc, ability, baseDr, {
    isDefence: options?.isDefence,
    state,
    label,
  });
  if (fs?.nextTestDrBonus) {
    fs.nextTestDrBonus = 0;
  }

  let effectiveDr = drInfo.dr;
  const omenNotes: string[] = [];

  if (fs?.omenArmed === 'lower_dr' && pc.omens > 0) {
    const om = trySpendOmenInline(pc, state);
    if (om.spent) {
      effectiveDr = Math.max(2, effectiveDr - 4);
      fs.omenArmed = undefined;
      omenNotes.push(om.preserved ? '[Omen -4 DR (Escaping Fate kept Omen)]' : '[Omen -4 DR]');
    }
  }

  let total = naturalRoll + abilityMod + extraMod;
  let isCrit = naturalRoll === 20;
  let isFumble = naturalRoll === 1;
  if (fs?.blackCrownWorn && state?.mode === 'combat') {
    if (total >= 20) isCrit = true;
    if (total <= 1) isFumble = true;
  }
  let success = !isFumble && (isCrit || total >= effectiveDr);

  if (!success && fs?.omenArmed === 'reroll' && pc.omens > 0) {
    const om = trySpendOmenInline(pc, state);
    if (om.spent) {
      fs.omenArmed = undefined;
      naturalRoll = rollDie(20, state);
      total = naturalRoll + abilityMod + extraMod;
      isCrit = naturalRoll === 20;
      isFumble = naturalRoll === 1;
      if (fs?.blackCrownWorn && state?.mode === 'combat') {
        if (total >= 20) isCrit = true;
        if (total <= 1) isFumble = true;
      }
      success = !isFumble && (isCrit || total >= effectiveDr);
      omenNotes.push(om.preserved ? `[Omen Reroll->${naturalRoll} (kept)]` : `[Omen Reroll->${naturalRoll}]`);
    }
  }

  if (isFumble && fs?.omenArmed === 'neutralize' && pc.omens > 0) {
    const om = trySpendOmenInline(pc, state);
    if (om.spent) {
      fs.omenArmed = undefined;
      isFumble = false;
      omenNotes.push(om.preserved ? '[Omen Neutralized Fumble (kept)]' : '[Omen Neutralized Fumble]');
    }
  }

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

  const signMod = abilityMod >= 0 ? `+${abilityMod}` : `${abilityMod}`;
  const extraStr = extraMod === 0 ? '' : extraMod > 0 ? `+${extraMod}` : `${extraMod}`;
  const drNote = drInfo.modifiers.length > 0 ? ` (base ${baseDr}, ${drInfo.modifiers.join(', ')})` : '';
  const tag = isCrit ? ' [CRIT!]' : isFumble ? ' [FUMBLE!]' : success ? ' [PASS]' : ' [FAIL]';
  const omenSuffix = omenNotes.length > 0 ? ` ${omenNotes.join(' ')}` : '';
  const logLine = `${pc.name} ${label}: d20(${naturalRoll})${signMod}${extraStr} = ${total} vs DR${effectiveDr}${drNote}${tag}${whistleNote}${omenSuffix}`;

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
