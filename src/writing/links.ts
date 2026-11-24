import type { EntityLink } from '../types.ts';
import { loadWorldDatabase } from '../db/loader.ts';

export const ENTITY_LINKS: EntityLink[] = loadWorldDatabase().entityLinks;

export function getRelatedLinks(entityId: string): EntityLink[] {
  return ENTITY_LINKS.filter((l) => l.from === entityId || l.to === entityId);
}
