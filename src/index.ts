import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';
import type {
  AnatomyProfile,
  AppearanceSelections,
  BackgroundId,
  GameState,
  RaceId,
  SexId,
  SouthernPastId,
  SurvivalMode,
} from './types.ts';
import { BACKGROUNDS, RACES, SOUTHERN_PASTS } from './content/characters.ts';
import { createNewGame, processInput, renderCurrentScreen } from './engine.ts';
import { loadGame, loadMetaProfile, recordRunCompletion, saveGame } from './save.ts';
import { paint } from './ui.ts';
import {
  buildPlayerAnatomy,
  getAppearanceOptionsFor,
  rollDefaultAnatomy,
} from './writing/anatomy.ts';

class LineReader {
  private lines: string[] = [];
  private closed = false;
  private waiter: ((line: string | null) => void) | null = null;
  private rl: ReturnType<typeof createInterface>;

  constructor() {
    this.rl = createInterface({ input: stdin });
    this.rl.on('line', (line) => {
      if (this.waiter) {
        const resolve = this.waiter;
        this.waiter = null;
        resolve(line);
      } else {
        this.lines.push(line);
      }
    });
    this.rl.on('close', () => {
      this.closed = true;
      if (this.waiter) {
        const resolve = this.waiter;
        this.waiter = null;
        resolve(null);
      }
    });
  }

  async ask(prompt = '> '): Promise<string | null> {
    stdout.write(prompt);
    if (this.lines.length > 0) {
      return this.lines.shift() ?? null;
    }
    if (this.closed) {
      return null;
    }
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  close(): void {
    this.rl.close();
  }
}

function pickFromList<T extends string>(raw: string | null, ids: T[], defaultIdx = 0): T {
  const num = Number.parseInt((raw ?? '').trim(), 10);
  if (!Number.isNaN(num) && num >= 1 && num <= ids.length) {
    return ids[num - 1];
  }
  return ids[defaultIdx];
}

async function askOption(
  reader: LineReader,
  heading: string,
  options: string[],
): Promise<string> {
  console.log(`\n${heading}:`);
  options.forEach((opt, idx) => {
    console.log(`  ${idx + 1}. ${opt}`);
  });
  const raw = await reader.ask('> ');
  return pickFromList(raw, options, 0);
}

async function runAppearanceCustomizer(
  reader: LineReader,
  sex: SexId,
  race: RaceId,
  background: BackgroundId,
): Promise<AnatomyProfile> {
  console.log('\nAppearance:');
  console.log('  1. Quick Roll');
  console.log('  2. Customize');
  const modeRaw = await reader.ask('> ');
  if ((modeRaw ?? '').trim() !== '2') {
    return rollDefaultAnatomy(sex, race, background);
  }

  const opts = getAppearanceOptionsFor(sex, race);
  const height = await askOption(reader, 'Height', opts.height);
  const weight = await askOption(reader, 'Weight', opts.weight);
  const skinColor = await askOption(reader, 'Skin Color', opts.skinColor);
  const hairLength = await askOption(reader, 'Hair Length', opts.hairLength);
  const hairStyle =
    hairLength === 'Shaved'
      ? 'None'
      : await askOption(reader, 'Hair Style', opts.hairStyle);
  const hairColor =
    hairLength === 'Shaved'
      ? 'None'
      : await askOption(reader, 'Hair Color', opts.hairColor);
  const eyeShape = await askOption(reader, 'Eye Shape', opts.eyeShape);
  const eyeColor = await askOption(reader, 'Eye Color', opts.eyeColor);
  const musculature = await askOption(reader, 'Musculature', opts.musculature);
  const bodyShape = await askOption(reader, 'Build and Curves', opts.bodyShape);
  const facialScars = await askOption(reader, 'Facial Scars', opts.facialScars);
  const bodyScars = await askOption(reader, 'Body Scars', opts.bodyScars);
  const distinguishingMark = await askOption(
    reader,
    'Distinguishing Detail',
    opts.distinguishingMark,
  );

  const selections: AppearanceSelections = {
    height,
    weight,
    skinColor,
    hairLength,
    hairStyle,
    hairColor,
    eyeShape,
    eyeColor,
    musculature,
    bodyShape,
    facialScars,
    bodyScars,
    distinguishingMark,
  };

  return buildPlayerAnatomy(sex, race, background, selections);
}

async function runCharacterCreation(
  reader: LineReader,
  stealth: boolean,
): Promise<GameState> {
  const meta = loadMetaProfile();
  console.log('');
  console.log(paint('TRAVELER - THE NORTHERN EXPANSE', 'cyan', stealth));
  if (meta.runsPlayed > 0) {
    console.log(
      `Runs ${meta.runsPlayed} | Victories ${meta.victories} | Best Day ${meta.bestDayReached}`,
    );
  }

  console.log('\nSurvival Mode:');
  console.log('  1. Scarred Survival');
  console.log('  2. Ironman');
  const modeRaw = await reader.ask('> ');
  const survivalMode: SurvivalMode = (modeRaw ?? '').trim() === '2' ? 'ironman' : 'scarred';

  console.log('\nSex:');
  console.log('  1. Male');
  console.log('  2. Female');
  const sexRaw = await reader.ask('> ');
  const sex: SexId = (sexRaw ?? '').trim() === '2' ? 'female' : 'male';

  const raceIds: RaceId[] = ['vaelorian', 'ael_thalor', 'durnfolk', 'grixi'];
  console.log('\nRace:');
  raceIds.forEach((rid, idx) => {
    const r = RACES[rid];
    console.log(`  ${idx + 1}. ${r.name} - ${r.subtitle}`);
  });
  const raceRaw = await reader.ask('> ');
  const race = pickFromList(raceRaw, raceIds, 0);

  const bgIds: BackgroundId[] = [
    'ashen_blade',
    'root_scholar',
    'barrow_stalker',
    'shrine_penitent',
  ];
  console.log('\nBackground:');
  bgIds.forEach((bid, idx) => {
    const b = BACKGROUNDS[bid];
    console.log(`  ${idx + 1}. ${b.name} - ${b.subtitle}`);
  });
  const bgRaw = await reader.ask('> ');
  const background = pickFromList(bgRaw, bgIds, 0);

  const pastIds = Object.keys(SOUTHERN_PASTS) as SouthernPastId[];
  console.log('\nSouthern Past:');
  pastIds.forEach((pid, idx) => {
    const sp = SOUTHERN_PASTS[pid];
    console.log(`  ${idx + 1}. ${sp.name} - ${sp.subtitle}`);
  });
  const pastRaw = await reader.ask('> ');
  const southernPast = pickFromList(pastRaw, pastIds, 0);


  const anatomy = await runAppearanceCustomizer(reader, sex, race, background);

  console.log('\nName:');
  const nameRaw = await reader.ask('> ');
  const name = (nameRaw ?? '').trim() || 'Vesper';

  return createNewGame({
    name,
    sex,
    race,
    background,
    southernPast,
    survivalMode,
    anatomy,
    stealthMode: stealth,
  });
}

async function main(): Promise<void> {
  const stealthArg = process.argv.includes('--stealth');
  const reader = new LineReader();

  try {
    let state = loadGame();
    if (state) {
      if (stealthArg) state.stealthMode = true;
      console.log(`Resuming ${state.player.name} on Day ${state.day}.`);
    } else {
      state = await runCharacterCreation(reader, stealthArg);
      saveGame(state);
    }

    let pendingMsgs = [...state.lastMessages];
    while (true) {
      let screenOut = '';
      try {
        screenOut = renderCurrentScreen(state, pendingMsgs);
      } catch {
        state.combat = null;
        state.aftermath = null;
        state.activeEvent = null;
        state.activeMerchant = null;
        state.locationId = 'camp_hub';
        state.scene = 'camp_hub';
        state.subMenu = 'root';
        screenOut = renderCurrentScreen(state, [
          'Cold fog disrupts your bearings; you fall back to your Lone Camp.',
        ]);
      }
      console.log('\n' + screenOut);
      pendingMsgs = [];

      if (state.scene === 'dead') {
        const result = recordRunCompletion(state, 'death');
        console.log('\nExpedition ended. Save erased.');
        break;
      }

      if (state.scene === 'ending') {
        const result = recordRunCompletion(state, 'victory', state.endingSummary ?? 'Victory');
        console.log('\nVictory recorded.');
        break;
      }

      const line = await reader.ask('\n> ');
      if (line === null) {
        saveGame(state);
        break;
      }

      const res = processInput(state, line);
      pendingMsgs = res.messages;
      state.lastMessages = res.messages.slice(-5);

      if (res.shouldQuit) {
        saveGame(state);
        console.log(pendingMsgs.join('\n'));
        break;
      }

      if (state.scene !== 'dead' && state.scene !== 'ending') {
        saveGame(state);
      }
    }
  } finally {
    reader.close();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exitCode = 1;
});
