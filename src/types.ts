export type SexId = 'male' | 'female';

export type RaceId = 'vaelorian' | 'ael_thalor' | 'durnfolk' | 'grixi';

export type BackgroundId =
  | 'ashen_blade'
  | 'root_scholar'
  | 'barrow_stalker'
  | 'shrine_penitent';

export type HeirloomId =
  | 'kiln_lantern'
  | 'orin_bell_shard'
  | 'star_dew_vial'
  | 'grixi_chronometer';

export type StatName = 'might' | 'agility' | 'wit' | 'grit';

export interface Stats {
  might: number;
  agility: number;
  wit: number;
  grit: number;
}

export type FactionId = 'iron_vow' | 'silken_cistern' | 'under_warren' | 'husk_choir';

export type StatusType =
  | 'bleeding'
  | 'burned'
  | 'blighted'
  | 'corroded'
  | 'staggered'
  | 'dazed'
  | 'guarded'
  | 'blessed'
  | 'hidden';

export interface StatusEffect {
  type: StatusType;
  turns: number;
  power: number;
}

export type AbilityKind = 'skill' | 'cantrip' | 'spell';

export interface AbilityDef {
  id: string;
  name: string;
  kind: AbilityKind;
  staminaCost: number;
  focusCost: number;
  hpCost?: number;
  stat: StatName;
  baseDamage?: number;
  damageDice?: [number, number];
  healAmount?: number;
  applyEnemyStatus?: StatusEffect;
  applySelfStatus?: StatusEffect;
  restoreStamina?: number;
  restoreFocus?: number;
  pierceArmor?: boolean;
  shatterGuard?: boolean;
  bonusVsDebuffed?: number;
  purgeNegativeStatuses?: boolean;
  description: string;
}

export interface PassiveDef {
  id: string;
  name: string;
  description: string;
}

export interface RaceDef {
  id: RaceId;
  name: string;
  subtitle: string;
  lore: string;
  statMods: Partial<Stats>;
  passive: PassiveDef;
  racialAbilityId: string;
  worldReactions: string;
}

export interface BackgroundDef {
  id: BackgroundId;
  name: string;
  subtitle: string;
  lore: string;
  statMods: Partial<Stats>;
  startingWeaponId: string;
  startingArmorId: string;
  startingTrinketId?: string;
  startingItems: Array<{ id: string; qty: number }>;
  startingCrowns: number;
  startingRations: number;
  startingTorches: number;
  abilityIds: string[];
  passive: PassiveDef;
}

export interface HeirloomDef {
  id: HeirloomId;
  name: string;
  unlockRequirement: string;
  description: string;
  combatDescription: string;
}

export type ItemSlot = 'weapon' | 'armor' | 'trinket' | 'consumable' | 'relic';

export interface ItemDef {
  id: string;
  name: string;
  slot: ItemSlot;
  value: number;
  description: string;
  damageDice?: [number, number];
  bonusDamage?: number;
  statScaling?: StatName;
  armorBonus?: number;
  maxHpBonus?: number;
  maxFocusBonus?: number;
  maxStaminaBonus?: number;
  statBonus?: Partial<Stats>;
  healHp?: number;
  restoreStamina?: number;
  restoreFocus?: number;
  cureNegative?: boolean;
  throwDamage?: number;
  throwStatus?: StatusEffect;
}

export interface InventoryEntry {
  id: string;
  qty: number;
  honed?: boolean;
}

export interface PerkDef {
  id: string;
  name: string;
  description: string;
  statBonus?: Partial<Stats>;
  maxHpBonus?: number;
  maxStaminaBonus?: number;
  maxFocusBonus?: number;
  armorBonus?: number;
  damageBonus?: number;
}

export type EnemyIntentKind = 'attack' | 'heavy' | 'blight' | 'guard' | 'toll';

export interface EnemyIntent {
  kind: EnemyIntentKind;
  label: string;
  damage: number;
  status?: StatusEffect;
  armorGain?: number;
  description: string;
}

export interface EnemyTemplate {
  id: string;
  name: string;
  category: 'husk' | 'beast' | 'humanoid' | 'construct' | 'boss';
  maxHp: number;
  armor: number;
  xpReward: number;
  crownReward: [number, number];
  lootTable: Array<{ itemId: string; chance: number }>;
  isBoss?: boolean;
  isElite?: boolean;
  intents: EnemyIntent[];
  description: string;
}

export interface ActiveEnemy {
  templateId: string;
  name: string;
  category: 'husk' | 'beast' | 'humanoid' | 'construct' | 'boss';
  hp: number;
  maxHp: number;
  baseArmor: number;
  turnArmor: number;
  statuses: StatusEffect[];
  intents: EnemyIntent[];
  nextIntentIndex: number;
  isBoss?: boolean;
  isElite?: boolean;
  xpReward: number;
  crownReward: [number, number];
  lootTable: Array<{ itemId: string; chance: number }>;
}

export interface CombatState {
  enemy: ActiveEnemy;
  round: number;
  heirloomUsedThisFight: boolean;
  guaranteedDodgeThisTurn: boolean;
  counterDamagePending: number;
  bossSealsBroken: string[];
  onVictoryFlag?: string;
  onVictoryChronicle?: { title: string; summary: string; tag: string };
  canFlee: boolean;
  log: string[];
}

export interface ChronicleEntry {
  day: number;
  locationId: string;
  title: string;
  summary: string;
  tag: string;
}

export interface WorldMemory {
  flags: Record<string, boolean | number | string>;
  factions: Record<FactionId, number>;
  chronicle: ChronicleEntry[];
}

export interface PlayerCharacter {
  name: string;
  sex: SexId;
  race: RaceId;
  background: BackgroundId;
  heirloom: HeirloomId;
  level: number;
  xp: number;
  xpToNext: number;
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  focus: number;
  maxFocus: number;
  baseStats: Stats;
  weaponId: string;
  weaponHoned: boolean;
  armorId: string;
  trinketId: string | null;
  inventory: InventoryEntry[];
  abilities: string[];
  perks: string[];
  crowns: number;
  rations: number;
  torches: number;
  statuses: StatusEffect[];
  determinationAvailable: boolean;
}

export interface ChoiceOption {
  id: string;
  label: string;
  tag?: string;
  visible?: (state: GameState) => boolean;
  enabled?: (state: GameState) => { ok: boolean; reason?: string };
  resolve: (state: GameState) => ActionOutcome;
}

export interface EventCard {
  id: string;
  title: string;
  locations: string[];
  minDay?: number;
  maxDay?: number;
  weight?: number;
  condition?: (state: GameState) => boolean;
  prompt: (state: GameState) => string;
  choices: ChoiceOption[];
}

export interface LocationAction {
  id: string;
  label: string;
  tag?: string;
  visible?: (state: GameState) => boolean;
  resolve: (state: GameState) => ActionOutcome;
}

export interface ShopListing {
  itemId: string;
  price: number;
  underWarrenOnly?: boolean;
  stockKey?: string;
}

export interface LocationNode {
  id: string;
  name: string;
  regionType: 'settlement' | 'road' | 'ruin' | 'sanctuary' | 'belfry';
  danger: number;
  dark?: boolean;
  neighbors: string[];
  asciiPos: { row: number; col: number; code: string };
  description: (state: GameState) => string;
  actions: LocationAction[];
  shop?: {
    name: string;
    keeper: string;
    greeting: (state: GameState) => string;
    items: ShopListing[];
  };
}

export type SceneMode =
  | 'location'
  | 'event'
  | 'combat'
  | 'shop'
  | 'level_up'
  | 'ending'
  | 'dead';

export interface ActiveEventState {
  eventId: string;
  resolved: boolean;
  resolutionText?: string;
}

export interface ActionOutcome {
  messages: string[];
  startCombat?: {
    enemyId: string;
    canFlee?: boolean;
    onVictoryFlag?: string;
    onVictoryChronicle?: { title: string; summary: string; tag: string };
    preDamageRatio?: number;
    brokenSeals?: string[];
  };
  triggerEnding?: {
    endingId: 'shatter_belfry' | 'rekindle_kiln' | 'ascend_warden';
    title: string;
    openingText: string;
  };
  advanceDay?: number;
  stayInEvent?: boolean;
}

export interface MetaProfile {
  runsPlayed: number;
  victories: number;
  unlockedHeirlooms: HeirloomId[];
  bestDayReached: number;
  history: Array<{
    name: string;
    race: RaceId;
    background: BackgroundId;
    sex: SexId;
    outcome: 'victory' | 'death';
    day: number;
    level: number;
    endingTitle?: string;
  }>;
}

export interface GameState {
  runId: string;
  day: number;
  maxDays: number;
  stealthMode: boolean;
  player: PlayerCharacter;
  locationId: string;
  visitedLocations: string[];
  seenEvents: string[];
  memory: WorldMemory;
  scene: SceneMode;
  activeEvent: ActiveEventState | null;
  combat: CombatState | null;
  pendingPerkIds: string[];
  endingSummary: string | null;
  lastMessages: string[];
  rngState?: number;
}
