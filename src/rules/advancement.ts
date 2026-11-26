import type { WorldDatabase } from '../db/loader.ts';
import type { AbilityName, Character, GameState } from '../types.ts';
import { rollDice, rollDie } from '../dice.ts';

export function improveCharacter(
  pc: Character,
  state: GameState,
  world: WorldDatabase,
): string[] {
  if (pc.status === 'dead') {
    return [`${pc.name} is dead and cannot improve.`];
  }

  const logs: string[] = [
    '[Getting Better Table] HP: 6d10 >= MaxHP -> +d6 HP | Debris d6: 1-3 none, 4 3d10s, 5 Unclean, 6 Sacred | Abilities d6: >= cur (+1), < cur (-1)',
  ];

  // 1. More HP: Roll 6d10 >= current maxHP -> +d6 maxHP (p. 33)
  const hpCheck = rollDice(6, 10, state);
  if (hpCheck >= pc.maxHp) {
    const gain = rollDie(6, state);
    pc.maxHp += gain;
    pc.hp = Math.min(pc.maxHp, pc.hp + gain);
    logs.push(`${pc.name} HP check 6d10(${hpCheck}) >= ${pc.maxHp - gain}: +${gain} max HP (now ${pc.maxHp}).`);
  } else {
    logs.push(`${pc.name} HP check 6d10(${hpCheck}) < ${pc.maxHp}: no HP increase.`);
  }

  // 2. Left in the debris (d6)
  const debris = rollDie(6, state);
  if (debris <= 3) {
    logs.push(`${pc.name} debris roll d6(${debris}): nothing found.`);
  } else if (debris === 4) {
    const silverGain = rollDice(3, 10, state);
    pc.silver += silverGain;
    logs.push(`${pc.name} debris roll d6(4): found ${silverGain}s.`);
  } else if (debris === 5) {
    const s = world.uncleanScrolls[rollDie(world.uncleanScrolls.length, state) - 1];
    pc.inventory.push({
      id: `debris_${Date.now()}_${rollDie(999, state)}`,
      name: `Unclean Scroll: ${s.name}`,
      kind: 'unclean_scroll',
      scrollKind: 'unclean',
      scrollRoll: s.roll,
      notes: s.effect,
    });
    logs.push(`${pc.name} debris roll d6(5): found Unclean Scroll (${s.name}).`);
  } else {
    const s = world.sacredScrolls[rollDie(world.sacredScrolls.length, state) - 1];
    pc.inventory.push({
      id: `debris_${Date.now()}_${rollDie(999, state)}`,
      name: `Sacred Scroll: ${s.name}`,
      kind: 'sacred_scroll',
      scrollKind: 'sacred',
      scrollRoll: s.roll,
      notes: s.effect,
    });
    logs.push(`${pc.name} debris roll d6(6): found Sacred Scroll (${s.name}).`);
  }

  // 3. Ability changes (p. 33)
  const keys: AbilityName[] = ['agility', 'presence', 'strength', 'toughness'];
  const changes: string[] = [];
  for (const key of keys) {
    const cur = pc.abilities[key];
    const r = rollDie(6, state);
    let next = cur;
    if (cur <= 1) {
      next = r === 1 ? Math.max(-3, cur - 1) : Math.min(6, cur + 1);
    } else {
      next = r >= cur ? Math.min(6, cur + 1) : Math.max(-3, cur - 1);
    }
    pc.abilities[key] = next;
    changes.push(`${key.slice(0, 3).toUpperCase()} d6(${r}): ${cur >= 0 ? `+${cur}` : cur}->${next >= 0 ? `+${next}` : next}`);
  }
  pc.carryingCapacity = Math.max(1, pc.abilities.strength + 8);
  logs.push(`${pc.name} abilities: ${changes.join(', ')}.`);

  return logs;
}
