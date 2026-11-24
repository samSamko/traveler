import type {
  ActiveEnemy,
  DamageProfile,
  DamageType,
  GameState,
  ResistanceLevel,
  WeatherId,
} from '../types.ts';
import { RACES } from '../content/characters.ts';
import { ITEMS } from '../content/items.ts';
import { nextRandom } from '../dice.ts';
import { BODY_MODS } from './bodymods.ts';

export const DAMAGE_TYPE_META: Record<
  DamageType,
  { label: string; baseLethality: number; resolveRatio: number }
> = {
  slashing: { label: 'Slashing', baseLethality: 0.72, resolveRatio: 0 },
  piercing: { label: 'Piercing', baseLethality: 0.68, resolveRatio: 0 },
  bludgeoning: { label: 'Bludgeoning', baseLethality: 0.22, resolveRatio: 0.1 },
  fire: { label: 'Fire', baseLethality: 0.82, resolveRatio: 0.1 },
  cold: { label: 'Cold', baseLethality: 0.34, resolveRatio: 0.15 },
  lightning: { label: 'Lightning', baseLethality: 0.38, resolveRatio: 0.2 },
  acid: { label: 'Acid', baseLethality: 0.78, resolveRatio: 0.15 },
  poison: { label: 'Poison', baseLethality: 0.45, resolveRatio: 0.1 },
  blight: { label: 'Blight', baseLethality: 0.55, resolveRatio: 0.25 },
  resonant: { label: 'Resonant', baseLethality: 0.25, resolveRatio: 0.45 },
};

function mergeResistance(
  current: ResistanceLevel | undefined,
  incoming: ResistanceLevel | undefined,
): ResistanceLevel {
  const a = current ?? 'neutral';
  const b = incoming ?? 'neutral';
  if (a === 'immune' || b === 'immune') return 'immune';
  if ((a === 'resistant' && b === 'vulnerable') || (a === 'vulnerable' && b === 'resistant')) {
    return 'neutral';
  }
  if (a === 'resistant' || b === 'resistant') return 'resistant';
  if (a === 'vulnerable' || b === 'vulnerable') return 'vulnerable';
  return 'neutral';
}

export function getEffectivePlayerResistances(state: GameState): DamageProfile {
  const profile: DamageProfile = {};
  const p = state.player;

  const applyProfile = (src?: DamageProfile) => {
    if (!src) return;
    for (const [k, v] of Object.entries(src) as Array<[DamageType, ResistanceLevel]>) {
      profile[k] = mergeResistance(profile[k], v);
    }
  };

  applyProfile(RACES[p.race]?.resistances);
  applyProfile(ITEMS[p.armorId]?.resistances);
  if (p.trinketId) applyProfile(ITEMS[p.trinketId]?.resistances);

  for (const modId of Object.values(p.bodyMods)) {
    if (modId && BODY_MODS[modId]?.resistances) {
      applyProfile(BODY_MODS[modId].resistances);
    }
  }

  return profile;
}

export function computeDamageAfterResistance(
  rawDamage: number,
  damageType: DamageType,
  profile: DamageProfile,
  weather?: WeatherId,
): { finalDamage: number; relation: ResistanceLevel; weatherNote?: string } {
  let scaled = rawDamage;
  let weatherNote: string | undefined;

  if (weather === 'ash_rain') {
    if (damageType === 'fire') {
      scaled = Math.max(1, Math.floor(scaled * 0.75));
      weatherNote = 'Ash-rain dampens the flames.';
    } else if (damageType === 'lightning') {
      scaled = Math.ceil(scaled * 1.25);
      weatherNote = 'Wet air amplifies the lightning arc.';
    }
  } else if (weather === 'biting_wind' && damageType === 'cold') {
    scaled = Math.ceil(scaled * 1.2);
    weatherNote = 'Biting wind sharpens the frost.';
  } else if (weather === 'spore_fog' && damageType === 'blight') {
    scaled = Math.ceil(scaled * 1.2);
  }

  const relation = profile[damageType] ?? 'neutral';
  if (relation === 'immune') {
    return { finalDamage: 0, relation, weatherNote };
  }
  if (relation === 'resistant') {
    return { finalDamage: Math.max(1, Math.floor(scaled * 0.5)), relation, weatherNote };
  }
  if (relation === 'vulnerable') {
    return { finalDamage: Math.ceil(scaled * 1.5), relation, weatherNote };
  }
  return { finalDamage: Math.max(1, scaled), relation, weatherNote };
}

export function determineEnemyDefeatOutcome(
  enemy: ActiveEnemy,
  damageType: DamageType,
  overkill: number,
  forcedSubdue: boolean,
  state: GameState,
): 'downed' | 'killed' {
  if (enemy.category === 'construct') {
    return forcedSubdue || damageType === 'lightning' ? 'downed' : 'killed';
  }
  if (enemy.isBoss) {
    return 'killed';
  }

  const overkillRatio = Math.max(0, overkill) / Math.max(1, enemy.maxHp);
  if (forcedSubdue) {
    return overkillRatio >= 0.65 ? 'killed' : 'downed';
  }

  const baseLethality = DAMAGE_TYPE_META[damageType].baseLethality;
  const lethalityChance = Math.min(0.95, Math.max(0.08, baseLethality + overkillRatio * 0.5));
  return nextRandom(state) < lethalityChance ? 'killed' : 'downed';
}
