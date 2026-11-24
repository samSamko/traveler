import type { BodyModDef, BodySlot, GameState } from '../types.ts';
import { recordChronicle } from '../memory.ts';

export const BODY_MODS: Record<string, BodyModDef> = {
  star_sap_eyes: {
    id: 'star_sap_eyes',
    name: 'Star-Sap Lenses',
    kind: 'implant',
    slot: 'eyes',
    defilementLoad: 10,
    description: 'Crystallized drops of Star-Wood sap set into the irises to read bone and aura.',
    bonusSummary: 'Plus 2 Wit and automatic surface combat appraisal.',
    drawbackSummary: 'Vulnerable to lightning and raises Defilement by 10.',
    statMods: { wit: 2 },
    resistances: { lightning: 'vulnerable', resonant: 'resistant' },
    anatomyOverlay: {
      field: 'faceDetail',
      appendText: 'Silver crystalline rings catch dim light across the irises.',
      eyeColorOverride: 'Star-Sap Silver',
    },
    addedTags: ['star_eyed', 'implanted'],
    excisionScar: 'Pale Corneal Scar',
  },
  chitin_skin: {
    id: 'chitin_skin',
    name: 'Chitinous Plates',
    kind: 'mutation',
    slot: 'skin',
    defilementLoad: 18,
    description: 'Layered pale beetle-chitin hardens across shoulders, ribs, and forearms.',
    bonusSummary: 'Plus 3 Armor and resistant to slashing and poison.',
    drawbackSummary: 'Minus 1 Agility, vulnerable to fire and bludgeoning, raises Defilement by 18.',
    statMods: { agility: -1 },
    armorMod: 3,
    resistances: {
      slashing: 'resistant',
      poison: 'resistant',
      fire: 'vulnerable',
      bludgeoning: 'vulnerable',
    },
    anatomyOverlay: {
      field: 'chestTorsoDetail',
      appendText: 'Segmented ivory chitin plates overlap visibly along ribs and collarbones.',
    },
    addedTags: ['chitin_plated', 'mutated'],
    excisionScar: 'Flayed Chitin-Seams',
  },
  kiln_blood: {
    id: 'kiln_blood',
    name: 'Kiln-Ember Blood',
    kind: 'mutation',
    slot: 'blood',
    defilementLoad: 16,
    description: 'Soul-amber ash runs hot through the veins, turning breath smoky in winter air.',
    bonusSummary: 'Plus 2 Might, resistant to fire and blight, grants Kiln-Spark.',
    drawbackSummary: 'Minus 2 Max Resolve, vulnerable to cold, raises Defilement by 16.',
    statMods: { might: 2 },
    maxResolveMod: -2,
    resistances: { fire: 'resistant', blight: 'resistant', cold: 'vulnerable' },
    grantedAbilityId: 'kiln_spark',
    anatomyOverlay: {
      field: 'distinguishingMark',
      appendText: 'Faint orange heat shimmers beneath fever-warm veins.',
    },
    addedTags: ['kiln_branded', 'mutated'],
    excisionScar: 'Cauterized Vein-Tracks',
  },
  iron_tendon_arms: {
    id: 'iron_tendon_arms',
    name: 'Iron-Wire Tendons',
    kind: 'surgery',
    slot: 'arms',
    defilementLoad: 12,
    description: 'Braided Durnfolk wire stitched directly along forearm sinews for crushing leverage.',
    bonusSummary: 'Plus 2 Might and plus 3 Max Stamina.',
    drawbackSummary: 'Minus 2 Max Focus, vulnerable to lightning, raises Defilement by 12.',
    statMods: { might: 2 },
    maxStaminaMod: 3,
    maxFocusMod: -2,
    resistances: { lightning: 'vulnerable' },
    anatomyOverlay: {
      field: 'armsHandsDetail',
      appendText: 'Dark surgical stitches and taut iron wire ridge beneath both forearms.',
    },
    addedTags: ['muscular', 'surgical_graft'],
    excisionScar: 'Deep Forearm Sutures',
  },
  pale_root_hands: {
    id: 'pale_root_hands',
    name: 'Pale-Root Claws',
    kind: 'mutation',
    slot: 'hands',
    defilementLoad: 20,
    description: 'Calcified root-tendrils lace through the knuckles into pale tearing talons.',
    bonusSummary: 'Plus 1 Might, plus 1 Agility, resistant to blight, grants Root-Snare.',
    drawbackSummary: 'Vulnerable to fire, Iron-Vow suspicion, raises Defilement by 20.',
    statMods: { might: 1, agility: 1 },
    resistances: { blight: 'resistant', fire: 'vulnerable' },
    grantedAbilityId: 'root_snare',
    anatomyOverlay: {
      field: 'armsHandsDetail',
      appendText: 'Chalk-white root fibers twine between the knuckles into hardened pale claws.',
    },
    addedTags: ['root_veined', 'mutated'],
    excisionScar: 'Splintered Knuckle-Scars',
  },
  vesper_ribs: {
    id: 'vesper_ribs',
    name: 'Vesper Rib-Cage',
    kind: 'implant',
    slot: 'chest',
    defilementLoad: 15,
    description: 'Hollow amber conduits inlaid along the sternum to store resonant focus.',
    bonusSummary: 'Plus 4 Max Focus, plus 1 Armor, resistant to resonant.',
    drawbackSummary: 'Minus 3 Max HP, vulnerable to bludgeoning, raises Defilement by 15.',
    maxFocusMod: 4,
    maxHpMod: -3,
    armorMod: 1,
    resistances: { resonant: 'resistant', bludgeoning: 'vulnerable' },
    anatomyOverlay: {
      field: 'chestTorsoDetail',
      appendText: 'Dull amber conduits glow faintly beneath tight surgical seams across the sternum.',
    },
    addedTags: ['implanted', 'battle_worn'],
    excisionScar: 'Sternum Graft-Trench',
  },
  alkali_glands: {
    id: 'alkali_glands',
    name: 'Alkali Glands',
    kind: 'surgery',
    slot: 'face',
    defilementLoad: 14,
    description: 'Under-Warren alchemical sacs stitched beneath the jaw to neutralize venom and spit acid.',
    bonusSummary: 'Resistant to acid and poison, grants Vesper-Flask.',
    drawbackSummary: 'Vulnerable to cold, stitched jawline stigma, raises Defilement by 14.',
    resistances: { acid: 'resistant', poison: 'resistant', cold: 'vulnerable' },
    grantedAbilityId: 'vesper_flask',
    anatomyOverlay: {
      field: 'faceDetail',
      appendText: 'Copper-sutured swellings line the lower jaw smelling faintly of vinegar.',
    },
    addedTags: ['scarred_face', 'surgical_graft'],
    excisionScar: 'Jawline Suture-Welts',
  },
  brass_striders: {
    id: 'brass_striders',
    name: 'Brass Tendon-Braces',
    kind: 'implant',
    slot: 'legs',
    defilementLoad: 12,
    description: 'Spring-loaded Grixi brass braces pinned into shin and heel tendons.',
    bonusSummary: 'Plus 2 Agility and plus 2 Max Stamina.',
    drawbackSummary: 'Minus 2 Max Resolve, vulnerable to lightning and acid, raises Defilement by 12.',
    statMods: { agility: 2 },
    maxStaminaMod: 2,
    maxResolveMod: -2,
    resistances: { lightning: 'vulnerable', acid: 'vulnerable' },
    anatomyOverlay: {
      field: 'legsStanceDetail',
      appendText: 'Clockwork brass pins click faintly along calves and heels with every spring-loaded stride.',
    },
    addedTags: ['implanted'],
    excisionScar: 'Pinned Shin Scars',
  },
};

export function installBodyMod(state: GameState, modId: string): string[] {
  const mod = BODY_MODS[modId];
  if (!mod) return ['Unknown modification.'];
  const p = state.player;
  const msgs: string[] = [];

  const existingId = p.bodyMods[mod.slot];
  if (existingId === modId) {
    return [`${mod.name} already occupies your ${mod.slot}.`];
  }
  if (existingId && BODY_MODS[existingId]) {
    const old = BODY_MODS[existingId];
    if (old.maxHpMod) p.maxHp = Math.max(10, p.maxHp - old.maxHpMod);
    if (old.maxStaminaMod) p.maxStamina = Math.max(4, p.maxStamina - old.maxStaminaMod);
    if (old.maxFocusMod) p.maxFocus = Math.max(4, p.maxFocus - old.maxFocusMod);
    if (old.maxResolveMod) p.maxResolve = Math.max(6, p.maxResolve - old.maxResolveMod);
    msgs.push(`Replaced ${old.name} in your ${mod.slot}.`);
  }

  p.bodyMods[mod.slot] = mod.id;
  if (mod.maxHpMod) {
    p.maxHp = Math.max(10, p.maxHp + mod.maxHpMod);
    p.hp = Math.min(p.maxHp, p.hp + Math.max(0, mod.maxHpMod));
  }
  if (mod.maxStaminaMod) {
    p.maxStamina = Math.max(4, p.maxStamina + mod.maxStaminaMod);
    p.stamina = Math.min(p.maxStamina, p.stamina + Math.max(0, mod.maxStaminaMod));
  }
  if (mod.maxFocusMod) {
    p.maxFocus = Math.max(4, p.maxFocus + mod.maxFocusMod);
    p.focus = Math.min(p.maxFocus, p.focus + Math.max(0, mod.maxFocusMod));
  }
  if (mod.maxResolveMod) {
    p.maxResolve = Math.max(6, p.maxResolve + mod.maxResolveMod);
    p.resolve = Math.min(p.maxResolve, p.resolve + Math.max(0, mod.maxResolveMod));
  }

  p.defilement = Math.min(100, p.defilement + mod.defilementLoad);

  if (mod.grantedAbilityId && !p.abilities.includes(mod.grantedAbilityId)) {
    p.abilities.push(mod.grantedAbilityId);
  }

  // Rewrite AnatomyProfile visibly
  const ov = mod.anatomyOverlay;
  if (!p.anatomy[ov.field].includes(ov.appendText)) {
    p.anatomy[ov.field] = `${p.anatomy[ov.field]} ${ov.appendText}`.trim();
  }
  if (ov.eyeColorOverride) p.anatomy.eyeColor = ov.eyeColorOverride;
  if (ov.skinColorOverride) p.anatomy.skinColor = ov.skinColorOverride;
  for (const tag of mod.addedTags) {
    if (!p.anatomy.visibleTags.includes(tag)) {
      p.anatomy.visibleTags.push(tag);
    }
  }

  recordChronicle(
    state,
    `Body Altered - ${mod.name}`,
    `Took ${mod.name} into ${mod.slot}. ${mod.bonusSummary}`,
    'bodymod',
  );

  msgs.push(`${mod.name} takes hold in your ${mod.slot}. ${mod.description}`);
  if (p.defilement >= 100) {
    state.scene = 'dead';
    msgs.push('Defilement overwhelms your mortal frame completely.');
  }
  return msgs;
}

export function exciseBodyMod(state: GameState, slot: BodySlot): string[] {
  const p = state.player;
  const modId = p.bodyMods[slot];
  if (!modId || !BODY_MODS[modId]) {
    return ['No active modification in that slot.'];
  }
  const mod = BODY_MODS[modId];
  delete p.bodyMods[slot];

  if (mod.maxHpMod) p.maxHp = Math.max(10, p.maxHp - mod.maxHpMod);
  if (mod.maxStaminaMod) p.maxStamina = Math.max(4, p.maxStamina - mod.maxStaminaMod);
  if (mod.maxFocusMod) p.maxFocus = Math.max(4, p.maxFocus - mod.maxFocusMod);
  if (mod.maxResolveMod) p.maxResolve = Math.max(6, p.maxResolve - mod.maxResolveMod);

  p.hp = Math.max(1, Math.min(p.maxHp, p.hp - 6));
  p.stamina = Math.min(p.maxStamina, p.stamina);
  p.focus = Math.min(p.maxFocus, p.focus);
  p.resolve = Math.min(p.maxResolve, p.resolve);
  p.defilement = Math.max(0, p.defilement - Math.floor(mod.defilementLoad * 0.5));

  if (slot === 'face' || slot === 'eyes') {
    p.anatomy.facialScars = mod.excisionScar;
    if (!p.anatomy.visibleTags.includes('scarred_face')) p.anatomy.visibleTags.push('scarred_face');
  } else {
    p.anatomy.bodyScars = mod.excisionScar;
    if (!p.anatomy.visibleTags.includes('battle_worn')) p.anatomy.visibleTags.push('battle_worn');
  }

  return [
    `Through bloody surgical excision you cut ${mod.name} free from your ${slot}, leaving ${mod.excisionScar.toLowerCase()} behind.`,
  ];
}
