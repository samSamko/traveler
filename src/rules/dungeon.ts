import type { WorldDatabase } from '../db/loader.ts';
import type {
  ContractSize,
  DungeonRoom,
  DungeonRoomRole,
  DungeonState,
  GameState,
  RoomInteractable,
} from '../types.ts';
import { rollDie } from '../dice.ts';
import { triggerSpecificOrRandomMisery } from './calendar.ts';
import { DUNGEON_RIDDLES } from '../gm/narration.ts';

interface SynthesizedNode {
  id: number;
  role: DungeonRoomRole;
  depth: number;
  floor: number;
  exits: Set<number>;
  lockedByKey?: boolean;
  secretHidden?: boolean;
  requiresNoHeavyArmor?: boolean;
  noiseAlerts?: boolean;
}

export function rollContractSize(contractNumber: number, rng: { rngState: number }): ContractSize {
  const r = rollDie(20, rng);
  if (contractNumber <= 1) {
    if (r <= 7) return 'small';
    if (r <= 18) return 'medium';
    return 'large';
  }
  if (r <= 4) return 'small';
  if (r <= 13) return 'medium';
  return 'large';
}

export function rollContractRewards(
  size: ContractSize,
  rng: { rngState: number },
): { rewardSilver: number; travelLegsRemaining: number } {
  if (size === 'small') {
    return { rewardSilver: (rollDie(6, rng) + 5) * 10, travelLegsRemaining: 1 };
  }
  if (size === 'large') {
    return { rewardSilver: (rollDie(7, rng) + 10) * 20, travelLegsRemaining: 2 };
  }
  return { rewardSilver: (rollDie(5, rng) + 5) * 20, travelLegsRemaining: rollDie(2, rng) };
}

const ROLE_LABELS: Record<DungeonRoomRole, string[]> = {
  entrance: ['Entrance', 'Sunken Threshold', 'Moth-Lit Mouth', 'Collapsed Stairwell', 'Flooded Vestibule'],
  dining_hall: ['Dining Hall', 'Feast Hall', 'Rotted Banqueting Room', 'Tallow Refectory', 'Fly-Blown Hall'],
  library: ['Library & Scriptorium', 'Ash Archive', 'Whispering Stacks', 'Moldering Scriptorium', 'Chained Ledger-Room'],
  guard_post: ['Guard Room', 'Watch Post', 'Key-Warden Barracks', 'Bone-Dice Sentry', 'Sooty Kennel-Post'],
  cells: ['The Cells', 'Holding Cages', 'Weeping Oubliettes', 'Iron-Barred Pits', 'Chain-Lock Gaol'],
  corridor: ['Painting Corridor', 'Gallery Corridor', 'Angular Passage', 'Frescoed Hallway', 'Tilted Flagstone Run'],
  pump_room: ['Pump Chamber', 'Cistern Pump', 'Sump & Hatch', 'Boiler Wheelroom', 'Bilge Crank-Vault'],
  chain_room: ['Chain Room', 'Hooked Vault', 'Slaughter Chains', 'Rusted Pulley Loft', 'Meat-Hook Crossing'],
  hazard_rim: ['Abyssal Rim', 'Cavern Brink', 'Hazard Overlook', 'Slick Stone Ledge', 'Fume-Wreathed Brink'],
  tight_tunnel: ['Tight Crawlway', 'Narrow Squeeze', 'Sweating Duct', 'Root-Choked Burrow', 'Rib-Scraping Bore'],
  rival_sanctuary: ['Hidden Sanctuary', 'Overgrown Cellar', 'Cult Alcove', 'Greenhouse Hollow', 'Smuggler Crawl-Camp'],
  puzzle_statue: ['Statue Chamber', 'Idol Hall', 'Cipher Shrine', 'Basilisk Rotunda', 'Sunken Reliquary Gate'],
  locked_vault: ['Sealed Inner Vault', 'Secret Sanctum', 'Hidden Reliquary', 'Blind-Masonry Cache', 'Whispering Vault'],
  debris_room: ['Debris & Bone Chute', 'Collapsed Sump', 'Rubble Hall', 'Midden Pit', 'Shattered Pillar-Dump'],
  boss_lair: ['Forge & Slaughterhouse', 'Altar Slaughterhouse', 'Deepest Hearth', 'Soot Throne-Pit', 'Blood-Anvil Sanctum'],
  ritual_sanctum: ['Blackened Ritual Sanctum', 'Foul Consecration Hall', 'Bloody Nave', 'Sacrificial Chancel', 'Candle-Choked Apse'],
  ossuary: ['Charred Ossuary', 'Marrow Catacomb', 'Stacked-Skull Vault', 'Limestone Bone-Trench', 'Ashen Crypt-Shelf'],
  shrine: ['Desecrated Shrine', 'Two-Headed Chapel', 'Soot-Stained Altar', 'Weeping Icon Niche', 'Brazier Oratory'],
  trap_gallery: ['Trapped Antechamber', 'Needle & Wire Gallery', 'Snare Corridor', 'Brass-Slit Gauntlet', 'Greased Flagstone Way'],
  stairwell_down: ['Descending Stairwell', 'Spiral Bone-Stairs', 'Flooded Mine-Shaft', 'Slick Basalt Steps'],
};

function pickFrom<T>(list: T[], state: GameState): T {
  return list[rollDie(list.length, state) - 1];
}

function addUndirectedEdge(nodes: SynthesizedNode[], a: number, b: number): void {
  if (a === b) return;
  nodes[a].exits.add(b);
  nodes[b].exits.add(a);
}

export function pickDwellerCreatureIds(dwellersText: string): string[] {
  const lower = dwellersText.toLowerCase();
  if (lower.includes('animated suits') || lower.includes('goblins')) return ['goblin', 'skeleton', 'berserker'];
  if (lower.includes('lich')) return ['lich', 'skeleton', 'slumbering_skeleton', 'wraith'];
  if (lower.includes('possessed') || lower.includes('cult') || lower.includes('courtiers')) return ['cult_zealot', 'zombie', 'undead_doll'];
  if (lower.includes('porcelain dolls')) return ['undead_doll', 'wraith'];
  if (lower.includes('thieves')) return ['scum', 'bounty_hunter'];
  if (lower.includes('slime') || lower.includes('spider')) return ['nesting_death', 'troll'];
  if (lower.includes('wickheads')) return ['wickhead', 'zombie'];
  if (lower.includes('bark-witch')) return ['goblin', 'mongrel', 'wyvern'];
  if (lower.includes('gremlins')) return ['dusk_gnoum', 'goblin'];
  if (lower.includes('tergol')) return ['grotesque', 'berserker'];
  if (lower.includes('beetles')) return ['mongrel', 'zombie'];
  return ['crooked_guard', 'berserker'];
}

function canReachRequiredNodes(
  nodes: SynthesizedNode[],
  blockedNodeId: number,
): boolean {
  const visited = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nextId of nodes[cur].exits) {
      if (nextId === blockedNodeId) continue;
      if (nodes[nextId].secretHidden) continue;
      if (!visited.has(nextId)) {
        visited.add(nextId);
        queue.push(nextId);
      }
    }
  }
  return nodes.every((n) => {
    if (n.id === blockedNodeId || n.secretHidden) return true;
    return visited.has(n.id);
  });
}

function shuffleRoles(pool: DungeonRoomRole[], state: GameState): DungeonRoomRole[] {
  const out = [...pool];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = rollDie(i + 1, state) - 1;
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function connectStandardTree(
  nodes: SynthesizedNode[],
  rootId: number,
  standardNodes: SynthesizedNode[],
  state: GameState,
): void {
  const connected = new Set<number>([rootId]);
  const sorted = [...standardNodes]
    .filter((n) => n.id !== rootId)
    .sort((a, b) => a.depth - b.depth);

  for (const node of sorted) {
    const eligible = [...connected].map((id) => nodes[id]).filter((p) => p.depth < node.depth);
    const fallback = [...connected].map((id) => nodes[id]);
    const parent = pickFrom(eligible.length > 0 ? eligible : fallback, state);
    addUndirectedEdge(nodes, parent.id, node.id);
    connected.add(node.id);
  }
}

function addLoopEdges(
  nodes: SynthesizedNode[],
  pool: SynthesizedNode[],
  loopTarget: number,
  state: GameState,
): void {
  let attempts = 0;
  let added = 0;
  while (added < loopTarget && attempts < 24 && pool.length >= 2) {
    attempts += 1;
    const a = pickFrom(pool, state);
    const b = pickFrom(pool, state);
    if (a.id === b.id || a.exits.has(b.id)) continue;
    if (Math.abs(a.depth - b.depth) <= 1 && !(a.id === 0 && b.role === 'boss_lair')) {
      addUndirectedEdge(nodes, a.id, b.id);
      added += 1;
    }
  }
}

function synthesizeDungeonGraph(state: GameState, size: ContractSize): SynthesizedNode[] {
  const objectiveKind = state.activeContract?.objectiveKind ?? 'steal_relic';

  const depthForRole = (role: DungeonRoomRole): number => {
    if (role === 'entrance') return 0;
    if (role === 'dining_hall' || role === 'library' || role === 'corridor' || role === 'shrine' || role === 'debris_room') return 1;
    if (role === 'guard_post' || role === 'cells' || role === 'pump_room' || role === 'chain_room' || role === 'hazard_rim' || role === 'trap_gallery') return 2;
    if (role === 'tight_tunnel' || role === 'puzzle_statue' || role === 'boss_lair' || role === 'ritual_sanctum' || role === 'ossuary' || role === 'stairwell_down') return 3;
    return 4;
  };

  if (size === 'large') {
    const targetCount = 15 + rollDie(5, state); // 16–20 rooms across 2 floors
    const f1Count = Math.floor(targetCount / 2); // 8–10 on Floor 1
    const f2Count = targetCount - f1Count; // 8–10 on Floor 2

    const f1Roles: DungeonRoomRole[] = ['entrance', 'guard_post', 'stairwell_down'];
    const f1Filler = shuffleRoles(
      ['dining_hall', 'library', 'cells', 'corridor', 'shrine', 'ossuary', 'chain_room', 'trap_gallery', 'debris_room'],
      state,
    );
    for (const r of f1Filler) {
      if (f1Roles.length >= f1Count) break;
      if (!f1Roles.includes(r)) f1Roles.push(r);
    }
    while (f1Roles.length < f1Count) {
      f1Roles.push(pickFrom(['corridor', 'chain_room', 'ossuary', 'trap_gallery'], state));
    }

    const f2HubRole = pickFrom<DungeonRoomRole>(['corridor', 'pump_room', 'chain_room'], state);
    const f2Roles: DungeonRoomRole[] = [
      f2HubRole,
      'hazard_rim',
      'tight_tunnel',
      'puzzle_statue',
      'locked_vault',
      'boss_lair',
      'rival_sanctuary',
    ];
    if (objectiveKind === 'sabotage') f2Roles.push('ritual_sanctum');
    if (objectiveKind === 'slay_boss' && f2HubRole !== 'pump_room') f2Roles.push('pump_room');
    const f2Filler = shuffleRoles(['ossuary', 'shrine', 'trap_gallery', 'debris_room', 'cells', 'chain_room'], state);
    for (const r of f2Filler) {
      if (f2Roles.length >= f2Count) break;
      if (!f2Roles.includes(r)) f2Roles.push(r);
    }
    while (f2Roles.length < f2Count) {
      f2Roles.push(pickFrom(['corridor', 'ossuary', 'trap_gallery', 'debris_room'], state));
    }

    const nodes: SynthesizedNode[] = [];
    f1Roles.forEach((role) => {
      nodes.push({
        id: nodes.length,
        role,
        depth: depthForRole(role),
        floor: 1,
        exits: new Set<number>(),
        noiseAlerts: role === 'dining_hall' || role === 'library' || role === 'cells' || role === 'chain_room',
      });
    });
    const f2StartId = nodes.length;
    f2Roles.forEach((role, idx) => {
      nodes.push({
        id: nodes.length,
        role,
        depth: idx === 0 ? 0 : depthForRole(role),
        floor: 2,
        exits: new Set<number>(),
        secretHidden: role === 'locked_vault',
        requiresNoHeavyArmor: role === 'tight_tunnel',
        noiseAlerts: role === 'chain_room' || role === 'cells',
      });
    });

    const f1Nodes = nodes.filter((n) => n.floor === 1);
    if (f1Nodes.filter((n) => n.depth === 1).length < 2) {
      const cand = f1Nodes.find((n) => n.depth === 2 && n.role !== 'stairwell_down');
      if (cand) cand.depth = 1;
    }
    connectStandardTree(nodes, 0, f1Nodes, state);
    addLoopEdges(nodes, f1Nodes, 2, state);

    const stairNode = f1Nodes.find((n) => n.role === 'stairwell_down')!;
    const f2Hub = nodes[f2StartId];
    addUndirectedEdge(nodes, stairNode.id, f2Hub.id);

    const f2Nodes = nodes.filter((n) => n.floor === 2);
    const f2Vault = f2Nodes.find((n) => n.role === 'locked_vault')!;
    const f2Puzzle = f2Nodes.find((n) => n.role === 'puzzle_statue')!;
    const f2Rim = f2Nodes.find((n) => n.role === 'hazard_rim')!;
    const f2Tunnel = f2Nodes.find((n) => n.role === 'tight_tunnel')!;
    const f2Rival = f2Nodes.find((n) => n.role === 'rival_sanctuary');
    const f2Standard = f2Nodes.filter((n) => n !== f2Vault && n !== f2Tunnel && n !== f2Rival);

    connectStandardTree(nodes, f2Hub.id, f2Standard, state);
    addUndirectedEdge(nodes, f2Rim.id, f2Tunnel.id);
    if (f2Rival) addUndirectedEdge(nodes, f2Tunnel.id, f2Rival.id);
    addUndirectedEdge(nodes, f2Puzzle.id, f2Vault.id);
    addLoopEdges(nodes, f2Standard, 2, state);

    const lockCand = nodes.find(
      (n) =>
        (n.role === 'debris_room' || n.role === 'ossuary' || n.role === 'chain_room') &&
        n.id !== f2Hub.id &&
        canReachRequiredNodes(nodes, n.id),
    );
    if (lockCand) lockCand.lockedByKey = true;

    return nodes;
  }

  // Small (4–6 rooms, 1 floor) or Medium (10–14 rooms, 1 floor)
  const rawSmall = 3 + rollDie(3, state);
  const targetCount =
    size === 'small'
      ? objectiveKind === 'sabotage'
        ? Math.max(5, rawSmall)
        : rawSmall
      : 9 + rollDie(5, state);

  const roles: DungeonRoomRole[] =
    size === 'small'
      ? ['entrance', 'puzzle_statue', 'locked_vault', 'boss_lair']
      : ['entrance', 'guard_post', 'hazard_rim', 'tight_tunnel', 'puzzle_statue', 'locked_vault', 'boss_lair'];

  if (objectiveKind === 'sabotage') roles.push('ritual_sanctum');
  if (objectiveKind === 'slay_boss' && size !== 'small') roles.push('pump_room');

  const fillerPool: DungeonRoomRole[] =
    size === 'small'
      ? ['guard_post', 'hazard_rim', 'dining_hall', 'library', 'cells', 'corridor', 'chain_room', 'ossuary', 'shrine', 'trap_gallery', 'debris_room']
      : ['dining_hall', 'library', 'cells', 'corridor', 'pump_room', 'chain_room', 'debris_room', 'rival_sanctuary', 'ossuary', 'shrine', 'trap_gallery'];

  for (const r of shuffleRoles(fillerPool, state)) {
    if (roles.length >= targetCount) break;
    if (!roles.includes(r)) roles.push(r);
  }
  while (roles.length < targetCount) {
    roles.push(pickFrom(['corridor', 'ossuary', 'chain_room', 'trap_gallery', 'shrine'], state));
  }

  const nodes: SynthesizedNode[] = roles.map((role, id) => ({
    id,
    role,
    depth: depthForRole(role),
    floor: 1,
    exits: new Set<number>(),
    secretHidden: role === 'locked_vault',
    requiresNoHeavyArmor: role === 'tight_tunnel',
    noiseAlerts: role === 'dining_hall' || role === 'library' || role === 'cells' || role === 'chain_room',
  }));

  if (nodes.filter((n) => n.depth === 1).length < 2) {
    const candidate = nodes.find((n) => n.depth >= 2 && n.role !== 'hazard_rim' && n.role !== 'locked_vault');
    if (candidate) candidate.depth = 1;
  }

  const byRole = (r: DungeonRoomRole) => nodes.find((n) => n.role === r);
  const rim = byRole('hazard_rim');
  const tunnel = byRole('tight_tunnel');
  const puzzle = byRole('puzzle_statue')!;
  const vault = byRole('locked_vault')!;
  const rival = byRole('rival_sanctuary');

  const standard = nodes.filter((n) => n !== vault && n !== rival && n !== tunnel);
  connectStandardTree(nodes, 0, standard, state);

  if (tunnel) {
    const anchor = rim ?? pickFrom(standard.filter((n) => n.id !== 0), state);
    addUndirectedEdge(nodes, anchor.id, tunnel.id);
    if (rival) addUndirectedEdge(nodes, tunnel.id, rival.id);
  }
  addUndirectedEdge(nodes, puzzle.id, vault.id);

  const loopTarget = size === 'small' ? 1 : 2 + rollDie(3, state) - 1;
  addLoopEdges(nodes, standard, loopTarget, state);

  if (size !== 'small') {
    const lockCandidate = nodes.find(
      (n) =>
        (n.role === 'debris_room' || n.role === 'ossuary' || n.role === 'chain_room') &&
        canReachRequiredNodes(nodes, n.id),
    );
    if (lockCandidate) lockCandidate.lockedByKey = true;
  }

  return nodes;
}

export function generateProceduralDungeon(
  state: GameState,
  world: WorldDatabase,
): { dungeon: DungeonState; logs: string[] } {
  const logs: string[] = [];
  const t = world.dungeonTables;
  const c = world.campaigns;

  const name = state.activeContract?.dungeonName || (() => {
    const a = pickFrom(t.nameFirst, state);
    const b = pickFrom(t.nameSecond, state);
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

  const imminentDanger = pickFrom(t.imminentDangers, state);
  const dwellers = pickFrom(t.dwellers, state);
  const distinctiveFeature = pickFrom(t.distinctiveFeatures, state);

  const REGION_HAZARDS: Record<string, string[]> = {
    kergus: ['glacier_crevasse', 'bone_chasm', 'mercury_pit'],
    bergen_chrypt: ['glacier_crevasse', 'bone_chasm', 'mercury_pit'],
    sarkash: ['root_maw', 'plague_cistern', 'rotblack_sludge'],
    allians: ['ash_kiln', 'bone_chasm', 'mercury_pit'],
    valley_of_unfortunate_undead: ['ash_kiln', 'bone_chasm', 'mercury_pit'],
    lake_ondra: ['blood_cistern', 'bell_chasm', 'plague_cistern'],
    wästland: ['blood_cistern', 'bell_chasm', 'plague_cistern'],
    galgenbeck: ['rotblack_sludge', 'sulfuric_tar_vats', 'plague_cistern', 'bell_chasm'],
    graven_tosk: ['rotblack_sludge', 'sulfuric_tar_vats', 'root_maw'],
    tveland: ['bone_chasm', 'bell_chasm', 'ash_kiln'],
  };
  const REGION_BOSSES: Record<string, string[]> = {
    kergus: ['frost_matriarch', 'bone_margrave'],
    bergen_chrypt: ['frost_matriarch', 'bone_margrave'],
    sarkash: ['root_hierophant', 'cannibal_warlock'],
    allians: ['glass_cult_archon', 'bone_margrave', 'blood_inquisitor'],
    valley_of_unfortunate_undead: ['bone_margrave', 'blood_inquisitor'],
    lake_ondra: ['salt_drowned_captain', 'plague_alchemist'],
    wästland: ['salt_drowned_captain', 'plague_alchemist'],
    galgenbeck: ['cannibal_warlock', 'plague_alchemist', 'blood_inquisitor', 'glass_cult_archon'],
    graven_tosk: ['root_hierophant', 'cannibal_warlock', 'plague_alchemist'],
    tveland: ['blood_inquisitor', 'bone_margrave'],
  };

  const regionHazIds = REGION_HAZARDS[state.currentRegionId] ?? [];
  const matchingHazards = c.centralHazards.filter((h) => regionHazIds.includes(h.id));
  const hazard =
    matchingHazards.length > 0 && rollDie(2, state) === 1
      ? pickFrom(matchingHazards, state)
      : pickFrom(c.centralHazards, state);

  const rival = pickFrom(c.rivalFactions, state);
  const statue = pickFrom(c.puzzleStatues, state);

  const regionBossIds = REGION_BOSSES[state.currentRegionId] ?? [];
  const matchingBosses = c.bosses.filter((b) => regionBossIds.includes(b.id));
  const bossEntry =
    matchingBosses.length > 0 && rollDie(2, state) === 1
      ? pickFrom(matchingBosses, state)
      : pickFrom(c.bosses, state);

  const bossDef = world.creaturesById[bossEntry.id] ?? world.creaturesById.cannibal_warlock;
  const dwellerCreatures = pickDwellerCreatureIds(dwellers);

  const puzzleRoll = rollDie(5, state);
  const puzzleKind: DungeonState['puzzleKind'] =
    puzzleRoll === 1
      ? 'socket_statue'
      : puzzleRoll === 2
        ? 'inscription_cipher'
        : puzzleRoll === 3
          ? 'blood_altar'
          : puzzleRoll === 4
            ? 'riddle_door'
            : 'offering_scale';
  const riddleIndex = rollDie(DUNGEON_RIDDLES.length, state) - 1;
  const contractSize = state.activeContract?.contractSize ?? 'medium';
  const floors = contractSize === 'large' ? 2 : 1;

  const nodes = synthesizeDungeonGraph(state, contractSize);
  const guardRoom = nodes.find((n) => n.role === 'guard_post');
  const guardRoomId = guardRoom ? guardRoom.id : null;

  const GRAFFITI_LINES = [
    `Chalked wildly into damp mortar: "DO NOT CROSS ${hazard.name.toUpperCase()} WITHOUT STEADY NERVES — ${bossDef.name.toUpperCase()} WATCHES."`,
    `Carved with a broken tooth: "The idol by ${statue.name} lies in half-truths. Count every skull before pulling silver."`,
    `Fresh blood smears spell one crooked warning: "Kill the master first — the thing beneath the dark still sleeps if its leash breaks."`,
    `Ragged charcoal tallies cover the plaster — seventy-four strokes, ending mid-scratch beside a dried handprint.`,
    `Scratched deep into soot: "No armor through the narrow burrow! Leave iron behind or die stuck in the clay."`,
    `A desperate pilgrim's verse: "Silence saves throats near the kitchen. The guards hear iron clatter from two halls away."`,
  ];

  const gridWidth = 4;
  const rooms: DungeonRoom[] = nodes.map((bp) => {
    const interactables: RoomInteractable[] = [];
    const sampleFlavor = pickFrom(t.sampleRooms, state);
    const trapFlavor = pickFrom(t.trapsAndDevilry, state);
    let feature = `${sampleFlavor}. ${bp.id % 3 === 1 ? distinctiveFeature : `Faint traces of ${dwellers.toLowerCase()} mark the stone.`}`;
    let trap: string | null = null;
    let corpsesRemaining = rollDie(4, state) === 1 ? 1 : 0;
    const enemyIds: string[] = [];

    if (bp.role === 'entrance') {
      const entVar = rollDie(4, state);
      if (entVar === 1) {
        feature = `Stale air stirs beneath a swaying oil lantern (${sampleFlavor.toLowerCase()}). Pale-violet moths flap over black water; signs of "${dwellers.toLowerCase()}" lead inward.`;
        interactables.push({ id: `int_${bp.id}_1`, kind: 'butterflies', label: 'Eat the black-violet moths/butterflies (+d6 HP)', used: false });
      } else if (entVar === 2) {
        feature = `Rainwater trickles down cracked steps into a cracked stone basin (${sampleFlavor.toLowerCase()}). Chalk arrows warn of ${dwellers.toLowerCase()}.`;
        interactables.push({ id: `int_${bp.id}_1`, kind: 'pump', label: 'Cup and drink cold rainwater from the threshold basin (+d4 HP)', used: false });
      } else if (entVar === 3) {
        feature = `A half-collapsed gatehouse smells of wet ash (${sampleFlavor.toLowerCase()}). A pilgrim's corpse slumps beside a shattered wax shrine.`;
        corpsesRemaining = 1;
        interactables.push({ id: `int_${bp.id}_1`, kind: 'shrine_offering', label: 'Leave 10s or pray at the threshold shrine (Presence DR12)', used: false });
      } else {
        feature = `Iron rungs descend into slick gloom (${sampleFlavor.toLowerCase()}); scavengers scratched frantic notes across the doorframe beside dead moths.`;
        interactables.push({ id: `int_${bp.id}_1`, kind: 'ossuary_loot', label: 'Search the scavenger bones piled at the entrance (d6)', used: false });
      }
    } else if (bp.role === 'dining_hall') {
      const dhVar = rollDie(3, state);
      feature =
        dhVar === 1
          ? `Warm and rotten-smelling (${sampleFlavor.toLowerCase()}); a twenty-chair table is set with empty mugs while a grey-skinned catatonic elder stares at the wall.`
          : dhVar === 2
            ? `Guttering tallow stubs drip across a tilted oak trestle (${sampleFlavor.toLowerCase()}); a silent toothless elder clutches a cracked pewter spoon.`
            : `Tattered wedding banners rot above cracked benches (${sampleFlavor.toLowerCase()}), where a motionless elder blinks slowly beside congealed stew.`;
      interactables.push({ id: `int_${bp.id}_1`, kind: 'feast_table', label: 'Seat the party at the table with the silent elder', used: false });
    } else if (bp.role === 'library') {
      const libVar = rollDie(3, state);
      feature =
        libVar === 1
          ? `Cool, smoky air (${sampleFlavor.toLowerCase()}); frantic unknown script fills towering shelves beside a clay vase and three motionless skeletons.`
          : libVar === 2
            ? `Sodden vellum pages carpet the floor (${sampleFlavor.toLowerCase()}); chained brass folios rattle faintly beside slumped scribes.`
            : `Charred scrolls line iron pigeonholes (${sampleFlavor.toLowerCase()}); black ink still seeps down the spine of a crooked lectern.`;
      interactables.push({ id: `int_${bp.id}_1`, kind: 'bookshelf', label: 'Study the frenzied books closely (d4)', used: false });
    } else if (bp.role === 'guard_post') {
      feature = `Blazing hearth and greasy stools (${sampleFlavor.toLowerCase()}); cursed watchmen gnaw bone-scraps beside iron keyrings.`;
      const gCount = rollDie(2, state) + 1;
      for (let g = 0; g < gCount; g += 1) {
        enemyIds.push(g === 0 ? 'crooked_guard' : pickFrom(dwellerCreatures, state));
      }
      interactables.push({ id: `int_${bp.id}_1`, kind: 'ransack', label: 'Ransack the guard room crates (d6 x 2)', used: false });
    } else if (bp.role === 'cells') {
      const cellVar = rollDie(3, state);
      feature =
        cellVar === 1
          ? `Repulsive stench of gore (${sampleFlavor.toLowerCase()}); emaciated mad prisoners press trembling fingers through iron bars.`
          : cellVar === 2
            ? `Rusting oubliette grates rattle underfoot (${sampleFlavor.toLowerCase()}); hollow-eyed captives whisper feverish secrets from the dark.`
            : `Splintered cages hang two feet off wet stone (${sampleFlavor.toLowerCase()}), choked with straw, teeth, and frantic hands.`;
      corpsesRemaining = Math.max(1, corpsesRemaining);
      if (rollDie(2, state) === 1) {
        enemyIds.push('mad_prisoner');
      }
      interactables.push({ id: `int_${bp.id}_1`, kind: 'prisoners', label: 'Approach the mad prisoners at the bars', used: false });
    } else if (bp.role === 'corridor') {
      const corVar = rollDie(3, state);
      feature =
        corVar === 1
          ? `Dark and cold (${sampleFlavor.toLowerCase()}); bland landscape paintings line the wall above suspiciously angular floor seams.`
          : corVar === 2
            ? `Slick slate flagstones slant toward an iron grate (${sampleFlavor.toLowerCase()}), watched by peeling portraits with gouged eyes.`
            : `Narrow brick arches groan overhead (${sampleFlavor.toLowerCase()}); fine tripwire dust glints along cracked mortar.`;
      trap = `Hidden pit-trap (${trapFlavor.toLowerCase()}) dropping into lower crawlway`;
      interactables.push({ id: `int_${bp.id}_1`, kind: 'pit_trap', label: 'Inspect the paintings and floor seams (Presence DR14)', used: false });
    } else if (bp.role === 'pump_room') {
      const pumpVar = rollDie(3, state);
      feature =
        pumpVar === 1
          ? `Subtle sulfur reek (${sampleFlavor.toLowerCase()}); a rusted hand-pump drips muddy liquid beside an iron hatch above ${bossDef.name}'s lair.`
          : pumpVar === 2
            ? `Hissing copper pipes sweat grease (${sampleFlavor.toLowerCase()}) around a crank-cistern and a bolted floor-hatch descending toward ${bossDef.name}.`
            : `An overturned water-wheel ticks slowly in black bilge (${sampleFlavor.toLowerCase()}), flanking a rusted hatchway down into heat and smoke.`;
      interactables.push({ id: `int_${bp.id}_1`, kind: 'pump', label: 'Drink muddy liquid from the rusty pump (+d4 HP)', used: false });
      interactables.push({ id: `int_${bp.id}_2`, kind: 'hatch', label: 'Descend the rusted hatch stepladder directly below', used: false });
    } else if (bp.role === 'chain_room') {
      feature = `Dimly lit, weirdly chilly and windy (${sampleFlavor.toLowerCase()}); hooked meat-chains sway over bloody tracks.`;
      if (rollDie(3, state) === 1) {
        enemyIds.push(pickFrom(dwellerCreatures, state));
      }
    } else if (bp.role === 'hazard_rim') {
      feature = `${hazard.name}: ${hazard.description} Gems glitter inside the far rock wall (${sampleFlavor.toLowerCase()}).`;
      interactables.push({ id: `int_${bp.id}_1`, kind: 'hazard_cross', label: `Wrench gems & brave ${hazard.name} (${hazard.testAbility.toUpperCase()} DR${hazard.testDr})`, used: false });
    } else if (bp.role === 'tight_tunnel') {
      feature = `A suffocating crawlway through sweating earth (${sampleFlavor.toLowerCase()}). Heavy armor cannot squeeze through.`;
    } else if (bp.role === 'rival_sanctuary') {
      feature = `${rival.name}: ${rival.leaderName} sits beside a smoky brazier (${rival.appearance}).`;
      interactables.push({ id: `int_${bp.id}_1`, kind: 'rival_camp', label: `Speak with ${rival.leaderName} or accept ${rival.brewName}`, used: false });
    } else if (bp.role === 'puzzle_statue') {
      if (puzzleKind === 'socket_statue') {
        feature = `${statue.name}: ${statue.description}`;
        interactables.push({ id: `int_${bp.id}_1`, kind: 'statue_socket', label: `Examine the idol & socket (${statue.socketItemName})`, used: false });
      } else if (puzzleKind === 'inscription_cipher') {
        feature = `${statue.name} stands carved with rotating Verhu cipher-wheels (${sampleFlavor.toLowerCase()}). Clues hidden across the dungeon lower its DR.`;
        interactables.push({ id: `int_${bp.id}_1`, kind: 'inscription_cipher', label: `Decipher ${statue.name}'s rotating cipher-wheels (Presence DR12)`, used: false });
      } else if (puzzleKind === 'blood_altar') {
        feature = `${statue.name} looms above a cracked drainage basin crying out for living blood (${sampleFlavor.toLowerCase()}).`;
        interactables.push({ id: `int_${bp.id}_1`, kind: 'blood_altar', label: `Feed living blood to ${statue.name} (-d4 HP or Toughness DR12) to unseal the door`, used: false });
      } else if (puzzleKind === 'riddle_door') {
        feature = `A bolted iron barrier carved with ${statue.name}'s weeping face blocks the hidden sanctum (${sampleFlavor.toLowerCase()}).`;
        interactables.push({ id: `int_${bp.id}_1`, kind: 'riddle_door', label: `Read & answer ${statue.name}'s riddle-door (or brute-force Strength DR14)`, used: false });
      } else {
        feature = `${statue.name} holds twin tarnished bronze scales beside a seamless stone slab (${sampleFlavor.toLowerCase()}).`;
        interactables.push({ id: `int_${bp.id}_1`, kind: 'offering_scale', label: `Tip the offering scales (15s, treasure, or Strength DR14)`, used: false });
      }
    } else if (bp.role === 'stairwell_down') {
      feature = `Slick spiral stone steps descend into freezing black gloom (${sampleFlavor.toLowerCase()}). ${hazard.name} fumes drift upward from the lower level.`;
    } else if (bp.role === 'locked_vault') {
      const obj = state.activeContract;
      if (obj && obj.objectiveKind !== 'slay_boss' && obj.objectiveKind !== 'sabotage') {
        feature = `Confined torchlit sanctum behind the secret stone door. Inside lies ${obj.targetName}.`;
        interactables.push({ id: `int_${bp.id}_1`, kind: 'objective', label: `Claim / extract ${obj.targetName}`, used: false });
      } else {
        feature = 'Confined torchlit sanctum behind the secret stone door. A bone reliquary gleams with gold, scrolls, and occult relics.';
        interactables.push({ id: `int_${bp.id}_1`, kind: 'ransack', label: 'Loot the secret sanctum reliquary', used: false });
      }
    } else if (bp.role === 'ritual_sanctum') {
      const targetName = state.activeContract?.targetName ?? 'the blasphemous altar';
      feature = `Blackened ritual chamber pulsing with rot (${distinctiveFeature.toLowerCase()}). At its center stands ${targetName}.`;
      enemyIds.push(pickFrom(dwellerCreatures, state));
      interactables.push({ id: `int_${bp.id}_1`, kind: 'sabotage_altar', label: `Sabotage / shatter ${targetName} (Strength DR12)`, used: false });
    } else if (bp.role === 'ossuary') {
      feature = `Ceiling-high marrow bones and cracked skulls (${sampleFlavor.toLowerCase()}).`;
      corpsesRemaining = Math.max(1, corpsesRemaining);
      if (rollDie(2, state) === 1) {
        enemyIds.push('slumbering_skeleton');
      }
      interactables.push({ id: `int_${bp.id}_1`, kind: 'ossuary_loot', label: 'Sift through the bone-piles for clues or relics (d6)', used: false });
    } else if (bp.role === 'shrine') {
      feature = `A soot-stained shrine to the Two-Headed Basilisk (${sampleFlavor.toLowerCase()}).`;
      interactables.push({ id: `int_${bp.id}_1`, kind: 'shrine_offering', label: 'Leave 10s or pray at the shrine (Presence DR12)', used: false });
    } else if (bp.role === 'trap_gallery') {
      feature = `Narrow stonework lined with brass apertures and stained tiles (${sampleFlavor.toLowerCase()}).`;
      trap = trapFlavor;
      if (rollDie(3, state) === 1) {
        enemyIds.push(pickFrom(dwellerCreatures, state));
      }
    } else if (bp.role === 'debris_room') {
      feature = `Very stale and frowst (${sampleFlavor.toLowerCase()}); trash and gnawed bones mound chest-high.`;
      corpsesRemaining = Math.max(1, corpsesRemaining);
    } else if (bp.role === 'boss_lair') {
      feature = `Sooty and scorching hot beneath ${hazard.name} fumes (${distinctiveFeature.toLowerCase()}). ${bossDef.name} rules here amid hanging flesh and twin hearths.`;
      enemyIds.push(bossEntry.id);
    }

    const labelList = ROLE_LABELS[bp.role];
    const label = bp.id === 0 ? 'Entrance' : pickFrom(labelList, state);
    const sensory = {
      light: pickFrom(world.proseFragments.lightingDetails, state),
      smell: pickFrom(world.proseFragments.sensorySmells, state),
      sound:
        bp.role === 'hazard_rim' || bp.role === 'boss_lair' || bp.role === 'puzzle_statue'
          ? `${hazard.name} fumes hiss and echo across the wet stone.`
          : pickFrom(world.proseFragments.sensorySounds, state),
      atmo: pickFrom(world.proseFragments.roomAtmospheres, state),
    };
    const graffiti =
      bp.id !== 0 && bp.role !== 'locked_vault' && bp.role !== 'boss_lair' && rollDie(3, state) === 1
        ? pickFrom(GRAFFITI_LINES, state)
        : null;
    if (graffiti) {
      interactables.push({
        id: `int_${bp.id}_graf`,
        kind: 'read_graffiti',
        label: 'Read the frantic wall scrawls / graffiti',
        used: false,
      });
    }

    return {
      id: bp.id,
      role: bp.role,
      label,
      feature,
      trap,
      trapSpotted: false,
      trapTriggered: false,
      corpsesRemaining,
      visited: bp.id === 0,
      cleared: bp.id === 0,
      exits: [...bp.exits].sort((a, b) => a - b),
      x: bp.id % gridWidth,
      y: bp.depth,
      floor: bp.floor,
      sensory,
      graffiti,
      revisitCount: 0,
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

  const puzzleUnlockText =
    puzzleKind === 'socket_statue'
      ? statue.unlockText
      : puzzleKind === 'inscription_cipher'
        ? `${statue.name}'s cipher-wheels lock into alignment—the hidden sanctum wall groans open!`
        : puzzleKind === 'blood_altar'
          ? `${statue.name} drinks the spilled blood—crimson cracks split the stone to reveal a secret sanctum!`
          : puzzleKind === 'riddle_door'
            ? DUNGEON_RIDDLES[riddleIndex].solveText
            : `The bronze scales balance level! Stone counterweights drop, swinging wide the secret sanctum.`;

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
    puzzleUnlockText,
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
    puzzleKind,
    puzzleCluesFound: 0,
    riddleIndex,
    size: contractSize,
    floors,
    dangerTicks: 0,
    movesSinceDanger: 0,
  };

  if (state.activeContract) {
    const puzzleHint =
      puzzleKind === 'socket_statue'
        ? `A hidden chamber behind ${statue.name} opens only for the ${statue.socketItemName}.`
        : puzzleKind === 'inscription_cipher'
          ? `Rotating cipher-wheels on ${statue.name} unseal a hidden sanctum—study books, bones, or shrines for clues.`
          : puzzleKind === 'blood_altar'
            ? `${statue.name} opens a secret sanctum only when fed living blood.`
            : puzzleKind === 'riddle_door'
              ? `An iron riddle-door guarding ${statue.name} yields to wit—or brutal iron if arms are strong.`
              : `Bronze offering scales by ${statue.name} answer only to 15s silver, plundered treasure, or brawn.`;
    const truths = [
      puzzleHint,
      `Something monstrous (${world.creaturesById[hazard.apexCreatureId]?.name ?? 'an apex horror'}) hungers inside ${hazard.name}!`,
      `${dwellers} infest ${name} while ${bossDef.name} holds the iron key.`,
    ];
    const falsehoods = [
      'Toxic fumes leak from every crack in the first hall, driving all who breathe them mad.',
      'An ancient catatonic man in the feast hall will slit your throats if you sit down.',
      'The lamps burn with human tallow and none who light them have ever left alive.',
      'Only wearing heavy iron plate will let you squeeze through the flooded western tunnel.',
      'No silver coin exists inside this vault—every chest is filled solely with biting centipedes.',
      `The ${bossDef.name} has already fled to Grift and left the deepest forge empty.`,
      'Drinking from the rusted cistern pump turns your tongue to black lead within three breaths.',
      'Two peaceful monks guard the inner sanctum and bless anyone who drops their blades.',
      'Every skeleton in the stacks will rise as an invincible wraith if you carry a lantern.',
      'Touching the central idol grants all lost limbs back at once without paying blood or price.',
      'A secret staircase behind the entrance banner drops straight into the treasure vault.',
      'None of the watchmen carry keys; only burning every painting reveals the locked door.',
      'The rival cult in the lower cellar obeys Galgenbeck law and pays tithes in clean gold.',
      'Silence wards the deep chambers—shouting once collapses the entire ceiling on impact.',
    ];
    const truthLine = pickFrom(truths, state);
    const falseLine = pickFrom(falsehoods, state);
    const truthFirst = rollDie(2, state) === 1;
    state.activeContract.prophecies = truthFirst ? [truthLine, falseLine] : [falseLine, truthLine];
    state.activeContract.prophecyTruthIndex = truthFirst ? 0 : 1;
    state.activeContract.prophecyRevealed = false;
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

export function verifyDungeonSolvable(
  dungeon: DungeonState,
  objectiveKind?: 'rescue_heir' | 'slay_boss' | 'steal_relic' | 'sabotage',
): boolean {
  // 1. Reachability ignoring boss-locked rooms & secret vault
  const visitedPreKey = new Set<number>([0]);
  const q1 = [0];
  while (q1.length > 0) {
    const cur = q1.shift()!;
    const room = dungeon.rooms[cur];
    if (!room) continue;
    for (const nextId of room.exits) {
      const nextRoom = dungeon.rooms[nextId];
      if (!nextRoom || nextRoom.secretHidden || nextRoom.lockedByKey) continue;
      if (!visitedPreKey.has(nextId)) {
        visitedPreKey.add(nextId);
        q1.push(nextId);
      }
    }
  }

  const bossRoom = dungeon.rooms.find((r) => r.role === 'boss_lair');
  const puzzleRoom = dungeon.rooms.find((r) => r.role === 'puzzle_statue');
  const vaultRoom = dungeon.rooms.find((r) => r.role === 'locked_vault');
  if (!bossRoom || !puzzleRoom || !vaultRoom) return false;
  if (!visitedPreKey.has(bossRoom.id) || !visitedPreKey.has(puzzleRoom.id)) return false;

  if (objectiveKind === 'sabotage') {
    const ritual = dungeon.rooms.find((r) => r.role === 'ritual_sanctum');
    if (!ritual || !visitedPreKey.has(ritual.id)) return false;
  }

  // 2. Full graph connectivity (unlocking secret + key doors)
  const visitedAll = new Set<number>([0]);
  const q2 = [0];
  while (q2.length > 0) {
    const cur = q2.shift()!;
    const room = dungeon.rooms[cur];
    if (!room) continue;
    for (const nextId of room.exits) {
      if (!visitedAll.has(nextId)) {
        visitedAll.add(nextId);
        q2.push(nextId);
      }
    }
  }
  return visitedAll.size === dungeon.rooms.length;
}

export function renderDungeonMap(dungeon: DungeonState): string {
  const cur = dungeon.rooms[dungeon.currentRoomId];
  const visitedRooms = dungeon.rooms
    .filter((r) => r.visited)
    .sort((a, b) => (a.floor ?? 1) - (b.floor ?? 1) || a.y - b.y || a.id - b.id);
  const totalFloors = dungeon.floors ?? 1;
  const floorLabel = totalFloors > 1 ? ` (${totalFloors} Floors)` : '';
  const lines: string[] = [
    `=== ${dungeon.name}${floorLabel} (Fog-of-War Map | ${visitedRooms.length}/${dungeon.rooms.length} rooms charted) ===`,
    `Current: ${totalFloors > 1 ? `Floor ${cur.floor ?? 1}, ` : ''}Room #${cur.id + 1} (${cur.label})`,
  ];

  const floors = [...new Set(visitedRooms.map((r) => r.floor ?? 1))].sort((a, b) => a - b);
  for (const fl of floors) {
    if (totalFloors > 1) {
      lines.push(` -- FLOOR ${fl} --`);
    }
    const floorRooms = visitedRooms.filter((r) => (r.floor ?? 1) === fl);
    const depths = [...new Set(floorRooms.map((r) => r.y))].sort((a, b) => a - b);
    for (const depth of depths) {
      lines.push(`  [Depth ${depth}]`);
      const tierRooms = floorRooms.filter((r) => r.y === depth);
      for (const r of tierRooms) {
        const tags: string[] = [];
        if (r.id === dungeon.currentRoomId) tags.push('YOU');
        if (r.id === 0) tags.push('EXIT');
        if (r.role === 'stairwell_down') tags.push('STAIRS->F2');
        const tagStr = tags.length > 0 ? ` [${tags.join(',')}]` : '';
        const visibleExits = r.exits
          .filter((eid) => {
            const dest = dungeon.rooms[eid];
            return dest && (!dest.secretHidden || dungeon.puzzleSolved);
          })
          .map((eid) => {
            const dest = dungeon.rooms[eid];
            const lockStr = dest.lockedByKey && !dungeon.hasBossKey && r.role !== 'boss_lair' ? ' [LOCKED]' : '';
            const flTag = (dest.floor ?? 1) !== (r.floor ?? 1) ? ` [F${dest.floor}]` : '';
            return dest.visited ? `#${eid + 1} (${dest.label})${flTag}${lockStr}` : `#${eid + 1} [?]${flTag}${lockStr}`;
          });
        lines.push(`    #${r.id + 1} ${r.label}${tagStr}  -->  ${visibleExits.join(' | ') || 'none'}`);
      }
    }
  }
  return lines.join('\n');
}
