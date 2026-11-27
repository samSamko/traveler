import type { WorldDatabase } from './db/loader.ts';
import type { GameState } from './types.ts';
import {
  applyBrokenOrDead,
  canParleyInCombat,
  finishCombatIfEnded,
  resolveAllActiveEnemyTurns,
  resolveCombatParley,
  resolvePcAttack,
  syncActiveCombatTurnPc,
} from './combat.ts';
import {
  canCarryMoreItems,
  ensureFeatureState,
  parseDiceExpr,
  rollAbilityTest,
  rollD66,
  rollDie,
} from './dice.ts';
import {
  buildProceduralScene,
  describeCurrentRoomFull,
  resolveChoiceOption,
  resolveFreeformProceduralInput,
} from './gm/procedural.ts';
import {
  activateClassFeature,
  equipInventoryItem,
  giveBetweenPcs,
  recruitOutcastFollower,
  useInventoryItem,
} from './rules/class_features.ts';
import { getActiveMiseryEffects } from './rules/calendar.ts';
import { renderDungeonMap } from './rules/dungeon.ts';
import { castScroll } from './rules/powers.ts';
import { catchBreath, fullNightsRest } from './rules/rest.ts';
import { buyShopEntry, renderShopCatalog, sellInventoryItem } from './rules/shop.ts';
import { loadMetaProfile } from './save.ts';
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

  // Exact Corpse Plundering riders (Bare Bones p. 4-5)
  if (code === '23') {
    const mothTest = rollAbilityTest(pc, 'toughness', 6, state, { label: 'Survive venomous moths' });
    logs.push(mothTest.logLine);
    if (!mothTest.success) {
      pc.hp = -99;
      pc.status = 'dead';
      logs.push(`${pc.name} chokes on moth venom and DIES!`);
    }
  } else if (code === '25') {
    const madTest = rollAbilityTest(pc, 'presence', 12, state, { label: 'Read mad manifesto' });
    logs.push(madTest.logLine);
    if (!madTest.success) {
      pc.abilities.presence = Math.max(-3, pc.abilities.presence - 1);
      logs.push(`${pc.name} loses 1 Presence permanently (${pc.abilities.presence})!`);
    }
  } else if (code === '26' && state.activeDungeon) {
    state.activeDungeon.hasBossKey = true;
    logs.push('The stolen iron key fits locked doors inside this dungeon!');
  } else if (code === '33') {
    const cyl = rollDie(6, state);
    if (cyl <= 2) {
      const dmg = rollDie(4, state);
      pc.hp -= dmg;
      pc.notes.push('Missing hand (gunpowder explosion)');
      logs.push(`Gunpowder cylinder explodes (d6=${cyl})! ${pc.name} loses a hand (-${dmg} HP)!`);
      logs.push(...applyBrokenOrDead(pc, state));
    } else if (canCarryMoreItems(pc)) {
      pc.inventory.push({ id: `plunder_cyl_${Date.now()}`, name: 'Gunpowder cylinder (3d10 bomb)', kind: 'gear' });
    }
  } else if (code === '43') {
    pc.silver += 40;
    logs.push(`Local potentate's bond yields +40s (${pc.silver}s total).`);
  } else if (code === '45' && canCarryMoreItems(pc)) {
    pc.inventory.push({ id: `plunder_water_${Date.now()}`, name: 'Water of Life (d8 HP, TOU DR10 or blind)', kind: 'medicine', uses: 1 });
  } else if (code === '51') {
    if (canCarryMoreItems(pc) && pc.weapon.id !== 'unarmed') {
      pc.inventory.push({ id: `old_wpn_${Date.now()}`, name: `Backup: ${pc.weapon.name}`, kind: 'gear' });
    }
    pc.weapon = { id: 'kergus_dagger', tableRoll: null, name: 'Black Kergüs dagger', damageDie: '2d4', ranged: false, twoHanded: false, silver: 30 };
    pc.weaponBroken = false;
    logs.push(`${pc.name} claims the Black Kergüs dagger (2d4)!`);
  } else if (code === '52' && canCarryMoreItems(pc)) {
    pc.inventory.push({ id: `plunder_poison_${Date.now()}`, name: 'Labelled poison bottle (d6 doses)', kind: 'poison', uses: 3 });
  } else if (
    code !== '11' &&
    code !== '12' &&
    code !== '13' &&
    code !== '14' &&
    code !== '15' &&
    code !== '16' &&
    entry.silver === 0 &&
    !entry.damage
  ) {
    if (canCarryMoreItems(pc)) {
      pc.inventory.push({
        id: `plunder_${Date.now()}_${rollDie(999, state)}`,
        name: entry.text.slice(0, 60),
        kind: 'gear',
        notes: entry.text,
      });
    } else {
      logs.push(`${pc.name} is at max carrying capacity (${pc.carryingCapacity * 2}) and leaves the trinket behind.`);
    }
  }
  return logs;
}

function parseUseCommandArgs(rawTail: string): { itemIdx: number; targetPcIdx?: number } {
  const parts = rawTail.trim().split(/\s+/).filter(Boolean);
  const itemNum = Number.parseInt(parts[0] ?? '', 10);
  const targetNum = parts[1] !== undefined ? Number.parseInt(parts[1], 10) : Number.NaN;
  return {
    itemIdx: Number.isNaN(itemNum) ? -1 : itemNum - 1,
    targetPcIdx: Number.isNaN(targetNum) ? undefined : targetNum - 1,
  };
}

function formatHelpText(stealth: boolean): string {
  return [
    'Commands:',
    '  1-4 / text        Choose numbered option or enter freeform action',
    '  summary / overview  Show party, calendar, region, hook & chronicle overview',
    '  party               Alias for summary',
    '  sheet [1-4]       Show full character sheet (traits, gear, inventory)',
    '  shop / buy <#>    View Quartermaster catalog or purchase gear/weapons/armor/repair',
    '  sell <#|all>      Sell item # or all trophies/treasures to the Quartermaster',
    '  equip <item#>     Equip a weapon or shield from active PC inventory',
    '  give <#|Ns> <pc#> Pass item # or Ns silver to another living party member',
    '  drop <item#>      Drop an item from active PC inventory',
    '  omen <mode>       Arm Omen: dmg (-d6), reroll, neutralize (crit/fumble), dr (-4 DR), clear',
    '  tables / mods     Show all Ability, DR, Armor, Combat, Broken & Reaction tables',
    '  pc <1-4>          Switch active PC',
    '  cast <scroll#>    Cast a scroll carried by active PC',
    '  use <#> [pc#]     Use medicine, decoction, poison, food, or relic (optionally on ally pc#)',
    '  feature           Activate class feature (daily/combat/dungeon power)',
    '  parley            Round-1 combat Reaction check (before blood is drawn, vs non-boss foes)',
    '  plunder           Roll d66 on Corpse Plundering',
    '  rest / sleep      Full night rest (consumes food/water, rolls Dawn Misery)',
    '  breathe           Catch breath (+d4 HP)',
    '  move <room#>      Move to a connected room inside a Bedeviled Dungeon',
    '  leave dungeon     Exit active dungeon to surface',
    '  look / l          Re-read full room description, sensory details & wall graffiti',
    '  map               Show fog-of-war map of visited rooms and visible exits',
    '  calendar          Show triggered Miseries on the Calendar of Nechrubel',
    '  graveyard         View fallen/apocalypse history from meta_profile.json',
    '  recruit           Hire a random Outcast follower in Briefing (25s, max 2)',
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
    if (state.mode === 'combat') {
      return { immediateText: 'Cannot manually switch PCs during combat — turns follow rolled Agility+d6 initiative order.' };
    }
    const num = Number.parseInt(lower.slice(3).trim(), 10);
    if (Number.isNaN(num) || num < 1 || num > state.party.members.length) {
      return { immediateText: `Choose PC 1..${state.party.members.length}.` };
    }
    state.party.activePcIndex = num - 1;
    state.lastEvents = [`Active PC switched to ${state.party.members[state.party.activePcIndex].name}.`];
    return {};
  }
  if (lower === 'shop') {
    if (state.mode !== 'exploration') {
      return { immediateText: 'Quartermaster shop is only available before entering a dungeon (outside combat).' };
    }
    const pc = state.party.members[firstAlivePcIndex(state)];
    return { immediateText: renderShopCatalog(pc, stealth, state) };
  }
  if (lower.startsWith('buy ') || lower === 'repair') {
    const pcIdx = firstAlivePcIndex(state);
    const query = lower === 'repair' ? 'repair' : lower.slice(4).trim();
    state.lastEvents = buyShopEntry(state, world, pcIdx, query);
    return {};
  }
  if (lower === 'sell' || lower.startsWith('sell ')) {
    const pcIdx = firstAlivePcIndex(state);
    const query = lower === 'sell' ? 'all' : lower.slice(5).trim();
    state.lastEvents = sellInventoryItem(state, world, pcIdx, query || 'all');
    return {};
  }
  if (lower.startsWith('drop ')) {
    const pcIdx = firstAlivePcIndex(state);
    const pc = state.party.members[pcIdx];
    const idx = Number.parseInt(lower.slice(5).trim(), 10) - 1;
    if (Number.isNaN(idx) || !pc.inventory[idx]) {
      return { immediateText: `Invalid item #. Check "sheet".` };
    }
    const removed = pc.inventory.splice(idx, 1)[0];
    return { immediateText: `${pc.name} drops ${removed.name}.` };
  }
  if (lower === 'omen' || lower.startsWith('omen ')) {
    const pcIdx = state.mode === 'combat' ? syncActiveCombatTurnPc(state) : firstAlivePcIndex(state);
    const pc = state.party.members[pcIdx >= 0 ? pcIdx : firstAlivePcIndex(state)];
    const fs = ensureFeatureState(pc);
    const arg = lower.replace('omen', '').trim();
    if (!arg) {
      return {
        immediateText: `${pc.name} has ${pc.omens} Omen(s) | Armed: ${fs.omenArmed ?? 'none'}\nOmen Modes (Bare Bones p. 37):\n  omen dmg        Spend 1 Omen when hit to lower incoming damage by d6\n  omen reroll     Spend 1 Omen to reroll next failed test\n  omen neutralize Spend 1 Omen to neutralize next Fumble\n  omen dr         Spend 1 Omen to lower next test DR by -4\n  omen clear      Disarm pending Omen`,
      };
    }
    if (arg === 'clear' || arg === 'off') {
      fs.omenArmed = undefined;
      return { immediateText: `${pc.name} disarms pending Omen.` };
    }
    if (pc.omens <= 0) {
      return { immediateText: `${pc.name} has 0 Omens left.` };
    }
    const map: Record<string, 'reduce_dmg' | 'reroll' | 'neutralize' | 'lower_dr'> = {
      dmg: 'reduce_dmg',
      reduce: 'reduce_dmg',
      reroll: 'reroll',
      neutralize: 'neutralize',
      dr: 'lower_dr',
    };
    const chosen = map[arg];
    if (!chosen) {
      return { immediateText: 'Use: omen dmg | omen reroll | omen neutralize | omen dr | omen clear' };
    }
    fs.omenArmed = chosen;
    return { immediateText: `${pc.name} arms an Omen (${chosen}) for their next roll/hit!` };
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
    const activeRules = getActiveMiseryEffects(state).summaries;
    const ruleFooter = activeRules.length > 0 ? `\nActive World Modifiers:\n  - ${activeRules.join('\n  - ')}` : '';
    return {
      immediateText: `Calendar of Nechrubel (d${state.calendar.die}) | Day ${state.calendar.day} | Triggered ${state.calendar.triggeredMiseries.length}/7:\n${miseries}${ruleFooter}`,
    };
  }
  if (lower === 'map') {
    if (!state.activeDungeon) return { immediateText: 'You are not inside a Bedeviled Dungeon.' };
    return {
      immediateText: renderDungeonMap(state.activeDungeon),
    };
  }
  if (lower === 'look' || lower === 'l') {
    return {
      immediateText: describeCurrentRoomFull(state, world),
    };
  }
  if (lower === 'graveyard' || lower === 'history') {
    const profile = loadMetaProfile();
    const lines = [
      `=== Graveyard & Past Runs (Runs: ${profile.runsPlayed} | Apocalypses: ${profile.apocalypses} | Best Day: ${profile.bestDayReached}) ===`,
    ];
    if (profile.history.length === 0) {
      lines.push('  No completed or abandoned runs recorded yet.');
    } else {
      for (const h of profile.history.slice(0, 10)) {
        const survivors = h.survivors.length > 0 ? `Survivors: ${h.survivors.join(', ')}` : 'No survivors';
        const fallen = h.fallen.length > 0 ? `Fallen: ${h.fallen.join(', ')}` : 'No fallen';
        lines.push(`  [${h.date.slice(0, 10)}] ${h.outcome.toUpperCase()} — Day ${h.dayReached}, ${h.miseriesTriggered}/7 Miseries | ${survivors} | ${fallen}`);
      }
    }
    return { immediateText: lines.join('\n') };
  }
  if (lower.startsWith('equip ')) {
    const pcIdx = state.mode === 'combat' ? syncActiveCombatTurnPc(state) : firstAlivePcIndex(state);
    const num = Number.parseInt(lower.slice(6).trim(), 10);
    if (Number.isNaN(num) || num < 1) {
      return { immediateText: 'Usage: equip <item#> (check "sheet")' };
    }
    state.lastEvents = equipInventoryItem(state, world, pcIdx >= 0 ? pcIdx : firstAlivePcIndex(state), num - 1);
    return {};
  }
  if (lower.startsWith('give ')) {
    if (state.mode === 'combat') {
      return { immediateText: 'Cannot trade items mid-combat.' };
    }
    const pcIdx = firstAlivePcIndex(state);
    return { immediateText: giveBetweenPcs(state, pcIdx, lower.slice(5)).join('\n') };
  }

  // Non-combat scroll casting (combat casting goes through combat initiative turn below)
  if (state.mode !== 'combat' && (lower === 'cast' || lower.startsWith('cast '))) {
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
    if (chosen.expiresAtDawn && res.castAttempted) {
      const idx = pc.inventory.indexOf(chosen);
      if (idx >= 0) pc.inventory.splice(idx, 1);
    }
    state.lastEvents = res.logs;
    buildProceduralScene(state, world);
    return {};
  }

  // Combat mode handling (strictly deterministic, cycling every living PC in Agility+d6 initiative order)
  if (state.mode === 'combat' && state.activeCombat) {
    const combat = state.activeCombat;
    let pcIdx = syncActiveCombatTurnPc(state);
    if (pcIdx < 0) {
      combat.activeTurnIdx = 0;
      pcIdx = syncActiveCombatTurnPc(state);
    }
    if (pcIdx < 0) {
      const tpkLogs = finishCombatIfEnded(state);
      state.lastEvents = tpkLogs.length > 0 ? tpkLogs : ['No living party members remain.'];
      return {};
    }
    const activeEnemies = combat.enemies
      .map((e, idx) => ({ e, idx }))
      .filter((x) => x.e.status === 'active');
    const activeEnemyIdx = activeEnemies[0]?.idx ?? -1;
    const multiCount = activeEnemies.length;
    const numInput = Number.parseInt(trimmed, 10);
    const isNumericInput = !Number.isNaN(numInput) && String(numInput) === trimmed;
    const isDynamicTarget = isNumericInput && multiCount > 1 && numInput >= 1 && numInput <= multiCount;
    const isDynamicOmenMax = isNumericInput && (multiCount <= 1 ? numInput === 2 : numInput === multiCount + 1);
    const isDynamicOmenDr = isNumericInput && (multiCount <= 1 ? numInput === 3 : numInput === multiCount + 2);
    const isDynamicCast = isNumericInput && (multiCount <= 1 ? numInput === 4 : numInput === multiCount + 3);
    const isDynamicFlee = isNumericInput && (multiCount <= 1 ? numInput === 5 : numInput === multiCount + 4);
    const isSingleAttack = isNumericInput && multiCount <= 1 && numInput === 1;
    const logs: string[] = [];

    if (isDynamicFlee || lower === 'flee') {
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
    } else if (isDynamicCast || lower === 'cast' || lower.startsWith('cast ')) {
      const pc = state.party.members[pcIdx];
      const scrolls = pc.inventory.filter((i) => i.kind === 'unclean_scroll' || i.kind === 'sacred_scroll');
      if (scrolls.length === 0) {
        return { immediateText: `${pc.name} has no scrolls to cast.` };
      }
      const arg = lower.startsWith('cast') ? lower.replace('cast', '').trim() : '';
      const reqNum = Number.parseInt(arg, 10);
      const scroll = !Number.isNaN(reqNum) && scrolls[reqNum - 1] ? scrolls[reqNum - 1] : scrolls[0];
      const res = castScroll(state, world, pcIdx, scroll);
      if (scroll.expiresAtDawn && res.castAttempted) {
        const idx = pc.inventory.indexOf(scroll);
        if (idx >= 0) pc.inventory.splice(idx, 1);
      }
      logs.push(...res.logs);
    } else if (lower === 'bite') {
      const pc = state.party.members[pcIdx];
      if (pc.classId !== 'fanged_deserter') {
        return { immediateText: `${pc.name} is not a Fanged Deserter.` };
      }
      if (activeEnemyIdx >= 0) {
        logs.push(...resolvePcAttack(state, pcIdx, activeEnemyIdx, { isFangedBite: true }));
      }
    } else if (lower === 'parley') {
      if (!canParleyInCombat(state)) {
        return { immediateText: 'Parley is only possible in Round 1 against non-boss, thinking foes before blood is drawn.' };
      }
      logs.push(...resolveCombatParley(state, world, pcIdx));
      if (state.mode !== 'combat') {
        state.lastEvents = logs;
        buildProceduralScene(state, world);
        return {};
      }
    } else if (lower === 'feature') {
      logs.push(...activateClassFeature(state, world, pcIdx));
    } else if (lower.startsWith('use ')) {
      const { itemIdx, targetPcIdx } = parseUseCommandArgs(lower.slice(4));
      logs.push(...useInventoryItem(state, world, pcIdx, itemIdx, targetPcIdx));
    } else if (lower === 'shield') {
      const pc = state.party.members[pcIdx];
      if (!pc.hasShield) {
        return { immediateText: `${pc.name} does not have a shield.` };
      }
      ensureFeatureState(pc).shieldBreakArmed = true;
      return { immediateText: `${pc.name} braces their shield — it will SHATTER to absorb the next hit!` };
    } else if (isSingleAttack || isDynamicTarget || isDynamicOmenMax || isDynamicOmenDr || lower.startsWith('attack')) {
      let targetIdx = activeEnemyIdx;
      if (isDynamicTarget) {
        targetIdx = activeEnemies[numInput - 1].idx;
      } else if (lower.startsWith('attack ')) {
        const req = Number.parseInt(lower.slice(7).trim(), 10) - 1;
        if (combat.enemies[req]?.status === 'active') targetIdx = req;
      }
      if (targetIdx >= 0) {
        logs.push(
          ...resolvePcAttack(state, pcIdx, targetIdx, {
            useOmenMaxDmg: isDynamicOmenMax,
            useOmenLowerDr: isDynamicOmenDr,
          }),
        );
      }
    } else {
      return { immediateText: 'In combat: choose listed action #, "attack <#>", "bite", "feature", "use <#>", "shield", "cast", or "flee".' };
    }

    const endEarly = finishCombatIfEnded(state, world);
    if (endEarly.length > 0) {
      logs.push(...endEarly);
      state.lastEvents = logs;
      buildProceduralScene(state, world);
      return {};
    }

    // Advance to the next living PC in Agility+d6 initiative order
    combat.activeTurnIdx += 1;
    const nextPcIdx = syncActiveCombatTurnPc(state);
    if (nextPcIdx >= 0) {
      logs.push(`Next in initiative: ${state.party.members[nextPcIdx].name}.`);
      state.lastEvents = logs;
      return {};
    }

    // All living PCs have acted this round — enemies respond and round advances
    logs.push(...resolveAllActiveEnemyTurns(state));
    combat.round += 1;
    combat.activeTurnIdx = 0;
    const endAfter = finishCombatIfEnded(state, world);
    logs.push(...endAfter);
    if (endAfter.length > 0 && state.mode !== 'game_over') {
      buildProceduralScene(state, world);
    } else if (state.mode === 'combat') {
      syncActiveCombatTurnPc(state);
    }
    state.lastEvents = logs;
    return {};
  }

  // Deterministic non-combat actions
  if (lower === 'feature') {
    const pcIdx = firstAlivePcIndex(state);
    state.lastEvents = activateClassFeature(state, world, pcIdx);
    buildProceduralScene(state, world);
    return {};
  }
  if (lower === 'use' || lower.startsWith('use ')) {
    const pcIdx = firstAlivePcIndex(state);
    const { itemIdx, targetPcIdx } = parseUseCommandArgs(lower.replace('use', ''));
    if (itemIdx < 0) {
      return { immediateText: 'Specify an inventory item number (check "sheet"): use <item#> [pc#]' };
    }
    state.lastEvents = useInventoryItem(state, world, pcIdx, itemIdx, targetPcIdx);
    buildProceduralScene(state, world);
    return {};
  }
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
    if (state.mode !== 'exploration' || state.activeContract.phase !== 'briefing') {
      return { immediateText: 'Outcast sellswords can only be hired during Briefing (or found in travel/dungeon cells).' };
    }
    const res = recruitOutcastFollower(state, world, { costSilver: 25, pcIndex: firstAlivePcIndex(state) });
    if (res.ok) state.activeContract.outcastHired = true;
    state.lastEvents = [res.message];
    buildProceduralScene(state, world);
    return {};
  }
  if (lower === 'leave dungeon' && state.activeDungeon) {
    if (state.activeDungeon.currentRoomId !== 0) {
      return { immediateText: 'You must return to the Entrance (Room #1) before leaving the dungeon.' };
    }
    state.lastEvents = resolveChoiceOption(state, world, {
      label: 'Climb out to the surface',
      actionId: 'dungeon_leave',
    });
    return {};
  }
  if (lower.startsWith('move ') && state.activeDungeon) {
    const targetNum = Number.parseInt(lower.slice(5).trim(), 10);
    const targetId = targetNum - 1;
    state.lastEvents = resolveChoiceOption(state, world, {
      label: `Move to Room #${targetNum}`,
      actionId: 'dungeon_move',
      targetId,
    });
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
