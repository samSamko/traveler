import { randomUUID } from 'node:crypto';
import type {
  ActionOutcome,
  BackgroundId,
  GameState,
  HeirloomId,
  RaceId,
  SexId,
} from './types.ts';
import { BACKGROUNDS, HEIRLOOMS, PERKS, RACES } from './content/characters.ts';
import { ITEMS } from './content/items.ts';
import { LOCATIONS } from './content/locations.ts';
import { EVENTS } from './content/events.ts';
import { nextRandom } from './dice.ts';
import { hasFlag, recordChronicle, setFlag, synthesizeEpilogue } from './memory.ts';
import {
  addItemToInventory,
  executeCombatAction,
  getCombatMenuOptions,
  startCombatEncounter,
} from './combat.ts';
import {
  formatStatusHeader,
  renderAsciiMap,
  renderCharacterSheet,
  renderHelpText,
  renderInventory,
  renderMemoryChronicle,
} from './ui.ts';

export interface CreateCharacterInput {
  name: string;
  sex: SexId;
  race: RaceId;
  background: BackgroundId;
  heirloom: HeirloomId;
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

  const state: GameState = {
    runId: randomUUID(),
    day: 1,
    maxDays: 14,
    stealthMode: Boolean(input.stealthMode),
    player: {
      name: input.name.trim() || 'Traveler',
      sex: input.sex,
      race: input.race,
      background: input.background,
      heirloom: input.heirloom,
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
    scene: 'location',
    activeEvent: null,
    combat: null,
    pendingPerkIds: [],
    endingSummary: null,
    lastMessages: [
      `Day 1 — You arrive at Cinderford Keep with 14 days before Malakor sounds the Third Drowning Toll in the Sunken Belfry.`,
    ],
    rngState: input.rngState,
  };

  return state;
}

export interface MenuEntry {
  index: number;
  id: string;
  label: string;
  enabled: boolean;
  reason?: string;
}

export function getSceneChoices(state: GameState): MenuEntry[] {
  const entries: MenuEntry[] = [];

  if (state.scene === 'location') {
    const loc = LOCATIONS[state.locationId];
    for (const action of loc.actions) {
      if (!action.visible || action.visible(state)) {
        const tag = action.tag ? ` [${action.tag}]` : '';
        entries.push({
          index: entries.length + 1,
          id: `loc:${action.id}`,
          label: `${action.label}${tag}`,
          enabled: true,
        });
      }
    }
    if (loc.shop && !hasFlag(state, 'cinderford_fallen') && !hasFlag(state, 'stole_cistern_vesper')) {
      entries.push({
        index: entries.length + 1,
        id: 'open_shop',
        label: `[Shop] Trade with ${loc.shop.keeper} (${loc.shop.name})`,
        enabled: true,
      });
    }
    for (const neighborId of loc.neighbors) {
      const dest = LOCATIONS[neighborId];
      if (dest) {
        entries.push({
          index: entries.length + 1,
          id: `travel:${dest.id}`,
          label: `Travel to ${dest.name} (+1 Day, 1 Ration)`,
          enabled: true,
        });
      }
    }
  } else if (state.scene === 'event' && state.activeEvent) {
    if (state.activeEvent.resolved) {
      entries.push({
        index: 1,
        id: 'event_continue',
        label: 'Continue onto the frontier',
        enabled: true,
      });
    } else {
      const ev = EVENTS.find((e) => e.id === state.activeEvent!.eventId);
      if (ev) {
        for (const ch of ev.choices) {
          if (!ch.visible || ch.visible(state)) {
            const check = ch.enabled ? ch.enabled(state) : { ok: true };
            const tag = ch.tag ? ` [${ch.tag}]` : '';
            entries.push({
              index: entries.length + 1,
              id: `ev:${ch.id}`,
              label: `${ch.label}${tag}`,
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
        const tag = listing.underWarrenOnly ? ' [Under-Warren]' : '';
        entries.push({
          index: entries.length + 1,
          id: `buy_item:${item.id}:${listing.price}`,
          label: `Buy ${item.name} (${listing.price}c)${tag} — ${item.description}`,
          enabled: state.player.crowns >= listing.price,
          reason: `Need ${listing.price}c`,
        });
      }
      const rationCost = hasFlag(state, 'granary_burned') ? 9 : 6;
      entries.push({
        index: entries.length + 1,
        id: `buy_ration:${rationCost}`,
        label: `Buy Trail Ration x1 (${rationCost}c)`,
        enabled: state.player.crowns >= rationCost,
        reason: `Need ${rationCost}c`,
      });
      entries.push({
        index: entries.length + 1,
        id: 'buy_torch:4',
        label: 'Buy Pitch-Torch x1 (4c)',
        enabled: state.player.crowns >= 4,
        reason: 'Need 4c',
      });
    }
    entries.push({
      index: entries.length + 1,
      id: 'leave_shop',
      label: 'Leave shop',
      enabled: true,
    });
  } else if (state.scene === 'level_up') {
    for (const pid of state.pendingPerkIds) {
      const perk = PERKS[pid];
      if (perk) {
        entries.push({
          index: entries.length + 1,
          id: `perk:${perk.id}`,
          label: `${perk.name} — ${perk.description}`,
          enabled: true,
        });
      }
    }
  }

  return entries;
}

function advanceFrontierDays(state: GameState, days: number): string[] {
  const msgs: string[] = [];
  for (let i = 0; i < days; i += 1) {
    state.day += 1;
    if (state.player.rations > 0) {
      state.player.rations -= 1;
    } else {
      state.player.hp = Math.max(0, state.player.hp - 4);
      msgs.push('No rations left! Hunger hollows your strength (-4 HP).');
      if (state.player.hp <= 0) {
        state.scene = 'dead';
        msgs.push('You starve upon the frozen road.');
        return msgs;
      }
    }
  }

  if (state.day === state.maxDays && !hasFlag(state, 'malakor_slain')) {
    msgs.push(
      '[URGENT] Day 14 has dawned! The Sunken Belfry groans — reach Malakor before sunset ends!',
    );
  }

  if (state.day > state.maxDays && !hasFlag(state, 'malakor_slain')) {
    state.scene = 'dead';
    msgs.push(
      'DAY 15 — THE THIRD DROWNING TOLL SOUNDS! A wave of chalk and bronze echoes sweeps the Gloaming Reach, calcifying every living soul before the Belfry could be silenced.',
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
    state.endingSummary = synthesizeEpilogue(state, outcome.triggerEnding.endingId);
    msgs.push('');
    msgs.push(`=== ENDING: ${outcome.triggerEnding.title.toUpperCase()} ===`);
    msgs.push(outcome.triggerEnding.openingText);
    msgs.push(state.endingSummary);
    return msgs;
  }
  if (outcome.startCombat) {
    startCombatEncounter(state, outcome.startCombat);
    return msgs;
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

  // Prioritize conditional consequence ambushes or weighted draw.
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
  if (!state.visitedLocations.includes(destId)) {
    state.visitedLocations.push(destId);
  }

  // Check Day 8 Cinderford Outbreak if player never solved the Granary!
  if (
    destId === 'cinderford' &&
    state.day >= 8 &&
    !hasFlag(state, 'cinderford_saved') &&
    !hasFlag(state, 'cinderford_fallen')
  ) {
    setFlag(state, 'cinderford_fallen', true);
    recordChronicle(
      state,
      'Cinderford Fell to Spores',
      'Because the infected granary went ignored past Day 8, Cinderford succumbed from within.',
      'cinderford',
    );
    msgs.push(
      '[CONSEQUENCE] Your neglect bore bitter fruit: Cinderford Keep fell to the granary spores on Day 8! A Root-Husk bursts from the gatehouse!',
    );
    startCombatEncounter(state, { enemyId: 'root_husk', canFlee: true });
    return msgs;
  }

  // Natural travel recovery: +1 Stamina
  state.player.stamina = Math.min(state.player.maxStamina, state.player.stamina + 1);

  if (dest.regionType === 'road' || dest.regionType === 'ruin') {
    const chance = dest.regionType === 'road' ? 0.85 : 0.65;
    if (nextRandom(state) <= chance) {
      drawRoadEvent(state);
    }
  }

  return msgs;
}

function handleEquipCommand(state: GameState, query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return ['Equip what? Specify part of an item name.'];
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
    return ['In combat, pick the numbered [ITEM] option from the combat menu.'];
  }
  const q = query.trim().toLowerCase();
  if (!q) return ['Use what? Specify an item name (e.g. "use poultice").'];
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
    msgs.push(`Restored +${item.healHp} HP.`);
  }
  if (item.restoreStamina) {
    state.player.stamina = Math.min(state.player.maxStamina, state.player.stamina + item.restoreStamina);
    msgs.push(`Restored +${item.restoreStamina} Stamina.`);
  }
  if (item.restoreFocus) {
    state.player.focus = Math.min(state.player.maxFocus, state.player.focus + item.restoreFocus);
    msgs.push(`Restored +${item.restoreFocus} Focus.`);
  }
  if (item.cureNegative) {
    state.player.statuses = [];
    msgs.push('Cleared all negative afflictions.');
  }
  return msgs;
}

export function processInput(
  state: GameState,
  rawInput: string,
): { messages: string[]; shouldQuit: boolean } {
  const input = rawInput.trim();
  const lower = input.toLowerCase();

  if (!input) {
    return { messages: [], shouldQuit: false };
  }

  if (lower === 'quit' || lower === 'q' || lower === 'exit') {
    return { messages: ['Run auto-saved. Safe travels until you return.'], shouldQuit: true };
  }

  if (lower === 'stealth') {
    state.stealthMode = !state.stealthMode;
    return {
      messages: [`Stealth plain-text mode is now ${state.stealthMode ? 'ON' : 'OFF'}.`],
      shouldQuit: false,
    };
  }

  if (lower === 'help' || lower === 'h' || lower === '?') {
    return { messages: [renderHelpText()], shouldQuit: false };
  }

  if (lower === 'look' || lower === 'l') {
    return { messages: [], shouldQuit: false };
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

  if (lower === 'memory' || lower === 'journal' || lower === 'j') {
    return { messages: [renderMemoryChronicle(state)], shouldQuit: false };
  }

  if (lower.startsWith('equip ')) {
    return { messages: handleEquipCommand(state, input.slice(6)), shouldQuit: false };
  }

  if (lower.startsWith('use ')) {
    return { messages: handleUseCommand(state, input.slice(4)), shouldQuit: false };
  }

  if (lower === 'camp' || lower === 'rest') {
    if (state.scene !== 'location') {
      return { messages: ['You can only make camp while exploring a location.'], shouldQuit: false };
    }
    const msgs = ['You pitch a cold camp beneath broken stonework (+1 Day).'];
    msgs.push(...advanceFrontierDays(state, 1));
    if (state.scene === 'dead') return { messages: msgs, shouldQuit: false };
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + 10);
    state.player.stamina = state.player.maxStamina;
    state.player.focus = state.player.maxFocus;
    state.player.statuses = [];
    state.player.determinationAvailable = true;
    msgs.push('Rest recovers +10 HP, full Stamina & Focus.');
    if (state.player.race === 'durnfolk' && !state.player.weaponHoned) {
      state.player.weaponHoned = true;
      msgs.push('[Durnfolk Iron-Rib] You whet your weapon cleanly by emberlight (+1 Weapon Damage).');
    }
    return { messages: msgs, shouldQuit: false };
  }

  if (lower.startsWith('go ')) {
    if (state.scene !== 'location') {
      return { messages: ['Resolve your current encounter before traveling.'], shouldQuit: false };
    }
    const target = lower.slice(3).trim();
    const loc = LOCATIONS[state.locationId];
    const destId = loc.neighbors.find((nid) => {
      const n = LOCATIONS[nid];
      return n && (n.id === target || n.name.toLowerCase().includes(target));
    });
    if (!destId) {
      return {
        messages: [`No connected road matching "${target}". Check "map" or numbered travel options.`],
        shouldQuit: false,
      };
    }
    return { messages: travelTo(state, destId), shouldQuit: false };
  }

  // Numbered choice dispatch
  const num = Number.parseInt(input, 10);
  if (!Number.isNaN(num) && String(num) === input) {
    const choices = getSceneChoices(state);
    const chosen = choices.find((c) => c.index === num);
    if (!chosen) {
      return { messages: [`Invalid option ${num}.`], shouldQuit: false };
    }
    if (!chosen.enabled) {
      return {
        messages: [`Cannot choose "${chosen.label}": ${chosen.reason ?? 'requirements unmet'}.`],
        shouldQuit: false,
      };
    }

    if (chosen.id.startsWith('loc:')) {
      const actionId = chosen.id.slice(4);
      const action = LOCATIONS[state.locationId].actions.find((a) => a.id === actionId);
      if (!action) return { messages: ['Action unavailable.'], shouldQuit: false };
      return { messages: applyActionOutcome(state, action.resolve(state)), shouldQuit: false };
    }

    if (chosen.id.startsWith('travel:')) {
      return { messages: travelTo(state, chosen.id.slice(7)), shouldQuit: false };
    }

    if (chosen.id === 'open_shop') {
      state.scene = 'shop';
      return { messages: [`Stepped up to ${LOCATIONS[state.locationId].shop?.name}.`], shouldQuit: false };
    }

    if (chosen.id === 'leave_shop') {
      state.scene = 'location';
      return { messages: ['Returned to the square.'], shouldQuit: false };
    }

    if (chosen.id.startsWith('buy_item:')) {
      const [, itemId, priceStr] = chosen.id.split(':');
      const price = Number(priceStr);
      if (state.player.crowns < price) return { messages: ['Insufficient Crowns.'], shouldQuit: false };
      state.player.crowns -= price;
      addItemToInventory(state, itemId, 1);
      return { messages: [`Bought ${ITEMS[itemId]?.name ?? itemId} for ${price} Crowns.`], shouldQuit: false };
    }

    if (chosen.id.startsWith('buy_ration:')) {
      const price = Number(chosen.id.split(':')[1]);
      if (state.player.crowns < price) return { messages: ['Insufficient Crowns.'], shouldQuit: false };
      state.player.crowns -= price;
      state.player.rations += 1;
      return { messages: [`Bought 1 Ration for ${price} Crowns.`], shouldQuit: false };
    }

    if (chosen.id === 'buy_torch:4') {
      if (state.player.crowns < 4) return { messages: ['Insufficient Crowns.'], shouldQuit: false };
      state.player.crowns -= 4;
      state.player.torches += 1;
      return { messages: ['Bought 1 Pitch-Torch for 4 Crowns.'], shouldQuit: false };
    }

    if (chosen.id === 'event_continue') {
      state.activeEvent = null;
      state.scene = 'location';
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
      return { messages: [`Gained Perk: ${perk.name}!`], shouldQuit: false };
    }
  }

  return {
    messages: ['Unrecognized command. Enter a number or type "help".'],
    shouldQuit: false,
  };
}

export function renderCurrentScreen(state: GameState, messages: string[]): string {
  const out: string[] = [];
  out.push(formatStatusHeader(state));

  if (messages.length > 0) {
    out.push('');
    for (const m of messages) {
      out.push(m);
    }
  }

  if (state.scene === 'dead' || state.scene === 'ending') {
    return out.join('\n');
  }

  out.push('');

  if (state.scene === 'location') {
    const loc = LOCATIONS[state.locationId];
    out.push(`[${loc.name.toUpperCase()}]`);
    out.push(loc.description(state));
  } else if (state.scene === 'event' && state.activeEvent) {
    const ev = EVENTS.find((e) => e.id === state.activeEvent!.eventId);
    if (ev) {
      out.push(`[ENCOUNTER: ${ev.title}]`);
      if (!state.activeEvent.resolved) {
        out.push(ev.prompt(state));
      }
    }
  } else if (state.scene === 'combat' && state.combat) {
    const e = state.combat.enemy;
    const intent = e.intents[state.combat.nextIntentIndex];
    const statuses =
      e.statuses.length > 0
        ? ` | Statuses: ${e.statuses.map((s) => `${s.type.toUpperCase()}(${s.turns}t)`).join(', ')}`
        : '';
    out.push(`[COMBAT — Round ${state.combat.round}]`);
    out.push(
      `Enemy: ${e.name} | HP ${e.hp}/${e.maxHp} | Armor ${e.baseArmor + e.turnArmor}${statuses}`,
    );
    if (intent) {
      out.push(`Telegraphed Intent: ${intent.label} — ${intent.description}`);
    }
  } else if (state.scene === 'shop') {
    const shop = LOCATIONS[state.locationId].shop;
    if (shop) {
      out.push(`[SHOP: ${shop.name}]`);
      out.push(shop.greeting(state));
    }
  } else if (state.scene === 'level_up') {
    out.push(`[LEVEL ${state.player.level} — CHOOSE A PERK]`);
  }

  const choices = getSceneChoices(state);
  if (choices.length > 0) {
    out.push('');
    for (const c of choices) {
      const lock = c.enabled ? '' : ` [LOCKED: ${c.reason ?? 'Unavailable'}]`;
      out.push(`  ${c.index}. ${c.label}${lock}`);
    }
  }

  out.push('');
  out.push('(Enter choice number, or "look", "map", "stats", "inv", "memory", "camp", "help", "quit")');
  return out.join('\n');
}
