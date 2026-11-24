import type { GameState } from '../types.ts';
import { ABILITIES, BACKGROUNDS, HEIRLOOMS, PERKS, RACES } from '../content/characters.ts';
import { ITEMS, RECIPES } from '../content/items.ts';
import { ENEMIES } from '../content/enemies.ts';
import { LOCATIONS } from '../content/locations.ts';
import { getEffectiveStat } from '../dice.ts';
import { FACTION_NAMES, countBrokenSeals, getFactionStance } from '../memory.ts';
import { BODY_MODS } from '../systems/bodymods.ts';
import { INJURIES } from '../systems/injuries.ts';
import { DAMAGE_TYPE_META, getEffectivePlayerResistances } from '../systems/damage.ts';
import { renderAnatomyProse } from './anatomy.ts';
import {
  describeStatImpressions,
  formatResistanceProfile,
  getHealthConditionLabel,
} from './appraisal.ts';
import { getRelatedLinks } from './links.ts';

export interface JournalChoice {
  index: number;
  id: string;
  label: string;
  enabled: boolean;
}

function findNpcById(npcId: string) {
  for (const loc of Object.values(LOCATIONS)) {
    const found = loc.npcs?.find((n) => n.id === npcId);
    if (found) return { npc: found, location: loc };
  }
  return null;
}

export function getJournalChoices(state: GameState): JournalChoice[] {
  const choices: JournalChoice[] = [];

  if (state.journalTab === 'root') {
    const tabs: Array<{ id: string; label: string }> = [
      { id: 'jtab:self', label: 'Self' },
      { id: 'jtab:arts', label: 'Arts' },
      { id: 'jtab:bestiary', label: 'Bestiary' },
      { id: 'jtab:people', label: 'People' },
      { id: 'jtab:places', label: 'Places' },
      { id: 'jtab:items', label: 'Items' },
      { id: 'jtab:chronicle', label: 'Chronicle' },
      { id: 'jclose', label: 'Back' },
    ];
    tabs.forEach((t, i) => choices.push({ index: i + 1, id: t.id, label: t.label, enabled: true }));
    return choices;
  }

  if (state.journalDetailId) {
    choices.push({ index: 1, id: 'jdetail:back', label: 'Back', enabled: true });
    return choices;
  }

  if (state.journalTab === 'bestiary') {
    for (const [enemyId, rec] of Object.entries(state.discovery.knownEnemies)) {
      const tpl = ENEMIES[enemyId];
      if (!tpl || !rec.seen) continue;
      choices.push({
        index: choices.length + 1,
        id: `jdetail:${enemyId}`,
        label: rec.identified ? tpl.name : tpl.unidentifiedName,
        enabled: true,
      });
    }
    choices.push({ index: choices.length + 1, id: 'jtab:root', label: 'Back', enabled: true });
    return choices;
  }

  if (state.journalTab === 'people') {
    for (const npcId of state.discovery.knownNpcs) {
      const found = findNpcById(npcId);
      if (!found) continue;
      choices.push({
        index: choices.length + 1,
        id: `jdetail:${npcId}`,
        label: found.npc.shortLabel,
        enabled: true,
      });
    }
    choices.push({ index: choices.length + 1, id: 'jtab:root', label: 'Back', enabled: true });
    return choices;
  }

  if (state.journalTab === 'places') {
    for (const locId of state.discovery.knownPlaces) {
      const loc = LOCATIONS[locId];
      if (!loc) continue;
      choices.push({
        index: choices.length + 1,
        id: `jdetail:${locId}`,
        label: loc.name,
        enabled: true,
      });
    }
    choices.push({ index: choices.length + 1, id: 'jtab:root', label: 'Back', enabled: true });
    return choices;
  }

  if (state.journalTab === 'items') {
    const allKnown = new Set<string>([
      ...state.discovery.knownItems,
      ...(Object.values(state.player.equipment).filter(Boolean) as string[]),
      ...state.player.inventory.map((i) => i.id),
    ]);
    for (const itemId of allKnown) {
      const item = ITEMS[itemId];
      if (!item) continue;
      choices.push({
        index: choices.length + 1,
        id: `jdetail:${itemId}`,
        label: item.name,
        enabled: true,
      });
    }
    choices.push({ index: choices.length + 1, id: 'jtab:root', label: 'Back', enabled: true });
    return choices;
  }

  choices.push({ index: 1, id: 'jtab:root', label: 'Back', enabled: true });
  return choices;
}

export function renderJournalBody(state: GameState): string[] {
  const p = state.player;

  if (state.journalTab === 'root') {
    return [
      'TRAVELER JOURNAL',
      'Inspect your own body, alterations, exact attack mechanics, observed beasts, people met, known places, items, and recorded deeds.',
    ];
  }

  if (state.journalTab === 'self') {
    const race = RACES[p.race];
    const bg = BACKGROUNDS[p.background];
    const weapon = p.equipment.mainHand ? ITEMS[p.equipment.mainHand] : null;
    const offHand = p.equipment.offHand ? ITEMS[p.equipment.offHand] : null;
    const armor = p.equipment.armor ? ITEMS[p.equipment.armor] : null;
    const cloak = p.equipment.cloak ? ITEMS[p.equipment.cloak] : null;
    const trinket = p.equipment.trinket ? ITEMS[p.equipment.trinket] : null;
    const gearParts = [
      ...(weapon ? [`${weapon.name}${p.weaponHoned ? ' Honed' : ''}`] : []),
      ...(offHand ? [offHand.name] : []),
      ...(armor ? [`${armor.name} Tier ${p.armorTierCurrent}`] : []),
      ...(cloak ? [cloak.name] : []),
      ...(trinket ? [trinket.name] : []),
    ];
    const statusLine =
      p.statuses.length > 0
        ? p.statuses.map((s) => `${s.type} for ${s.turns} turns`).join(', ')
        : 'Clear of afflictions';

    const resLine = formatResistanceProfile(getEffectivePlayerResistances(state));

    const lines = [
      'JOURNAL - SELF',
      `Identity: ${p.name} - ${p.sex === 'female' ? 'Female' : 'Male'} ${race.name} ${bg.name}, Level ${p.level}`,
      `Vitality: HP ${p.hp}/${p.maxHp} | Resolve ${p.resolve}/${p.maxResolve} | Stamina ${p.stamina}/${p.maxStamina} | Focus ${p.focus}/${p.maxFocus} | Defilement ${p.defilement}/100`,
      `Attributes: Might ${getEffectiveStat(state, 'might')} | Agility ${getEffectiveStat(state, 'agility')} | Wit ${getEffectiveStat(state, 'wit')} | Grit ${getEffectiveStat(state, 'grit')}`,
      `Passives: ${race.passive.name} - ${race.passive.description} | ${bg.passive.name} - ${bg.passive.description}`,
      ...(resLine ? [`Damage Affinities: ${resLine}`] : []),
      '',
      ...renderAnatomyProse('Physical Description', p.anatomy, {
        gearLine: gearParts.join(', '),
        conditionLine: getHealthConditionLabel(p.hp, p.maxHp),
        statusLine,
      }),
    ];

    const mods = Object.entries(p.bodyMods);
    if (mods.length > 0) {
      lines.push('');
      lines.push('Body Modifications:');
      for (const [slot, modId] of mods) {
        const mod = modId ? BODY_MODS[modId] : undefined;
        if (!mod) continue;
        lines.push(`  - ${mod.name} | ${mod.kind} in ${slot}`);
        lines.push(`    Bonus: ${mod.bonusSummary}`);
        lines.push(`    Drawback: ${mod.drawbackSummary}`);
      }
    }

    if (p.injuries.length > 0) {
      lines.push('');
      lines.push('Lasting Injuries:');
      for (const injId of p.injuries) {
        const inj = INJURIES[injId];
        if (inj) lines.push(`  - ${inj.name}: ${inj.description}`);
      }
    }

    if (p.perks.length > 0) {
      lines.push('');
      lines.push('Perks:');
      for (const pid of p.perks) {
        const perk = PERKS[pid];
        if (perk) lines.push(`  - ${perk.name}: ${perk.description}`);
      }
    }
    return lines;
  }

  if (state.journalTab === 'arts') {
    const weapon = p.equipment.mainHand ? ITEMS[p.equipment.mainHand] : undefined;
    const heirloom = HEIRLOOMS[p.heirloom];
    const [wdCount, wdSides] = weapon?.damageDice ?? [1, 6];
    const wBonus = (weapon?.bonusDamage ?? 0) + (p.weaponHoned ? 1 : 0);
    const wStat = weapon?.statScaling ?? 'might';
    const wType = DAMAGE_TYPE_META[weapon?.damageType ?? 'slashing'].label;

    const lines: string[] = [
      'JOURNAL - ATTACKS AND ARTS',
      '',
      `Strike: Uses ${weapon?.name ?? 'Weapon'} | ${wType} ${wdCount}d${wdSides}+${wBonus} plus ${wStat} | Cost Free`,
      'Subdue: Bludgeoning flat-of-weapon blow | High chance to leave foe downed alive | Cost 1 Stamina',
      'Guard: Raises armor by 4 for 1 turn, restores 1 Stamina, 2 Focus, and 2 Resolve | Cost Free',
      'Observe: Free Wit check once per combat round to read enemy anatomy, stats, gear, and affinities.',
      '',
      'Known Skills, Cantrips, and Spells:',
    ];

    for (const abId of p.abilities) {
      const ab = ABILITIES[abId];
      if (!ab) continue;
      const costParts: string[] = [];
      if (ab.staminaCost > 0) costParts.push(`Stamina ${ab.staminaCost}`);
      if (ab.focusCost > 0) costParts.push(`Focus ${ab.focusCost}`);
      if (ab.hpCost) costParts.push(`HP ${ab.hpCost}`);
      const effectParts: string[] = [];
      if (ab.damageDice) {
        const dType = DAMAGE_TYPE_META[ab.damageType ?? 'bludgeoning'].label;
        effectParts.push(`${dType} ${ab.damageDice[0]}d${ab.damageDice[1]}+${ab.baseDamage ?? 0} plus ${ab.stat}`);
      }
      if (ab.healAmount) effectParts.push(`Heals ${ab.healAmount} plus ${ab.stat}`);
      if (ab.restoreResolve) effectParts.push(`Restores ${ab.restoreResolve} Resolve`);
      if (ab.isAoE) effectParts.push('Hits all enemies');
      if (ab.pierceArmor) effectParts.push('Pierces armor');
      if (ab.shatterGuard) effectParts.push('Shatters guard');
      if (ab.bonusVsDebuffed) effectParts.push(`Plus ${ab.bonusVsDebuffed} vs afflicted foe`);
      if (ab.applyEnemyStatus) {
        effectParts.push(`Inflicts ${ab.applyEnemyStatus.type} ${ab.applyEnemyStatus.power} for ${ab.applyEnemyStatus.turns} turns`);
      }
      if (ab.applySelfStatus) {
        effectParts.push(`Grants ${ab.applySelfStatus.type} ${ab.applySelfStatus.power} for ${ab.applySelfStatus.turns} turns`);
      }
      if (ab.restoreStamina) effectParts.push(`Restores ${ab.restoreStamina} Stamina`);
      if (ab.restoreFocus) effectParts.push(`Restores ${ab.restoreFocus} Focus`);
      if (ab.purgeNegativeStatuses) effectParts.push('Purges negative afflictions');

      lines.push(`  - ${ab.name} | ${ab.kind} | ${costParts.join(', ')}`);
      lines.push(`    ${effectParts.join(' | ')}`);
      lines.push(`    ${ab.description}`);
    }

    lines.push('');
    lines.push(`Heirloom - ${heirloom.name} | Once per fight`);
    lines.push(`  ${heirloom.combatDescription}`);
    return lines;
  }

  if (state.journalTab === 'bestiary') {
    if (state.journalDetailId) {
      const tpl = ENEMIES[state.journalDetailId];
      const rec = state.discovery.knownEnemies[state.journalDetailId];
      if (!tpl || !rec) return ['Entry not found.'];

      const lines: string[] = [
        `BESTIARY - ${rec.identified ? tpl.name.toUpperCase() : tpl.unidentifiedName.toUpperCase()}`,
        '',
        tpl.firstSightProse,
      ];

      if (rec.appraisalTier >= 2) {
        lines.push('');
        lines.push(
          ...renderAnatomyProse('Observed Anatomy', tpl.anatomy, {
            gearLine: `${tpl.visibleGear.weapon}; ${tpl.visibleGear.armor}. ${tpl.visibleGear.hiddenDetail}`,
          }),
        );
        lines.push('');
        lines.push('Observed Capability:');
        for (const r of describeStatImpressions(tpl.stats, 2)) {
          lines.push(`  - ${r}`);
        }
        const resLine = formatResistanceProfile(tpl.resistances);
        if (resLine) lines.push(`  - Affinities: ${resLine}`);
      } else if (rec.appraisalTier === 1) {
        lines.push('');
        lines.push(`Surface Impression: ${tpl.visibleGear.weapon}; ${tpl.visibleGear.armor}.`);
        for (const r of describeStatImpressions(tpl.stats, 1)) {
          lines.push(`  - ${r}`);
        }
        lines.push('Use Observe in combat to uncover full anatomy, affinities, and true identity.');
      } else {
        lines.push('');
        lines.push('Not yet studied closely. Use Observe in combat to learn its anatomy, build, and gear.');
      }

      if (rec.observedAttacks.length > 0) {
        lines.push('');
        lines.push(`Observed Attacks: ${rec.observedAttacks.join(', ')}`);
      }

      const links = getRelatedLinks(`enemy:${tpl.id}`);
      if (links.length > 0) {
        lines.push('');
        lines.push('Connections:');
        for (const l of links) {
          lines.push(`  - ${l.note}`);
        }
      }
      return lines;
    }

    const count = Object.values(state.discovery.knownEnemies).filter((r) => r.seen).length;
    return [
      'JOURNAL - BESTIARY',
      count === 0
        ? 'No creatures encountered yet.'
        : 'Select a creature to review its silhouette, anatomy, observed gear, affinities, and attacks.',
    ];
  }

  if (state.journalTab === 'people') {
    if (state.journalDetailId) {
      const found = findNpcById(state.journalDetailId);
      if (!found) return ['Person not found.'];
      const lines = [
        `PEOPLE - ${found.npc.name.toUpperCase()}`,
        `Location: ${found.location.name}`,
        '',
        ...renderAnatomyProse('Physical Appearance', found.npc.anatomy),
      ];
      const links = getRelatedLinks(`npc:${found.npc.id}`);
      if (links.length > 0) {
        lines.push('');
        lines.push('Known Ties:');
        for (const l of links) {
          lines.push(`  - ${l.note}`);
        }
      }
      return lines;
    }

    return [
      'JOURNAL - PEOPLE',
      state.discovery.knownNpcs.length === 0
        ? 'You have not spoken closely with anyone yet.'
        : 'Select a person to review their appearance and ties.',
    ];
  }

  if (state.journalTab === 'places') {
    if (state.journalDetailId) {
      const loc = LOCATIONS[state.journalDetailId];
      if (!loc) return ['Place not found.'];
      const lines = [
        `PLACES - ${loc.name.toUpperCase()}`,
        '',
        loc.sensorySummary,
        '',
        `Connected Trails: ${loc.neighbors.map((nid) => LOCATIONS[nid]?.name ?? nid).join(', ')}`,
      ];
      const links = getRelatedLinks(`place:${loc.id}`);
      if (links.length > 0) {
        lines.push('');
        lines.push('Known Notes:');
        for (const l of links) {
          lines.push(`  - ${l.note}`);
        }
      }
      return lines;
    }

    return [
      'JOURNAL - PLACES',
      'Select a known location to review its surroundings, roads, and notes.',
    ];
  }

  if (state.journalTab === 'items') {
    if (state.journalDetailId) {
      const item = ITEMS[state.journalDetailId];
      if (!item) return ['Item not found.'];
      const stats: string[] = [`Category: ${item.slot}`, `Value: ${item.value} Crowns`];
      if (item.damageDice) {
        const dt = DAMAGE_TYPE_META[item.damageType ?? 'slashing'].label;
        stats.push(`Damage: ${dt} ${item.damageDice[0]}d${item.damageDice[1]}+${item.bonusDamage ?? 0} plus ${item.statScaling ?? 'might'}`);
      }
      if (item.armorBonus) stats.push(`Armor: +${item.armorBonus}`);
      const res = formatResistanceProfile(item.resistances);
      if (res) stats.push(`Affinities: ${res}`);
      if (item.maxHpBonus) stats.push(`Max HP: +${item.maxHpBonus}`);
      if (item.maxFocusBonus) stats.push(`Max Focus: +${item.maxFocusBonus}`);
      if (item.healHp) stats.push(`Restores HP: ${item.healHp}`);
      if (item.restoreStamina) stats.push(`Restores Stamina: ${item.restoreStamina}`);
      if (item.restoreFocus) stats.push(`Restores Focus: ${item.restoreFocus}`);
      if (item.restoreResolve) stats.push(`Restores Resolve: ${item.restoreResolve}`);
      if (item.throwDamage) {
        const tt = DAMAGE_TYPE_META[item.throwDamageType ?? 'fire'].label;
        stats.push(`Thrown Damage: ${tt} ${item.throwDamage}`);
      }
      if (item.grantsBodyModId && BODY_MODS[item.grantsBodyModId]) {
        const mod = BODY_MODS[item.grantsBodyModId];
        stats.push(`Grants Modification: ${mod.name} in ${mod.slot}`);
        stats.push(`Bonus: ${mod.bonusSummary}`);
        stats.push(`Drawback: ${mod.drawbackSummary}`);
      }
      if (item.cureNegative) stats.push('Purges negative afflictions');

      const lines = [
        `ITEMS - ${item.name.toUpperCase()}`,
        '',
        item.description,
        '',
        ...stats,
      ];

      const usedIn = RECIPES.filter((r) => r.ingredients.some((i) => i.itemId === item.id));
      if (usedIn.length > 0) {
        lines.push(`Craft Uses: ${usedIn.map((r) => r.name).join(', ')}`);
      }
      const links = getRelatedLinks(`item:${item.id}`);
      if (links.length > 0) {
        lines.push('');
        lines.push('Connections:');
        for (const l of links) {
          lines.push(`  - ${l.note}`);
        }
      }
      return lines;
    }

    return [
      'JOURNAL - ITEMS',
      'Select an item or reagent to inspect its craft and exact effects.',
    ];
  }

  const lines = ['JOURNAL - CHRONICLE', '', 'Faction Standing:'];
  (Object.keys(FACTION_NAMES) as Array<keyof typeof FACTION_NAMES>).forEach((fid) => {
    const val = state.memory.factions[fid] ?? 0;
    lines.push(`  - ${FACTION_NAMES[fid]}: ${val >= 0 ? `+${val}` : val} - ${getFactionStance(val)}`);
  });
  lines.push('');
  lines.push(`Counter-Seals Broken: ${countBrokenSeals(state)}/3`);
  lines.push(`  - Seal of Silence: ${state.memory.flags['seal_of_silence'] ? 'Acquired' : 'Unfound'}`);
  lines.push(`  - Root Conduit: ${state.memory.flags['root_conduit_severed'] ? 'Severed' : 'Intact'}`);
  lines.push(`  - First Kiln Cipher: ${state.memory.flags['kiln_cipher_learned'] ? 'Learned' : 'Unfound'}`);
  lines.push('');
  lines.push('Recorded Deeds:');
  if (state.memory.chronicle.length === 0) {
    lines.push('  Your deeds are not yet written in the Reach.');
  } else {
    for (const c of state.memory.chronicle) {
      lines.push(`  Day ${c.day} - ${c.title}: ${c.summary}`);
    }
  }
  return lines;
}
