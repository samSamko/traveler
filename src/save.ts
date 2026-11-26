import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState, MetaProfile } from './types.ts';

export const DEFAULT_SAVE_DIR = join(process.cwd(), '.morkborg-saves');

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
    const parsed = JSON.parse(raw) as GameState;
    if (!parsed || parsed.version !== 2 || !parsed.party || !Array.isArray(parsed.party.members) || !parsed.activeContract) {
      return null;
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
      apocalypses: 0,
      bestDayReached: 0,
      history: [],
    };
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as MetaProfile;
  } catch {
    return {
      runsPlayed: 0,
      apocalypses: 0,
      bestDayReached: 0,
      history: [],
    };
  }
}

export function saveMetaProfile(profile: MetaProfile, saveDir = DEFAULT_SAVE_DIR): void {
  ensureDir(saveDir);
  atomicWriteJson(join(saveDir, 'meta_profile.json'), profile);
}

export function recordRunCompletion(
  state: GameState,
  outcome: 'apocalypse' | 'tpk' | 'abandoned',
  saveDir = DEFAULT_SAVE_DIR,
): MetaProfile {
  const profile = loadMetaProfile(saveDir);
  profile.runsPlayed += 1;
  if (outcome === 'apocalypse') {
    profile.apocalypses += 1;
  }
  if (state.calendar.day > profile.bestDayReached) {
    profile.bestDayReached = state.calendar.day;
  }
  profile.history.unshift({
    date: new Date().toISOString(),
    outcome,
    dayReached: state.calendar.day,
    miseriesTriggered: state.calendar.triggeredMiseries.length,
    survivors: state.party.members.filter((m) => m.status !== 'dead').map((m) => m.name),
    fallen: state.party.members.filter((m) => m.status === 'dead').map((m) => m.name),
  });
  profile.history = profile.history.slice(0, 20);
  saveMetaProfile(profile, saveDir);
  if (outcome !== 'abandoned') {
    deleteActiveSave(saveDir);
  }
  return profile;
}
