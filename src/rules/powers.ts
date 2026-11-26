import type { WorldDatabase } from '../db/loader.ts';
import type { GameState, InventoryItem } from '../types.ts';
import { rollAbilityTest, rollDie } from '../dice.ts';
import { applyBrokenOrDead, spendOmen } from '../combat.ts';

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
  let dr = 12;

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
    logs.push(`${scrollItem.name} activates! (${pc.powersRemaining}/${pc.powersMaxToday} daily Powers left). Effect: ${scrollItem.notes ?? ''}`);
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

    if (isDuplicate) {
      const fireDmg = rollDie(6, state);
      pc.hp -= fireDmg;
      logs.push(`ARCANE CATASTROPHE DUPLICATE (#${catRoll})! ${pc.name} explodes in screaming black fire (-${fireDmg} HP/round; water only feeds it)!`);
    } else {
      logs.push(`ARCANE CATASTROPHE (d20=${catRoll}): ${cat.text}`);
    }
  }

  logs.push(...applyBrokenOrDead(pc, state));
  if (state.party.members.every((m) => m.status === 'dead')) {
    state.mode = 'game_over';
    state.gameOverReason = 'The last PC succumbed to a miscast Power.';
  }

  return {
    castAttempted: true,
    success: false,
    catastropheTriggered,
    logs,
  };
}
