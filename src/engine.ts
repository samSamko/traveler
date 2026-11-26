import type { WorldDatabase } from './db/loader.ts';
import type { GameState, OutcastFollower } from './types.ts';
import {
  applyBrokenOrDead,
  finishCombatIfEnded,
  resolveAllActiveEnemyTurns,
  resolvePcAttack,
} from './combat.ts';
import { parseDiceExpr, rollAbilityTest, rollD66, rollDie } from './dice.ts';
import {
  buildProceduralScene,
  enterDungeonRoom,
  resolveChoiceOption,
  resolveFreeformProceduralInput,
  rollNextContract,
} from './gm/procedural.ts';
import { improveCharacter } from './rules/advancement.ts';
import { castScroll } from './rules/powers.ts';
import { catchBreath, fullNightsRest } from './rules/rest.ts';
import {
  renderAbilityModTable,
  renderCharacterSheet,
  renderDrAndCombatModTable,
  renderSummaryOverview,
} from './ui.ts';

export interface StepOutput {
  immediateText?: string;
  shouldExit?: boolean;
}

function firstAlivePcIndex(state: GameState): number {
  const active = state.party.members[state.party.activePcIndex];
  if (active && active.status === 'alive') return state.party.activePcIndex;
  const idx = state.party.members.findIndex((m) => m.status === 'alive');
  return idx >= 0 ? idx : 0;
}

export function initializeOpeningScene(
  state: GameState,
  world: WorldDatabase,
): void {
  buildProceduralScene(state, world);
}

function plunderCorpse(state: GameState, world: WorldDatabase, pcIndex: number): string[] {
  const pc = state.party.members[pcIndex] ?? state.party.members[firstAlivePcIndex(state)];
  const code = rollD66(state);
  const entry = world.corpsePlundering.find((p) => p.code === code) ?? world.corpsePlundering[0];
  const logs: string[] = [`${pc.name} plunders corpse [d66=${code}]: ${entry.text}`];

  if (entry.silver > 0) {
    pc.silver += entry.silver;
    logs.push(`${pc.name} pockets ${entry.silver}s (now ${pc.silver}s).`);
  }
  if (entry.damage) {
    const dmg = parseDiceExpr(entry.damage, state);
    pc.hp -= dmg;
    logs.push(`${pc.name} takes ${dmg} damage! (${pc.hp}/${pc.maxHp} HP)`);
    logs.push(...applyBrokenOrDead(pc, state));
  }
  if (code !== '11' && code !== '12' && code !== '13' && code !== '14' && code !== '15' && code !== '16' && entry.silver === 0) {
    pc.inventory.push({
      id: `plunder_${Date.now()}_${rollDie(999, state)}`,
      name: entry.text.slice(0, 60),
      kind: 'gear',
      notes: entry.text,
    });
  }
  return logs;
}

function recruitRandomOutcast(state: GameState, world: WorldDatabase): string {
  const arch = world.outcasts[rollDie(world.outcasts.length, state) - 1];
  const trait = arch.traits[rollDie(arch.traits.length, state) - 1];
  const specialty = arch.specialties[rollDie(arch.specialties.length, state) - 1];
  const values = arch.values[rollDie(arch.values.length, state) - 1];
  const follower: OutcastFollower = {
    id: `outcast_${state.party.followers.length + 1}`,
    archetypeId: arch.id,
    name: `${arch.name} (${trait})`,
    hp: arch.hp,
    maxHp: arch.hp,
    morale: arch.morale,
    armorName: arch.armorName,
    weaponName: arch.weaponName,
    trait,
    specialty,
    values,
    status: 'alive',
  };
  state.party.followers.push(follower);
  state.chronicle.push(`Recruited outcast: ${follower.name}.`);
  return `Outcast joins: ${follower.name} | HP ${follower.hp} | Morale ${follower.morale} | Specialty: ${specialty} | Values: ${values}.`;
}

function formatHelpText(stealth: boolean): string {
  return [
    'Commands:',
    '  1-4 / text        Choose numbered option or enter freeform action',
    '  summary / overview  Show party, calendar, region, hook & chronicle overview',
    '  party               Alias for summary',
    '  sheet [1-4]       Show full character sheet (traits, gear, inventory)',
    '  tables / mods     Show all Ability, DR, Armor, Combat, Broken & Reaction tables',
    '  pc <1-4>          Switch active PC',
    '  cast <scroll#>    Cast a scroll carried by active PC',
    '  plunder           Roll d66 on Corpse Plundering',
    '  rest / sleep      Full night rest (consumes food/water, rolls Dawn Misery)',
    '  breathe           Catch breath (+d4 HP)',
    '  move <room#>      Move to a connected room inside a Bedeviled Dungeon',
    '  leave dungeon     Exit active dungeon to surface',
    '  map               Show current chamber and visible exits',
    '  calendar          Show triggered Miseries on the Calendar of Nechrubel',
    '  recruit           Roll a random Outcast follower',
    '  quit              Save and exit',
    '',
    renderAbilityModTable(stealth),
    renderDrAndCombatModTable(stealth),
  ].join('\n');
}

export function processPlayerInput(
  state: GameState,
  world: WorldDatabase,
  rawInput: string,
  stealth = false,
): StepOutput {
  const trimmed = rawInput.trim();
  if (!trimmed) return {};
  const lower = trimmed.toLowerCase();

  if (lower === 'quit' || lower === 'exit') {
    return { shouldExit: true };
  }
  if (lower === 'help' || lower === '?') {
    return { immediateText: formatHelpText(stealth) };
  }
  if (lower === 'tables' || lower === 'mods') {
    return {
      immediateText: `${renderAbilityModTable(stealth)}\n${renderDrAndCombatModTable(stealth)}`,
    };
  }
  if (state.mode === 'game_over') {
    return { immediateText: state.gameOverReason ?? 'Game over. Type "quit" to exit.' };
  }

  // Instant inspection commands
  if (lower === 'summary' || lower === 'overview' || lower === 'party') {
    return { immediateText: renderSummaryOverview(state, stealth) };
  }
  if (lower === 'sheet' || lower.startsWith('sheet ')) {
    const num = Number.parseInt(lower.replace('sheet', '').trim(), 10);
    const idx = Number.isNaN(num)
      ? state.party.activePcIndex
      : Math.max(0, Math.min(state.party.members.length - 1, num - 1));
    return { immediateText: renderCharacterSheet(state.party.members[idx], stealth) };
  }
  if (lower.startsWith('pc ')) {
    const num = Number.parseInt(lower.slice(3).trim(), 10);
    if (Number.isNaN(num) || num < 1 || num > state.party.members.length) {
      return { immediateText: `Choose PC 1..${state.party.members.length}.` };
    }
    state.party.activePcIndex = num - 1;
    state.lastEvents = [`Active PC switched to ${state.party.members[state.party.activePcIndex].name}.`];
    return {};
  }
  if (lower === 'calendar') {
    const miseries =
      state.calendar.triggeredMiseries.length === 0
        ? 'No Miseries triggered yet.'
        : state.calendar.triggeredMiseries
            .map((code) => {
              const p = world.calendarPsalms.find((x) => x.code === code);
              return `  ${code} — ${p?.text ?? ''}`;
            })
            .join('\n');
    return {
      immediateText: `Calendar of Nechrubel (d${state.calendar.die}) | Day ${state.calendar.day} | Triggered ${state.calendar.triggeredMiseries.length}/7:\n${miseries}`,
    };
  }
  if (lower === 'map') {
    if (!state.activeDungeon) return { immediateText: 'You are not inside a Bedeviled Dungeon.' };
    const d = state.activeDungeon;
    const cur = d.rooms[d.currentRoomId];
    return {
      immediateText: `${d.name} — ${cur.label}: ${cur.feature}\nExits: ${cur.exits.map((id) => `Room #${id + 1}`).join(', ')}`,
    };
  }

  // Cast scroll command
  if (lower === 'cast' || lower.startsWith('cast ')) {
    const pcIdx = firstAlivePcIndex(state);
    const pc = state.party.members[pcIdx];
    const scrolls = pc.inventory.filter((i) => i.kind === 'unclean_scroll' || i.kind === 'sacred_scroll');
    if (scrolls.length === 0) {
      return { immediateText: `${pc.name} carries no scrolls.` };
    }
    const arg = lower.replace('cast', '').trim();
    const num = Number.parseInt(arg, 10);
    const chosen = !Number.isNaN(num) && scrolls[num - 1] ? scrolls[num - 1] : scrolls[0];
    const res = castScroll(state, world, pcIdx, chosen);
    state.lastEvents = res.logs;
    return {};
  }

  // Combat mode handling (strictly deterministic)
  if (state.mode === 'combat' && state.activeCombat) {
    const combat = state.activeCombat;
    const pcIdx = firstAlivePcIndex(state);
    const activeEnemyIdx = combat.enemies.findIndex((e) => e.status === 'active');
    const logs: string[] = [];

    if (lower === '5' || lower === 'flee') {
      const pc = state.party.members[pcIdx];
      const fleeTest = rollAbilityTest(pc, 'agility', 12, state, { label: 'Flee combat' });
      logs.push(fleeTest.logLine);
      if (fleeTest.success) {
        state.activeCombat = null;
        state.mode = state.activeDungeon ? 'dungeon' : 'exploration';
        logs.push('The party breaks away into the gloom!');
        state.lastEvents = logs;
        return {};
      }
      logs.push('Failed to flee!');
    } else if (lower === '4') {
      const pc = state.party.members[pcIdx];
      const scroll = pc.inventory.find((i) => i.kind === 'unclean_scroll' || i.kind === 'sacred_scroll');
      if (!scroll) {
        return { immediateText: `${pc.name} has no scrolls to cast.` };
      }
      const res = castScroll(state, world, pcIdx, scroll);
      logs.push(...res.logs);
    } else if (lower === '1' || lower === '2' || lower === '3' || lower.startsWith('attack')) {
      let targetIdx = activeEnemyIdx;
      if (lower.startsWith('attack ')) {
        const req = Number.parseInt(lower.slice(7).trim(), 10) - 1;
        if (combat.enemies[req]?.status === 'active') targetIdx = req;
      }
      if (targetIdx >= 0) {
        logs.push(
          ...resolvePcAttack(state, pcIdx, targetIdx, {
            useOmenMaxDmg: lower === '2',
            useOmenLowerDr: lower === '3',
          }),
        );
      }
    } else {
      return { immediateText: 'In combat: choose 1-5, "attack <#>", "cast", or "flee".' };
    }

    const endEarly = finishCombatIfEnded(state);
    if (endEarly.length > 0) {
      logs.push(...endEarly);
      state.lastEvents = logs;
      buildProceduralScene(state, world);
      return {};
    }

    // Remaining enemies act and round advances
    logs.push(...resolveAllActiveEnemyTurns(state));
    combat.round += 1;
    const endAfter = finishCombatIfEnded(state);
    logs.push(...endAfter);
    if (endAfter.length > 0 && state.mode !== 'game_over') {
      buildProceduralScene(state, world);
    }
    state.lastEvents = logs;
    return {};
  }

  // Deterministic non-combat actions
  if (lower === 'rest' || lower === 'sleep') {
    state.lastEvents = fullNightsRest(state, world);
    buildProceduralScene(state, world);
    return {};
  }
  if (lower === 'breathe' || lower === 'catch breath') {
    state.lastEvents = catchBreath(state);
    buildProceduralScene(state, world);
    return {};
  }
  if (lower === 'plunder') {
    const pcIdx = firstAlivePcIndex(state);
    if (state.activeDungeon) {
      const room = state.activeDungeon.rooms[state.activeDungeon.currentRoomId];
      if (room.corpsesRemaining <= 0) {
        return { immediateText: 'No unplundered corpses remain in this room.' };
      }
      room.corpsesRemaining -= 1;
    }
    state.lastEvents = plunderCorpse(state, world, pcIdx);
    buildProceduralScene(state, world);
    return {};
  }
  if (lower === 'recruit') {
    state.lastEvents = [recruitRandomOutcast(state, world)];
    buildProceduralScene(state, world);
    return {};
  }
  if (lower === 'leave dungeon' && state.activeDungeon) {
    const contract = state.activeContract;
    const completed =
      contract.objectiveSecured || (contract.objectiveKind === 'slay_boss' && contract.bossSlain);
    if (completed) {
      const logs: string[] = [];
      const share = Math.max(10, Math.floor(contract.rewardSilver / Math.max(1, state.party.members.filter((m) => m.status !== 'dead').length)));
      for (const m of state.party.members) {
        if (m.status !== 'dead') {
          m.silver += share;
          logs.push(`${m.name} receives ${share}s contract payout!`);
          logs.push(...improveCharacter(m, state, world));
        }
      }
      logs.push(...rollNextContract(state, world));
      state.lastEvents = logs;
    } else {
      state.activeDungeon = null;
      state.mode = 'exploration';
      state.activeContract.phase = 'travel';
      state.activeContract.travelLegsRemaining = 1;
      state.lastEvents = ['Returned to the surface of the Dying World.'];
    }
    buildProceduralScene(state, world);
    return {};
  }
  if (lower.startsWith('move ') && state.activeDungeon) {
    const targetNum = Number.parseInt(lower.slice(5).trim(), 10);
    const targetId = targetNum - 1;
    const res = enterDungeonRoom(state, world, targetId);
    state.lastEvents = res.logs;
    if (state.mode !== 'combat' && state.mode !== 'game_over') {
      buildProceduralScene(state, world);
    }
    return {};
  }

  // Forward numbered choice or freeform text to Procedural GM
  const choiceNum = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(choiceNum) && String(choiceNum) === trimmed) {
    if (choiceNum >= 1 && choiceNum <= state.pendingChoiceOptions.length) {
      const chosen = state.pendingChoiceOptions[choiceNum - 1];
      if (chosen.actionId === 'dungeon_plunder') {
        const pcIdx = firstAlivePcIndex(state);
        const room = state.activeDungeon?.rooms[state.activeDungeon.currentRoomId];
        if (room && room.corpsesRemaining > 0) room.corpsesRemaining -= 1;
        state.lastEvents = plunderCorpse(state, world, pcIdx);
        buildProceduralScene(state, world);
        return {};
      }
      state.lastEvents = resolveChoiceOption(state, world, chosen);
      return {};
    }
    return { immediateText: `Choose 1..${state.pendingChoiceOptions.length} or enter a command/action.` };
  }

  state.lastEvents = resolveFreeformProceduralInput(state, world, trimmed);
  return {};
}
