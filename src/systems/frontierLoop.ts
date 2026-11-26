import type { ExploreEncounterDef, FrontierState, GameState } from '../types.ts';
import { loadWorldDatabase } from '../db/loader.ts';
import { ITEMS } from '../content/items.ts';
import { LOCATIONS } from '../content/locations.ts';
import { nextRandom } from '../dice.ts';
import { hasFlag, recordChronicle, setFlag } from '../memory.ts';
import { WEATHER_DATA, LUNAR_PHASE_DATA, advanceHours } from './clock.ts';
import { addItemToInventory, beginCombatApproach, startCombatEncounter } from '../combat.ts';
import { markPlaceSeen } from '../writing/discovery.ts';

export function createInitialFrontierState(): FrontierState {
  return {
    unlockedAreas: [],
    unlockedTowns: [],
    unlockedSubAreas: [],
    unlockedDungeons: [],
    activeSubArea: {},
    stash: [],
    dungeonStates: {},
    activeDungeonId: null,
  };
}

function pickWeightedEncounter(
  state: GameState,
  pool: ExploreEncounterDef[],
): ExploreEncounterDef | null {
  if (pool.length === 0) return null;
  const total = pool.reduce((acc, e) => acc + e.weight, 0);
  let roll = nextRandom(state) * total;
  for (const enc of pool) {
    roll -= enc.weight;
    if (roll <= 0) return enc;
  }
  return pool[0];
}

function resolveEncounterOutcome(state: GameState, enc: ExploreEncounterDef): string[] {
  const f = state.frontier;
  const returnScene: 'camp_hub' | 'location' = state.scene === 'camp_hub' ? 'camp_hub' : 'location';

  if (enc.kind === 'enemy' && enc.enemyIds && enc.enemyIds.length > 0) {
    return [enc.prose, ...beginCombatApproach(state, { enemyIds: enc.enemyIds, canFlee: true })];
  }

  if (enc.kind === 'merchant' && enc.shop) {
    state.activeMerchant = {
      name: enc.shop.name,
      keeper: enc.shop.keeper,
      items: enc.shop.items,
    };
    state.scene = 'shop';
    state.subMenu = 'root';
    return [enc.prose];
  }

  if (enc.kind === 'unlock_area' && enc.targetUnlockId) {
    let outcomeText = enc.prose;
    if (!f.unlockedAreas.includes(enc.targetUnlockId)) {
      f.unlockedAreas.push(enc.targetUnlockId);
      markPlaceSeen(state, enc.targetUnlockId);
      const loc = LOCATIONS[enc.targetUnlockId];
      outcomeText = `${enc.prose}\n\nNew route marked: ${loc?.name ?? enc.targetUnlockId}. You can now Travel there from Camp.`;
      recordChronicle(state, `Discovered ${loc?.name ?? enc.targetUnlockId}`, enc.prose, 'explore');
    }
    state.exploreBeat = {
      title: 'NEW ROUTE FOUND',
      prose: outcomeText,
      kind: 'discovery',
      resolved: true,
      returnScene,
    };
    state.scene = 'explore_beat';
    return [outcomeText];
  }

  if (enc.kind === 'unlock_town' && enc.targetUnlockId) {
    let outcomeText = enc.prose;
    if (!f.unlockedTowns.includes(enc.targetUnlockId)) {
      f.unlockedTowns.push(enc.targetUnlockId);
      markPlaceSeen(state, enc.targetUnlockId);
      const loc = LOCATIONS[enc.targetUnlockId];
      outcomeText = `${enc.prose}\n\nNew shelter marked: ${loc?.name ?? enc.targetUnlockId}. You can now Travel there from Camp.`;
      recordChronicle(state, `Discovered ${loc?.name ?? enc.targetUnlockId}`, enc.prose, 'explore');
    }
    state.exploreBeat = {
      title: 'SETTLEMENT SIGHTED',
      prose: outcomeText,
      kind: 'discovery',
      resolved: true,
      returnScene,
    };
    state.scene = 'explore_beat';
    return [outcomeText];
  }

  if (enc.kind === 'unlock_sub_area' && enc.targetUnlockId) {
    let outcomeText = enc.prose;
    if (!f.unlockedSubAreas.includes(enc.targetUnlockId)) {
      f.unlockedSubAreas.push(enc.targetUnlockId);
      const sa = loadWorldDatabase().subAreas[enc.targetUnlockId];
      outcomeText = `${enc.prose}\n\nSecret sub-area uncovered: ${sa?.name ?? enc.targetUnlockId}. Toggle Sub-Area under Explore to search it.`;
      recordChronicle(state, `Secret: ${sa?.name ?? enc.targetUnlockId}`, enc.prose, 'explore');
    }
    state.exploreBeat = {
      title: 'HIDDEN PASSAGE',
      prose: outcomeText,
      kind: 'discovery',
      resolved: true,
      returnScene,
    };
    state.scene = 'explore_beat';
    return [outcomeText];
  }

  if (enc.kind === 'unlock_dungeon' && enc.targetUnlockId) {
    let outcomeText = enc.prose;
    if (!f.unlockedDungeons.includes(enc.targetUnlockId)) {
      f.unlockedDungeons.push(enc.targetUnlockId);
      const d = loadWorldDatabase().dungeons[enc.targetUnlockId];
      outcomeText = `${enc.prose}\n\nDungeon entrance found: ${d?.name ?? enc.targetUnlockId}. Enter it directly from this area.`;
      recordChronicle(state, `Dungeon: ${d?.name ?? enc.targetUnlockId}`, enc.prose, 'explore');
    }
    state.exploreBeat = {
      title: 'DARK THRESHOLD',
      prose: outcomeText,
      kind: 'discovery',
      resolved: true,
      returnScene,
    };
    state.scene = 'explore_beat';
    return [outcomeText];
  }

  if (enc.itemId || (enc.crownsMin !== undefined && enc.crownsMax !== undefined)) {
    state.exploreBeat = {
      title: 'SALVAGE ON THE TRAIL',
      prose: `${enc.prose}\n\nCold frost crusts the edges; whatever lies here has been picked over or left in a hurry.`,
      kind: 'salvage',
      itemId: enc.itemId,
      crownsMin: enc.crownsMin,
      crownsMax: enc.crownsMax,
      resolved: false,
      returnScene,
    };
    state.scene = 'explore_beat';
    return [enc.prose];
  }

  const title =
    enc.kind === 'curiosity'
      ? 'STRANGE SIGN'
      : enc.kind === 'landscape'
        ? 'THE NORTHERN WASTE'
        : 'QUIET SCOUT';
  state.exploreBeat = {
    title,
    prose: enc.prose,
    kind: enc.kind === 'curiosity' ? 'curiosity' : enc.kind === 'landscape' ? 'landscape' : 'empty',
    resolved: true,
    returnScene,
  };
  state.scene = 'explore_beat';
  return [enc.prose];
}

export function rollCampExplore(state: GameState): string[] {
  const clockMsgs = advanceHours(state, 2);
  const f = state.frontier;
  const all = loadWorldDatabase().encounters.filter((e) => {
    if (e.scopeType !== 'camp_hub') return false;
    if (e.kind === 'unlock_area' && e.targetUnlockId && f.unlockedAreas.includes(e.targetUnlockId)) {
      return false;
    }
    if (e.kind === 'unlock_town' && e.targetUnlockId && f.unlockedTowns.includes(e.targetUnlockId)) {
      return false;
    }
    return true;
  });

  const picked = pickWeightedEncounter(state, all);
  if (!picked) {
    return ['You scout the perimeter around camp, finding only frozen mud and quiet wind.', ...clockMsgs];
  }
  return [...resolveEncounterOutcome(state, picked), ...clockMsgs];
}

export function rollAreaExplore(state: GameState, areaId: string): string[] {
  const clockMsgs = advanceHours(state, 2);
  const f = state.frontier;
  const activeSub = f.activeSubArea[areaId] ?? null;

  const pool = loadWorldDatabase().encounters.filter((e) => {
    if (activeSub) {
      return e.scopeType === 'sub_area' && e.scopeId === activeSub;
    }
    if (e.scopeType !== 'area' || e.scopeId !== areaId) return false;
    if (
      e.kind === 'unlock_sub_area' &&
      e.targetUnlockId &&
      f.unlockedSubAreas.includes(e.targetUnlockId)
    ) {
      return false;
    }
    if (
      e.kind === 'unlock_dungeon' &&
      e.targetUnlockId &&
      f.unlockedDungeons.includes(e.targetUnlockId)
    ) {
      return false;
    }
    return true;
  });

  const picked = pickWeightedEncounter(state, pool);
  if (!picked) {
    return ['You search the surrounding ruins, finding only cold soot and silence.', ...clockMsgs];
  }
  return [...resolveEncounterOutcome(state, picked), ...clockMsgs];
}

export function travelFromCamp(state: GameState, destId: string): string[] {
  const dest = LOCATIONS[destId];
  if (!dest) return ['Unknown destination.'];

  const prevLoc = state.locationId;
  const msgs: string[] = [];
  let rationNote = 'You chew a strip of salted jerky as you break camp and shoulder your pack.';
  if (state.player.rations > 0) {
    state.player.rations -= 1;
  } else {
    state.player.stamina = Math.max(0, state.player.stamina - 1);
    rationNote = 'With no rations left, your stomach knots painfully as you shoulder your pack, costing 1 Stamina.';
  }

  msgs.push(...advanceHours(state, 3));

  state.locationId = destId;
  state.subMenu = 'root';
  state.activeNpcId = null;

  const firstVisit = markPlaceSeen(state, destId);
  if (!state.visitedLocations.includes(destId)) {
    state.visitedLocations.push(destId);
  }

  const weatherLine = WEATHER_DATA[state.clock.weather].atmosphere;
  const lunarLine = LUNAR_PHASE_DATA[state.clock.lunarPhase].atmosphere;
  const departureBeat = [
    `You strike out along the broken paving toward ${dest.name}. ${rationNote}`,
    `${weatherLine} ${lunarLine}`,
  ].join('\n\n');

  const arrivalProse = firstVisit ? dest.firstSightProse(state) : dest.returnSightProse(state);
  const arrivalBeat = [arrivalProse, `You reach the edge of ${dest.name} and take stock of your surroundings.`].join('\n\n');

  if (
    destId === 'cinderford' &&
    state.day >= 8 &&
    !hasFlag(state, 'cinderford_saved') &&
    !hasFlag(state, 'cinderford_fallen')
  ) {
    setFlag(state, 'cinderford_fallen', true);
    recordChronicle(
      state,
      'Timber Post Fell',
      'Because the infected granary went ignored past Day 8, Timber Post succumbed from within.',
      'cinderford',
    );
    msgs.push(
      'Timber Post has succumbed to the granary rot. Two stooped figures burst from the gatehouse.',
    );
    const { introMessages } = startCombatEncounter(state, {
      enemyIds: ['root_husk', 'root_husk'],
      canFlee: false,
    });
    return [...msgs, ...introMessages];
  }

  let pendingAmbushEnemyId: string | undefined;
  if (dest.regionType === 'area') {
    const weatherBonus = WEATHER_DATA[state.clock.weather].ambushBonus;
    const chance = Math.min(0.45, dest.danger * 0.08 + weatherBonus);
    if (nextRandom(state) < chance) {
      pendingAmbushEnemyId = dest.danger >= 4 ? 'bell_acolyte' : dest.danger >= 2 ? 'root_husk' : 'ash_hound';
    }
  }

  state.travelState = {
    fromId: prevLoc,
    destId,
    beatIndex: 0,
    beats: [departureBeat, arrivalBeat],
    pendingAmbushEnemyId,
  };
  state.scene = 'travel';

  return msgs;
}

export function returnToCampHub(state: GameState): string[] {
  const msgs = advanceHours(state, 2);
  state.scene = 'camp_hub';
  state.subMenu = 'root';
  state.activeNpcId = null;
  state.activeMerchant = null;
  return ['You follow your trail-markers back to your lone camp.', ...msgs];
}
