import { randomUUID } from 'node:crypto';
import type {
  ActionOutcome,
  AnatomyProfile,
  BackgroundId,
  BodySlot,
  GameState,
  JournalTab,
  RaceId,
  RecipeDef,
  SexId,
  SouthernPastId,
  SurvivalMode,
} from './types.ts';
import { BACKGROUNDS, PERKS, RACES, SOUTHERN_PASTS } from './content/characters.ts';
import { ITEMS, RECIPES } from './content/items.ts';
import { LOCATIONS } from './content/locations.ts';
import { ENEMIES } from './content/enemies.ts';
import { EVENTS } from './content/events.ts';
import { nextRandom, resolveCheck } from './dice.ts';
import { registerRuleRuntime } from './db/rules.ts';
import { renderProse } from './writing/prose.ts';
import { hasFlag, recordChronicle, setFlag, synthesizeEpilogue } from './memory.ts';
import {
  addItemToInventory,
  consumeInventoryItem,
  beginCombatApproach,
  executeCombatAction,
  getCombatMenuOptions,
  startCombatEncounter,
} from './combat.ts';
import {
  divider,
  formatActionGrid,
  formatStatusHeader,
  paint,
  renderAsciiMap,
  renderCharacterSheet,
  renderHelpText,
  renderInventory,
  renderMemoryChronicle,
  wrapText,
} from './ui.ts';
import { rollDefaultAnatomy } from './writing/anatomy.ts';
import {
  createInitialDiscovery,
  getNpcDisplayName,
  markNpcMet,
  markPlaceSeen,
} from './writing/discovery.ts';
import { INTRO_BEAT_COUNT, getIntroBeat } from './writing/intro.ts';
import { formatCombatEnemyCard } from './writing/appraisal.ts';
import { getJournalChoices, renderJournalBody } from './writing/journal.ts';
import {
  WEATHER_DATA,
  advanceHours,
  createInitialClock,
  getTimePeriod,
} from './systems/clock.ts';
import { BODY_MODS, exciseBodyMod, installBodyMod } from './systems/bodymods.ts';
import { executeAftermathAction, getAftermathChoices, tendInjury } from './systems/injuries.ts';
import { enterMobileCamp, executeCampAction, getCampChoices } from './systems/camp.ts';
import {
  applyWeaponCoating,
  castAshTextOutOfCombat,
  drinkDraught,
  getEquippedVisibleTags,
} from './systems/frontier.ts';
import {
  createInitialFrontierState,
  returnToCampHub,
  rollAreaExplore,
  rollCampExplore,
  travelFromCamp,
} from './systems/frontierLoop.ts';
import {
  enterDungeon,
  executeDungeonAction,
  getDungeonChoices,
  renderDungeonMap,
} from './systems/dungeon.ts';
import { loadWorldDatabase } from './db/loader.ts';

registerRuleRuntime({
  resolveCheck,
  addItem: addItemToInventory,
  consumeItem: consumeInventoryItem,
  renderProse,
  getEquippedVisibleTags,
});

const SHORT_LOCATION_NAMES: Record<string, string> = {
  frostwall_redoubt: 'Timber Post',
  cistern_cloister: 'Old Bathhouse',
  foundry_vault: 'Smelter Pit',
  salt_hermitage: 'Dry Arch',
  imperial_viaduct: 'High Road',
  frost_orchard: 'Dead Orchard',
  stepped_barrow: 'Long Steps',
  brine_marsh: 'Salt Bog',
  petrified_grove: 'White Timber',
  kiln_terraces: 'Brick Hills',
  basalt_quarry: 'Black Quarry',
  salt_ossuary: 'Bone Cellars',
  gate_watchtower: 'North Gate',
  silver_rotunda: 'The White Dome',
};

export interface CreateCharacterInput {
  name: string;
  sex: SexId;
  race: RaceId;
  background: BackgroundId;
  southernPast?: SouthernPastId;
  survivalMode?: SurvivalMode;
  anatomy?: AnatomyProfile;
  skipIntro?: boolean;
  stealthMode?: boolean;
  rngState?: number;
}

export function createNewGame(input: CreateCharacterInput): GameState {
  const raceDef = RACES[input.race];
  const bgDef = BACKGROUNDS[input.background];
  const pastDef = input.southernPast ? SOUTHERN_PASTS[input.southernPast] : undefined;

  const stats = {
    might: 1 + (raceDef.statMods.might ?? 0) + (bgDef.statMods.might ?? 0) + (pastDef?.statMods.might ?? 0),
    agility: 1 + (raceDef.statMods.agility ?? 0) + (bgDef.statMods.agility ?? 0) + (pastDef?.statMods.agility ?? 0),
    wit: 1 + (raceDef.statMods.wit ?? 0) + (bgDef.statMods.wit ?? 0) + (pastDef?.statMods.wit ?? 0),
    grit: 1 + (raceDef.statMods.grit ?? 0) + (bgDef.statMods.grit ?? 0) + (pastDef?.statMods.grit ?? 0),
  };

  const weapon = ITEMS[bgDef.startingWeaponId];
  const armor = ITEMS[bgDef.startingArmorId];
  const trinket = bgDef.startingTrinketId ? ITEMS[bgDef.startingTrinketId] : undefined;

  const maxHp =
    22 +
    stats.grit * 3 +
    (input.background === 'shrine_penitent' ? 4 : 0) +
    (armor?.maxHpBonus ?? 0) +
    (trinket?.maxHpBonus ?? 0);

  const maxStamina = 6 + Math.max(0, Math.floor((stats.might + stats.agility) / 2));
  const maxFocus =
    6 +
    Math.max(0, stats.wit) +
    (weapon?.maxFocusBonus ?? 0) +
    (armor?.maxFocusBonus ?? 0) +
    (trinket?.maxFocusBonus ?? 0);
  const maxResolve =
    12 +
    Math.max(0, stats.grit * 2 + stats.wit) +
    (armor?.maxResolveBonus ?? 0) +
    (trinket?.maxResolveBonus ?? 0);

  const abilities: string[] = [];
  const anatomy =
    input.anatomy ?? rollDefaultAnatomy(input.sex, input.race, input.background);

  const startingItemsMerged = bgDef.startingItems.map((i) => ({ ...i }));
  if (pastDef) {
    for (const bi of pastDef.bonusItems) {
      const existing = startingItemsMerged.find((e) => e.id === bi.id);
      if (existing) existing.qty += bi.qty;
      else startingItemsMerged.push({ ...bi });
    }
  }

  const startingKnownItems = [
    bgDef.startingWeaponId,
    bgDef.startingArmorId,
    ...(bgDef.startingTrinketId ? [bgDef.startingTrinketId] : []),
    ...startingItemsMerged.map((i) => i.id),
  ];

  const skipIntro = Boolean(input.skipIntro);
  const clock = createInitialClock();

  return {
    runId: randomUUID(),
    survivalMode: input.survivalMode ?? 'scarred',
    clock,
    day: clock.day,
    stealthMode: Boolean(input.stealthMode),
    player: {
      name: input.name.trim() || 'Vesper',
      sex: input.sex,
      race: input.race,
      background: input.background,
      southernPast: input.southernPast,
      anatomy,
      bodyMods: {},
      injuries: [],
      level: 1,
      xp: 0,
      xpToNext: 35,
      hp: maxHp,
      maxHp,
      stamina: maxStamina,
      maxStamina,
      focus: maxFocus,
      maxFocus,
      resolve: maxResolve,
      maxResolve,
      defilement: 0,
      baseStats: stats,
      equipment: {
        mainHand: bgDef.startingWeaponId,
        offHand: null,
        armor: bgDef.startingArmorId,
        cloak: null,
        trinket: bgDef.startingTrinketId ?? null,
      },
      weaponHoned: false,
      weaponCoating: null,
      armorTierCurrent: armor?.armorTier ?? 0,
      reserves: 2,
      maxReserves: 2,
      grace: 2,
      maxGrace: 2,
      inventory: startingItemsMerged,
      abilities,
      perks: [],
      crowns: bgDef.startingCrowns + (pastDef?.bonusCrowns ?? 0),
      rations: bgDef.startingRations + (pastDef?.bonusRations ?? 0),
      torches: bgDef.startingTorches + (pastDef?.bonusTorches ?? 0),
      statuses: [],
      determinationAvailable: true,
    },
    locationId: 'camp_hub',
    visitedLocations: [],
    seenEvents: [],
    eventCooldowns: {},
    memory: {
      flags: {},
      factions: {
        iron_vow: 0,
        silken_cistern: 0,
        under_warren: 0,
        husk_choir: 0,
      },
      chronicle: [],
    },
    discovery: createInitialDiscovery(startingKnownItems),
    scene: skipIntro ? 'camp_hub' : 'intro',
    subMenu: 'root',
    introBeat: 0,
    journalTab: 'root',
    journalDetailId: null,
    journalReturn: null,
    activeNpcId: null,
    activeEvent: null,
    combat: null,
    aftermath: null,
    camp: null,
    frontier: createInitialFrontierState(),
    activeMerchant: null,
    pendingPerkIds: [],
    defeatState: null,
    endingSummary: null,
    lastMessages: skipIntro
      ? ['Cold ash settles around your lone camp in the scrub.']
      : [],
    rngState: input.rngState,
  };
}

export interface MenuEntry {
  index: number;
  id: string;
  label: string;
  enabled: boolean;
  reason?: string;
}

function canCraftRecipe(state: GameState, recipe: RecipeDef): boolean {
  return recipe.ingredients.every((ing) => {
    const entry = state.player.inventory.find((i) => i.id === ing.itemId);
    return Boolean(entry && entry.qty >= ing.qty);
  });
}

export function normalizeSceneFallback(state: GameState): string | null {
  if (state.scene === 'location' && !LOCATIONS[state.locationId]) {
    state.locationId = 'camp_hub';
    state.scene = 'camp_hub';
    state.subMenu = 'root';
    return 'Trail markers blur in the ash; you pull back to your Lone Camp.';
  }
  if (state.scene === 'dungeon') {
    const dId = state.frontier?.activeDungeonId;
    const dDef = dId ? loadWorldDatabase().dungeons[dId] : undefined;
    const rt = dId ? state.frontier?.dungeonStates[dId] : undefined;
    if (!dDef || !rt || !dDef.rooms[rt.currentRoomId]) {
      if (state.frontier) state.frontier.activeDungeonId = null;
      state.scene = 'camp_hub';
      state.subMenu = 'root';
      return 'Collapsed stone forces you back out toward your Lone Camp.';
    }
  }
  if (state.scene === 'camp' && !state.camp) {
    state.scene = state.locationId === 'camp_hub' ? 'camp_hub' : 'location';
    state.subMenu = 'root';
    return 'Your embers burn low; you break camp and move on.';
  }
  if (state.scene === 'combat' && (!state.combat || state.combat.enemies.length === 0)) {
    state.combat = null;
    state.scene = state.locationId === 'camp_hub' ? 'camp_hub' : 'location';
    state.subMenu = 'root';
    return 'The clash disperses into the mist.';
  }
  if (state.scene === 'aftermath' && !state.aftermath) {
    state.scene = state.locationId === 'camp_hub' ? 'camp_hub' : 'location';
    state.subMenu = 'root';
    return 'Nothing remains on the ground.';
  }
  if (state.scene === 'event' && (!state.activeEvent || !EVENTS.some((e) => e.id === state.activeEvent!.eventId))) {
    state.activeEvent = null;
    state.scene = state.locationId === 'camp_hub' ? 'camp_hub' : 'location';
    state.subMenu = 'root';
    return 'The encounter fades before anything comes of it.';
  }
  if (state.scene === 'shop' && !(state.activeMerchant ?? LOCATIONS[state.locationId]?.shop)) {
    state.activeMerchant = null;
    state.scene = state.locationId === 'camp_hub' ? 'camp_hub' : 'location';
    state.subMenu = 'root';
    return 'The stalls sit empty.';
  }
  return null;
}

export function getSceneChoices(state: GameState): MenuEntry[] {
  normalizeSceneFallback(state);
  const entries: MenuEntry[] = [];

  if (state.scene === 'intro') {
    entries.push({ index: 1, id: 'intro:next', label: 'Continue', enabled: true });
    entries.push({ index: 2, id: 'intro:skip', label: 'Skip', enabled: true });
    return entries;
  }

  if (state.scene === 'journal') {
    return getJournalChoices(state);
  }

  if (state.scene === 'camp') {
    if (state.subMenu === 'pack_craft') {
      const expert = state.player.race === 'grixi' || state.player.background === 'root_scholar';
      for (const recipe of RECIPES) {
        if (recipe.grixiOrScholarOnly && !expert) continue;
        const ok = canCraftRecipe(state, recipe);
        entries.push({
          index: entries.length + 1,
          id: `craft:${recipe.id}`,
          label: recipe.name,
          enabled: ok,
          reason: ok ? undefined : 'Missing reagents',
        });
      }
      entries.push({ index: entries.length + 1, id: 'camp:back', label: 'Back', enabled: true });
      return entries;
    }
    return getCampChoices(state);
  }

  if (state.scene === 'travel') {
    return [{ index: 1, id: 'journey:next', label: 'Continue', enabled: true }];
  }

  if (state.scene === 'explore_beat' && state.exploreBeat) {
    if (!state.exploreBeat.resolved && state.exploreBeat.kind === 'salvage') {
      return [
        { index: 1, id: 'explore:search', label: 'Search', enabled: true },
        { index: 2, id: 'explore:leave', label: 'Leave', enabled: true },
      ];
    }
    return [{ index: 1, id: 'explore:continue', label: 'Continue', enabled: true }];
  }

  if (state.scene === 'combat_approach' && state.combatApproach) {
    if (state.combatApproach.ambushed) {
      return [{ index: 1, id: 'approach:engage', label: 'Continue', enabled: true }];
    }
    const opts: ActionChoice[] = [
      { index: 1, id: 'approach:engage', label: 'Engage', enabled: true },
      { index: 2, id: 'approach:observe', label: 'Observe', enabled: !state.combatApproach.observed },
    ];
    if (state.combatApproach.canFlee) {
      opts.push({ index: opts.length + 1, id: 'approach:flee', label: 'Slip Away', enabled: true });
    }
    opts.push({ index: opts.length + 1, id: 'open_journal', label: 'Journal', enabled: true });
    return opts;
  }

  if (state.scene === 'defeat') {
    return [{ index: 1, id: 'defeat:next', label: 'Continue', enabled: true }];
  }

  if (state.scene === 'aftermath') {
    return getAftermathChoices(state);
  }

  if (state.scene === 'dungeon') {
    return getDungeonChoices(state);
  }

  if (state.scene === 'camp_hub') {
    if (state.subMenu === 'root') {
      entries.push({ index: 1, id: 'hub:explore', label: 'Explore', enabled: true });
      const destinations = [...state.frontier.unlockedAreas, ...state.frontier.unlockedTowns];
      entries.push({
        index: 2,
        id: 'sub:travel',
        label: 'Travel',
        enabled: destinations.length > 0,
        reason: destinations.length > 0 ? undefined : 'Explore to find areas first',
      });
      entries.push({ index: 3, id: 'camp_action', label: 'Rest', enabled: true });
      entries.push({ index: 4, id: 'sub:stash', label: 'Stash', enabled: true });
      entries.push({ index: 5, id: 'sub:pack', label: 'Pack', enabled: true });
      entries.push({ index: 6, id: 'open_journal', label: 'Journal', enabled: true });
      return entries;
    }

    if (state.subMenu === 'travel') {
      const destinations = [...state.frontier.unlockedAreas, ...state.frontier.unlockedTowns];
      for (const destId of destinations) {
        const destName = SHORT_LOCATION_NAMES[destId] ?? LOCATIONS[destId]?.name ?? destId;
        entries.push({
          index: entries.length + 1,
          id: `hub:travel:${destId}`,
          label: destName,
          enabled: true,
        });
      }
      entries.push({ index: entries.length + 1, id: 'sub:root', label: 'Back', enabled: true });
      return entries;
    }

    if (state.subMenu === 'stash') {
      entries.push({ index: 1, id: 'sub:stash_put', label: 'Store', enabled: true });
      entries.push({ index: 2, id: 'sub:stash_take', label: 'Take', enabled: true });
      entries.push({ index: 3, id: 'sub:root', label: 'Back', enabled: true });
      return entries;
    }

    if (state.subMenu === 'stash_put') {
      for (const entry of state.player.inventory) {
        if (entry.qty <= 0) continue;
        const item = ITEMS[entry.id];
        if (!item) continue;
        entries.push({
          index: entries.length + 1,
          id: `stash:put:${item.id}`,
          label: item.name,
          enabled: true,
        });
      }
      entries.push({ index: entries.length + 1, id: 'sub:stash', label: 'Back', enabled: true });
      return entries;
    }

    if (state.subMenu === 'stash_take') {
      for (const entry of state.frontier.stash) {
        if (entry.qty <= 0) continue;
        const item = ITEMS[entry.id];
        if (!item) continue;
        entries.push({
          index: entries.length + 1,
          id: `stash:take:${item.id}`,
          label: item.name,
          enabled: true,
        });
      }
      entries.push({ index: entries.length + 1, id: 'sub:stash', label: 'Back', enabled: true });
      return entries;
    }
  }

  if (state.scene === 'location' || state.scene === 'camp_hub') {
    const loc = LOCATIONS[state.locationId];

    if (state.scene === 'location' && state.subMenu === 'root') {
      if (loc.regionType === 'area') {
        entries.push({ index: entries.length + 1, id: 'area:explore', label: 'Explore', enabled: true });
        const areaSubs = Object.values(loadWorldDatabase().subAreas).filter(
          (sa) => sa.parentAreaId === loc.id && state.frontier.unlockedSubAreas.includes(sa.id),
        );
        if (areaSubs.length > 0) {
          entries.push({
            index: entries.length + 1,
            id: 'area:toggle_subarea',
            label: state.frontier.activeSubArea[loc.id] ? 'Main Area' : 'Sub-Area',
            enabled: true,
          });
        }
        const areaDungeons = Object.values(loadWorldDatabase().dungeons).filter(
          (d) => d.parentAreaId === loc.id && state.frontier.unlockedDungeons.includes(d.id),
        );
        for (const d of areaDungeons) {
          entries.push({
            index: entries.length + 1,
            id: `area:enter_dungeon:${d.id}`,
            label: 'Dungeon',
            enabled: true,
          });
        }
      }

      const hasSiteActions = loc.actions.some((a) => !a.visible || a.visible(state));
      if (hasSiteActions) {
        entries.push({
          index: entries.length + 1,
          id: 'sub:explore',
          label: loc.regionType === 'area' ? 'Search' : 'Interact',
          enabled: true,
        });
      }

      const hasNpcs = Boolean(loc.npcs?.some((n) => !n.visible || n.visible(state)));
      if (hasNpcs) {
        entries.push({ index: entries.length + 1, id: 'sub:talk', label: 'Talk', enabled: true });
      }
      if (loc.shop && !hasFlag(state, 'cinderford_fallen') && !hasFlag(state, 'stole_cistern_vesper')) {
        entries.push({ index: entries.length + 1, id: 'open_shop', label: 'Trade', enabled: true });
      }
      if (loc.regionType === 'town' && !hasFlag(state, 'cinderford_fallen')) {
        entries.push({ index: entries.length + 1, id: 'rest_action', label: 'Rest', enabled: true });
      } else {
        entries.push({ index: entries.length + 1, id: 'camp_action', label: 'Camp', enabled: true });
      }
      entries.push({ index: entries.length + 1, id: 'sub:pack', label: 'Pack', enabled: true });
      entries.push({ index: entries.length + 1, id: 'open_journal', label: 'Journal', enabled: true });
      entries.push({ index: entries.length + 1, id: 'return_camp', label: 'Return', enabled: true });
      return entries;
    }

    if (state.scene === 'location' && state.subMenu === 'explore') {
      for (const action of loc.actions) {
        if (!action.visible || action.visible(state)) {
          entries.push({
            index: entries.length + 1,
            id: `loc:${action.id}`,
            label: action.label,
            enabled: true,
          });
        }
      }
      entries.push({ index: entries.length + 1, id: 'sub:root', label: 'Back', enabled: true });
      return entries;
    }

    if (state.subMenu === 'talk') {
      for (const npc of loc.npcs ?? []) {
        if (!npc.visible || npc.visible(state)) {
          entries.push({
            index: entries.length + 1,
            id: `npc:${npc.id}`,
            label: getNpcDisplayName(state, npc),
            enabled: true,
          });
        }
      }
      entries.push({ index: entries.length + 1, id: 'sub:root', label: 'Back', enabled: true });
      return entries;
    }

    if (state.subMenu === 'dialogue' && state.activeNpcId) {
      const npc = loc.npcs?.find((n) => n.id === state.activeNpcId);
      if (npc) {
        for (const topic of npc.topics) {
          if (!topic.visible || topic.visible(state)) {
            entries.push({
              index: entries.length + 1,
              id: `topic:${topic.id}`,
              label: topic.label,
              enabled: true,
            });
          }
        }
      }
      entries.push({ index: entries.length + 1, id: 'sub:talk', label: 'Leave', enabled: true });
      return entries;
    }

    if (state.subMenu === 'travel') {
      for (const neighborId of loc.neighbors) {
        const destName = SHORT_LOCATION_NAMES[neighborId] ?? LOCATIONS[neighborId]?.name ?? neighborId;
        entries.push({
          index: entries.length + 1,
          id: `travel:${neighborId}`,
          label: destName,
          enabled: true,
        });
      }
      entries.push({ index: entries.length + 1, id: 'sub:root', label: 'Back', enabled: true });
      return entries;
    }

    if (state.subMenu === 'pack') {
      entries.push({ index: 1, id: 'sub:pack_use', label: 'Use', enabled: true });
      entries.push({ index: 2, id: 'sub:pack_equip', label: 'Equip', enabled: true });
      entries.push({ index: 3, id: 'sub:pack_craft', label: 'Craft', enabled: true });
      entries.push({ index: 4, id: 'sub:pack_mods', label: 'Body Mods', enabled: true });
      entries.push({ index: 5, id: 'open_journal', label: 'Journal', enabled: true });
      entries.push({ index: 6, id: 'sub:root', label: 'Back', enabled: true });
      return entries;
    }

    if (state.subMenu === 'pack_use') {
      for (const entry of state.player.inventory) {
        const item = ITEMS[entry.id];
        if (
          item &&
          (item.slot === 'consumable' ||
            item.slot === 'draught' ||
            item.slot === 'coating' ||
            item.slot === 'ash_text') &&
          !item.throwDamage &&
          entry.qty > 0
        ) {
          entries.push({
            index: entries.length + 1,
            id: `use_item:${item.id}`,
            label: item.name,
            enabled: true,
          });
        }
      }
      entries.push({ index: entries.length + 1, id: 'sub:pack', label: 'Back', enabled: true });
      return entries;
    }

    if (state.subMenu === 'pack_equip') {
      for (const entry of state.player.inventory) {
        const item = ITEMS[entry.id];
        if (
          item &&
          (item.slot === 'mainHand' ||
            item.slot === 'offHand' ||
            item.slot === 'armor' ||
            item.slot === 'cloak' ||
            item.slot === 'trinket') &&
          entry.qty > 0
        ) {
          entries.push({
            index: entries.length + 1,
            id: `equip_item:${item.id}`,
            label: item.name,
            enabled: true,
          });
        }
      }
      entries.push({ index: entries.length + 1, id: 'sub:pack', label: 'Back', enabled: true });
      return entries;
    }

    if (state.subMenu === 'pack_craft') {
      const expert = state.player.race === 'grixi' || state.player.background === 'root_scholar';
      for (const recipe of RECIPES) {
        if (recipe.grixiOrScholarOnly && !expert) continue;
        const ok = canCraftRecipe(state, recipe);
        entries.push({
          index: entries.length + 1,
          id: `craft:${recipe.id}`,
          label: recipe.name,
          enabled: ok,
          reason: ok ? undefined : 'Missing reagents',
        });
      }
      entries.push({ index: entries.length + 1, id: 'sub:pack', label: 'Back', enabled: true });
      return entries;
    }

    if (state.subMenu === 'pack_mods') {
      for (const [slot, modId] of Object.entries(state.player.bodyMods)) {
        const mod = modId ? BODY_MODS[modId] : undefined;
        if (mod) {
          entries.push({
            index: entries.length + 1,
            id: `excise:${slot}`,
            label: `Excise ${mod.name}`,
            enabled: state.player.hp > 6,
            reason: state.player.hp > 6 ? undefined : 'Too wounded for excision',
          });
        }
      }
      entries.push({ index: entries.length + 1, id: 'sub:pack', label: 'Back', enabled: true });
      return entries;
    }
  } else if (state.scene === 'event' && state.activeEvent) {
    if (state.activeEvent.resolved) {
      entries.push({ index: 1, id: 'event_continue', label: 'Continue', enabled: true });
    } else {
      const ev = EVENTS.find((e) => e.id === state.activeEvent!.eventId);
      const beatIdx = state.activeEvent.beatIndex ?? 0;
      if (ev?.promptBeats && beatIdx < ev.promptBeats.length - 1) {
        entries.push({ index: 1, id: 'event_beat_next', label: 'Continue', enabled: true });
      } else if (ev) {
        for (const ch of ev.choices) {
          if (!ch.visible || ch.visible(state)) {
            const check = ch.enabled ? ch.enabled(state) : { ok: true };
            entries.push({
              index: entries.length + 1,
              id: `ev:${ch.id}`,
              label: ch.label,
              enabled: check.ok,
              reason: check.reason,
            });
          }
        }
      }
    }
  } else if (state.scene === 'combat') {
    return getCombatMenuOptions(state);
  } else if (state.scene === 'shop') {
    const loc = LOCATIONS[state.locationId];
    const shop = state.activeMerchant ?? loc?.shop;
    if (shop) {
      const hasBlackMarket =
        state.player.race === 'grixi' || state.memory.factions.under_warren >= 1;
      for (const listing of shop.items) {
        if (listing.underWarrenOnly && !hasBlackMarket) continue;
        const item = ITEMS[listing.itemId];
        if (!item) continue;
        entries.push({
          index: entries.length + 1,
          id: `buy_item:${item.id}:${listing.price}`,
          label: `${item.name} - ${listing.price}c`,
          enabled: state.player.crowns >= listing.price,
          reason: 'Insufficient Crowns',
        });
      }
      const rationCost = hasFlag(state, 'granary_burned') ? 9 : 6;
      entries.push({
        index: entries.length + 1,
        id: `buy_ration:${rationCost}`,
        label: `Ration - ${rationCost}c`,
        enabled: state.player.crowns >= rationCost,
        reason: 'Insufficient Crowns',
      });
      entries.push({
        index: entries.length + 1,
        id: 'buy_torch:4',
        label: 'Pitch-Torch - 4c',
        enabled: state.player.crowns >= 4,
        reason: 'Insufficient Crowns',
      });
    }
    entries.push({
      index: entries.length + 1,
      id: 'leave_shop',
      label: 'Leave',
      enabled: true,
    });
  } else if (state.scene === 'level_up') {
    for (const pid of state.pendingPerkIds) {
      const perk = PERKS[pid];
      if (perk) {
        entries.push({
          index: entries.length + 1,
          id: `perk:${perk.id}`,
          label: perk.name,
          enabled: true,
        });
      }
    }
  }

  return entries;
}

function openJournal(state: GameState, initialTab: JournalTab = 'root'): void {
  if (state.scene !== 'journal') {
    state.journalReturn = { scene: state.scene, subMenu: state.subMenu };
  }
  state.scene = 'journal';
  state.journalTab = initialTab;
  state.journalDetailId = null;
}

function closeJournal(state: GameState): void {
  if (state.journalReturn) {
    state.scene = state.journalReturn.scene;
    state.subMenu = state.journalReturn.subMenu;
    state.journalReturn = null;
  } else {
    state.scene = 'location';
    state.subMenu = 'root';
  }
  state.journalTab = 'root';
  state.journalDetailId = null;
}

function applyActionOutcome(state: GameState, outcome: ActionOutcome): string[] {
  const msgs = [...outcome.messages];
  if (outcome.advanceHours && outcome.advanceHours > 0) {
    msgs.push(...advanceHours(state, outcome.advanceHours));
  } else if (outcome.advanceDay && outcome.advanceDay > 0) {
    msgs.push(...advanceHours(state, outcome.advanceDay * 8, { sheltered: true }));
  }

  if (outcome.triggerEnding) {
    state.scene = 'ending';
    state.subMenu = 'root';
    state.activeNpcId = null;
    state.endingSummary = synthesizeEpilogue(state, outcome.triggerEnding.endingId);
    msgs.push('');
    msgs.push(outcome.triggerEnding.title.toUpperCase());
    msgs.push(outcome.triggerEnding.openingText);
    msgs.push(state.endingSummary);
    return msgs;
  }
  if (outcome.startCombat) {
    state.subMenu = 'root';
    state.activeNpcId = null;
    const { introMessages } = startCombatEncounter(state, outcome.startCombat);
    msgs.push(...introMessages);
    return msgs;
  }
  if (!outcome.stayInDialogue && state.subMenu === 'dialogue') {
    state.subMenu = 'root';
    state.activeNpcId = null;
  }
  return msgs;
}

function drawRoadEvent(state: GameState): boolean {
  const locId = state.locationId;
  const period = getTimePeriod(state.clock.hour);
  const weather = state.clock.weather;

  const candidates = EVENTS.filter((ev) => {
    if (!ev.locations.includes(locId)) return false;
    if (!ev.repeatable && state.seenEvents.includes(ev.id)) return false;
    if (ev.repeatable) {
      const readyHour = state.eventCooldowns[ev.id] ?? 0;
      if (state.clock.totalHours < readyHour) return false;
    }
    if (ev.minDay && state.day < ev.minDay) return false;
    if (ev.maxDay && state.day > ev.maxDay) return false;
    if (ev.periods && !ev.periods.includes(period)) return false;
    if (ev.weathers && !ev.weathers.includes(weather)) return false;
    if (ev.minDefilement !== undefined && state.player.defilement < ev.minDefilement) return false;
    if (ev.maxDefilement !== undefined && state.player.defilement > ev.maxDefilement) return false;
    if (ev.requiredTags && !ev.requiredTags.every((t) => state.player.anatomy.visibleTags.includes(t))) {
      return false;
    }
    if (ev.condition && !ev.condition(state)) return false;
    return true;
  });

  if (candidates.length === 0) return false;

  const totalWeight = candidates.reduce((acc, ev) => acc + (ev.weight ?? 1), 0);
  let pick = nextRandom(state) * totalWeight;
  let chosen = candidates[0];
  for (const ev of candidates) {
    pick -= ev.weight ?? 1;
    if (pick <= 0) {
      chosen = ev;
      break;
    }
  }

  if (!state.seenEvents.includes(chosen.id)) {
    state.seenEvents.push(chosen.id);
  }
  if (chosen.repeatable) {
    state.eventCooldowns[chosen.id] = state.clock.totalHours + (chosen.cooldownHours ?? 24);
  }
  state.scene = 'event';
  state.subMenu = 'root';
  state.activeEvent = { eventId: chosen.id, beatIndex: 0, resolved: false };
  return true;
}

function travelTo(state: GameState, destId: string): string[] {
  const curLoc = LOCATIONS[state.locationId];
  if (!curLoc.neighbors.includes(destId)) {
    return [`You cannot reach ${LOCATIONS[destId]?.name ?? destId} directly from here.`];
  }
  const dest = LOCATIONS[destId];
  const msgs = [`You set out along the ash-strewn trail toward ${dest.name}.`];
  msgs.push(...advanceHours(state, 4));

  state.locationId = destId;
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
    destId === 'frostwall_redoubt' &&
    state.day >= 8 &&
    !hasFlag(state, 'cinderford_saved') &&
    !hasFlag(state, 'cinderford_fallen')
  ) {
    setFlag(state, 'cinderford_fallen', true);
    recordChronicle(
      state,
      'Timber Post Fell',
      'Because the spoiled grain cellar went ignored past Day 8, Timber Post succumbed from within.',
      'frostwall_redoubt',
    );
    msgs.push(
      'Timber Post has succumbed to the cellar rot. Two stooped figures stumble out from the unbarred gatehouse.',
    );
    const { introMessages } = startCombatEncounter(state, {
      enemyIds: ['root_husk', 'root_husk'],
      canFlee: true,
    });
    msgs.push(...introMessages);
    return msgs;
  }

  state.player.stamina = Math.min(state.player.maxStamina, state.player.stamina + 1);

  if (dest.regionType === 'road' || dest.regionType === 'ruin') {
    const weatherBonus = WEATHER_DATA[state.clock.weather].ambushBonus;
    const chance = (dest.regionType === 'road' ? 0.8 : 0.6) + weatherBonus;
    if (nextRandom(state) <= chance) {
      drawRoadEvent(state);
    }
  }

  return msgs;
}

function performSettlementRest(state: GameState): string[] {
  const free = hasFlag(state, 'granary_purified');
  const cost = free ? 0 : 6;
  if (state.player.crowns < cost) {
    return [`Martha asks ${cost} Crowns for hearth and straw.`];
  }
  state.player.crowns -= cost;
  const clockMsgs = advanceHours(state, 8, { sheltered: true });
  state.player.hp = state.player.maxHp;
  state.player.stamina = state.player.maxStamina;
  state.player.focus = state.player.maxFocus;
  state.player.resolve = state.player.maxResolve;
  state.player.statuses = [];
  state.player.determinationAvailable = true;
  state.subMenu = 'root';

  const msgs: string[] = [
    free
      ? 'Martha refuses your silver, offering warm broth and quiet sleep until the next watch.'
      : 'Warm stew and deep sleep beside the peat hearth restore your strength and resolve.',
  ];
  if (state.player.injuries.length > 0) {
    msgs.push(...tendInjury(state, state.player.injuries[0], false));
  }
  msgs.push(...clockMsgs);
  return msgs;
}

function handleEquipCommand(state: GameState, query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return ['Equip what?'];
  const entry = state.player.inventory.find((e) => {
    const def = ITEMS[e.id];
    return def && (def.id === q || def.name.toLowerCase().includes(q));
  });
  if (!entry) return [`No item matching "${query}" found in your pack.`];
  const newDef = ITEMS[entry.id];
  const equipSlots = ['mainHand', 'offHand', 'armor', 'cloak', 'trinket'] as const;
  if (!newDef || !equipSlots.includes(newDef.slot as (typeof equipSlots)[number])) {
    return [`${newDef?.name ?? entry.id} cannot be equipped.`];
  }

  const p = state.player;
  const targetSlot = newDef.slot as (typeof equipSlots)[number];
  const currentMain = p.equipment.mainHand ? ITEMS[p.equipment.mainHand] : undefined;
  if (targetSlot === 'offHand' && currentMain?.twoHanded) {
    return [`Cannot equip ${newDef.name} while wielding two-handed ${currentMain.name}.`];
  }

  entry.qty -= 1;
  if (entry.qty <= 0) {
    p.inventory = p.inventory.filter((e) => e.id !== entry.id);
  }

  const msgs: string[] = [];
  const oldId = p.equipment[targetSlot];
  if (oldId) {
    const oldDef = ITEMS[oldId];
    if (oldDef?.maxHpBonus) p.maxHp = Math.max(10, p.maxHp - oldDef.maxHpBonus);
    if (oldDef?.maxFocusBonus) p.maxFocus = Math.max(4, p.maxFocus - oldDef.maxFocusBonus);
    if (oldDef?.maxResolveBonus) p.maxResolve = Math.max(6, p.maxResolve - oldDef.maxResolveBonus);
    addItemToInventory(state, oldId, 1);
  }

  if (targetSlot === 'mainHand') {
    p.weaponHoned = false;
    p.weaponCoating = null;
    if (newDef.twoHanded && p.equipment.offHand) {
      const offId = p.equipment.offHand;
      const offDef = ITEMS[offId];
      if (offDef?.maxHpBonus) p.maxHp = Math.max(10, p.maxHp - offDef.maxHpBonus);
      if (offDef?.maxFocusBonus) p.maxFocus = Math.max(4, p.maxFocus - offDef.maxFocusBonus);
      if (offDef?.maxResolveBonus) p.maxResolve = Math.max(6, p.maxResolve - offDef.maxResolveBonus);
      addItemToInventory(state, offId, 1);
      p.equipment.offHand = null;
      msgs.push(`Returned ${offDef?.name ?? offId} to your pack to wield ${newDef.name} two-handed.`);
    }
  }

  p.equipment[targetSlot] = newDef.id;
  if (targetSlot === 'armor') {
    p.armorTierCurrent = newDef.armorTier ?? 0;
  }
  if (newDef.maxHpBonus) p.maxHp += newDef.maxHpBonus;
  if (newDef.maxFocusBonus) p.maxFocus += newDef.maxFocusBonus;
  if (newDef.maxResolveBonus) p.maxResolve += newDef.maxResolveBonus;
  p.hp = Math.min(p.hp, p.maxHp);
  p.focus = Math.min(p.focus, p.maxFocus);
  p.resolve = Math.min(p.resolve, p.maxResolve);

  msgs.unshift(`Equipped ${newDef.name}.`);
  return msgs;
}

function handleUseCommand(state: GameState, query: string): string[] {
  if (state.scene === 'combat') {
    return ['Pick Item from the combat menu instead.'];
  }
  const q = query.trim().toLowerCase();
  if (!q) return ['Use what?'];
  const entry = state.player.inventory.find((e) => {
    const def = ITEMS[e.id];
    return (
      def &&
      (def.slot === 'consumable' ||
        def.slot === 'draught' ||
        def.slot === 'coating' ||
        def.slot === 'ash_text') &&
      (def.id === q || def.name.toLowerCase().includes(q))
    );
  });
  if (!entry) return [`No usable item matching "${query}" in your pack.`];
  const item = ITEMS[entry.id];
  if (!item || item.throwDamage) {
    return [`${item?.name ?? query} can only be thrown during combat.`];
  }
  if (item.slot === 'ash_text' && (item.ashTextEffect === 'bone_shatter' || item.ashTextEffect === 'blight_wave')) {
    return [`${item.name} must be read facing an enemy in combat.`];
  }

  entry.qty -= 1;
  if (entry.qty <= 0) {
    state.player.inventory = state.player.inventory.filter((e) => e.id !== entry.id);
  }

  if (item.slot === 'draught') {
    return drinkDraught(state, item.id);
  }
  if (item.slot === 'coating') {
    return applyWeaponCoating(state, item.id);
  }
  if (item.slot === 'ash_text') {
    return castAshTextOutOfCombat(state, item.id);
  }

  if (item.grantsBodyModId) {
    return installBodyMod(state, item.grantsBodyModId);
  }

  const msgs = [`Used ${item.name}.`];
  if (item.healHp) {
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + item.healHp);
    msgs.push(`Restored ${item.healHp} health.`);
  }
  if (item.restoreStamina) {
    state.player.stamina = Math.min(state.player.maxStamina, state.player.stamina + item.restoreStamina);
    msgs.push(`Restored ${item.restoreStamina} stamina.`);
  }
  if (item.restoreFocus) {
    state.player.focus = Math.min(state.player.maxFocus, state.player.focus + item.restoreFocus);
    msgs.push(`Restored ${item.restoreFocus} focus.`);
  }
  if (item.restoreResolve) {
    state.player.resolve = Math.min(state.player.maxResolve, state.player.resolve + item.restoreResolve);
    msgs.push(`Restored ${item.restoreResolve} resolve.`);
  }
  if (item.cureNegative) {
    state.player.statuses = [];
    msgs.push('Cleared all afflictions.');
  }
  if (item.tendsInjury && state.player.injuries.length > 0) {
    msgs.push(...tendInjury(state, state.player.injuries[0], false));
  }
  return msgs;
}

function handleBackShortcut(state: GameState): boolean {
  if (state.scene === 'journal') {
    if (state.journalDetailId) {
      state.journalDetailId = null;
    } else if (state.journalTab !== 'root') {
      state.journalTab = 'root';
    } else {
      closeJournal(state);
    }
    return true;
  }
  if (state.scene === 'camp' && state.subMenu === 'pack_craft') {
    state.subMenu = 'root';
    return true;
  }
  if (state.scene === 'combat' && state.combat && state.combat.subMenu !== 'root') {
    executeCombatAction(state, 'menu:back');
    return true;
  }
  if (state.scene === 'shop') {
    state.activeMerchant = null;
    state.scene = state.locationId === 'camp_hub' ? 'camp_hub' : 'location';
    state.subMenu = 'root';
    return true;
  }
  if ((state.scene === 'location' || state.scene === 'camp_hub') && state.subMenu !== 'root') {
    if (state.subMenu === 'dialogue') {
      state.subMenu = 'talk';
      state.activeNpcId = null;
    } else if (state.subMenu === 'stash_put' || state.subMenu === 'stash_take') {
      state.subMenu = 'stash';
    } else if (
      state.subMenu === 'pack_use' ||
      state.subMenu === 'pack_equip' ||
      state.subMenu === 'pack_craft' ||
      state.subMenu === 'pack_mods'
    ) {
      state.subMenu = 'pack';
    } else {
      state.subMenu = 'root';
    }
    return true;
  }
  return false;
}

export function processInput(
  state: GameState,
  rawInput: string,
): { messages: string[]; shouldQuit: boolean } {
  try {
    return processInputInner(state, rawInput);
  } catch {
    state.combat = null;
    state.aftermath = null;
    state.activeEvent = null;
    state.activeMerchant = null;
    if (state.frontier) state.frontier.activeDungeonId = null;
    state.locationId = 'camp_hub';
    state.scene = 'camp_hub';
    state.subMenu = 'root';
    return {
      messages: ['The trail gives way under your boots; you steady yourself back at your Lone Camp.'],
      shouldQuit: false,
    };
  }
}

function processInputInner(
  state: GameState,
  rawInput: string,
): { messages: string[]; shouldQuit: boolean } {
  const input = rawInput.trim();
  const lower = input.toLowerCase();

  if (!input) return { messages: [], shouldQuit: false };

  if (lower === 'quit' || lower === 'q' || lower === 'exit') {
    return { messages: ['Run auto-saved.'], shouldQuit: true };
  }

  if (lower === 'stealth') {
    state.stealthMode = !state.stealthMode;
    return {
      messages: [`Stealth mode ${state.stealthMode ? 'on' : 'off'}.`],
      shouldQuit: false,
    };
  }

  if (lower === 'help' || lower === 'h' || lower === '?') {
    return { messages: [renderHelpText()], shouldQuit: false };
  }

  if (lower === 'journal' || lower === 'j') {
    if (state.scene !== 'intro' && state.scene !== 'dead' && state.scene !== 'ending') {
      openJournal(state, 'root');
      return { messages: [], shouldQuit: false };
    }
  }

  if (lower === 'memory') {
    return { messages: [renderMemoryChronicle(state)], shouldQuit: false };
  }

  if (lower === 'look' || lower === 'l') {
    if (state.scene === 'location') {
      const loc = LOCATIONS[state.locationId];
      return { messages: [loc.firstSightProse(state)], shouldQuit: false };
    }
    return { messages: [], shouldQuit: false };
  }

  if (lower === 'back' || lower === '0') {
    if (handleBackShortcut(state)) {
      return { messages: [], shouldQuit: false };
    }
  }

  if (lower === 'map' || lower === 'm') {
    return { messages: [renderAsciiMap(state)], shouldQuit: false };
  }

  if (lower === 'stats' || lower === 'st') {
    return { messages: [renderCharacterSheet(state)], shouldQuit: false };
  }

  if (lower === 'inv' || lower === 'i' || lower === 'inventory') {
    return { messages: [renderInventory(state)], shouldQuit: false };
  }

  if (lower.startsWith('equip ')) {
    return { messages: handleEquipCommand(state, input.slice(6)), shouldQuit: false };
  }

  if (lower.startsWith('use ')) {
    return { messages: handleUseCommand(state, input.slice(4)), shouldQuit: false };
  }

  if (lower === 'camp') {
    if (state.scene !== 'location' && state.scene !== 'camp_hub') {
      return { messages: ['You cannot pitch camp right now.'], shouldQuit: false };
    }
    return { messages: enterMobileCamp(state), shouldQuit: false };
  }

  if (lower === 'rest') {
    if (state.scene !== 'location' && state.scene !== 'camp_hub') {
      return { messages: ['You cannot rest right now.'], shouldQuit: false };
    }
    if (LOCATIONS[state.locationId]?.regionType === 'town' && !hasFlag(state, 'cinderford_fallen')) {
      return { messages: performSettlementRest(state), shouldQuit: false };
    }
    return { messages: enterMobileCamp(state), shouldQuit: false };
  }

  if (lower.startsWith('go ')) {
    if (state.scene !== 'location') {
      return { messages: ['Resolve your current state before traveling.'], shouldQuit: false };
    }
    const target = lower.slice(3).trim();
    const loc = LOCATIONS[state.locationId];
    const destId = loc.neighbors.find((nid) => {
      const n = LOCATIONS[nid];
      const sn = SHORT_LOCATION_NAMES[nid]?.toLowerCase() ?? '';
      return n && (n.id === target || n.name.toLowerCase().includes(target) || sn.includes(target));
    });
    if (!destId) {
      return { messages: [`No road matching "${target}".`], shouldQuit: false };
    }
    return { messages: travelTo(state, destId), shouldQuit: false };
  }

  const choices = getSceneChoices(state);
  let chosen = choices.find((c) => String(c.index) === input);
  if (!chosen) {
    chosen = choices.find((c) => c.label.toLowerCase() === lower);
  }

  if (!chosen) {
    return { messages: ['Unknown choice. Enter a number or type help.'], shouldQuit: false };
  }

  if (!chosen.enabled) {
    return {
      messages: [chosen.reason ?? 'Unavailable.'],
      shouldQuit: false,
    };
  }

  // Intro
  if (chosen.id === 'intro:next') {
    if (state.introBeat + 1 < INTRO_BEAT_COUNT) {
      state.introBeat += 1;
      return { messages: [], shouldQuit: false };
    }
    state.scene = 'camp_hub';
    state.subMenu = 'root';
    return { messages: ['Cold ash settles around your lone camp in the scrub. Explore to chart the frontier.'], shouldQuit: false };
  }
  if (chosen.id === 'intro:skip') {
    state.scene = 'camp_hub';
    state.subMenu = 'root';
    return { messages: ['Cold ash settles around your lone camp in the scrub. Explore to chart the frontier.'], shouldQuit: false };
  }

  // Journal
  if (chosen.id === 'open_journal') {
    openJournal(state, 'root');
    return { messages: [], shouldQuit: false };
  }
  if (chosen.id === 'jclose') {
    closeJournal(state);
    return { messages: [], shouldQuit: false };
  }
  if (chosen.id === 'jdetail:back') {
    state.journalDetailId = null;
    return { messages: [], shouldQuit: false };
  }
  if (chosen.id.startsWith('jtab:')) {
    state.journalTab = chosen.id.slice(5) as JournalTab;
    state.journalDetailId = null;
    return { messages: [], shouldQuit: false };
  }
  if (chosen.id.startsWith('jdetail:')) {
    state.journalDetailId = chosen.id.slice(8);
    return { messages: [], shouldQuit: false };
  }

  // Camp
  if (chosen.id === 'camp_action') {
    return { messages: enterMobileCamp(state), shouldQuit: false };
  }
  if (chosen.id === 'camp:craft') {
    state.subMenu = 'pack_craft';
    return { messages: [], shouldQuit: false };
  }
  if (chosen.id === 'camp:back') {
    state.subMenu = 'root';
    return { messages: [], shouldQuit: false };
  }
  if (chosen.id.startsWith('camp:')) {
    return { messages: executeCampAction(state, chosen.id), shouldQuit: false };
  }

  // Aftermath
  if (chosen.id.startsWith('after:')) {
    return { messages: executeAftermathAction(state, chosen.id), shouldQuit: false };
  }

  // Sub-menus
  if (chosen.id === 'sub:root') {
    state.subMenu = 'root';
    state.activeNpcId = null;
    return { messages: [], shouldQuit: false };
  }
  if (chosen.id === 'sub:explore') {
    state.subMenu = 'explore';
    return { messages: [], shouldQuit: false };
  }
  if (chosen.id === 'sub:talk') {
    state.subMenu = 'talk';
    state.activeNpcId = null;
    return { messages: [], shouldQuit: false };
  }
  if (chosen.id === 'sub:travel') {
    state.subMenu = 'travel';
    return { messages: [], shouldQuit: false };
  }
  if (chosen.id === 'sub:stash') {
    state.subMenu = 'stash';
    return { messages: [], shouldQuit: false };
  }
  if (chosen.id === 'sub:stash_put') {
    state.subMenu = 'stash_put';
    return { messages: [], shouldQuit: false };
  }
  if (chosen.id === 'sub:stash_take') {
    state.subMenu = 'stash_take';
    return { messages: [], shouldQuit: false };
  }
  if (chosen.id === 'hub:explore') {
    return { messages: rollCampExplore(state), shouldQuit: false };
  }
  if (chosen.id.startsWith('hub:travel:')) {
    return { messages: travelFromCamp(state, chosen.id.slice(11)), shouldQuit: false };
  }
  if (chosen.id === 'area:explore') {
    return { messages: rollAreaExplore(state, state.locationId), shouldQuit: false };
  }
  if (chosen.id === 'area:toggle_subarea') {
    const subs = Object.values(loadWorldDatabase().subAreas).filter(
      (sa) => sa.parentAreaId === state.locationId && state.frontier.unlockedSubAreas.includes(sa.id),
    );
    const cur = state.frontier.activeSubArea[state.locationId];
    if (cur) {
      state.frontier.activeSubArea[state.locationId] = null;
      return { messages: ['Shifted exploration back to the main area.'], shouldQuit: false };
    }
    if (subs.length > 0) {
      state.frontier.activeSubArea[state.locationId] = subs[0].id;
      return { messages: [`Shifted exploration to ${subs[0].name}.`], shouldQuit: false };
    }
    return { messages: ['No secret sub-area unlocked here.'], shouldQuit: false };
  }
  if (chosen.id.startsWith('area:enter_dungeon:')) {
    return { messages: enterDungeon(state, chosen.id.slice(19)), shouldQuit: false };
  }
  if (chosen.id === 'return_camp') {
    return { messages: returnToCampHub(state), shouldQuit: false };
  }
  if (chosen.id.startsWith('stash:put:')) {
    const itemId = chosen.id.slice(10);
    if (consumeInventoryItem(state, itemId, 1)) {
      const existing = state.frontier.stash.find((e) => e.id === itemId);
      if (existing) existing.qty += 1;
      else state.frontier.stash.push({ id: itemId, qty: 1 });
      state.subMenu = 'stash';
      return { messages: [`Stored ${ITEMS[itemId]?.name ?? itemId} at camp.`], shouldQuit: false };
    }
    return { messages: ['Item not found in pack.'], shouldQuit: false };
  }
  if (chosen.id.startsWith('stash:take:')) {
    const itemId = chosen.id.slice(11);
    const idx = state.frontier.stash.findIndex((e) => e.id === itemId);
    if (idx >= 0 && state.frontier.stash[idx].qty > 0) {
      state.frontier.stash[idx].qty -= 1;
      if (state.frontier.stash[idx].qty <= 0) state.frontier.stash.splice(idx, 1);
      addItemToInventory(state, itemId, 1);
      state.subMenu = 'stash';
      return { messages: [`Retrieved ${ITEMS[itemId]?.name ?? itemId} into pack.`], shouldQuit: false };
    }
    return { messages: ['Item not found in stash.'], shouldQuit: false };
  }
  if (state.scene === 'dungeon') {
    return { messages: executeDungeonAction(state, chosen.id), shouldQuit: false };
  }
  if (chosen.id === 'sub:pack') {
    state.subMenu = 'pack';
    return { messages: [], shouldQuit: false };
  }
  if (chosen.id === 'sub:pack_use') {
    state.subMenu = 'pack_use';
    return { messages: [], shouldQuit: false };
  }
  if (chosen.id === 'sub:pack_equip') {
    state.subMenu = 'pack_equip';
    return { messages: [], shouldQuit: false };
  }
  if (chosen.id === 'sub:pack_craft') {
    state.subMenu = 'pack_craft';
    return { messages: [], shouldQuit: false };
  }
  if (chosen.id === 'sub:pack_mods') {
    state.subMenu = 'pack_mods';
    return { messages: [], shouldQuit: false };
  }

  if (chosen.id === 'rest_action') {
    return { messages: performSettlementRest(state), shouldQuit: false };
  }
  if (chosen.id.startsWith('use_item:')) {
    const itemId = chosen.id.slice(9);
    const msgs = handleUseCommand(state, itemId);
    state.subMenu = 'pack';
    return { messages: msgs, shouldQuit: false };
  }
  if (chosen.id.startsWith('equip_item:')) {
    const itemId = chosen.id.slice(11);
    const msgs = handleEquipCommand(state, itemId);
    state.subMenu = 'pack';
    return { messages: msgs, shouldQuit: false };
  }
  if (chosen.id.startsWith('excise:')) {
    const slot = chosen.id.slice(7) as BodySlot;
    const msgs = [...exciseBodyMod(state, slot), ...advanceHours(state, 1)];
    state.subMenu = 'pack';
    return { messages: msgs, shouldQuit: false };
  }
  if (chosen.id.startsWith('craft:')) {
    const recipeId = chosen.id.slice(6);
    const recipe = RECIPES.find((r) => r.id === recipeId);
    if (!recipe || !canCraftRecipe(state, recipe)) {
      return { messages: ['Missing reagents.'], shouldQuit: false };
    }
    for (const ing of recipe.ingredients) {
      consumeInventoryItem(state, ing.itemId, ing.qty);
    }
    addItemToInventory(state, recipe.outputItemId, recipe.outputQty);
    const clockMsgs = advanceHours(state, 1, { sheltered: state.scene === 'camp' });
    return {
      messages: [`Crafted ${ITEMS[recipe.outputItemId]?.name ?? recipe.name}.`, ...clockMsgs],
      shouldQuit: false,
    };
  }

  if (chosen.id.startsWith('npc:')) {
    const npcId = chosen.id.slice(4);
    const npc = LOCATIONS[state.locationId].npcs?.find((n) => n.id === npcId);
    const firstMeet = markNpcMet(state, npcId);
    state.activeNpcId = npcId;
    state.subMenu = 'dialogue';
    return {
      messages: firstMeet && npc ? [npc.firstSightProse(state)] : [],
      shouldQuit: false,
    };
  }

  if (chosen.id.startsWith('topic:')) {
    const topicId = chosen.id.slice(6);
    const npc = LOCATIONS[state.locationId].npcs?.find((n) => n.id === state.activeNpcId);
    const topic = npc?.topics.find((t) => t.id === topicId);
    if (!topic) return { messages: ['Topic unavailable.'], shouldQuit: false };
    const msgs = applyActionOutcome(state, topic.resolve(state));
    return { messages: msgs, shouldQuit: false };
  }

  if (chosen.id.startsWith('loc:')) {
    const actionId = chosen.id.slice(4);
    const action = LOCATIONS[state.locationId].actions.find((a) => a.id === actionId);
    if (!action) return { messages: ['Action unavailable.'], shouldQuit: false };
    const outcome = action.resolve(state);
    if (!outcome.advanceHours && !outcome.advanceDay && !outcome.startCombat && !outcome.triggerEnding) {
      outcome.advanceHours = 2;
    }
    const msgs = applyActionOutcome(state, outcome);
    if (state.scene === 'location') {
      state.subMenu = 'root';
    }
    return { messages: msgs, shouldQuit: false };
  }

  if (chosen.id.startsWith('travel:')) {
    return { messages: travelTo(state, chosen.id.slice(7)), shouldQuit: false };
  }

  if (chosen.id === 'open_shop') {
    state.scene = 'shop';
    state.subMenu = 'root';
    return { messages: [], shouldQuit: false };
  }

  if (chosen.id === 'leave_shop') {
    state.activeMerchant = null;
    state.scene = state.locationId === 'camp_hub' ? 'camp_hub' : 'location';
    state.subMenu = 'root';
    return { messages: [], shouldQuit: false };
  }

  if (chosen.id.startsWith('buy_item:')) {
    const [, itemId, priceStr] = chosen.id.split(':');
    const price = Number(priceStr);
    if (state.player.crowns < price) return { messages: ['Insufficient Crowns.'], shouldQuit: false };
    state.player.crowns -= price;
    addItemToInventory(state, itemId, 1);
    return { messages: [`Bought ${ITEMS[itemId]?.name ?? itemId}.`], shouldQuit: false };
  }

  if (chosen.id.startsWith('buy_ration:')) {
    const price = Number(chosen.id.split(':')[1]);
    if (state.player.crowns < price) return { messages: ['Insufficient Crowns.'], shouldQuit: false };
    state.player.crowns -= price;
    state.player.rations += 1;
    return { messages: ['Bought Ration.'], shouldQuit: false };
  }

  if (chosen.id === 'buy_torch:4') {
    if (state.player.crowns < 4) return { messages: ['Insufficient Crowns.'], shouldQuit: false };
    state.player.crowns -= 4;
    state.player.torches += 1;
    return { messages: ['Bought Pitch-Torch.'], shouldQuit: false };
  }

  if (chosen.id === 'journey:next' && state.travelState) {
    const ts = state.travelState;
    if (ts.beatIndex + 1 < ts.beats.length) {
      ts.beatIndex += 1;
      return { messages: [], shouldQuit: false };
    }
    const ambushId = ts.pendingAmbushEnemyId;
    state.travelState = null;
    if (ambushId) {
      const msgs = beginCombatApproach(state, { enemyId: ambushId, canFlee: true, ambushed: true });
      return { messages: ['Shadows cut across the trail ahead.', ...msgs], shouldQuit: false };
    }
    state.scene = 'location';
    state.subMenu = 'root';
    return { messages: [], shouldQuit: false };
  }

  if (chosen.id === 'explore:search' && state.exploreBeat) {
    const eb = state.exploreBeat;
    eb.resolved = true;
    const foundParts: string[] = [];
    if (eb.itemId) {
      addItemToInventory(state, eb.itemId, 1);
      foundParts.push(`You pry free ${ITEMS[eb.itemId]?.name ?? eb.itemId} and stow it in oilcloth.`);
    }
    if (eb.crownsMin !== undefined && eb.crownsMax !== undefined) {
      const gain = eb.crownsMin + Math.floor(nextRandom(state) * (eb.crownsMax - eb.crownsMin + 1));
      if (gain > 0) {
        state.player.crowns += gain;
        foundParts.push(`You scrape ${gain} sharp-edged Onyx coins out of the frost.`);
      }
    }
    eb.outcomeText = foundParts.join('\n\n') || 'Nothing useful remains intact.';
    return { messages: [], shouldQuit: false };
  }

  if ((chosen.id === 'explore:leave' || chosen.id === 'explore:continue') && state.exploreBeat) {
    const ret = state.exploreBeat.returnScene;
    state.exploreBeat = null;
    state.scene = ret;
    state.subMenu = 'root';
    return { messages: [], shouldQuit: false };
  }

  if (chosen.id === 'approach:observe' && state.combatApproach) {
    const ca = state.combatApproach;
    ca.observed = true;
    const leadTpl = ENEMIES[ca.enemyIds[0]] ?? ENEMIES.root_husk;
    const chk = resolveCheck(state, 'wit', 11, 0, 'Pre-Combat Observe');
    const lines = [chk.logLine];
    if (leadTpl) {
      lines.push(`Gear: ${leadTpl.visibleGear.weapon}; ${leadTpl.visibleGear.armor}.`);
      if (chk.success) {
        lines.push(`Build: ${leadTpl.anatomy.musculature}, ${leadTpl.anatomy.bodyShape}.`);
        lines.push(`Tell: ${leadTpl.anatomy.distinguishingMark}.`);
      } else {
        lines.push('Distance and mist hide finer weaknesses until steel closes.');
      }
    }
    ca.observedLines = lines;
    return { messages: [], shouldQuit: false };
  }

  if (chosen.id === 'approach:flee' && state.combatApproach) {
    const ca = state.combatApproach;
    const chk = resolveCheck(state, 'agility', 11, 0, 'Slip Away');
    if (chk.success) {
      state.combatApproach = null;
      state.scene = state.frontier.activeDungeonId
        ? 'dungeon'
        : state.locationId === 'camp_hub'
          ? 'camp_hub'
          : 'location';
      state.subMenu = 'root';
      return { messages: [chk.logLine, 'You keep low behind broken stone and slip away unseen.'], shouldQuit: false };
    }
    const { introMessages } = startCombatEncounter(state, {
      enemyIds: ca.enemyIds,
      canFlee: ca.canFlee,
      onVictoryFlag: ca.onVictoryFlag,
      onVictoryChronicle: ca.onVictoryChronicle,
      preDamageRatio: ca.preDamageRatio,
      brokenSeals: ca.brokenSeals,
    });
    state.combatApproach = null;
    return { messages: [chk.logLine, 'Gravel crunches beneath your boot; the threat turns straight toward you.', ...introMessages], shouldQuit: false };
  }

  if (chosen.id === 'approach:engage' && state.combatApproach) {
    const ca = state.combatApproach;
    const { introMessages } = startCombatEncounter(state, {
      enemyIds: ca.enemyIds,
      canFlee: ca.canFlee,
      onVictoryFlag: ca.onVictoryFlag,
      onVictoryChronicle: ca.onVictoryChronicle,
      preDamageRatio: ca.preDamageRatio,
      brokenSeals: ca.brokenSeals,
    });
    state.combatApproach = null;
    return { messages: introMessages, shouldQuit: false };
  }

  if (chosen.id === 'defeat:next' && state.defeatState) {
    if (state.defeatState.beatIndex + 1 < state.defeatState.beats.length) {
      state.defeatState.beatIndex += 1;
      return { messages: [], shouldQuit: false };
    }
    const summary = [...state.defeatState.summaryNotes];
    state.defeatState = null;
    state.locationId = 'camp_hub';
    state.scene = 'camp_hub';
    state.subMenu = 'root';
    return { messages: summary, shouldQuit: false };
  }

  if (chosen.id === 'event_beat_next' && state.activeEvent) {
    state.activeEvent.beatIndex = (state.activeEvent.beatIndex ?? 0) + 1;
    return { messages: [], shouldQuit: false };
  }

  if (chosen.id === 'event_continue') {
    state.activeEvent = null;
    state.scene = state.frontier.activeDungeonId
      ? 'dungeon'
      : state.locationId === 'camp_hub'
        ? 'camp_hub'
        : 'location';
    state.subMenu = 'root';
    return { messages: [], shouldQuit: false };
  }

  if (chosen.id.startsWith('ev:') && state.activeEvent) {
    const choiceId = chosen.id.slice(3);
    const ev = EVENTS.find((e) => e.id === state.activeEvent!.eventId);
    const evChoice = ev?.choices.find((c) => c.id === choiceId);
    if (!evChoice) return { messages: ['Choice unavailable.'], shouldQuit: false };
    const outcome = evChoice.resolve(state);
    const msgs = applyActionOutcome(state, outcome);
    if (state.scene === 'event') {
      state.activeEvent = {
        eventId: ev!.id,
        resolved: true,
        resolutionText: msgs.join('\n'),
      };
    } else {
      state.activeEvent = null;
    }
    return { messages: msgs, shouldQuit: false };
  }

  if (state.scene === 'combat') {
    return { messages: executeCombatAction(state, chosen.id).messages, shouldQuit: false };
  }

  if (chosen.id.startsWith('perk:') && state.scene === 'level_up') {
    const perkId = chosen.id.slice(5);
    const perk = PERKS[perkId];
    if (!perk) return { messages: ['Invalid perk.'], shouldQuit: false };
    state.player.perks.push(perk.id);
    if (perk.maxHpBonus) {
      state.player.maxHp += perk.maxHpBonus;
      state.player.hp += perk.maxHpBonus;
    }
    if (perk.maxStaminaBonus) {
      state.player.maxStamina += perk.maxStaminaBonus;
      state.player.stamina += perk.maxStaminaBonus;
    }
    if (perk.maxFocusBonus) {
      state.player.maxFocus += perk.maxFocusBonus;
      state.player.focus += perk.maxFocusBonus;
    }
    if (perk.maxResolveBonus) {
      state.player.maxResolve += perk.maxResolveBonus;
      state.player.resolve += perk.maxResolveBonus;
    }
    state.pendingPerkIds = [];
    state.scene = state.frontier.activeDungeonId
      ? 'dungeon'
      : state.locationId === 'camp_hub'
        ? 'camp_hub'
        : 'location';
    state.subMenu = 'root';
    return { messages: [`Gained ${perk.name}.`], shouldQuit: false };
  }

  return { messages: ['Unknown choice.'], shouldQuit: false };
}

export function renderCurrentScreen(state: GameState, messages: string[]): string {
  const fallbackMsg = normalizeSceneFallback(state);
  const effectiveMsgs = fallbackMsg ? [...messages, fallbackMsg] : messages;
  const s = state.stealthMode;
  const out: string[] = [];

  if (state.scene === 'intro') {
    const beat = getIntroBeat(state, state.introBeat);
    out.push(divider(s, '='));
    out.push(paint(`${beat.title} - ${state.introBeat + 1}/${INTRO_BEAT_COUNT}`, 'cyan', s));
    out.push(divider(s, '='));
    out.push('');
    out.push(wrapText(beat.body));
    out.push('');
    out.push(divider(s, '-'));
    out.push(...formatActionGrid(getSceneChoices(state)));
    return out.join('\n');
  }

  out.push(formatStatusHeader(state));

  if (effectiveMsgs.length > 0) {
    out.push('');
    for (const m of effectiveMsgs) {
      out.push(wrapText(m));
    }
  }

  if (state.scene === 'dead' || state.scene === 'ending') {
    return out.join('\n');
  }

  out.push('');

  if (state.scene === 'journal') {
    const lines = renderJournalBody(state);
    for (const line of lines) {
      out.push(wrapText(line));
    }
  } else if (state.scene === 'camp' && state.camp) {
    const loc = LOCATIONS[state.locationId];
    if (state.subMenu === 'pack_craft') {
      out.push(paint('CAMP - CRAFT', 'cyan', s));
    } else {
      const campTitle =
        state.locationId === 'camp_hub' ? 'LONE CAMP' : (loc?.name.toUpperCase() ?? 'CAMP');
      out.push(paint(`CAMP - ${campTitle}`, 'cyan', s));
      out.push(
        wrapText(
          renderProse(
            state.camp.fireLit
              ? 'Low embers hiss beneath sheltered stone as {weather} settles around your solo camp, warming {skin} skin.{if:greenskin} You tuck your pointed ears beneath dry wool away from the glare.{/if}{if:durnfolk} Heavy stone blocks the wind clean off your shoulders.{/if}'
              : 'You crouch in cold dark beneath sheltered stone while {weather} drifts past your camp.{if:lantern_eyes} Your bright eyes pick out every frost-crack without tinder.{/if}{if:female} You keep {weapon} drawn close across your knees while listening to the dark.{/if}',
            state,
          ),
        ),
      );
    }
  } else if (state.scene === 'travel' && state.travelState) {
    const ts = state.travelState;
    const destName = LOCATIONS[ts.destId]?.name ?? ts.destId;
    out.push(paint(`JOURNEY - ${destName.toUpperCase()} ${ts.beatIndex + 1}/${ts.beats.length}`, 'cyan', s));
    out.push(wrapText(ts.beats[ts.beatIndex] ?? ''));
  } else if (state.scene === 'explore_beat' && state.exploreBeat) {
    const eb = state.exploreBeat;
    out.push(paint(eb.title, 'yellow', s));
    out.push(wrapText(eb.outcomeText ?? eb.prose));
  } else if (state.scene === 'combat_approach' && state.combatApproach) {
    const ca = state.combatApproach;
    const leadTpl = ENEMIES[ca.enemyIds[0]] ?? ENEMIES.root_husk;
    out.push(paint(ca.ambushed ? 'AMBUSH ON THE TRAIL' : 'CONTACT AHEAD', 'red', s));
    if (leadTpl) {
      out.push(wrapText(leadTpl.firstSightProse));
    }
    if (ca.openingBark) {
      out.push('');
      out.push(wrapText(ca.openingBark));
    }
    if (ca.observedLines && ca.observedLines.length > 0) {
      out.push('');
      for (const l of ca.observedLines) {
        out.push(wrapText(`  ${l}`));
      }
    }
  } else if (state.scene === 'defeat' && state.defeatState) {
    const ds = state.defeatState;
    out.push(paint(`DEFEAT - ${ds.beatIndex + 1}/${ds.beats.length}`, 'red', s));
    out.push(wrapText(ds.beats[ds.beatIndex] ?? ''));
    if (ds.beatIndex === ds.beats.length - 1 && ds.summaryNotes.length > 0) {
      out.push('');
      for (const note of ds.summaryNotes) {
        out.push(wrapText(`  ${note}`));
      }
    }
  } else if (state.scene === 'aftermath' && state.aftermath) {
    const current = state.aftermath.downedEnemies[state.aftermath.activeIndex];
    out.push(paint('AFTERMATH', 'yellow', s));
    if (current) {
      out.push(
        wrapText(
          renderProse(
            `${current.displayName} lies broken and breathing in the freezing mud at your boots. {if:towering}You tower above the crumpled form, checking {weapon} for nicks.{/if}{if:small_stature}You step in light and close, keeping {weapon} poised over its throat.{/if}{if:scarred_face}Cold wind stings the old scar on your face as you decide its fate.{/if}`,
            state,
          ),
        ),
      );
    } else {
      out.push(
        wrapText(
          renderProse(
            'Silence settles back over the cold stone. You wipe dark gore off {weapon}, catch your {build} breath, and check your pack straps.{if:greenskin} Sleet beads on {skin} skin while you listen for other scavengers.{/if}{if:ael_thalor} Your {eyes} eyes scan the frost-rimed arches for movement.{/if}{if:female} You cinch your {armor} tighter against the wind before moving on.{/if}',
            state,
          ),
        ),
      );
      if (state.aftermath.victorySummary.length > 0) {
        out.push('');
        for (const line of state.aftermath.victorySummary) {
          out.push(wrapText(`  ${line}`));
        }
      }
    }
  } else if (state.scene === 'camp_hub') {
    if (state.subMenu === 'root') {
      out.push(paint('LONE CAMP', 'cyan', s));
      out.push(
        wrapText(
          renderProse(
            '{if:vaelorian}A collapsed stone milestone shed and banked embers mark your lone camp beside the broken northern paving.{/if}{if:ael_thalor}A tight windbreak of frost-split pines and banked embers mark your lone camp above the ruined arches.{/if}{if:durnfolk}A dry stone culvert wedged beneath a cracked aqueduct pier marks your lone camp out of the gale.{/if}{if:grixi}A narrow iron-barred drain grate tucked under road flagstones marks your lone camp out of sight.{/if}{if:burn_scarred} Heat from the coals pulls at old burn-scars along your skin.{/if}',
            state,
          ),
        ),
      );
    } else if (state.subMenu === 'travel') {
      out.push(paint('TRAVEL FROM CAMP', 'cyan', s));
    } else if (state.subMenu === 'stash' || state.subMenu === 'stash_put' || state.subMenu === 'stash_take') {
      out.push(paint('CAMP STASH', 'cyan', s));
      if (state.frontier.stash.length === 0) {
        out.push('Your camp chest is empty.');
      } else {
        for (const st of state.frontier.stash) {
          out.push(`  - ${ITEMS[st.id]?.name ?? st.id} x${st.qty}`);
        }
      }
    } else if (state.subMenu === 'pack') {
      out.push(paint('PACK', 'cyan', s));
    } else if (state.subMenu === 'pack_use') {
      out.push(paint('USE ITEM', 'cyan', s));
    } else if (state.subMenu === 'pack_equip') {
      out.push(paint('EQUIP GEAR', 'cyan', s));
    } else if (state.subMenu === 'pack_craft') {
      out.push(paint('CRAFT', 'cyan', s));
    } else if (state.subMenu === 'pack_mods') {
      out.push(paint('BODY MODIFICATIONS', 'cyan', s));
    }
  } else if (state.scene === 'dungeon' && state.frontier.activeDungeonId) {
    out.push(paint('DUNGEON', 'red', s));
    out.push(renderDungeonMap(state));
    const dDef = loadWorldDatabase().dungeons[state.frontier.activeDungeonId];
    const rt = state.frontier.dungeonStates[state.frontier.activeDungeonId];
    if (dDef && rt) {
      const rm = dDef.rooms[rt.currentRoomId];
      out.push('');
      out.push(paint(rm.name.toUpperCase(), 'cyan', s));
      out.push(wrapText(rm.description));
    }
  } else if (state.scene === 'location') {
    const loc = LOCATIONS[state.locationId];
    if (state.subMenu === 'root') {
      out.push(paint(loc.name.toUpperCase(), 'cyan', s));
      out.push(wrapText(loc.description(state)));
      const activeSub = state.frontier.activeSubArea[loc.id];
      if (activeSub) {
        const subDef = loadWorldDatabase().subAreas[activeSub];
        if (subDef) {
          out.push(paint(`Exploring Sub-Area: ${subDef.name}`, 'yellow', s));
        }
      }
    } else if (state.subMenu === 'explore') {
      out.push(paint(`${loc.name.toUpperCase()} - EXPLORE`, 'cyan', s));
    } else if (state.subMenu === 'talk') {
      out.push(paint(`${loc.name.toUpperCase()} - TALK`, 'cyan', s));
    } else if (state.subMenu === 'dialogue' && state.activeNpcId) {
      const npc = loc.npcs?.find((n) => n.id === state.activeNpcId);
      if (npc) {
        out.push(paint(npc.name.toUpperCase(), 'cyan', s));
        out.push(wrapText(npc.greeting(state)));
      }
    } else if (state.subMenu === 'travel') {
      out.push(paint('TRAVEL', 'cyan', s));
    } else if (state.subMenu === 'pack') {
      out.push(paint('PACK', 'cyan', s));
    } else if (state.subMenu === 'pack_use') {
      out.push(paint('USE ITEM', 'cyan', s));
    } else if (state.subMenu === 'pack_equip') {
      out.push(paint('EQUIP GEAR', 'cyan', s));
    } else if (state.subMenu === 'pack_craft') {
      out.push(paint('CRAFT', 'cyan', s));
    } else if (state.subMenu === 'pack_mods') {
      out.push(paint('BODY MODIFICATIONS', 'cyan', s));
      if (Object.keys(state.player.bodyMods).length === 0) {
        out.push('Your body currently bears no active mutations, surgeries, or implants.');
      }
    }
  } else if (state.scene === 'event' && state.activeEvent) {
    const ev = EVENTS.find((e) => e.id === state.activeEvent!.eventId);
    if (ev) {
      out.push(paint(ev.title.toUpperCase(), 'yellow', s));
      if (!state.activeEvent.resolved) {
        const beatIdx = state.activeEvent.beatIndex ?? 0;
        const beatText =
          ev.promptBeats && ev.promptBeats[beatIdx]
            ? ev.promptBeats[beatIdx](state)
            : ev.prompt(state);
        out.push(wrapText(beatText));
      }
    }
  } else if (state.scene === 'combat' && state.combat) {
    const c = state.combat;
    out.push(
      paint(
        `COMBAT - Round ${c.round} | Main ${c.mainLeft} | Swift ${c.swiftLeft} | Free ${c.freeLeft}`,
        'red',
        s,
      ),
    );
    for (const enemy of state.combat.enemies) {
      if (enemy.hp <= 0) continue;
      for (const line of formatCombatEnemyCard(state, enemy)) {
        out.push(wrapText(line));
      }
    }
  } else if (state.scene === 'shop') {
    const shop = state.activeMerchant ?? LOCATIONS[state.locationId]?.shop;
    if (shop) {
      out.push(paint(shop.name.toUpperCase(), 'cyan', s));
      if ('greeting' in shop && typeof shop.greeting === 'function') {
        out.push(wrapText(shop.greeting(state)));
      } else {
        out.push(wrapText(`${shop.keeper} spreads wares across an oiled cloth.`));
      }
    }
  } else if (state.scene === 'level_up') {
    out.push(paint(`LEVEL ${state.player.level} - CHOOSE A PERK`, 'green', s));
  }

  const choices = getSceneChoices(state);
  if (choices.length > 0) {
    out.push('');
    out.push(divider(s, '-'));
    out.push(...formatActionGrid(choices));
  }

  return out.join('\n');
}
