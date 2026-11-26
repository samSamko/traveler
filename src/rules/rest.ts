import type { WorldDatabase } from '../db/loader.ts';
import type { GameState } from '../types.ts';
import { rollDie } from '../dice.ts';
import { rollDawnMisery } from './calendar.ts';

export function catchBreath(state: GameState): string[] {
  const logs: string[] = [];
  const hasSlowAura = state.party.members.some(
    (m) => m.status !== 'dead' && m.traits.troublingTale.includes('companions twice as slow'),
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
    let heal = rollDie(4, state);
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

    // Dizzy clears overnight
    pc.dizzyHours = 0;

    // Food & Water check
    const hasSupplies = pc.foodDays > 0 && pc.waterDays > 0;
    if (hasSupplies) {
      pc.foodDays -= 1;
      pc.waterDays -= 1;
      pc.daysWithoutFood = 0;
    } else {
      pc.daysWithoutFood += 1;
      if (pc.daysWithoutFood > 2) {
        const starveDmg = rollDie(4, state);
        pc.hp -= starveDmg;
        logs.push(`${pc.name} starves without food/water (-${starveDmg} HP -> ${pc.hp}/${pc.maxHp}).`);
      } else {
        logs.push(`${pc.name} sleeps hungry (day ${pc.daysWithoutFood} without rations) and heals nothing.`);
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
