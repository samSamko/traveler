import type {
  AbilityDef,
  ActionCost,
  ActiveEnemy,
  CombatState,
  DamageType,
  DownedEnemyEntry,
  GameState,
  ItemDef,
  StatusEffect,
  StatusType,
} from './types.ts';
import { getEffectiveStat, nextRandom, resolveCheck, rollDice, rollDie } from './dice.ts';
import {
  applyWeaponCoating,
  degradeArmor,
  drinkDraught,
  rollArmorTierReduction,
  spendGrace,
} from './systems/frontier.ts';
import { ABILITIES, PERKS } from './content/characters.ts';
import { ITEMS } from './content/items.ts';
import { ENEMIES } from './content/enemies.ts';
import { recordChronicle, setFlag } from './memory.ts';
import { BODY_MODS } from './systems/bodymods.ts';
import {
  DAMAGE_TYPE_META,
  computeDamageAfterResistance,
  determineEnemyDefeatOutcome,
  getEffectivePlayerResistances,
} from './systems/damage.ts';
import { resolvePlayerDefeat } from './systems/injuries.ts';
import {
  getEnemyDisplayName,
  identifyEnemy,
  markItemSeen,
  recordEnemyAttackObserved,
} from './writing/discovery.ts';
import { runActiveObserveCheck, runPassiveCombatGlance } from './writing/appraisal.ts';

const ROMAN = ['I', 'II', 'III', 'IV'] as const;

export function addItemToInventory(
  state: GameState,
  itemId: string,
  qty = 1,
): void {
  markItemSeen(state, itemId);
  const existing = state.player.inventory.find((entry) => entry.id === itemId);
  if (existing) {
    existing.qty += qty;
  } else {
    state.player.inventory.push({ id: itemId, qty });
  }
}

export function consumeInventoryItem(
  state: GameState,
  itemId: string,
  qty = 1,
): boolean {
  const idx = state.player.inventory.findIndex((entry) => entry.id === itemId);
  if (idx < 0 || state.player.inventory[idx].qty < qty) return false;
  state.player.inventory[idx].qty -= qty;
  if (state.player.inventory[idx].qty <= 0) {
    state.player.inventory.splice(idx, 1);
  }
  return true;
}

export function getPlayerArmor(state: GameState, enemyIsBoss = false): number {
  const p = state.player;
  let armor = 0;

  if (p.race === 'durnfolk') armor += 2;
  if (p.background === 'shrine_penitent' && enemyIsBoss) armor += 2;

  for (const itemId of Object.values(p.equipment)) {
    const item = itemId ? ITEMS[itemId] : undefined;
    if (item?.armorBonus) armor += item.armorBonus;
  }

  for (const perkId of p.perks) {
    const perk = PERKS[perkId];
    if (perk?.armorBonus) armor += perk.armorBonus;
  }

  for (const modId of Object.values(p.bodyMods)) {
    const mod = modId ? BODY_MODS[modId] : undefined;
    if (mod?.armorMod) armor += mod.armorMod;
  }

  for (const st of p.statuses) {
    if (st.type === 'guarded' || st.type === 'hidden') {
      armor += st.power;
    }
    if (st.type === 'corroded') {
      armor -= st.power;
    }
  }

  return Math.max(0, armor);
}

function getPerkDamageBonus(state: GameState): number {
  let bonus = 0;
  for (const perkId of state.player.perks) {
    const perk = PERKS[perkId];
    if (perk?.damageBonus) bonus += perk.damageBonus;
  }
  const offHand = state.player.equipment.offHand ? ITEMS[state.player.equipment.offHand] : undefined;
  if (offHand?.bonusDamage) bonus += offHand.bonusDamage;
  return bonus;
}

export function getTurnActionBudget(state: GameState): { main: number; swift: number; free: number } {
  let main = 1;
  let swift = 1;
  for (const perkId of state.player.perks) {
    const perk = PERKS[perkId];
    if (perk?.extraMainActions) main += perk.extraMainActions;
    if (perk?.extraSwiftActions) swift += perk.extraSwiftActions;
  }
  return { main, swift, free: 1 };
}

function getAbilityActionCost(ab: AbilityDef): ActionCost {
  return ab.actionCost ?? 'main';
}

function getItemActionCost(state: GameState, item: ItemDef): ActionCost {
  if (item.actionCost) return item.actionCost;
  const hasQuickHands = state.player.perks.some((pid) => PERKS[pid]?.swiftItems);
  if (hasQuickHands && (item.slot === 'consumable' || item.slot === 'draught' || item.slot === 'coating')) {
    return 'swift';
  }
  return 'main';
}

function getEffectiveFocusCost(state: GameState, ab: AbilityDef): number {
  return Math.max(0, ab.focusCost);
}

function hasActionPool(combat: CombatState, cost: ActionCost): boolean {
  if (cost === 'free') return combat.freeLeft > 0;
  if (cost === 'swift') return combat.swiftLeft > 0;
  return combat.mainLeft > 0;
}

function spendActionPool(combat: CombatState, cost: ActionCost): void {
  if (cost === 'free') combat.freeLeft = Math.max(0, combat.freeLeft - 1);
  else if (cost === 'swift') combat.swiftLeft = Math.max(0, combat.swiftLeft - 1);
  else combat.mainLeft = Math.max(0, combat.mainLeft - 1);
}

function pushStatus(
  list: StatusEffect[],
  incoming: StatusEffect,
  halfPower = false,
): void {
  const power = halfPower ? Math.max(1, Math.floor(incoming.power / 2)) : incoming.power;
  const existing = list.find((s) => s.type === incoming.type);
  if (existing) {
    existing.turns = Math.max(existing.turns, incoming.turns);
    existing.power = Math.max(existing.power, power);
  } else {
    list.push({ type: incoming.type, turns: incoming.turns, power });
  }
}

export function clearNegativeStatuses(list: StatusEffect[]): StatusEffect[] {
  const negatives: StatusType[] = [
    'bleeding',
    'burned',
    'blighted',
    'poisoned',
    'chilled',
    'shocked',
    'corroded',
    'dazed',
    'staggered',
  ];
  return list.filter((s) => !negatives.includes(s.type));
}

export function startCombatEncounter(
  state: GameState,
  opts: {
    enemyId?: string;
    enemyIds?: string[];
    canFlee?: boolean;
    onVictoryFlag?: string;
    onVictoryChronicle?: { title: string; summary: string; tag: string };
    preDamageRatio?: number;
    brokenSeals?: string[];
  },
): { combat: CombatState; introMessages: string[] } {
  const ids = opts.enemyIds && opts.enemyIds.length > 0
    ? opts.enemyIds
    : opts.enemyId
      ? [opts.enemyId]
      : ['root_husk'];

  const counts: Record<string, number> = {};
  for (const id of ids) {
    counts[id] = (counts[id] ?? 0) + 1;
  }
  const seen: Record<string, number> = {};
  const broken = opts.brokenSeals ?? [];

  const enemies: ActiveEnemy[] = ids.map((id, idx) => {
    const template = ENEMIES[id] ?? ENEMIES.root_husk ?? Object.values(ENEMIES)[0];
    if (!template) {
      throw new Error('No enemy templates loaded.');
    }
    const intents = template.intents.map((i) => ({ ...i, status: i.status ? { ...i.status } : undefined }));
    let baseArmor = template.armor;

    if (idx === 0) {
      if (broken.includes('root_conduit_severed')) {
        baseArmor = Math.max(0, baseArmor - 2);
        for (const intent of intents) {
          if (intent.kind === 'guard' && intent.armorGain) {
            intent.armorGain = Math.max(2, intent.armorGain - 4);
          }
        }
      }
      if (broken.includes('seal_of_silence')) {
        for (const intent of intents) {
          if (intent.kind === 'toll') {
            intent.damage = Math.max(5, Math.floor(intent.damage / 2));
            intent.resolveDamage = Math.max(1, Math.floor((intent.resolveDamage ?? 4) / 2));
            intent.status = undefined;
          }
        }
      }
    }

    const hpLoss = idx === 0 && opts.preDamageRatio
      ? Math.floor(template.maxHp * opts.preDamageRatio)
      : 0;
    const startHp = Math.max(10, template.maxHp - hpLoss);

    seen[id] = (seen[id] ?? 0) + 1;
    const suffix = counts[id] > 1 ? String(ROMAN[seen[id] - 1] ?? seen[id]) : '';

    return {
      templateId: template.id,
      name: template.name,
      unidentifiedName: template.unidentifiedName,
      suffix,
      category: template.category,
      hp: startHp,
      maxHp: template.maxHp,
      baseArmor,
      turnArmor: 0,
      stats: { ...template.stats },
      resistances: { ...(template.resistances ?? {}) },
      visibleGear: { ...template.visibleGear },
      appraisalTier: 0,
      identified: false,
      defeatedState: 'alive',
      statuses: [],
      intents,
      nextIntentIndex: idx % intents.length,
      isBoss: template.isBoss,
      isElite: template.isElite,
      xpReward: template.xpReward,
      crownReward: template.crownReward,
      lootTable: template.lootTable,
    };
  });

  const budget = getTurnActionBudget(state);
  const combat: CombatState = {
    enemies,
    subMenu: 'root',
    pendingActionId: null,
    observedUsedThisRound: false,
    round: 1,
    mainLeft: budget.main,
    swiftLeft: budget.swift,
    freeLeft: budget.free,
    graceMaxDamagePending: false,
    heirloomUsedThisFight: false,
    guaranteedDodgeThisTurn: false,
    counterDamagePending: 0,
    bossSealsBroken: broken,
    onVictoryFlag: opts.onVictoryFlag,
    onVictoryChronicle: opts.onVictoryChronicle,
    canFlee: opts.canFlee ?? true,
    log: [],
  };

  state.combat = combat;
  state.scene = 'combat';

  const introMessages = runPassiveCombatGlance(state);
  combat.log = introMessages.slice(-4);
  return { combat, introMessages };
}

export interface CombatMenuOption {
  index: number;
  id: string;
  label: string;
  enabled: boolean;
  reason?: string;
}

function getLivingEnemyIndices(combat: CombatState): number[] {
  const indices: number[] = [];
  combat.enemies.forEach((e, idx) => {
    if (e.hp > 0) indices.push(idx);
  });
  return indices;
}

export function getCombatMenuOptions(state: GameState): CombatMenuOption[] {
  const combat = state.combat;
  if (!combat) return [];
  const p = state.player;
  const opts: CombatMenuOption[] = [];

  if (combat.subMenu === 'root') {
    opts.push({
      index: 1,
      id: 'strike',
      label: 'Strike',
      enabled: combat.mainLeft > 0,
      reason: combat.mainLeft > 0 ? undefined : 'No Main action left',
    });
    opts.push({
      index: 2,
      id: 'subdue',
      label: 'Subdue',
      enabled: combat.mainLeft > 0 && p.stamina >= 1,
      reason:
        combat.mainLeft <= 0
          ? 'No Main action left'
          : p.stamina >= 1
            ? undefined
            : 'Insufficient stamina',
    });
    opts.push({
      index: 3,
      id: 'guard',
      label: 'Guard',
      enabled: combat.mainLeft > 0,
      reason: combat.mainLeft > 0 ? undefined : 'No Main action left',
    });

    const hasSkills = p.abilities.some((id) => ABILITIES[id]?.kind === 'skill');
    if (hasSkills) {
      opts.push({ index: opts.length + 1, id: 'menu:skills', label: 'Skills', enabled: true });
    }

    const hasSpells = p.abilities.some((id) => {
      const k = ABILITIES[id]?.kind;
      return k === 'cantrip' || k === 'spell';
    });
    if (hasSpells) {
      opts.push({ index: opts.length + 1, id: 'menu:spells', label: 'Spells', enabled: true });
    }

    if (!combat.observedUsedThisRound && combat.freeLeft > 0) {
      opts.push({ index: opts.length + 1, id: 'observe', label: 'Observe', enabled: true });
    }

    if (p.grace > 0 && combat.freeLeft > 0 && !combat.graceMaxDamagePending) {
      opts.push({ index: opts.length + 1, id: 'grace', label: 'Spend Grace', enabled: true });
    }

    if (!combat.heirloomUsedThisFight) {
      opts.push({
        index: opts.length + 1,
        id: 'heirloom',
        label: 'Heirloom',
        enabled: combat.swiftLeft > 0,
        reason: combat.swiftLeft > 0 ? undefined : 'No Swift action left',
      });
    }

    const hasCombatItems = p.inventory.some((entry) => {
      const item = ITEMS[entry.id];
      return (
        item &&
        (item.slot === 'consumable' ||
          item.slot === 'draught' ||
          item.slot === 'coating' ||
          item.slot === 'ash_text') &&
        !item.grantsBodyModId &&
        entry.qty > 0
      );
    });
    if (hasCombatItems) {
      opts.push({ index: opts.length + 1, id: 'menu:items', label: 'Item', enabled: true });
    }

    opts.push({ index: opts.length + 1, id: 'open_journal', label: 'Journal', enabled: true });

    if (combat.mainLeft <= 0 && combat.swiftLeft > 0) {
      opts.push({ index: opts.length + 1, id: 'end_turn', label: 'End Turn', enabled: true });
    }

    if (combat.canFlee) {
      opts.push({
        index: opts.length + 1,
        id: 'flee',
        label: 'Flee',
        enabled: combat.mainLeft > 0,
        reason: combat.mainLeft > 0 ? undefined : 'No Main action left',
      });
    }
    return opts;
  }

  if (combat.subMenu === 'skills') {
    for (const abId of p.abilities) {
      const ab = ABILITIES[abId];
      if (!ab || ab.kind !== 'skill') continue;
      const cost = getAbilityActionCost(ab);
      const hasAct = hasActionPool(combat, cost);
      const focusCost = getEffectiveFocusCost(state, ab);
      const canPay =
        hasAct &&
        p.stamina >= ab.staminaCost &&
        p.focus >= focusCost &&
        (!ab.hpCost || p.hp > ab.hpCost);
      opts.push({
        index: opts.length + 1,
        id: `ability:${ab.id}`,
        label: ab.name,
        enabled: canPay,
        reason: !hasAct
          ? `No ${cost} action left`
          : canPay
            ? undefined
            : 'Insufficient stamina or focus',
      });
    }
    opts.push({ index: opts.length + 1, id: 'menu:back', label: 'Back', enabled: true });
    return opts;
  }

  if (combat.subMenu === 'spells') {
    for (const abId of p.abilities) {
      const ab = ABILITIES[abId];
      if (!ab || (ab.kind !== 'cantrip' && ab.kind !== 'spell')) continue;
      const cost = getAbilityActionCost(ab);
      const hasAct = hasActionPool(combat, cost);
      const focusCost = getEffectiveFocusCost(state, ab);
      const canPay = hasAct && p.stamina >= ab.staminaCost && p.focus >= focusCost;
      opts.push({
        index: opts.length + 1,
        id: `ability:${ab.id}`,
        label: ab.name,
        enabled: canPay,
        reason: !hasAct
          ? `No ${cost} action left`
          : canPay
            ? undefined
            : 'Insufficient focus',
      });
    }
    opts.push({ index: opts.length + 1, id: 'menu:back', label: 'Back', enabled: true });
    return opts;
  }

  if (combat.subMenu === 'items') {
    for (const entry of p.inventory) {
      const item = ITEMS[entry.id];
      if (
        item &&
        (item.slot === 'consumable' ||
          item.slot === 'draught' ||
          item.slot === 'coating' ||
          item.slot === 'ash_text') &&
        !item.grantsBodyModId &&
        entry.qty > 0
      ) {
        const cost = getItemActionCost(state, item);
        const hasAct = hasActionPool(combat, cost);
        opts.push({
          index: opts.length + 1,
          id: `item:${item.id}`,
          label: item.name,
          enabled: hasAct,
          reason: hasAct ? undefined : `No ${cost} action left`,
        });
      }
    }
    opts.push({ index: opts.length + 1, id: 'menu:back', label: 'Back', enabled: true });
    return opts;
  }

  if (combat.subMenu === 'target') {
    for (const idx of getLivingEnemyIndices(combat)) {
      opts.push({
        index: opts.length + 1,
        id: `target:${idx}`,
        label: getEnemyDisplayName(state, combat.enemies[idx]),
        enabled: true,
      });
    }
    opts.push({ index: opts.length + 1, id: 'menu:back', label: 'Back', enabled: true });
    return opts;
  }

  return opts;
}

function getEnemyArmor(enemy: ActiveEnemy): number {
  let armor = enemy.baseArmor + enemy.turnArmor;
  const corroded = enemy.statuses.find((s) => s.type === 'corroded');
  if (corroded) armor -= corroded.power;
  return Math.max(0, armor);
}

function dealDamageToEnemy(
  state: GameState,
  enemy: ActiveEnemy,
  raw: number,
  damageType: DamageType,
  options?: { pierceArmor?: boolean; forcedSubdue?: boolean },
): { dealt: number; relationNote: string; weatherNote?: string; downedOrKilled?: 'downed' | 'killed' } {
  const armor = options?.pierceArmor ? 0 : getEnemyArmor(enemy);
  const afterArmor = Math.max(1, raw - armor);
  const res = computeDamageAfterResistance(
    afterArmor,
    damageType,
    enemy.resistances,
    state.clock.weather,
  );

  const prevHp = enemy.hp;
  enemy.hp = Math.max(0, enemy.hp - res.finalDamage);
  enemy.lastHitDamageType = damageType;
  enemy.lastHitOverkill = Math.max(0, res.finalDamage - prevHp);

  const relationNote =
    res.relation === 'immune'
      ? ' It has no effect.'
      : res.relation === 'resistant'
        ? ' It resists the blow.'
        : res.relation === 'vulnerable'
          ? ' The blow bites deep into a weakness.'
          : '';

  let downedOrKilled: 'downed' | 'killed' | undefined;
  if (enemy.hp <= 0 && prevHp > 0) {
    const weapon = state.player.equipment.mainHand ? ITEMS[state.player.equipment.mainHand] : undefined;
    const subdueBonus = Boolean(weapon?.traits?.includes('subdueBonus'));
    downedOrKilled = determineEnemyDefeatOutcome(
      enemy,
      damageType,
      enemy.lastHitOverkill,
      Boolean(options?.forcedSubdue),
      state,
      subdueBonus,
    );
    enemy.defeatedState = downedOrKilled;
  }

  return {
    dealt: res.finalDamage,
    relationNote,
    weatherNote: res.weatherNote,
    downedOrKilled,
  };
}

function resolveVictory(state: GameState): string[] {
  const combat = state.combat!;
  const p = state.player;
  const downedList: DownedEnemyEntry[] = [];
  const msgs: string[] = [
    combat.enemies.length === 1
      ? `Victory. ${getEnemyDisplayName(state, combat.enemies[0])} falls.`
      : 'Victory. The clash ends.',
  ];

  let totalCrowns = 0;
  let totalXp = 0;
  for (const enemy of combat.enemies) {
    if (enemy.isBoss || enemy.isElite) {
      identifyEnemy(state, enemy.templateId);
    }

    if (enemy.defeatedState === 'downed') {
      downedList.push({
        templateId: enemy.templateId,
        displayName: getEnemyDisplayName(state, enemy),
        category: enemy.category,
        questioned: false,
        stripped: false,
        resolved: false,
      });
    }

    let crowns =
      enemy.crownReward[0] +
      Math.floor(nextRandom(state) * (enemy.crownReward[1] - enemy.crownReward[0] + 1));
    if (p.race === 'grixi') {
      crowns = Math.ceil(crowns * 1.25);
    }
    totalCrowns += crowns;
    totalXp += enemy.xpReward;

    for (const drop of enemy.lootTable) {
      if (nextRandom(state) <= drop.chance) {
        addItemToInventory(state, drop.itemId, 1);
        msgs.push(`Found ${ITEMS[drop.itemId]?.name ?? drop.itemId}.`);
      }
    }

    if (p.race === 'grixi' && (enemy.category === 'husk' || enemy.category === 'beast')) {
      if (nextRandom(state) <= 0.45) {
        addItemToInventory(state, 'husk_gland', 1);
        msgs.push('Harvested a Spore Gland.');
      }
    }
  }

  p.crowns += totalCrowns;
  msgs.push(`Claimed ${totalCrowns} Crowns.`);

  if (combat.onVictoryFlag) {
    setFlag(state, combat.onVictoryFlag, true);
    if (combat.onVictoryFlag === 'vorne_resolved') {
      setFlag(state, 'vorne_slain', true);
    }
  }
  if (combat.onVictoryChronicle) {
    recordChronicle(
      state,
      combat.onVictoryChronicle.title,
      combat.onVictoryChronicle.summary,
      combat.onVictoryChronicle.tag,
    );
  }

  p.statuses = [];
  p.xp += totalXp;
  state.combat = null;

  let leveled = false;
  if (p.xp >= p.xpToNext) {
    p.xp -= p.xpToNext;
    p.level += 1;
    p.xpToNext = Math.floor(p.xpToNext * 1.5);
    p.maxHp += 4;
    p.maxResolve += 2;
    p.hp = Math.min(p.maxHp, p.hp + 6);
    p.resolve = Math.min(p.maxResolve, p.resolve + 4);
    p.stamina = p.maxStamina;
    p.focus = p.maxFocus;

    const availablePerks = Object.keys(PERKS).filter((pid) => !p.perks.includes(pid));
    if (availablePerks.length > 0) {
      state.pendingPerkIds = availablePerks.slice(0, 3);
      leveled = true;
      msgs.push(`Reached Level ${p.level}.`);
    } else {
      msgs.push(`Reached Level ${p.level}.`);
    }
  }

  if (downedList.length > 0) {
    state.aftermath = {
      downedEnemies: downedList,
      activeIndex: 0,
      victorySummary: msgs,
    };
    state.scene = 'aftermath';
    msgs.push(
      downedList.length === 1
        ? `${downedList[0].displayName} still breathes in the ash, broken and helpless.`
        : `${downedList.length} defeated foes still breathe in the ash.`,
    );
    return msgs;
  }

  state.scene = leveled
    ? 'level_up'
    : state.frontier?.activeDungeonId
      ? 'dungeon'
      : state.locationId === 'camp_hub'
        ? 'camp_hub'
        : 'location';
  return msgs;
}

function tickStatusList(statuses: StatusEffect[]): { dmg: number; logs: string[]; next: StatusEffect[] } {
  let dmg = 0;
  const logs: string[] = [];
  const next: StatusEffect[] = [];

  for (const st of statuses) {
    if (
      st.type === 'bleeding' ||
      st.type === 'burned' ||
      st.type === 'blighted' ||
      st.type === 'poisoned' ||
      st.type === 'shocked'
    ) {
      dmg += st.power;
      logs.push(`${st.type} deals ${st.power} damage.`);
    }
    if (st.turns > 1) {
      next.push({ ...st, turns: st.turns - 1 });
    }
  }
  return { dmg, logs, next };
}

function needsSingleTarget(actionId: string): boolean {
  if (actionId === 'strike' || actionId === 'subdue' || actionId === 'observe') return true;
  if (actionId.startsWith('ability:')) {
    const ab = ABILITIES[actionId.slice(8)];
    return Boolean(ab?.damageDice && !ab.isAoE);
  }
  if (actionId.startsWith('item:')) {
    const item = ITEMS[actionId.slice(5)];
    return Boolean(item?.throwDamage);
  }
  return false;
}

export function executeCombatAction(
  state: GameState,
  rawChoiceId: string,
): { messages: string[] } {
  const combat = state.combat;
  if (!combat) return { messages: ['Not in combat.'] };
  const p = state.player;

  if (rawChoiceId === 'menu:skills') {
    combat.subMenu = 'skills';
    return { messages: [] };
  }
  if (rawChoiceId === 'menu:spells') {
    combat.subMenu = 'spells';
    return { messages: [] };
  }
  if (rawChoiceId === 'menu:items') {
    combat.subMenu = 'items';
    return { messages: [] };
  }
  if (rawChoiceId === 'menu:back') {
    combat.subMenu = 'root';
    combat.pendingActionId = null;
    return { messages: [] };
  }

  let actionId = rawChoiceId;
  let targetIdx = getLivingEnemyIndices(combat)[0] ?? 0;

  if (rawChoiceId.startsWith('target:') && combat.pendingActionId) {
    targetIdx = Number.parseInt(rawChoiceId.slice(7), 10);
    actionId = combat.pendingActionId;
    combat.pendingActionId = null;
    combat.subMenu = 'root';
  } else if (needsSingleTarget(actionId) && getLivingEnemyIndices(combat).length > 1) {
    if (actionId === 'subdue' && p.stamina < 1) {
      return { messages: ['Insufficient stamina.'] };
    }
    if (actionId.startsWith('ability:')) {
      const ab = ABILITIES[actionId.slice(8)];
      if (ab && (p.stamina < ab.staminaCost || p.focus < ab.focusCost || (ab.hpCost && p.hp <= ab.hpCost))) {
        return { messages: ['Insufficient stamina, focus, or health.'] };
      }
    }
    combat.pendingActionId = actionId;
    combat.subMenu = 'target';
    return { messages: [] };
  } else {
    combat.subMenu = 'root';
  }

  if (actionId === 'observe') {
    if (combat.freeLeft <= 0) {
      return { messages: ['No Free action left this round.'] };
    }
    spendActionPool(combat, 'free');
    const msgs = runActiveObserveCheck(state, targetIdx);
    combat.log = msgs.slice(-5);
    return { messages: msgs };
  }

  if (actionId === 'grace') {
    if (combat.freeLeft <= 0) {
      return { messages: ['No Free action left this round.'] };
    }
    if (!spendGrace(state)) {
      return { messages: ['No Grace remains.'] };
    }
    spendActionPool(combat, 'free');
    combat.graceMaxDamagePending = true;
    const msg = 'You burn a spark of Grace. Your next blow or spell this turn will strike for maximum force.';
    combat.log = [...combat.log, msg].slice(-5);
    return { messages: [msg] };
  }

  const logs: string[] = [];
  const livingIndices = getLivingEnemyIndices(combat);
  const primaryEnemy = combat.enemies[targetIdx] ?? combat.enemies[livingIndices[0]];
  const roundOneBonus = combat.round === 1 && p.background === 'barrow_stalker' ? 3 : 0;
  const perkDmg = getPerkDamageBonus(state);

  let skipAutoTurnCheck = false;

  if (actionId === 'end_turn') {
    combat.mainLeft = 0;
    combat.swiftLeft = 0;
    logs.push('You hold your stance and yield the initiative.');
  } else if (actionId === 'strike' || actionId === 'subdue') {
    if (combat.mainLeft <= 0) return { messages: ['No Main action left this turn.'] };
    const isSubdue = actionId === 'subdue';
    if (isSubdue) {
      if (p.stamina < 1) return { messages: ['Insufficient stamina.'] };
      p.stamina -= 1;
    }
    spendActionPool(combat, 'main');
    const weapon = p.equipment.mainHand ? ITEMS[p.equipment.mainHand] : undefined;
    const [cnt, sides] = weapon?.damageDice ?? [1, 6];
    const statName = weapon?.statScaling ?? 'might';
    const statBonus = getEffectiveStat(state, statName);
    const honed = p.weaponHoned ? 1 : 0;
    const poise = p.background === 'ashen_blade' ? 1 : 0;
    const moonBonus = 0;
    let coatingBonus = 0;
    let coatingNote = '';
    if (p.weaponCoating && p.weaponCoating.charges > 0 && !isSubdue) {
      coatingBonus = p.weaponCoating.bonusDamage;
      p.weaponCoating.charges -= 1;
      coatingNote = ` ${p.weaponCoating.name} flares for +${coatingBonus} ${p.weaponCoating.damageType} damage.`;
      if (p.weaponCoating.charges <= 0) {
        p.weaponCoating = null;
      }
    }
    const diceTotal = combat.graceMaxDamagePending ? cnt * sides : rollDice(cnt, sides, state);
    if (combat.graceMaxDamagePending) {
      combat.graceMaxDamagePending = false;
      logs.push('Grace guides the blow to its peak.');
    }
    const dType: DamageType = isSubdue ? 'bludgeoning' : (weapon?.damageType ?? 'slashing');
    const rawBase =
      diceTotal +
      (weapon?.bonusDamage ?? 0) +
      statBonus +
      honed +
      poise +
      moonBonus +
      coatingBonus +
      roundOneBonus +
      perkDmg;
    const raw = isSubdue ? Math.max(2, Math.floor(rawBase * 0.85)) : rawBase;
    const hit = dealDamageToEnemy(state, primaryEnemy, raw, dType, {
      forcedSubdue: isSubdue,
      pierceArmor: Boolean(weapon?.traits?.includes('armorPiercing')),
    });
    const tName = getEnemyDisplayName(state, primaryEnemy);
    const verb = isSubdue ? 'strike to subdue' : 'strike';
    logs.push(
      `You ${verb} ${tName} with ${DAMAGE_TYPE_META[dType].label.toLowerCase()} force for ${hit.dealt} damage.${hit.relationNote}${coatingNote}`,
    );
    if (hit.weatherNote) logs.push(hit.weatherNote);
  } else if (actionId === 'guard') {
    if (combat.mainLeft <= 0) return { messages: ['No Main action left this turn.'] };
    spendActionPool(combat, 'main');
    pushStatus(p.statuses, { type: 'guarded', turns: 1, power: 4 });
    p.stamina = Math.min(p.maxStamina, p.stamina + 1);
    p.focus = Math.min(p.maxFocus, p.focus + 2);
    p.resolve = Math.min(p.maxResolve, p.resolve + 2);
    logs.push('You raise your guard, steady your breath, and steel your resolve.');
  } else if (actionId.startsWith('ability:')) {
    const abId = actionId.slice(8);
    const ab = ABILITIES[abId];
    if (!ab) return { messages: ['Unknown ability.'] };
    const cost = getAbilityActionCost(ab);
    if (!hasActionPool(combat, cost)) {
      return { messages: [`No ${cost} action left this turn.`] };
    }
    const focusCost = getEffectiveFocusCost(state, ab);
    if (p.stamina < ab.staminaCost || p.focus < focusCost || (ab.hpCost && p.hp <= ab.hpCost)) {
      return { messages: ['Insufficient stamina, focus, or health.'] };
    }

    spendActionPool(combat, cost);
    p.stamina -= ab.staminaCost;
    p.focus -= focusCost;
    if (ab.hpCost) p.hp -= ab.hpCost;

    const affected = ab.isAoE
      ? getLivingEnemyIndices(combat).map((i) => combat.enemies[i])
      : [primaryEnemy];

    const maximize = combat.graceMaxDamagePending && Boolean(ab.damageDice);
    if (maximize) {
      combat.graceMaxDamagePending = false;
      logs.push('Grace sharpens your art to its peak.');
    }

    for (const target of affected) {
      if (ab.shatterGuard) target.turnArmor = 0;
      const tName = getEnemyDisplayName(state, target);
      if (ab.damageDice) {
        const [cnt, sides] = ab.damageDice;
        const statBonus = getEffectiveStat(state, ab.stat);
        const debuffBonus =
          ab.bonusVsDebuffed && target.statuses.length > 0 ? ab.bonusVsDebuffed : 0;
        const diceTotal = maximize ? cnt * sides : rollDice(cnt, sides, state);
        const raw =
          diceTotal +
          (ab.baseDamage ?? 0) +
          statBonus +
          debuffBonus +
          roundOneBonus +
          perkDmg;
        const dType: DamageType = ab.damageType ?? 'resonant';
        const hit = dealDamageToEnemy(state, target, raw, dType, {
          pierceArmor: Boolean(ab.pierceArmor),
          forcedSubdue: Boolean(ab.nonLethal),
        });
        logs.push(
          `${ab.name} hits ${tName} with ${DAMAGE_TYPE_META[dType].label.toLowerCase()} force for ${hit.dealt} damage.${hit.relationNote}`,
        );
        if (hit.weatherNote) logs.push(hit.weatherNote);
      }
      if (ab.applyEnemyStatus && target.hp > 0) {
        pushStatus(target.statuses, ab.applyEnemyStatus);
        logs.push(`${tName} becomes ${ab.applyEnemyStatus.type}.`);
      }
    }

    if (ab.healAmount) {
      const heal = ab.healAmount + getEffectiveStat(state, ab.stat);
      p.hp = Math.min(p.maxHp, p.hp + heal);
      logs.push(`${ab.name} restores ${heal} health.`);
    }
    if (ab.restoreResolve) {
      p.resolve = Math.min(p.maxResolve, p.resolve + ab.restoreResolve);
      logs.push(`Steadied ${ab.restoreResolve} resolve.`);
    }
    if (ab.purgeNegativeStatuses) {
      p.statuses = clearNegativeStatuses(p.statuses);
      logs.push('Negative afflictions cleared.');
    }
    if (ab.restoreStamina) {
      p.stamina = Math.min(p.maxStamina, p.stamina + ab.restoreStamina);
      logs.push(`Recovered ${ab.restoreStamina} stamina.`);
    }
    if (ab.restoreFocus) {
      p.focus = Math.min(p.maxFocus, p.focus + ab.restoreFocus);
      logs.push(`Recovered ${ab.restoreFocus} focus.`);
    }
    if (ab.applySelfStatus) {
      pushStatus(p.statuses, ab.applySelfStatus);
      logs.push(`You become ${ab.applySelfStatus.type}.`);
    }
  } else if (actionId === 'heirloom') {
    if (combat.swiftLeft <= 0) {
      return { messages: ['No Swift action left this turn.'] };
    }
    if (combat.heirloomUsedThisFight) {
      return { messages: ['Your heirloom is already spent for this battle.'] };
    }
    spendActionPool(combat, 'swift');
    combat.heirloomUsedThisFight = true;

    if (p.heirloom === 'kiln_lantern') {
      primaryEnemy.turnArmor = 0;
      const hit = dealDamageToEnemy(state, primaryEnemy, 8, 'fire', { pierceArmor: true });
      p.focus = Math.min(p.maxFocus, p.focus + 3);
      logs.push(`Kiln Lantern sears ${getEnemyDisplayName(state, primaryEnemy)} for ${hit.dealt} fire damage.${hit.relationNote}`);
    } else if (p.heirloom === 'orin_bell_shard') {
      for (const idx of getLivingEnemyIndices(combat)) {
        pushStatus(combat.enemies[idx].statuses, { type: 'staggered', turns: 1, power: 1 });
      }
      pushStatus(p.statuses, { type: 'guarded', turns: 3, power: 4 });
      p.resolve = Math.min(p.maxResolve, p.resolve + 4);
      logs.push('Orin Bell-Shard rings clear, staggering your foes and steadying your mind.');
    } else if (p.heirloom === 'star_dew_vial') {
      p.hp = Math.min(p.maxHp, p.hp + 14);
      p.resolve = Math.min(p.maxResolve, p.resolve + 6);
      p.statuses = clearNegativeStatuses(p.statuses);
      pushStatus(p.statuses, { type: 'blessed', turns: 4, power: 2 });
      logs.push('Star-Dew Vial restores 14 health, steadies resolve, and clears wounds.');
    } else if (p.heirloom === 'grixi_chronometer') {
      combat.guaranteedDodgeThisTurn = true;
      combat.counterDamagePending =
        rollDice(2, 6, state) + Math.max(getEffectiveStat(state, 'agility'), getEffectiveStat(state, 'wit'));
      logs.push('Brass Chronometer slips half a heartbeat ahead.');
    }
  } else if (actionId.startsWith('item:')) {
    const itemId = actionId.slice(5);
    const item = ITEMS[itemId];
    if (!item) return { messages: ['Unknown item.'] };
    const cost = getItemActionCost(state, item);
    if (!hasActionPool(combat, cost)) {
      return { messages: [`No ${cost} action left this turn.`] };
    }
    if (!consumeInventoryItem(state, itemId, 1)) {
      return { messages: ['You do not have that item.'] };
    }
    spendActionPool(combat, cost);

    if (item.slot === 'draught') {
      logs.push(...drinkDraught(state, item.id));
    } else if (item.slot === 'coating') {
      logs.push(...applyWeaponCoating(state, item.id));
    } else if (item.slot === 'ash_text') {
      const check = resolveCheck(state, 'wit', item.ashTextDc ?? 12, {
        label: item.name,
        isLoreOrPerception: true,
      });
      if (!check.success) {
        const ruinRoll = rollDie(4, state);
        if (ruinRoll === 1) {
          p.defilement = Math.min(100, p.defilement + 8);
          logs.push(check.logLine, 'Ruin backlash scorches your tongue. Defilement rises by 8.');
        } else if (ruinRoll === 2) {
          p.hp = Math.max(1, p.hp - 5);
          logs.push(check.logLine, 'Ruin backlash snaps ribs for 5 damage.');
        } else if (ruinRoll === 3) {
          const deg = degradeArmor(state);
          logs.push(check.logLine, deg ?? 'Ruin shockwave drains 3 Resolve.');
          if (!deg) p.resolve = Math.max(0, p.resolve - 3);
        } else {
          p.resolve = Math.max(0, p.resolve - 4);
          logs.push(check.logLine, 'Hollow bronze echoes from the vellum cost 4 Resolve.');
        }
      } else if (item.ashTextEffect === 'bone_shatter') {
        primaryEnemy.turnArmor = 0;
        primaryEnemy.baseArmor = Math.max(0, primaryEnemy.baseArmor - 2);
        const hit = dealDamageToEnemy(
          state,
          primaryEnemy,
          rollDice(3, 6, state) + getEffectiveStat(state, 'wit'),
          'resonant',
          { pierceArmor: true },
        );
        logs.push(
          check.logLine,
          `${item.name} shatters ${getEnemyDisplayName(state, primaryEnemy)} for ${hit.dealt} resonant damage.`,
        );
      } else if (item.ashTextEffect === 'blight_wave') {
        const witMod = getEffectiveStat(state, 'wit');
        for (const idx of getLivingEnemyIndices(combat)) {
          const foe = combat.enemies[idx];
          const hit = dealDamageToEnemy(state, foe, rollDice(2, 6, state) + witMod, 'blight', {
            pierceArmor: true,
          });
          if (foe.hp > 0) pushStatus(foe.statuses, { type: 'blighted', turns: 3, power: 3 });
          logs.push(`${item.name} sweeps ${getEnemyDisplayName(state, foe)} for ${hit.dealt} blight damage.`);
        }
      } else {
        pushStatus(p.statuses, { type: 'guarded', turns: 4, power: 3 });
        pushStatus(p.statuses, { type: 'blessed', turns: 4, power: 2 });
        logs.push(check.logLine, 'Silver wards wrap your shoulders in guarded calm and Edge.');
      }
    } else {
      if (item.throwDamage) {
        const dType: DamageType = item.throwDamageType ?? 'fire';
        const hit = dealDamageToEnemy(state, primaryEnemy, item.throwDamage, dType, {
          pierceArmor: true,
        });
        const tName = getEnemyDisplayName(state, primaryEnemy);
        logs.push(
          `You hurl ${item.name} at ${tName} for ${hit.dealt} ${DAMAGE_TYPE_META[dType].label.toLowerCase()} damage.${hit.relationNote}`,
        );
        if (item.throwStatus && primaryEnemy.hp > 0) {
          pushStatus(primaryEnemy.statuses, item.throwStatus);
          logs.push(`${tName} becomes ${item.throwStatus.type}.`);
        }
      }
      if (item.healHp) {
        p.hp = Math.min(p.maxHp, p.hp + item.healHp);
        logs.push(`Used ${item.name}, restoring ${item.healHp} health.`);
      }
      if (item.restoreStamina) {
        p.stamina = Math.min(p.maxStamina, p.stamina + item.restoreStamina);
        logs.push(`Restored ${item.restoreStamina} stamina.`);
      }
      if (item.restoreFocus) {
        p.focus = Math.min(p.maxFocus, p.focus + item.restoreFocus);
        logs.push(`Restored ${item.restoreFocus} focus.`);
      }
      if (item.restoreResolve) {
        p.resolve = Math.min(p.maxResolve, p.resolve + item.restoreResolve);
        logs.push(`Restored ${item.restoreResolve} resolve.`);
      }
      if (item.cureNegative) {
        p.statuses = clearNegativeStatuses(p.statuses);
        logs.push('Afflictions purged.');
      }
    }
  } else if (actionId === 'flee') {
    if (combat.mainLeft <= 0) {
      return { messages: ['No Main action left this turn.'] };
    }
    if (!combat.canFlee) {
      return { messages: ['There is no escape from the Choir-Pit.'] };
    }
    spendActionPool(combat, 'main');
    const agi = getEffectiveStat(state, 'agility');
    const roll = rollDice(1, 20, state);
    if (roll + agi >= 12) {
      state.combat = null;
      state.scene = state.frontier?.activeDungeonId
        ? 'dungeon'
        : state.locationId === 'camp_hub'
          ? 'camp_hub'
          : 'location';
      p.statuses = [];
      return {
        messages: ['You slip clear into the mist before the circle closes.'],
      };
    }
    skipAutoTurnCheck = true;
    logs.push('Your escape route is cut off.');
  } else {
    return { messages: ['Unknown combat action.'] };
  }

  if (getLivingEnemyIndices(combat).length === 0) {
    return { messages: [...logs, ...resolveVictory(state)] };
  }

  if (!skipAutoTurnCheck && actionId !== 'end_turn' && (combat.mainLeft > 0 || combat.swiftLeft > 0)) {
    combat.log = logs.slice(-5);
    return { messages: logs };
  }

  for (const idx of getLivingEnemyIndices(combat)) {
    const enemy = combat.enemies[idx];
    const eName = getEnemyDisplayName(state, enemy);
    const tick = tickStatusList(enemy.statuses);
    enemy.statuses = tick.next;
    if (tick.dmg > 0) {
      enemy.hp = Math.max(0, enemy.hp - tick.dmg);
      logs.push(...tick.logs.map((l) => `${eName}: ${l}`));
      if (enemy.hp <= 0) {
        enemy.defeatedState = determineEnemyDefeatOutcome(enemy, 'blight', 0, false, state);
      }
    }
    if (enemy.hp <= 0) {
      logs.push(`${eName} collapses.`);
    }
  }

  if (getLivingEnemyIndices(combat).length === 0) {
    return { messages: [...logs, ...resolveVictory(state)] };
  }

  const playerResistances = getEffectivePlayerResistances(state);

  for (const idx of getLivingEnemyIndices(combat)) {
    const enemy = combat.enemies[idx];
    const eName = getEnemyDisplayName(state, enemy);
    enemy.turnArmor = 0;
    const intent = enemy.intents[enemy.nextIntentIndex];
    const staggeredIdx = enemy.statuses.findIndex((s) => s.type === 'staggered');

    if (staggeredIdx >= 0) {
      enemy.statuses.splice(staggeredIdx, 1);
      logs.push(`${eName} reels staggered and loses its action.`);
    } else if (intent) {
      recordEnemyAttackObserved(state, enemy.templateId, intent.label);
      if (intent.kind === 'guard') {
        enemy.turnArmor += intent.armorGain ?? 4;
        logs.push(`${eName} uses ${intent.label} and raises its guard.`);
      } else if (combat.guaranteedDodgeThisTurn) {
        combat.guaranteedDodgeThisTurn = false;
        const hit = dealDamageToEnemy(state, enemy, combat.counterDamagePending, 'piercing');
        combat.counterDamagePending = 0;
        logs.push(`You slip past ${eName}'s ${intent.label} and counter for ${hit.dealt} damage.`);
      } else {
        const dazed = enemy.statuses.find((s) => s.type === 'dazed');
        const dmgReduction = dazed ? dazed.power : 0;
        const playerArmor = getPlayerArmor(state, Boolean(enemy.isBoss));
        const tierDr = rollArmorTierReduction(p.armorTierCurrent, state);
        const preRes = Math.max(0, intent.damage - dmgReduction - playerArmor - tierDr);
        const res = preRes > 0
          ? computeDamageAfterResistance(preRes, intent.damageType, playerResistances, state.clock.weather)
          : { finalDamage: 0, relation: 'neutral' as const };
        p.hp = Math.max(0, p.hp - res.finalDamage);
        const tierNote = tierDr > 0 ? ` Armor absorbs ${tierDr}.` : '';
        const relText =
          res.relation === 'immune'
            ? ' Your body shrugs it off completely.'
            : res.relation === 'resistant'
              ? ' You resist part of the impact.'
              : res.relation === 'vulnerable'
                ? ' It tears straight into your weakness.'
                : '';
        logs.push(
          `${eName} strikes with ${intent.label} for ${res.finalDamage} ${DAMAGE_TYPE_META[intent.damageType].label.toLowerCase()} damage.${tierNote}${relText}`,
        );
        if (res.finalDamage > 0 && p.armorTierCurrent > 0 && rollDie(10, state) === 1) {
          const degMsg = degradeArmor(state);
          if (degMsg) logs.push(degMsg);
        }
        if (intent.resolveDamage && intent.resolveDamage > 0) {
          p.resolve = Math.max(0, p.resolve - intent.resolveDamage);
          logs.push(`Your resolve frays by ${intent.resolveDamage}.`);
        }
        if (intent.defilementGain && intent.defilementGain > 0) {
          p.defilement = Math.min(100, p.defilement + intent.defilementGain);
        }
        if (intent.status) {
          const half = p.race === 'durnfolk' && (intent.status.type === 'bleeding' || intent.status.type === 'blighted' || intent.status.type === 'poisoned');
          pushStatus(p.statuses, intent.status, half);
          logs.push(`You suffer ${intent.status.type}.`);
        }
      }
    }

    enemy.nextIntentIndex = (enemy.nextIntentIndex + 1) % enemy.intents.length;
    if (p.hp <= 0 || p.resolve <= 0) break;
  }

  if (getLivingEnemyIndices(combat).length === 0) {
    return { messages: [...logs, ...resolveVictory(state)] };
  }

  const playerTick = tickStatusList(p.statuses);
  p.statuses = playerTick.next;
  if (playerTick.dmg > 0) {
    p.hp = Math.max(0, p.hp - playerTick.dmg);
    logs.push(...playerTick.logs);
  }

  if (p.hp <= 0) {
    return { messages: [...logs, ...resolvePlayerDefeat(state, 'hp')] };
  }
  if (p.resolve <= 0) {
    return { messages: [...logs, ...resolvePlayerDefeat(state, 'resolve')] };
  }

  combat.round += 1;
  combat.observedUsedThisRound = false;
  const nextBudget = getTurnActionBudget(state);
  combat.mainLeft = nextBudget.main;
  combat.swiftLeft = nextBudget.swift;
  combat.freeLeft = nextBudget.free;
  combat.graceMaxDamagePending = false;
  p.stamina = Math.min(p.maxStamina, p.stamina + 1);
  if (p.background === 'root_scholar') {
    p.focus = Math.min(p.maxFocus, p.focus + 1);
  }

  combat.log = logs.slice(-5);
  return { messages: logs };
}
