import type { GameState, TimePeriod, WeatherId, WorldClock } from '../types.ts';
import { nextRandom } from '../dice.ts';

export const WEATHER_DATA: Record<
  WeatherId,
  {
    label: string;
    atmosphere: string;
    observeMod: number;
    ambushBonus: number;
  }
> = {
  clear: {
    label: 'Clear',
    atmosphere: 'Pale cloud-breaks hang thin over the grey ridge.',
    observeMod: 0,
    ambushBonus: 0,
  },
  ash_rain: {
    label: 'Ash-Rain',
    atmosphere: 'Cold, soot-flecked rain hisses across stone and cloak.',
    observeMod: -1,
    ambushBonus: 0.05,
  },
  spore_fog: {
    label: 'Spore-Fog',
    atmosphere: 'Chalky white mist clings low to boots and dampens sound.',
    observeMod: -2,
    ambushBonus: 0.1,
  },
  biting_wind: {
    label: 'Biting Wind',
    atmosphere: 'Sharp highland wind cuts straight through wool and mail.',
    observeMod: -1,
    ambushBonus: 0,
  },
  dead_still: {
    label: 'Dead Still',
    atmosphere: 'Not a single reed stirs; distant bronze echoes carry far.',
    observeMod: 1,
    ambushBonus: 0.05,
  },
};

const WEATHER_LIST: WeatherId[] = [
  'clear',
  'ash_rain',
  'spore_fog',
  'biting_wind',
  'dead_still',
];

export function createInitialClock(): WorldClock {
  return {
    day: 1,
    hour: 8,
    totalHours: 8,
    weather: 'ash_rain',
    weatherHoursLeft: 6,
  };
}

export function getTimePeriod(hour: number): TimePeriod {
  if (hour >= 5 && hour <= 7) return 'dawn';
  if (hour >= 8 && hour <= 11) return 'morning';
  if (hour >= 12 && hour <= 16) return 'midday';
  if (hour >= 17 && hour <= 19) return 'dusk';
  if (hour >= 20 && hour <= 22) return 'night';
  return 'midnight';
}

export function formatPeriodLabel(period: TimePeriod): string {
  return period.charAt(0).toUpperCase() + period.slice(1);
}

export function isDarkPeriod(hour: number): boolean {
  const period = getTimePeriod(hour);
  return period === 'night' || period === 'midnight';
}

export function formatClockLabel(clock: WorldClock): string {
  const hh = String(clock.hour).padStart(2, '0');
  const period = formatPeriodLabel(getTimePeriod(clock.hour));
  const weather = WEATHER_DATA[clock.weather].label;
  return `Day ${clock.day} ${hh}:00 ${period} - ${weather}`;
}

export function advanceHours(
  state: GameState,
  hours: number,
  options?: { sheltered?: boolean },
): string[] {
  if (hours <= 0) return [];
  const msgs: string[] = [];
  const clock = state.clock;
  const prevDay = clock.day;

  clock.totalHours += hours;
  const totalDayHours = clock.hour + hours;
  const daysPassed = Math.floor(totalDayHours / 24);
  clock.hour = totalDayHours % 24;
  clock.day += daysPassed;
  state.day = clock.day;

  // Daily sustenance check on day rollover
  if (clock.day > prevDay) {
    const rollovers = clock.day - prevDay;
    for (let i = 0; i < rollovers; i += 1) {
      if (state.player.rations > 0) {
        state.player.rations -= 1;
      } else {
        state.player.hp = Math.max(1, state.player.hp - 4);
        state.player.resolve = Math.max(0, state.player.resolve - 3);
        msgs.push('Empty stomach and cold air gnaw at your strength.');
      }
    }
  }

  // Weather transition
  clock.weatherHoursLeft -= hours;
  if (clock.weatherHoursLeft <= 0) {
    const nextIdx = Math.floor(nextRandom(state) * WEATHER_LIST.length);
    const nextWeather = WEATHER_LIST[nextIdx];
    clock.weatherHoursLeft = 4 + Math.floor(nextRandom(state) * 6);
    if (nextWeather !== clock.weather) {
      clock.weather = nextWeather;
      msgs.push(`Weather shifts to ${WEATHER_DATA[nextWeather].label}. ${WEATHER_DATA[nextWeather].atmosphere}`);
    }
  }

  // Environmental exposure in Spore-Fog outdoors at night
  if (
    !options?.sheltered &&
    clock.weather === 'spore_fog' &&
    isDarkPeriod(clock.hour) &&
    hours >= 2
  ) {
    state.player.defilement = Math.min(100, state.player.defilement + 1);
    msgs.push('Thick spore-fog coats your throat with chalky residue.');
  }

  return msgs;
}
