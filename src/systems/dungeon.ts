import type { DungeonRuntimeState, GameState } from '../types.ts';
import { loadWorldDatabase } from '../db/loader.ts';
import { ITEMS } from '../content/items.ts';
import { resolveCheck } from '../dice.ts';
import { addItemToInventory, startCombatEncounter } from '../combat.ts';
import { recordChronicle } from '../memory.ts';

function ensureDungeonRuntime(state: GameState, dungeonId: string): DungeonRuntimeState {
  const existing = state.frontier.dungeonStates[dungeonId];
  if (existing) return existing;
  const def = loadWorldDatabase().dungeons[dungeonId];
  const created: DungeonRuntimeState = {
    dungeonId,
    currentRoomId: def.entryRoomId,
    visitedRooms: [def.entryRoomId],
    clearedRooms: [],
    openedDoors: [],
    pulledSwitches: [],
    lootedRooms: [],
    disarmedTraps: [],
  };
  state.frontier.dungeonStates[dungeonId] = created;
  return created;
}

export function enterDungeon(state: GameState, dungeonId: string): string[] {
  const def = loadWorldDatabase().dungeons[dungeonId];
  if (!def) return ['Unknown dungeon.'];
  const rt = ensureDungeonRuntime(state, dungeonId);
  state.frontier.activeDungeonId = dungeonId;
  state.scene = 'dungeon';
  state.subMenu = 'root';
  const room = def.rooms[rt.currentRoomId];
  return [`You descend into ${def.name}.`, room.description];
}

export function renderDungeonMap(state: GameState): string {
  const dungeonId = state.frontier.activeDungeonId;
  if (!dungeonId) return 'No active dungeon.';
  const def = loadWorldDatabase().dungeons[dungeonId];
  const rt = ensureDungeonRuntime(state, dungeonId);
  const rooms = Object.values(def.rooms);
  const maxRow = Math.max(...rooms.map((r) => r.row));
  const maxCol = Math.max(...rooms.map((r) => r.col));

  const currentRoom = def.rooms[rt.currentRoomId];
  const adjacentIds = new Set(currentRoom.exits.map((e) => e.toRoomId));

  const lines: string[] = [`MAP - ${def.name.toUpperCase()}`];
  for (let r = 0; r <= maxRow; r += 1) {
    const rowCells: string[] = [];
    for (let c = 0; c <= maxCol; c += 1) {
      const rm = rooms.find((x) => x.row === r && x.col === c);
      if (!rm) {
        rowCells.push('   ');
      } else if (rm.id === rt.currentRoomId) {
        rowCells.push(' X ');
      } else if (rt.visitedRooms.includes(rm.id)) {
        rowCells.push(rm.isBoss ? ' ! ' : ' . ');
      } else if (adjacentIds.has(rm.id)) {
        rowCells.push(' ? ');
      } else {
        rowCells.push('   ');
      }
    }
    lines.push(`  ${rowCells.join(' ')}`);
  }
  lines.push('Legend: X Here | . Visited | ? Adjacent | ! Vault');
  return lines.join('\n');
}

export function getDungeonChoices(
  state: GameState,
): Array<{ index: number; id: string; label: string; enabled: boolean; reason?: string }> {
  const dungeonId = state.frontier.activeDungeonId;
  if (!dungeonId) return [];
  const def = loadWorldDatabase().dungeons[dungeonId];
  const rt = ensureDungeonRuntime(state, dungeonId);
  const room = def.rooms[rt.currentRoomId];
  const opts: Array<{ index: number; id: string; label: string; enabled: boolean; reason?: string }> = [];

  for (const ex of room.exits) {
    const lockedBySwitch = ex.lockedBySwitchId && !rt.pulledSwitches.includes(ex.lockedBySwitchId);
    const lockedByItem =
      ex.lockedByItemId && !state.player.inventory.some((i) => i.id === ex.lockedByItemId && i.qty > 0);
    const locked = Boolean(lockedBySwitch || lockedByItem);
    opts.push({
      index: opts.length + 1,
      id: `dmove:${ex.id}`,
      label: ex.label,
      enabled: !locked,
      reason: locked ? 'Sealed shut' : undefined,
    });
  }

  if (room.switchId && !rt.pulledSwitches.includes(room.switchId)) {
    opts.push({
      index: opts.length + 1,
      id: 'dswitch',
      label: room.switchLabel ?? 'Pull Switch',
      enabled: true,
    });
  }

  const hasLoot = Boolean(room.lootItemId || room.crowns) && !rt.lootedRooms.includes(room.id);
  if (hasLoot) {
    opts.push({
      index: opts.length + 1,
      id: 'dloot',
      label: 'Search Vault',
      enabled: true,
    });
  }

  opts.push({ index: opts.length + 1, id: 'open_journal', label: 'Journal', enabled: true });

  if (room.id === def.entryRoomId) {
    opts.push({ index: opts.length + 1, id: 'dexit', label: 'Leave', enabled: true });
  }

  return opts;
}

export function executeDungeonAction(state: GameState, actionId: string): string[] {
  const dungeonId = state.frontier.activeDungeonId;
  if (!dungeonId) return ['Not in a dungeon.'];
  const def = loadWorldDatabase().dungeons[dungeonId];
  const rt = ensureDungeonRuntime(state, dungeonId);
  const room = def.rooms[rt.currentRoomId];

  if (actionId === 'dexit') {
    state.frontier.activeDungeonId = null;
    state.scene = 'location';
    state.subMenu = 'root';
    state.locationId = def.parentAreaId;
    return [`You climb back out of ${def.name} into the grey daylight.`];
  }

  if (actionId === 'dswitch' && room.switchId) {
    if (!rt.pulledSwitches.includes(room.switchId)) {
      rt.pulledSwitches.push(room.switchId);
      return ['Iron gears grind behind the stone wall as a distant gate unbars.'];
    }
    return ['The mechanism is already thrown.'];
  }

  if (actionId === 'dloot') {
    if (rt.lootedRooms.includes(room.id)) {
      return ['Nothing remains here.'];
    }
    rt.lootedRooms.push(room.id);
    const msgs: string[] = [];
    if (room.lootItemId) {
      addItemToInventory(state, room.lootItemId, 1);
      msgs.push(`Claimed ${ITEMS[room.lootItemId]?.name ?? room.lootItemId}.`);
    }
    if (room.crowns) {
      state.player.crowns += room.crowns;
      msgs.push(`Found ${room.crowns} Crowns.`);
    }
    if (room.isBoss) {
      recordChronicle(state, `Cleared ${def.name}`, `Plundered the inner vault of ${def.name}.`, 'explore');
    }
    return msgs.length > 0 ? msgs : ['The chest is empty.'];
  }

  if (actionId.startsWith('dmove:')) {
    const exitId = actionId.slice(6);
    const ex = room.exits.find((e) => e.id === exitId);
    if (!ex) return ['No passage that way.'];
    if (ex.lockedBySwitchId && !rt.pulledSwitches.includes(ex.lockedBySwitchId)) {
      return ['The heavy stone gate is barred from somewhere nearby.'];
    }
    const nextRoom = def.rooms[ex.toRoomId];
    if (!nextRoom) return ['Collapsed rubble blocks the way.'];

    rt.currentRoomId = nextRoom.id;
    if (!rt.visitedRooms.includes(nextRoom.id)) {
      rt.visitedRooms.push(nextRoom.id);
    }

    const msgs: string[] = [`${nextRoom.name}: ${nextRoom.description}`];

    if (nextRoom.trapDc && !rt.disarmedTraps.includes(nextRoom.id)) {
      rt.disarmedTraps.push(nextRoom.id);
      const check = resolveCheck(state, 'agility', nextRoom.trapDc, {
        label: 'Floor Trap',
        isCraftOrStealth: true,
      });
      if (check.success) {
        msgs.push(check.logLine, 'You spot a tripwire in the dark and step clear.');
      } else {
        const dmg = nextRoom.trapDamage ?? 4;
        state.player.hp = Math.max(1, state.player.hp - dmg);
        msgs.push(check.logLine, `A concealed stone plate snaps shut, dealing ${dmg} damage.`);
      }
    }

    if (
      nextRoom.enemyIds &&
      nextRoom.enemyIds.length > 0 &&
      !rt.clearedRooms.includes(nextRoom.id)
    ) {
      rt.clearedRooms.push(nextRoom.id);
      const { introMessages } = startCombatEncounter(state, {
        enemyIds: nextRoom.enemyIds,
        canFlee: !nextRoom.isBoss,
      });
      return [...msgs, ...introMessages];
    }

    return msgs;
  }

  return ['Unknown dungeon action.'];
}
