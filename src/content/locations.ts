import { loadWorldDatabase } from '../db/loader.ts';

const world = loadWorldDatabase();

export const LOCATIONS = world.locations;
