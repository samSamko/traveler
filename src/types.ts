export type AbilityName = 'agility' | 'presence' | 'strength' | 'toughness';

export type ClassId =
  | 'classless'
  | 'fanged_deserter'
  | 'gutterborn_scum'
  | 'esoteric_hermit'
  | 'wretched_royalty'
  | 'heretical_priest'
  | 'occult_herbmaster';

export type CharacterStatus = 'alive' | 'broken' | 'dead';

export type ArmorTier = 0 | 1 | 2 | 3;

export type CalendarDie = 100 | 20 | 10 | 6 | 2;

export type GameMode = 'exploration' | 'dungeon' | 'combat' | 'game_over';

export interface WeaponDef {
  id: string;
  tableRoll: number | null;
  name: string;
  damageDie: string;
  ranged: boolean;
  twoHanded: boolean;
  silver: number;
}

export interface ArmorDef {
  tier: ArmorTier;
  tableRoll: number;
  name: string;
  reductionDie: string | null;
  agilityDrPenalty: number;
  defenceDrPenalty: number;
  silver: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  kind: 'gear' | 'unclean_scroll' | 'sacred_scroll' | 'medicine' | 'poison' | 'treasure' | 'food' | 'beast' | 'shield' | 'relic' | 'decoction';
  uses?: number;
  notes?: string;
  scrollKind?: 'unclean' | 'sacred';
  scrollRoll?: number;
  proteanScroll?: boolean;
}

export interface CharacterTraits {
  terrible: [string, string];
  brokenBody: string;
  badHabit: string;
  troublingTale: string;
  origin: string;
}

export interface Character {
  id: string;
  name: string;
  classId: ClassId;
  className: string;
  abilities: Record<AbilityName, number>;
  hp: number;
  maxHp: number;
  status: CharacterStatus;
  brokenNote: string | null;
  omens: number;
  omenDie: number;
  powersRemaining: number;
  powersMaxToday: number;
  dizzyHours: number;
  silver: number;
  weapon: WeaponDef;
  weaponBroken: boolean;
  ammo: number;
  armorTier: ArmorTier;
  armorMaxTier: ArmorTier;
  armorName: string;
  stashedArmorTier?: ArmorTier;
  stashedArmorName?: string;
  hasShield: boolean;
  containerName: string;
  carryingCapacity: number;
  inventory: InventoryItem[];
  foodDays: number;
  waterDays: number;
  daysWithoutFood: number;
  infected: boolean;
  traits: CharacterTraits;
  classFeatures: string[];
  arcaneCatastrophes: number[];
  notes: string[];
  creationRolls?: Record<string, string>;
}

export interface OutcastFollower {
  id: string;
  archetypeId: string;
  name: string;
  hp: number;
  maxHp: number;
  morale: number;
  armorName: string;
  weaponName: string;
  trait: string;
  specialty: string;
  values: string;
  status: 'alive' | 'fled' | 'dead';
}

export interface PartyState {
  rolledSizeDie: number;
  members: Character[];
  followers: OutcastFollower[];
  activePcIndex: number;
}

export interface CalendarState {
  die: CalendarDie;
  day: number;
  hour: number;
  triggeredMiseries: string[];
  worldEnded: boolean;
}

export type DungeonRoomRole =
  | 'entrance'
  | 'dining_hall'
  | 'library'
  | 'guard_post'
  | 'cells'
  | 'corridor'
  | 'pump_room'
  | 'chain_room'
  | 'hazard_rim'
  | 'tight_tunnel'
  | 'rival_sanctuary'
  | 'puzzle_statue'
  | 'locked_vault'
  | 'debris_room'
  | 'boss_lair';

export interface RoomInteractable {
  id: string;
  kind:
    | 'butterflies'
    | 'feast_table'
    | 'bookshelf'
    | 'ransack'
    | 'prisoners'
    | 'pit_trap'
    | 'pump'
    | 'hatch'
    | 'hazard_cross'
    | 'statue_socket'
    | 'objective'
    | 'rival_camp'
    | 'sarcophagus'
    | 'bazaar'
    | 'spirit';
  label: string;
  used: boolean;
}

export interface DungeonRoom {
  id: number;
  role: DungeonRoomRole;
  label: string;
  feature: string;
  trap: string | null;
  trapSpotted: boolean;
  trapTriggered: boolean;
  corpsesRemaining: number;
  visited: boolean;
  cleared: boolean;
  exits: number[];
  x: number;
  y: number;
  lockedByKey?: boolean;
  secretHidden?: boolean;
  requiresNoHeavyArmor?: boolean;
  noiseAlertsRoomId?: number | null;
  silenced?: boolean;
  interactables: RoomInteractable[];
  enemyIds: string[];
  encounterRolled?: boolean;
}

export interface DungeonState {
  name: string;
  status: string;
  imminentDanger: string;
  dwellers: string;
  distinctiveFeature: string;
  rooms: DungeonRoom[];
  currentRoomId: number;
  centralHazardId: string;
  centralHazardName: string;
  centralHazardDesc: string;
  centralHazardAbility: AbilityName;
  centralHazardDr: number;
  centralHazardFailDie: string;
  apexEnemyId: string;
  apexPacified: boolean;
  bossEnemyId: string;
  bossName: string;
  bossKeyName: string;
  hasBossKey: boolean;
  puzzleStatueName: string;
  puzzleStatueDesc: string;
  puzzleSocketItemName: string;
  puzzleUnlockText: string;
  puzzleSolved: boolean;
  rivalFactionName: string;
  rivalLeaderName: string;
  rivalLeaderAppearance: string;
  rivalAgenda: string;
  rivalBrewName: string;
  rivalZealotId: string;
  rivalHostile: boolean;
  rivalBrewTaken: boolean;
  guardsAlerted: boolean;
  tableBTriggered: boolean;
}

export interface CombatEnemy {
  instanceId: string;
  creatureId: string;
  name: string;
  hp: number;
  maxHp: number;
  morale: number | null;
  armorTier: ArmorTier;
  armorDie: string | null;
  attackName: string;
  damageDie: string;
  attackDr: number;
  defenceDr: number;
  attacksPerRound: number;
  special: string;
  bounty: string;
  status: 'active' | 'fled' | 'surrendered' | 'dead';
  moraleCheckedHalf: boolean;
  isLeader: boolean;
  invisibleRounds?: number;
}

export interface CombatState {
  round: number;
  initiativeSide: 'pcs' | 'enemies';
  turnOrderPcIds: string[];
  activeTurnIdx: number;
  enemies: CombatEnemy[];
  ambush: boolean;
  log: string[];
}

export interface OpeningHook {
  regionId: string;
  regionName: string;
  where: string;
  who: string;
  spark: string;
  weather: string;
  rolls?: {
    where: number;
    weather: number;
    who: number;
    spark: number;
  };
}

export interface ActiveContract {
  contractNumber: number;
  patronName: string;
  patronHook: string;
  objectiveId: string;
  objectiveKind: 'rescue_heir' | 'slay_boss' | 'steal_relic' | 'sabotage';
  objectiveTitle: string;
  targetName: string;
  objectiveBrief: string;
  refusesLeave: boolean;
  dungeonName: string;
  rewardSilver: number;
  prophecies: [string, string];
  phase: 'briefing' | 'travel' | 'dungeon';
  travelLegsRemaining: number;
  objectiveSecured: boolean;
  bossSlain: boolean;
  shopVisited: boolean;
}

export interface ChoiceOption {
  label: string;
  actionId: string;
  targetId?: string | number;
  requiresRoll?: boolean;
  isTraitChoice?: boolean;
}

export interface GameState {
  version: number;
  mode: GameMode;
  rngState: number;
  party: PartyState;
  calendar: CalendarState;
  hook: OpeningHook;
  currentRegionId: string;
  currentRegionName: string;
  currentWeather: string;
  activeContract: ActiveContract;
  activeDungeon: DungeonState | null;
  activeCombat: CombatState | null;
  chronicle: string[];
  lastEvents: string[];
  pendingNarration: string;
  pendingChoices: string[];
  pendingChoiceOptions: ChoiceOption[];
  recentProseIds: string[];
  dailyBugEatenDay?: number;
  gameOverReason: string | null;
}

export interface MetaRunRecord {
  date: string;
  outcome: 'apocalypse' | 'tpk' | 'abandoned';
  dayReached: number;
  miseriesTriggered: number;
  survivors: string[];
  fallen: string[];
}

export interface MetaProfile {
  runsPlayed: number;
  apocalypses: number;
  bestDayReached: number;
  history: MetaRunRecord[];
}
