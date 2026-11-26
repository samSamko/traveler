import type { WorldDatabase } from './db/loader.ts';
import type {
  ArmorTier,
  Character,
  CombatEnemy,
  CombatState,
  GameState,
} from './types.ts';
import { parseDiceExpr, rollAbilityTest, rollDice, rollDie } from './dice.ts';

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

  const hasDodgingDeath = pc.classFeatures.some((f) => f.startsWith('Dodging Death'));

  if (pc.hp < 0) {
    if (hasDodgingDeath && rollDie(2, state) === 1) {
      pc.hp = rollDie(4, state);
      pc.status = 'alive';
      logs.push(`${pc.name} drops below 0 HP, but Dodging Death triggers! Survives with ${pc.hp} HP.`);
      return logs;
    }
    pc.status = 'dead';
    logs.push(`${pc.name} drops to ${pc.hp} HP and is DEAD.`);
    return logs;
  }

  // Exactly 0 HP -> roll Broken (d4) (p. 29)
  pc.status = 'broken';
  const bRoll = rollDie(4, state);
  if (bRoll === 1) {
    const rounds = rollDie(4, state);
    const wakeHp = rollDie(4, state);
    pc.hp = wakeHp;
    pc.status = 'alive';
    pc.brokenNote = `Knocked out (${rounds} rounds), awakened with ${wakeHp} HP`;
    logs.push(`${pc.name} hits 0 HP [Broken d4=1]: unconscious ${rounds} rounds, awakens with ${wakeHp} HP.`);
  } else if (bRoll === 2) {
    const limbRoll = rollDie(6, state);
    const injury = limbRoll === 6 ? 'Lost eye' : 'Broken or severed limb';
    const wakeHp = rollDie(4, state);
    pc.hp = wakeHp;
    pc.status = 'alive';
    pc.brokenNote = injury;
    pc.notes.push(injury);
    logs.push(`${pc.name} hits 0 HP [Broken d4=2]: ${injury}! Recovers with ${wakeHp} HP.`);
  } else if (bRoll === 3) {
    const hours = rollDie(2, state);
    pc.brokenNote = `Hemorrhage (dies in ${hours}h unless treated; DR16/18)`;
    logs.push(`${pc.name} hits 0 HP [Broken d4=3]: Hemorrhage! Death in ${hours}h unless treated.`);
  } else {
    if (hasDodgingDeath && rollDie(2, state) === 1) {
      pc.hp = rollDie(4, state);
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

    return {
      instanceId: `enemy_${idx + 1}`,
      creatureId: def.id,
      name: enemyIds.length > 1 ? `${def.name} #${idx + 1}` : def.name,
      hp: def.hp,
      maxHp: def.hp,
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

  const living = state.party.members
    .filter((m) => m.status === 'alive')
    .map((m) => ({ id: m.id, score: m.abilities.agility + rollDie(6, state) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.id);

  const log: string[] = [
    `VIOLENCE! Enemies: ${enemies.map((e) => `${e.name} (${e.hp} HP)`).join(', ')}.`,
    ambush
      ? 'Ambush! Enemies strike first.'
      : hasWraith
        ? 'A Wraith is present — enemies always win initiative!'
        : `Initiative d6(${initRoll}): ${initiativeSide === 'pcs' ? 'PCs go first!' : 'Enemies go first!'}`,
  ];

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

  if (initiativeSide === 'enemies') {
    const enemyLogs = resolveAllActiveEnemyTurns(state);
    combat.log.push(...enemyLogs);
  }

  return combat;
}

function checkMoraleAfterDamage(state: GameState, combat: CombatState): string[] {
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
  options?: { useOmenMaxDmg?: boolean; useOmenLowerDr?: boolean },
): string[] {
  const combat = state.activeCombat;
  if (!combat) return ['No active combat.'];
  const pc = state.party.members[pcIndex];
  const enemy = combat.enemies[enemyIndex];
  if (!pc || pc.status !== 'alive') return ['Selected PC cannot fight.'];
  if (!enemy || enemy.status !== 'active') return ['Target enemy is not active.'];

  const logs: string[] = [];
  const hasRustingHook = pc.inventory.some((i) => i.name.includes('Rusting hook hand'));
  const weapon = pc.weaponBroken
    ? hasRustingHook
      ? { name: 'Rusting hook hand', damageDie: 'd6', ranged: false }
      : { name: 'Unarmed', damageDie: 'd2', ranged: false }
    : pc.weapon.id === 'unarmed' && hasRustingHook
      ? { name: 'Rusting hook hand', damageDie: 'd6', ranged: false }
      : pc.weapon;

  if (weapon.ranged && pc.ammo <= 0) {
    return [`${pc.name} has no ammo left for ${weapon.name}!`];
  }
  if (weapon.ranged) {
    pc.ammo -= 1;
  }

  const isInvisibleBoss = (enemy.invisibleRounds ?? 0) > 0;
  let baseDr = isInvisibleBoss ? Math.max(enemy.attackDr, 16) : enemy.attackDr;
  if (options?.useOmenLowerDr) {
    const om = spendOmen(pc, state);
    if (om.spent) {
      baseDr -= 4;
      logs.push(om.note);
    }
  }

  const ability = weapon.ranged ? 'presence' : 'strength';
  const test = rollAbilityTest(pc, ability, baseDr, state, {
    label: `${weapon.name} attack vs ${enemy.name}`,
  });
  logs.push(test.logLine);

  if (test.isFumble) {
    if (!pc.weaponBroken && pc.weapon.id !== 'unarmed') {
      pc.weaponBroken = true;
      logs.push(`${pc.name}'s ${pc.weapon.name} BREAKS on fumble! Falling back to Unarmed (d2).`);
    } else {
      logs.push(`${pc.name} fumbles wildly!`);
    }
    return logs;
  }

  if (!test.success) {
    logs.push(`${pc.name} misses ${enemy.name}.`);
    return logs;
  }

  let rawDmg = 0;
  if (options?.useOmenMaxDmg) {
    const om = spendOmen(pc, state);
    if (om.spent) {
      logs.push(om.note);
      const maxDie = Number.parseInt(weapon.damageDie.replace(/^.*d/, ''), 10) || 4;
      rawDmg = maxDie;
    } else {
      rawDmg = parseDiceExpr(weapon.damageDie, state);
    }
  } else {
    rawDmg = parseDiceExpr(weapon.damageDie, state);
  }

  if (test.isCrit) {
    rawDmg *= 2;
    if (enemy.armorDie) {
      enemy.armorDie = downgradeArmorDie(enemy.armorDie);
      enemy.armorTier = Math.max(0, enemy.armorTier - 1) as ArmorTier;
      logs.push(`CRIT! Double damage (${rawDmg}) and ${enemy.name}'s armor degrades!`);
    } else {
      logs.push(`CRIT! Double damage (${rawDmg})!`);
    }
  }

  const soaked = enemy.armorDie ? parseDiceExpr(enemy.armorDie, state) : 0;
  const finalDmg = Math.max(0, rawDmg - soaked);
  enemy.hp -= finalDmg;

  logs.push(
    `${pc.name} hits ${enemy.name} for ${rawDmg}${soaked > 0 ? ` - ${soaked} armor` : ''} = ${finalDmg} damage (${Math.max(0, enemy.hp)}/${enemy.maxHp} HP).`,
  );

  // Skeleton 5+ damage instant destruction rule (p. 60)
  if (enemy.creatureId === 'skeleton' && finalDmg >= 5 && enemy.hp > 0) {
    enemy.hp = 0;
    logs.push('5+ damage shatters the Blood-drenched Skeleton completely!');
  }

  // Boss sympathy hit reaction (Rotblack Sludge p. 15)
  const isBoss =
    enemy.creatureId === 'cannibal_warlock' ||
    enemy.creatureId === 'glass_cult_archon' ||
    enemy.creatureId === 'plague_alchemist' ||
    enemy.creatureId === 'blood_inquisitor';
  if (isBoss && finalDmg > 0 && pc.status === 'alive') {
    const sympTest = rollAbilityTest(pc, 'agility', 8, state, { label: 'Dodge raining gore/shards' });
    logs.push(sympTest.logLine);
    if (!sympTest.success) {
      const sympDmg = rollDie(4, state);
      pc.hp -= sympDmg;
      logs.push(`Sympathy backlash hits ${pc.name} for ${sympDmg} dmg (${pc.hp}/${pc.maxHp} HP)!`);
      logs.push(...applyBrokenOrDead(pc, state));
    }
  }

  if (enemy.hp <= 0) {
    enemy.status = 'dead';
    logs.push(`${enemy.name} is SLAIN!`);
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
  for (let atk = 0; atk < enemy.attacksPerRound; atk += 1) {
    if (pc.status !== 'alive') break;

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

    const def = rollAbilityTest(pc, 'agility', enemy.defenceDr, state, {
      label: `Defend vs ${enemy.name}`,
      isDefence: true,
    });
    logs.push(def.logLine);

    if (def.success) {
      if (def.isCrit) {
        logs.push(`${pc.name} crits on Defence and earns a FREE ATTACK!`);
        logs.push(...resolvePcAttack(state, targetPcIndex, enemyIndex));
      } else {
        logs.push(`${pc.name} dodges ${enemy.name}'s ${enemy.attackName}.`);
      }
      continue;
    }

    if (options?.breakShield && pc.hasShield) {
      pc.hasShield = false;
      logs.push(`${pc.name}'s shield SHATTERS to absorb all damage from ${enemy.name}!`);
      continue;
    }

    let dmg = parseDiceExpr(enemy.damageDie, state);
    if (def.isFumble) {
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

    const armorDie = armorTierToDie(pc.armorTier);
    const soaked = armorDie ? parseDiceExpr(armorDie, state) : 0;
    const shieldSoak = pc.hasShield ? 1 : 0;
    let omenSoak = 0;
    if (options?.useOmenReduceDmg && pc.omens > 0) {
      const om = spendOmen(pc, state);
      if (om.spent) {
        omenSoak = rollDie(6, state);
        logs.push(`${om.note} (-${omenSoak} damage)`);
      }
    }

    const finalDmg = Math.max(0, dmg - soaked - shieldSoak - omenSoak);
    pc.hp -= finalDmg;
    logs.push(
      `${enemy.name} hits ${pc.name} for ${dmg}${soaked + shieldSoak > 0 ? ` - ${soaked + shieldSoak} armor/shield` : ''} = ${finalDmg} dmg (${pc.hp}/${pc.maxHp} HP).`,
    );

    // Special enemy wound riders
    if (finalDmg > 0) {
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
          pc.notes.push('Zombie curse (dies in 2 days unless cured)');
          logs.push(`${pc.name} contracts the zombie curse!`);
        }
      } else if (enemy.creatureId === 'nesting_death') {
        const fTest = rollAbilityTest(pc, 'toughness', 12, state, { label: 'Resist Nesting Death venom' });
        logs.push(fTest.logLine);
        if (!fTest.success) {
          pc.notes.push('Spider-venom freeze (+2 DR for 1 hour)');
          logs.push(`${pc.name} freezes from spider venom!`);
        }
      } else if (enemy.creatureId === 'cannibal_warlock') {
        pc.notes.push('Severe flail burn (-2 Agility today)');
        logs.push(`${pc.name} suffers a severe burn from the red-hot flail!`);
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

  for (let i = 0; i < combat.enemies.length; i += 1) {
    const enemy = combat.enemies[i];
    if (enemy.status !== 'active') continue;
    if ((enemy.invisibleRounds ?? 0) > 0) {
      enemy.invisibleRounds = Math.max(0, (enemy.invisibleRounds ?? 0) - 1);
    }

    const livingIndices = state.party.members
      .map((m, idx) => ({ m, idx }))
      .filter((x) => x.m.status === 'alive')
      .map((x) => x.idx);
    if (livingIndices.length === 0) break;

    const isBoss =
      enemy.creatureId === 'cannibal_warlock' ||
      enemy.creatureId === 'glass_cult_archon' ||
      enemy.creatureId === 'plague_alchemist' ||
      enemy.creatureId === 'blood_inquisitor';

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

    const targetIdx = livingIndices[rollDie(livingIndices.length, state) - 1];
    logs.push(...resolveEnemyAttack(state, i, targetIdx));
  }
  return logs;
}

export function isCombatOver(state: GameState): { over: boolean; outcome: 'victory' | 'tpk' | 'ongoing' } {
  if (state.party.members.every((m) => m.status !== 'alive')) {
    return { over: true, outcome: 'tpk' };
  }
  const combat = state.activeCombat;
  if (!combat) return { over: true, outcome: 'victory' };
  const anyActiveEnemy = combat.enemies.some((e) => e.status === 'active');
  if (!anyActiveEnemy) {
    return { over: true, outcome: 'victory' };
  }
  return { over: false, outcome: 'ongoing' };
}

export function finishCombatIfEnded(state: GameState): string[] {
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
    state.activeCombat = null;
    state.mode = state.activeDungeon ? 'dungeon' : 'exploration';
    state.chronicle.push(`Survived combat against: ${defeatedNames}.`);
    logs.push(`Combat ends! Enemies: ${defeatedNames}.`);

    if (bossDefeated && state.activeDungeon) {
      state.activeDungeon.apexPacified = true;
      state.activeDungeon.hasBossKey = true;
      state.activeContract.bossSlain = true;
      if (state.activeContract.objectiveKind === 'slay_boss') {
        state.activeContract.objectiveSecured = true;
      }
      const keyName = state.activeDungeon.bossKeyName;
      const alivePc = state.party.members.find((m) => m.status === 'alive') ?? state.party.members[0];
      alivePc.inventory.push({ id: `boss_key_${Date.now()}`, name: keyName, kind: 'gear' });
      logs.push(`Looted ${keyName} from ${state.activeDungeon.bossName}!`);
      logs.push(`With its master dead, the apex horror in ${state.activeDungeon.centralHazardName} sinks to the bottom, dead yet dreaming.`);
    }
  }
  return logs;
}

export function rollReaction(state: GameState, modifier = 0): { roll: number; label: string } {
  const total = rollDice(2, 6, state) + modifier;
  if (total <= 3) return { roll: total, label: 'Kill!' };
  if (total <= 6) return { roll: total, label: 'Angered' };
  if (total <= 8) return { roll: total, label: 'Indifferent' };
  if (total <= 10) return { roll: total, label: 'Almost friendly' };
  return { roll: total, label: 'Helpful' };
}
