import { loadWorldDatabase } from '../db/loader.ts';

const world = loadWorldDatabase();

export const ABILITIES = world.abilities;
export const RACES = world.races;
export const BACKGROUNDS = world.backgrounds;
export const HEIRLOOMS = world.heirlooms;
export const PERKS = world.perks;
