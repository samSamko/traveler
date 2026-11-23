import type { FactionId, GameState } from './types.ts';

export const FACTION_NAMES: Record<FactionId, string> = {
  iron_vow: 'The Iron-Vow Garrison',
  silken_cistern: 'Matrons of the Silken Cistern',
  under_warren: 'Brass-Warren Guild',
  husk_choir: 'Resonance of the Pale Choir',
};

export function setFlag(
  state: GameState,
  key: string,
  value: boolean | number | string = true,
): void {
  state.memory.flags[key] = value;
}

export function getFlag(
  state: GameState,
  key: string,
): boolean | number | string | undefined {
  return state.memory.flags[key];
}

export function hasFlag(
  state: GameState,
  key: string,
  expected?: boolean | number | string,
): boolean {
  const val = state.memory.flags[key];
  if (expected !== undefined) {
    return val === expected;
  }
  return Boolean(val);
}

export function adjustFaction(
  state: GameState,
  faction: FactionId,
  delta: number,
): number {
  const current = state.memory.factions[faction] ?? 0;
  const clamped = Math.max(-5, Math.min(5, current + delta));
  state.memory.factions[faction] = clamped;
  return clamped;
}

export function getFactionStance(score: number): string {
  if (score >= 4) return 'Sworn Ally';
  if (score >= 2) return 'Trusted';
  if (score === 1) return 'Favorable';
  if (score === 0) return 'Neutral';
  if (score === -1) return 'Wary';
  if (score >= -3) return 'Hostile';
  return 'Hunted';
}

export function recordChronicle(
  state: GameState,
  title: string,
  summary: string,
  tag: string,
): void {
  const duplicate = state.memory.chronicle.some(
    (entry) => entry.title === title && entry.summary === summary,
  );
  if (!duplicate) {
    state.memory.chronicle.push({
      day: state.day,
      locationId: state.locationId,
      title,
      summary,
      tag,
    });
  }
}

export function pronouns(sex: 'male' | 'female'): {
  subj: string;
  obj: string;
  poss: string;
  formal: string;
  kinTitle: string;
} {
  if (sex === 'female') {
    return {
      subj: 'she',
      obj: 'her',
      poss: 'her',
      formal: 'Lady',
      kinTitle: 'Sister',
    };
  }
  return {
    subj: 'he',
    obj: 'him',
    poss: 'his',
    formal: 'Lord',
    kinTitle: 'Brother',
  };
}

export function countBrokenSeals(state: GameState): number {
  let count = 0;
  if (hasFlag(state, 'seal_of_silence')) count += 1;
  if (hasFlag(state, 'root_conduit_severed')) count += 1;
  if (hasFlag(state, 'kiln_cipher_learned')) count += 1;
  return count;
}

export function synthesizeEpilogue(
  state: GameState,
  endingId: 'shatter_belfry' | 'rekindle_kiln' | 'ascend_warden',
): string {
  const p = state.player;
  const lines: string[] = [];

  if (endingId === 'shatter_belfry') {
    lines.push(
      `With Malakor broken beneath the cracked bronze vault, ${p.name} drove the counter-chime into the Pale Heart. The Sunken Belfry collapsed into quiet ash, and for the first time in seven winters the mist lifted from the Gloaming Reach.`,
    );
  } else if (endingId === 'rekindle_kiln') {
    lines.push(
      `Speaking the ancient cipher of Aethel, ${p.name} fed the last Vesper-sparks into the First Kiln. Pale flame roared back through the basalt conduits, burning away the Husk-Tide yet casting the long iron shadow of a new Empire over the valley.`,
    );
  } else {
    lines.push(
      `${p.name} lifted Malakor's fractured bell-crown and pressed it onto ${pronouns(p.sex).poss} own brow. The Pale Root bowed in sudden silence. No third toll fell upon the frontier; instead, a watchful silence now answers only to ${p.name}.`,
    );
  }

  lines.push('');
  lines.push('FATE OF THE REACH');

  if (hasFlag(state, 'cinderford_fallen')) {
    lines.push(
      '* Cinderford Keep: Overwhelmed from within by the neglected granary spores, Cinderford stands empty, its bell-tower choked in white roots.',
    );
  } else if (hasFlag(state, 'granary_purified')) {
    lines.push(
      '* Cinderford Keep: Thanks to the purified granary, the border town endured the winter intact, remembering the traveler who saved both their walls and their bread.',
    );
  } else if (hasFlag(state, 'granary_burned')) {
    lines.push(
      '* Cinderford Keep: Spared the Husk-Tide by fire, Cinderford survived lean and bitter, its garrison cursing the smoke that lingered over empty stores.',
    );
  } else {
    lines.push(
      '* Cinderford Keep: The garrison held the walls through sheer iron stubbornness until the Belfry went quiet.',
    );
  }

  const kaleFate = getFlag(state, 'kale_fate');
  if (kaleFate === 'redeemed') {
    lines.push(
      "* Kale the Oath-Breaker: Redeemed on the Causeway, Kale fell at the Belfry steps after shattering Malakor's choir-ward — his name struck from the traitor rolls.",
    );
  } else if (kaleFate === 'executed') {
    lines.push(
      "* Kale the Oath-Breaker: Buried headless beneath the King's Causeway; his Iron-Vow bounty bought iron and bread.",
    );
  } else if (kaleFate === 'abandoned') {
    lines.push(
      '* Kale the Oath-Breaker: Claimed by the Pale Root, his prowling husk became a cautionary tale along the Causeway.',
    );
  }

  if (hasFlag(state, 'stole_cistern_vesper')) {
    lines.push(
      '* The Silken Cistern: Desecrated and drained of its Vesper-Font, the blind Matrons sealed their tunnels forever, cursing your lineage.',
    );
  } else if (state.memory.factions.silken_cistern >= 2) {
    lines.push(
      '* The Silken Cistern: The blind Matrons wove your deeds into their tapestries, naming you a shield of the deep waters.',
    );
  }

  if (hasFlag(state, 'vorne_redeemed')) {
    lines.push(
      '* Sir Vorne: Freed from hollowing by his own remembered oath, the old Bell-Knight laid down his watch in peace beside the Crown-Gate.',
    );
  } else if (hasFlag(state, 'vorne_slain')) {
    lines.push(
      '* Sir Vorne: Slain at the Crown-Gate watchtower, his bronze armor still ringing faintly in the mountain wind.',
    );
  }

  if (state.memory.chronicle.length > 0) {
    lines.push('');
    lines.push('CHRONICLE');
    for (const entry of state.memory.chronicle) {
      lines.push(`Day ${entry.day} - ${entry.title}: ${entry.summary}`);
    }
  }

  return lines.join('\n');
}
