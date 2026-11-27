import type { WorldDatabase } from '../db/loader.ts';
import type { GameState, InventoryItem } from '../types.ts';
import { ensureFeatureState, rollAbilityTest, rollDice, rollDie } from '../dice.ts';
import { applyBrokenOrDead, checkMoraleAfterDamage, spendOmen } from '../combat.ts';
import { getActiveMiseryEffects, triggerSpecificOrRandomMisery } from './calendar.ts';

export interface CastScrollResult {
  castAttempted: boolean;
  success: boolean;
  catastropheTriggered: boolean;
  logs: string[];
}

export function canCastScrolls(state: GameState, pcIndex: number): { ok: boolean; reason?: string } {
  const pc = state.party.members[pcIndex];
  if (!pc || pc.status !== 'alive') return { ok: false, reason: 'PC cannot act.' };
  if (pc.classId === 'fanged_deserter') {
    return { ok: false, reason: `${pc.name} is illiterate and cannot read scrolls.` };
  }
  if (pc.dizzyHours > 0) {
    return { ok: false, reason: `${pc.name} is dizzy from a failed Power and cannot cast.` };
  }
  if (pc.powersRemaining <= 0) {
    return { ok: false, reason: `${pc.name} has 0 Power uses remaining today.` };
  }
  if (!pc.weaponBroken && pc.weapon.id === 'zweihander') {
    return { ok: false, reason: 'Scrolls never work while wielding a Zweihänder.' };
  }
  if (pc.armorTier >= 2 && !(pc.classId === 'heretical_priest' && pc.armorTier === 2)) {
    return { ok: false, reason: `Scrolls never work while wearing Tier ${pc.armorTier} armor.` };
  }
  if (state.activeDungeon && state.activeDungeon.rooms[state.activeDungeon.currentRoomId]?.silenced) {
    return { ok: false, reason: 'A Terrible Silence smothers all sound—Powers cannot be spoken here!' };
  }
  if (state.activeCombat?.enemies.some((e) => e.status === 'active' && e.creatureId === 'lich')) {
    return { ok: false, reason: 'No one can use Powers near an Undead Necromancer (Lich)!' };
  }
  return { ok: true };
}

export function castScroll(
  state: GameState,
  world: WorldDatabase,
  pcIndex: number,
  scrollItem: InventoryItem,
  options?: { useOmenLowerDr?: boolean },
): CastScrollResult {
  const eligibility = canCastScrolls(state, pcIndex);
  if (!eligibility.ok) {
    return {
      castAttempted: false,
      success: false,
      catastropheTriggered: false,
      logs: [eligibility.reason ?? 'Cannot cast scroll.'],
    };
  }

  const pc = state.party.members[pcIndex];
  const logs: string[] = [];
  const arcaneFade = getActiveMiseryEffects(state).counts.arcane_fade;
  let dr = 12 + arcaneFade * 2;
  if (arcaneFade > 0) {
    logs.push(`Arcane Fade Misery thickens the air (+${arcaneFade * 2} Power DR).`);
  }

  if (options?.useOmenLowerDr) {
    const om = spendOmen(pc, state);
    if (om.spent) {
      dr -= 4;
      logs.push(om.note);
    }
  }

  const test = rollAbilityTest(pc, 'presence', dr, state, {
    label: `Wield Power (${scrollItem.name})`,
  });
  logs.push(test.logLine);

  if (test.success) {
    pc.powersRemaining -= 1;
    logs.push(`${scrollItem.name} activates! (${pc.powersRemaining}/${pc.powersMaxToday} daily Powers left).`);
    const fs = ensureFeatureState(pc);
    const activeEnemies = state.activeCombat?.enemies.filter((e) => e.status === 'active') ?? [];
    const kind = scrollItem.scrollKind;
    const roll = scrollItem.scrollRoll ?? 0;

    if (kind === 'unclean') {
      if (roll === 1) {
        const count = Math.min(activeEnemies.length, rollDie(2, state));
        if (count > 0) {
          for (let i = 0; i < count; i += 1) {
            const dmg = rollDie(8, state);
            activeEnemies[i].hp -= dmg;
            logs.push(`  Fireball scorches ${activeEnemies[i].name} for d8(${dmg}) dmg (${Math.max(0, activeEnemies[i].hp)}/${activeEnemies[i].maxHp} HP)!`);
            if (activeEnemies[i].hp <= 0) {
              activeEnemies[i].status = 'dead';
              logs.push(`  ${activeEnemies[i].name} is SLAIN!`);
            }
          }
        } else {
          logs.push('  A roaring fireball blasts the dark stonework!');
        }
      } else if (roll === 2 && activeEnemies.length > 0) {
        activeEnemies[0].confusedRounds = 6;
        logs.push(`  ${activeEnemies[0].name} babbles in Tongue of Eris confusion!`);
      } else if (roll === 3) {
        if (state.activeDungeon) {
          const cur = state.activeDungeon.rooms[state.activeDungeon.currentRoomId];
          if (cur.trap && !cur.trapTriggered) {
            cur.trapSpotted = true;
            cur.trapTriggered = true;
            logs.push('  Telekinetic force jams and disarms the chamber trap!');
          }
        }
        fs.nextTestDrBonus = (fs.nextTestDrBonus ?? 0) - 4;
        logs.push('  Te-le-kin-esis grants -4 DR on your next physical/room check.');
      } else if (roll === 4) {
        fs.nextTestDrBonus = (fs.nextTestDrBonus ?? 0) - 6;
        logs.push(`  ${pc.name} hovers above the filth for ${pc.abilities.presence + rollDie(10, state)} rounds (-6 DR on next test).`);
      } else if (roll === 5 && activeEnemies.length > 0) {
        const d0 = rollDie(4, state);
        const rounds = Math.max(0, rollDie(6, state) - 1);
        activeEnemies[0].hp -= d0;
        activeEnemies[0].suffocatingRounds = rounds;
        logs.push(`  ${activeEnemies[0].name} chokes on blood (-${d0} HP, suffocating ${rounds} more round(s))!`);
        if (activeEnemies[0].hp <= 0) {
          activeEnemies[0].status = 'dead';
          logs.push(`  ${activeEnemies[0].name} suffocates!`);
        }
      } else if (roll === 6) {
        const bolts = rollDie(2, state);
        if (activeEnemies.length > 0) {
          for (let b = 0; b < bolts; b += 1) {
            const target = activeEnemies.find((e) => e.status === 'active') ?? activeEnemies[0];
            if (!target || target.status !== 'active') break;
            const dmg = rollDie(6, state);
            target.hp -= dmg;
            logs.push(`  Violet lightning strikes ${target.name} for d6(${dmg}) dmg (${Math.max(0, target.hp)}/${target.maxHp} HP)!`);
            if (target.hp <= 0) {
              target.status = 'dead';
              logs.push(`  ${target.name} is charred dead!`);
            }
          }
        } else {
          logs.push(`  ${bolts} violet lightning bolt(s) crackle harmlessly across the ceiling!`);
        }
      } else if (roll === 7) {
        fs.invisibleRounds = rollDie(6, state);
        logs.push(`  ${pc.name} vanishes from sight for ${fs.invisibleRounds} round(s) (attacks & defence DR6 until hit)!`);
      } else if (roll === 8) {
        const sub = rollDie(6, state);
        const count = rollDie(4, state);
        const form = sub <= 3 ? 'skeletons' : 'zombies';
        if (activeEnemies.length > 0) {
          const total = rollDice(count, 4, state);
          let rem = total;
          for (const e of activeEnemies) {
            if (rem <= 0) break;
            const dealt = Math.min(rem, e.hp);
            e.hp -= dealt;
            rem -= dealt;
            logs.push(`  ${count} summoned ${form} tear into ${e.name} for ${dealt} dmg!`);
            if (e.hp <= 0) {
              e.status = 'dead';
              logs.push(`  ${e.name} is torn apart!`);
            }
          }
        } else {
          fs.nextTestDrBonus = (fs.nextTestDrBonus ?? 0) - 2;
          logs.push(`  Summoned ${count} shambling ${form} march beside you (-2 DR on next test).`);
        }
      } else if (roll === 9 && activeEnemies.length > 0) {
        const targets = activeEnemies.slice(0, rollDie(4, state));
        for (const e of targets) {
          const resist = rollDie(20, state);
          if (resist < 14) {
            e.asleepRounds = 10;
            logs.push(`  ${e.name} (d20=${resist} < 14) collapses asleep!`);
          } else {
            logs.push(`  ${e.name} (d20=${resist} >= 14) resists sleep!`);
          }
        }
      } else if (roll === 10) {
        const total = rollDice(4, 10, state);
        if (activeEnemies.length > 0) {
          let rem = total;
          for (const e of activeEnemies) {
            if (rem <= 0) break;
            const dealt = Math.min(rem, e.hp);
            e.hp -= dealt;
            rem -= dealt;
            logs.push(`  DEATH harvests ${e.name} for ${dealt} dmg (${Math.max(0, e.hp)}/${e.maxHp} HP)!`);
            if (e.hp <= 0) {
              e.status = 'dead';
              logs.push(`  ${e.name} withers to dust!`);
            }
          }
        } else {
          logs.push(`  Wave of Death (4d10=${total}) extinguishes every vermin in 30 feet!`);
        }
      } else {
        logs.push(`  Effect: ${scrollItem.notes ?? ''}`);
      }
    } else if (kind === 'sacred') {
      if (roll === 1) {
        const maxCount = rollDie(2, state);
        const injured = state.party.members.filter((m) => m.status !== 'dead').slice(0, maxCount);
        for (const m of injured) {
          const heal = rollDie(10, state);
          const prev = m.hp;
          m.hp = Math.min(m.maxHp, m.hp + heal);
          if (m.status === 'broken' && m.hp > 0) m.status = 'alive';
          if (m.featureState) m.featureState.hemorrhageHoursLeft = undefined;
          logs.push(`  Grace of a Dead Saint heals ${m.name}: +${m.hp - prev} HP (${m.hp}/${m.maxHp}).`);
        }
      } else if (roll === 2) {
        fs.graceRollBonus = true;
        logs.push(`  Grace for a Sinner blesses ${pc.name}: +d6 on next roll!`);
      } else if (roll === 3) {
        if (state.activeDungeon) {
          state.activeContract.prophecyRevealed = true;
          const bossRoom = state.activeDungeon.rooms.find((r) => r.role === 'boss_lair');
          const vaultRoom = state.activeDungeon.rooms.find((r) => r.role === 'locked_vault');
          logs.push(`  The dead whisper: Omen #${(state.activeContract.prophecyTruthIndex ?? 0) + 1} is true! Boss in Room #${(bossRoom?.id ?? 0) + 1}, Vault in Room #${(vaultRoom?.id ?? 0) + 1}.`);
        } else {
          logs.push('  A cold spirit answers three silent questions in the wind.');
        }
      } else if (roll === 4) {
        const bonus = rollDice(2, 6, state);
        fs.tempHp = (fs.tempHp ?? 0) + bonus;
        logs.push(`  Aegis of Sorrow shrouds ${pc.name} with +${bonus} temporary HP!`);
      } else if (roll === 5) {
        const fallen = state.party.members.find((m) => m.status === 'dead');
        if (fallen) {
          fallen.status = 'alive';
          fallen.hp = Math.min(fallen.maxHp, rollDie(4, state));
          fallen.brokenNote = 'Awakened by Unmet Fate with terrible memories';
          logs.push(`  Unmet Fate wrenches ${fallen.name} back from death with ${fallen.hp} HP!`);
        } else {
          const heal = rollDie(6, state);
          const prev = pc.hp;
          pc.hp = Math.min(pc.maxHp, pc.hp + heal);
          logs.push(`  No corpse here to raise; lingering grace restores +${pc.hp - prev} HP to ${pc.name}.`);
        }
      } else if (roll === 6) {
        for (const e of activeEnemies) {
          if (e.creatureId === 'mongrel' || e.creatureId === 'nesting_death' || e.creatureId === 'wyvern') {
            e.status = 'fled';
            logs.push(`  Bestial Speech calms ${e.name}, who retreats!`);
          }
        }
        fs.nextTestDrBonus = (fs.nextTestDrBonus ?? 0) - 2;
        logs.push('  Bestial Speech (-2 DR on next exploration/scout test).');
      } else if (roll === 7) {
        for (const e of activeEnemies) {
          e.stunnedRounds = Math.max(e.stunnedRounds ?? 0, 1);
        }
        if (state.activeDungeon) {
          const cur = state.activeDungeon.rooms[state.activeDungeon.currentRoomId];
          if (cur.trap && !cur.trapSpotted) cur.trapSpotted = true;
        }
        logs.push('  False Dawn / Night Chariot blinds enemies for 1 round & illuminates the room!');
      } else if (roll === 8) {
        fs.hermeticTrapSteps = rollDice(2, 10, state);
        logs.push(`  Hermetic Step active: auto-detect all traps for ${fs.hermeticTrapSteps} moves.`);
      } else if (roll === 9) {
        const targets = activeEnemies.slice(0, rollDie(4, state));
        if (targets.length > 0) {
          for (const e of targets) {
            const dmg = rollDie(8, state);
            e.hp -= dmg;
            logs.push(`  Roskoe's Consuming Glare blasts ${e.name} for d8(${dmg}) dmg (${Math.max(0, e.hp)}/${e.maxHp} HP)!`);
            if (e.hp <= 0) {
              e.status = 'dead';
              logs.push(`  ${e.name} is incinerated!`);
            }
          }
        } else {
          logs.push('  Roskoe\'s Consuming Glare sears the dark stone!');
        }
      } else if (roll === 10 && activeEnemies.length > 0) {
        const target = activeEnemies[0];
        const isBoss =
          target.creatureId === 'cannibal_warlock' ||
          target.creatureId === 'glass_cult_archon' ||
          target.creatureId === 'plague_alchemist' ||
          target.creatureId === 'blood_inquisitor';
        if (isBoss) {
          const dmg = rollDie(8, state);
          target.hp -= dmg;
          target.stunnedRounds = 1;
          logs.push(`  Enochian Syntax shakes ${target.name} (-${dmg} HP & stunned 1 round)!`);
        } else {
          target.status = 'surrendered';
          logs.push(`  Enochian Syntax commands ${target.name} to drop its weapon and SURRENDER!`);
        }
      } else {
        logs.push(`  Effect: ${scrollItem.notes ?? ''}`);
      }
    }

    if (state.activeCombat) {
      logs.push(...checkMoraleAfterDamage(state, state.activeCombat));
    }
    return {
      castAttempted: true,
      success: true,
      catastropheTriggered: false,
      logs,
    };
  }

  // Failure: lose d2 HP, dizzy 1 hour (p. 34)
  const failDmg = rollDie(2, state);
  pc.hp -= failDmg;
  pc.dizzyHours = 1;
  logs.push(`Power fails! ${pc.name} loses ${failDmg} HP (${pc.hp}/${pc.maxHp}) and becomes dizzy for 1 hour.`);

  let catastropheTriggered = false;
  const proteanFumble = Boolean(scrollItem.proteanScroll) && test.naturalRoll <= 3;
  if (test.isFumble || proteanFumble) {
    catastropheTriggered = true;
    const catRoll = rollDie(20, state);
    const cat = world.arcaneCatastrophes.find((c) => c.roll === catRoll) ?? world.arcaneCatastrophes[0];
    const isDuplicate = pc.arcaneCatastrophes.includes(catRoll);
    pc.arcaneCatastrophes.push(catRoll);
    const fs = ensureFeatureState(pc);

    if (isDuplicate) {
      const fireDmg = rollDie(6, state);
      pc.hp -= fireDmg;
      logs.push(`ARCANE CATASTROPHE DUPLICATE (#${catRoll})! ${pc.name} explodes in screaming black fire (-${fireDmg} HP/round; water only feeds it)!`);
    } else {
      logs.push(`ARCANE CATASTROPHE (d20=${catRoll}): ${cat.text}`);
      if (catRoll === 1) {
        pc.hp = Math.max(0, pc.hp - 1);
      } else if (catRoll === 3) {
        fs.skeletonPossessed = true;
      } else if (catRoll === 5) {
        fs.waterSickens = true;
      } else if (catRoll === 6) {
        const pinches = rollDie(4, state);
        pc.hp -= pinches;
        logs.push(`  Crayfish-children pinch ${pc.name} for ${pinches} dmg!`);
      } else if (catRoll === 7) {
        pc.maxHp = Math.max(1, pc.maxHp - 2);
        pc.hp = Math.min(pc.hp, pc.maxHp);
      } else if (catRoll === 9) {
        state.calendar.day += 1;
        const m = triggerSpecificOrRandomMisery(state, world);
        logs.push(`  Thrown one day forward — MISERY ${m.code}: ${m.text}`);
      } else if (catRoll === 12) {
        fs.blindedHours = 1;
      } else if (catRoll === 16) {
        const pervert = rollDie(6, state);
        pc.hp -= pervert;
        logs.push(`  Demonic perversion tears into ${pc.name} for ${pervert} dmg!`);
      } else if (catRoll === 17) {
        const t17 = rollAbilityTest(pc, 'toughness', 14, state, { label: 'Inhale black powder' });
        logs.push(`  ${t17.logLine}`);
        if (!t17.success) {
          const pDmg = rollDie(10, state);
          pc.hp -= pDmg;
          logs.push(`  Black powder sears ${pc.name} for ${pDmg} HP!`);
        }
      } else if (catRoll === 19) {
        const cv = rollDie(4, state);
        if (cv === 1 || cv === 2) {
          const cDmg = rollDie(4, state);
          pc.hp -= cDmg;
          logs.push(`  Cube-Violet ordeal (${cv}) wounds ${pc.name} for ${cDmg} dmg!`);
        } else if (cv === 3) {
          const fDmg = rollDie(4, state);
          pc.hp -= fDmg;
          pc.inventory.push({ id: `cv_key_${Date.now()}`, name: 'Golden Cube-Violet Key (50s)', kind: 'treasure' });
          logs.push(`  Fingers burn to ash (-${fDmg} HP), grasping a Golden Key (50s)!`);
        } else {
          state.calendar.day += 1;
          logs.push('  Trapped in timeless silence for a day before Refva spits you back.');
        }
      } else if (catRoll === 20) {
        pc.hp = -99;
        pc.status = 'dead';
        logs.push(`  HE devours ${pc.name} instantaneously!`);
      }
    }
  }

  logs.push(...applyBrokenOrDead(pc, state));
  if (state.party.members.every((m) => m.status === 'dead')) {
    state.mode = 'game_over';
    state.activeCombat = null;
    state.gameOverReason = 'The last PC succumbed to a miscast Power.';
  }

  return {
    castAttempted: true,
    success: false,
    catastropheTriggered,
    logs,
  };
}
