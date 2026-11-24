import type { ExploreEncounterDef, FrontierState, GameState } from '../types.ts';
import { loadWorldDatabase } from '../db/loader.ts';
import { ITEMS } from '../content/items.ts';
import { LOCATIONS } from '../content/locations.ts';
import { nextRandom } from '../dice.ts';
import { hasFlag, recordChronicle, setFlag } from '../memory.ts';
import { WEATHER_DATA, advanceHours } from './clock.ts';
import { addItemToInventory, startCombatEncounter } from '../combat.ts';
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
  const msgs: string[] = [enc.prose];
  const f = state.frontier;

  if (enc.kind === 'unlock_area' && enc.targetUnlockId) {
    if (!f.unlockedAreas.includes(enc.targetUnlockId)) {
      f.unlockedAreas.push(enc.targetUnlockId);
      markPlaceSeen(state, enc.targetUnlockId);
      const loc = LOCATIONS[enc.targetUnlockId];
      msgs.push(`Discovered new area: ${loc?.name ?? enc.targetUnlockId}. You can now Travel there from Camp.`);
      recordChronicle(state, `Discovered ${loc?.name ?? enc.targetUnlockId}`, enc.prose, 'explore');
    }
    return msgs;
  }

  if (enc.kind === 'unlock_town' && enc.targetUnlockId) {
    if (!f.unlockedTowns.includes(enc.targetUnlockId)) {
      f.unlockedTowns.push(enc.targetUnlockId);
      markPlaceSeen(state, enc.targetUnlockId);
      const loc = LOCATIONS[enc.targetUnlockId];
      msgs.push(`Discovered destination: ${loc?.name ?? enc.targetUnlockId}. You can now Travel there from Camp.`);
      recordChronicle(state, `Discovered ${loc?.name ?? enc.targetUnlockId}`, enc.prose, 'explore');
    }
    return msgs;
  }

  if (enc.kind === 'unlock_sub_area' && enc.targetUnlockId) {
    if (!f.unlockedSubAreas.includes(enc.targetUnlockId)) {
      f.unlockedSubAreas.push(enc.targetUnlockId);
      const sa = loadWorldDatabase().subAreas[enc.targetUnlockId];
      msgs.push(`Discovered secret sub-area: ${sa?.name ?? enc.targetUnlockId}. Toggle Sub-Area under Explore to search it.`);
      recordChronicle(state, `Secret: ${sa?.name ?? enc.targetUnlockId}`, enc.prose, 'explore');
    }
    return msgs;
  }

  if (enc.kind === 'unlock_dungeon' && enc.targetUnlockId) {
    if (!f.unlockedDungeons.includes(enc.targetUnlockId)) {
      f.unlockedDungeons.push(enc.targetUnlockId);
      const d = loadWorldDatabase().dungeons[enc.targetUnlockId];
      msgs.push(`Discovered dungeon: ${d?.name ?? enc.targetUnlockId}. Enter it directly from this area.`);
      recordChronicle(state, `Dungeon: ${d?.name ?? enc.targetUnlockId}`, enc.prose, 'explore');
    }
    return msgs;
  }

  if (enc.kind === 'enemy' && enc.enemyIds && enc.enemyIds.length > 0) {
    const { introMessages } = startCombatEncounter(state, {
      enemyIds: enc.enemyIds,
      canFlee: true,
    });
    return [...msgs, ...introMessages];
  }

  if (enc.kind === 'merchant' && enc.shop) {
    state.activeMerchant = {
      name: enc.shop.name,
      keeper: enc.shop.keeper,
      items: enc.shop.items,
    };
    state.scene = 'shop';
    state.subMenu = 'root';
    return msgs;
  }

  if (enc.itemId) {
    addItemToInventory(state, enc.itemId, 1);
    msgs.push(`Found ${ITEMS[enc.itemId]?.name ?? enc.itemId}.`);
  }
  if (enc.crownsMin !== undefined && enc.crownsMax !== undefined) {
    const gain =
      enc.crownsMin +
      Math.floor(nextRandom(state) * (enc.crownsMax - enc.crownsMin + 1));
    if (gain > 0) {
      state.player.crowns += gain;
      msgs.push(`Salvaged ${gain} Crowns.`);
    }
  }

  return msgs;
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
    return ['You scout the perimeter around camp, finding only damp ash and quiet wind.', ...clockMsgs];
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

  const msgs: string[] = [`You shoulder your pack and strike out toward ${dest.name}.`];
  if (state.player.rations > 0) {
    state.player.rations -= 1;
  } else {
    state.player.stamina = Math.max(0, state.player.stamina - 1);
    msgs.push('Traveling on an empty stomach costs 1 Stamina.');
  }

  msgs.push(...advanceHours(state, 3));

  state.locationId = destId;
  state.scene = 'location';
  state.subMenu = 'root';
  state.activeNpcId = null;

  const firstVisit = markPlaceSeen(state, destId);
  if (!state.visitedLocations.includes(destId)) {
    state.visitedLocations.push(destId);
  }
  if (firstVisit) {
    msgs.push(dest.firstSightProse(state));
  }

  if (
    destId === 'cinderford' &&
    state.day >= 8 &&
    !hasFlag(state, 'cinderford_saved') &&
    !hasFlag(state, 'cinderford_fallen')
  ) {
    setFlag(state, 'cinderford_fallen', true);
    recordChronicle(
      state,
      'Cinderford Fell',
      'Because the infected granary went ignored past Day 8, Cinderford succumbed from within.',
      'cinderford',
    );
    msgs.push(
      'Cinderford Keep has succumbed to the granary spores. Two stooped figures burst from the gatehouse.',
    );
    const { introMessages } = startCombatEncounter(state, {
      enemyIds: ['root_husk', 'root_husk'],
      canFlee: false,
    });
    return [...msgs, ...introMessages];
  }

  if (dest.regionType === 'area') {
    const weatherBonus = WEATHER_DATA[state.clock.weather].ambushBonus;
    const chance = Math.min(0.45, dest.danger * 0.08 + weatherBonus);
    if (nextRandom(state) < chance) {
      const ambusher = dest.danger >= 4 ? 'bell_acolyte' : dest.danger >= 2 ? 'root_husk' : 'ash_hound';
      msgs.push('Shadows stir along the trail before you reach cover.');
      const { introMessages } = startCombatEncounter(state, {
        enemyId: ambusher,
        canFlee: true,
      });
      return [...msgs, ...introMessages];
    }
  }

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
