import type { GameState } from './types.ts';
import { RACES, BACKGROUNDS, HEIRLOOMS, ABILITIES, PERKS } from './content/characters.ts';
import { ITEMS } from './content/items.ts';
import { LOCATIONS } from './content/locations.ts';
import { getEffectiveStat } from './dice.ts';
import { FACTION_NAMES, getFactionStance, countBrokenSeals } from './memory.ts';
import { formatClockLabel } from './systems/clock.ts';
import { PALE_SHIFTS } from './systems/frontier.ts';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
} as const;

export function paint(
  text: string,
  color: keyof typeof ANSI,
  stealth: boolean,
): string {
  if (stealth) return text;
  return `${ANSI[color]}${text}${ANSI.reset}`;
}

export function divider(stealth: boolean, char = '-'): string {
  const line = char.repeat(74);
  return stealth ? line : paint(line, 'gray', false);
}

export function wrapText(text: string, width = 74): string {
  const rawLines = text.split('\n');
  const wrapped: string[] = [];

  for (const raw of rawLines) {
    if (raw.trim().length === 0) {
      wrapped.push('');
      continue;
    }
    const leadMatch = raw.match(/^(\s*)/);
    const indent = leadMatch ? leadMatch[1] : '';
    const words = raw.trim().split(/\s+/);
    let current = indent;

    for (const word of words) {
      if (current.trim().length === 0) {
        current += word;
      } else if (current.length + 1 + word.length <= width) {
        current += ` ${word}`;
      } else {
        wrapped.push(current);
        current = `${indent}${word}`;
      }
    }
    if (current.trim().length > 0) {
      wrapped.push(current);
    }
  }

  return wrapped.join('\n');
}

export function formatActionGrid(
  choices: Array<{ index: number; label: string; enabled: boolean }>,
): string[] {
  const formatted = choices.map((c) => {
    const suffix = c.enabled ? '' : ' - Unavailable';
    return `${c.index}. ${c.label}${suffix}`;
  });

  const canTwoColumn =
    formatted.length >= 4 && formatted.every((entry) => entry.length <= 28);

  if (!canTwoColumn) {
    return formatted.map((entry) => `  ${entry}`);
  }

  const lines: string[] = [];
  for (let i = 0; i < formatted.length; i += 2) {
    const left = formatted[i].padEnd(32, ' ');
    const right = formatted[i + 1] ?? '';
    lines.push(right ? `  ${left}${right}` : `  ${formatted[i]}`);
  }
  return lines;
}

export function formatStatusHeader(state: GameState): string {
  const p = state.player;
  const s = state.stealthMode;
  const loc = LOCATIONS[state.locationId];
  const raceName = RACES[p.race].name;
  const bgName = BACKGROUNDS[p.background].name;
  const sexLabel = p.sex === 'female' ? 'Female' : 'Male';
  const seals = countBrokenSeals(state);

  const placeLabel =
    state.locationId === 'camp_hub' ? 'Lone Camp' : (loc?.name ?? state.locationId);
  const top = `${p.name} - ${sexLabel} ${raceName} ${bgName} Lv${p.level} | ${placeLabel}`;
  const clockBar = `${formatClockLabel(state.clock)} | Crowns ${p.crowns} | Rations ${p.rations} | Torches ${p.torches} | Seals ${seals}/3`;
  const vitalsBar = `HP ${p.hp}/${p.maxHp} | RES ${p.resolve}/${p.maxResolve} | STM ${p.stamina}/${p.maxStamina} | FOC ${p.focus}/${p.maxFocus} | DEF ${p.defilement}/100 | RESV ${p.reserves}/${p.maxReserves} | GRACE ${p.grace}/${p.maxGrace}`;

  const alerts: string[] = [];
  if (state.clock.paleShift && state.clock.paleShift !== 'none') {
    alerts.push(`Pale-Shift: ${PALE_SHIFTS[state.clock.paleShift].label}`);
  }
  if (p.statuses.length > 0) {
    alerts.push(`Statuses: ${p.statuses.map((st) => `${st.type} ${st.turns}t`).join(', ')}`);
  }
  if (p.injuries.length > 0) {
    alerts.push(`Injuries: ${p.injuries.length}`);
  }
  const statusLine = alerts.join(' | ');

  if (s) {
    return [
      divider(true, '='),
      top,
      clockBar,
      vitalsBar,
      ...(statusLine ? [statusLine] : []),
      divider(true, '='),
    ].join('\n');
  }

  return [
    divider(false, '='),
    paint(top, 'cyan', false),
    paint(clockBar, 'white', false),
    paint(vitalsBar, 'yellow', false),
    ...(statusLine ? [paint(statusLine, 'red', false)] : []),
    divider(false, '='),
  ].join('\n');
}

export function renderAsciiMap(state: GameState): string {
  const s = state.stealthMode;
  const cur = state.locationId;
  const mark = (id: string, code: string) => {
    const visited = state.visitedLocations.includes(id);
    if (cur === id) return `${code}*`;
    return visited ? `${code} ` : `${code}?`;
  };

  const lines = [
    'FRONTIER MAP - THE GLOAMING REACH',
    '* current   ? unvisited',
    '',
    `  ${mark('weeping_barrow', 'WB')} ------ ${mark('petrified_starwood', 'SW')} ------ ${mark('crown_watchtower', 'CW')}`,
    '   |          |          |',
    `  ${mark('cinderford', 'CF')} ------ ${mark('kings_causeway', 'KC')}        ${mark('sunken_belfry', 'SB')}`,
    '   |          |          |',
    `  ${mark('ash_fen', 'AF')} ------ ${mark('silken_cistern', 'SC')} ------ ${mark('drowned_forge', 'DF')}`,
    '',
    'Legend:',
    "  CF Cinderford Keep         KC Old King's Causeway",
    '  WB Weeping Barrow          SW Petrified Star-Wood',
    '  AF Ash-Fen & Spore-Mire    SC Silken Cistern',
    '  DF Drowned Forge-Vault     CW Crown-Gate Watchtower',
    '  SB The Sunken Belfry',
  ];

  return s ? lines.join('\n') : paint(lines.join('\n'), 'white', false);
}

export function renderCharacterSheet(state: GameState): string {
  const p = state.player;
  const race = RACES[p.race];
  const bg = BACKGROUNDS[p.background];
  const heirloom = HEIRLOOMS[p.heirloom];
  const mainHand = p.equipment.mainHand ? ITEMS[p.equipment.mainHand] : null;
  const offHand = p.equipment.offHand ? ITEMS[p.equipment.offHand] : null;
  const armor = p.equipment.armor ? ITEMS[p.equipment.armor] : null;
  const cloak = p.equipment.cloak ? ITEMS[p.equipment.cloak] : null;
  const trinket = p.equipment.trinket ? ITEMS[p.equipment.trinket] : null;

  const lines: string[] = [
    `CHARACTER SHEET - ${p.name}`,
    `Identity: ${p.sex === 'female' ? 'Female' : 'Male'} ${race.name} ${bg.name}`,
    `Level ${p.level} | XP ${p.xp}/${p.xpToNext} | HP ${p.hp}/${p.maxHp} | Stamina ${p.stamina}/${p.maxStamina} | Focus ${p.focus}/${p.maxFocus}`,
    `Reserves ${p.reserves}/${p.maxReserves} | Grace ${p.grace}/${p.maxGrace}`,
    `Stats: Might ${getEffectiveStat(state, 'might')} | Agility ${getEffectiveStat(state, 'agility')} | Wit ${getEffectiveStat(state, 'wit')} | Grit ${getEffectiveStat(state, 'grit')}`,
    `Passives: ${race.passive.name} - ${race.passive.description} | ${bg.passive.name} - ${bg.passive.description}`,
    `Heirloom: ${heirloom.name} - ${heirloom.combatDescription}`,
    'Equipment:',
    `  Main-Hand: ${mainHand ? mainHand.name : 'None'}${p.weaponHoned ? ' Honed' : ''}${p.weaponCoating ? ` - ${p.weaponCoating.name} ${p.weaponCoating.charges}x` : ''}`,
    `  Off-Hand : ${offHand ? offHand.name : mainHand?.twoHanded ? 'Two-Handed Locked' : 'None'}`,
    `  Armor    : ${armor ? `${armor.name} Tier ${p.armorTierCurrent}` : 'None'}`,
    `  Cloak    : ${cloak ? cloak.name : 'None'}`,
    `  Trinket  : ${trinket ? trinket.name : 'None'}`,
    'Abilities:',
  ];

  for (const abId of p.abilities) {
    const ab = ABILITIES[abId];
    if (ab) {
      lines.push(`  - ${ab.name}: ${ab.description}`);
    }
  }

  if (p.perks.length > 0) {
    lines.push('Perks:');
    for (const pid of p.perks) {
      const perk = PERKS[pid];
      if (perk) lines.push(`  - ${perk.name}: ${perk.description}`);
    }
  }

  return lines.join('\n');
}

export function renderInventory(state: GameState): string {
  const p = state.player;
  const mainHand = p.equipment.mainHand ? ITEMS[p.equipment.mainHand] : null;
  const offHand = p.equipment.offHand ? ITEMS[p.equipment.offHand] : null;
  const armor = p.equipment.armor ? ITEMS[p.equipment.armor] : null;
  const cloak = p.equipment.cloak ? ITEMS[p.equipment.cloak] : null;
  const trinket = p.equipment.trinket ? ITEMS[p.equipment.trinket] : null;
  const lines = [
    'INVENTORY',
    `Crowns ${p.crowns} | Rations ${p.rations} | Torches ${p.torches}`,
    `Main-Hand: ${mainHand ? mainHand.name : 'None'}${p.weaponHoned ? ' Honed' : ''}${p.weaponCoating ? ` - ${p.weaponCoating.name} ${p.weaponCoating.charges}x` : ''}`,
    `Off-Hand : ${offHand ? offHand.name : mainHand?.twoHanded ? 'Two-Handed Locked' : 'None'}`,
    `Armor    : ${armor ? `${armor.name} Tier ${p.armorTierCurrent}` : 'None'}`,
    `Cloak    : ${cloak ? cloak.name : 'None'}`,
    `Trinket  : ${trinket ? trinket.name : 'None'}`,
    '',
    'Pack:',
  ];

  if (p.inventory.length === 0) {
    lines.push('  Empty');
  } else {
    for (const entry of p.inventory) {
      const item = ITEMS[entry.id];
      if (item) {
        lines.push(`  - ${item.name} x${entry.qty} - ${item.description}`);
      }
    }
  }
  return lines.join('\n');
}

export function renderMemoryChronicle(state: GameState): string {
  const lines = ['WORLD MEMORY & FACTIONS', ''];
  lines.push('Faction Standing:');
  (Object.keys(FACTION_NAMES) as Array<keyof typeof FACTION_NAMES>).forEach((fid) => {
    const val = state.memory.factions[fid] ?? 0;
    lines.push(`  - ${FACTION_NAMES[fid]}: ${val >= 0 ? `+${val}` : val} - ${getFactionStance(val)}`);
  });

  lines.push('');
  lines.push('Counter-Seals:');
  lines.push(
    `  - Seal of Silence: ${state.memory.flags['seal_of_silence'] ? 'Acquired' : 'Unfound'}`,
  );
  lines.push(
    `  - Root Conduit: ${state.memory.flags['root_conduit_severed'] ? 'Severed' : 'Intact'}`,
  );
  lines.push(
    `  - First Kiln Cipher: ${state.memory.flags['kiln_cipher_learned'] ? 'Learned' : 'Unfound'}`,
  );

  lines.push('');
  lines.push('Chronicle:');
  if (state.memory.chronicle.length === 0) {
    lines.push('  Your deeds are not yet written in the Reach.');
  } else {
    for (const c of state.memory.chronicle) {
      lines.push(`  Day ${c.day} - ${c.title}: ${c.summary}`);
    }
  }
  return lines.join('\n');
}

export function renderHelpText(): string {
  return [
    'COMMANDS',
    '  1, 2, 3...    Choose a numbered option',
    '  0 or back     Return to the previous menu',
    '  look          Inspect full surroundings in detail',
    '  journal or j  Open the Traveler Journal anytime, even in combat',
    '  go <place>    Travel directly to a neighboring site',
    '  map           Display the frontier map',
    '  stats         View character sheet',
    '  inv           View pack and supplies',
    '  equip <item>  Equip gear from pack',
    '  use <item>    Use a consumable outside combat',
    '  camp          Make camp',
    '  stealth       Toggle monochrome plain-text mode',
    '  quit          Save and exit',
  ].join('\n');
}
