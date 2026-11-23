import type {
  ActiveEnemy,
  CombatState,
  GameState,
  StatusEffect,
  StatusType,
} from './types.ts';
import { getEffectiveStat, nextRandom, rollDice } from './dice.ts';
import { ABILITIES, HEIRLOOMS, PERKS } from './content/characters.ts';
import { ITEMS } from './content/items.ts';
import { ENEMIES } from './content/enemies.ts';
import { hasFlag, recordChronicle, setFlag } from './memory.ts';

export function addItemToInventory(
  state: GameState,
  itemId: string,
  qty = 1,
): void {
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

  const armorItem = ITEMS[p.armorId];
  if (armorItem?.armorBonus) armor += armorItem.armorBonus;

  const trinket = p.trinketId ? ITEMS[p.trinketId] : undefined;
  if (trinket?.armorBonus) armor += trinket.armorBonus;

  for (const perkId of p.perks) {
    const perk = PERKS[perkId];
    if (perk?.armorBonus) armor += perk.armorBonus;
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
  return bonus;
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
  const negatives: StatusType[] = ['bleeding', 'burned', 'blighted', 'corroded', 'dazed', 'staggered'];
  return list.filter((s) => !negatives.includes(s.type));
}

export function startCombatEncounter(
  state: GameState,
  opts: {
    enemyId: string;
    canFlee?: boolean;
    onVictoryFlag?: string;
    onVictoryChronicle?: { title: string; summary: string; tag: string };
    preDamageRatio?: number;
    brokenSeals?: string[];
  },
): CombatState {
  const template = ENEMIES[opts.enemyId];
  if (!template) {
    throw new Error(`Unknown enemy template: ${opts.enemyId}`);
  }

  const intents = template.intents.map((i) => ({ ...i, status: i.status ? { ...i.status } : undefined }));
  let baseArmor = template.armor;
  const broken = opts.brokenSeals ?? [];

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
        intent.status = undefined;
      }
    }
  }

  const hpLoss = opts.preDamageRatio ? Math.floor(template.maxHp * opts.preDamageRatio) : 0;
  const startHp = Math.max(10, template.maxHp - hpLoss);

  const enemy: ActiveEnemy = {
    templateId: template.id,
    name: template.name,
    category: template.category,
    hp: startHp,
    maxHp: template.maxHp,
    baseArmor,
    turnArmor: 0,
    statuses: [],
    intents,
    nextIntentIndex: 0,
    isBoss: template.isBoss,
    isElite: template.isElite,
    xpReward: template.xpReward,
    crownReward: template.crownReward,
    lootTable: template.lootTable,
  };

  const combat: CombatState = {
    enemy,
    round: 1,
    heirloomUsedThisFight: false,
    guaranteedDodgeThisTurn: false,
    counterDamagePending: 0,
    bossSealsBroken: broken,
    onVictoryFlag: opts.onVictoryFlag,
    onVictoryChronicle: opts.onVictoryChronicle,
    canFlee: opts.canFlee ?? true,
    log: [template.description],
  };

  state.combat = combat;
  state.scene = 'combat';
  return combat;
}

export interface CombatMenuOption {
  index: number;
  id: string;
  label: string;
  enabled: boolean;
  reason?: string;
}

export function getCombatMenuOptions(state: GameState): CombatMenuOption[] {
  const combat = state.combat;
  if (!combat) return [];
  const p = state.player;
  const weapon = ITEMS[p.weaponId];
  const opts: CombatMenuOption[] = [];

  opts.push({
    index: 1,
    id: 'strike',
    label: `Strike with ${weapon?.name ?? 'Weapon'}`,
    enabled: true,
  });

  opts.push({
    index: 2,
    id: 'guard',
    label: 'Guard & Channel (+4 Armor, +1 Stm, +2 Foc)',
    enabled: true,
  });

  for (const abId of p.abilities) {
    const ab = ABILITIES[abId];
    if (!ab) continue;
    const costLabel: string[] = [];
    if (ab.staminaCost > 0) costLabel.push(`${ab.staminaCost} Stm`);
    if (ab.focusCost > 0) costLabel.push(`${ab.focusCost} Foc`);
    if (ab.hpCost) costLabel.push(`${ab.hpCost} HP`);

    const canPay =
      p.stamina >= ab.staminaCost &&
      p.focus >= ab.focusCost &&
      (!ab.hpCost || p.hp > ab.hpCost);

    opts.push({
      index: opts.length + 1,
      id: `ability:${ab.id}`,
      label: `[${ab.kind.toUpperCase()}] ${ab.name} (${costLabel.join(', ')})`,
      enabled: canPay,
      reason: canPay ? undefined : 'Insufficient Stamina/Focus/HP',
    });
  }

  if (!combat.heirloomUsedThisFight) {
    const h = HEIRLOOMS[p.heirloom];
    opts.push({
      index: opts.length + 1,
      id: 'heirloom',
      label: `[HEIRLOOM] ${h.name} (1/fight)`,
      enabled: true,
    });
  }

  for (const entry of p.inventory) {
    const item = ITEMS[entry.id];
    if (item && item.slot === 'consumable' && entry.qty > 0) {
      opts.push({
        index: opts.length + 1,
        id: `item:${item.id}`,
        label: `[ITEM] ${item.name} x${entry.qty}`,
        enabled: true,
      });
    }
  }

  if (combat.canFlee) {
    opts.push({
      index: opts.length + 1,
      id: 'flee',
      label: 'Attempt to Flee (Agility DC 12)',
      enabled: true,
    });
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
  raw: number,
  pierceArmor = false,
): number {
  const combat = state.combat!;
  const enemy = combat.enemy;
  const armor = pierceArmor ? 0 : getEnemyArmor(enemy);
  const dealt = Math.max(1, raw - armor);
  enemy.hp = Math.max(0, enemy.hp - dealt);
  return dealt;
}

function resolveVictory(state: GameState): string[] {
  const combat = state.combat!;
  const enemy = combat.enemy;
  const p = state.player;
  const msgs: string[] = [`VICTORY! ${enemy.name} collapses.`];

  let crowns =
    enemy.crownReward[0] +
    Math.floor(nextRandom(state) * (enemy.crownReward[1] - enemy.crownReward[0] + 1));
  if (p.race === 'grixi') {
    crowns = Math.ceil(crowns * 1.25);
  }
  p.crowns += crowns;
  msgs.push(`Looted +${crowns} Crowns and +${enemy.xpReward} XP.`);

  for (const drop of enemy.lootTable) {
    if (nextRandom(state) <= drop.chance) {
      addItemToInventory(state, drop.itemId, 1);
      msgs.push(`Recovered item: ${ITEMS[drop.itemId]?.name ?? drop.itemId}.`);
    }
  }

  if (p.race === 'grixi' && (enemy.category === 'husk' || enemy.category === 'beast')) {
    if (nextRandom(state) <= 0.45) {
      addItemToInventory(state, 'husk_gland', 1);
      msgs.push('[Grixi Scrap-Savant] Harvested +1 Calcified Spore-Gland.');
    }
  }

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
  p.xp += enemy.xpReward;
  state.combat = null;

  if (p.xp >= p.xpToNext) {
    p.xp -= p.xpToNext;
    p.level += 1;
    p.xpToNext = Math.floor(p.xpToNext * 1.5);
    p.maxHp += 4;
    p.hp = Math.min(p.maxHp, p.hp + 6);
    p.stamina = p.maxStamina;
    p.focus = p.maxFocus;

    const availablePerks = Object.keys(PERKS).filter((pid) => !p.perks.includes(pid));
    if (availablePerks.length > 0) {
      state.pendingPerkIds = availablePerks.slice(0, 3);
      state.scene = 'level_up';
      msgs.push(`LEVEL UP! Reached Level ${p.level} (+4 Max HP). Choose a new Perk!`);
      return msgs;
    }
    msgs.push(`LEVEL UP! Reached Level ${p.level} (+4 Max HP).`);
  }

  state.scene = 'location';
  return msgs;
}

function tickStatusList(statuses: StatusEffect[]): { dmg: number; logs: string[]; next: StatusEffect[] } {
  let dmg = 0;
  const logs: string[] = [];
  const next: StatusEffect[] = [];

  for (const st of statuses) {
    if (st.type === 'bleeding' || st.type === 'burned' || st.type === 'blighted') {
      dmg += st.power;
      logs.push(`${st.type.toUpperCase()} deals ${st.power} damage.`);
    }
    if (st.turns > 1) {
      next.push({ ...st, turns: st.turns - 1 });
    }
  }
  return { dmg, logs, next };
}

export function executeCombatAction(
  state: GameState,
  actionId: string,
): { messages: string[] } {
  const combat = state.combat;
  if (!combat) return { messages: ['Not in combat.'] };
  const p = state.player;
  const enemy = combat.enemy;
  const logs: string[] = [];

  const roundOneBonus = combat.round === 1 && p.background === 'barrow_stalker' ? 3 : 0;
  const perkDmg = getPerkDamageBonus(state);

  if (actionId === 'strike') {
    const weapon = ITEMS[p.weaponId];
    const [cnt, sides] = weapon?.damageDice ?? [1, 6];
    const statName = weapon?.statScaling ?? 'might';
    const statBonus = getEffectiveStat(state, statName);
    const honed = p.weaponHoned ? 1 : 0;
    const poise = p.background === 'ashen_blade' ? 1 : 0;
    const raw =
      rollDice(cnt, sides, state) +
      (weapon?.bonusDamage ?? 0) +
      statBonus +
      honed +
      poise +
      roundOneBonus +
      perkDmg;
    const dealt = dealDamageToEnemy(state, raw, false);
    logs.push(`You strike with ${weapon?.name ?? 'your weapon'} for ${dealt} damage!`);
  } else if (actionId === 'guard') {
    pushStatus(p.statuses, { type: 'guarded', turns: 1, power: 4 });
    p.stamina = Math.min(p.maxStamina, p.stamina + 1);
    p.focus = Math.min(p.maxFocus, p.focus + 2);
    logs.push('You brace behind guard (+4 Armor, +1 Stamina, +2 Focus).');
  } else if (actionId.startsWith('ability:')) {
    const abId = actionId.slice('ability:'.length);
    const ab = ABILITIES[abId];
    if (!ab) return { messages: ['Unknown ability.'] };
    if (p.stamina < ab.staminaCost || p.focus < ab.focusCost || (ab.hpCost && p.hp <= ab.hpCost)) {
      return { messages: ['Not enough Stamina, Focus, or HP for that action.'] };
    }

    p.stamina -= ab.staminaCost;
    p.focus -= ab.focusCost;
    if (ab.hpCost) p.hp -= ab.hpCost;

    if (ab.shatterGuard) {
      enemy.turnArmor = 0;
    }

    if (ab.damageDice) {
      const [cnt, sides] = ab.damageDice;
      const statBonus = getEffectiveStat(state, ab.stat);
      const debuffBonus =
        ab.bonusVsDebuffed && enemy.statuses.length > 0 ? ab.bonusVsDebuffed : 0;
      const raw =
        rollDice(cnt, sides, state) +
        (ab.baseDamage ?? 0) +
        statBonus +
        debuffBonus +
        roundOneBonus +
        perkDmg;
      const dealt = dealDamageToEnemy(state, raw, Boolean(ab.pierceArmor));
      logs.push(`[${ab.name}] Hits ${enemy.name} for ${dealt} damage!`);
    }

    if (ab.healAmount) {
      const heal = ab.healAmount + getEffectiveStat(state, ab.stat);
      p.hp = Math.min(p.maxHp, p.hp + heal);
      logs.push(`[${ab.name}] Restores ${heal} HP.`);
    }

    if (ab.purgeNegativeStatuses) {
      p.statuses = clearNegativeStatuses(p.statuses);
      logs.push('Negative statuses purged!');
    }

    if (ab.restoreStamina) {
      p.stamina = Math.min(p.maxStamina, p.stamina + ab.restoreStamina);
      logs.push(`Recovered +${ab.restoreStamina} Stamina.`);
    }
    if (ab.restoreFocus) {
      p.focus = Math.min(p.maxFocus, p.focus + ab.restoreFocus);
      logs.push(`Recovered +${ab.restoreFocus} Focus.`);
    }

    if (ab.applyEnemyStatus) {
      pushStatus(enemy.statuses, ab.applyEnemyStatus);
      logs.push(`${enemy.name} is afflicted with ${ab.applyEnemyStatus.type.toUpperCase()}!`);
    }
    if (ab.applySelfStatus) {
      pushStatus(p.statuses, ab.applySelfStatus);
      logs.push(`You gain ${ab.applySelfStatus.type.toUpperCase()}!`);
    }
  } else if (actionId === 'heirloom') {
    if (combat.heirloomUsedThisFight) {
      return { messages: ['Your Heirloom is already spent for this battle.'] };
    }
    combat.heirloomUsedThisFight = true;

    if (p.heirloom === 'kiln_lantern') {
      enemy.turnArmor = 0;
      const dealt = dealDamageToEnemy(state, 8, true);
      p.focus = Math.min(p.maxFocus, p.focus + 3);
      logs.push(`[Lantern of the First Kiln] Blinding ash-fire scorches ${enemy.name} for ${dealt} damage (+3 Focus)!`);
    } else if (p.heirloom === 'orin_bell_shard') {
      pushStatus(enemy.statuses, { type: 'staggered', turns: 1, power: 1 });
      pushStatus(p.statuses, { type: 'guarded', turns: 3, power: 4 });
      logs.push('[Bell-Shard of St. Orin] Counter-chime Staggers the foe and grants +4 Armor (3t)!');
    } else if (p.heirloom === 'star_dew_vial') {
      p.hp = Math.min(p.maxHp, p.hp + 14);
      p.statuses = clearNegativeStatuses(p.statuses);
      pushStatus(p.statuses, { type: 'blessed', turns: 4, power: 2 });
      logs.push('[Vial of Star-Dew] Restored 14 HP, purged afflictions, and gained Blessed (+2)!');
    } else if (p.heirloom === 'grixi_chronometer') {
      combat.guaranteedDodgeThisTurn = true;
      combat.counterDamagePending =
        rollDice(2, 6, state) + Math.max(getEffectiveStat(state, 'agility'), getEffectiveStat(state, 'wit'));
      logs.push('[Grixi Chronometer-Compass] Time slips sideways — ready to dodge and counter!');
    }
  } else if (actionId.startsWith('item:')) {
    const itemId = actionId.slice('item:'.length);
    const item = ITEMS[itemId];
    if (!item || !consumeInventoryItem(state, itemId, 1)) {
      return { messages: ['You do not have that item.'] };
    }
    if (item.throwDamage) {
      const dealt = dealDamageToEnemy(state, item.throwDamage, true);
      logs.push(`Hurled ${item.name} for ${dealt} fire damage!`);
      if (item.throwStatus) {
        pushStatus(enemy.statuses, item.throwStatus);
        logs.push(`${enemy.name} catches ${item.throwStatus.type.toUpperCase()}!`);
      }
    }
    if (item.healHp) {
      p.hp = Math.min(p.maxHp, p.hp + item.healHp);
      logs.push(`Used ${item.name}: +${item.healHp} HP.`);
    }
    if (item.restoreStamina) {
      p.stamina = Math.min(p.maxStamina, p.stamina + item.restoreStamina);
      logs.push(`+${item.restoreStamina} Stamina.`);
    }
    if (item.restoreFocus) {
      p.focus = Math.min(p.maxFocus, p.focus + item.restoreFocus);
      logs.push(`+${item.restoreFocus} Focus.`);
    }
    if (item.cureNegative) {
      p.statuses = clearNegativeStatuses(p.statuses);
      logs.push('Afflictions purged.');
    }
  } else if (actionId === 'flee') {
    if (!combat.canFlee) {
      return { messages: ['There is no escape from the Choir-Pit!'] };
    }
    const agi = getEffectiveStat(state, 'agility');
    const roll = rollDice(1, 20, state);
    if (roll + agi >= 12) {
      state.combat = null;
      state.scene = 'location';
      p.statuses = [];
      return {
        messages: [
          `[Flee: d20(${roll}) + ${agi} = ${roll + agi} vs DC 12 -> ESCAPED] You slip away into the mist.`,
        ],
      };
    }
    logs.push(`[Flee: d20(${roll}) + ${agi} = ${roll + agi} vs DC 12 -> FAILED] ${enemy.name} cuts off your retreat!`);
  } else {
    return { messages: ['Unknown combat action.'] };
  }

  // Check immediate enemy death
  if (enemy.hp <= 0) {
    return { messages: [...logs, ...resolveVictory(state)] };
  }

  // Tick enemy statuses
  const enemyTick = tickStatusList(enemy.statuses);
  enemy.statuses = enemyTick.next;
  if (enemyTick.dmg > 0) {
    enemy.hp = Math.max(0, enemy.hp - enemyTick.dmg);
    logs.push(...enemyTick.logs.map((l) => `${enemy.name}: ${l}`));
  }
  if (enemy.hp <= 0) {
    return { messages: [...logs, ...resolveVictory(state)] };
  }

  // Enemy turn
  enemy.turnArmor = 0;
  const intent = enemy.intents[combat.nextIntentIndex];
  const staggeredIdx = enemy.statuses.findIndex((s) => s.type === 'staggered');

  if (staggeredIdx >= 0) {
    enemy.statuses.splice(staggeredIdx, 1);
    logs.push(`[STAGGERED] ${enemy.name} reels and loses its action!`);
  } else if (intent) {
    if (intent.kind === 'guard') {
      enemy.turnArmor += intent.armorGain ?? 4;
      logs.push(`${enemy.name} uses ${intent.label} (+${enemy.turnArmor} Armor).`);
    } else if (combat.guaranteedDodgeThisTurn) {
      combat.guaranteedDodgeThisTurn = false;
      const cDmg = dealDamageToEnemy(state, combat.counterDamagePending, false);
      combat.counterDamagePending = 0;
      logs.push(
        `You phase cleanly around ${intent.label} and counter-strike for ${cDmg} damage!`,
      );
    } else {
      const dazed = enemy.statuses.find((s) => s.type === 'dazed');
      const dmgReduction = dazed ? dazed.power : 0;
      const playerArmor = getPlayerArmor(state, Boolean(enemy.isBoss));
      const incoming = Math.max(0, intent.damage - dmgReduction - playerArmor);
      p.hp = Math.max(0, p.hp - incoming);
      logs.push(
        `${enemy.name} executes ${intent.label} -> ${incoming} damage (${playerArmor} blocked).`,
      );
      if (intent.status) {
        const half = p.race === 'durnfolk' && (intent.status.type === 'bleeding' || intent.status.type === 'blighted');
        pushStatus(p.statuses, intent.status, half);
        logs.push(`You suffer ${intent.status.type.toUpperCase()}!`);
      }
    }
  }

  if (enemy.hp <= 0) {
    return { messages: [...logs, ...resolveVictory(state)] };
  }

  // Tick player statuses & round recovery
  const playerTick = tickStatusList(p.statuses);
  p.statuses = playerTick.next;
  if (playerTick.dmg > 0) {
    p.hp = Math.max(0, p.hp - playerTick.dmg);
    logs.push(...playerTick.logs.map((l) => `You: ${l}`));
  }

  if (p.hp <= 0) {
    state.combat = null;
    state.scene = 'dead';
    logs.push('Your knees buckle into the ash. The Gloaming Reach claims another traveler...');
    return { messages: logs };
  }

  combat.nextIntentIndex = (combat.nextIntentIndex + 1) % enemy.intents.length;
  combat.round += 1;
  p.stamina = Math.min(p.maxStamina, p.stamina + 1);
  if (p.background === 'root_scholar') {
    p.focus = Math.min(p.maxFocus, p.focus + 1);
  }

  combat.log = logs.slice(-4);
  return { messages: logs };
}
