import type { WorldDatabase } from '../db/loader.ts';
import type { Character, GameState, OutcastFollower, WeaponDef } from '../types.ts';
import {
  canCarryMoreItems,
  ensureFeatureState,
  getOriginRegionBonus,
  hasClassFeature,
  parseDiceExpr,
  rollAbilityTest,
  rollDice,
  rollDie,
} from '../dice.ts';

export { ensureFeatureState, getOriginRegionBonus, hasClassFeature };

export function grantBeastToPc(pc: Character, rawName: string, state: GameState): string {
  const fs = ensureFeatureState(pc);
  const lower = rawName.toLowerCase();
  if (lower.includes('horse')) {
    pc.carryingCapacity += 12;
    pc.inventory.push({ id: `beast_${Date.now()}_${rollDie(999, state)}`, name: 'Horse (pack & road mount)', kind: 'beast' });
    return `${pc.name} claims a gaunt Horse (+12 carry capacity, skips 1 travel hazard per contract)!`;
  }
  if (lower.includes('mule') || lower.includes('donkey')) {
    pc.carryingCapacity += 15;
    pc.inventory.push({ id: `beast_${Date.now()}_${rollDie(999, state)}`, name: rawName, kind: 'beast' });
    return `${pc.name} tethers ${rawName} (+15 carrying capacity)!`;
  }
  if (lower.includes('rat')) {
    fs.ratScout = true;
    pc.inventory.push({ id: `beast_${Date.now()}_${rollDie(999, state)}`, name: 'Rat (tame) (-2 trap/scout DR)', kind: 'beast' });
    return `${pc.name} pockets a Tame Rat (-2 DR spotting traps & secrets)!`;
  }
  const hp = lower.includes('wild') ? 5 : 6;
  fs.dogHp = (fs.dogHp ?? 0) + hp;
  pc.inventory.push({ id: `beast_${Date.now()}_${rollDie(999, state)}`, name: `${rawName} (${hp} HP, bite d4)`, kind: 'beast' });
  return `${pc.name} bonds with ${rawName} (${hp} HP, d4 bite in combat)!`;
}

function makeClassWeapon(id: string, name: string, damageDie: string, ranged = false, twoHanded = false): WeaponDef {
  return { id, tableRoll: null, name, damageDie, ranged, twoHanded, silver: 0 };
}

/**
 * Equips signature class weapons rolled from class features (preserving the base rolled weapon in inventory)
 * and initializes companion HP / state.
 */
export function applyClassFeatureStartingLoadout(pc: Character): void {
  const fs = ensureFeatureState(pc);
  let classWeapon: WeaponDef | null = null;

  if (hasClassFeature(pc, 'The Brown Scimitar of Galgenbeck')) {
    classWeapon = makeClassWeapon('brown_scimitar', 'The Brown Scimitar of Galgenbeck', 'd6', false, false);
  } else if (hasClassFeature(pc, "Old Sigûrd's Sling")) {
    classWeapon = makeClassWeapon('sigurds_sling', "Old Sigûrd's Sling", '2d4', true, false);
  } else if (hasClassFeature(pc, "The Shoe of Death's Horse")) {
    classWeapon = makeClassWeapon('deaths_horseshoe', "The Shoe of Death's Horse", 'd4', true, false);
  } else if (hasClassFeature(pc, 'The Blade of your Ancestors')) {
    classWeapon = makeClassWeapon('ancestors_blade', 'The Blade of your Ancestors', 'd6+1', false, false);
  } else if (hasClassFeature(pc, 'Hamfund the Squire')) {
    classWeapon = makeClassWeapon('eurekia', 'Eurekia (cursed greatsword)', '2d6', false, true);
  } else if (hasClassFeature(pc, 'The Snake-Skin Gift')) {
    classWeapon = makeClassWeapon('snakeskin_dagger', 'The Snake-Skin Gift (poison dagger)', 'd4', false, false);
  } else if (hasClassFeature(pc, "Sacred Shepherd's Crook")) {
    classWeapon = makeClassWeapon('shepherds_crook', "Sacred Shepherd's Crook", '2d4', false, true);
  }

  if (classWeapon) {
    if (pc.weapon && pc.weapon.id !== 'unarmed') {
      pc.inventory.push({
        id: `${pc.id}_backup_weapon`,
        name: `Backup weapon: ${pc.weapon.name} (${pc.weapon.damageDie})`,
        kind: 'gear',
      });
    }
    pc.weapon = classWeapon;
    if (classWeapon.ranged && pc.ammo <= 0) {
      pc.ammo = Math.max(10, pc.abilities.presence + 10);
    }
  }

  if (hasClassFeature(pc, 'Ancient Gore-Hound')) {
    fs.goreHoundHp = 10;
  }
  if (hasClassFeature(pc, 'Hawk as Weapon')) {
    fs.hawkHp = 8;
  }
  if (hasClassFeature(pc, 'Speaker of Truths')) {
    fs.speakerOfTruthsUsesToday = 2;
  }
}

export function initCombatClassFeatures(state: GameState): string[] {
  const logs: string[] = [];
  for (const pc of state.party.members) {
    if (pc.status !== 'alive') continue;
    const fs = ensureFeatureState(pc);
    fs.cowardsJabUsed = false;
    fs.listOfSinsActive = false;
    fs.berserkFight = false;
    fs.shieldBreakArmed = false;

    if (hasClassFeature(pc, 'Wizard Teeth')) {
      const rolls = [rollDie(6, state), rollDie(6, state), rollDie(6, state), rollDie(6, state)];
      const sixes = rolls.filter((r) => r === 6).length;
      fs.wizardTeethCharges = sixes;
      logs.push(`${pc.name} rattles Wizard Teeth (4d6): [${rolls.join(', ')}] -> ${sixes} max-damage charge(s)!`);
    }
    if (hasClassFeature(pc, 'Abominable Gob Lobber')) {
      fs.gobLobberUsesLeft = rollDie(2, state);
      logs.push(`${pc.name}'s Abominable Gob Lobber ready (${fs.gobLobberUsesLeft} spit use(s) this fight).`);
    }
    if (hasClassFeature(pc, "'Poltroon' the Court Jester")) {
      logs.push(`'Poltroon' the Court Jester capers wildly! Party gains +2 to attack/defence for rounds 1–2.`);
    }
    if (hasClassFeature(pc, 'Ancient Gore-Hound') && (fs.goreHoundHp ?? 10) > 0) {
      logs.push(`${pc.name}'s Ancient Gore-Hound snarls beside you (DR10 bite d6, ${fs.goreHoundHp ?? 10} HP).`);
    }
    if (hasClassFeature(pc, 'Hawk as Weapon') && (fs.hawkHp ?? 8) > 0) {
      logs.push(`${pc.name}'s loyal Hawk circles overhead (DR10 swoop d4, ${fs.hawkHp ?? 8} HP).`);
    }
  }
  return logs;
}

export function resolveCombatCompanionAndMaskPhase(state: GameState): string[] {
  const combat = state.activeCombat;
  if (!combat) return [];
  const logs: string[] = [];

  for (const pc of state.party.members) {
    if (pc.status !== 'alive') continue;
    const fs = ensureFeatureState(pc);
    const activeEnemy = combat.enemies.find((e) => e.status === 'active');
    if (!activeEnemy) break;

    if (hasClassFeature(pc, 'Ancient Gore-Hound') && (fs.goreHoundHp ?? 10) > 0) {
      const roll = rollDie(20, state);
      const frenzied = activeEnemy.creatureId === 'goblin' || activeEnemy.creatureId === 'berserker';
      const dr = frenzied ? 8 : 10;
      if (roll >= dr) {
        const dmg = rollDie(6, state);
        activeEnemy.hp -= dmg;
        logs.push(
          `Ancient Gore-Hound${frenzied ? ' (FRENZIED)' : ''} bites ${activeEnemy.name}: d20(${roll}) vs DR${dr} -> ${dmg} dmg (${Math.max(0, activeEnemy.hp)}/${activeEnemy.maxHp} HP).`,
        );
        if (activeEnemy.hp <= 0) {
          activeEnemy.status = 'dead';
          logs.push(`${activeEnemy.name} is torn apart by the Gore-Hound!`);
        }
      } else {
        logs.push(`Ancient Gore-Hound snaps at ${activeEnemy.name}: d20(${roll}) vs DR${dr} [MISS].`);
      }
    }

    const hawkTarget = combat.enemies.find((e) => e.status === 'active');
    if (hawkTarget && hasClassFeature(pc, 'Hawk as Weapon') && (fs.hawkHp ?? 8) > 0) {
      const roll = rollDie(20, state);
      if (roll >= 10) {
        const dmg = rollDie(4, state);
        hawkTarget.hp -= dmg;
        logs.push(
          `${pc.name}'s Hawk swoops at ${hawkTarget.name}: d20(${roll}) vs DR10 -> ${dmg} dmg (${Math.max(0, hawkTarget.hp)}/${hawkTarget.maxHp} HP).`,
        );
        if (hawkTarget.hp <= 0) {
          hawkTarget.status = 'dead';
          logs.push(`${hawkTarget.name} is slain by the Hawk!`);
        }
      } else {
        logs.push(`${pc.name}'s Hawk dives past ${hawkTarget.name}: d20(${roll}) vs DR10 [MISS].`);
      }
    }

    if (hasClassFeature(pc, 'Crumpled Monster Mask')) {
      for (const e of combat.enemies) {
        if (e.status !== 'active' || e.morale === null) continue;
        const isLesser = e.creatureId === 'goblin' || e.creatureId === 'scum' || e.creatureId === 'dusk_gnoum' || e.creatureId === 'skeleton' || e.maxHp <= 7;
        if (!isLesser) continue;
        const mRoll = rollDice(2, 6, state);
        if (mRoll > e.morale) {
          e.status = 'fled';
          logs.push(`Crumpled Monster Mask terrifies ${e.name}! Morale 2d6(${mRoll}) > ${e.morale} — FLEES!`);
        }
      }
    }

    // Starting Gear B #3 Small but vicious dog (bite d4) & #4 d4 monkeys
    const petTarget = combat.enemies.find((e) => e.status === 'active');
    if (petTarget && (fs.dogHp ?? 0) > 0) {
      const dRoll = rollDie(20, state);
      if (dRoll >= 12) {
        const dmg = rollDie(4, state);
        petTarget.hp -= dmg;
        logs.push(`${pc.name}'s Vicious Dog bites ${petTarget.name}: d20(${dRoll}) vs DR12 -> ${dmg} dmg!`);
        if (petTarget.hp <= 0) {
          petTarget.status = 'dead';
          logs.push(`${petTarget.name} is mauled to death by the dog!`);
        }
      }
    }
    const monkeyTarget = combat.enemies.find((e) => e.status === 'active');
    if (monkeyTarget && (fs.monkeyCount ?? 0) > 0 && rollDie(2, state) === 1) {
      const dmg = rollDie(4, state);
      monkeyTarget.hp -= dmg;
      logs.push(`${pc.name}'s monkeys swarm ${monkeyTarget.name} for ${dmg} bite/scratch dmg!`);
      if (monkeyTarget.hp <= 0) {
        monkeyTarget.status = 'dead';
        logs.push(`${monkeyTarget.name} collapses under feral monkeys!`);
      }
    }
  }

  // Active Outcast Followers attack & check morale
  const highestPre = Math.max(0, ...state.party.members.filter((m) => m.status === 'alive').map((m) => m.abilities.presence));
  for (const follower of state.party.followers) {
    if (follower.status !== 'alive') continue;
    const fTarget = combat.enemies.find((e) => e.status === 'active');
    if (!fTarget) break;
    const anyPcDown = state.party.members.some((m) => m.status !== 'alive');
    if (anyPcDown) {
      const fMorale = rollDice(2, 6, state);
      if (fMorale > follower.morale + highestPre) {
        follower.status = 'fled';
        logs.push(`${follower.name} loses nerve (2d6=${fMorale} > ${follower.morale}+${highestPre}) and FLEES!`);
        continue;
      }
    }
    const isBackstab = follower.specialty.includes('Backstab');
    const atkDr = isBackstab ? 8 : 12;
    const fRoll = rollDie(20, state);
    if (fRoll >= atkDr) {
      let dmg = rollDie(4, state);
      if (follower.specialty.includes('d4+2')) dmg += 2;
      else if (isBackstab) dmg += 3;
      else if (follower.weaponName.includes('+1')) dmg += 1;
      fTarget.hp -= dmg;
      logs.push(`${follower.name} strikes ${fTarget.name}: d20(${fRoll}) vs DR${atkDr} -> ${dmg} dmg!`);
      if (fTarget.hp <= 0) {
        fTarget.status = 'dead';
        logs.push(`${fTarget.name} falls to ${follower.name}!`);
      }
    }
  }

  return logs;
}

export function getPartyPoltroonBonus(state: GameState): number {
  if (!state.activeCombat || state.activeCombat.round > 2) return 0;
  const hasPoltroon = state.party.members.some(
    (m) => m.status === 'alive' && hasClassFeature(m, "'Poltroon' the Court Jester"),
  );
  return hasPoltroon ? 2 : 0;
}

export function getPartyReactionFeatureBonus(state: GameState): { bonus: number; note: string | null } {
  const bard = state.party.members.find(
    (m) => m.status === 'alive' && hasClassFeature(m, 'Bard of the Undying'),
  );
  if (!bard) return { bonus: 0, note: null };
  const bonus = rollDie(4, state);
  return { bonus, note: `Bard of the Undying's Harp adds +d4(${bonus}) to reaction!` };
}

export function activateClassFeature(
  state: GameState,
  world: WorldDatabase,
  pcIndex: number,
): string[] {
  const pc = state.party.members[pcIndex];
  if (!pc || pc.status !== 'alive') return ['Selected PC cannot use a class feature.'];
  const fs = ensureFeatureState(pc);
  const logs: string[] = [];
  const today = state.calendar.day;

  // 1. Combat-specific active features
  if (state.mode === 'combat' && state.activeCombat) {
    const enemy = state.activeCombat.enemies.find((e) => e.status === 'active');
    if (hasClassFeature(pc, "Coward's Jab") && !fs.cowardsJabUsed && state.activeCombat.round === 1 && enemy) {
      fs.cowardsJabUsed = true;
      const t = rollAbilityTest(pc, 'agility', 10, state, { label: "Coward's Jab" });
      logs.push(t.logLine);
      if (t.success) {
        const dmg = parseDiceExpr(pc.weapon.damageDie, state) + 3;
        enemy.hp -= dmg;
        logs.push(`Coward's Jab strikes ${enemy.name} for ${dmg} damage (${Math.max(0, enemy.hp)}/${enemy.maxHp} HP)!`);
        if (enemy.hp <= 0) {
          enemy.status = 'dead';
          logs.push(`${enemy.name} is SLAIN!`);
        }
      }
      return logs;
    }

    if (hasClassFeature(pc, 'Abominable Gob Lobber') && enemy) {
      const left = fs.gobLobberUsesLeft ?? 0;
      if (left <= 0) return [`${pc.name} has no Gob Lobber spits left this fight.`];
      fs.gobLobberUsesLeft = left - 1;
      const t = rollAbilityTest(pc, 'presence', 8, state, { label: 'Abominable Gob Lobber' });
      logs.push(t.logLine);
      if (t.success) {
        const rounds = rollDie(4, state);
        enemy.hp = Math.max(0, enemy.hp - 1);
        (enemy as { stunnedRounds?: number }).stunnedRounds = rounds;
        logs.push(`${enemy.name} is blinded and vomiting for ${rounds} round(s)!`);
      }
      return logs;
    }

    if (hasClassFeature(pc, 'List of Sins')) {
      const t = rollAbilityTest(pc, 'presence', 10, state, { label: 'Read List of Sins' });
      logs.push(t.logLine);
      if (t.success) {
        fs.listOfSinsActive = true;
        logs.push(`Strange light surrounds the wicked! ${pc.name} gains +2 Defence (-2 DR) for this fight.`);
      }
      return logs;
    }

    if (hasClassFeature(pc, '(Wrong Jesus) Crucifix') && enemy) {
      let affected = 0;
      for (const e of state.activeCombat.enemies) {
        if (e.status !== 'active' || e.morale === null) continue;
        const mRoll = rollDice(2, 6, state) + Math.max(0, pc.abilities.presence);
        if (mRoll > e.morale) {
          e.status = 'fled';
          affected += 1;
          logs.push(`(Wrong Jesus) Crucifix breaks ${e.name}! 2d6+PRE(${mRoll}) > ${e.morale} — bows and flees!`);
        } else {
          logs.push(`${e.name} resists the Crucifix: 2d6+PRE(${mRoll}) <= ${e.morale}.`);
        }
      }
      if (affected === 0 && logs.length === 0) {
        logs.push('Enemies here are mindless and ignore the Crucifix.');
      }
      return logs;
    }

    if (hasClassFeature(pc, 'Book of Boiling Blood')) {
      if (fs.dailyFeatureUsedDay === today) return ['Book of Boiling Blood has already been opened today.'];
      fs.dailyFeatureUsedDay = today;
      const count = rollDie(2, state);
      const alignRoll = rollDie(6, state);
      if (alignRoll <= 4 && enemy) {
        const dmg = rollDice(count, 8, state);
        enemy.hp -= dmg;
        logs.push(`Book of Boiling Blood summons ${count} allied Berserker-slayer(s) (d6=${alignRoll})! They hack ${enemy.name} for ${dmg} dmg!`);
        if (enemy.hp <= 0) {
          enemy.status = 'dead';
          logs.push(`${enemy.name} is SLAIN!`);
        }
      } else {
        const dmg = rollDie(6, state);
        pc.hp -= dmg;
        logs.push(`Book of Boiling Blood backfires (d6=${alignRoll})! A crazed Berserker-slayer slashes ${pc.name} for ${dmg} dmg (${pc.hp}/${pc.maxHp} HP)!`);
      }
      return logs;
    }
  }

  // 2. Exploration / Dungeon / Universal active features
  if (hasClassFeature(pc, 'Speaker of Truths')) {
    const uses = fs.speakerOfTruthsUsesToday ?? 2;
    if (uses <= 0) return ['Speaker of Truths has no uses left today.'];
    fs.speakerOfTruthsUsesToday = uses - 1;
    fs.nextTestDrBonus = (fs.nextTestDrBonus ?? 0) - 4;
    return [`${pc.name} invokes Speaker of Truths (${fs.speakerOfTruthsUsesToday} left today): next test DR lowered by 4!`];
  }

  if (hasClassFeature(pc, 'Initiate of the Invisible College')) {
    if (fs.dailyFeatureUsedDay === today) return ['Already summoned temporary scrolls today.'];
    fs.dailyFeatureUsedDay = today;
    const count = rollDie(2, state);
    for (let i = 0; i < count; i += 1) {
      const kind = rollDie(4, state) <= 2 ? 'sacred' : 'unclean';
      const pool = kind === 'sacred' ? world.sacredScrolls : world.uncleanScrolls;
      const s = pool[rollDie(pool.length, state) - 1];
      pc.inventory.push({
        id: `inv_col_${Date.now()}_${i}`,
        name: `${kind === 'sacred' ? 'Sacred' : 'Unclean'} Scroll: ${s.name} (ash at dawn)`,
        kind: kind === 'sacred' ? 'sacred_scroll' : 'unclean_scroll',
        scrollKind: kind,
        scrollRoll: s.roll,
        notes: s.effect,
        expiresAtDawn: true,
      });
      logs.push(`${pc.name} summons temporary ${kind} scroll: ${s.name} (turns to ash at sunrise).`);
    }
    return logs;
  }

  if (hasClassFeature(pc, 'The Blasphemous Nechrubel Bible')) {
    if (fs.dailyFeatureUsedDay === today) return ['The Blasphemous Nechrubel Bible has already been perused today.'];
    fs.dailyFeatureUsedDay = today;
    const roll = rollDie(6, state);
    if (roll % 2 === 0) {
      fs.bibleHealDay = today;
      return [`${pc.name} peruses the Blasphemous Nechrubel Bible (d6=${roll}, even): party heals +d4 extra HP on short rests all day!`];
    }
    fs.hallucinationDay = today;
    return [`${pc.name} peruses the Blasphemous Nechrubel Bible (d6=${roll}, odd): demonic hallucinations until sunrise (+2 DR on tests)!`];
  }

  if (hasClassFeature(pc, 'Horn of the Schleswig Lords!')) {
    if (fs.dailyFeatureUsedDay === today) return ['Horn of the Schleswig Lords! has already been blown today.'];
    fs.dailyFeatureUsedDay = today;
    const t = rollAbilityTest(pc, 'presence', 12, state, { label: 'Blow Horn of the Schleswig Lords' });
    logs.push(t.logLine);
    if (t.success) {
      fs.autoPassNextTest = true;
      logs.push(`The horn's note bends fate: ${pc.name}'s next non-combat test automatically succeeds!`);
    }
    return logs;
  }

  if (hasClassFeature(pc, 'Master of Fate')) {
    const t = rollAbilityTest(pc, 'presence', 8, state, { label: 'Master of Fate (read causality)' });
    logs.push(t.logLine);
    if (t.success && state.activeDungeon) {
      const d = state.activeDungeon;
      const bossRoom = d.rooms.find((r) => r.role === 'boss_lair');
      const vaultRoom = d.rooms.find((r) => r.role === 'locked_vault');
      logs.push(
        `Causality parts: ${d.bossName} lurks in Room #${(bossRoom?.id ?? 0) + 1}; ${state.activeContract.targetName} lies in Room #${(vaultRoom?.id ?? 0) + 1} behind ${d.puzzleStatueName}.`,
      );
    } else if (t.success) {
      logs.push(`Causality whispers: ${state.activeContract.dungeonName} lies ${state.activeContract.travelLegsRemaining} leg(s) ahead.`);
    }
    return logs;
  }

  if (hasClassFeature(pc, "Stones from Thel-Emas' Lost Temple")) {
    if (!state.activeDungeon) return ['Cast the Stones inside a dungeon to divine adjacent chambers.'];
    const t = rollAbilityTest(pc, 'presence', 10, state, { label: "Cast Thel-Emas' Stones" });
    logs.push(t.logLine);
    const d = state.activeDungeon;
    const cur = d.rooms[d.currentRoomId];
    const adjacent = cur.exits.map((id) => d.rooms[id]).filter(Boolean);
    if (t.success) {
      for (const r of adjacent) {
        const threats = [
          r.enemyIds.length > 0 ? `${r.enemyIds.length} foe(s)` : null,
          r.trap && !r.trapTriggered ? 'trap' : null,
          r.lockedByKey ? 'locked' : null,
        ].filter(Boolean);
        logs.push(`  Stones reveal Room #${r.id + 1} (${r.label}): ${threats.length > 0 ? threats.join(', ') : 'quiet'}.`);
      }
    } else {
      logs.push('The stones clatter into nonsense — you cannot tell truth from lie.');
    }
    return logs;
  }

  if (hasClassFeature(pc, 'Ancient Gore-Hound') && !state.activeCombat) {
    if (fs.dailyFeatureUsedDay === today) return ['Ancient Gore-Hound has already sniffed out hidden coin today.'];
    fs.dailyFeatureUsedDay = today;
    const found = rollDie(6, state);
    pc.silver += found;
    return [`Ancient Gore-Hound snuffles through filthy debris and digs up ${found}s!`];
  }

  return [
    pc.classFeatures.length > 0
      ? `${pc.name}'s class feature(s) apply automatically in combat or tests: ${pc.classFeatures.map((f) => f.split(':')[0]).join(', ')}.`
      : `${pc.name} has no active class feature to trigger.`,
  ];
}

export function useInventoryItem(
  state: GameState,
  _world: WorldDatabase,
  pcIndex: number,
  itemIndex: number,
  targetPcIndex?: number,
): string[] {
  const pc = state.party.members[pcIndex];
  if (!pc || pc.status !== 'alive') return ['Selected PC cannot use items.'];
  const item = pc.inventory[itemIndex];
  if (!item) return [`No item #${itemIndex + 1} in ${pc.name}'s inventory.`];
  const explicitTarget =
    targetPcIndex !== undefined ? state.party.members[targetPcIndex] : undefined;
  if (targetPcIndex !== undefined && (!explicitTarget || explicitTarget.status === 'dead')) {
    return [`Invalid or dead target PC #${targetPcIndex + 1}.`];
  }
  const targetPc = explicitTarget ?? pc;
  const targetFs = ensureFeatureState(targetPc);
  const fs = ensureFeatureState(pc);
  const logs: string[] = [];

  if (item.kind === 'unclean_scroll' || item.kind === 'sacred_scroll') {
    return ['Use "cast" or combat option 4 to cast scrolls.'];
  }

  const consumeOne = () => {
    if (typeof item.uses === 'number' && item.uses > 1) {
      item.uses -= 1;
    } else {
      pc.inventory.splice(itemIndex, 1);
    }
  };

  if (item.kind === 'medicine') {
    const lowerName = item.name.toLowerCase();
    if (lowerName.includes('water of life')) {
      const heal = rollDie(8, state);
      const prev = targetPc.hp;
      targetPc.hp = Math.min(targetPc.maxHp, targetPc.hp + heal);
      if (targetPc.status === 'broken' && targetPc.hp > 0) targetPc.status = 'alive';
      consumeOne();
      logs.push(
        targetPc === pc
          ? `${pc.name} gulps Water of Life: +${targetPc.hp - prev} HP (${targetPc.hp}/${targetPc.maxHp}).`
          : `${pc.name} pours Water of Life down ${targetPc.name}'s throat: +${targetPc.hp - prev} HP (${targetPc.hp}/${targetPc.maxHp}).`,
      );
      const blindTest = rollAbilityTest(targetPc, 'toughness', 10, state, { label: 'Endure Water of Life blindness' });
      logs.push(blindTest.logLine);
      if (!blindTest.success) {
        targetFs.blindedHours = 2;
        logs.push(`${targetPc.name} goes BLIND for 2 hours (+4 DR)!`);
      }
      return logs;
    }
    const heal = rollDie(6, state);
    const prev = targetPc.hp;
    targetPc.hp = Math.min(targetPc.maxHp, targetPc.hp + heal);
    if (targetPc.status === 'broken' && targetPc.hp > 0) targetPc.status = 'alive';
    targetPc.infected = false;
    targetFs.hemorrhageHoursLeft = undefined;
    targetFs.zombieCurseDaysLeft = undefined;
    if (targetPc.brokenNote?.includes('Hemorrhage')) targetPc.brokenNote = null;
    consumeOne();
    logs.push(
      targetPc === pc
        ? `${pc.name} uses ${item.name}: heals d6(${heal}) -> +${targetPc.hp - prev} HP (${targetPc.hp}/${targetPc.maxHp}), stops bleeding & infection.`
        : `${pc.name} treats ${targetPc.name} with ${item.name}: heals d6(${heal}) -> +${targetPc.hp - prev} HP (${targetPc.hp}/${targetPc.maxHp}), stops bleeding & infection.`,
    );
    return logs;
  }

  if (item.kind === 'food') {
    targetPc.foodDays += 5;
    targetPc.daysWithoutFood = 0;
    const heal = rollDie(4, state);
    const prev = targetPc.hp;
    targetPc.hp = Math.min(targetPc.maxHp, targetPc.hp + heal);
    if (targetPc.status === 'broken' && targetPc.hp > 0) targetPc.status = 'alive';
    consumeOne();
    logs.push(
      targetPc === pc
        ? `${pc.name} consumes ${item.name}: +5 food days, heals d4(${heal}) -> +${targetPc.hp - prev} HP (${targetPc.hp}/${targetPc.maxHp}).`
        : `${pc.name} feeds ${targetPc.name} ${item.name}: +5 food days, heals d4(${heal}) -> +${targetPc.hp - prev} HP (${targetPc.hp}/${targetPc.maxHp}).`,
    );
    return logs;
  }

  if (item.kind === 'poison') {
    fs.poisonedBladeUses = (fs.poisonedBladeUses ?? 0) + 1;
    consumeOne();
    logs.push(`${pc.name} coats ${pc.weapon.name} with ${item.name} (+d6 poison damage on next hit)!`);
    return logs;
  }

  if (item.kind === 'decoction') {
    const lower = item.name.toLowerCase();
    const enemy = state.activeCombat?.enemies.find((e) => e.status === 'active');
    consumeOne();

    if (lower.includes('elixir vitalis')) {
      const heal = rollDie(6, state);
      const prev = targetPc.hp;
      targetPc.hp = Math.min(targetPc.maxHp, targetPc.hp + heal);
      if (targetPc.status === 'broken' && targetPc.hp > 0) targetPc.status = 'alive';
      targetPc.infected = false;
      targetFs.hemorrhageHoursLeft = undefined;
      targetFs.zombieCurseDaysLeft = undefined;
      if (targetPc.brokenNote?.includes('Hemorrhage')) targetPc.brokenNote = null;
      logs.push(
        targetPc === pc
          ? `${pc.name} drinks Elixir Vitalis: heals d6(${heal}) -> +${targetPc.hp - prev} HP (${targetPc.hp}/${targetPc.maxHp}) and cures infection/curses!`
          : `${pc.name} administers Elixir Vitalis to ${targetPc.name}: heals d6(${heal}) -> +${targetPc.hp - prev} HP (${targetPc.hp}/${targetPc.maxHp}) and cures infection/curses!`,
      );
    } else if (lower.includes("fernor's philtre")) {
      targetPc.infected = false;
      targetFs.presenceBuffActive = true;
      logs.push(`${targetPc.name} dabs Fernor's Philtre: cures infection and grants +2 on Presence tests!`);
    } else if (lower.includes('spider-owl soup')) {
      fs.nextTestDrBonus = (fs.nextTestDrBonus ?? 0) - 4;
      logs.push(`${pc.name} drinks Spider-Owl Soup: sees in darkness & climbs walls (-4 DR on next test)!`);
    } else if (lower.includes('enervating snuff')) {
      fs.berserkFight = true;
      logs.push(`${pc.name} inhales Hyphos' Enervating Snuff: BERSERK! Two attacks per round, defend at DR14.`);
    } else if (lower.includes('red poison')) {
      if (enemy) {
        const dmg = rollDie(10, state);
        enemy.hp -= dmg;
        logs.push(`${pc.name} hurls Red Poison at ${enemy.name}: d10(${dmg}) damage (${Math.max(0, enemy.hp)}/${enemy.maxHp} HP)!`);
        if (enemy.hp <= 0) {
          enemy.status = 'dead';
          logs.push(`${enemy.name} dissolves in Red Poison!`);
        }
      } else {
        fs.poisonedBladeUses = (fs.poisonedBladeUses ?? 0) + 1;
        logs.push(`${pc.name} coats ${pc.weapon.name} in Red Poison (+d10 poison on next hit).`);
      }
    } else if (lower.includes('black poison')) {
      if (enemy) {
        const dmg = rollDie(6, state);
        enemy.hp -= dmg;
        (enemy as { stunnedRounds?: number }).stunnedRounds = 2;
        logs.push(`${pc.name} splashes Black Poison on ${enemy.name}: d6(${dmg}) damage and blinded for 2 rounds!`);
        if (enemy.hp <= 0) {
          enemy.status = 'dead';
          logs.push(`${enemy.name} dies of Black Poison!`);
        }
      } else {
        fs.poisonedBladeUses = (fs.poisonedBladeUses ?? 0) + 1;
        logs.push(`${pc.name} coats ${pc.weapon.name} in Black Poison (+d6 & blind on next hit).`);
      }
    } else if (lower.includes('ezumiels vapor') || lower.includes('southern frog stew')) {
      if (enemy) {
        const rounds = rollDie(4, state);
        (enemy as { stunnedRounds?: number }).stunnedRounds = rounds;
        logs.push(`${pc.name} hurls ${item.name} at ${enemy.name}: incapacitated for d4(${rounds}) round(s)!`);
      } else {
        logs.push(`${pc.name} uncorks ${item.name} into the stale air — best saved to throw at an enemy in combat.`);
      }
    } else {
      logs.push(`${pc.name} uses ${item.name}.`);
    }
    return logs;
  }

  const lower = item.name.toLowerCase();
  const enemy = state.activeCombat?.enemies.find((e) => e.status === 'active');

  if (lower.includes('bomb') || lower.includes('gunpowder cylinder')) {
    const isBig = lower.includes('gunpowder') || lower.includes('3d10');
    consumeOne();
    if (enemy) {
      const dmg = isBig ? rollDice(3, 10, state) : rollDie(10, state);
      enemy.hp -= dmg;
      logs.push(`${pc.name} hurls ${item.name} at ${enemy.name} for ${dmg} explosive damage (${Math.max(0, enemy.hp)}/${enemy.maxHp} HP)!`);
      if (enemy.hp <= 0) {
        enemy.status = 'dead';
        logs.push(`${enemy.name} is blown to ash!`);
      }
      return logs;
    }
    if (state.activeDungeon && !state.activeDungeon.hasBossKey) {
      state.activeDungeon.hasBossKey = true;
      return [`${pc.name} blasts open the locked iron latches with ${item.name}!`];
    }
    return [`${pc.name} hurls ${item.name}, shaking the dust from the ceiling.`];
  }

  if (lower.includes('bear trap')) {
    if (!enemy) return ['Best saved for combat to snap onto an enemy.'];
    consumeOne();
    const dmg = rollDie(8, state);
    enemy.hp -= dmg;
    enemy.stunnedRounds = Math.max(enemy.stunnedRounds ?? 0, 1);
    logs.push(`${pc.name} snaps a Bear Trap onto ${enemy.name} for d8(${dmg}) damage (${Math.max(0, enemy.hp)}/${enemy.maxHp} HP)!`);
    if (enemy.hp <= 0) {
      enemy.status = 'dead';
      logs.push(`${enemy.name} bleeds out in the iron jaws!`);
    }
    return logs;
  }

  if (item.kind === 'relic') {
    if (lower.includes('famine spoon') || lower.includes('silver bird cage')) {
      return [`${item.name} is too cursed for field use — sell it to the Quartermaster for silver.`];
    }
    if (lower.includes('ash-grey ring')) {
      if (!enemy) return ['Hold the Ash-grey ring for combat to obliterate a target.'];
      const aim = rollAbilityTest(pc, 'agility', 14, state, { label: 'Thrust Ash-grey ring' });
      logs.push(aim.logLine);
      if (aim.isFumble) {
        const selfDmg = rollDie(4, state);
        pc.hp -= selfDmg;
        logs.push(`The Ash-grey ring grazes ${pc.name}'s own finger for ${selfDmg} obliteration damage!`);
      } else if (aim.success) {
        const dmg = rollDice(2, 6, state);
        enemy.hp -= dmg;
        logs.push(`Anything inside the Ash-grey ring is OBLITERATED: ${enemy.name} takes 2d6(${dmg}) dmg (${Math.max(0, enemy.hp)}/${enemy.maxHp} HP)!`);
        if (enemy.hp <= 0) {
          enemy.status = 'dead';
          logs.push(`${enemy.name} vanishes into grey ash!`);
        }
      } else {
        logs.push(`${enemy.name} jerks clear of the ring's void!`);
      }
      return logs;
    }
    if (lower.includes('malevolently-accurate mirror')) {
      if (!enemy) return ['Best raised before a living foe in combat to shatter their nerve.'];
      if (enemy.morale !== null) {
        const mRoll = rollDice(2, 6, state) + 2;
        if (mRoll > enemy.morale) {
          enemy.status = 'fled';
          logs.push(`The Mirror reflects ${enemy.name}'s shameful soul (2d6+2=${mRoll} > ${enemy.morale}) — ${enemy.name} FLEES in horror!`);
        } else {
          enemy.stunnedRounds = Math.max(enemy.stunnedRounds ?? 0, 1);
          logs.push(`${enemy.name} recoils from its reflection and loses 1 round!`);
        }
      } else {
        const test = rollAbilityTest(pc, 'presence', 12, state, { label: 'Turn Mirror on soulless foe' });
        logs.push(test.logLine);
        if (test.success) {
          enemy.stunnedRounds = Math.max(enemy.stunnedRounds ?? 0, 1);
          logs.push(`${enemy.name} hesitates before the Mirror (stunned 1 round)!`);
        }
      }
      return logs;
    }
    if (lower.includes('immortal torch')) {
      fs.immortalTorchMinutes = 60;
      return [`${pc.name} sparks the Immortal Torch (burns 1h): holder cannot die below 0 HP while it burns!`];
    }
    if (lower.includes('black crown')) {
      fs.blackCrownWorn = !fs.blackCrownWorn;
      return [
        fs.blackCrownWorn
          ? `${pc.name} settles the Black Crown of the Crippled King (+10 attack / -10 defence; >=20 crits, <=1 fumbles)!`
          : `${pc.name} pulls off the heavy Black Crown.`,
      ];
    }
    if (lower.includes('ancient blindfold')) {
      fs.blindfoldWorn = !fs.blindfoldWorn;
      return [
        fs.blindfoldWorn
          ? `${pc.name} ties on the Ancient Blindfold: invisible to the living (+4 defence vs living), but undead hunt you (-2 defence vs undead)!`
          : `${pc.name} removes the Ancient Blindfold.`,
      ];
    }
    if (lower.includes('vampiric phurba') && enemy) {
      const dmg = rollDie(3, state);
      enemy.hp -= dmg;
      const prev = pc.hp;
      pc.hp = Math.min(pc.maxHp, pc.hp + dmg);
      logs.push(`${pc.name} plunges the Vampiric Phurba into ${enemy.name}: ${dmg} dmg, steals +${pc.hp - prev} HP!`);
      if (enemy.hp <= 0) {
        enemy.status = 'dead';
        logs.push(`${enemy.name} shrivels dry!`);
      }
      return logs;
    }
    if (lower.includes('vile flute') && enemy) {
      const dmg = rollDie(4, state);
      enemy.hp -= dmg;
      logs.push(`${pc.name} pipes the Vile Flute: a meat golem lurches out and bites ${enemy.name} for d4(${dmg}) dmg!`);
      if (enemy.hp <= 0) {
        enemy.status = 'dead';
        logs.push(`${enemy.name} is torn down!`);
      }
      return logs;
    }
    if (lower.includes('black pearl') && state.activeDungeon) {
      const d = state.activeDungeon;
      const bossRoom = d.rooms.find((r) => r.role === 'boss_lair');
      if (canCarryMoreItems(pc) && bossRoom) {
        logs.push(`The Black Pearl rolls unerringly toward daylight (Room #1 Entrance; Boss is in Room #${bossRoom.id + 1}).`);
        return logs;
      }
      return [`The Black Pearl rolls unerringly toward daylight (Room #1 Entrance; Boss is in Room #${(bossRoom?.id ?? 0) + 1}).`];
    }
  }

  return [`${item.name} cannot be directly used with "use" (it is passive gear or situational).`];
}

export function refreshDailyClassFeaturesAndDecoctions(
  pc: Character,
  state: GameState,
  world: WorldDatabase,
): string[] {
  const logs: string[] = [];
  const fs = ensureFeatureState(pc);

  if (hasClassFeature(pc, 'Speaker of Truths')) {
    fs.speakerOfTruthsUsesToday = 2;
  }
  fs.presenceBuffActive = false;

  // Expire dawn-expiring scrolls and old Herbmaster decoctions
  const beforeLen = pc.inventory.length;
  pc.inventory = pc.inventory.filter((i) => !i.expiresAtDawn);
  if (pc.inventory.length < beforeLen) {
    logs.push(`${pc.name}'s dawn-expiring scrolls/decoctions crumble or spoil at sunrise.`);
  }

  // Occult Herbmaster brews 2 fresh random decoctions (d4 total doses) each dawn (p. 56)
  if (pc.classId === 'occult_herbmaster' && pc.status !== 'dead') {
    const doses = rollDie(4, state);
    const r1 = rollDie(8, state);
    const r2 = rollDie(8, state);
    const d1 = world.herbmasterDecoctions.find((d) => d.roll === r1) ?? world.herbmasterDecoctions[0];
    const d2 = world.herbmasterDecoctions.find((d) => d.roll === r2) ?? world.herbmasterDecoctions[1];
    pc.inventory.push({
      id: `brew_${state.calendar.day}_1_${rollDie(999, state)}`,
      name: `Decoction: ${d1.name}`,
      kind: 'decoction',
      uses: Math.ceil(doses / 2),
      notes: d1.effect,
      expiresAtDawn: true,
    });
    if (doses > 1) {
      pc.inventory.push({
        id: `brew_${state.calendar.day}_2_${rollDie(999, state)}`,
        name: `Decoction: ${d2.name}`,
        kind: 'decoction',
        uses: Math.floor(doses / 2) || 1,
        notes: d2.effect,
        expiresAtDawn: true,
      });
    }
    logs.push(`${pc.name} brews fresh dawn decoctions (d4=${doses} doses): ${d1.name}${doses > 1 ? ` & ${d2.name}` : ''}.`);
  }

  return logs;
}

export function equipInventoryItem(
  state: GameState,
  world: WorldDatabase,
  pcIndex: number,
  itemIndex: number,
): string[] {
  const pc = state.party.members[pcIndex];
  if (!pc || pc.status !== 'alive') return ['Selected PC cannot equip items.'];
  const item = pc.inventory[itemIndex];
  if (!item) return [`No item #${itemIndex + 1} in ${pc.name}'s inventory.`];

  const lower = item.name.toLowerCase();
  if (item.kind === 'shield' || lower.includes('shield')) {
    pc.hasShield = true;
    return [`${pc.name} straps on ${item.name} (-1 incoming dmg or shatter to ignore 1 hit).`];
  }

  let newWeapon: WeaponDef | null = null;
  if (lower.includes('rusting hook')) {
    newWeapon = { id: 'rusting_hook', tableRoll: null, name: 'Rusting hook hand', damageDie: 'd6', ranged: false, twoHanded: false, silver: 0 };
  } else if (lower.includes('kergüs dagger') || lower.includes('kergus dagger')) {
    newWeapon = { id: 'kergus_dagger', tableRoll: null, name: 'Black Kergüs dagger', damageDie: '2d4', ranged: false, twoHanded: false, silver: 30 };
  } else if (lower.includes('crowbar')) {
    newWeapon = { id: 'crowbar', tableRoll: null, name: 'Crowbar', damageDie: 'd4', ranged: false, twoHanded: false, silver: 8 };
  } else if (lower.includes('small crossbow')) {
    newWeapon = { ...world.weaponsById.crossbow, name: 'Small crossbow', damageDie: 'd6' };
  } else {
    const matched = [...world.weapons]
      .filter((w) => w.id !== 'unarmed')
      .sort((a, b) => b.name.length - a.name.length)
      .find((w) => lower.includes(w.name.toLowerCase()));
    if (matched) newWeapon = { ...matched };
  }

  if (!newWeapon) {
    return [`${item.name} is not an equippable weapon or shield.`];
  }

  pc.inventory.splice(itemIndex, 1);
  if (pc.weapon && pc.weapon.id !== 'unarmed' && !pc.weaponBroken) {
    pc.inventory.push({
      id: `backup_wpn_${Date.now()}_${rollDie(999, state)}`,
      name: `Backup: ${pc.weapon.name} (${pc.weapon.damageDie})`,
      kind: 'gear',
    });
  }
  pc.weapon = newWeapon;
  pc.weaponBroken = false;
  if (newWeapon.ranged && pc.ammo <= 0) {
    pc.ammo = Math.max(6, pc.abilities.presence + 6);
  }
  return [`${pc.name} equips ${newWeapon.name} (${newWeapon.damageDie}).`];
}

export function giveBetweenPcs(
  state: GameState,
  fromPcIndex: number,
  rawArgs: string,
): string[] {
  const fromPc = state.party.members[fromPcIndex];
  if (!fromPc || fromPc.status !== 'alive') return ['Active PC cannot transfer items.'];
  const parts = rawArgs.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return ['Usage: give <item#> <pc#>  or  give <amount>s <pc#>'];
  }
  const targetPcNum = Number.parseInt(parts[1], 10);
  const toPc = state.party.members[targetPcNum - 1];
  if (Number.isNaN(targetPcNum) || !toPc) {
    return [`Invalid recipient PC #. Choose 1..${state.party.members.length}.`];
  }
  if (toPc === fromPc) return ['Cannot give items or silver to yourself.'];
  if (toPc.status === 'dead') return [`${toPc.name} is dead and cannot hold gear.`];

  const silverMatch = parts[0].match(/^(\d+)\s*s$/i);
  if (silverMatch) {
    const amount = Number.parseInt(silverMatch[1], 10);
    if (amount <= 0) return ['Amount must be > 0s.'];
    if (fromPc.silver < amount) return [`${fromPc.name} only has ${fromPc.silver}s.`];
    fromPc.silver -= amount;
    toPc.silver += amount;
    return [`${fromPc.name} hands ${amount}s to ${toPc.name} (${toPc.silver}s total).`];
  }

  const itemIdx = Number.parseInt(parts[0], 10) - 1;
  const item = fromPc.inventory[itemIdx];
  if (Number.isNaN(itemIdx) || !item) {
    return ['Invalid item #. Check "sheet".'];
  }
  if (!canCarryMoreItems(toPc)) {
    return [`${toPc.name} is already at maximum carrying limit (${toPc.carryingCapacity * 2}).`];
  }

  fromPc.inventory.splice(itemIdx, 1);
  if (item.kind === 'shield') {
    if (!fromPc.inventory.some((i) => i.kind === 'shield')) fromPc.hasShield = false;
    toPc.hasShield = true;
  }
  toPc.inventory.push(item);
  return [`${fromPc.name} passes ${item.name} to ${toPc.name}.`];
}

export function recruitOutcastFollower(
  state: GameState,
  world: WorldDatabase,
  options?: { costSilver?: number; pcIndex?: number },
): { ok: boolean; message: string } {
  const livingFollowers = state.party.followers.filter((f) => f.status === 'alive');
  if (livingFollowers.length >= 2) {
    return { ok: false, message: 'Party already travels with the maximum of 2 living Outcast followers.' };
  }
  const payer =
    state.party.members[options?.pcIndex ?? state.party.activePcIndex] ??
    state.party.members.find((m) => m.status === 'alive');
  if (options?.costSilver && options.costSilver > 0) {
    if (!payer || payer.silver < options.costSilver) {
      return {
        ok: false,
        message: `${payer?.name ?? 'Party'} needs ${options.costSilver}s to hire an Outcast follower.`,
      };
    }
    payer.silver -= options.costSilver;
  }

  const arch = world.outcasts[rollDie(world.outcasts.length, state) - 1];
  const trait = arch.traits[rollDie(arch.traits.length, state) - 1];
  const specialty = arch.specialties[rollDie(arch.specialties.length, state) - 1];
  const values = arch.values[rollDie(arch.values.length, state) - 1];
  const follower: OutcastFollower = {
    id: `outcast_${state.party.followers.length + 1}`,
    archetypeId: arch.id,
    name: `${arch.name} (${trait})`,
    hp: arch.hp,
    maxHp: arch.hp,
    morale: arch.morale,
    armorName: arch.armorName,
    weaponName: arch.weaponName,
    trait,
    specialty,
    values,
    status: 'alive',
  };
  state.party.followers.push(follower);
  state.chronicle.push(`Recruited outcast: ${follower.name}.`);
  const paidNote = options?.costSilver ? ` (-${options.costSilver}s)` : '';
  return {
    ok: true,
    message: `Outcast joins${paidNote}: ${follower.name} | HP ${follower.hp} | Morale ${follower.morale} | Specialty: ${specialty} | Values: ${values}.`,
  };
}
