import type { FactionId, GameState } from './types.ts';

export const FACTION_NAMES: Record<FactionId, string> = {
  iron_vow: 'Timber Post Watch',
  silken_cistern: 'Old Bathhouse Weavers',
  under_warren: 'Scrap-Tinker Guild',
  husk_choir: 'The Dome Cantors',
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
  endingId:
    | 'shatter_belfry'
    | 'rekindle_kiln'
    | 'ascend_warden'
    | 'frozen_debt'
    | 'quarry_chains'
    | 'consumed_rot'
    | 'dome_echo',
): string {
  const p = state.player;
  const lines: string[] = [];

  if (endingId === 'shatter_belfry') {
    lines.push(
      `With Malakor broken beneath the cracked bronze vault, ${p.name} drove steel into the bell-heart. The White Dome collapsed into quiet ash, though the black stone gate stayed shut and every trapped exile remained locked in the frost.`,
    );
  } else if (endingId === 'rekindle_kiln') {
    lines.push(
      `Tracing the Long Steps cipher, ${p.name} fed fire back into the deep stone flues. Warm orange smoke rolled up through the white streets, drawing starving deserters and scavengers to kneel beneath a harsh new master.`,
    );
  } else if (endingId === 'ascend_warden') {
    lines.push(
      `${p.name} lifted Malakor's fractured bronze circlet and pressed it onto ${pronouns(p.sex).poss} own brow. The blank-eyed walkers bowed in sudden stillness, answering only to ${p.name} across a dead, frost-locked plain.`,
    );
  } else if (endingId === 'frozen_debt') {
    lines.push(
      `Broken by frost and blood loss in the ditch, ${p.name} never rose again. Crows picked the oilcloth pack clean before sleet buried the bones beside a forgotten milestone.`,
    );
  } else if (endingId === 'quarry_chains') {
    lines.push(
      `Iron collars snapped shut around ${p.name}'s throat. Dragged down into the stepped black quarry under whips and salt rations, ${p.name} hauled stone blocks until frost blackened ${pronouns(p.sex).poss} toes and the chains passed to another prisoner.`,
    );
  } else if (endingId === 'consumed_rot') {
    lines.push(
      `Creeping numbness finally reached behind ${p.name}'s ribs. Sitting down on white marble without shivering, ${p.name} forgot ${pronouns(p.sex).poss} own name and joined the voiceless figures drifting under the pale sky.`,
    );
  } else {
    lines.push(
      `Reaching bare-handed into the humming silver rings beneath The White Dome stripped away every southern memory. Only an empty, dust-caked silhouette remained where ${p.name} had stood.`,
    );
  }

  lines.push('');
  lines.push('FATE OF THE NORTH');

  if (hasFlag(state, 'cinderford_fallen')) {
    lines.push(
      '* Timber Post: Overwhelmed from within by spoiled cellar rot, the stockade stands empty, its gate choked in grey frost.',
    );
  } else if (hasFlag(state, 'granary_purified')) {
    lines.push(
      '* Timber Post: With the winter barley spared, the trapped garrison outlasted the hardest freeze behind patched pine walls.',
    );
  } else if (hasFlag(state, 'granary_burned')) {
    lines.push(
      '* Timber Post: Spared sickness by fire, the post survived lean and bitter on salt pork and snow-melt.',
    );
  } else {
    lines.push(
      '* Timber Post: The garrison held the palisade through sheer stubbornness until firewood ran low.',
    );
  }

  const kaleFate = getFlag(state, 'kale_fate');
  if (kaleFate === 'redeemed') {
    lines.push(
      '* Kale the Deserter: Spared on the High Road, Kale fought at the White Dome gallery until bronze shards cut him down.',
    );
  } else if (kaleFate === 'executed') {
    lines.push(
      '* Kale the Deserter: Buried headless beneath the High Road; his Timber Post bounty bought salt and iron.',
    );
  } else if (kaleFate === 'abandoned') {
    lines.push(
      '* Kale the Deserter: Claimed by creeping frost-rot, his shackled husk prowled the viaduct fog.',
    );
  }

  if (hasFlag(state, 'stole_cistern_vesper')) {
    lines.push(
      '* Old Bathhouse: Stripped of its warm basin cache, the blind weavers barred their doors and hunted the thief by ear.',
    );
  } else if (state.memory.factions.silken_cistern >= 2) {
    lines.push(
      '* Old Bathhouse: The blind weavers kept a dry wool pallet and warm water open whenever your boots touched the marble.',
    );
  }

  if (hasFlag(state, 'vorne_redeemed')) {
    lines.push(
      '* Vorne: Freed from his long watch by the spoken barrow oath, the old knight laid down his bronze blade beside North Gate.',
    );
  } else if (hasFlag(state, 'vorne_slain')) {
    lines.push(
      '* Vorne: Cut down at North Gate, his frost-locked bronze plate still creaking in the mountain wind.',
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
