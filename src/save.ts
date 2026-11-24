import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState, HeirloomId, MetaProfile } from './types.ts';
import { countBrokenSeals, hasFlag } from './memory.ts';

const DEFAULT_SAVE_DIR = join(process.cwd(), '.traveler-saves');

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function atomicWriteJson(targetPath: string, data: unknown): void {
  const tmpPath = `${targetPath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmpPath, targetPath);
}

export function saveGame(state: GameState, saveDir = DEFAULT_SAVE_DIR): void {
  ensureDir(saveDir);
  atomicWriteJson(join(saveDir, 'active_run.json'), state);
}

export function loadGame(saveDir = DEFAULT_SAVE_DIR): GameState | null {
  const path = join(saveDir, 'active_run.json');
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as GameState & {
      player: GameState['player'] & {
        weaponId?: string;
        armorId?: string;
        trinketId?: string | null;
      };
    };
    const p = parsed.player;
    if (!p.equipment) {
      p.equipment = {
        mainHand: p.weaponId ?? null,
        offHand: null,
        armor: p.armorId ?? null,
        cloak: null,
        trinket: p.trinketId ?? null,
      };
      delete p.weaponId;
      delete p.armorId;
      delete p.trinketId;
    }
    if (p.armorTierCurrent === undefined) p.armorTierCurrent = 1;
    if (p.weaponCoating === undefined) p.weaponCoating = null;
    if (p.reserves === undefined) p.reserves = 2;
    if (p.maxReserves === undefined) p.maxReserves = 2;
    if (p.grace === undefined) p.grace = 2;
    if (p.maxGrace === undefined) p.maxGrace = 2;
    if (parsed.clock) {
      if (!parsed.clock.paleShift) parsed.clock.paleShift = 'none';
      if (parsed.clock.paleShiftDaysLeft === undefined) parsed.clock.paleShiftDaysLeft = 0;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function deleteActiveSave(saveDir = DEFAULT_SAVE_DIR): void {
  const path = join(saveDir, 'active_run.json');
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

export function loadMetaProfile(saveDir = DEFAULT_SAVE_DIR): MetaProfile {
  const path = join(saveDir, 'meta_profile.json');
  if (!existsSync(path)) {
    return {
      runsPlayed: 0,
      victories: 0,
      unlockedHeirlooms: ['kiln_lantern'],
      bestDayReached: 0,
      history: [],
    };
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as MetaProfile;
  } catch {
    return {
      runsPlayed: 0,
      victories: 0,
      unlockedHeirlooms: ['kiln_lantern'],
      bestDayReached: 0,
      history: [],
    };
  }
}

export function saveMetaProfile(
  profile: MetaProfile,
  saveDir = DEFAULT_SAVE_DIR,
): void {
  ensureDir(saveDir);
  atomicWriteJson(join(saveDir, 'meta_profile.json'), profile);
}

export function recordRunCompletion(
  state: GameState,
  outcome: 'victory' | 'death',
  endingTitle?: string,
  saveDir = DEFAULT_SAVE_DIR,
): { profile: MetaProfile; newlyUnlocked: HeirloomId[] } {
  deleteActiveSave(saveDir);
  const profile = loadMetaProfile(saveDir);
  profile.runsPlayed += 1;
  if (outcome === 'victory') profile.victories += 1;
  profile.bestDayReached = Math.max(profile.bestDayReached, state.day);

  const newlyUnlocked: HeirloomId[] = [];
  const tryUnlock = (id: HeirloomId, condition: boolean) => {
    if (condition && !profile.unlockedHeirlooms.includes(id)) {
      profile.unlockedHeirlooms.push(id);
      newlyUnlocked.push(id);
    }
  };

  const eliteSlain =
    hasFlag(state, 'star_stag_resolved') ||
    hasFlag(state, 'forge_cleared') ||
    hasFlag(state, 'vorne_resolved') ||
    hasFlag(state, 'kale_husk_slain');

  tryUnlock('orin_bell_shard', state.day >= 7 || eliteSlain || outcome === 'victory');
  tryUnlock(
    'star_dew_vial',
    countBrokenSeals(state) >= 2 ||
      state.memory.factions.silken_cistern >= 2 ||
      outcome === 'victory',
  );
  tryUnlock('grixi_chronometer', state.player.crowns >= 100 || outcome === 'victory');

  profile.history.unshift({
    name: state.player.name,
    race: state.player.race,
    background: state.player.background,
    sex: state.player.sex,
    outcome,
    day: state.day,
    level: state.player.level,
    endingTitle,
  });
  profile.history = profile.history.slice(0, 15);

  saveMetaProfile(profile, saveDir);
  return { profile, newlyUnlocked };
}
