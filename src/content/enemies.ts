import { loadWorldDatabase } from '../db/loader.ts';

const world = loadWorldDatabase();

export const ENEMIES = world.enemies;
