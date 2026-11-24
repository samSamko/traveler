import type { ArmorTier, GameState, PaleShiftId } from '../types.ts';
import { ITEMS } from '../content/items.ts';
import { getEffectiveStat, nextRandom, resolveCheck, rollDie } from '../dice.ts';
import { recordChronicle } from '../memory.ts';

export const PALE_SHIFTS: Record<
  PaleShiftId,
  {
    label: string;
    dawnProse: string;
    effectNote: string;
  }
> = {
  none: {
    label: 'Quiet Sky',
    dawnProse: 'Ash-clouds drift without omens.',
    effectNote: 'No active Pale-Shift.',
  },
  blood_ash_moon: {
    label: 'Blood-Ash Moon',
    dawnProse: 'A bruised copper moon hangs low through dawn mist, sharpening blade and fang.',
    effectNote: 'All physical strikes deal +2 damage across the Reach.',
  },
  silent_bells: {
    label: 'Silent Bells',
    dawnProse: 'Even the distant bronze bells of the Belfry fall eerily mute.',
    effectNote: 'Focus costs drop by 1 on cantrips and spells, minimum 1.',
  },
  root_bloom: {
    label: 'Root-Bloom',
    dawnProse: 'Pale spore-threads drift upward from cracked flagstones like dry snow.',
    effectNote: 'Blight and poison strike harder; foraging yields extra herbs.',
  },
  iron_frost: {
    label: 'Iron Frost',
    dawnProse: 'Rime coats iron hilts and buckles before sunrise.',
    effectNote: 'Cold damage bites deeper; armor repairs take steady hands.',
  },
};

export function rollArmorTierReduction(tier: ArmorTier, state: GameState): number {
  if (tier <= 0) return 0;
  if (tier === 1) return rollDie(2, state);
  if (tier === 2) return rollDie(4, state);
  return rollDie(6, state);
}

export function degradeArmor(state: GameState): string | null {
  const p = state.player;
  if (p.armorTierCurrent <= 0) return null;
  p.armorTierCurrent = (p.armorTierCurrent - 1) as ArmorTier;
  const armorName = p.equipment.armor ? ITEMS[p.equipment.armor]?.name ?? 'Armor' : 'Armor';
  if (p.armorTierCurrent === 0) {
    return `${armorName} splits apart under the impact and offers no tier protection until repaired.`;
  }
  return `${armorName} dents inward, dropping to Tier ${p.armorTierCurrent}.`;
}

export function repairEquippedArmor(state: GameState, checkHands = true): string[] {
  const p = state.player;
  const armor = p.equipment.armor ? ITEMS[p.equipment.armor] : undefined;
  const maxTier: ArmorTier = armor?.armorTier ?? 0;
  if (!armor || maxTier === 0) {
    return ['Your worn garment has no armor plates or links to mend.'];
  }
  if (p.armorTierCurrent >= maxTier) {
    return [`${armor.name} is already intact at Tier ${maxTier}.`];
  }
  if (checkHands && p.race !== 'durnfolk' && p.race !== 'grixi') {
    const check = resolveCheck(state, 'wit', 11, {
      label: 'Armor Repair',
      isCraftOrStealth: true,
    });
    if (!check.success) {
      return [check.logLine, `Your rivets slip; ${armor.name} remains at Tier ${p.armorTierCurrent}.`];
    }
    p.armorTierCurrent = (p.armorTierCurrent + 1) as ArmorTier;
    return [check.logLine, `You hammer bent plates back true. ${armor.name} is now Tier ${p.armorTierCurrent}.`];
  }
  p.armorTierCurrent = (p.armorTierCurrent + 1) as ArmorTier;
  return [`Steady craft restores ${armor.name} to Tier ${p.armorTierCurrent}.`];
}

export function spendGrace(state: GameState): boolean {
  if (state.player.grace <= 0) return false;
  state.player.grace -= 1;
  return true;
}

export function hasLightSourceEquipped(state: GameState): boolean {
  const p = state.player;
  if (p.heirloom === 'kiln_lantern') return true;
  for (const itemId of Object.values(p.equipment)) {
    const item = itemId ? ITEMS[itemId] : undefined;
    if (item?.traits?.includes('lightSource')) return true;
  }
  return false;
}

export function getEquippedVisibleTags(state: GameState): string[] {
  const tags: string[] = [];
  for (const itemId of Object.values(state.player.equipment)) {
    const item = itemId ? ITEMS[itemId] : undefined;
    if (item?.visibleTags) {
      for (const t of item.visibleTags) {
        if (!tags.includes(t)) tags.push(t);
      }
    }
  }
  return tags;
}

export function drinkDraught(state: GameState, itemId: string): string[] {
  const item = ITEMS[itemId];
  if (!item || item.slot !== 'draught') return ['That cannot be drunk as a draught.'];
  const p = state.player;
  const msgs: string[] = [`You unstopper and swallow ${item.name}.`];

  if (item.healHp) {
    p.hp = Math.min(p.maxHp, p.hp + item.healHp);
    msgs.push(`Restored ${item.healHp} HP.`);
  }
  if (item.restoreStamina) {
    p.stamina = Math.min(p.maxStamina, p.stamina + item.restoreStamina);
    msgs.push(`Restored ${item.restoreStamina} Stamina.`);
  }
  if (item.restoreFocus) {
    p.focus = Math.min(p.maxFocus, p.focus + item.restoreFocus);
    msgs.push(`Restored ${item.restoreFocus} Focus.`);
  }
  if (item.restoreResolve) {
    p.resolve = Math.min(p.maxResolve, p.resolve + item.restoreResolve);
    msgs.push(`Restored ${item.restoreResolve} Resolve.`);
  }
  if (item.cureNegative) {
    p.statuses = p.statuses.filter((s) => s.type === 'blessed' || s.type === 'guarded' || s.type === 'hidden');
    msgs.push('Blight, venom, and bleeding clear from your blood.');
  }
  if (item.draughtStatus) {
    p.statuses = p.statuses.filter((s) => s.type !== item.draughtStatus!.type);
    p.statuses.push({ ...item.draughtStatus });
  }
  if (item.draughtPurgeDefilement) {
    const before = p.defilement;
    p.defilement = Math.max(0, p.defilement - item.draughtPurgeDefilement);
    msgs.push(`Defilement drops from ${before} to ${p.defilement}.`);
  }
  if (item.draughtDefilement) {
    const hasBileSac = Object.values(p.bodyMods).includes('iron_maw_gland');
    const gain = hasBileSac ? Math.max(2, Math.floor(item.draughtDefilement / 2)) : item.draughtDefilement;
    p.defilement = Math.min(100, p.defilement + gain);
    msgs.push(`Alchemical residue raises Defilement by ${gain} to ${p.defilement}/100.`);
    if (p.defilement >= 75 && !hasBileSac) {
      p.statuses.push({ type: 'poisoned', turns: 2, power: 2 });
      msgs.push('Your stomach knots with bile-sickness from excess draughts.');
    }
  }
  return msgs;
}

export function applyWeaponCoating(state: GameState, itemId: string): string[] {
  const item = ITEMS[itemId];
  if (!item || item.slot !== 'coating' || !item.coatingDamageType) {
    return ['Cannot coat a weapon with that.'];
  }
  const weapon = state.player.equipment.mainHand ? ITEMS[state.player.equipment.mainHand] : undefined;
  state.player.weaponCoating = {
    name: item.name,
    damageType: item.coatingDamageType,
    bonusDamage: item.coatingBonusDamage ?? 3,
    charges: item.coatingCharges ?? 3,
  };
  return [
    `You brush ${item.name} along ${weapon?.name ?? 'your weapon'}, priming ${state.player.weaponCoating.charges} strikes.`,
  ];
}

export function castAshTextOutOfCombat(state: GameState, itemId: string): string[] {
  const item = ITEMS[itemId];
  if (!item || item.slot !== 'ash_text' || !item.ashTextEffect) {
    return ['Cannot read that as an Ash-Text.'];
  }
  const dc = item.ashTextDc ?? 12;
  const check = resolveCheck(state, 'wit', dc, {
    label: item.name,
    isLoreOrPerception: true,
  });
  const p = state.player;
  if (!check.success) {
    const ruinRoll = rollDie(4, state);
    if (ruinRoll === 1) {
      p.defilement = Math.min(100, p.defilement + 8);
      return [check.logLine, 'Ruin backlash scorches your tongue. Defilement rises by 8.'];
    }
    if (ruinRoll === 2) {
      p.hp = Math.max(1, p.hp - 5);
      return [check.logLine, 'Ruin backlash snaps ribs and ink-veins for 5 damage.'];
    }
    if (ruinRoll === 3) {
      const deg = degradeArmor(state);
      return [check.logLine, deg ?? 'Ruin shockwave rattles your pack and drains 3 Resolve.'];
    }
    p.resolve = Math.max(0, p.resolve - 4);
    return [check.logLine, 'Hollow bronze echoes from the vellum cost 4 Resolve.'];
  }

  if (item.ashTextEffect === 'star_ward') {
    p.statuses = p.statuses.filter((s) => s.type !== 'guarded' && s.type !== 'blessed');
    p.statuses.push({ type: 'guarded', turns: 4, power: 3 });
    p.statuses.push({ type: 'blessed', turns: 4, power: 2 });
    return [check.logLine, 'Silver wards wrap your shoulders in guarded calm and Edge.'];
  }
  const witBonus = Math.max(0, getEffectiveStat(state, 'wit'));
  p.focus = Math.min(p.maxFocus, p.focus + 4 + witBonus);
  return [check.logLine, 'The Ash-Text burns to clean ember-dust, steadying your focus for battle.'];
}

export function maybeRollPaleShiftAtDawn(state: GameState): string | null {
  const clock = state.clock;
  if (clock.paleShift !== 'none') {
    clock.paleShiftDaysLeft -= 1;
    if (clock.paleShiftDaysLeft <= 0) {
      const ended = PALE_SHIFTS[clock.paleShift].label;
      clock.paleShift = 'none';
      clock.paleShiftDaysLeft = 0;
      return `The ${ended} fades from the Gloaming Reach.`;
    }
    return null;
  }

  if (nextRandom(state) < 0.2) {
    const pool: PaleShiftId[] = ['blood_ash_moon', 'silent_bells', 'root_bloom', 'iron_frost'];
    const picked = pool[Math.floor(nextRandom(state) * pool.length)];
    clock.paleShift = picked;
    clock.paleShiftDaysLeft = 2 + Math.floor(nextRandom(state) * 2);
    const meta = PALE_SHIFTS[picked];
    recordChronicle(state, `Pale-Shift: ${meta.label}`, meta.dawnProse, 'lore');
    return `${meta.dawnProse} ${meta.effectNote}`;
  }
  return null;
}
