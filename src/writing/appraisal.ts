import type { ActiveEnemy, DamageProfile, DamageType, GameState, Stats } from '../types.ts';
import { resolveCheck } from '../dice.ts';
import { ENEMIES } from '../content/enemies.ts';
import { WEATHER_DATA } from '../systems/clock.ts';
import { DAMAGE_TYPE_META } from '../systems/damage.ts';
import { renderAnatomyProse } from './anatomy.ts';
import { getEnemyDisplayName, markEnemySeen, upgradeEnemyAppraisal } from './discovery.ts';

export function getHealthConditionLabel(hp: number, maxHp: number): string {
  if (hp <= 0) return 'Fallen';
  const ratio = hp / Math.max(1, maxHp);
  if (ratio >= 1) return 'Unscathed';
  if (ratio >= 0.75) return 'Scratched';
  if (ratio >= 0.5) return 'Wounded';
  if (ratio >= 0.25) return 'Bloodied';
  if (ratio >= 0.1) return 'Reeling';
  return 'Near Death';
}

function mightRead(val: number): string {
  if (val <= 1) return 'Frail, hollow-limbed frame with little brute force.';
  if (val === 2) return 'Sinewy frontier muscle capable of sharp blows.';
  if (val === 3) return 'Visible corded muscle coiled along shoulders and arms.';
  if (val === 4) return 'Heavy, forged-iron bulk built to crush shields.';
  return 'Monstrous, overwhelming physical strength.';
}

function agilityRead(val: number): string {
  if (val <= 1) return 'Stiff, lumbering gait with wide openings.';
  if (val === 2) return 'Steady, deliberate footing.';
  if (val === 3) return 'Wiry, quick-footed poise ready to lunge.';
  return 'Coiled, predatory swiftness across broken ground.';
}

function witRead(val: number): string {
  if (val <= 1) return 'Vacant, instinct-driven gaze.';
  if (val === 2) return 'Wary cunning behind clouded eyes.';
  if (val === 3) return 'Sharp, calculating watchfulness.';
  return 'Deep, uncanny awareness that reads every feint.';
}

function gritRead(val: number): string {
  if (val <= 1) return 'Brittle bones and thin hide.';
  if (val === 2) return 'Weathered toughness that shrugs off grazes.';
  if (val === 3) return 'Hardened, stubborn endurance.';
  return 'Stone-ribbed vitality that yields only to ruinous wounds.';
}

export function describeStatImpressions(stats: Stats, tier: 0 | 1 | 2): string[] {
  if (tier === 0) {
    return ['Physique and capability remain unclear in the dim light.'];
  }
  if (tier === 1) {
    return [
      `Build: ${mightRead(stats.might)}`,
      `Movement: ${agilityRead(stats.agility)}`,
    ];
  }
  return [
    `Strength: ${mightRead(stats.might)}`,
    `Agility: ${agilityRead(stats.agility)}`,
    `Cunning: ${witRead(stats.wit)}`,
    `Endurance: ${gritRead(stats.grit)}`,
  ];
}

export function formatResistanceProfile(profile?: DamageProfile): string | null {
  if (!profile) return null;
  const immune: string[] = [];
  const resistant: string[] = [];
  const vulnerable: string[] = [];

  for (const [dtype, level] of Object.entries(profile) as Array<[DamageType, string]>) {
    const label = DAMAGE_TYPE_META[dtype]?.label ?? dtype;
    if (level === 'immune') immune.push(label);
    else if (level === 'resistant') resistant.push(label);
    else if (level === 'vulnerable') vulnerable.push(label);
  }

  const parts: string[] = [];
  if (immune.length > 0) parts.push(`Immune to ${immune.join(', ')}`);
  if (resistant.length > 0) parts.push(`Resistant to ${resistant.join(', ')}`);
  if (vulnerable.length > 0) parts.push(`Vulnerable to ${vulnerable.join(', ')}`);
  return parts.length > 0 ? parts.join(' | ') : null;
}

export function formatCombatEnemyCard(state: GameState, enemy: ActiveEnemy): string[] {
  const displayName = getEnemyDisplayName(state, enemy);
  const condition = getHealthConditionLabel(enemy.hp, enemy.maxHp);
  const statusPart =
    enemy.statuses.length > 0
      ? ` | ${enemy.statuses.map((s) => `${s.type} ${s.turns}t`).join(', ')}`
      : '';

  const lines: string[] = [`${displayName} - ${condition}${statusPart}`];

  if (enemy.appraisalTier >= 1) {
    lines.push(`  Gear: ${enemy.visibleGear.weapon}; ${enemy.visibleGear.armor}.`);
    const reads = describeStatImpressions(enemy.stats, enemy.appraisalTier);
    for (const r of reads) {
      lines.push(`  ${r}`);
    }
    if (enemy.appraisalTier >= 2) {
      lines.push(`  Detail: ${enemy.visibleGear.hiddenDetail}`);
      const resLine = formatResistanceProfile(enemy.resistances);
      if (resLine) lines.push(`  Affinities: ${resLine}`);
    }
  } else {
    lines.push('  Unassessed silhouette. Use Observe to gauge build, gear, and footing.');
  }

  const intent = enemy.intents[enemy.nextIntentIndex];
  if (intent) {
    lines.push(`  Stance: ${displayName} ${intent.description}`);
  }

  return lines;
}

export function runPassiveCombatGlance(state: GameState): string[] {
  const combat = state.combat;
  if (!combat) return [];
  const logs: string[] = [];
  const autoGlance = state.player.bodyMods.eyes === 'star_sap_eyes';
  const weatherMod = WEATHER_DATA[state.clock.weather].observeMod;

  for (const enemy of combat.enemies) {
    const firstSight = markEnemySeen(state, enemy.templateId);
    const tpl = ENEMIES[enemy.templateId];
    const record = state.discovery.knownEnemies[enemy.templateId];

    if (firstSight) {
      logs.push(tpl.firstSightProse);
    } else if (record.identified) {
      enemy.identified = true;
      logs.push(tpl.returnSightProse);
    } else {
      logs.push(tpl.firstSightProse);
    }

    if (record.appraisalTier >= 1) {
      enemy.appraisalTier = record.appraisalTier;
      if (record.appraisalTier >= 2) enemy.identified = true;
      continue;
    }

    if (autoGlance) {
      enemy.appraisalTier = 1;
      upgradeEnemyAppraisal(state, enemy.templateId, 1);
      logs.push(
        `Your Star-Sap Lenses immediately measure ${getEnemyDisplayName(state, enemy)}: ${enemy.visibleGear.weapon}, ${enemy.visibleGear.armor}.`,
      );
      continue;
    }

    const dc = enemy.isBoss || enemy.isElite ? 13 : 11;
    const check = resolveCheck(state, 'wit', dc, {
      label: 'First Glance',
      extraBonus: weatherMod,
      isLoreOrPerception: true,
    });

    if (check.success) {
      enemy.appraisalTier = 1;
      upgradeEnemyAppraisal(state, enemy.templateId, 1);
      logs.push(
        `At a glance you gauge ${getEnemyDisplayName(state, enemy)}: ${enemy.visibleGear.weapon}, ${enemy.visibleGear.armor}.`,
      );
    }
  }

  return logs;
}

export function runActiveObserveCheck(state: GameState, enemyIdx: number): string[] {
  const combat = state.combat;
  if (!combat) return ['Not in combat.'];
  const enemy = combat.enemies[enemyIdx];
  if (!enemy || enemy.hp <= 0) return ['No living target there.'];

  if (combat.observedUsedThisRound) {
    return ['You have already studied the field this round.'];
  }
  combat.observedUsedThisRound = true;

  const tpl = ENEMIES[enemy.templateId];
  const weatherMod = WEATHER_DATA[state.clock.weather].observeMod;
  const dc = enemy.appraisalTier >= 1 ? 10 : enemy.isBoss || enemy.isElite ? 14 : 12;
  const check = resolveCheck(state, 'wit', dc, {
    label: 'Close Study',
    extraBonus: weatherMod,
    isLoreOrPerception: true,
  });

  if (check.success) {
    enemy.appraisalTier = 2;
    enemy.identified = true;
    upgradeEnemyAppraisal(state, enemy.templateId, 2);

    const condition = getHealthConditionLabel(enemy.hp, enemy.maxHp);
    const anatomyLines = renderAnatomyProse(enemy.name, tpl.anatomy, {
      gearLine: `${tpl.visibleGear.weapon}; ${tpl.visibleGear.armor}. ${tpl.visibleGear.hiddenDetail}`,
      conditionLine: condition,
    });
    const statLines = describeStatImpressions(enemy.stats, 2);
    const resLine = formatResistanceProfile(enemy.resistances);
    return [
      `You take the full measure of ${enemy.name} and record it in your Journal.`,
      ...anatomyLines,
      ...statLines,
      ...(resLine ? [`Affinities: ${resLine}`] : []),
    ];
  }

  if (enemy.appraisalTier === 0 && check.total >= dc - 3) {
    enemy.appraisalTier = 1;
    upgradeEnemyAppraisal(state, enemy.templateId, 1);
    return [
      `Through the ash-haze you catch rough outlines of ${getEnemyDisplayName(state, enemy)}: ${enemy.visibleGear.weapon}, ${enemy.visibleGear.armor}.`,
      ...describeStatImpressions(enemy.stats, 1),
    ];
  }

  return [
    `The shifting mist obscures ${getEnemyDisplayName(state, enemy)}'s true measure for now.`,
  ];
}
