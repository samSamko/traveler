import type { BodyModDef, BodySlot, GameState } from '../types.ts';
import { recordChronicle } from '../memory.ts';
import { loadWorldDatabase } from '../db/loader.ts';

export const BODY_MODS: Record<string, BodyModDef> = loadWorldDatabase().bodyMods;

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
