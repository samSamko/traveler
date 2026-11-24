import { loadWorldDatabase } from '../db/loader.ts';

const world = loadWorldDatabase();

export const EVENTS = world.events;
