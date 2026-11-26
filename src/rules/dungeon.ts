import type { WorldDatabase } from '../db/loader.ts';
import type {
  DungeonRoom,
  DungeonRoomRole,
  DungeonState,
  GameState,
  RoomInteractable,
} from '../types.ts';
import { rollDie } from '../dice.ts';
import { triggerSpecificOrRandomMisery } from './calendar.ts';

interface RoomBlueprint {
  id: number;
  role: DungeonRoomRole;
  label: string;
  exits: number[];
  x: number;
  y: number;
  lockedByKey?: boolean;
  secretHidden?: boolean;
  requiresNoHeavyArmor?: boolean;
  noiseAlerts?: boolean;
}

const TEMPLATE_15: RoomBlueprint[] = [
  { id: 0, role: 'entrance', label: 'Entrance', exits: [1, 2], x: 1, y: 0 },
  { id: 1, role: 'dining_hall', label: 'Dining Hall', exits: [0, 3, 5], x: 0, y: 1, noiseAlerts: true },
  { id: 2, role: 'library', label: 'Library & Sleeping Quarters', exits: [0, 3], x: 2, y: 1, noiseAlerts: true },
  { id: 3, role: 'guard_post', label: 'Guard Room', exits: [1, 2, 4, 7], x: 2, y: 2 },
  { id: 4, role: 'cells', label: 'The Cells', exits: [3, 5], x: 1, y: 2, noiseAlerts: true },
  { id: 5, role: 'corridor', label: 'Painting Corridor', exits: [1, 4, 6], x: 0, y: 2 },
  { id: 6, role: 'pump_room', label: 'Pump Chamber', exits: [5, 8, 14], x: 0, y: 3 },
  { id: 7, role: 'chain_room', label: 'Chain Room', exits: [3, 8, 11], x: 2, y: 3, noiseAlerts: true },
  { id: 8, role: 'hazard_rim', label: 'Abyssal Rim', exits: [6, 7, 9, 11, 14], x: 1, y: 3 },
  { id: 9, role: 'tight_tunnel', label: 'Tight Crawlway', exits: [8, 10], x: 0, y: 4, requiresNoHeavyArmor: true },
  { id: 10, role: 'rival_sanctuary', label: 'Hidden Sanctuary', exits: [9], x: 0, y: 5 },
  { id: 11, role: 'puzzle_statue', label: 'Statue Chamber', exits: [7, 8, 12, 13], x: 2, y: 4 },
  { id: 12, role: 'locked_vault', label: 'Sealed Inner Vault', exits: [11], x: 3, y: 4, secretHidden: true },
  { id: 13, role: 'debris_room', label: 'Debris & Bone Chute', exits: [11, 14], x: 2, y: 5, lockedByKey: true },
  { id: 14, role: 'boss_lair', label: 'Forge & Slaughterhouse', exits: [6, 8, 13], x: 1, y: 5 },
];

const TEMPLATE_13: RoomBlueprint[] = [
  { id: 0, role: 'entrance', label: 'Entrance', exits: [1, 2], x: 1, y: 0 },
  { id: 1, role: 'dining_hall', label: 'Feast Hall', exits: [0, 3, 4], x: 0, y: 1, noiseAlerts: true },
  { id: 2, role: 'library', label: 'Scriptorium', exits: [0, 3], x: 2, y: 1, noiseAlerts: true },
  { id: 3, role: 'guard_post', label: 'Watch Post', exits: [1, 2, 6], x: 2, y: 2 },
  { id: 4, role: 'corridor', label: 'Gallery Corridor', exits: [1, 5], x: 0, y: 2 },
  { id: 5, role: 'pump_room', label: 'Cistern Pump', exits: [4, 7, 12], x: 0, y: 3 },
  { id: 6, role: 'cells', label: 'Holding Cages', exits: [3, 7, 9], x: 2, y: 3, noiseAlerts: true },
  { id: 7, role: 'hazard_rim', label: 'Cavern Brink', exits: [5, 6, 8, 9, 12], x: 1, y: 3 },
  { id: 8, role: 'tight_tunnel', label: 'Narrow Squeeze', exits: [7, 10], x: 0, y: 4, requiresNoHeavyArmor: true },
  { id: 10, role: 'rival_sanctuary', label: 'Overgrown Cellar', exits: [8], x: 0, y: 5 },
  { id: 9, role: 'puzzle_statue', label: 'Idol Hall', exits: [6, 7, 11, 12], x: 2, y: 4 },
  { id: 11, role: 'locked_vault', label: 'Secret Sanctum', exits: [9], x: 3, y: 4, secretHidden: true },
  { id: 12, role: 'boss_lair', label: 'Altar Slaughterhouse', exits: [5, 7, 9], x: 1, y: 5 },
];

const TEMPLATE_12: RoomBlueprint[] = [
  { id: 0, role: 'entrance', label: 'Threshold', exits: [1, 2], x: 1, y: 0 },
  { id: 1, role: 'library', label: 'Ash Archive', exits: [0, 3, 4], x: 0, y: 1, noiseAlerts: true },
  { id: 2, role: 'guard_post', label: 'Guard Niche', exits: [0, 3, 5], x: 2, y: 1 },
  { id: 3, role: 'corridor', label: 'Trapped Hall', exits: [1, 2, 6], x: 1, y: 2 },
  { id: 4, role: 'pump_room', label: 'Sump Room', exits: [1, 6, 11], x: 0, y: 2 },
  { id: 5, role: 'chain_room', label: 'Hooked Vault', exits: [2, 6, 9], x: 2, y: 2, noiseAlerts: true },
  { id: 6, role: 'hazard_rim', label: 'Sludge Brink', exits: [3, 4, 5, 7, 9, 11], x: 1, y: 3 },
  { id: 7, role: 'tight_tunnel', label: 'Cramped Duct', exits: [6, 8], x: 0, y: 3, requiresNoHeavyArmor: true },
  { id: 8, role: 'rival_sanctuary', label: 'Cult Camp', exits: [7], x: 0, y: 4 },
  { id: 9, role: 'puzzle_statue', label: 'Socket Shrine', exits: [5, 6, 10, 11], x: 2, y: 3 },
  { id: 10, role: 'locked_vault', label: 'Hidden Reliquary', exits: [9], x: 3, y: 3, secretHidden: true },
  { id: 11, role: 'boss_lair', label: 'Deepest Hearth', exits: [4, 6, 9], x: 1, y: 4 },
];

// Fix index renumbering in TEMPLATE_13 (ensure contiguous 0..12)
function normalizeTemplate(bp: RoomBlueprint[]): RoomBlueprint[] {
  const idMap = new Map<number, number>();
  const sorted = [...bp].sort((a, b) => a.id - b.id);
  sorted.forEach((r, idx) => idMap.set(r.id, idx));
  return sorted.map((r, idx) => ({
    ...r,
    id: idx,
    exits: r.exits.map((e) => idMap.get(e) ?? e),
  }));
}

export function generateProceduralDungeon(
  state: GameState,
  world: WorldDatabase,
): { dungeon: DungeonState; logs: string[] } {
  const logs: string[] = [];
  const t = world.dungeonTables;
  const c = world.campaigns;

  const name = state.activeContract?.dungeonName || (() => {
    const a = t.nameFirst[rollDie(t.nameFirst.length, state) - 1];
    const b = t.nameSecond[rollDie(t.nameSecond.length, state) - 1];
    return `The ${a} ${b}`;
  })();

  const statusRoll = rollDie(6, state);
  let status = 'Still active';
  if (statusRoll >= 3) {
    const reasonRoll = rollDie(4, state);
    const reason = t.inactiveReasons[reasonRoll - 1];
    if (reasonRoll === 4) {
      const misery = triggerSpecificOrRandomMisery(state, world);
      status = `Inactive (${reason}: ${misery.code})`;
      logs.push(`Dungeon generation triggered Misery ${misery.code}: ${misery.text}`);
    } else {
      status = `Inactive (${reason})`;
    }
  }

  const imminentDanger = t.imminentDangers[rollDie(t.imminentDangers.length, state) - 1];
  const dwellers = t.dwellers[rollDie(t.dwellers.length, state) - 1];
  const distinctiveFeature = t.distinctiveFeatures[rollDie(t.distinctiveFeatures.length, state) - 1];

  const hazard = c.centralHazards[rollDie(c.centralHazards.length, state) - 1];
  const rival = c.rivalFactions[rollDie(c.rivalFactions.length, state) - 1];
  const statue = c.puzzleStatues[rollDie(c.puzzleStatues.length, state) - 1];
  const bossEntry = c.bosses[rollDie(c.bosses.length, state) - 1];
  const bossDef = world.creaturesById[bossEntry.id] ?? world.creaturesById.cannibal_warlock;

  const templates = [TEMPLATE_15, TEMPLATE_13, TEMPLATE_12];
  const rawBp = templates[rollDie(templates.length, state) - 1];
  const blueprints = normalizeTemplate(rawBp);

  const guardRoom = blueprints.find((b) => b.role === 'guard_post');
  const guardRoomId = guardRoom ? guardRoom.id : null;

  const rooms: DungeonRoom[] = blueprints.map((bp) => {
    const interactables: RoomInteractable[] = [];
    let feature = t.sampleRooms[rollDie(t.sampleRooms.length, state) - 1];
    let trap: string | null = null;
    let corpsesRemaining = rollDie(4, state) === 1 ? 1 : 0;
    const enemyIds: string[] = [];

    if (bp.role === 'entrance') {
      feature = 'Stale smell; a lit oil lantern sways over a trickle of black water where pale-violet moths flap haplessly.';
      interactables.push({ id: `int_${bp.id}_1`, kind: 'butterflies', label: 'Eat the black-violet moths/butterflies (+d6 HP)', used: false });
    } else if (bp.role === 'dining_hall') {
      feature = 'Warm and rotten-smelling; a twenty-chair wooden table sits set with empty mugs while a grey-skinned, catatonic elder stares into space.';
      interactables.push({ id: `int_${bp.id}_1`, kind: 'feast_table', label: 'Seat the party at the table with the silent elder', used: false });
    } else if (bp.role === 'library') {
      feature = 'Cool, smoky air; frantic unknown script fills towering shelves beside a clay vase of withered flowers and three motionless skeletons.';
      interactables.push({ id: `int_${bp.id}_1`, kind: 'bookshelf', label: 'Study the frenzied books closely (d4)', used: false });
    } else if (bp.role === 'guard_post') {
      feature = 'Blazing hearth and greasy stools; memory-cursed guards gnaw bone-scraps beside iron keyrings.';
      const gCount = rollDie(3, state) + 1;
      for (let g = 0; g < gCount; g += 1) enemyIds.push('crooked_guard');
      interactables.push({ id: `int_${bp.id}_1`, kind: 'ransack', label: 'Ransack the guard room crates (d6 x 2)', used: false });
    } else if (bp.role === 'cells') {
      feature = 'Repulsive stench of gore and torn flesh; emaciated mad prisoners press trembling fingers through iron bars.';
      corpsesRemaining = Math.max(1, corpsesRemaining);
      interactables.push({ id: `int_${bp.id}_1`, kind: 'prisoners', label: 'Approach the mad prisoners at the bars', used: false });
    } else if (bp.role === 'corridor') {
      feature = 'Dark and cold; bland landscape paintings line the wall in front of suspiciously angular floor seams.';
      trap = 'Hidden pit-trap beneath bland landscape paintings (drops to crawlway)';
      interactables.push({ id: `int_${bp.id}_1`, kind: 'pit_trap', label: 'Inspect the paintings and floor seams (Presence DR14)', used: false });
    } else if (bp.role === 'pump_room') {
      feature = `Subtle sulfur reek; a rusted hand-pump drips muddy liquid beside an iron floor-hatch above ${bossDef.name}'s lair.`;
      interactables.push({ id: `int_${bp.id}_1`, kind: 'pump', label: 'Drink muddy liquid from the rusty pump (+d4 HP)', used: false });
      interactables.push({ id: `int_${bp.id}_2`, kind: 'hatch', label: 'Descend the rusted hatch stepladder directly below', used: false });
    } else if (bp.role === 'chain_room') {
      feature = 'Dimly lit, weirdly chilly and windy; hooked meat-chains sway over bloody tracks leading nowhere.';
    } else if (bp.role === 'hazard_rim') {
      feature = `${hazard.name}: ${hazard.description} Gems glitter inside the far rock wall.`;
      interactables.push({ id: `int_${bp.id}_1`, kind: 'hazard_cross', label: `Wrench gems & brave ${hazard.name} (${hazard.testAbility.toUpperCase()} DR${hazard.testDr})`, used: false });
    } else if (bp.role === 'tight_tunnel') {
      feature = 'A suffocating crawlway carved through sweating earth—voices hum in minor key from the ceiling. Heavy armor cannot squeeze through.';
    } else if (bp.role === 'rival_sanctuary') {
      feature = `${rival.name}: ${rival.leaderName} sits beside a smoky brazier (${rival.appearance}).`;
      interactables.push({ id: `int_${bp.id}_1`, kind: 'rival_camp', label: `Speak with ${rival.leaderName} or accept ${rival.brewName}`, used: false });
    } else if (bp.role === 'puzzle_statue') {
      feature = `${statue.name}: ${statue.description}`;
      interactables.push({ id: `int_${bp.id}_1`, kind: 'statue_socket', label: `Examine the idol & socket (${statue.socketItemName})`, used: false });
    } else if (bp.role === 'locked_vault') {
      const obj = state.activeContract;
      feature = `Confined torchlit sanctum behind the secret stone door. Inside lies ${obj.targetName}.`;
      interactables.push({ id: `int_${bp.id}_1`, kind: 'objective', label: `Claim / extract ${obj.targetName}`, used: false });
    } else if (bp.role === 'debris_room') {
      feature = 'Very stale and frowst; trash and gnawed bones mound chest-high against a heavy locked door.';
      corpsesRemaining = Math.max(1, corpsesRemaining);
    } else if (bp.role === 'boss_lair') {
      feature = `Sooty and scorching hot beneath ${hazard.name} fumes. ${bossDef.name} rules here amid hanging flesh and twin hearths.`;
      enemyIds.push(bossEntry.id);
    }

    return {
      id: bp.id,
      role: bp.role,
      label: bp.label,
      feature,
      trap,
      trapSpotted: false,
      trapTriggered: false,
      corpsesRemaining,
      visited: bp.id === 0,
      cleared: bp.id === 0,
      exits: bp.exits,
      x: bp.x,
      y: bp.y,
      lockedByKey: Boolean(bp.lockedByKey),
      secretHidden: Boolean(bp.secretHidden),
      requiresNoHeavyArmor: Boolean(bp.requiresNoHeavyArmor),
      noiseAlertsRoomId: bp.noiseAlerts ? guardRoomId : null,
      silenced: false,
      interactables,
      enemyIds,
      encounterRolled: false,
    };
  });

  const dungeon: DungeonState = {
    name,
    status,
    imminentDanger,
    dwellers,
    distinctiveFeature,
    rooms,
    currentRoomId: 0,
    centralHazardId: hazard.id,
    centralHazardName: hazard.name,
    centralHazardDesc: hazard.description,
    centralHazardAbility: hazard.testAbility,
    centralHazardDr: hazard.testDr,
    centralHazardFailDie: hazard.failDamageDie,
    apexEnemyId: hazard.apexCreatureId,
    apexPacified: false,
    bossEnemyId: bossEntry.id,
    bossName: bossDef.name,
    bossKeyName: bossEntry.keyName,
    hasBossKey: false,
    puzzleStatueName: statue.name,
    puzzleStatueDesc: statue.description,
    puzzleSocketItemName: statue.socketItemName,
    puzzleUnlockText: statue.unlockText,
    puzzleSolved: false,
    rivalFactionName: rival.name,
    rivalLeaderName: rival.leaderName,
    rivalLeaderAppearance: rival.appearance,
    rivalAgenda: rival.agenda,
    rivalBrewName: rival.brewName,
    rivalZealotId: rival.zealotCreatureId,
    rivalHostile: false,
    rivalBrewTaken: false,
    guardsAlerted: false,
    tableBTriggered: false,
  };

  // Craft 2 scried Seer prophecies grounded in the generated dungeon (1 true, 1 false/uncertain)
  if (state.activeContract) {
    const truths = [
      `A hidden chamber behind ${statue.name} holds ${state.activeContract.targetName}—seek the ${statue.socketItemName}. (true)`,
      `Something monstrous (${world.creaturesById[hazard.apexCreatureId]?.name ?? 'an apex horror'}) hungers inside ${hazard.name}! (true)`,
      `${rival.leaderName} lurks in a hidden cellar, plotting against ${bossDef.name}. (true)`,
    ];
    const falsehoods = [
      `Toxic fumes leak from every crack in the first hall, driving all who breathe them mad. (false)`,
      `An ancient catatonic man in the feast hall will slit your throats if you sit down. (false)`,
      `The lamps burn with human tallow and none have ever left alive. (uncertain)`,
    ];
    state.activeContract.prophecies = [
      truths[rollDie(truths.length, state) - 1],
      falsehoods[rollDie(falsehoods.length, state) - 1],
    ];
  }

  state.activeDungeon = dungeon;
  logs.unshift(`Generated ${dungeon.name} (${rooms.length} chambers).`);
  return { dungeon, logs };
}

export function generateBedeviledDungeon(
  state: GameState,
  world: WorldDatabase,
): { dungeon: DungeonState; logs: string[] } {
  const res = generateProceduralDungeon(state, world);
  state.mode = 'dungeon';
  state.chronicle.push(`Entered ${res.dungeon.name}.`);
  return res;
}

export function verifyDungeonSolvable(dungeon: DungeonState): boolean {
  const visited = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const room = dungeon.rooms[cur];
    if (!room) continue;
    for (const nextId of room.exits) {
      if (!visited.has(nextId)) {
        visited.add(nextId);
        queue.push(nextId);
      }
    }
  }
  if (visited.size !== dungeon.rooms.length) return false;
  const hasBoss = dungeon.rooms.some((r) => r.role === 'boss_lair');
  const hasVault = dungeon.rooms.some((r) => r.role === 'locked_vault');
  const hasPuzzle = dungeon.rooms.some((r) => r.role === 'puzzle_statue');
  return hasBoss && hasVault && hasPuzzle;
}

export function renderDungeonMap(dungeon: DungeonState): string {
  const cur = dungeon.rooms[dungeon.currentRoomId];
  return [
    `${dungeon.name}`,
    `Location: ${cur.label} — ${cur.feature}`,
    `Exits: ${cur.exits.map((id) => `Room #${id + 1} (${dungeon.rooms[id].label})`).join(', ')}`,
  ].join('\n');
}
