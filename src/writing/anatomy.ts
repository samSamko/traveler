import type {
  AnatomyProfile,
  AppearanceSelections,
  BackgroundId,
  GameState,
  RaceId,
  SexId,
} from '../types.ts';
import { loadWorldDatabase } from '../db/loader.ts';
import { evaluateCondition } from '../db/rules.ts';

export interface AppearanceOptionSet {
  height: string[];
  weight: string[];
  skinColor: string[];
  hairLength: string[];
  hairStyle: string[];
  hairColor: string[];
  eyeShape: string[];
  eyeColor: string[];
  musculature: string[];
  bodyShape: string[];
  facialScars: string[];
  bodyScars: string[];
  distinguishingMark: string[];
}

const SKIN_BY_RACE: Record<RaceId, string[]> = {
  vaelorian: ['Pale Ivory', 'Warm Olive', 'Weathered Tan', 'Bronze', 'Deep Umber'],
  ael_thalor: ['Moon-Pale', 'Silver-Ivory', 'Dusk-Ash', 'Frost-Grey', 'Starlit Alabaster'],
  durnfolk: ['Slate-Grey', 'Iron-Tan', 'Weathered Ochre', 'Basalt-Brown', 'Soot-Bronze'],
  grixi: ['Mossy Olive', 'Soot-Green', 'Tarnished Brass', 'Chalk-Sage', 'Damp Lichen'],
};

const HAIR_COLOR_BY_RACE: Record<RaceId, string[]> = {
  vaelorian: ['Raven Black', 'Chestnut', 'Ash-Blonde', 'Copper-Red', 'Iron-Grey'],
  ael_thalor: ['Starlight Silver', 'Pale Gold', 'Ash-White', 'Midnight Blue', 'Obsidian'],
  durnfolk: ['Coal Black', 'Rust-Red', 'Forge-Grey', 'Bronze-Brown', 'Soot-White'],
  grixi: ['Soot Black', 'Mire-Brown', 'Copper-Tarnish', 'Chalk-Grey', 'Moss-Dark'],
};

const EYE_COLOR_BY_RACE: Record<RaceId, string[]> = {
  vaelorian: ['Storm-Grey', 'Hazel', 'Amber', 'Dark Brown', 'Pale Blue'],
  ael_thalor: ['Liquid Silver', 'Pale Violet', 'Frost-Blue', 'Star-Gold', 'Mist-Grey'],
  durnfolk: ['Ember-Amber', 'Flint-Grey', 'Iron-Brown', 'Smoky Quartz', 'Deep Copper'],
  grixi: ['Lantern-Yellow', 'Tarnished Gold', 'Soot-Orange', 'Bog-Green', 'Bright Amber'],
};

const HEIGHT_BY_RACE: Record<RaceId, string[]> = {
  vaelorian: ['Short', 'Average', 'Tall', 'Towering'],
  ael_thalor: ['Average', 'Lithesome Tall', 'Tall', 'Towering'],
  durnfolk: ['Squat', 'Compact', 'Stout', 'Broad-Tall'],
  grixi: ['Small', 'Wiry-Short', 'Compact', 'Tall for Grixi'],
};

const MARK_BY_RACE: Record<RaceId, string[]> = {
  vaelorian: ['None', 'Kiln-Ember Brand', 'Imperial Signet-Callus', 'Soot-Stained Knuckles', 'Cold Unblinking Gaze'],
  ael_thalor: ['None', 'Silver Vein-Lines', 'Star-Script Ink', 'Hollow Collarbones', 'Ageless Stillness'],
  durnfolk: ['None', 'Slate Knuckle-Ridges', 'Basalt Cheek-Striations', 'Forge-Soot Beard', 'Iron-Ringed Braids'],
  grixi: ['None', 'Notched Ears', 'Lantern-Sheen Pupils', 'Alchemical Acid-Stains', 'Brass Guild-Pin'],
};

export function getAppearanceOptionsFor(sex: SexId, race: RaceId): AppearanceOptionSet {
  return {
    height: HEIGHT_BY_RACE[race],
    weight: ['Gaunt', 'Lean', 'Solid', 'Heavy', 'Burly'],
    skinColor: SKIN_BY_RACE[race],
    hairLength: ['Shaved', 'Cropped', 'Shoulder-Length', 'Long', 'Waist-Length'],
    hairStyle: ['Unkempt', 'Braided', 'Tied Back', 'Slicked', 'Wild'],
    hairColor: HAIR_COLOR_BY_RACE[race],
    eyeShape: ['Narrow', 'Almond', 'Deep-Set', 'Wide', 'Hooded'],
    eyeColor: EYE_COLOR_BY_RACE[race],
    musculature: ['Frail', 'Wiry', 'Toned', 'Broad', 'Corded', 'Hulking'],
    bodyShape:
      sex === 'female'
        ? ['Spare', 'Slender', 'Trim', 'Curved', 'Full-Figured', 'Broad-Shouldered']
        : ['Spare', 'Lean', 'Trim', 'Broad-Chested', 'Stocky', 'Barrel-Chested'],
    facialScars: ['Unmarked', 'Cheek Slash', 'Brow Split', 'Ash-Burn', 'Lip Notch', 'Ritual Brand'],
    bodyScars: ['Unmarked', 'Lash Welts', 'Rib Seam', 'Kiln-Burn', 'Old Spear-Mark', 'Pale Root-Veins'],
    distinguishingMark: MARK_BY_RACE[race],
  };
}

export function buildPlayerAnatomy(
  sex: SexId,
  race: RaceId,
  background: BackgroundId,
  sel: AppearanceSelections,
): AnatomyProfile {
  const tags: string[] = [];

  if (sel.height.toLowerCase().includes('tower') || sel.height.toLowerCase().includes('tall')) {
    tags.push('towering');
  }
  if (sel.height === 'Small' || sel.height === 'Short' || sel.height === 'Squat') {
    tags.push('small_stature');
  }
  if (sel.weight === 'Gaunt') tags.push('gaunt');
  if (sel.musculature === 'Corded' || sel.musculature === 'Hulking' || sel.musculature === 'Broad') {
    tags.push('muscular');
  }
  if (sel.musculature === 'Frail') tags.push('frail');
  if (sel.bodyShape === 'Curved' || sel.bodyShape === 'Full-Figured') {
    tags.push('curvaceous');
  }
  if (sel.facialScars !== 'Unmarked') tags.push('scarred_face');
  if (sel.bodyScars !== 'Unmarked') tags.push('battle_worn');
  if (sel.bodyScars === 'Pale Root-Veins') tags.push('root_veined');
  if (sel.distinguishingMark.toLowerCase().includes('kiln')) tags.push('kiln_branded');
  if (sel.distinguishingMark.toLowerCase().includes('notched')) tags.push('notched_ears');
  if (sel.skinColor.toLowerCase().includes('pale') || sel.skinColor.toLowerCase().includes('alabaster')) {
    tags.push('pale_skin');
  }

  const raceFaceNote =
    race === 'ael_thalor'
      ? 'High, angular cheekbones and tapered ears give the face an ageless stillness.'
      : race === 'durnfolk'
        ? 'A broad bridge and heavy brow carry faint mineral grain along the temples.'
        : race === 'grixi'
          ? 'Pointed ears angle sharply back beside alert, lantern-bright features.'
          : 'Sharp, weathered features show the restless set of mortal blood.';

  const scarFaceNote =
    sel.facialScars === 'Unmarked'
      ? 'The skin of the face remains clean of old blade-work.'
      : `A prominent ${sel.facialScars.toLowerCase()} marks the face at first glance.`;

  const chestDetail =
    sex === 'female'
      ? `A ${sel.bodyShape.toLowerCase()} chest and ${sel.musculature.toLowerCase()} torso carry ${sel.weight.toLowerCase()} weight evenly beneath travel-wear.`
      : `A ${sel.bodyShape.toLowerCase()} chest and ${sel.musculature.toLowerCase()} torso sit solid over a ${sel.weight.toLowerCase()} frame.`;

  const bodyScarNote =
    sel.bodyScars === 'Unmarked'
      ? 'No deep scars seam the ribs or shoulders.'
      : `Beneath collar and sleeve run old ${sel.bodyScars.toLowerCase()}.`;

  const handNote =
    background === 'ashen_blade'
      ? 'Sword-calluses harden the palms and inner thumbs, forearms corded from shield-work.'
      : background === 'root_scholar'
        ? 'Ink-darkened fingertips and nimble wrists show years spent tracing scorched scrolls and casting sigils.'
        : background === 'barrow_stalker'
          ? 'Lean, scarred forearms end in quick, bowstring-calloused fingers.'
          : 'Raw wrist-marks from iron chains sit above steadfast, weathered hands.';

  const legNote =
    sel.musculature === 'Hulking' || sel.weight === 'Burly' || sel.weight === 'Heavy'
      ? 'Heavy, planted stride that settles deep into wet ash.'
      : sel.musculature === 'Wiry' || sel.weight === 'Lean' || sel.weight === 'Gaunt'
        ? 'Quiet, coiled footing balanced on the balls of the feet.'
        : 'Measured frontier stride kept ready to pivot or brace.';

  return {
    height: sel.height,
    weight: sel.weight,
    skinColor: sel.skinColor,
    hairLength: sel.hairLength,
    hairStyle: sel.hairStyle,
    hairColor: sel.hairColor,
    eyeShape: sel.eyeShape,
    eyeColor: sel.eyeColor,
    musculature: sel.musculature,
    bodyShape: sel.bodyShape,
    facialScars: sel.facialScars,
    bodyScars: sel.bodyScars,
    faceDetail: `${sel.eyeShape} ${sel.eyeColor.toLowerCase()} eyes peer out above ${sel.skinColor.toLowerCase()} skin. ${raceFaceNote} ${scarFaceNote}`,
    chestTorsoDetail: `${chestDetail} ${bodyScarNote}`,
    armsHandsDetail: `${sel.musculature} arms taper to working frontier hands. ${handNote}`,
    legsStanceDetail: legNote,
    distinguishingMark:
      sel.distinguishingMark === 'None'
        ? 'No singular outward emblem beyond road-dust and quiet watchfulness.'
        : sel.distinguishingMark,
    visibleTags: tags,
  };
}

export function rollDefaultAnatomy(
  sex: SexId,
  race: RaceId,
  background: BackgroundId,
): AnatomyProfile {
  const opts = getAppearanceOptionsFor(sex, race);
  const pick = (arr: string[], idx: number) => arr[Math.min(idx, arr.length - 1)];

  const selections: AppearanceSelections = {
    height: pick(opts.height, race === 'ael_thalor' ? 2 : 1),
    weight: background === 'ashen_blade' || race === 'durnfolk' ? 'Solid' : 'Lean',
    skinColor: pick(opts.skinColor, 1),
    hairLength: sex === 'female' ? 'Long' : 'Cropped',
    hairStyle: race === 'durnfolk' ? 'Braided' : sex === 'female' ? 'Tied Back' : 'Unkempt',
    hairColor: pick(opts.hairColor, 0),
    eyeShape: race === 'ael_thalor' ? 'Almond' : 'Narrow',
    eyeColor: pick(opts.eyeColor, 0),
    musculature:
      background === 'ashen_blade' || race === 'durnfolk'
        ? 'Corded'
        : background === 'root_scholar'
          ? 'Wiry'
          : 'Toned',
    bodyShape:
      sex === 'female'
        ? background === 'ashen_blade'
          ? 'Broad-Shouldered'
          : 'Trim'
        : race === 'durnfolk'
          ? 'Barrel-Chested'
          : 'Trim',
    facialScars: background === 'ashen_blade' ? 'Brow Split' : 'Unmarked',
    bodyScars: background === 'shrine_penitent' ? 'Lash Welts' : 'Unmarked',
    distinguishingMark: pick(opts.distinguishingMark, 1),
  };

  return buildPlayerAnatomy(sex, race, background, selections);
}

export function renderAnatomyProse(
  subjectName: string,
  anatomy: AnatomyProfile,
  overlays?: {
    gearLine?: string;
    conditionLine?: string;
    statusLine?: string;
  },
): string[] {
  const hairLine =
    anatomy.hairLength === 'None' || anatomy.hairStyle === 'None'
      ? 'No hair covers the skull.'
      : `${anatomy.hairLength}, ${anatomy.hairStyle.toLowerCase()} ${anatomy.hairColor.toLowerCase()} hair frames the head.`;

  const lines: string[] = [
    `${subjectName}`,
    `Stature and Build: ${anatomy.height}, ${anatomy.weight.toLowerCase()} build, ${anatomy.musculature.toLowerCase()} musculature, ${anatomy.bodyShape.toLowerCase()} frame with ${anatomy.skinColor.toLowerCase()} skin.`,
    `Hair and Crown: ${hairLine}`,
    `Face and Eyes: ${anatomy.faceDetail}`,
    `Chest and Torso: ${anatomy.chestTorsoDetail}`,
    `Arms and Hands: ${anatomy.armsHandsDetail}`,
    `Legs and Stance: ${anatomy.legsStanceDetail}`,
    `At a Longer Glance: ${anatomy.distinguishingMark}`,
  ];

  if (overlays?.gearLine) {
    lines.push(`Worn and Carried: ${overlays.gearLine}`);
  }
  if (overlays?.conditionLine) {
    lines.push(`Condition: ${overlays.conditionLine}`);
  }
  if (overlays?.statusLine) {
    lines.push(`Afflictions: ${overlays.statusLine}`);
  }

  return lines;
}

export function getNpcAppearanceReaction(state: GameState, npcId: string): string | null {
  const reactions = loadWorldDatabase().npcReactions.filter((rx) => rx.npcId === npcId);
  for (const rx of reactions) {
    if (evaluateCondition(state, rx.cond)) {
      return rx.text;
    }
  }
  return null;
}
