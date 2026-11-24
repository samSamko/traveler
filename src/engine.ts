import { randomUUID } from 'node:crypto';
import type {
  ActionOutcome,
  AnatomyProfile,
  BackgroundId,
  GameState,
  HeirloomId,
  JournalTab,
  RaceId,
  RecipeDef,
  SexId,
} from './types.ts';
import { BACKGROUNDS, PERKS, RACES } from './content/characters.ts';
import { ITEMS, RECIPES } from './content/items.ts';
import { LOCATIONS } from './content/locations.ts';
import { EVENTS } from './content/events.ts';
import { nextRandom } from './dice.ts';
import { hasFlag, recordChronicle, setFlag, synthesizeEpilogue } from './memory.ts';
import {
  addItemToInventory,
  consumeInventoryItem,
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

const SHORT_LOCATION_NAMES: Record<string, string> = {
  cinderford: 'Cinderford Keep',
  kings_causeway: "King's Causeway",
  weeping_barrow: 'Weeping Barrow',
  ash_fen: 'Ash-Fen',
  silken_cistern: 'Silken Cistern',
  petrified_starwood: 'Star-Wood',
  drowned_forge: 'Drowned Forge',
  crown_watchtower: 'Crown Watchtower',
  sunken_belfry: 'Sunken Belfry',
};

export interface CreateCharacterInput {
  name: string;
  sex: SexId;
  race: RaceId;
  background: BackgroundId;
  heirloom: HeirloomId;
  anatomy?: AnatomyProfile;
  skipIntro?: boolean;
  stealthMode?: boolean;
  rngState?: number;
}

export function createNewGame(input: CreateCharacterInput): GameState {
  const raceDef = RACES[input.race];
  const bgDef = BACKGROUNDS[input.background];

  const stats = {
    might: 1 + (raceDef.statMods.might ?? 0) + (bgDef.statMods.might ?? 0),
    agility: 1 + (raceDef.statMods.agility ?? 0) + (bgDef.statMods.agility ?? 0),
    wit: 1 + (raceDef.statMods.wit ?? 0) + (bgDef.statMods.wit ?? 0),
    grit: 1 + (raceDef.statMods.grit ?? 0) + (bgDef.statMods.grit ?? 0),
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

  const abilities = [raceDef.racialAbilityId, ...bgDef.abilityIds];
  const anatomy =
    input.anatomy ?? rollDefaultAnatomy(input.sex, input.race, input.background);

  const startingKnownItems = [
    bgDef.startingWeaponId,
    bgDef.startingArmorId,
    ...(bgDef.startingTrinketId ? [bgDef.startingTrinketId] : []),
    ...bgDef.startingItems.map((i) => i.id),
  ];

  const skipIntro = Boolean(input.skipIntro);

  return {
    runId: randomUUID(),
    day: 1,
    maxDays: 14,
    stealthMode: Boolean(input.stealthMode),
    player: {
      name: input.name.trim() || 'Vesper',
      sex: input.sex,
      race: input.race,
      background: input.background,
      heirloom: input.heirloom,
      anatomy,
      level: 1,
      xp: 0,
      xpToNext: 35,
      hp: maxHp,
      maxHp,
      stamina: maxStamina,
      maxStamina,
      focus: maxFocus,
      maxFocus,
      baseStats: stats,
      weaponId: bgDef.startingWeaponId,
      weaponHoned: false,
      armorId: bgDef.startingArmorId,
      trinketId: bgDef.startingTrinketId ?? null,
      inventory: bgDef.startingItems.map((i) => ({ ...i })),
      abilities,
      perks: [],
      crowns: bgDef.startingCrowns,
      rations: bgDef.startingRations,
      torches: bgDef.startingTorches,
      statuses: [],
      determinationAvailable: true,
    },
    locationId: 'cinderford',
    visitedLocations: ['cinderford'],
    seenEvents: [],
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
    scene: skipIntro ? 'location' : 'intro',
    subMenu: 'root',
    introBeat: 0,
    journalTab: 'root',
    journalDetailId: null,
    journalReturn: null,
    activeNpcId: null,
    activeEvent: null,
    combat: null,
    pendingPerkIds: [],
    endingSummary: null,
    lastMessages: skipIntro
      ? [
          'You step through the rain-slicked timber gate with fourteen days before the Third Drowning Toll.',
        ]
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

export function getSceneChoices(state: GameState): MenuEntry[] {
  const entries: MenuEntry[] = [];

  if (state.scene === 'intro') {
    entries.push({ index: 1, id: 'intro:next', label: 'Continue', enabled: true });
    entries.push({ index: 2, id: 'intro:skip', label: 'Skip', enabled: true });
    return entries;
  }

  if (state.scene === 'journal') {
    return getJournalChoices(state);
  }

  if (state.scene === 'location') {
    const loc = LOCATIONS[state.locationId];

    if (state.subMenu === 'root') {
      const hasExplore = loc.actions.some((a) => !a.visible || a.visible(state));
      if (hasExplore) {
        entries.push({ index: entries.length + 1, id: 'sub:explore', label: 'Explore', enabled: true });
      }
      const hasNpcs = Boolean(loc.npcs?.some((n) => !n.visible || n.visible(state)));
      if (hasNpcs) {
        entries.push({ index: entries.length + 1, id: 'sub:talk', label: 'Talk', enabled: true });
      }
      if (loc.shop && !hasFlag(state, 'cinderford_fallen') && !hasFlag(state, 'stole_cistern_vesper')) {
        entries.push({ index: entries.length + 1, id: 'open_shop', label: 'Trade', enabled: true });
      }
      entries.push({ index: entries.length + 1, id: 'rest_action', label: 'Rest', enabled: true });
      entries.push({ index: entries.length + 1, id: 'sub:pack', label: 'Pack', enabled: true });
      entries.push({ index: entries.length + 1, id: 'open_journal', label: 'Journal', enabled: true });
      entries.push({ index: entries.length + 1, id: 'sub:travel', label: 'Travel', enabled: true });
      return entries;
    }

    if (state.subMenu === 'explore') {
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
      entries.push({ index: 4, id: 'open_journal', label: 'Journal', enabled: true });
      entries.push({ index: 5, id: 'sub:root', label: 'Back', enabled: true });
      return entries;
    }

    if (state.subMenu === 'pack_use') {
      for (const entry of state.player.inventory) {
        const item = ITEMS[entry.id];
        if (item && item.slot === 'consumable' && !item.throwDamage && entry.qty > 0) {
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
        if (item && (item.slot === 'weapon' || item.slot === 'armor' || item.slot === 'trinket') && entry.qty > 0) {
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
  } else if (state.scene === 'event' && state.activeEvent) {
    if (state.activeEvent.resolved) {
      entries.push({ index: 1, id: 'event_continue', label: 'Continue', enabled: true });
    } else {
      const ev = EVENTS.find((e) => e.id === state.activeEvent!.eventId);
      if (ev) {
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
    const shop = loc.shop;
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

function advanceFrontierDays(state: GameState, days: number): string[] {
  const msgs: string[] = [];
  for (let i = 0; i < days; i += 1) {
    state.day += 1;
    if (state.player.rations > 0) {
      state.player.rations -= 1;
    } else {
      state.player.hp = Math.max(0, state.player.hp - 4);
      msgs.push('No rations remain. Hunger hollows your strength.');
      if (state.player.hp <= 0) {
        state.scene = 'dead';
        msgs.push('You starve upon the frozen road.');
        return msgs;
      }
    }
  }

  if (state.day === state.maxDays && !hasFlag(state, 'malakor_slain')) {
    msgs.push(
      'Day 14 has dawned. The Sunken Belfry groans; reach Malakor before sunset.',
    );
  }

  if (state.day > state.maxDays && !hasFlag(state, 'malakor_slain')) {
    state.scene = 'dead';
    msgs.push(
      'The Third Drowning Toll sounds across the valley. Chalk and bronze resonance sweep the Gloaming Reach, turning every living soul to stone.',
    );
  }
  return msgs;
}

function applyActionOutcome(state: GameState, outcome: ActionOutcome): string[] {
  const msgs = [...outcome.messages];
  if (outcome.advanceDay && outcome.advanceDay > 0) {
    msgs.push(...advanceFrontierDays(state, outcome.advanceDay));
    if (state.scene === 'dead') return msgs;
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
  const candidates = EVENTS.filter((ev) => {
    if (!ev.locations.includes(locId)) return false;
    if (state.seenEvents.includes(ev.id)) return false;
    if (ev.minDay && state.day < ev.minDay) return false;
    if (ev.maxDay && state.day > ev.maxDay) return false;
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

  state.seenEvents.push(chosen.id);
  state.scene = 'event';
  state.subMenu = 'root';
  state.activeEvent = { eventId: chosen.id, resolved: false };
  return true;
}

function travelTo(state: GameState, destId: string): string[] {
  const curLoc = LOCATIONS[state.locationId];
  if (!curLoc.neighbors.includes(destId)) {
    return [`You cannot reach ${LOCATIONS[destId]?.name ?? destId} directly from here.`];
  }
  const dest = LOCATIONS[destId];
  const msgs = [`You set out along the ash-strewn trail toward ${dest.name}.`];
  msgs.push(...advanceFrontierDays(state, 1));
  if (state.scene === 'dead') return msgs;

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
      canFlee: true,
    });
    msgs.push(...introMessages);
    return msgs;
  }

  state.player.stamina = Math.min(state.player.maxStamina, state.player.stamina + 1);

  if (dest.regionType === 'road' || dest.regionType === 'ruin') {
    const chance = dest.regionType === 'road' ? 0.85 : 0.65;
    if (nextRandom(state) <= chance) {
      drawRoadEvent(state);
    }
  }

  return msgs;
}

function performRest(state: GameState): string[] {
  if (state.locationId === 'cinderford' && !hasFlag(state, 'cinderford_fallen')) {
    const free = hasFlag(state, 'granary_purified');
    const cost = free ? 0 : 6;
    if (state.player.crowns < cost) {
      return [`Martha asks ${cost} Crowns for hearth and straw.`];
    }
    state.player.crowns -= cost;
    const dayMsgs = advanceFrontierDays(state, 1);
    if (state.scene === 'dead') return dayMsgs;
    state.player.hp = state.player.maxHp;
    state.player.stamina = state.player.maxStamina;
    state.player.focus = state.player.maxFocus;
    state.player.statuses = [];
    state.player.determinationAvailable = true;
    state.subMenu = 'root';
    return [
      free
        ? 'Martha refuses your silver, offering warm broth and quiet sleep until dawn.'
        : 'Warm stew and deep sleep beside the peat hearth restore your strength.',
      ...dayMsgs,
    ];
  }

  const msgs = ['You pitch a cold camp beneath broken stonework.'];
  msgs.push(...advanceFrontierDays(state, 1));
  if (state.scene === 'dead') return msgs;
  state.player.hp = Math.min(state.player.maxHp, state.player.hp + 10);
  state.player.stamina = state.player.maxStamina;
  state.player.focus = state.player.maxFocus;
  state.player.statuses = [];
  state.player.determinationAvailable = true;
  state.subMenu = 'root';
  if (state.player.race === 'durnfolk' && !state.player.weaponHoned) {
    state.player.weaponHoned = true;
    msgs.push('By emberlight you whet your blade with a basalt stone.');
  }
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
  if (!newDef || !['weapon', 'armor', 'trinket'].includes(newDef.slot)) {
    return [`${newDef?.name ?? entry.id} cannot be equipped.`];
  }

  const p = state.player;
  entry.qty -= 1;
  if (entry.qty <= 0) {
    p.inventory = p.inventory.filter((e) => e.id !== entry.id);
  }

  if (newDef.slot === 'weapon') {
    const oldId = p.weaponId;
    p.weaponId = newDef.id;
    p.weaponHoned = false;
    addItemToInventory(state, oldId, 1);
  } else if (newDef.slot === 'armor') {
    const old = ITEMS[p.armorId];
    if (old?.maxHpBonus) p.maxHp = Math.max(10, p.maxHp - old.maxHpBonus);
    if (old?.maxFocusBonus) p.maxFocus = Math.max(4, p.maxFocus - old.maxFocusBonus);
    p.armorId = newDef.id;
    if (newDef.maxHpBonus) p.maxHp += newDef.maxHpBonus;
    if (newDef.maxFocusBonus) p.maxFocus += newDef.maxFocusBonus;
    p.hp = Math.min(p.hp, p.maxHp);
    p.focus = Math.min(p.focus, p.maxFocus);
    addItemToInventory(state, old.id, 1);
  } else if (newDef.slot === 'trinket') {
    if (p.trinketId) {
      const old = ITEMS[p.trinketId];
      if (old?.maxHpBonus) p.maxHp = Math.max(10, p.maxHp - old.maxHpBonus);
      if (old?.maxFocusBonus) p.maxFocus = Math.max(4, p.maxFocus - old.maxFocusBonus);
      addItemToInventory(state, old.id, 1);
    }
    p.trinketId = newDef.id;
    if (newDef.maxHpBonus) p.maxHp += newDef.maxHpBonus;
    if (newDef.maxFocusBonus) p.maxFocus += newDef.maxFocusBonus;
  }

  return [`Equipped ${newDef.name}.`];
}

function handleUseCommand(state: GameState, query: string): string[] {
  if (state.scene === 'combat') {
    return ['Pick Item from the combat menu instead.'];
  }
  const q = query.trim().toLowerCase();
  if (!q) return ['Use what?'];
  const entry = state.player.inventory.find((e) => {
    const def = ITEMS[e.id];
    return def && def.slot === 'consumable' && (def.id === q || def.name.toLowerCase().includes(q));
  });
  if (!entry) return [`No consumable matching "${query}" in your pack.`];
  const item = ITEMS[entry.id];
  if (!item || item.throwDamage) {
    return [`${item?.name ?? query} can only be thrown during combat.`];
  }

  entry.qty -= 1;
  if (entry.qty <= 0) {
    state.player.inventory = state.player.inventory.filter((e) => e.id !== entry.id);
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
  if (item.cureNegative) {
    state.player.statuses = [];
    msgs.push('Cleared all afflictions.');
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
  if (state.scene === 'combat' && state.combat && state.combat.subMenu !== 'root') {
    executeCombatAction(state, 'menu:back');
    return true;
  }
  if (state.scene === 'shop') {
    state.scene = 'location';
    state.subMenu = 'root';
    return true;
  }
  if (state.scene === 'location' && state.subMenu !== 'root') {
    if (state.subMenu === 'dialogue') {
      state.subMenu = 'talk';
      state.activeNpcId = null;
    } else if (state.subMenu === 'pack_use' || state.subMenu === 'pack_equip' || state.subMenu === 'pack_craft') {
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

  if (lower === 'camp' || lower === 'rest') {
    if (state.scene !== 'location') {
      return { messages: ['You cannot rest during an encounter.'], shouldQuit: false };
    }
    return { messages: performRest(state), shouldQuit: false };
  }

  if (lower.startsWith('go ')) {
    if (state.scene !== 'location') {
      return { messages: ['Resolve your current encounter before traveling.'], shouldQuit: false };
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

  // Intro progression
  if (chosen.id === 'intro:next') {
    if (state.introBeat + 1 < INTRO_BEAT_COUNT) {
      state.introBeat += 1;
      return { messages: [], shouldQuit: false };
    }
    state.scene = 'location';
    state.subMenu = 'root';
    return { messages: [LOCATIONS.cinderford.firstSightProse(state)], shouldQuit: false };
  }
  if (chosen.id === 'intro:skip') {
    state.scene = 'location';
    state.subMenu = 'root';
    return { messages: [LOCATIONS.cinderford.firstSightProse(state)], shouldQuit: false };
  }

  // Journal navigation
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

  // Location sub-menu navigation
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

  if (chosen.id === 'rest_action') {
    return { messages: performRest(state), shouldQuit: false };
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
    return {
      messages: [`Crafted ${ITEMS[recipe.outputItemId]?.name ?? recipe.name}.`],
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
    const msgs = applyActionOutcome(state, action.resolve(state));
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
    state.scene = 'location';
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

  if (chosen.id === 'event_continue') {
    state.activeEvent = null;
    state.scene = 'location';
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
    state.pendingPerkIds = [];
    state.scene = 'location';
    state.subMenu = 'root';
    return { messages: [`Gained ${perk.name}.`], shouldQuit: false };
  }

  return { messages: ['Unknown choice.'], shouldQuit: false };
}

export function renderCurrentScreen(state: GameState, messages: string[]): string {
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

  if (messages.length > 0) {
    out.push('');
    for (const m of messages) {
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
  } else if (state.scene === 'location') {
    const loc = LOCATIONS[state.locationId];
    if (state.subMenu === 'root') {
      out.push(paint(loc.name.toUpperCase(), 'cyan', s));
      out.push(wrapText(loc.description(state)));
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
    }
  } else if (state.scene === 'event' && state.activeEvent) {
    const ev = EVENTS.find((e) => e.id === state.activeEvent!.eventId);
    if (ev) {
      out.push(paint(ev.title.toUpperCase(), 'yellow', s));
      if (!state.activeEvent.resolved) {
        out.push(wrapText(ev.prompt(state)));
      }
    }
  } else if (state.scene === 'combat' && state.combat) {
    out.push(paint(`COMBAT - Round ${state.combat.round}`, 'red', s));
    for (const enemy of state.combat.enemies) {
      if (enemy.hp <= 0) continue;
      for (const line of formatCombatEnemyCard(state, enemy)) {
        out.push(wrapText(line));
      }
    }
  } else if (state.scene === 'shop') {
    const shop = LOCATIONS[state.locationId].shop;
    if (shop) {
      out.push(paint(shop.name.toUpperCase(), 'cyan', s));
      out.push(wrapText(shop.greeting(state)));
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
