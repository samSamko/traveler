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
  const bg = BACKGROUNDS[p.background];
  const heirloom = HEIRLOOMS[p.heirloom];
  const a = p.anatomy;

  if (beatIndex === 0) {
    return {
      title: 'THE FAR NORTH',
      body: [
        'In every southern city, town, and village, stories persist of the Far North: looming mountains with castles carved into rock, tundras so cold the air freezes your lungs, barren taigas where your own heartbeat carries for miles, jagged hills that tear through boots, and grim forests whose roots grip the earth.',
        'Criminals with nowhere left to hide, soldiers without a cause, ruined peasants, and desperate wanderers flee there and are never heard from again. The farther north a traveler pushes, the stronger the compulsion grows, even as crops fail, food spoils, beasts turn vicious, and sickness spreads. Only scattered hermits, witches, heretics, and outcasts endure the cold.',
      ].join('\n\n'),
    };
  }

  if (beatIndex === 1) {
    const raceOpening =
      p.race === 'vaelorian'
        ? `You walk north as a human outcast from the fractured southern kingdoms, where suspicion and iron laws leave no room for those cast out.`
        : p.race === 'ael_thalor'
          ? `You are an elf, long-lived and silver-eyed, forced out of dwindling southern woods while mortal villagers whisper fears behind barred shutters.`
          : p.race === 'durnfolk'
            ? `You are a dwarf of the stone-walled southern holds, broad-shouldered and unforgiving, carrying deep-forge endurance into the biting wind.`
            : `You are a goblin—unlike the wild, brutal tribes hunted across southern roads, you mastered speech, barter, and alchemy, earning narrow-eyed distrust at every gate.`;

    const scarClause =
      a.facialScars === 'Unmarked'
        ? 'Your face remains unmarked by frontier steel'
        : `A ${a.facialScars.toLowerCase()} marks your face`;

    const markClause = a.distinguishingMark.startsWith('No singular')
      ? 'only road-dust and quiet watchfulness mark your bearing.'
      : `at any longer glance ${a.distinguishingMark.toLowerCase()} lingers in the memory.`;

    const bodyPortrait = `${a.height} and ${a.weight.toLowerCase()}, you carry a ${a.musculature.toLowerCase()}, ${a.bodyShape.toLowerCase()} frame clad in ${a.skinColor.toLowerCase()} skin. ${a.eyeShape} ${a.eyeColor.toLowerCase()} eyes watch the horizon beneath ${a.hairLength.toLowerCase()}, ${a.hairStyle.toLowerCase()} ${a.hairColor.toLowerCase()} hair. ${scarClause}, and ${markClause}`;

    const frictionNote =
      p.sex === 'female'
        ? 'Between the southern holds, old feuds divide every bloodline, and border watches measure a woman twice before trusting steel in her hand.'
        : 'Between the southern holds, old feuds divide every bloodline, and garrison watches eye any solitary wanderer like a deserting criminal.';

    return {
      title: `BLOOD AND FORM - ${p.name.toUpperCase()}`,
      body: [raceOpening, bodyPortrait, frictionNote].join('\n\n'),
    };
  }

  if (beatIndex === 2) {
    const bgBeat =
      p.background === 'ashen_blade'
        ? `Fleeing southern execution after breaking a lord's command, you wear scarred mail and answer only to the steel in ${pr.poss} hand.`
        : p.background === 'root_scholar'
          ? `Cast out from southern cloisters for chasing forbidden tales of northern waystones, obsession dragged you past the snowline.`
          : p.background === 'barrow_stalker'
            ? `Chased north by crushing debt and bounties, you followed rumors of sharp-edged black coins surviving intact inside frozen vaults.`
            : `Driven from southern parishes for apostasy, you haul penitent iron into the frost where no bell calls your name.`;

    const gateBeat =
      'At last the jagged peaks narrow to a single towering gate of carved black stone. With every step, freezing air locks your breath and the pull turns violent. Frozen figures line the path where weaker travelers turned to ice at first touch. You brace your shoulder, force the heavy stone doors apart, and step through.';

    const heirloomBeat = `At your belt rests the ${heirloom.name}: ${heirloom.description}`;

    return {
      title: `${bg.name.toUpperCase()} AND THE GATE`,
      body: [bgBeat, gateBeat, heirloomBeat].join('\n\n'),
    };
  }

  return {
    title: 'BEYOND THE THRESHOLD',
    body: [
      `When you turn back, only empty wind and blank mountain cliff wait behind you—the black stone gate has vanished, cutting off every road back south.`,
      `Before you stretches a forgotten, overgrown ruin-land unlike anything in the south: wide cracked marble avenues, monumental stone arches, shattered aqueducts, and carved waystones proportioned for taller folk. You bank a small fire behind a fallen plinth and set your Lone Camp, ${p.name}.`,
    ].join('\n\n'),
  };
}
