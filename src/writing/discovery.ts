import type { ActiveEnemy, EntityDiscoveryState, GameState, NpcNode } from '../types.ts';

export function createInitialDiscovery(startingItems: string[]): EntityDiscoveryState {
  return {
    knownPlaces: ['cinderford'],
    knownNpcs: [],
    knownItems: [...new Set(startingItems)],
    knownEnemies: {},
  };
}

export function markPlaceSeen(state: GameState, locationId: string): boolean {
  const firstTime = !state.discovery.knownPlaces.includes(locationId);
  if (firstTime) {
    state.discovery.knownPlaces.push(locationId);
  }
  return firstTime;
}

export function markNpcMet(state: GameState, npcId: string): boolean {
  const firstTime = !state.discovery.knownNpcs.includes(npcId);
  if (firstTime) {
    state.discovery.knownNpcs.push(npcId);
  }
  return firstTime;
}

export function markItemSeen(state: GameState, itemId: string): void {
  if (!state.discovery.knownItems.includes(itemId)) {
    state.discovery.knownItems.push(itemId);
  }
}

export function markEnemySeen(state: GameState, templateId: string): boolean {
  const existing = state.discovery.knownEnemies[templateId];
  if (!existing) {
    state.discovery.knownEnemies[templateId] = {
      seen: true,
      identified: false,
      appraisalTier: 0,
      observedAttacks: [],
    };
    return true;
  }
  existing.seen = true;
  return false;
}

export function identifyEnemy(state: GameState, templateId: string): void {
  markEnemySeen(state, templateId);
  state.discovery.knownEnemies[templateId].identified = true;
}

export function upgradeEnemyAppraisal(
  state: GameState,
  templateId: string,
  tier: 0 | 1 | 2,
): void {
  markEnemySeen(state, templateId);
  const rec = state.discovery.knownEnemies[templateId];
  if (tier > rec.appraisalTier) {
    rec.appraisalTier = tier;
  }
  if (tier >= 2) {
    rec.identified = true;
  }
}

export function recordEnemyAttackObserved(
  state: GameState,
  templateId: string,
  attackLabel: string,
): void {
  markEnemySeen(state, templateId);
  const rec = state.discovery.knownEnemies[templateId];
  if (!rec.observedAttacks.includes(attackLabel)) {
    rec.observedAttacks.push(attackLabel);
  }
}

export function getEnemyDisplayName(state: GameState, enemy: ActiveEnemy): string {
  const known = state.discovery.knownEnemies[enemy.templateId];
  const isNamed = enemy.identified || Boolean(known?.identified);
  const base = isNamed ? enemy.name : enemy.unidentifiedName;
  return enemy.suffix ? `${base} ${enemy.suffix}` : base;
}

export function getNpcDisplayName(state: GameState, npc: NpcNode): string {
  return state.discovery.knownNpcs.includes(npc.id) ? npc.shortLabel : npc.unidentifiedLabel;
}
