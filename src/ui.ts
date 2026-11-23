import type { GameState } from './types.ts';
import { RACES, BACKGROUNDS, HEIRLOOMS, ABILITIES, PERKS } from './content/characters.ts';
import { ITEMS } from './content/items.ts';
import { LOCATIONS } from './content/locations.ts';
import { getEffectiveStat } from './dice.ts';
import { FACTION_NAMES, getFactionStance, countBrokenSeals } from './memory.ts';

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
  const line = char.repeat(68);
  return stealth ? line : paint(line, 'gray', false);
}

export function formatStatusHeader(state: GameState): string {
  const p = state.player;
  const s = state.stealthMode;
  const loc = LOCATIONS[state.locationId];
  const raceName = RACES[p.race].name;
  const bgName = BACKGROUNDS[p.background].name;
  const daysLeft = Math.max(0, state.maxDays - state.day);

  const hpStr = `HP ${p.hp}/${p.maxHp}`;
  const stmStr = `STM ${p.stamina}/${p.maxStamina}`;
  const focStr = `FOC ${p.focus}/${p.maxFocus}`;
  const seals = countBrokenSeals(state);

  const top = `${p.name} (${p.sex === 'female' ? 'F' : 'M'} ${raceName} ${bgName}, Lv${p.level}) | ${loc?.name ?? state.locationId}`;
  const bar = `Day ${state.day}/${state.maxDays} (${daysLeft}d left) | ${hpStr} | ${stmStr} | ${focStr} | Rations:${p.rations} Torches:${p.torches} Crowns:${p.crowns} | Seals:${seals}/3`;

  const statusLine =
    p.statuses.length > 0
      ? `Statuses: ${p.statuses.map((st) => `${st.type.toUpperCase()}(${st.turns}t)`).join(', ')}`
      : '';

  if (s) {
    return [divider(true, '='), top, bar, ...(statusLine ? [statusLine] : []), divider(true, '=')].join('\n');
  }

  return [
    divider(false, '='),
    paint(top, 'cyan', false),
    paint(bar, 'yellow', false),
    ...(statusLine ? [paint(statusLine, 'red', false)] : []),
    divider(false, '='),
  ].join('\n');
}

export function renderAsciiMap(state: GameState): string {
  const s = state.stealthMode;
  const cur = state.locationId;
  const mark = (id: string, code: string) => {
    const visited = state.visitedLocations.includes(id);
    if (cur === id) return `[${code}*]`;
    return visited ? `[${code} ]` : `[${code}?]`;
  };

  const lines = [
    'FRONTIER MAP — THE GLOAMING REACH (* = current, ? = unvisited)',
    '',
    `  ${mark('weeping_barrow', 'WB')} ------ ${mark('petrified_starwood', 'SW')} ------ ${mark('crown_watchtower', 'CW')}`,
    '    |            |            |',
    `  ${mark('cinderford', 'CF')} ------ ${mark('kings_causeway', 'KC')}          ${mark('sunken_belfry', 'SB')}`,
    '    |            |            |',
    `  ${mark('ash_fen', 'AF')} ------ ${mark('silken_cistern', 'SC')} ------ ${mark('drowned_forge', 'DF')}`,
    '',
    'Legend:',
    '  CF: Cinderford Keep (Town)       KC: Old King\'s Causeway (Road)',
    '  WB: Weeping Barrow (Ruin)        SW: Petrified Star-Wood (Wilds)',
    '  AF: Ash-Fen & Spore-Mire (Wilds) SC: Silken Cistern (Sanctuary)',
    '  DF: Drowned Forge-Vault (Ruin)   CW: Crown-Gate Watchtower (Fort)',
    '  SB: The Sunken Belfry (Threat Lair — Malakor)',
  ];

  return s ? lines.join('\n') : paint(lines.join('\n'), 'white', false);
}

export function renderCharacterSheet(state: GameState): string {
  const p = state.player;
  const race = RACES[p.race];
  const bg = BACKGROUNDS[p.background];
  const heirloom = HEIRLOOMS[p.heirloom];
  const weapon = ITEMS[p.weaponId];
  const armor = ITEMS[p.armorId];
  const trinket = p.trinketId ? ITEMS[p.trinketId] : null;

  const lines: string[] = [
    `CHARACTER SHEET — ${p.name}`,
    `Identity: ${p.sex === 'female' ? 'Female' : 'Male'} ${race.name} (${race.subtitle}) | ${bg.name}`,
    `Level ${p.level} (XP ${p.xp}/${p.xpToNext}) | HP ${p.hp}/${p.maxHp} | Stamina ${p.stamina}/${p.maxStamina} | Focus ${p.focus}/${p.maxFocus}`,
    `Stats: Might ${getEffectiveStat(state, 'might')} | Agility ${getEffectiveStat(state, 'agility')} | Wit ${getEffectiveStat(state, 'wit')} | Grit ${getEffectiveStat(state, 'grit')}`,
    `Passives: ${race.passive.name} (${race.passive.description}); ${bg.passive.name} (${bg.passive.description})`,
    `Heirloom: ${heirloom.name} — ${heirloom.combatDescription}`,
    `Equipment:`,
    `  Weapon : ${weapon?.name ?? p.weaponId}${p.weaponHoned ? ' [Honed +1]' : ''} (${weapon?.description ?? ''})`,
    `  Armor  : ${armor?.name ?? p.armorId} (${armor?.description ?? ''})`,
    `  Trinket: ${trinket ? `${trinket.name} (${trinket.description})` : 'None'}`,
    `Abilities & Spells:`,
  ];

  for (const abId of p.abilities) {
    const ab = ABILITIES[abId];
    if (ab) {
      const costParts: string[] = [];
      if (ab.staminaCost > 0) costParts.push(`${ab.staminaCost} Stm`);
      if (ab.focusCost > 0) costParts.push(`${ab.focusCost} Foc`);
      if (ab.hpCost) costParts.push(`${ab.hpCost} HP`);
      lines.push(`  - [${ab.kind.toUpperCase()}] ${ab.name} (${costParts.join(', ')}): ${ab.description}`);
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
  const lines = [
    `INVENTORY & SUPPLIES`,
    `Crowns: ${p.crowns} | Rations: ${p.rations} | Torches: ${p.torches}`,
    `Equipped Weapon: ${ITEMS[p.weaponId]?.name ?? p.weaponId}${p.weaponHoned ? ' [Honed]' : ''}`,
    `Equipped Armor : ${ITEMS[p.armorId]?.name ?? p.armorId}`,
    `Equipped Trinket: ${p.trinketId ? ITEMS[p.trinketId]?.name : 'None'}`,
    '',
    'Pack:',
  ];

  if (p.inventory.length === 0) {
    lines.push('  (empty)');
  } else {
    for (const entry of p.inventory) {
      const item = ITEMS[entry.id];
      if (item) {
        lines.push(
          `  - ${item.name} x${entry.qty} [${item.slot}] (${item.value}c) — ${item.description}`,
        );
      }
    }
  }
  lines.push('');
  lines.push('Tip: type "use <item name>" or "equip <item name>" to use or swap gear.');
  return lines.join('\n');
}

export function renderMemoryChronicle(state: GameState): string {
  const lines = ['WORLD MEMORY & FACTIONS', ''];
  lines.push('Faction Standing:');
  (Object.keys(FACTION_NAMES) as Array<keyof typeof FACTION_NAMES>).forEach((fid) => {
    const val = state.memory.factions[fid] ?? 0;
    lines.push(`  - ${FACTION_NAMES[fid]}: ${val >= 0 ? `+${val}` : val} (${getFactionStance(val)})`);
  });

  lines.push('');
  lines.push('Counter-Seals & Key Leads against Malakor:');
  lines.push(
    `  - Seal of Silence (Silken Cistern): ${state.memory.flags['seal_of_silence'] ? 'ACQUIRED' : 'Unfound'}`,
  );
  lines.push(
    `  - Root Conduit Severed (Star-Wood / Forge): ${state.memory.flags['root_conduit_severed'] ? 'SEVERED' : 'Intact'}`,
  );
  lines.push(
    `  - First Kiln Cipher (Weeping Barrow): ${state.memory.flags['kiln_cipher_learned'] ? 'LEARNED' : 'Unfound'}`,
  );

  lines.push('');
  lines.push('Recorded Deeds:');
  if (state.memory.chronicle.length === 0) {
    lines.push('  (Your deeds are not yet written in the Reach.)');
  } else {
    for (const c of state.memory.chronicle) {
      lines.push(`  [Day ${c.day}] ${c.title}: ${c.summary}`);
    }
  }
  return lines.join('\n');
}

export function renderHelpText(): string {
  return [
    'COMMANDS',
    '  1, 2, 3...       Select a numbered action, dialogue, combat move, or destination',
    '  look (l)         Re-read the current location and available choices',
    '  go <name>        Travel directly to a connected location (e.g. "go causeway")',
    '  map (m)          Display the ASCII map of the Gloaming Reach',
    '  stats (st)       View character sheet, stats, passives, spells, and perks',
    '  inv (i)          View pack, supplies, and equipped gear',
    '  equip <item>     Equip a weapon, armor, or trinket from your pack',
    '  use <item>       Use a consumable (e.g. "use poultice") outside combat',
    '  camp             Make camp in the wilds (costs 1 Ration; heals HP/Stm/Foc; advances 1 day)',
    '  memory (j)       Inspect faction standings, Counter-Seals, and recorded deeds',
    '  stealth          Toggle plain monochrome log mode (no ANSI colors)',
    '  quit (q)         Save and exit cleanly',
  ].join('\n');
}
