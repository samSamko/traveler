import type { WorldDatabase } from '../db/loader.ts';
import type { GameState } from '../types.ts';
import { ensureFeatureState, rollDie } from '../dice.ts';
import { getActiveMiseryEffects, rollDawnMisery } from './calendar.ts';
import { refreshDailyClassFeaturesAndDecoctions } from './class_features.ts';

export function advanceWorldHours(state: GameState, hours: number): string[] {
  const logs: string[] = [];
  if (hours <= 0) return logs;
  state.calendar.hour = (state.calendar.hour + hours) % 24;

  for (const pc of state.party.members) {
    if (pc.status === 'dead') continue;
    const fs = ensureFeatureState(pc);
    if (pc.dizzyHours > 0) pc.dizzyHours = Math.max(0, pc.dizzyHours - hours);
    if ((fs.spiderVenomHours ?? 0) > 0) fs.spiderVenomHours = Math.max(0, fs.spiderVenomHours! - hours);
    if ((fs.bookDizzyHours ?? 0) > 0) fs.bookDizzyHours = Math.max(0, fs.bookDizzyHours! - hours);
    if ((fs.paralyzedHours ?? 0) > 0) fs.paralyzedHours = Math.max(0, fs.paralyzedHours! - hours);
    if ((fs.blindedHours ?? 0) > 0) fs.blindedHours = Math.max(0, fs.blindedHours! - hours);

    if ((fs.immortalTorchMinutes ?? 0) > 0) {
      fs.immortalTorchMinutes = Math.max(0, fs.immortalTorchMinutes! - hours * 60);
      if (fs.immortalTorchMinutes <= 0 && pc.hp <= 0) {
        pc.status = 'dead';
        pc.brokenNote = 'Immortal Torch burned out below 0 HP';
        logs.push(`${pc.name}'s Immortal Torch burns to ash — ${pc.name} collapses DEAD!`);
      }
    }

    if (fs.hemorrhageHoursLeft !== undefined && fs.hemorrhageHoursLeft > 0) {
      fs.hemorrhageHoursLeft -= hours;
      if (fs.hemorrhageHoursLeft <= 0) {
        fs.hemorrhageHoursLeft = 0;
        pc.hp = -1;
        pc.status = 'dead';
        pc.brokenNote = 'Bled out from hemorrhage';
        logs.push(`${pc.name} bleeds out from untreated hemorrhage and DIES!`);
      } else {
        logs.push(`${pc.name}'s hemorrhage worsens (${fs.hemorrhageHoursLeft}h left — all tests DR18!).`);
      }
    }
  }

  if (state.party.members.every((m) => m.status === 'dead') && state.mode !== 'game_over') {
    state.mode = 'game_over';
    state.gameOverReason = 'All party members bled out.';
  }

  return logs;
}

export function catchBreath(state: GameState): string[] {
  const logs: string[] = [];
  const hasSlowAura = state.party.members.some(
    (m) => m.status !== 'dead' && m.traits.troublingTale.includes('companions twice as slow'),
  );
  const hasBibleBlessing = state.party.members.some(
    (m) => m.status !== 'dead' && m.featureState?.bibleHealDay === state.calendar.day,
  );
  for (const pc of state.party.members) {
    if (pc.status === 'dead') continue;
    if (pc.infected) {
      logs.push(`${pc.name} is infected and gains no HP from resting.`);
      continue;
    }
    if (pc.daysWithoutFood >= 2) {
      logs.push(`${pc.name} is starving and gains no HP from resting.`);
      continue;
    }
    let heal = rollDie(4, state) + (hasBibleBlessing ? rollDie(4, state) : 0);
    if (pc.traits.troublingTale.includes('flesh heals twice as fast')) {
      heal *= 2;
    } else if (hasSlowAura) {
      heal = Math.max(1, Math.floor(heal / 2));
    }
    if (pc.arcaneCatastrophes.includes(18)) {
      heal = Math.max(1, Math.floor(heal / 2));
    }
    const before = pc.hp;
    pc.hp = Math.min(pc.maxHp, pc.hp + heal);
    if (pc.status === 'broken' && pc.hp > 0) {
      pc.status = 'alive';
      pc.brokenNote = null;
    }
    logs.push(`${pc.name} catches breath: +${pc.hp - before} HP (${pc.hp}/${pc.maxHp}).`);
  }
  state.calendar.hour = (state.calendar.hour + 1) % 24;
  return logs;
}

export function fullNightsRest(state: GameState, world: WorldDatabase): string[] {
  const logs: string[] = [];
  state.calendar.day += 1;
  state.calendar.hour = 8;

  // Roll new weather on a new day
  const wRoll = rollDie(world.weather.length, state);
  const wEntry = world.weather.find((w) => w.roll === wRoll) ?? world.weather[0];
  state.currentWeather = wEntry.text;
  logs.push(`Day ${state.calendar.day} dawns. Weather: ${state.currentWeather}.`);

  const hasEarthboundCook = state.party.followers.some(
    (f) => f.status === 'alive' && f.specialty.includes('Excellent cooking'),
  );
  const hasSlowAura = state.party.members.some(
    (m) => m.status !== 'dead' && m.traits.troublingTale.includes('companions twice as slow'),
  );

  for (const pc of state.party.members) {
    if (pc.status === 'dead') continue;

    // Troubling Tale #13: 2% daily chance shard of metal reaches the heart
    if (pc.traits.troublingTale.includes('2% chance it reaches it')) {
      const shardRoll = rollDie(100, state);
      if (shardRoll <= 2) {
        pc.hp = -1;
        pc.status = 'dead';
        logs.push(`${pc.name}'s battle-wound metal shard reaches their heart (d100=${shardRoll})! Instant death.`);
        continue;
      }
    }

    // Dizzy & short-duration ailments clear overnight
    pc.dizzyHours = 0;
    const fs = ensureFeatureState(pc);
    fs.spiderVenomHours = 0;
    fs.bookDizzyHours = 0;
    fs.paralyzedHours = 0;
    fs.blindedHours = 0;
    fs.hermeticTrapSteps = 0;
    fs.wraithDrainFight = 0;
    if (fs.hemorrhageHoursLeft && fs.hemorrhageHoursLeft > 0) {
      pc.hp = -1;
      pc.status = 'dead';
      pc.brokenNote = 'Bled out overnight from untreated hemorrhage';
      logs.push(`${pc.name} bled out in the night from untreated hemorrhage!`);
      continue;
    }

    // Zombie & Goblin curses tick at dawn
    if (fs.zombieCurseDaysLeft !== undefined && fs.zombieCurseDaysLeft > 0) {
      fs.zombieCurseDaysLeft -= 1;
      if (fs.zombieCurseDaysLeft <= 0) {
        pc.hp = -1;
        pc.status = 'dead';
        pc.brokenNote = 'Rose as a weeping zombie';
        logs.push(`${pc.name} succumbs to the Zombie curse at dawn and rises as undead!`);
        continue;
      }
      logs.push(`${pc.name}'s Zombie curse worsens (${fs.zombieCurseDaysLeft} day(s) left before death).`);
    }
    if (fs.goblinCurseDaysLeft !== undefined && fs.goblinCurseDaysLeft > 0) {
      fs.goblinCurseDaysLeft -= 1;
      if (fs.goblinCurseDaysLeft <= 0) {
        pc.hp = -1;
        pc.status = 'dead';
        pc.brokenNote = 'Warped into a crazed goblin';
        logs.push(`${pc.name} warps irrevocably into a goblin and flees into Sarkash!`);
        continue;
      }
      logs.push(`${pc.name}'s goblin curse mutates (${fs.goblinCurseDaysLeft} day(s) left unless killer is slain).`);
    }

    // Food & Water check (Famine Misery increases daily ration cost)
    const miseryCounts = getActiveMiseryEffects(state).counts;
    const rationCost = 1 + miseryCounts.famine;
    const hasSupplies = pc.foodDays >= rationCost && pc.waterDays >= rationCost;
    if (hasSupplies) {
      pc.foodDays -= rationCost;
      pc.waterDays -= rationCost;
      pc.daysWithoutFood = 0;
    } else {
      pc.foodDays = Math.max(0, pc.foodDays - Math.min(pc.foodDays, rationCost));
      pc.waterDays = Math.max(0, pc.waterDays - Math.min(pc.waterDays, rationCost));
      pc.daysWithoutFood += 1;
      if (pc.daysWithoutFood > 2) {
        const starveDmg = rollDie(4, state);
        pc.hp -= starveDmg;
        logs.push(`${pc.name} starves without food/water (-${starveDmg} HP -> ${pc.hp}/${pc.maxHp}).`);
      } else {
        logs.push(`${pc.name} sleeps hungry (day ${pc.daysWithoutFood} without enough rations${rationCost > 1 ? `, Famine demands ${rationCost}d` : ''}) and heals nothing.`);
      }
    }

    // Infection check (p. 31)
    if (pc.infected) {
      const infDmg = rollDie(6, state);
      pc.hp -= infDmg;
      logs.push(`${pc.name} suffers from infection (-${infDmg} HP -> ${pc.hp}/${pc.maxHp}) and cannot heal.`);
    } else if (hasSupplies) {
      let heal = rollDie(6, state) + (hasEarthboundCook ? rollDie(4, state) : 0);
      if (pc.traits.troublingTale.includes('flesh heals twice as fast')) {
        heal *= 2;
      } else if (hasSlowAura) {
        heal = Math.max(1, Math.floor(heal / 2));
      }
      if (pc.arcaneCatastrophes.includes(18)) {
        heal = Math.max(1, Math.floor(heal / 2));
      }
      if (miseryCounts.rest_hazard > 0) {
        heal = Math.max(1, heal - miseryCounts.rest_hazard);
      }
      const before = pc.hp;
      pc.hp = Math.min(pc.maxHp, pc.hp + heal);
      if (pc.status === 'broken' && pc.hp > 0) {
        pc.status = 'alive';
        pc.brokenNote = null;
      }
      logs.push(`${pc.name} sleeps 6+ hours: +${pc.hp - before} HP (${pc.hp}/${pc.maxHp}).`);
    }

    if (pc.hp < 0) {
      pc.status = 'dead';
      logs.push(`${pc.name} dies in the night!`);
      continue;
    }

    // Refresh daily Powers (Presence + d4)
    pc.powersMaxToday = Math.max(0, pc.abilities.presence + rollDie(4, state));
    pc.powersRemaining = pc.powersMaxToday;

    // Mutate Foul Protean Scrolls at dawn (Rotblack Sludge p. 3)
    for (const item of pc.inventory) {
      if (item.proteanScroll) {
        const s = world.uncleanScrolls[rollDie(world.uncleanScrolls.length, state) - 1];
        item.name = `Protean Scroll: ${s.name}`;
        item.scrollRoll = s.roll;
        item.notes = s.effect;
        logs.push(`${pc.name}'s Protean Scroll shifts at dawn into "${s.name}".`);
      }
    }

    // Replenish Omens if depleted (p. 37)
    if (pc.omens <= 0) {
      pc.omens = rollDie(pc.omenDie, state);
      logs.push(`${pc.name} regains ${pc.omens} Omens.`);
    }

    // Refresh daily class features, dawn-expiring scrolls, and Herbmaster decoctions
    logs.push(...refreshDailyClassFeaturesAndDecoctions(pc, state, world));
  }

  // Outcast Pale One 1/day Elixir Vitalis or Decoction assistance at dawn
  const paleOne = state.party.followers.find((f) => f.status === 'alive' && f.archetypeId === 'pale_one');
  const receiver = state.party.members.find((m) => m.status === 'alive');
  if (paleOne && receiver && paleOne.specialty.includes('Elixir Vitalis')) {
    receiver.inventory.push({
      id: `pale_${state.calendar.day}_${rollDie(999, state)}`,
      name: 'Decoction: Elixir Vitalis',
      kind: 'decoction',
      uses: rollDie(2, state),
      notes: 'Brewed by Pale One follower; heals d6 HP and stops infection.',
      expiresAtDawn: true,
    });
    logs.push(`${paleOne.name} silently hands ${receiver.name} fresh Elixir Vitalis at dawn.`);
  }

  // Dawn Misery check
  const misery = rollDawnMisery(state, world);
  logs.push(misery.logLine);

  // Check TPK
  if (state.party.members.every((m) => m.status === 'dead')) {
    state.mode = 'game_over';
    state.gameOverReason = 'All PCs perished in the night.';
  }

  return logs;
}
