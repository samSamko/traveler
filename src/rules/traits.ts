import type { TraitProfileRecord, WorldDatabase } from '../db/loader.ts';
import type { Character, ChoiceOption, GameState } from '../types.ts';
import { rollDie } from '../dice.ts';

export function getCharacterTraitProfiles(pc: Character, world: WorldDatabase): TraitProfileRecord[] {
  const results: TraitProfileRecord[] = [];

  const matchRoll = (cat: TraitProfileRecord['category'], text: string) => {
    let table: Array<{ roll: number; text: string }> = [];
    if (cat === 'terrible') table = world.terribleTraits;
    else if (cat === 'broken_body') table = world.brokenBodies;
    else if (cat === 'bad_habit') table = world.badHabits;
    else table = world.troublingTales;

    const entry = table.find((e) => e.text === text);
    if (!entry) return;
    const prof = world.traitProfiles.find((p) => p.category === cat && p.roll === entry.roll);
    if (prof) results.push(prof);
  };

  matchRoll('terrible', pc.traits.terrible[0]);
  matchRoll('terrible', pc.traits.terrible[1]);
  matchRoll('broken_body', pc.traits.brokenBody);
  matchRoll('bad_habit', pc.traits.badHabit);
  matchRoll('troubling_tale', pc.traits.troublingTale);

  return results;
}

export function getTraitReactionModifier(pc: Character, world: WorldDatabase): number {
  return getCharacterTraitProfiles(pc, world).reduce((sum, p) => sum + p.reactionMod, 0);
}

export function getTraitDrModifier(
  pc: Character,
  context: string,
  world: WorldDatabase,
): number {
  return getCharacterTraitProfiles(pc, world).reduce((sum, p) => {
    if (p.drMod && p.drMod.context === context) {
      return sum + p.drMod.delta;
    }
    return sum;
  }, 0);
}

export function hasTraitTag(pc: Character, tag: string, world: WorldDatabase): boolean {
  return getCharacterTraitProfiles(pc, world).some((p) => p.tags.includes(tag));
}

export function pickTraitProseCallout(
  pc: Character,
  state: GameState,
  world: WorldDatabase,
): string | null {
  const profiles = getCharacterTraitProfiles(pc, world);
  if (profiles.length === 0) return null;

  const candidates: Array<{ id: string; text: string }> = [];
  for (const prof of profiles) {
    prof.proseVariants.forEach((tmpl, idx) => {
      const id = `tp_${prof.category}_${prof.roll}_${idx}`;
      candidates.push({ id, text: tmpl.replace(/\{name\}/g, pc.name) });
    });
  }

  const fresh = candidates.filter((c) => !state.recentProseIds.includes(c.id));
  const pool = fresh.length > 0 ? fresh : candidates;
  const chosen = pool[rollDie(pool.length, state) - 1];
  state.recentProseIds.push(chosen.id);
  if (state.recentProseIds.length > 24) {
    state.recentProseIds = state.recentProseIds.slice(-24);
  }
  return chosen.text;
}

export function getUnlockedTraitChoices(
  pc: Character,
  contextTags: Set<string>,
  world: WorldDatabase,
): ChoiceOption[] {
  const profiles = getCharacterTraitProfiles(pc, world);
  const seen = new Set<string>();
  const choices: ChoiceOption[] = [];

  for (const prof of profiles) {
    const uc = prof.unlockedChoice;
    if (!uc) continue;
    if (uc.contextTag !== 'always' && !contextTags.has(uc.contextTag)) continue;
    if (seen.has(uc.effectKey)) continue;
    seen.add(uc.effectKey);

    choices.push({
      label: uc.label,
      actionId: `trait:${uc.effectKey}`,
      requiresRoll: uc.effectKey === 'skull_counsel' || uc.effectKey === 'suspicious_probe' || uc.effectKey === 'hook_pry' || uc.effectKey === 'worm_listen' || uc.effectKey === 'shrewd_read' || uc.effectKey === 'deceitful_bluff' || uc.effectKey === 'gamble_wager',
      isTraitChoice: true,
    });
  }

  return choices;
}

export function rollTroublingTalePursuer(
  state: GameState,
  world: WorldDatabase,
): { pcIndex: number; creatureId: string; intro: string } | null {
  const living = state.party.members
    .map((m, idx) => ({ m, idx }))
    .filter((x) => x.m.status === 'alive');

  const pursuerCandidates: Array<{ pcIndex: number; pcName: string; creatureId: string; intro: string }> = [];
  for (const { m, idx } of living) {
    const profs = getCharacterTraitProfiles(m, world);
    for (const p of profs) {
      if (p.pursuer) {
        pursuerCandidates.push({
          pcIndex: idx,
          pcName: m.name,
          creatureId: p.pursuer.creatureId,
          intro: p.pursuer.intro.replace(/\{name\}/g, m.name),
        });
      }
    }
  }

  if (pursuerCandidates.length === 0) return null;
  if (rollDie(6, state) !== 1) return null;

  const picked = pursuerCandidates[rollDie(pursuerCandidates.length, state) - 1];
  return {
    pcIndex: picked.pcIndex,
    creatureId: picked.creatureId,
    intro: picked.intro,
  };
}
