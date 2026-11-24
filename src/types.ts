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

export interface AnatomyProfile {
  height: string;
  weight: string;
  skinColor: string;
  hairLength: string;
  hairStyle: string;
  hairColor: string;
  eyeShape: string;
  eyeColor: string;
  musculature: string;
  bodyShape: string;
  facialScars: string;
  bodyScars: string;
  faceDetail: string;
  chestTorsoDetail: string;
  armsHandsDetail: string;
  legsStanceDetail: string;
  distinguishingMark: string;
  visibleTags: string[];
}

export interface AppearanceSelections {
  height: string;
  weight: string;
  skinColor: string;
  hairLength: string;
  hairStyle: string;
  hairColor: string;
  eyeShape: string;
  eyeColor: string;
  musculature: string;
  bodyShape: string;
  facialScars: string;
  bodyScars: string;
  distinguishingMark: string;
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
  isAoE?: boolean;
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

export type ItemSlot = 'weapon' | 'armor' | 'trinket' | 'consumable' | 'relic' | 'reagent';

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

export interface RecipeDef {
  id: string;
  name: string;
  outputItemId: string;
  outputQty: number;
  ingredients: Array<{ itemId: string; qty: number }>;
  grixiOrScholarOnly?: boolean;
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

export interface EnemyVisibleGear {
  weapon: string;
  armor: string;
  hiddenDetail: string;
}

export interface EnemyTemplate {
  id: string;
  name: string;
  unidentifiedName: string;
  category: 'husk' | 'beast' | 'humanoid' | 'construct' | 'boss';
  maxHp: number;
  armor: number;
  stats: Stats;
  visibleGear: EnemyVisibleGear;
  anatomy: AnatomyProfile;
  firstSightProse: string;
  returnSightProse: string;
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
  unidentifiedName: string;
  suffix: string;
  category: 'husk' | 'beast' | 'humanoid' | 'construct' | 'boss';
  hp: number;
  maxHp: number;
  baseArmor: number;
  turnArmor: number;
  stats: Stats;
  visibleGear: EnemyVisibleGear;
  appraisalTier: 0 | 1 | 2;
  identified: boolean;
  statuses: StatusEffect[];
  intents: EnemyIntent[];
  nextIntentIndex: number;
  isBoss?: boolean;
  isElite?: boolean;
  xpReward: number;
  crownReward: [number, number];
  lootTable: Array<{ itemId: string; chance: number }>;
}

export type CombatSubMenu = 'root' | 'skills' | 'spells' | 'items' | 'target';

export interface CombatState {
  enemies: ActiveEnemy[];
  subMenu: CombatSubMenu;
  pendingActionId: string | null;
  observedUsedThisRound: boolean;
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

export interface EnemyDiscoveryRecord {
  seen: boolean;
  identified: boolean;
  appraisalTier: 0 | 1 | 2;
  observedAttacks: string[];
}

export interface EntityDiscoveryState {
  knownPlaces: string[];
  knownNpcs: string[];
  knownItems: string[];
  knownEnemies: Record<string, EnemyDiscoveryRecord>;
}

export interface EntityLink {
  from: string;
  relation: string;
  to: string;
  note: string;
}

export interface PlayerCharacter {
  name: string;
  sex: SexId;
  race: RaceId;
  background: BackgroundId;
  heirloom: HeirloomId;
  anatomy: AnatomyProfile;
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
  visible?: (state: GameState) => boolean;
  resolve: (state: GameState) => ActionOutcome;
}

export interface DialogueTopic {
  id: string;
  label: string;
  visible?: (state: GameState) => boolean;
  resolve: (state: GameState) => ActionOutcome;
}

export interface NpcNode {
  id: string;
  name: string;
  unidentifiedLabel: string;
  shortLabel: string;
  visible?: (state: GameState) => boolean;
  firstSightProse: (state: GameState) => string;
  greeting: (state: GameState) => string;
  anatomy: AnatomyProfile;
  topics: DialogueTopic[];
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
  firstSightProse: (state: GameState) => string;
  description: (state: GameState) => string;
  sensorySummary: string;
  actions: LocationAction[];
  npcs?: NpcNode[];
  shop?: {
    name: string;
    keeper: string;
    greeting: (state: GameState) => string;
    items: ShopListing[];
  };
}

export type SceneMode =
  | 'intro'
  | 'location'
  | 'event'
  | 'combat'
  | 'shop'
  | 'journal'
  | 'level_up'
  | 'ending'
  | 'dead';

export type LocationSubMenu =
  | 'root'
  | 'explore'
  | 'talk'
  | 'dialogue'
  | 'travel'
  | 'pack'
  | 'pack_use'
  | 'pack_equip'
  | 'pack_craft';

export type JournalTab =
  | 'root'
  | 'self'
  | 'arts'
  | 'bestiary'
  | 'people'
  | 'places'
  | 'items'
  | 'chronicle';

export interface ActiveEventState {
  eventId: string;
  resolved: boolean;
  resolutionText?: string;
}

export interface ActionOutcome {
  messages: string[];
  startCombat?: {
    enemyId?: string;
    enemyIds?: string[];
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
  stayInDialogue?: boolean;
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
  discovery: EntityDiscoveryState;
  scene: SceneMode;
  subMenu: LocationSubMenu;
  introBeat: number;
  journalTab: JournalTab;
  journalDetailId: string | null;
  journalReturn: { scene: SceneMode; subMenu: LocationSubMenu } | null;
  activeNpcId: string | null;
  activeEvent: ActiveEventState | null;
  combat: CombatState | null;
  pendingPerkIds: string[];
  endingSummary: string | null;
  lastMessages: string[];
  rngState?: number;
}
