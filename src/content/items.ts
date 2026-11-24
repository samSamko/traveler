import { loadWorldDatabase } from '../db/loader.ts';

const world = loadWorldDatabase();

export const ITEMS = world.items;
export const RECIPES = world.recipes;
