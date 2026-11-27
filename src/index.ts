import { stdout } from 'node:process';
import type { CalendarDie, ClassId, GameState } from './types.ts';
import { loadWorldDatabase, type WorldDatabase } from './db/loader.ts';
import { initializeOpeningScene, processPlayerInput } from './engine.ts';
import { createInitialGameState, rollPartySize } from './rules/chargen.ts';
import { deleteActiveSave, loadGame, recordRunCompletion, saveGame } from './save.ts';
import {
  animateInlineRoll,
  closeTerminal,
  getGameScreenParts,
  initTerminal,
  paint,
  pauseTransition,
  pickRandomRollPrompt,
  readTerminalLine,
  renderAbilityModTable,
  renderCharacterSheet,
  renderClassRollModifiers,
  typewriteText,
} from './ui.ts';

async function promptManualRoll(stealth: boolean, contextLabel?: string): Promise<void> {
  if (stealth || !stdout.isTTY) return;
  const flavor = pickRandomRollPrompt();
  const prefix = contextLabel ? `[${contextLabel}] ` : '[Roll] ';
  await readTerminalLine(paint(`\n  ${prefix}${flavor} (Press Enter) > `, 'ochre', false));
}

async function doManualRoll(
  label: string,
  stealth: boolean,
  noAnim: boolean,
  options?: { context?: string; isGmRoll?: boolean },
): Promise<void> {
  await promptManualRoll(stealth || noAnim, options?.context);
  await animateInlineRoll(label, stealth, { isGmRoll: options?.isGmRoll, noAnim });
}

async function askValidOption(
  validOptions: string[],
  prompt = '> ',
  eofFallback?: string,
): Promise<string> {
  const allowed = new Set(validOptions);
  while (true) {
    const raw = await readTerminalLine(prompt);
    if (raw === null) {
      return eofFallback ?? validOptions[0];
    }
    const trimmed = raw.trim();
    if (allowed.has(trimmed)) {
      return trimmed;
    }
    console.log(`Invalid input. Choose one of: ${validOptions.join(', ')}`);
  }
}

function isReadOnlyCommand(lower: string): boolean {
  return (
    lower === 'help' ||
    lower === '?' ||
    lower === 'summary' ||
    lower === 'overview' ||
    lower === 'party' ||
    lower === 'sheet' ||
    lower.startsWith('sheet ') ||
    lower.startsWith('pc ') ||
    lower === 'calendar' ||
    lower === 'map' ||
    lower === 'look' ||
    lower === 'l' ||
    lower === 'graveyard' ||
    lower === 'history' ||
    lower === 'tables' ||
    lower === 'mods' ||
    lower === 'shop' ||
    lower === 'repair' ||
    lower === 'omen' ||
    lower.startsWith('omen ') ||
    lower.startsWith('buy ') ||
    lower === 'sell' ||
    lower.startsWith('sell ') ||
    lower.startsWith('equip ') ||
    lower.startsWith('give ') ||
    lower.startsWith('drop ') ||
    lower === 'quit' ||
    lower === 'exit'
  );
}

function isPartyWideCommand(lower: string): boolean {
  return (
    lower === 'rest' ||
    lower === 'sleep' ||
    lower === 'breathe' ||
    lower === 'catch breath' ||
    lower === 'recruit' ||
    lower === 'leave dungeon'
  );
}

function shouldPromptManualRoll(state: GameState, lower: string): boolean {
  if (isReadOnlyCommand(lower)) return false;
  if (state.mode === 'combat') {
    const n = Number.parseInt(lower, 10);
    return (
      (!Number.isNaN(n) && String(n) === lower && n >= 1 && n <= 12) ||
      lower.startsWith('attack') ||
      lower === 'flee' ||
      lower === 'bite' ||
      lower === 'parley' ||
      lower === 'cast' ||
      lower.startsWith('cast ')
    );
  }
  return true;
}

async function promptCharacterSelection(
  state: GameState,
  stealth: boolean,
): Promise<void> {
  const living = state.party.members
    .map((m, idx) => ({ m, idx }))
    .filter((x) => x.m.status === 'alive');
  if (living.length <= 1) {
    if (living.length === 1) state.party.activePcIndex = living[0].idx;
    return;
  }

  const list = living
    .map((x) => `[${x.idx + 1}] ${x.m.name} (${x.m.className}, HP ${x.m.hp}/${x.m.maxHp})`)
    .join(' | ');
  console.log(paint(`\nWhich character acts? ${list}`, 'yellow', stealth));
  const active = state.party.members[state.party.activePcIndex];
  const raw = await readTerminalLine(`PC (Enter for ${active?.name ?? '1'}) > `);
  const num = Number.parseInt((raw ?? '').trim(), 10);
  if (!Number.isNaN(num) && num >= 1 && num <= state.party.members.length) {
    if (state.party.members[num - 1].status === 'alive') {
      state.party.activePcIndex = num - 1;
    }
  }
}

function fmtMod(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

async function revealCharacterCreationRolls(
  state: GameState,
  world: WorldDatabase,
  stealth: boolean,
  noAnim: boolean,
): Promise<void> {
  const isInteractive = !stealth && !noAnim && Boolean(stdout.isTTY);

  for (let idx = 0; idx < state.party.members.length; idx += 1) {
    const pc = state.party.members[idx];
    const cls = pc.classId !== 'classless' ? world.classesById[pc.classId] : undefined;
    if (isInteractive) {
      const r = pc.creationRolls ?? {};
      console.log(paint(`\n=== Forging Wretch #${idx + 1} (${pc.className}) ===`, 'pink', false));
      console.log(renderClassRollModifiers(cls, false));
      await doManualRoll(`Name (d6+d8): ${r.name ?? pc.name}`, stealth, noAnim, { context: 'Name' });
      console.log('\n' + renderAbilityModTable(false));
      await doManualRoll(`Agility (${r.agilityFormula ?? cls?.abilityRolls.agility ?? '3d6'}): ${r.agility ?? fmtMod(pc.abilities.agility)}`, stealth, noAnim, { context: 'Agility' });
      await doManualRoll(`Presence (${r.presenceFormula ?? cls?.abilityRolls.presence ?? '3d6'}): ${r.presence ?? fmtMod(pc.abilities.presence)}`, stealth, noAnim, { context: 'Presence' });
      await doManualRoll(`Strength (${r.strengthFormula ?? cls?.abilityRolls.strength ?? '3d6'}): ${r.strength ?? fmtMod(pc.abilities.strength)}`, stealth, noAnim, { context: 'Strength' });
      await doManualRoll(`Toughness (${r.toughnessFormula ?? cls?.abilityRolls.toughness ?? '3d6'}): ${r.toughness ?? fmtMod(pc.abilities.toughness)}`, stealth, noAnim, { context: 'Toughness' });
      await doManualRoll(`Hit Points (TOU+d${cls?.hpDie ?? 8}): ${r.hp ?? `${pc.maxHp} HP`}`, stealth, noAnim, { context: 'Hit Points' });
      await doManualRoll(`Omens (d${pc.omenDie}): ${r.omens ?? `${pc.omens} Omens`}`, stealth, noAnim, { context: 'Omens' });
      await doManualRoll(`Daily Powers (PRE+d4): ${r.powers ?? pc.powersMaxToday}`, stealth, noAnim, { context: 'Powers' });
      await doManualRoll(`Starting Silver (${cls?.silverFormula ?? '2d6x10'}): ${r.silver ?? `${pc.silver}s`}`, stealth, noAnim, { context: 'Silver' });
      await doManualRoll(`Weapon (${r.weaponFormula ?? `d${cls?.weaponDie ?? 10}`}): ${r.weapon ?? pc.weapon.name}`, stealth, noAnim, { context: 'Weapon' });
      await doManualRoll(`Armor (${r.armorFormula ?? `d${cls?.armorDie ?? 4}`}): ${r.armor ?? `${pc.armorName} (Tier ${pc.armorTier})`}`, stealth, noAnim, { context: 'Armor' });
      await doManualRoll(
        `Gear & Supplies (d6+d12+d12): ${r.gear ?? `${pc.containerName}, ${pc.inventory.map((i) => i.name).join('; ')}`} (${pc.foodDays}d food, ${pc.waterDays}d water)`,
        stealth,
        noAnim,
        { context: 'Equipment' },
      );
      if (cls) {
        await doManualRoll(`Origin (d${cls.originsDie}): ${r.origin ?? pc.traits.origin}`, stealth, noAnim, { context: 'Origin' });
      }
      await doManualRoll(`Terrible Traits (2d20): ${r.terrible ?? pc.traits.terrible.join(' / ')}`, stealth, noAnim, { context: 'Terrible Traits' });
      await doManualRoll(`Broken Body (d20): ${r.brokenBody ?? pc.traits.brokenBody}`, stealth, noAnim, { context: 'Broken Body' });
      await doManualRoll(`Bad Habit (d20): ${r.badHabit ?? pc.traits.badHabit}`, stealth, noAnim, { context: 'Bad Habit' });
      await doManualRoll(`Troubling Tale (d20): ${r.troublingTale ?? pc.traits.troublingTale}`, stealth, noAnim, { context: 'Troubling Tale' });
      if (pc.classFeatures.length > 0) {
        await doManualRoll(`Class Feature(s) (d6): ${r.classFeatures ?? pc.classFeatures.join(' | ')}`, stealth, noAnim, { context: 'Class Feature' });
      }
      console.log('');
    }
    console.log(renderCharacterSheet(pc, stealth));
    console.log('');
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const stealth = args.has('--stealth');
  const noAnim = args.has('--no-anim') || stealth;
  const world = loadWorldDatabase();

  initTerminal();
  try {
    console.log(paint('MÖRK BORG — Bare Bones Edition Simulator (Procedural Offline GM)', 'yellow', stealth));

    let state: GameState | null = loadGame();
    if (state) {
      console.log('\nExisting run found:');
      console.log('  1. Continue saved run');
      console.log('  2. Start new run (wipes active save)');
      const pick = await askValidOption(['1', '2'], '> ', '1');
      if (pick === '2') {
        deleteActiveSave();
        state = null;
      }
    }

    if (!state) {
      console.log(paint('\n--- The Dying World ---', 'pink', stealth));
      await typewriteText(
        'No one has seen the sun in years. Distances shift, paths warp, and the prophecies of the two-headed basilisk Verhu march toward inevitable annihilation.',
        stealth,
        { instant: noAnim },
      );

      console.log(paint('\n--- The Ash Ledger (Why You Descend) ---', 'ochre', stealth));
      await typewriteText(
        'Between Galgenbeck\'s gallows, Fathmu\'s tax-raids, and starvation, wretches like you live on borrowed breath. Every dirty job passes through the Blind Seer\'s tattered curtain — desperate patrons buy disposable necks with silver, sending you down into rot-choked vaults again and again until your purse is full, your bones break, or the Seventh Seal burns the world.',
        stealth,
        { instant: noAnim },
      );

      console.log(paint('\n--- The Calendar of Nechrubel ---', 'pink', stealth));
      await typewriteText(
        'Each dawn, a die is cast against the Nameless Scriptures. On a 1, a Misery befalls the world. When the seventh seal breaks at 7:7, the game and your lives end. Burn the book.',
        stealth,
        { instant: noAnim },
      );
      console.log('Select Calendar die (when will all this agony end?):');
      console.log('  1. d100 (Years of pain)');
      console.log('  2. d20  (A bleak half-year)');
      console.log('  3. d10  (A fall in anguish)');
      console.log('  4. d6   (A cruel month)');
      console.log('  5. d2   (The end is nigh!)');
      const calPick = await askValidOption(['1', '2', '3', '4', '5'], '> ', '3');
      const calMap: Record<string, CalendarDie> = {
        '1': 100,
        '2': 20,
        '3': 10,
        '4': 6,
        '5': 2,
      };
      const calendarDie: CalendarDie = calMap[calPick];

      console.log(paint('\n--- Party Fate ---', 'pink', stealth));
      await typewriteText(
        'Do you wander as a doomed band rolled by fate (d3+1), or walk alone into the dark as a single wretch?',
        stealth,
        { instant: noAnim },
      );
      console.log('  1. Rolled party (d3+1 wretches)');
      console.log('  2. Solo wretch (1 PC — brutal)');
      const soloPick = await askValidOption(['1', '2'], '> ', '1');
      const solo = soloPick === '2';

      console.log(paint('\n--- Characters (Scvm of the Dying World) ---', 'pink', stealth));
      await typewriteText(
        'Your characters are frail, scarred, and burdened by terrible traits, broken bodies, bad habits, and troubling tales. Most will die in the mud.',
        stealth,
        { instant: noAnim },
      );
      const seed = Date.now() >>> 0;
      const previewSize = solo ? { dieRoll: 0, count: 1 } : rollPartySize({ rngState: seed });
      if (solo) {
        console.log('Solo run selected: 1 PC.');
      } else {
        await doManualRoll(
          `Party size rolled: d3(${previewSize.dieRoll}) + 1 = ${previewSize.count} PCs.`,
          stealth,
          noAnim,
          { context: 'Party Size (d3+1)' },
        );
      }

      console.log('\nCharacter creation mode:');
      console.log('  1. Roll classes randomly (d7: 1-6 Optional Classes, 7 Classless Scvm)');
      console.log('  2. Choose class for each PC (with full modifiers)');
      const clsMode = await askValidOption(['1', '2'], '> ', '1');

      let classChoices: ClassId[] | undefined;
      if (clsMode === '1') {
        console.log(paint('\n--- Random Class Roll Table (d7) ---', 'ochre', stealth));
        for (let cIdx = 0; cIdx < world.classes.length; cIdx += 1) {
          const c = world.classes[cIdx];
          console.log(
            paint(
              `  ${cIdx + 1}. ${c.name} (AGI ${c.abilityRolls.agility}, PRE ${c.abilityRolls.presence}, STR ${c.abilityRolls.strength}, TOU ${c.abilityRolls.toughness} | HP TOU+d${c.hpDie}, Omens d${c.omenDie})`,
              'dim',
              stealth,
            ),
          );
        }
        console.log(
          paint(
            '  7. Classless Scvm (4d6 drop lowest on 2 abilities, 3d6 on 2 | HP TOU+d8, Omens d2)',
            'dim',
            stealth,
          ),
        );
      } else {
        console.log(paint('\n--- Classes & Roll Modifiers ---', 'pink', stealth));
        console.log(renderAbilityModTable(stealth));
        await typewriteText(
          '0. Classless Scvm — No class; 4d6 drop lowest on two abilities (3d6 on two), HP: TOU+d8, Omens: d2, Wpn: d10, Arm: d4, Silver: 2d6*10.',
          stealth,
          { instant: noAnim },
        );
        for (let cIdx = 0; cIdx < world.classes.length; cIdx += 1) {
          const c = world.classes[cIdx];
          await typewriteText(
            `${cIdx + 1}. ${c.name} — ${c.description}\n${renderClassRollModifiers(c, stealth)}`,
            stealth,
            { instant: noAnim },
          );
        }
        const idList: ClassId[] = [
          'classless',
          'fanged_deserter',
          'gutterborn_scum',
          'esoteric_hermit',
          'wretched_royalty',
          'heretical_priest',
          'occult_herbmaster',
        ];
        classChoices = [];
        for (let i = 0; i < previewSize.count; i += 1) {
          const cRaw = await askValidOption(['0', '1', '2', '3', '4', '5', '6'], `PC #${i + 1} class (0-6) > `, '0');
          const idx = Number.parseInt(cRaw, 10);
          classChoices.push(idList[idx]);
        }
      }

      state = createInitialGameState(world, {
        seed,
        calendarDie,
        solo,
        useRandomClasses: clsMode === '1',
        classChoices,
      });

      await revealCharacterCreationRolls(state, world, stealth, noAnim);

      if (!stealth && !noAnim && stdout.isTTY) {
        console.log(paint('--- Opening Fate ---', 'pink', false));
        const hr = state.hook.rolls;
        await doManualRoll(`Where do you wander? (d12): [${hr?.where ?? '?'}] -> ${state.hook.where} (${state.hook.regionName})`, stealth, noAnim, { context: 'Where (d12)' });
        await doManualRoll(`Weather (d12): [${hr?.weather ?? '?'}] -> ${state.hook.weather}`, stealth, noAnim, { context: 'Weather (d12)' });
        await doManualRoll(`Who contacts you? (d20): [${hr?.who ?? '?'}] -> ${state.hook.who}`, stealth, noAnim, { context: 'Contact (d20)' });
        await doManualRoll(`Adventure Spark (d100): [${hr?.spark ?? '?'}] -> ${state.hook.spark}`, stealth, noAnim, { context: 'Spark (d100)' });
        await readTerminalLine(paint('\nPress Enter to face the Seer and begin... ', 'yellow', false));
      }

      await pauseTransition('The Seer draws back the tattered curtain', stealth || noAnim, 500);
      initializeOpeningScene(state, world);
      saveGame(state);
    }

    while (true) {
      const parts = getGameScreenParts(state, stealth);
      if (parts.beforeNarration) console.log('\n' + parts.beforeNarration);
      if (parts.narration) {
        console.log('');
        await typewriteText(parts.narration, stealth, { instant: noAnim });
      }
      if (parts.afterNarration) console.log('\n' + parts.afterNarration);

      const input = await readTerminalLine('\n> ');
      if (input === null) break;

      const trimmed = input.trim();
      const lower = trimmed.toLowerCase();
      if (trimmed && state.mode !== 'game_over') {
        if (state.mode !== 'combat' && !isReadOnlyCommand(lower) && !isPartyWideCommand(lower)) {
          await promptCharacterSelection(state, stealth);
        }
        if (shouldPromptManualRoll(state, lower)) {
          await promptManualRoll(stealth || noAnim);
        }
      }

      if (trimmed && !isReadOnlyCommand(lower) && state.mode !== 'combat' && state.mode !== 'game_over') {
        const activePc = state.party.members[state.party.activePcIndex];
        await pauseTransition(`${activePc?.name ?? 'The party'} moves into the dark`, stealth || noAnim, 350);
      }

      const out = processPlayerInput(state, world, input, stealth);
      if (state.lastEvents.length > 0 && !out.immediateText) {
        console.log('');
        for (const ev of state.lastEvents) {
          const isGm =
            ev.includes('Dawn Day') ||
            ev.includes('MISERY') ||
            ev.includes('TRAP') ||
            ev.includes('hits ') ||
            ev.includes('Defend vs') ||
            ev.includes('casts ') ||
            ev.includes('Morale') ||
            ev.includes('Anomaly') ||
            ev.includes('shard') ||
            ev.includes('starves') ||
            ev.includes('infection') ||
            ev.includes('CATASTROPHE');
          await animateInlineRoll(ev, stealth, { isGmRoll: isGm, noAnim });
        }
        state.lastEvents = [];
      }
      if (out.immediateText) {
        console.log('\n' + out.immediateText);
      }
      if (out.shouldExit) {
        saveGame(state);
        console.log('Run saved. Farewell, scvm.');
        break;
      }

      if (state.mode === 'game_over') {
        const overParts = getGameScreenParts(state, stealth);
        if (overParts.beforeNarration) console.log('\n' + overParts.beforeNarration);
        if (overParts.narration) await typewriteText(overParts.narration, stealth, { instant: noAnim });
        if (overParts.afterNarration) console.log('\n' + overParts.afterNarration);
        const outcome = state.calendar.worldEnded ? 'apocalypse' : 'tpk';
        recordRunCompletion(state, outcome);
        break;
      }
      saveGame(state);
    }
  } finally {
    closeTerminal();
  }
}

main().catch((err) => {
  closeTerminal();
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
