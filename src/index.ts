import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';
import type { BackgroundId, GameState, HeirloomId, RaceId, SexId } from './types.ts';
import { BACKGROUNDS, HEIRLOOMS, RACES } from './content/characters.ts';
import { createNewGame, processInput, renderCurrentScreen } from './engine.ts';
import { loadGame, loadMetaProfile, recordRunCompletion, saveGame } from './save.ts';
import { paint } from './ui.ts';

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

async function runCharacterCreation(
  reader: LineReader,
  stealth: boolean,
): Promise<GameState> {
  const meta = loadMetaProfile();
  console.log('');
  console.log(paint('=== TRAVELER: CHRONICLES OF THE GLOAMING REACH ===', 'cyan', stealth));
  if (meta.runsPlayed > 0) {
    console.log(
      `Meta History: ${meta.runsPlayed} runs | ${meta.victories} victories | Best Day: ${meta.bestDayReached}/14`,
    );
  }

  console.log('\nChoose Sex (shapes pronouns, oaths & faction reactions):');
  console.log('  1. Male (he/him — Brother / Lord)');
  console.log('  2. Female (she/her — Sister / Lady)');
  const sexRaw = await reader.ask('> ');
  const sex: SexId = (sexRaw ?? '').trim() === '2' ? 'female' : 'male';

  const raceIds: RaceId[] = ['vaelorian', 'ael_thalor', 'durnfolk', 'grixi'];
  console.log('\nChoose Race (unique stats, passive, cantrip & race-only choices):');
  raceIds.forEach((rid, idx) => {
    const r = RACES[rid];
    console.log(`  ${idx + 1}. ${r.name} — ${r.subtitle}`);
    console.log(`     ${r.passive.name}: ${r.passive.description}`);
  });
  const raceRaw = await reader.ask('> ');
  const race = pickFromList(raceRaw, raceIds, 0);

  const bgIds: BackgroundId[] = [
    'ashen_blade',
    'root_scholar',
    'barrow_stalker',
    'shrine_penitent',
  ];
  console.log('\nChoose Background (starting gear, skills, spells/miracles):');
  bgIds.forEach((bid, idx) => {
    const b = BACKGROUNDS[bid];
    console.log(`  ${idx + 1}. ${b.name} — ${b.subtitle} (${b.passive.name})`);
  });
  const bgRaw = await reader.ask('> ');
  const background = pickFromList(bgRaw, bgIds, 0);

  const unlocked = meta.unlockedHeirlooms;
  console.log('\nChoose Active Heirloom:');
  unlocked.forEach((hid, idx) => {
    const h = HEIRLOOMS[hid];
    console.log(`  ${idx + 1}. ${h.name} — ${h.combatDescription}`);
  });
  const lockedHeirlooms = (Object.keys(HEIRLOOMS) as HeirloomId[]).filter(
    (id) => !unlocked.includes(id),
  );
  if (lockedHeirlooms.length > 0) {
    console.log('  (Locked across runs:');
    for (const hid of lockedHeirlooms) {
      console.log(`   - ${HEIRLOOMS[hid].name}: ${HEIRLOOMS[hid].unlockRequirement}`);
    }
    console.log('  )');
  }
  const heirloomRaw = await reader.ask('> ');
  const heirloom = pickFromList(heirloomRaw, unlocked, 0);

  console.log('\nEnter Traveler Name (leave blank for "Vesper"):');
  const nameRaw = await reader.ask('> ');
  const name = (nameRaw ?? '').trim() || 'Vesper';

  return createNewGame({
    name,
    sex,
    race,
    background,
    heirloom,
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
      console.log(`Resuming saved expedition for ${state.player.name} (Day ${state.day}/${state.maxDays})...`);
    } else {
      state = await runCharacterCreation(reader, stealthArg);
      saveGame(state);
    }

    let pendingMsgs = [...state.lastMessages];
    while (true) {
      console.log('\n' + renderCurrentScreen(state, pendingMsgs));
      pendingMsgs = [];

      if (state.scene === 'dead') {
        const result = recordRunCompletion(state, 'death');
        console.log('\n[PERMADEATH] Your active expedition has ended and its save was erased.');
        if (result.newlyUnlocked.length > 0) {
          console.log(
            `Unlocked new Heirloom(s): ${result.newlyUnlocked.map((id) => HEIRLOOMS[id].name).join(', ')}!`,
          );
        }
        break;
      }

      if (state.scene === 'ending') {
        const result = recordRunCompletion(state, 'victory', state.endingSummary ?? 'Victory');
        console.log('\n[VICTORY] Expedition recorded in your persistent chronicle.');
        if (result.newlyUnlocked.length > 0) {
          console.log(
            `Unlocked new Heirloom(s): ${result.newlyUnlocked.map((id) => HEIRLOOMS[id].name).join(', ')}!`,
          );
        }
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
