import type { GameState } from '../types.ts';
import { BACKGROUNDS, HEIRLOOMS, RACES } from '../content/characters.ts';
import { pronouns } from '../memory.ts';

export const INTRO_BEAT_COUNT = 4;

export interface IntroBeat {
  title: string;
  body: string;
}

export function getIntroBeat(state: GameState, beatIndex: number): IntroBeat {
  const p = state.player;
  const pr = pronouns(p.sex);
  const race = RACES[p.race];
  const bg = BACKGROUNDS[p.background];
  const heirloom = HEIRLOOMS[p.heirloom];
  const a = p.anatomy;

  if (beatIndex === 0) {
    return {
      title: 'THE BROKEN KILN',
      body: [
        'Seven generations past, the Crown-Wrought cracked the First Kiln of Aethel to burn soul-amber from the deep roots of the world. Their fire bought an empire, and their arrogance left an open wound beneath the valley.',
        'Now the Gloaming Reach rots from below. Pale roots split old Imperial flagstones, bronze bells ring without wind, and a slow calcifying blight creeps outward from the Sunken Belfry where Malakor gathers breath for the Third Drowning Toll.',
      ].join('\n\n'),
    };
  }

  if (beatIndex === 1) {
    const raceOpening =
      p.race === 'vaelorian'
        ? `You walk these drowned roads as a ${p.sex === 'female' ? 'daughter' : 'son'} of the Vaelorians — short-lived inheritors of the broken throne. Garrisons still answer your blood-charter, while older folk whisper that your kin lit the fire that ruined the Reach.`
        : p.race === 'ael_thalor'
          ? `You are Ael-Thalor, an ageless exile from the Petrified Star-Wood. Through stone and mire your silver ears still catch the slow, grieving hum of the Pale Root, inspiring uneasy awe wherever mortal folk gather.`
          : p.race === 'durnfolk'
            ? `You are Durnfolk, basalt-kin of the sealed deep forges. Slate and iron patience live in your ribs, forged from the bitter years your clans spent barring the lower kiln-gates against the rising abyss.`
            : `You are Grixi, citizen of the subterranean Brass-Warrens. Surface folk mistake your sharp-eared, lantern-eyed kind for feral scavengers until your guild seals audit their grain ledgers or your alchemy melts their iron locks.`;

    const scarClause =
      a.facialScars === 'Unmarked'
        ? 'Your face remains unmarked by frontier steel'
        : `A ${a.facialScars.toLowerCase()} marks your face`;

    const markClause = a.distinguishingMark.startsWith('No singular')
      ? 'only road-dust and quiet watchfulness mark your bearing.'
      : `at any longer glance ${a.distinguishingMark.toLowerCase()} lingers in the memory.`;

    const bodyPortrait = `${a.height} and ${a.weight.toLowerCase()}, you carry a ${a.musculature.toLowerCase()}, ${a.bodyShape.toLowerCase()} frame clad in ${a.skinColor.toLowerCase()} skin. ${a.eyeShape} ${a.eyeColor.toLowerCase()} eyes watch the rain beneath ${a.hairLength.toLowerCase()}, ${a.hairStyle.toLowerCase()} ${a.hairColor.toLowerCase()} hair. ${scarClause}, and ${markClause}`;

    const socialNote =
      p.sex === 'female'
        ? 'On this harsh border, old customs divide iron from silk: garrisons test a woman twice before trusting her blade, while the blind Matrons beneath the mire welcome sisters behind their veil.'
        : 'On this harsh border, old customs divide iron from silk: Iron-Vow officers muster a man swiftly onto the wall, while the blind Matrons beneath the mire guard their veil against male footsteps.';

    return {
      title: `BLOOD AND FORM - ${p.name.toUpperCase()}`,
      body: [raceOpening, bodyPortrait, socialNote].join('\n\n'),
    };
  }

  if (beatIndex === 2) {
    const bgBeat =
      p.background === 'ashen_blade'
        ? `Once sworn to an oath-banner, you broke command to spare a burning hamlet. Disgraced yet unbroken, you wear scarred mail and answer only to the weight of steel in ${pr.poss} hand.`
        : p.background === 'root_scholar'
          ? `Cast out of the High Archives for transcribing forbidden kiln-liturgies, you came north to read the Pale Root at its source before the valley turns silent.`
          : p.background === 'barrow_stalker'
            ? `Years guiding desperate packs through mire and crypt taught you where dead kings hide their silver — and how to step lightly where pale fungi listen.`
            : `Bound in penitent iron to answer an ancestral curse, you carry the old counter-chimes down into the fog, trading blood and breath against the Choir.`;

    const heirloomBeat = `Secured at your belt rests the ${heirloom.name}: ${heirloom.description}`;

    return {
      title: `${bg.name.toUpperCase()} AND RELIC`,
      body: [bgBeat, heirloomBeat].join('\n\n'),
    };
  }

  return {
    title: 'THE GATE OF CINDERFORD',
    body: [
      `Cold rain hisses across wet ash as the timber palisades of Cinderford Keep rise through the fog ahead. Pitch-lanterns sway over the Iron-Vow muster yard, and a low, wet hum drifts upward from the valley floor.`,
      `The whole frontier lies open before you, ${p.name}: ruined barrows, subterranean looms, flooded forges, and the drowned amphitheater waiting in the mist. Step through the gate.`,
    ].join('\n\n'),
  };
}
