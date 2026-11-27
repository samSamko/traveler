import type { WorldDatabase } from './db/loader.ts';
import type {
  ArmorTier,
  Character,
  CombatEnemy,
  CombatState,
  GameState,
} from './types.ts';
import { canCarryMoreItems, ensureFeatureState, parseDiceExpr, rollAbilityTest, rollDice, rollDie } from './dice.ts';
import { getActiveMiseryEffects } from './rules/calendar.ts';
import { getTraitReactionModifier } from './rules/traits.ts';
import {
  getPartyPoltroonBonus,
  getPartyReactionFeatureBonus,
  initCombatClassFeatures,
  resolveCombatCompanionAndMaskPhase,
} from './rules/class_features.ts';
import {
  narrateArmorSoak,
  narrateEnemyHit,
  narratePcCrit,
  narratePcDodge,
  narratePcFumble,
  narratePcHit,
  narratePcKill,
  narratePcMiss,
} from './gm/narration.ts';

const BOSS_CREATURE_IDS = new Set([
  'cannibal_warlock',
  'glass_cult_archon',
  'plague_alchemist',
  'blood_inquisitor',
  'frost_matriarch',
  'root_hierophant',
  'bone_margrave',
  'salt_drowned_captain',
]);

const APEX_CREATURE_IDS = new Set([
  'gutworm',
  'abyssal_leviathan',
  'chasm_weaver',
]);

function downgradeArmorDie(die: string | null): string | null {
  if (die === 'd6') return 'd4';
  if (die === 'd4') return 'd2';
  return null;
}

function armorTierToDie(tier: ArmorTier): string | null {
  if (tier === 3) return 'd6';
  if (tier === 2) return 'd4';
  if (tier === 1) return 'd2';
  return null;
}

export function spendOmen(pc: Character, state: GameState): { spent: boolean; note: string } {
  if (pc.omens <= 0) {
    return { spent: false, note: `${pc.name} has no Omens remaining.` };
  }
  const hasEscapingFate = pc.classFeatures.some((f) => f.startsWith('Escaping Fate'));
  if (hasEscapingFate && rollDie(2, state) === 1) {
    return { spent: true, note: `${pc.name} invokes an Omen (Escaping Fate preserves it!).` };
  }
  pc.omens -= 1;
  return { spent: true, note: `${pc.name} spends 1 Omen (${pc.omens} left).` };
}

export function applyBrokenOrDead(pc: Character, state: GameState): string[] {
  const logs: string[] = [];
  if (pc.hp > 0) return logs;

  const fs = ensureFeatureState(pc);
  if ((fs.immortalTorchMinutes ?? 0) > 0) {
    pc.status = 'alive';
    logs.push(`Immortal Torch keeps ${pc.name} fighting at ${pc.hp} HP until the flame dies!`);
    return logs;
  }

  const hasDodgingDeath = pc.classFeatures.some((f) => f.startsWith('Dodging Death'));

  if (pc.hp < 0) {
    if (hasDodgingDeath && rollDie(2, state) === 1) {
      pc.hp = Math.min(pc.maxHp, rollDie(4, state));
      pc.status = 'alive';
      logs.push(`${pc.name} drops below 0 HP, but Dodging Death triggers! Survives with ${pc.hp} HP.`);
      return logs;
    }
    pc.status = 'dead';
    logs.push(`${pc.name} drops to ${pc.hp} HP and is DEAD.`);
    return logs;
  }

  // Exactly 0 HP -> roll Broken (d4) (p. 29)
  const bRoll = rollDie(4, state);
  if (bRoll === 1) {
    const rounds = rollDie(4, state);
    const wakeHp = Math.min(pc.maxHp, rollDie(4, state));
    if (state.mode === 'combat') {
      pc.status = 'broken';
      fs.downedRounds = rounds;
      fs.pendingWakeHp = wakeHp;
      pc.brokenNote = `Knocked out (${rounds} rounds left, wakes with ${wakeHp} HP)`;
      logs.push(`${pc.name} hits 0 HP [Broken d4=1]: unconscious ${rounds} round(s), will awaken with ${wakeHp} HP.`);
    } else {
      pc.hp = wakeHp;
      pc.status = 'alive';
      pc.brokenNote = null;
      logs.push(`${pc.name} hits 0 HP [Broken d4=1]: knocked out briefly, awakens with ${wakeHp} HP.`);
    }
  } else if (bRoll === 2) {
    const limbRoll = rollDie(6, state);
    const injury = limbRoll === 6 ? 'Lost eye' : 'Broken or severed limb';
    const rounds = rollDie(4, state);
    const wakeHp = Math.min(pc.maxHp, rollDie(4, state));
    pc.notes.push(injury);
    if (state.mode === 'combat') {
      pc.status = 'broken';
      fs.downedRounds = rounds;
      fs.pendingWakeHp = wakeHp;
      pc.brokenNote = injury;
      logs.push(`${pc.name} hits 0 HP [Broken d4=2]: ${injury}! Incapacitated ${rounds} round(s), wakes with ${wakeHp} HP.`);
    } else {
      pc.hp = wakeHp;
      pc.status = 'alive';
      pc.brokenNote = injury;
      logs.push(`${pc.name} hits 0 HP [Broken d4=2]: ${injury}! Recovers with ${wakeHp} HP.`);
    }
  } else if (bRoll === 3) {
    const hours = rollDie(2, state);
    pc.hp = 1;
    pc.status = 'alive';
    fs.hemorrhageHoursLeft = hours;
    pc.brokenNote = `Hemorrhage (dies in ${hours}h unless treated; DR16/18)`;
    logs.push(`${pc.name} hits 0 HP [Broken d4=3]: Hemorrhage! Conscious at 1 HP — death in ${hours}h unless treated (all tests DR${hours <= 1 ? 18 : 16}+).`);
  } else {
    if (hasDodgingDeath && rollDie(2, state) === 1) {
      pc.hp = Math.min(pc.maxHp, rollDie(4, state));
      pc.status = 'alive';
      logs.push(`${pc.name} rolled Broken d4=4 (Dead), but Dodging Death triggers! Revives with ${pc.hp} HP.`);
    } else {
      pc.status = 'dead';
      pc.brokenNote = 'Died at 0 HP';
      logs.push(`${pc.name} hits 0 HP [Broken d4=4]: DEAD.`);
    }
  }
  return logs;
}

export function startCombat(
  state: GameState,
  world: WorldDatabase,
  enemyIds: string[],
  ambush = false,
): CombatState {
  const enemies: CombatEnemy[] = enemyIds.map((id, idx) => {
    const def = world.creaturesById[id] ?? world.creaturesById.goblin;
    let attackName = def.attackName;
    let damageDie = def.damageDie;

    // Berserker random weapon (d4) (p. 59)
    if (def.id === 'berserker') {
      const wRoll = rollDie(4, state);
      const table = [
        { name: 'Long flail', die: 'd8' },
        { name: 'Heavy mace', die: 'd6' },
        { name: 'Chained sword', die: 'd6' },
        { name: 'Huge warhammer', die: 'd10' },
      ];
      attackName = table[wRoll - 1].name;
      damageDie = table[wRoll - 1].die;
    }

    const armorTier: ArmorTier =
      def.armorDie === 'd6' ? 3 : def.armorDie === 'd4' ? 2 : def.armorDie === 'd2' ? 1 : 0;

    let hp = def.hp;
    if (def.id === 'troll' && (state.trollVendettaCount ?? 0) > 0) {
      hp += 8 * state.trollVendettaCount!;
      damageDie = `${2 + state.trollVendettaCount!}d6`;
    }

    return {
      instanceId: `enemy_${idx + 1}`,
      creatureId: def.id,
      name: enemyIds.length > 1 ? `${def.name} #${idx + 1}` : def.name,
      hp,
      maxHp: hp,
      morale: def.morale,
      armorTier,
      armorDie: def.armorDie,
      attackName,
      damageDie,
      attackDr: def.attackDr,
      defenceDr: def.defenceDr,
      attacksPerRound: def.attacksPerRound,
      special: def.special,
      bounty: def.bounty,
      status: 'active',
      moraleCheckedHalf: false,
      isLeader: idx === 0,
    };
  });

  const hasWraith = enemies.some((e) => e.creatureId === 'wraith');
  const hasNestingDeath = enemies.some((e) => e.creatureId === 'nesting_death');
  const initRoll = rollDie(6, state);
  const initiativeSide: 'pcs' | 'enemies' =
    ambush || hasWraith || (hasNestingDeath && initRoll <= 4)
      ? 'enemies'
      : initRoll >= 4
        ? 'pcs'
        : 'enemies';

  const livingScored = state.party.members
    .filter((m) => m.status === 'alive')
    .map((m) => {
      const die = rollDie(6, state);
      return { id: m.id, name: m.name, die, score: m.abilities.agility + die };
    })
    .sort((a, b) => b.score - a.score);
  const living = livingScored.map((x) => x.id);

  const log: string[] = [
    `VIOLENCE! Enemies: ${enemies.map((e) => `${e.name} (${e.hp} HP)`).join(', ')}.`,
    ambush
      ? 'Ambush! Enemies strike first.'
      : hasWraith
        ? 'A Wraith is present — enemies always win initiative!'
        : `Initiative d6(${initRoll}): ${initiativeSide === 'pcs' ? 'PCs go first!' : 'Enemies go first!'}`,
  ];
  if (livingScored.length > 1) {
    log.push(
      `PC Turn Order (AGI+d6): ${livingScored.map((x) => `${x.name} (${x.score})`).join(' -> ')}.`,
    );
  }

  const combat: CombatState = {
    round: 1,
    initiativeSide,
    turnOrderPcIds: living,
    activeTurnIdx: 0,
    enemies,
    ambush,
    log,
  };

  state.activeCombat = combat;
  state.mode = 'combat';

  combat.log.push(...initCombatClassFeatures(state));

  // Start-of-battle Creature Specials & Catastrophes
  if (enemies.some((e) => e.creatureId === 'scum')) {
    const livingPcs = state.party.members.filter((m) => m.status === 'alive');
    if (livingPcs.length > 0) {
      const spotter = [...livingPcs].sort((a, b) => b.abilities.presence - a.abilities.presence)[0];
      const spot = rollAbilityTest(spotter, 'presence', 14, state, { label: 'Spot Scum ambush backstab' });
      combat.log.push(spot.logLine);
      if (!spot.success) {
        const victim = livingPcs[rollDie(livingPcs.length, state) - 1];
        const rawBackstab = rollDie(4, state) + 3;
        const aDie = armorTierToDie(victim.armorTier);
        const soaked = aDie ? parseDiceExpr(aDie, state) : 0;
        const dmg = Math.max(0, rawBackstab - soaked);
        victim.hp -= dmg;
        combat.log.push(`Bent, Scum backstabs ${victim.name} for ${dmg} dmg (${victim.hp}/${victim.maxHp} HP)!`);
        combat.log.push(...applyBrokenOrDead(victim, state));
      }
    }
  }
  if (enemies.some((e) => e.creatureId === 'undead_doll')) {
    for (const m of state.party.members) {
      if (m.status !== 'alive') continue;
      const gaze = rollAbilityTest(m, 'presence', 12, state, { label: "Meet Undead Doll's mad gaze" });
      combat.log.push(gaze.logLine);
      if (!gaze.success) {
        const r = rollDie(4, state);
        ensureFeatureState(m).paralyzedRounds = r;
        combat.log.push(`${m.name} freezes with fear for ${r} round(s)!`);
      }
    }
  }
  for (const m of state.party.members) {
    if (m.status === 'alive' && m.featureState?.skeletonPossessed) {
      const sk = rollAbilityTest(m, 'strength', 10, state, { label: 'Restrain possessed skeleton' });
      combat.log.push(sk.logLine);
      if (!sk.success) {
        const dmg = rollDie(4, state);
        m.hp -= dmg;
        combat.log.push(`${m.name}'s possessed skeleton wrenches violently (-${dmg} HP)!`);
        combat.log.push(...applyBrokenOrDead(m, state));
      }
    }
  }

  if (initiativeSide === 'enemies') {
    const enemyLogs = resolveAllActiveEnemyTurns(state);
    combat.log.push(...enemyLogs);
  }

  const earlyEnd = finishCombatIfEnded(state, world);
  if (earlyEnd.length > 0) {
    combat.log.push(...earlyEnd);
    return combat;
  }

  syncActiveCombatTurnPc(state);
  return combat;
}

/**
 * Advances activeTurnIdx to the next living PC in turnOrderPcIds and syncs state.party.activePcIndex.
 * Returns the party member index, or -1 if all living PCs have already acted this round.
 */
export function syncActiveCombatTurnPc(state: GameState): number {
  const combat = state.activeCombat;
  if (!combat) return -1;
  while (combat.activeTurnIdx < combat.turnOrderPcIds.length) {
    const pcId = combat.turnOrderPcIds[combat.activeTurnIdx];
    const pcIdx = state.party.members.findIndex((m) => m.id === pcId && m.status === 'alive');
    if (pcIdx >= 0) {
      state.party.activePcIndex = pcIdx;
      return pcIdx;
    }
    combat.activeTurnIdx += 1;
  }
  return -1;
}

export function checkMoraleAfterDamage(state: GameState, combat: CombatState): string[] {
  const logs: string[] = [];
  const active = combat.enemies.filter((e) => e.status === 'active');
  if (active.length === 0) return logs;

  const totalCount = combat.enemies.length;
  const downCount = combat.enemies.filter((e) => e.status !== 'active').length;
  const leaderDown = combat.enemies.some((e) => e.isLeader && e.status !== 'active');
  const halfDown = totalCount > 1 && downCount >= Math.ceil(totalCount / 2);

  for (const enemy of active) {
    if (enemy.morale === null) continue;
    const loneThird = active.length === 1 && enemy.hp <= Math.floor(enemy.maxHp / 3);
    const shouldCheck = leaderDown || (halfDown && !enemy.moraleCheckedHalf) || loneThird;
    if (!shouldCheck) continue;

    enemy.moraleCheckedHalf = true;
    const mRoll = rollDice(2, 6, state);
    if (mRoll > enemy.morale) {
      const outcomeRoll = rollDie(6, state);
      enemy.status = outcomeRoll <= 3 ? 'fled' : 'surrendered';
      logs.push(
        `${enemy.name} fails Morale 2d6(${mRoll}) > ${enemy.morale} and ${enemy.status === 'fled' ? 'FLEES!' : 'SURRENDERS!'}`,
      );
    } else {
      logs.push(`${enemy.name} holds Morale 2d6(${mRoll}) <= ${enemy.morale}.`);
    }
  }
  return logs;
}

export function resolvePcAttack(
  state: GameState,
  pcIndex: number,
  enemyIndex: number,
  options?: { useOmenMaxDmg?: boolean; useOmenLowerDr?: boolean; isFangedBite?: boolean; isBonusSwing?: boolean },
): string[] {
  const combat = state.activeCombat;
  if (!combat) return ['No active combat.'];
  const pc = state.party.members[pcIndex];
  const enemy = combat.enemies[enemyIndex];
  if (!pc || pc.status !== 'alive') return ['Selected PC cannot fight.'];
  if (!enemy || enemy.status !== 'active') return ['Target enemy is not active.'];

  const logs: string[] = [];
  combat.bloodDrawn = true;
  const fs = pc.featureState;
  if ((fs?.paralyzedRounds ?? 0) > 0) {
    const breakTest = rollAbilityTest(pc, 'presence', 14, state, { label: 'Break paralysis/fear' });
    logs.push(breakTest.logLine);
    if (!breakTest.success) {
      fs!.paralyzedRounds! -= 1;
      logs.push(`${pc.name} remains paralyzed/frozen this round!`);
      return logs;
    }
    fs!.paralyzedRounds = 0;
  }

  const hasRustingHook = pc.inventory.some((i) => i.name.includes('Rusting hook hand'));
  const weapon = options?.isFangedBite
    ? { id: 'fanged_bite', name: 'Fanged Bite', damageDie: 'd6', ranged: false }
    : pc.weaponBroken
      ? hasRustingHook
        ? { id: 'rusting_hook', name: 'Rusting hook hand', damageDie: 'd6', ranged: false }
        : { id: 'unarmed', name: 'Unarmed', damageDie: 'd2', ranged: false }
      : pc.weapon.id === 'unarmed' && hasRustingHook
        ? { id: 'rusting_hook', name: 'Rusting hook hand', damageDie: 'd6', ranged: false }
        : pc.weapon;

  if (weapon.ranged && weapon.id !== 'deaths_horseshoe' && pc.ammo <= 0) {
    return [`${pc.name} has no ammo left for ${weapon.name}!`];
  }
  if (weapon.ranged && weapon.id !== 'deaths_horseshoe') {
    pc.ammo -= 1;
  }

  const isInvisibleBoss = (enemy.invisibleRounds ?? 0) > 0;
  const isPiercing =
    weapon.id === 'knife' ||
    weapon.id === 'shortsword' ||
    weapon.id === 'bow' ||
    weapon.id === 'crossbow' ||
    weapon.id === 'shortbow' ||
    weapon.id === 'snakeskin_dagger';
  const specialDr10 =
    options?.isFangedBite ||
    weapon.id === 'brown_scimitar' ||
    weapon.id === 'ancestors_blade' ||
    weapon.id === 'deaths_horseshoe';
  let baseDr = isInvisibleBoss ? Math.max(enemy.attackDr, 16) : specialDr10 ? Math.min(enemy.attackDr, 10) : enemy.attackDr;
  if (enemy.creatureId === 'skeleton' && isPiercing) {
    baseDr = Math.max(baseDr, 14);
  }
  if (options?.useOmenLowerDr) {
    const om = spendOmen(pc, state);
    if (om.spent) {
      baseDr -= 4;
      logs.push(om.note);
    }
  }

  const poltroonMod = getPartyPoltroonBonus(state);
  const ability = weapon.ranged ? 'presence' : 'strength';
  const test = rollAbilityTest(pc, ability, baseDr, state, {
    label: `${weapon.name} attack vs ${enemy.name}`,
    extraMod: poltroonMod,
  });
  logs.push(`[Roll] ${test.logLine}`);

  const weaponDef = {
    id: weapon.id,
    tableRoll: null,
    name: weapon.name,
    damageDie: weapon.damageDie,
    ranged: weapon.ranged,
    twoHanded: false,
    silver: 0,
  };

  // Hamfund the Squire (Eurekia): 1 on d6 per swing kills squire & loses sword
  if (weapon.id === 'eurekia' && !fs?.squireDead) {
    const squireRoll = rollDie(6, state);
    if (squireRoll === 1) {
      if (fs) fs.squireDead = true;
      pc.weapon = { id: 'unarmed', tableRoll: null, name: 'Unarmed', damageDie: 'd2', ranged: false, twoHanded: false, silver: 0 };
      logs.push(`Hamfund the Squire is slain (d6=1) — the cursed sword Eurekia vanishes forever!`);
    }
  }

  if (test.isFumble) {
    logs.push(narratePcFumble(pc, weaponDef, enemy, state));
    if (!options?.isFangedBite && !pc.weaponBroken && pc.weapon.id !== 'unarmed') {
      pc.weaponBroken = true;
      logs.push(`${pc.name}'s ${pc.weapon.name} BREAKS on fumble! Falling back to Unarmed (d2).`);
    }
    return logs;
  }

  if (!test.success) {
    logs.push(narratePcMiss(pc, weaponDef, enemy, state));
    if (weapon.id === 'ancestors_blade' && rollDie(6, state) === 1) {
      const selfDmg = rollDie(4, state);
      pc.hp -= selfDmg;
      logs.push(`The Blade of your Ancestors sneers and "accidentally" cuts ${pc.name} for ${selfDmg} dmg (${pc.hp}/${pc.maxHp} HP)!`);
      logs.push(...applyBrokenOrDead(pc, state));
    }
    if (options?.isFangedBite && rollDie(6, state) <= 2) {
      logs.push(`Bite leaves ${pc.name} exposed — ${enemy.name} gets a free counterattack!`);
      logs.push(...resolveEnemyAttack(state, enemyIndex, pcIndex));
    }
    return logs;
  }

  let rawDmg = 0;
  const maxDieVal = Number.parseInt(weapon.damageDie.replace(/^.*d/, ''), 10) || 4;
  const dieCount = Number.parseInt(weapon.damageDie.split('d')[0], 10) || 1;
  if (fs?.wizardTeethCharges && fs.wizardTeethCharges > 0) {
    fs.wizardTeethCharges -= 1;
    rawDmg = dieCount * maxDieVal;
    logs.push(`Wizard Tooth flares! Automatic MAX damage (${rawDmg})!`);
  } else if (options?.useOmenMaxDmg) {
    const om = spendOmen(pc, state);
    if (om.spent) {
      logs.push(om.note);
      rawDmg = dieCount * maxDieVal;
    } else {
      rawDmg = parseDiceExpr(weapon.damageDie, state);
    }
  } else {
    rawDmg = parseDiceExpr(weapon.damageDie, state);
  }

  if (fs?.poisonedBladeUses && fs.poisonedBladeUses > 0) {
    fs.poisonedBladeUses -= 1;
    const pDmg = rollDie(6, state);
    rawDmg += pDmg;
    logs.push(`Poisoned blade sears ${enemy.name} for +d6(${pDmg}) extra damage!`);
  }
  if (!weapon.ranged && pc.arcaneCatastrophes.includes(14)) {
    rawDmg += 1;
  }
  if ((enemy.asleepRounds ?? 0) > 0) {
    enemy.asleepRounds = 0;
    logs.push(`${enemy.name} jolts awake!`);
  }

  let armorDegraded = false;
  if (test.isCrit) {
    rawDmg *= 2;
    if (enemy.armorDie) {
      enemy.armorDie = downgradeArmorDie(enemy.armorDie);
      enemy.armorTier = Math.max(0, enemy.armorTier - 1) as ArmorTier;
      armorDegraded = true;
    }
  }

  const soaked = enemy.armorDie ? parseDiceExpr(enemy.armorDie, state) : 0;
  const finalDmg = Math.max(0, rawDmg - soaked);
  enemy.hp -= finalDmg;

  if (test.isCrit) {
    logs.push(narratePcCrit(pc, weaponDef, enemy, finalDmg, state));
    if (armorDegraded) logs.push(`${enemy.name}'s armor degrades under the critical blow!`);
  } else {
    logs.push(narratePcHit(pc, weaponDef, enemy, finalDmg, state));
  }
  logs.push(
    `[Roll] ${pc.name} hits ${enemy.name} for ${rawDmg}${soaked > 0 ? ` - ${soaked} armor` : ''} = ${finalDmg} damage (${Math.max(0, enemy.hp)}/${enemy.maxHp} HP).`,
  );

  // Skeleton 5+ damage instant destruction rule (p. 60)
  if (enemy.creatureId === 'skeleton' && finalDmg >= 5 && enemy.hp > 0) {
    enemy.hp = 0;
    logs.push('5+ damage shatters the Blood-drenched Skeleton completely!');
  }

  // Signature class weapon on-hit effects
  if (weapon.id === 'snakeskin_dagger' && rawDmg === 1 && enemy.hp > 0) {
    enemy.hp = 0;
    logs.push(`The Snake-Skin Gift rolled 1 — deadly poison KILLS ${enemy.name} instantly!`);
  }
  if (weapon.id === 'deaths_horseshoe' && enemy.hp > 0 && enemy.maxHp <= 12 && rollDie(6, state) === 1) {
    enemy.hp = 0;
    logs.push(`The Shoe of Death's Horse smashes ${enemy.name}'s skull (1-in-6) — instant kill!`);
  }
  if (weapon.id === 'brown_scimitar' && finalDmg > 0 && enemy.hp > 0 && rollDie(6, state) === 1) {
    const rot = rollDie(6, state);
    enemy.hp -= rot;
    logs.push(`The Brown Scimitar inflicts potent sepsis (1-in-6): +${rot} rot damage!`);
  }

  // Fanged Bite 1-2 on d6 counterattack risk
  if (options?.isFangedBite && enemy.hp > 0 && rollDie(6, state) <= 2) {
    logs.push(`Bite leaves ${pc.name} exposed — ${enemy.name} gets a free counterattack!`);
    logs.push(...resolveEnemyAttack(state, enemyIndex, pcIndex));
  }

  // Hyphos' Enervating Snuff (Berserk): second attack per round
  if (fs?.berserkFight && !options?.isBonusSwing && enemy.hp > 0 && pc.status === 'alive') {
    logs.push(`${pc.name} swings again in Berserk frenzy!`);
    logs.push(...resolvePcAttack(state, pcIndex, enemyIndex, { isBonusSwing: true }));
  }

  // Boss sympathy hit reaction (Rotblack Sludge p. 15)
  const isBoss = BOSS_CREATURE_IDS.has(enemy.creatureId);
  if (isBoss && finalDmg > 0 && pc.status === 'alive') {
    const sympTest = rollAbilityTest(pc, 'agility', 8, state, { label: 'Dodge raining gore/shards' });
    logs.push(`[Roll] ${sympTest.logLine}`);
    if (!sympTest.success) {
      const sympDmg = rollDie(4, state);
      pc.hp -= sympDmg;
      logs.push(`Sympathy backlash hits ${pc.name} for ${sympDmg} dmg (${pc.hp}/${pc.maxHp} HP)!`);
      logs.push(...applyBrokenOrDead(pc, state));
    }
  }

  if (enemy.hp <= 0) {
    enemy.status = 'dead';
    logs.push(narratePcKill(pc, weaponDef, enemy, state));
    logs.push(`${enemy.name} is SLAIN!`);
  } else if (enemy.creatureId === 'troll' && enemy.hp <= 10 && rollDie(3, state) === 1) {
    enemy.status = 'fled';
    state.trollVendettaCount = (state.trollVendettaCount ?? 0) + 1;
    logs.push(`${enemy.name} recoils in cowardice and FLEES into the dark — it will return stronger!`);
  }

  logs.push(...checkMoraleAfterDamage(state, combat));
  return logs;
}

export function resolveEnemyAttack(
  state: GameState,
  enemyIndex: number,
  targetPcIndex: number,
  options?: { useOmenReduceDmg?: boolean; breakShield?: boolean },
): string[] {
  const combat = state.activeCombat;
  if (!combat) return [];
  const enemy = combat.enemies[enemyIndex];
  const pc = state.party.members[targetPcIndex];
  if (!enemy || enemy.status !== 'active' || !pc || pc.status !== 'alive') return [];

  const logs: string[] = [];
  if ((enemy.asleepRounds ?? 0) > 0) {
    enemy.asleepRounds! -= 1;
    logs.push(`${enemy.name} sleeps deeply (${enemy.asleepRounds} round(s) left).`);
    return logs;
  }
  const stunned = enemy.stunnedRounds ?? 0;
  if (stunned > 0) {
    enemy.stunnedRounds = stunned - 1;
    logs.push(`${enemy.name} is blinded/retching and loses its turn (${stunned - 1} round(s) left)!`);
    return logs;
  }
  if ((enemy.confusedRounds ?? 0) > 0) {
    enemy.confusedRounds! -= 1;
    const otherTarget = combat.enemies.find((e, idx) => idx !== enemyIndex && e.status === 'active');
    if (otherTarget && rollDie(2, state) === 1) {
      const cDmg = parseDiceExpr(enemy.damageDie, state);
      otherTarget.hp -= cDmg;
      logs.push(`${enemy.name} (confused) slashes ${otherTarget.name} for ${cDmg} dmg!`);
      if (otherTarget.hp <= 0) {
        otherTarget.status = 'dead';
        logs.push(`${otherTarget.name} is slain in the confusion!`);
      }
    } else {
      logs.push(`${enemy.name} babbles in confusion and wastes its turn!`);
    }
    return logs;
  }

  for (let atk = 0; atk < enemy.attacksPerRound; atk += 1) {
    if (pc.status !== 'alive') break;
    const fs = ensureFeatureState(pc);

    // Goblin attack curse: even hit or miss carries the curse (p. 58)
    if (enemy.creatureId === 'goblin' && !fs.goblinCurseDaysLeft) {
      fs.goblinCurseDaysLeft = rollDie(6, state);
      logs.push(`${enemy.name}'s spiteful gaze infects ${pc.name} with the Goblin Curse (${fs.goblinCurseDaysLeft} days unless slain)!`);
    }

    // Grotesque eye-beam always hits on 1-2 on d6 (p. 62)
    if (enemy.creatureId === 'grotesque' && rollDie(6, state) <= 2) {
      const beamDmg = rollDie(8, state);
      const soaked = armorTierToDie(pc.armorTier) ? parseDiceExpr(armorTierToDie(pc.armorTier)!, state) : 0;
      const finalDmg = Math.max(0, beamDmg - soaked - (pc.hasShield ? 1 : 0));
      pc.hp -= finalDmg;
      logs.push(`${enemy.name} unleashes Eye-beam (auto-hit) on ${pc.name}: ${beamDmg} - soak = ${finalDmg} dmg (${pc.hp}/${pc.maxHp} HP).`);
      logs.push(...applyBrokenOrDead(pc, state));
      continue;
    }

    const isUndead =
      enemy.creatureId === 'skeleton' ||
      enemy.creatureId === 'zombie' ||
      enemy.creatureId === 'wraith' ||
      enemy.creatureId === 'lich' ||
      enemy.creatureId === 'undead_doll' ||
      enemy.creatureId === 'slumbering_skeleton' ||
      enemy.creatureId === 'bone_margrave' ||
      enemy.creatureId === 'salt_drowned_captain' ||
      enemy.creatureId === 'bone_margrave' ||
      enemy.creatureId === 'salt_drowned_captain';
    const baseWeaponDefDr =
      !pc.weaponBroken && (pc.weapon.id === 'brown_scimitar' || pc.weapon.id === 'ancestors_blade')
        ? Math.min(enemy.defenceDr, 10)
        : enemy.defenceDr;
    const blindfoldShift = fs.blindfoldWorn ? (isUndead ? 2 : -4) : 0;
    const weaponDefDr = Math.max(4, baseWeaponDefDr + blindfoldShift);
    const def = rollAbilityTest(pc, 'agility', weaponDefDr, state, {
      label: `Defend vs ${enemy.name}`,
      isDefence: true,
      extraMod: getPartyPoltroonBonus(state),
    });
    logs.push(`[Roll] ${def.logLine}`);

    if (def.success) {
      if (def.isCrit) {
        logs.push(`${pc.name} crits on Defence and earns a FREE ATTACK!`);
        logs.push(...resolvePcAttack(state, targetPcIndex, enemyIndex));
      } else {
        logs.push(narratePcDodge(pc, enemy, state));
      }
      continue;
    }

    if ((options?.breakShield || fs.shieldBreakArmed) && pc.hasShield) {
      pc.hasShield = false;
      fs.shieldBreakArmed = false;
      logs.push(`${pc.name}'s shield SHATTERS to absorb all damage from ${enemy.name}!`);
      continue;
    }

    let dmg = parseDiceExpr(enemy.damageDie, state);
    if (def.isFumble) {
      if (fs.omenArmed === 'neutralize' && pc.omens > 0) {
        const om = spendOmen(pc, state);
        if (om.spent) {
          fs.omenArmed = undefined;
          logs.push(`${om.note} — neutralizes Defence Fumble!`);
        }
      } else {
        dmg *= 2;
        if (pc.armorTier > 0) {
          pc.armorTier = (pc.armorTier - 1) as ArmorTier;
          if (pc.armorTier === 0) {
            pc.armorMaxTier = 0;
            pc.armorName = 'Ruined armor';
            logs.push(`DEFENCE FUMBLE! Double damage (${dmg}) and ${pc.name}'s armor is RUINED!`);
          } else {
            logs.push(`DEFENCE FUMBLE! Double damage (${dmg}) and ${pc.name}'s armor drops to Tier ${pc.armorTier}!`);
          }
        } else {
          logs.push(`DEFENCE FUMBLE! Double damage (${dmg})!`);
        }
      }
    }

    const armorDie = armorTierToDie(pc.armorTier);
    const soaked = armorDie ? parseDiceExpr(armorDie, state) : 0;
    const shieldSoak = pc.hasShield ? 1 : 0;
    let omenSoak = 0;
    if ((options?.useOmenReduceDmg || fs.omenArmed === 'reduce_dmg') && pc.omens > 0) {
      const om = spendOmen(pc, state);
      if (om.spent) {
        omenSoak = rollDie(6, state);
        if (fs.omenArmed === 'reduce_dmg') fs.omenArmed = undefined;
        logs.push(`${om.note} (-${omenSoak} damage)`);
      }
    }

    const rawAfterSoak = Math.max(0, dmg - soaked - shieldSoak - omenSoak);
    let finalDmg = rawAfterSoak;
    if ((fs.tempHp ?? 0) > 0 && finalDmg > 0) {
      const absorbed = Math.min(fs.tempHp!, finalDmg);
      fs.tempHp! -= absorbed;
      finalDmg -= absorbed;
    }
    pc.hp -= finalDmg;
    if (rawAfterSoak > 0 && (fs.invisibleRounds ?? 0) > 0) {
      fs.invisibleRounds = 0;
      logs.push(`${pc.name}'s invisibility shatters upon taking damage!`);
    }
    if (rawAfterSoak === 0 && soaked + shieldSoak > 0) {
      logs.push(narrateArmorSoak(pc, enemy, state));
    } else {
      logs.push(narrateEnemyHit(enemy, pc.name, finalDmg, soaked + shieldSoak, state));
    }
    logs.push(
      `[Roll] ${enemy.name} hits ${pc.name} for ${dmg}${soaked + shieldSoak > 0 ? ` - ${soaked + shieldSoak} armor/shield` : ''} = ${rawAfterSoak} dmg (${pc.hp}/${pc.maxHp} HP).`,
    );

    // Special enemy wound riders
    if (finalDmg > 0 || rawAfterSoak > 0) {
      if (enemy.creatureId === 'scum' || enemy.creatureId === 'mongrel') {
        const dr = enemy.creatureId === 'mongrel' ? 12 : 10;
        const infTest = rollAbilityTest(pc, 'toughness', dr, state, { label: 'Resist filthy bite/blade' });
        logs.push(infTest.logLine);
        if (!infTest.success) {
          pc.infected = true;
          logs.push(`${pc.name} is INFECTED!`);
        }
      } else if (enemy.creatureId === 'wickhead' && rollDie(4, state) === 1) {
        pc.infected = true;
        logs.push(`${pc.name}'s wound from the filthy knife becomes INFECTED!`);
      } else if (enemy.creatureId === 'zombie') {
        const zTest = rollAbilityTest(pc, 'toughness', 8, state, { label: 'Resist zombie bite' });
        logs.push(zTest.logLine);
        if (!zTest.success) {
          fs.zombieCurseDaysLeft = 2;
          pc.notes.push('Zombie curse (dies in 2 days unless cured)');
          logs.push(`${pc.name} contracts the zombie curse!`);
        }
      } else if (enemy.creatureId === 'nesting_death') {
        const fTest = rollAbilityTest(pc, 'toughness', 12, state, { label: 'Resist Nesting Death venom' });
        logs.push(fTest.logLine);
        if (!fTest.success) {
          fs.spiderVenomHours = 1;
          pc.notes.push('Spider-venom freeze (+2 DR for 1 hour)');
          logs.push(`${pc.name} freezes from spider venom (+2 DR for 1h)!`);
        }
      } else if (enemy.creatureId === 'cannibal_warlock') {
        fs.flailBurnDay = state.calendar.day;
        pc.notes.push('Severe flail burn (-2 Agility today)');
        logs.push(`${pc.name} suffers a severe burn from the red-hot flail (+2 Agility DR today)!`);
      } else if (enemy.creatureId === 'wraith') {
        fs.wraithDrainFight = (fs.wraithDrainFight ?? 0) + 1;
        logs.push(`${enemy.name}'s freezing touch drains -1 STR/PRE/AGI from ${pc.name} for this fight!`);
      } else if (enemy.creatureId === 'lich') {
        fs.paralyzedRounds = 2;
        logs.push(`${enemy.name}'s paralyzing touch freezes ${pc.name} (Presence DR14 to break free)!`);
      } else if (enemy.creatureId === 'wyvern' && rollDie(10, state) <= 4) {
        const wTest = rollAbilityTest(pc, 'toughness', 14, state, { label: 'Resist Wyvern tail venom' });
        logs.push(wTest.logLine);
        if (!wTest.success) {
          fs.paralyzedRounds = 2;
          fs.paralyzedHours = 1;
          logs.push(`${pc.name} is paralyzed by Wyvern venom!`);
        }
      } else if (
        enemy.creatureId === 'gutworm' ||
        enemy.creatureId === 'abyssal_leviathan' ||
        enemy.creatureId === 'chasm_weaver'
      ) {
        const devTest = rollAbilityTest(pc, 'agility', 6, state, { label: 'Escape being devoured' });
        logs.push(devTest.logLine);
        if (!devTest.success) {
          pc.hp = -99;
          pc.status = 'dead';
          logs.push(`${enemy.name} SWALLOWS ${pc.name} WHOLE! Instant death.`);
        }
      }
    }

    logs.push(...applyBrokenOrDead(pc, state));
  }
  return logs;
}

export function resolveAllActiveEnemyTurns(state: GameState): string[] {
  const combat = state.activeCombat;
  if (!combat) return [];
  const logs: string[] = [];

  // Companions (Gore-Hound, Hawk) and Crumpled Monster Mask act before enemy swings
  logs.push(...resolveCombatCompanionAndMaskPhase(state));

  for (let i = 0; i < combat.enemies.length; i += 1) {
    const enemy = combat.enemies[i];
    if (enemy.status !== 'active') continue;
    if ((enemy.suffocatingRounds ?? 0) > 0) {
      enemy.suffocatingRounds! -= 1;
      const choke = rollDie(4, state);
      enemy.hp -= choke;
      logs.push(`${enemy.name} suffocates (Daemon of Capillaries): -${choke} HP (${Math.max(0, enemy.hp)}/${enemy.maxHp} HP).`);
      if (enemy.hp <= 0) {
        enemy.status = 'dead';
        logs.push(`${enemy.name} suffocates to death!`);
        continue;
      }
    }
    if ((enemy.invisibleRounds ?? 0) > 0) {
      enemy.invisibleRounds = Math.max(0, (enemy.invisibleRounds ?? 0) - 1);
    }
    if (enemy.creatureId === 'lich') {
      const bearer = state.party.members.find(
        (m) => m.status === 'alive' && m.inventory.some((it) => it.kind === 'unclean_scroll' || it.kind === 'sacred_scroll'),
      );
      if (bearer) {
        const sIdx = bearer.inventory.findIndex((it) => it.kind === 'unclean_scroll' || it.kind === 'sacred_scroll');
        const stolen = bearer.inventory.splice(sIdx, 1)[0];
        const sDmg = rollDie(6, state);
        bearer.hp -= sDmg;
        logs.push(`${enemy.name} drains ${stolen.name} and turns its Power on ${bearer.name} for ${sDmg} dmg!`);
        logs.push(...applyBrokenOrDead(bearer, state));
      }
    }

    const livingIndices = state.party.members
      .map((m, idx) => ({ m, idx }))
      .filter((x) => x.m.status === 'alive')
      .map((x) => x.idx);
    if (livingIndices.length === 0) break;

    const isBoss = BOSS_CREATURE_IDS.has(enemy.creatureId);

    if (isBoss && combat.round % 3 === 0) {
      const pRoll = rollDie(4, state);
      const tIdx = livingIndices[rollDie(livingIndices.length, state) - 1];
      const tPc = state.party.members[tIdx];
      if (pRoll <= 2) {
        const bolts = rollDie(2, state);
        let total = 0;
        for (let b = 0; b < bolts; b += 1) total += rollDie(6, state);
        tPc.hp -= total;
        logs.push(`${enemy.name} casts Nine Violet Signs (${bolts} lightning bolts) on ${tPc.name} for ${total} dmg (${tPc.hp}/${tPc.maxHp} HP)!`);
        logs.push(...applyBrokenOrDead(tPc, state));
      } else if (pRoll === 3) {
        const choke = rollDie(4, state);
        tPc.hp -= choke;
        logs.push(`${enemy.name} casts Daemon of Capillaries on ${tPc.name}: chokes for ${choke} dmg (${tPc.hp}/${tPc.maxHp} HP)!`);
        logs.push(...applyBrokenOrDead(tPc, state));
      } else {
        enemy.invisibleRounds = 2;
        logs.push(`${enemy.name} casts Ich-bin-luft and vanishes into thin air for 2 rounds (DR16 to hit)!`);
      }
    }

    const blindfoldTargetIdx =
      enemy.creatureId === 'skeleton' ||
      enemy.creatureId === 'zombie' ||
      enemy.creatureId === 'wraith' ||
      enemy.creatureId === 'lich' ||
      enemy.creatureId === 'undead_doll' ||
      enemy.creatureId === 'slumbering_skeleton' ||
      enemy.creatureId === 'bone_margrave' ||
      enemy.creatureId === 'salt_drowned_captain'
        ? livingIndices.find((idx) => state.party.members[idx].featureState?.blindfoldWorn)
        : undefined;

    // 25% chance enemy strikes a living Outcast follower or beast companion instead of a PC
    type AllyTarget =
      | { kind: 'follower'; followerIdx: number }
      | { kind: 'beast'; pcIdx: number; field: 'goreHoundHp' | 'hawkHp' | 'dogHp' | 'monkeyCount'; label: string };
    const allyPool: AllyTarget[] = [];
    state.party.followers.forEach((f, idx) => {
      if (f.status === 'alive') allyPool.push({ kind: 'follower', followerIdx: idx });
    });
    for (const pcIdx of livingIndices) {
      const m = state.party.members[pcIdx];
      const mfs = m.featureState;
      if (!mfs) continue;
      if ((mfs.goreHoundHp ?? 0) > 0) allyPool.push({ kind: 'beast', pcIdx, field: 'goreHoundHp', label: `${m.name}'s Ancient Gore-Hound` });
      if ((mfs.hawkHp ?? 0) > 0) allyPool.push({ kind: 'beast', pcIdx, field: 'hawkHp', label: `${m.name}'s Hawk` });
      if ((mfs.dogHp ?? 0) > 0) allyPool.push({ kind: 'beast', pcIdx, field: 'dogHp', label: `${m.name}'s Vicious Dog` });
      if ((mfs.monkeyCount ?? 0) > 0) allyPool.push({ kind: 'beast', pcIdx, field: 'monkeyCount', label: `${m.name}'s Feral Monkey` });
    }

    if (blindfoldTargetIdx === undefined && allyPool.length > 0 && rollDie(4, state) === 1) {
      const chosen = allyPool[rollDie(allyPool.length, state) - 1];
      const rawDmg = parseDiceExpr(enemy.damageDie, state);
      if (chosen.kind === 'follower') {
        const follower = state.party.followers[chosen.followerIdx];
        const armorLower = follower.armorName.toLowerCase();
        const soakDie = armorLower.includes('mail') || armorLower.includes('scale') ? 'd4' : armorLower.includes('leather') || armorLower.includes('padded') || armorLower.includes('hide') ? 'd2' : null;
        const soak = soakDie ? parseDiceExpr(soakDie, state) : 0;
        const dmg = Math.max(0, rawDmg - soak);
        follower.hp = Math.max(0, follower.hp - dmg);
        logs.push(`${enemy.name} strikes outcast ${follower.name} for ${dmg} dmg (${follower.hp}/${follower.maxHp} HP)!`);
        if (follower.hp <= 0) {
          follower.status = 'dead';
          logs.push(`${follower.name} is SLAIN!`);
        } else if (dmg > 0) {
          const highestPre = Math.max(0, ...livingIndices.map((idx) => state.party.members[idx].abilities.presence));
          const betrayal = getActiveMiseryEffects(state).counts.betrayal_morale;
          const moraleThreshold = follower.morale + highestPre - betrayal;
          const mRoll = rollDice(2, 6, state);
          if (mRoll > moraleThreshold) {
            follower.status = 'fled';
            logs.push(`${follower.name} panics (2d6=${mRoll} > ${moraleThreshold}) and FLEES!`);
          }
        }
      } else {
        const owner = state.party.members[chosen.pcIdx];
        const ofs = owner.featureState!;
        if (chosen.field === 'monkeyCount') {
          ofs.monkeyCount = Math.max(0, (ofs.monkeyCount ?? 1) - 1);
          logs.push(`${enemy.name} swats ${chosen.label} dead (${ofs.monkeyCount} remaining)!`);
        } else {
          const curHp = ofs[chosen.field] ?? 0;
          const nextHp = Math.max(0, curHp - rawDmg);
          ofs[chosen.field] = nextHp;
          logs.push(`${enemy.name} slashes ${chosen.label} for ${rawDmg} dmg (${nextHp} HP left)!`);
          if (nextHp <= 0) {
            logs.push(`${chosen.label} collapses DEAD!`);
          }
        }
      }
      continue;
    }

    const targetIdx = blindfoldTargetIdx ?? livingIndices[rollDie(livingIndices.length, state) - 1];
    logs.push(...resolveEnemyAttack(state, i, targetIdx));
  }

  // Tick unconscious Broken PCs (d4 rounds -> awaken with pendingWakeHp) and decrement PC invisibility
  for (const m of state.party.members) {
    const fs = m.featureState;
    if (m.status === 'broken' && fs?.downedRounds && fs.downedRounds > 0) {
      fs.downedRounds -= 1;
      if (fs.downedRounds <= 0) {
        m.hp = Math.min(m.maxHp, Math.max(1, fs.pendingWakeHp ?? 1));
        m.status = 'alive';
        m.brokenNote = m.notes[m.notes.length - 1] ?? null;
        fs.pendingWakeHp = undefined;
        logs.push(`${m.name} regains consciousness with ${m.hp} HP!`);
      }
    } else if (m.status === 'alive' && (fs?.invisibleRounds ?? 0) > 0) {
      fs!.invisibleRounds = Math.max(0, fs!.invisibleRounds! - 1);
    }
  }

  return logs;
}

export function isCombatOver(state: GameState): { over: boolean; outcome: 'victory' | 'tpk' | 'ongoing' } {
  if (state.party.members.every((m) => m.status === 'dead')) {
    return { over: true, outcome: 'tpk' };
  }
  const combat = state.activeCombat;
  if (!combat) return { over: true, outcome: 'victory' };
  const anyActiveEnemy = combat.enemies.some((e) => e.status === 'active');
  if (!anyActiveEnemy) {
    return { over: true, outcome: 'victory' };
  }
  if (state.party.members.every((m) => m.status !== 'alive')) {
    return { over: true, outcome: 'tpk' };
  }
  return { over: false, outcome: 'ongoing' };
}

function parseCreatureTrophy(enemy: CombatEnemy): { name: string; silverValue: number } | null {
  const b = enemy.bounty?.trim();
  if (!b || b.toLowerCase() === 'none') return null;
  const parts = b.split('/').map((p) => p.trim());
  const deadPart =
    parts.find((p) => /(head|skull|horn|teeth|ear|pelt|ectoplasm|gland|spike|sac|dust|talisman|lantern|crown|seal|sigil|pearl|fang|heart|dead|remains|corpse)/i.test(p) && !/captured/i.test(p)) ??
    parts.find((p) => /\d+\s*s/i.test(p) && !/captured/i.test(p)) ??
    parts[0];
  if (!deadPart) return null;
  const valMatch = deadPart.match(/(\d+)\s*(?:-\s*\d+\s*)?s\b/i);
  if (!valMatch) return null;
  const silverValue = Math.max(1, Number.parseInt(valMatch[1], 10));
  const cleanLabel = deadPart.replace(/\d+(?:\s*-\s*\d+)?\s*s\b/gi, '').replace(/\(\s*\)/g, '').trim();
  const baseCreature = enemy.name.replace(/\s+#\d+$/, '').split(',').pop()?.trim() || enemy.name;
  const trophyLabel = cleanLabel && cleanLabel.length >= 3 && !/^dead$/i.test(cleanLabel)
    ? `${baseCreature} ${cleanLabel}`
    : `${baseCreature} Trophy`;
  return { name: `${trophyLabel} (${silverValue}s)`, silverValue };
}

export function finishCombatIfEnded(state: GameState, world?: WorldDatabase): string[] {
  const check = isCombatOver(state);
  if (!check.over) return [];

  const combat = state.activeCombat;
  const logs: string[] = [];
  if (check.outcome === 'tpk') {
    state.mode = 'game_over';
    state.gameOverReason = 'All party members have fallen in combat.';
    state.activeCombat = null;
    logs.push('TOTAL PARTY KILL. None survived.');
  } else {
    const defeatedNames = combat ? combat.enemies.map((e) => `${e.name} (${e.status})`).join(', ') : '';
    const bossDefeated = Boolean(
      combat &&
        state.activeDungeon &&
        combat.enemies.some((e) => e.creatureId === state.activeDungeon?.bossEnemyId && e.status === 'dead'),
    );
    const anyGoblinEscaped = Boolean(
      combat?.enemies.some((e) => e.creatureId === 'goblin' && e.status !== 'dead'),
    );
    state.activeCombat = null;
    state.mode = state.activeDungeon ? 'dungeon' : 'exploration';
    state.chronicle.push(`Survived combat against: ${defeatedNames}.`);
    logs.push(`Combat ends! Enemies: ${defeatedNames}.`);

    const aftermaths = world?.proseFragments.combatAftermaths;
    if (aftermaths && aftermaths.length > 0) {
      const fresh = aftermaths
        .map((text, idx) => ({ id: `after_${idx}`, text }))
        .filter((c) => !state.recentProseIds.includes(c.id));
      const pool = fresh.length > 0 ? fresh : aftermaths.map((text, idx) => ({ id: `after_${idx}`, text }));
      const pick = pool[rollDie(pool.length, state) - 1];
      state.recentProseIds.push(pick.id);
      if (state.recentProseIds.length > 24) state.recentProseIds = state.recentProseIds.slice(-24);
      logs.push(pick.text);
    }

    for (const m of state.party.members) {
      const fs = m.featureState;
      if (!fs) continue;
      fs.wraithDrainFight = 0;
      fs.invisibleRounds = 0;
      fs.paralyzedRounds = 0;
      fs.berserkFight = false;
      fs.listOfSinsActive = false;
      fs.tempHp = 0;
      if ((fs.immortalTorchMinutes ?? 0) > 0 && m.hp <= 0 && m.status !== 'dead') {
        fs.immortalTorchMinutes = 0;
        m.status = 'dead';
        m.brokenNote = 'Collapsed as Immortal Torch went out';
        logs.push(`${m.name}'s Immortal Torch flickers out — ${m.name} collapses DEAD at ${m.hp} HP!`);
      }
      if (!anyGoblinEscaped && fs.goblinCurseDaysLeft) {
        fs.goblinCurseDaysLeft = undefined;
        logs.push(`${m.name}'s Goblin Curse lifts as the last goblin dies.`);
      }
      if (m.status === 'broken' && fs.downedRounds) {
        m.hp = Math.min(m.maxHp, Math.max(1, fs.pendingWakeHp ?? 1));
        m.status = 'alive';
        fs.downedRounds = 0;
        fs.pendingWakeHp = undefined;
        logs.push(`${m.name} comes to after battle with ${m.hp} HP.`);
      }
    }

    const preferredOrder = [
      state.party.members[state.party.activePcIndex],
      ...state.party.members,
    ].filter((m): m is Character => Boolean(m));

    // Rare creature bounty trophy drops (100% for bosses/apex beasts, 25% for standard kills)
    if (combat && state.party.members.some((m) => m.status === 'alive')) {
      for (const e of combat.enemies) {
        if (e.status !== 'dead') continue;
        const isBossOrApex = BOSS_CREATURE_IDS.has(e.creatureId) || APEX_CREATURE_IDS.has(e.creatureId);
        if (!isBossOrApex && rollDie(4, state) !== 1) continue;
        const trophy = parseCreatureTrophy(e);
        if (!trophy) continue;
        const carrier = preferredOrder.find((m) => m.status === 'alive' && canCarryMoreItems(m));
        if (carrier) {
          carrier.inventory.push({
            id: `trophy_${Date.now()}_${rollDie(999, state)}`,
            name: trophy.name,
            kind: 'treasure',
            silverValue: trophy.silverValue,
          });
          logs.push(`Bounty trophy recovered: ${carrier.name} takes ${trophy.name}.`);
        } else {
          logs.push(`No carry space left for ${trophy.name}.`);
        }
      }
    }

    if (bossDefeated && state.activeDungeon) {
      state.activeDungeon.apexPacified = true;
      state.activeDungeon.hasBossKey = true;
      state.activeContract.bossSlain = true;
      if (state.activeContract.objectiveKind === 'slay_boss') {
        state.activeContract.objectiveSecured = true;
      }
      const keyName = state.activeDungeon.bossKeyName;
      const alivePc = preferredOrder.find((m) => m.status === 'alive') ?? state.party.members[0];
      alivePc.inventory.push({ id: `boss_key_${Date.now()}`, name: keyName, kind: 'gear' });
      logs.push(`Looted ${keyName} from ${state.activeDungeon.bossName}!`);
      logs.push(`With its master dead, the apex horror in ${state.activeDungeon.centralHazardName} sinks to the bottom, dead yet dreaming.`);
    }
  }
  return logs;
}

export function rollReaction(state: GameState, modifier = 0): { roll: number; label: string } {
  const featBonus = getPartyReactionFeatureBonus(state).bonus;
  const betrayalPenalty = getActiveMiseryEffects(state).counts.betrayal_morale * 2;
  const total = rollDice(2, 6, state) + modifier + featBonus - betrayalPenalty;
  if (total <= 3) return { roll: total, label: 'Kill!' };
  if (total <= 6) return { roll: total, label: 'Angered' };
  if (total <= 8) return { roll: total, label: 'Indifferent' };
  if (total <= 10) return { roll: total, label: 'Almost friendly' };
  return { roll: total, label: 'Helpful' };
}

const PARLEY_EXEMPT_IDS = new Set([
  ...BOSS_CREATURE_IDS,
  ...APEX_CREATURE_IDS,
]);

export function canParleyInCombat(state: GameState): boolean {
  const combat = state.activeCombat;
  if (state.mode !== 'combat' || !combat) return false;
  if (combat.round !== 1 || combat.ambush || combat.parleyAttempted || combat.bloodDrawn) return false;
  const active = combat.enemies.filter((e) => e.status === 'active');
  if (active.length === 0) return false;
  if (active.some((e) => PARLEY_EXEMPT_IDS.has(e.creatureId))) return false;
  return active.some((e) => e.morale !== null);
}

export function resolveCombatParley(
  state: GameState,
  world: WorldDatabase,
  pcIndex: number,
): string[] {
  const combat = state.activeCombat;
  const pc = state.party.members[pcIndex];
  if (!combat || !pc || pc.status !== 'alive') return ['Cannot parley right now.'];
  if (!canParleyInCombat(state)) {
    return ['Parley is only possible in Round 1 against non-boss, thinking foes before blood is drawn.'];
  }

  combat.parleyAttempted = true;
  const traitMod = getTraitReactionModifier(pc, world);
  const react = rollReaction(state, traitMod);
  const logs: string[] = [
    `${pc.name} lowers their weapon and parleys (Reaction 2d6${traitMod >= 0 ? `+${traitMod}` : traitMod} = ${react.roll}: ${react.label}).`,
  ];

  if (react.roll >= 9) {
    for (const e of combat.enemies) {
      if (e.status === 'active') e.status = 'surrendered';
    }
    state.activeCombat = null;
    state.mode = state.activeDungeon ? 'dungeon' : 'exploration';
    if (state.activeDungeon) {
      state.activeDungeon.puzzleCluesFound = (state.activeDungeon.puzzleCluesFound ?? 0) + 1;
      logs.push('The foes stand down, muttering rough directions (+1 dungeon clue).');
    } else {
      logs.push('The roadside stalkers back off into the fog without drawing steel.');
    }
    state.chronicle.push(`Talked down ${combat.enemies[0]?.name ?? 'foes'} via parley.`);
    return logs;
  }

  if (react.roll >= 7) {
    state.activeCombat = null;
    state.mode = state.activeDungeon ? 'dungeon' : 'exploration';
    if (state.activeDungeon && state.activeDungeon.previousRoomId !== undefined) {
      const prevRoom = state.activeDungeon.rooms[state.activeDungeon.previousRoomId];
      if (prevRoom) {
        state.activeDungeon.currentRoomId = prevRoom.id;
        logs.push(`Indifferent stares follow you as you back cleanly into ${prevRoom.label}.`);
        return logs;
      }
    }
    logs.push('An uneasy truce holds just long enough for you to withdraw cleanly.');
    return logs;
  }

  logs.push('The parley fails — they snarl and close in for blood!');
  return logs;
}
