import type { GameState } from '../types.ts';
import { ITEMS } from '../content/items.ts';
import { pronouns } from '../memory.ts';
import { WEATHER_DATA, formatPeriodLabel, getTimePeriod } from '../systems/clock.ts';

function evaluateCondition(expr: string, state: GameState): boolean {
  const trimmed = expr.trim();
  const cmp = trimmed.match(/^defilement\s*(>=|<=|>|<)\s*(\d+)$/i);
  if (cmp) {
    const op = cmp[1];
    const target = Number.parseInt(cmp[2], 10);
    const val = state.player.defilement;
    if (op === '>=') return val >= target;
    if (op === '<=') return val <= target;
    if (op === '>') return val > target;
    return val < target;
  }

  if (trimmed === 'male' || trimmed === 'female') {
    return state.player.sex === trimmed;
  }
  if (trimmed === state.player.race || trimmed === state.player.background) {
    return true;
  }
  if (state.player.anatomy.visibleTags.includes(trimmed)) {
    return true;
  }
  if (trimmed.startsWith('mod:')) {
    const modId = trimmed.slice(4);
    return Object.values(state.player.bodyMods).includes(modId);
  }
  return Boolean(state.memory.flags[trimmed]);
}

export function renderProse(template: string, state: GameState): string {
  const p = state.player;
  const pr = pronouns(p.sex);
  const a = p.anatomy;

  // Evaluate {if:condition}...{/if} blocks
  let out = template.replace(
    /\{if:([^}]+)\}([\s\S]*?)\{\/if\}/g,
    (_m, cond: string, body: string) => (evaluateCondition(cond, state) ? body : ''),
  );

  const tokens: Record<string, string> = {
    name: p.name,
    he: pr.subj,
    him: pr.obj,
    his: pr.poss,
    formal: pr.formal,
    kin: pr.kinTitle,
    skin: a.skinColor.toLowerCase(),
    hair: a.hairColor === 'None' ? 'shaved' : a.hairColor.toLowerCase(),
    eyes: a.eyeColor.toLowerCase(),
    height: a.height.toLowerCase(),
    build: a.musculature.toLowerCase(),
    weapon: ITEMS[p.weaponId]?.name ?? 'weapon',
    armor: ITEMS[p.armorId]?.name ?? 'armor',
    weather: WEATHER_DATA[state.clock.weather].label.toLowerCase(),
    period: formatPeriodLabel(getTimePeriod(state.clock.hour)).toLowerCase(),
    mark: a.distinguishingMark,
  };

  out = out.replace(/\{([a-z_]+)\}/gi, (match, key: string) => {
    const val = tokens[key.toLowerCase()];
    return val !== undefined ? val : match;
  });

  return out.replace(/[ \t]{2,}/g, ' ').trim();
}
