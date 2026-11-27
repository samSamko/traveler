import assert from 'node:assert/strict';
import type { WorldDatabase } from '../src/db/loader.ts';
import type { GameState } from '../src/types.ts';

export function assertStateInvariants(
  state: GameState,
  _world: WorldDatabase,
  context: string,
): void {
  assert.equal(state.version, 2, `${context}: version must stay 2`);
  assert.ok(state.calendar.day >= 1, `${context}: day >= 1`);
  assert.ok(state.calendar.hour >= 0 && state.calendar.hour < 24, `${context}: hour in 0..23`);

  assert.equal(
    state.mode === 'combat',
    state.activeCombat !== null,
    `${context}: combat mode must strictly match activeCombat presence`,
  );

  if (state.activeCombat) {
    const alivePcs = state.party.members.filter((m) => m.status === 'alive');
    assert.ok(alivePcs.length > 0, `${context}: activeCombat requires >= 1 alive PC`);
    const activePc = state.party.members[state.party.activePcIndex];
    assert.ok(activePc && activePc.status === 'alive', `${context}: activePcIndex must point to an alive PC during combat`);
  }

  if (state.activeDungeon) {
    const d = state.activeDungeon;
    assert.ok(d.rooms.length >= 4 && d.rooms.length <= 22, `${context}: dungeon room count 4..22`);
    assert.ok(
      d.currentRoomId >= 0 && d.currentRoomId < d.rooms.length,
      `${context}: currentRoomId (${d.currentRoomId}) out of bounds`,
    );
  }

  for (const pc of state.party.members) {
    assert.ok(Number.isFinite(pc.hp) && pc.hp <= pc.maxHp, `${context}: ${pc.name} hp (${pc.hp}) <= maxHp (${pc.maxHp})`);
    assert.ok(pc.maxHp >= 1, `${context}: ${pc.name} maxHp >= 1`);
    assert.ok(pc.silver >= 0, `${context}: ${pc.name} silver >= 0`);
    assert.ok(pc.omens >= 0, `${context}: ${pc.name} omens >= 0`);
    assert.ok(pc.powersRemaining >= 0, `${context}: ${pc.name} powersRemaining >= 0`);
    assert.ok(pc.foodDays >= 0 && pc.waterDays >= 0, `${context}: ${pc.name} food/water >= 0`);
    assert.ok(pc.armorTier >= 0 && pc.armorTier <= 3, `${context}: ${pc.name} armorTier in 0..3`);
    if (pc.armorTier > 0) {
      assert.ok(pc.armorTier <= pc.armorMaxTier, `${context}: ${pc.name} armorTier <= armorMaxTier`);
    }
    if (pc.status !== 'dead' && !pc.featureState?.immortalTorchMinutes) {
      assert.ok(pc.hp >= 0, `${context}: non-dead PC ${pc.name} without Immortal Torch has hp >= 0 (got ${pc.hp})`);
    }
  }

  const corruptRe = /\(NaN\)|=\s*NaN\b|\bNaN\s*(?:HP|dmg|s)\b|\(undefined\)|\[object Object\]/;
  for (const ev of state.lastEvents) {
    assert.ok(!corruptRe.test(ev), `${context}: corrupt event "${ev}"`);
  }
  assert.ok(!corruptRe.test(state.pendingNarration), `${context}: corrupt narration`);
}

export function assertSaveRoundtrip(state: GameState, context: string): void {
  const cloned = JSON.parse(JSON.stringify(state)) as GameState;
  assert.deepStrictEqual(cloned, state, `${context}: JSON serialization roundtrip mismatch`);
}
