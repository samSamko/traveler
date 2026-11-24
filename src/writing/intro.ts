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
      title: 'THE CRACKED VALLEY',
      body: [
        'Seven generations ago, the rulers of this valley dug too deep and cracked open a vast underground furnace to burn glowing amber sap from the roots beneath the earth. Their fire built an empire, and their greed left a poisoned wound under the hills.',
        'Now the frontier is rotting from below. Pale, chalky roots split the old stone roads, sunken bronze bells ring on their own in the fog, and a spreading fungal blight creeps outward from a flooded bell-tower in the lowlands.',
      ].join('\n\n'),
    };
  }

  if (beatIndex === 1) {
    const raceOpening =
      p.race === 'vaelorian'
        ? `You walk these drowned roads as a ${p.sex === 'female' ? 'daughter' : 'son'} of the Vaelorians, the mortal human heirs of the fallen empire. Border garrisons still respect your old family seals, while older villagers whisper that your bloodline lit the fire that ruined the valley.`
        : p.race === 'ael_thalor'
          ? `You are Ael-Thalor, a long-lived, silver-skinned exile from a forest whose ancient trees turned to stone. Even through damp earth and rain, your sharp ears catch the slow, wet hum of the spreading rot underground.`
          : p.race === 'durnfolk'
            ? `You are Durnfolk, stout, stone-ribbed smiths and tunnel-wardens from the deep mountain forges. Slate-hard patience lives in your bones from the bitter years your clans spent barring the lower iron gates against whatever crawls up from below.`
            : `You are Grixi, a sharp-eared, nocturnal tinker from the underground tunnel-guilds. Surface guards often mistake your kind for feral scavengers until your guild papers audit their grain ledgers or your alchemy melts their iron locks.`;

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
        ? 'On this harsh border, custom divides the watch from the cloister: soldiers on the wall test a woman twice before trusting her blade, while the blind weavers sheltering beneath the marsh welcome sisters behind their silk curtains.'
        : 'On this harsh border, custom divides the watch from the cloister: garrison officers muster a man swiftly onto the wall, while the blind weavers sheltering beneath the marsh bar male footsteps from their inner halls.';

    return {
      title: `BLOOD AND FORM - ${p.name.toUpperCase()}`,
      body: [raceOpening, bodyPortrait, socialNote].join('\n\n'),
    };
  }

  if (beatIndex === 2) {
    const bgBeat =
      p.background === 'ashen_blade'
        ? `Once sworn to a noble banner, you broke orders to spare a burning village. Stripped of rank yet unbroken, you wear scarred mail and answer only to the weight of steel in ${pr.poss} hand.`
        : p.background === 'root_scholar'
          ? `Expelled from the city archives for copying forbidden notes on the underground blight, you came north to study the spreading roots at their source before the valley falls silent.`
          : p.background === 'barrow_stalker'
            ? `Years guiding desperate caravans through fog-choked marshes and old burial mounds taught you where dead kings hide their silver, and how to step lightly where pale fungi listen.`
            : `Bound in iron chains to quiet a family curse, you carry heavy counter-chimes down into the fog, trading your own blood and breath to hold back the sickness.`;

    const heirloomBeat = `Secured at your belt rests the ${heirloom.name}: ${heirloom.description}`;

    return {
      title: `${bg.name.toUpperCase()} AND RELIC`,
      body: [bgBeat, heirloomBeat].join('\n\n'),
    };
  }

  return {
    title: 'THE GATE OF CINDERFORD',
    body: [
      `Cold rain hisses across wet ash as the blackened timber walls of Cinderford Keep rise through the fog ahead. Pitch-lanterns sway over the muddy courtyard where iron-armored border guards change the watch, and a low, wet hum drifts up from the marsh below.`,
      `The frontier lies open before you, ${p.name}: flooded burial mounds, hidden underground workshops, ruined forges, and a sunken bell-tower waiting in the mist. Step through the gate.`,
    ].join('\n\n'),
  };
}
