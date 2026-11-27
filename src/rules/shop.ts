import type { WorldDatabase } from '../db/loader.ts';
import type { ArmorTier, Character, DungeonState, GameState, InventoryItem } from '../types.ts';
import { canCarryMoreItems, rollDie } from '../dice.ts';
import { paint } from '../ui.ts';
import { getActiveMiseryEffects } from './calendar.ts';

export interface ShopEntry {
  num: number;
  id: string;
  label: string;
  cost: number;
}

export const SHOP_CATALOG: ShopEntry[] = [
  { num: 1, id: 'food', label: 'Dried food (1 day)', cost: 1 },
  { num: 2, id: 'water', label: 'Waterskin refill (+4 days water)', cost: 4 },
  { num: 3, id: 'lard', label: 'Lard (functions as 5 meals)', cost: 5 },
  { num: 4, id: 'medicine', label: 'Medicine box (PRE+4 uses; +d6 HP & cures bleeding/infection)', cost: 15 },
  { num: 5, id: 'shield', label: 'Shield (-1 dmg or shatter to ignore 1 attack)', cost: 20 },
  { num: 6, id: 'backpack', label: 'Backpack (+7 carrying capacity)', cost: 6 },
  { num: 7, id: 'sack', label: 'Sack (+10 carrying capacity)', cost: 3 },
  { num: 8, id: 'bear_trap', label: 'Bear trap (d8 dmg)', cost: 20 },
  { num: 9, id: 'red_poison', label: 'Bottle of red poison (3 doses)', cost: 20 },
  { num: 10, id: 'sword', label: 'Sword (d6 melee)', cost: 30 },
  { num: 11, id: 'flail', label: 'Flail (d8 melee)', cost: 35 },
  { num: 12, id: 'crossbow', label: 'Crossbow (d8 ranged + 10 bolts)', cost: 40 },
  { num: 13, id: 'zweihander', label: 'Zweihänder (d10 two-handed)', cost: 60 },
  { num: 14, id: 'ammo', label: '10 Arrows / Bolts', cost: 10 },
  { num: 15, id: 'armor_1', label: 'Light Armor (Tier 1, -d2 dmg)', cost: 20 },
  { num: 16, id: 'armor_2', label: 'Medium Armor (Tier 2, -d4 dmg, +2 AGI DR)', cost: 100 },
  { num: 17, id: 'armor_3', label: 'Heavy Armor (Tier 3, -d6 dmg, +4 AGI/+2 Def DR)', cost: 200 },
  { num: 18, id: 'repair', label: 'Repair Damaged Armor (T1->T2 25s / T2->T3 40s, max original tier)', cost: 25 },
  { num: 19, id: 'hospice', label: 'Night in Hospice (restore d6 HP & clear dizzy)', cost: 3 },
];

function applyInflation(baseCost: number, state?: GameState): number {
  if (!state) return baseCost;
  const stacks = getActiveMiseryEffects(state).counts.price_inflation;
  if (stacks <= 0) return baseCost;
  return Math.ceil(baseCost * (1 + 0.5 * stacks));
}

export function renderShopCatalog(pc: Character, stealth: boolean, state?: GameState): string {
  const inflationStacks = state ? getActiveMiseryEffects(state).counts.price_inflation : 0;
  const headerSuffix = inflationStacks > 0 ? ` | INFLATION x${inflationStacks} (+${inflationStacks * 50}%)` : '';
  const lines = [
    paint(
      `\n--- Quartermaster & Services (${pc.name}: ${pc.silver}s | Carrying ${pc.inventory.length}/${pc.carryingCapacity} max ${pc.carryingCapacity * 2}${headerSuffix}) ---`,
      'yellow',
      stealth,
    ),
  ];
  for (const item of SHOP_CATALOG) {
    let priceStr = `${applyInflation(item.cost, state)}s`;
    if (item.id === 'repair') {
      priceStr = pc.armorTier === 1 ? `${applyInflation(25, state)}s` : pc.armorTier === 2 ? `${applyInflation(40, state)}s` : 'N/A';
    }
    lines.push(paint(`  ${String(item.num).padStart(2, ' ')}. ${item.label} — ${priceStr}`, 'bone', stealth));
  }
  lines.push(paint('Usage: buy <#> (or buy <name>), repair, sell <#> | sell all, drop <item#>', 'dim', stealth));
  return lines.join('\n');
}

export function getItemSellValue(
  item: InventoryItem,
  world: WorldDatabase,
  dungeon?: DungeonState | null,
): number {
  const lower = item.name.toLowerCase();
  if (dungeon && (item.name === dungeon.bossKeyName || item.name === dungeon.puzzleSocketItemName)) {
    return 0;
  }
  if (item.kind === 'treasure' || lower.includes('famine spoon') || lower.includes('silver bird cage')) {
    if (typeof item.silverValue === 'number' && item.silverValue > 0) return item.silverValue;
    const m = item.name.match(/(\d+)\s*s\b/i);
    if (m) return Math.max(1, Number.parseInt(m[1], 10));
    return 15;
  }
  if (item.kind === 'relic') {
    return item.silverValue ?? 30;
  }
  if (item.kind === 'unclean_scroll' || item.kind === 'sacred_scroll') {
    return 25;
  }
  const matchShop = world.shopItems.find((s) => lower.includes(s.name.toLowerCase()));
  if (matchShop) return Math.max(1, Math.floor(matchShop.silver * 0.5));
  const matchWpn = world.weapons.find((w) => w.id !== 'unarmed' && lower.includes(w.name.toLowerCase()));
  if (matchWpn && matchWpn.silver > 0) return Math.max(1, Math.floor(matchWpn.silver * 0.5));
  return 3;
}

export function sellInventoryItem(
  state: GameState,
  world: WorldDatabase,
  pcIndex: number,
  rawQuery: string,
): string[] {
  const pc = state.party.members[pcIndex];
  if (!pc || pc.status !== 'alive') return ['Selected PC cannot sell items.'];
  if (state.mode !== 'exploration') {
    return ['Quartermaster only buys loot outside dungeons and combat.'];
  }

  const q = rawQuery.trim().toLowerCase();
  if (q === 'all' || q === 'treasures') {
    let earned = 0;
    let count = 0;
    const kept: InventoryItem[] = [];
    for (const item of pc.inventory) {
      const isSellableTreasure = item.kind === 'treasure';
      const val = isSellableTreasure ? getItemSellValue(item, world, state.activeDungeon) : 0;
      if (isSellableTreasure && val > 0) {
        earned += val;
        count += 1;
      } else {
        kept.push(item);
      }
    }
    if (count === 0) {
      return [`${pc.name} carries no sellable trophies or treasures.`];
    }
    pc.inventory = kept;
    pc.silver += earned;
    return [`${pc.name} sells ${count} trophy/treasure item(s) to the Quartermaster for +${earned}s (${pc.silver}s total).`];
  }

  const idx = Number.parseInt(q, 10) - 1;
  if (Number.isNaN(idx) || !pc.inventory[idx]) {
    return ['Specify a valid item # to sell (check "sheet") or use "sell all".'];
  }
  const item = pc.inventory[idx];
  const val = getItemSellValue(item, world, state.activeDungeon);
  if (val <= 0) {
    return [`The Quartermaster refuses to buy ${item.name} — you still need it for the contract.`];
  }
  pc.inventory.splice(idx, 1);
  if (item.kind === 'shield' && !pc.inventory.some((i) => i.kind === 'shield')) {
    pc.hasShield = false;
  }
  pc.silver += val;
  return [`${pc.name} sells ${item.name} for +${val}s (${pc.silver}s total).`];
}

export function buyShopEntry(
  state: GameState,
  world: WorldDatabase,
  pcIndex: number,
  rawQuery: string,
): string[] {
  const pc = state.party.members[pcIndex];
  if (!pc || pc.status !== 'alive') return ['Selected PC cannot buy items.'];
  if (state.mode !== 'exploration') {
    return ['Quartermaster shop is only accessible outside dungeons and combat.'];
  }

  const q = rawQuery.trim().toLowerCase();
  const num = Number.parseInt(q, 10);
  const entry = !Number.isNaN(num)
    ? SHOP_CATALOG.find((e) => e.num === num)
    : SHOP_CATALOG.find((e) => e.id === q || e.label.toLowerCase().includes(q));

  if (!entry) {
    return ['Unknown shop item. Type "shop" to list numbered items.'];
  }

  let cost = applyInflation(entry.cost, state);
  if (entry.id === 'repair') {
    if (pc.armorTier <= 0 || pc.armorMaxTier <= 0) {
      return [`${pc.name} has no repairable armor (ruined armor below Tier 1 cannot be repaired).`];
    }
    if (pc.armorTier >= pc.armorMaxTier) {
      return [`${pc.name}'s armor is already at its original Tier ${pc.armorMaxTier}.`];
    }
    cost = applyInflation(pc.armorTier === 1 ? 25 : 40, state);
  }

  if (pc.silver < cost) {
    return [`${pc.name} lacks silver (needs ${cost}s, has ${pc.silver}s).`];
  }

  const needsSlot =
    entry.id === 'lard' ||
    entry.id === 'medicine' ||
    entry.id === 'shield' ||
    entry.id === 'bear_trap' ||
    entry.id === 'red_poison';
  if (needsSlot && !canCarryMoreItems(pc)) {
    return [`${pc.name} cannot carry any more items (at hard limit ${pc.carryingCapacity * 2}; use "drop <#>").`];
  }

  pc.silver -= cost;
  if (entry.id === 'food') {
    pc.foodDays += 1;
    return [`${pc.name} buys 1 day of dried food for ${cost}s (${pc.silver}s left).`];
  }
  if (entry.id === 'water') {
    pc.waterDays += 4;
    return [`${pc.name} refills waterskin (+4d water) for ${cost}s (${pc.silver}s left).`];
  }
  if (entry.id === 'lard') {
    pc.foodDays += 5;
    pc.inventory.push({ id: `shop_lard_${Date.now()}`, name: 'Lard (5 meals)', kind: 'food' });
    return [`${pc.name} buys Lard (+5 food days) for ${cost}s (${pc.silver}s left).`];
  }
  if (entry.id === 'medicine') {
    const uses = Math.max(1, pc.abilities.presence + 4);
    pc.inventory.push({ id: `shop_med_${Date.now()}`, name: 'Medicine box', kind: 'medicine', uses });
    return [`${pc.name} buys a Medicine box (${uses} uses) for ${cost}s (${pc.silver}s left).`];
  }
  if (entry.id === 'shield') {
    pc.hasShield = true;
    pc.inventory.push({ id: `shop_shield_${Date.now()}`, name: 'Shield (-1 HP dmg or break)', kind: 'shield' });
    return [`${pc.name} buys a Shield for ${cost}s (${pc.silver}s left).`];
  }
  if (entry.id === 'backpack') {
    pc.carryingCapacity += 7;
    pc.containerName = pc.containerName === 'Nothing' ? 'Backpack' : `${pc.containerName} + Backpack`;
    return [`${pc.name} buys a Backpack (+7 capacity -> ${pc.carryingCapacity}) for ${cost}s.`];
  }
  if (entry.id === 'sack') {
    pc.carryingCapacity += 10;
    pc.containerName = pc.containerName === 'Nothing' ? 'Sack' : `${pc.containerName} + Sack`;
    return [`${pc.name} buys a Sack (+10 capacity -> ${pc.carryingCapacity}) for ${cost}s.`];
  }
  if (entry.id === 'bear_trap') {
    pc.inventory.push({ id: `shop_trap_${Date.now()}`, name: 'Bear trap (d8 dmg)', kind: 'gear' });
    return [`${pc.name} buys a Bear trap for ${cost}s (${pc.silver}s left).`];
  }
  if (entry.id === 'red_poison') {
    pc.inventory.push({ id: `shop_poison_${Date.now()}`, name: 'Bottle of red poison', kind: 'poison', uses: 3 });
    return [`${pc.name} buys Red Poison (3 doses) for ${cost}s (${pc.silver}s left).`];
  }
  if (entry.id === 'sword' || entry.id === 'flail' || entry.id === 'crossbow' || entry.id === 'zweihander') {
    const wDef = world.weaponsById[entry.id];
    if (pc.weapon && pc.weapon.id !== 'unarmed' && canCarryMoreItems(pc)) {
      pc.inventory.push({
        id: `old_wpn_${Date.now()}`,
        name: `Backup: ${pc.weapon.name} (${pc.weapon.damageDie})`,
        kind: 'gear',
      });
    }
    pc.weapon = { ...wDef };
    pc.weaponBroken = false;
    if (wDef.ranged) {
      pc.ammo += 10;
    }
    return [`${pc.name} buys ${wDef.name} (${wDef.damageDie}) for ${cost}s (${pc.silver}s left).`];
  }
  if (entry.id === 'ammo') {
    pc.ammo += 10;
    return [`${pc.name} buys 10 arrows/bolts for ${cost}s (ammo: ${pc.ammo}).`];
  }
  if (entry.id === 'armor_1' || entry.id === 'armor_2' || entry.id === 'armor_3') {
    const tier = Number.parseInt(entry.id.slice(-1), 10) as ArmorTier;
    const armDef = world.armorsByTier[tier];
    pc.armorTier = tier;
    pc.armorMaxTier = tier;
    pc.armorName = armDef.name;
    return [`${pc.name} dons ${armDef.name} (Tier ${tier}) for ${cost}s (${pc.silver}s left).`];
  }
  if (entry.id === 'repair') {
    pc.armorTier = Math.min(pc.armorMaxTier, (pc.armorTier + 1) as ArmorTier) as ArmorTier;
    const armDef = world.armorsByTier[pc.armorTier];
    pc.armorName = armDef?.name ?? pc.armorName;
    return [`${pc.name} repairs armor back to Tier ${pc.armorTier} for ${cost}s (${pc.silver}s left).`];
  }
  if (entry.id === 'hospice') {
    const heal = rollDie(6, state);
    const prev = pc.hp;
    pc.hp = Math.min(pc.maxHp, pc.hp + heal);
    pc.dizzyHours = 0;
    return [`${pc.name} recovers in the hospice for ${cost}s: +${pc.hp - prev} HP (${pc.hp}/${pc.maxHp}).`];
  }

  return [`Bought ${entry.label} for ${cost}s.`];
}
