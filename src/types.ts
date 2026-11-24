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

export type SurvivalMode = 'scarred' | 'ironman';

export type StatName = 'might' | 'agility' | 'wit' | 'grit';

export interface Stats {
  might: number;
  agility: number;
  wit: number;
  grit: number;
}

export type DamageType =
  | 'slashing'
  | 'piercing'
  | 'bludgeoning'
  | 'fire'
  | 'cold'
  | 'lightning'
  | 'acid'
  | 'poison'
  | 'blight'
  | 'resonant';

export type ResistanceLevel = 'immune' | 'resistant' | 'neutral' | 'vulnerable';

export type DamageProfile = Partial<Record<DamageType, ResistanceLevel>>;

export type TimePeriod =
  | 'dawn'
  | 'morning'
  | 'midday'
  | 'dusk'
  | 'night'
  | 'midnight';

export type WeatherId =
  | 'clear'
  | 'ash_rain'
  | 'spore_fog'
  | 'biting_wind'
  | 'dead_still';

export type PaleShiftId =
  | 'none'
  | 'blood_ash_moon'
  | 'silent_bells'
  | 'root_bloom'
  | 'iron_frost';

export type LunarPhaseId =
  | 'new_moon'
  | 'waxing_moon'
  | 'full_moon'
  | 'waning_moon';

export type CreatureCategory =
  | 'animal'
  | 'beast'
  | 'humanoid'
  | 'orc_kin'
  | 'husk'
  | 'undead'
  | 'construct'
  | 'demonic'
  | 'lunar'
  | 'boss';

export interface WorldClock {
  day: number;
  hour: number; // 0..23
  totalHours: number;
  weather: WeatherId;
  weatherHoursLeft: number;
  lunarPhase: LunarPhaseId;
  lunarCycleDay: number; // 0..11 (3 days per phase)
  paleShift: PaleShiftId;
  paleShiftDaysLeft: number;
}

export type FactionId = 'iron_vow' | 'silken_cistern' | 'under_warren' | 'husk_choir';

export type StatusType =
  | 'bleeding'
  | 'burned'
  | 'blighted'
  | 'poisoned'
  | 'chilled'
  | 'shocked'
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

export type BodySlot =
  | 'eyes'
  | 'skin'
  | 'face'
  | 'chest'
  | 'arms'
  | 'hands'
  | 'legs'
  | 'blood';

export type BodyModKind = 'mutation' | 'surgery' | 'implant';

export interface BodyModDef {
  id: string;
  name: string;
  kind: BodyModKind;
  slot: BodySlot;
  defilementLoad: number;
  description: string;
  bonusSummary: string;
  drawbackSummary: string;
  statMods?: Partial<Stats>;
  maxHpMod?: number;
  maxStaminaMod?: number;
  maxFocusMod?: number;
  maxResolveMod?: number;
  armorMod?: number;
  resistances?: DamageProfile;
  grantedAbilityId?: string;
  anatomyOverlay: {
    field:
      | 'faceDetail'
      | 'chestTorsoDetail'
      | 'armsHandsDetail'
      | 'legsStanceDetail'
      | 'distinguishingMark';
    appendText: string;
    eyeColorOverride?: string;
    skinColorOverride?: string;
  };
  addedTags: string[];
  excisionScar: string;
}

export interface InjuryDef {
  id: string;
  name: string;
  severity: 'minor' | 'severe';
  description: string;
  statPenalty?: Partial<Stats>;
  maxHpPenalty?: number;
  maxStaminaPenalty?: number;
  maxResolvePenalty?: number;
  healDc: number;
  scarOnHeal: string;
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

export type ActionCost = 'main' | 'swift' | 'free';

export type RollMode = 'normal' | 'edge' | 'burden';

export interface AbilityDef {
  id: string;
  name: string;
  kind: AbilityKind;
  actionCost?: ActionCost;
  damageType?: DamageType;
  resolveDamage?: number;
  nonLethal?: boolean;
  staminaCost: number;
  focusCost: number;
  hpCost?: number;
  stat: StatName;
  baseDamage?: number;
  damageDice?: [number, number];
  healAmount?: number;
  restoreResolve?: number;
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
  resistances?: DamageProfile;
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

export type EquipSlot = 'mainHand' | 'offHand' | 'armor' | 'cloak' | 'trinket';

export type ItemSlot =
  | 'mainHand'
  | 'offHand'
  | 'armor'
  | 'cloak'
  | 'trinket'
  | 'consumable'
  | 'draught'
  | 'coating'
  | 'ash_text'
  | 'relic'
  | 'reagent';

export type WeaponTrait =
  | 'twoHanded'
  | 'subdueBonus'
  | 'armorPiercing'
  | 'finesse'
  | 'lightSource'
  | 'catalyst';

export type ArmorTier = 0 | 1 | 2 | 3;

export interface ItemDef {
  id: string;
  name: string;
  slot: ItemSlot;
  value: number;
  description: string;
  actionCost?: ActionCost;
  twoHanded?: boolean;
  armorTier?: ArmorTier;
  traits?: WeaponTrait[];
  visibleTags?: string[];
  grantedAbilityId?: string;
  damageType?: DamageType;
  damageDice?: [number, number];
  bonusDamage?: number;
  statScaling?: StatName;
  armorBonus?: number;
  resistances?: DamageProfile;
  maxHpBonus?: number;
  maxFocusBonus?: number;
  maxStaminaBonus?: number;
  maxResolveBonus?: number;
  statBonus?: Partial<Stats>;
  healHp?: number;
  restoreStamina?: number;
  restoreFocus?: number;
  restoreResolve?: number;
  cureNegative?: boolean;
  tendsInjury?: boolean;
  grantsBodyModId?: string;
  throwDamage?: number;
  throwDamageType?: DamageType;
  throwStatus?: StatusEffect;
  coatingDamageType?: DamageType;
  coatingBonusDamage?: number;
  coatingCharges?: number;
  draughtDefilement?: number;
  draughtPurgeDefilement?: number;
  draughtStatus?: StatusEffect;
  ashTextDc?: number;
  ashTextEffect?: 'blight_wave' | 'star_ward' | 'bone_shatter' | 'ash_step';
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
  maxResolveBonus?: number;
  armorBonus?: number;
  damageBonus?: number;
  extraMainActions?: number;
  extraSwiftActions?: number;
  swiftItems?: boolean;
}

export type EnemyIntentKind = 'attack' | 'heavy' | 'blight' | 'guard' | 'toll';

export interface EnemyIntent {
  kind: EnemyIntentKind;
  label: string;
  damage: number;
  damageType: DamageType;
  resolveDamage?: number;
  defilementGain?: number;
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
  category: CreatureCategory;
  maxHp: number;
  armor: number;
  stats: Stats;
  resistances?: DamageProfile;
  visibleGear: EnemyVisibleGear;
  anatomy: AnatomyProfile;
  firstSightProse: string;
  returnSightProse: string;
  xpReward: number;
  crownReward: [number, number];
  lootTable: Array<{ itemId: string; chance: number }>;
  harvestItemId?: string;
  harvestModId?: string;
  interrogateHint?: string;
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
  category: CreatureCategory;
  hp: number;
  maxHp: number;
  baseArmor: number;
  turnArmor: number;
  stats: Stats;
  resistances: DamageProfile;
  visibleGear: EnemyVisibleGear;
  appraisalTier: 0 | 1 | 2;
  identified: boolean;
  defeatedState?: 'alive' | 'downed' | 'killed';
  lastHitDamageType?: DamageType;
  lastHitOverkill?: number;
  statuses: StatusEffect[];
  intents: EnemyIntent[];
  nextIntentIndex: number;
  isBoss?: boolean;
  isElite?: boolean;
  xpReward: number;
  crownReward: [number, number];
  lootTable: Array<{ itemId: string; chance: number }>;
}

export interface DownedEnemyEntry {
  templateId: string;
  displayName: string;
  category: CreatureCategory;
  questioned: boolean;
  stripped: boolean;
  resolved: boolean;
}

export interface AftermathState {
  downedEnemies: DownedEnemyEntry[];
  activeIndex: number;
  victorySummary: string[];
}

export interface CampState {
  fireLit: boolean;
  hoursCamped: number;
  tendedThisCamp: boolean;
  foragedThisCamp: boolean;
}

export type CombatSubMenu = 'root' | 'skills' | 'spells' | 'items' | 'target';

export interface CombatState {
  enemies: ActiveEnemy[];
  subMenu: CombatSubMenu;
  pendingActionId: string | null;
  observedUsedThisRound: boolean;
  round: number;
  mainLeft: number;
  swiftLeft: number;
  freeLeft: number;
  graceMaxDamagePending: boolean;
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
  bodyMods: Partial<Record<BodySlot, string>>;
  injuries: string[];
  level: number;
  xp: number;
  xpToNext: number;
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  focus: number;
  maxFocus: number;
  resolve: number;
  maxResolve: number;
  defilement: number; // 0..100
  baseStats: Stats;
  equipment: Record<EquipSlot, string | null>;
  weaponHoned: boolean;
  weaponCoating: {
    name: string;
    damageType: DamageType;
    bonusDamage: number;
    charges: number;
  } | null;
  armorTierCurrent: ArmorTier;
  reserves: number;
  maxReserves: number;
  grace: number;
  maxGrace: number;
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
  periods?: TimePeriod[];
  weathers?: WeatherId[];
  minDefilement?: number;
  maxDefilement?: number;
  requiredTags?: string[];
  repeatable?: boolean;
  cooldownHours?: number;
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

export interface SecretSubAreaDef {
  id: string;
  parentAreaId: string;
  name: string;
  description: string;
  dangerBonus: number;
}

export type ExploreEncounterKind =
  | 'enemy'
  | 'merchant'
  | 'item'
  | 'landscape'
  | 'curiosity'
  | 'nothing'
  | 'unlock_area'
  | 'unlock_town'
  | 'unlock_sub_area'
  | 'unlock_dungeon';

export interface ExploreEncounterDef {
  id: string;
  scopeType: 'camp_hub' | 'area' | 'sub_area';
  scopeId: string;
  kind: ExploreEncounterKind;
  weight: number;
  label: string;
  prose: string;
  enemyIds?: string[];
  itemId?: string;
  crownsMin?: number;
  crownsMax?: number;
  targetUnlockId?: string;
  shop?: {
    name: string;
    keeper: string;
    items: ShopListing[];
  };
}

export interface DungeonExitDef {
  id: string;
  fromRoomId: string;
  toRoomId: string;
  label: string;
  lockedBySwitchId?: string;
  lockedByItemId?: string;
}

export interface DungeonRoomDef {
  id: string;
  dungeonId: string;
  name: string;
  row: number;
  col: number;
  roomType: 'entry' | 'corridor' | 'chamber' | 'vault' | 'shrine' | 'boss';
  description: string;
  enemyIds?: string[];
  lootItemId?: string;
  crowns?: number;
  trapDc?: number;
  trapDamage?: number;
  switchId?: string;
  switchLabel?: string;
  isBoss?: boolean;
  exits: DungeonExitDef[];
}

export interface DungeonDef {
  id: string;
  parentAreaId: string;
  name: string;
  description: string;
  entryRoomId: string;
  danger: number;
  rooms: Record<string, DungeonRoomDef>;
}

export interface DungeonRuntimeState {
  dungeonId: string;
  currentRoomId: string;
  visitedRooms: string[];
  clearedRooms: string[];
  openedDoors: string[];
  pulledSwitches: string[];
  lootedRooms: string[];
  disarmedTraps: string[];
}

export interface FrontierState {
  unlockedAreas: string[];
  unlockedTowns: string[];
  unlockedSubAreas: string[];
  unlockedDungeons: string[];
  activeSubArea: Record<string, string | null>;
  stash: InventoryEntry[];
  dungeonStates: Record<string, DungeonRuntimeState>;
  activeDungeonId: string | null;
}

export interface LocationNode {
  id: string;
  name: string;
  regionType: 'town' | 'special' | 'area';
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
  | 'camp_hub'
  | 'location'
  | 'dungeon'
  | 'camp'
  | 'event'
  | 'combat'
  | 'aftermath'
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
  | 'stash'
  | 'stash_put'
  | 'stash_take'
  | 'pack'
  | 'pack_use'
  | 'pack_equip'
  | 'pack_craft'
  | 'pack_mods';

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
  advanceHours?: number;
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
  survivalMode: SurvivalMode;
  clock: WorldClock;
  day: number;
  stealthMode: boolean;
  player: PlayerCharacter;
  locationId: string;
  visitedLocations: string[];
  seenEvents: string[];
  eventCooldowns: Record<string, number>;
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
  aftermath: AftermathState | null;
  camp: CampState | null;
  frontier: FrontierState;
  activeMerchant: { name: string; keeper: string; items: ShopListing[] } | null;
  pendingPerkIds: string[];
  endingSummary: string | null;
  lastMessages: string[];
  rngState?: number;
}
