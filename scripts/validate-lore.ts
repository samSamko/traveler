import { ENEMIES } from '../src/content/enemies.ts';
import { LOCATIONS } from '../src/content/locations.ts';
import { ITEMS } from '../src/content/items.ts';
import { EVENTS } from '../src/content/events.ts';
import { ABILITIES } from '../src/content/characters.ts';
import { ENTITY_LINKS } from '../src/writing/links.ts';
import { BODY_MODS } from '../src/systems/bodymods.ts';
import { INJURIES } from '../src/systems/injuries.ts';
import { DAMAGE_TYPE_META } from '../src/systems/damage.ts';
import { createNewGame } from '../src/engine.ts';
import { getWorldDatabase } from '../src/db/loader.ts';
import type { AnatomyProfile } from '../src/types.ts';

const errors: string[] = [];

// Incident 2026-11-25: Legacy Gloaming Reach canon leaked into Far North prose and named enemies.
const LEGACY_CANON_RE =
  /(gloaming|gloam|belfry|cinderford|weeping barrow|ash-fen|pale root|pale choir|husk-tide|aethel|vesper|malakor|vorne|\bkale\b|veyra|star-wood|khaz-durn|first kiln|kiln-spark|kiln-light|kiln-ember|ash-born|ash-rain|ash-settling|ash-text|\bash\b|ash-|-ash)/i;

function checkNoLegacyCanon(val: string, context: string): void {
  const m = val.match(LEGACY_CANON_RE);
  if (m) {
    errors.push(`Legacy canon term "${m[0]}" in ${context}: "${val}"`);
  }
}

function checkNoBracketsOrParens(val: string, context: string): void {
  if (/[\[\]()]/.test(val)) {
    errors.push(`Forbidden brackets/parentheses in ${context}: "${val}"`);
  }
}

function checkAnatomy(anatomy: AnatomyProfile, context: string): void {
  const requiredFields: Array<keyof AnatomyProfile> = [
    'height',
    'weight',
    'skinColor',
    'hairLength',
    'hairStyle',
    'hairColor',
    'eyeShape',
    'eyeColor',
    'musculature',
    'bodyShape',
    'facialScars',
    'bodyScars',
    'faceDetail',
    'chestTorsoDetail',
    'armsHandsDetail',
    'legsStanceDetail',
    'distinguishingMark',
  ];
  for (const field of requiredFields) {
    const val = anatomy[field];
    if (typeof val !== 'string' || val.trim().length === 0) {
      errors.push(`Missing anatomy.${field} in ${context}`);
    } else {
      checkNoBracketsOrParens(val, `${context}.anatomy.${field}`);
    }
  }
}

const sampleState = createNewGame({
  name: 'Validator',
  sex: 'female',
  race: 'ael_thalor',
  background: 'root_scholar',
  skipIntro: true,
  rngState: 1,
});

// 1. Validate all enemies
for (const [id, enemy] of Object.entries(ENEMIES)) {
  if (!enemy.unidentifiedName.trim()) {
    errors.push(`Enemy ${id} missing unidentifiedName`);
  }
  if (!enemy.firstSightProse.trim()) {
    errors.push(`Enemy ${id} missing firstSightProse`);
  }
  if (enemy.firstSightProse.toLowerCase().includes(enemy.name.toLowerCase())) {
    errors.push(`Enemy ${id} firstSightProse prematurely reveals proper name "${enemy.name}"`);
  }
  if (!enemy.returnSightProse.trim()) {
    errors.push(`Enemy ${id} missing returnSightProse`);
  }
  checkNoBracketsOrParens(enemy.firstSightProse, `enemy:${id}.firstSightProse`);
  checkNoBracketsOrParens(enemy.returnSightProse, `enemy:${id}.returnSightProse`);
  checkNoBracketsOrParens(enemy.unidentifiedName, `enemy:${id}.unidentifiedName`);
  checkNoLegacyCanon(enemy.name, `enemy:${id}.name`);
  checkNoLegacyCanon(enemy.unidentifiedName, `enemy:${id}.unidentifiedName`);
  checkNoLegacyCanon(enemy.firstSightProse, `enemy:${id}.firstSightProse`);
  checkNoLegacyCanon(enemy.returnSightProse, `enemy:${id}.returnSightProse`);
  checkNoLegacyCanon(enemy.description, `enemy:${id}.description`);
  checkAnatomy(enemy.anatomy, `enemy:${id}`);
  for (const intent of enemy.intents) {
    checkNoBracketsOrParens(intent.description, `enemy:${id}.intent.${intent.label}`);
    if (!DAMAGE_TYPE_META[intent.damageType]) {
      errors.push(`Enemy ${id} intent ${intent.label} has invalid damageType "${intent.damageType}"`);
    }
  }
}

// 1b. Validate Body Mods & Injuries
for (const [id, mod] of Object.entries(BODY_MODS)) {
  checkNoBracketsOrParens(mod.name, `bodymod:${id}.name`);
  checkNoBracketsOrParens(mod.description, `bodymod:${id}.description`);
  checkNoBracketsOrParens(mod.bonusSummary, `bodymod:${id}.bonusSummary`);
  checkNoBracketsOrParens(mod.drawbackSummary, `bodymod:${id}.drawbackSummary`);
  checkNoLegacyCanon(mod.name, `bodymod:${id}.name`);
  checkNoLegacyCanon(mod.description, `bodymod:${id}.description`);
  checkNoLegacyCanon(mod.bonusSummary, `bodymod:${id}.bonusSummary`);
  if (mod.grantedAbilityId && !ABILITIES[mod.grantedAbilityId]) {
    errors.push(`BodyMod ${id} grants unknown ability "${mod.grantedAbilityId}"`);
  }
}

// 1c. Validate Items, Heirlooms & Abilities
for (const [id, item] of Object.entries(ITEMS)) {
  checkNoBracketsOrParens(item.name, `item:${id}.name`);
  checkNoBracketsOrParens(item.description, `item:${id}.description`);
  checkNoLegacyCanon(item.name, `item:${id}.name`);
  checkNoLegacyCanon(item.description, `item:${id}.description`);
}
for (const [id, ab] of Object.entries(ABILITIES)) {
  checkNoBracketsOrParens(ab.name, `ability:${id}.name`);
  checkNoBracketsOrParens(ab.description, `ability:${id}.description`);
  checkNoLegacyCanon(ab.name, `ability:${id}.name`);
  checkNoLegacyCanon(ab.description, `ability:${id}.description`);
}

for (const [id, inj] of Object.entries(INJURIES)) {
  checkNoBracketsOrParens(inj.name, `injury:${id}.name`);
  checkNoBracketsOrParens(inj.description, `injury:${id}.description`);
}

// 2. Validate all locations & NPCs
const allNpcIds = new Set<string>();
for (const [id, loc] of Object.entries(LOCATIONS)) {
  const firstSight = loc.firstSightProse(sampleState);
  if (!firstSight.trim()) errors.push(`Location ${id} missing firstSightProse`);
  if (!loc.sensorySummary.trim()) errors.push(`Location ${id} missing sensorySummary`);
  checkNoBracketsOrParens(firstSight, `place:${id}.firstSightProse`);
  checkNoBracketsOrParens(loc.sensorySummary, `place:${id}.sensorySummary`);
  for (const act of loc.actions) {
    checkNoBracketsOrParens(act.label, `place:${id}.action.${act.id}`);
    if (act.label.split(/\s+/).length > 2) {
      errors.push(`Location ${id} action "${act.label}" exceeds 2 words`);
    }
  }
  for (const npc of loc.npcs ?? []) {
    allNpcIds.add(npc.id);
    if (!npc.unidentifiedLabel.trim()) errors.push(`NPC ${npc.id} missing unidentifiedLabel`);
    checkNoBracketsOrParens(npc.unidentifiedLabel, `npc:${npc.id}.unidentifiedLabel`);
    checkNoLegacyCanon(npc.name, `npc:${npc.id}.name`);
    checkNoLegacyCanon(npc.unidentifiedLabel, `npc:${npc.id}.unidentifiedLabel`);
    const npcFirst = npc.firstSightProse(sampleState);
    if (!npcFirst.trim()) errors.push(`NPC ${npc.id} missing firstSightProse`);
    checkNoBracketsOrParens(npcFirst, `npc:${npc.id}.firstSightProse`);
    checkNoLegacyCanon(npcFirst, `npc:${npc.id}.firstSightProse`);
    checkAnatomy(npc.anatomy, `npc:${npc.id}`);
    for (const topic of npc.topics) {
      checkNoBracketsOrParens(topic.label, `npc:${npc.id}.topic.${topic.id}`);
      if (topic.label.split(/\s+/).length > 2) {
        errors.push(`NPC ${npc.id} topic "${topic.label}" exceeds 2 words`);
      }
    }
  }
}

// 3. Validate all events
for (const ev of EVENTS) {
  checkNoBracketsOrParens(ev.title, `event:${ev.id}.title`);
  checkNoBracketsOrParens(ev.prompt(sampleState), `event:${ev.id}.prompt`);
  checkNoLegacyCanon(ev.title, `event:${ev.id}.title`);
  checkNoLegacyCanon(ev.prompt(sampleState), `event:${ev.id}.prompt`);
  if (ev.promptBeats) {
    ev.promptBeats.forEach((beatFn, idx) => {
      const txt = beatFn(sampleState);
      if (!txt.trim()) errors.push(`Event ${ev.id} beat ${idx} is empty`);
      checkNoBracketsOrParens(txt, `event:${ev.id}.beat.${idx}`);
      checkNoLegacyCanon(txt, `event:${ev.id}.beat.${idx}`);
    });
  }
  for (const ch of ev.choices) {
    checkNoBracketsOrParens(ch.label, `event:${ev.id}.choice.${ch.id}`);
    if (ch.label.split(/\s+/).length > 2) {
      errors.push(`Event ${ev.id} choice "${ch.label}" exceeds 2 words`);
    }
  }
}

// 4. Validate all ENTITY_LINKS targets exist
const validFactions = new Set(['iron_vow', 'silken_cistern', 'under_warren', 'husk_choir']);
function entityExists(ref: string): boolean {
  const [kind, id] = ref.split(':');
  if (kind === 'place') return Boolean(LOCATIONS[id]);
  if (kind === 'npc') return allNpcIds.has(id);
  if (kind === 'enemy') return Boolean(ENEMIES[id]);
  if (kind === 'item') return Boolean(ITEMS[id]);
  if (kind === 'faction') return validFactions.has(id);
  return false;
}

for (const link of ENTITY_LINKS) {
  if (!entityExists(link.from)) {
    errors.push(`Broken ENTITY_LINKS.from reference: "${link.from}"`);
  }
  if (!entityExists(link.to)) {
    errors.push(`Broken ENTITY_LINKS.to reference: "${link.to}"`);
  }
  checkNoBracketsOrParens(link.note, `link:${link.from}->${link.to}`);
}

// 5. Validate SQLite database integrity & foreign keys
const db = getWorldDatabase();
const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
if (fkViolations.length > 0) {
  errors.push(`SQLite foreign_key_check returned ${fkViolations.length} violations: ${JSON.stringify(fkViolations)}`);
}
const requiredTables = [
  'races',
  'backgrounds',
  'southern_pasts',
  'abilities',
  'perks',
  'items',
  'recipes',
  'body_mods',
  'injuries',
  'enemies',
  'enemy_intents',
  'enemy_loot',
  'places',
  'place_connections',
  'place_actions',
  'npcs',
  'npc_topics',
  'events',
  'event_choices',
  'entity_links',
  'npc_reactions',
  'sub_areas',
  'explore_encounters',
  'dungeons',
  'dungeon_rooms',
  'dungeon_exits',
];
for (const table of requiredTables) {
  const row = db.prepare(`SELECT COUNT(*) AS cnt FROM ${table}`).get() as { cnt: number };
  if (!row || row.cnt <= 0) {
    errors.push(`SQLite table "${table}" is empty`);
  }
}

if (errors.length > 0) {
  console.error(`LORE VALIDATION FAILED (${errors.length} issues):`);
  for (const e of errors) {
    console.error(`  - ${e}`);
  }
  process.exit(1);
}

console.log(
  `LORE VALIDATION PASSED: ${Object.keys(ENEMIES).length} enemies, ${Object.keys(LOCATIONS).length} places, ${allNpcIds.size} NPCs, ${EVENTS.length} events, ${Object.keys(BODY_MODS).length} body mods, ${Object.keys(INJURIES).length} injuries, ${ENTITY_LINKS.length} verified entity links.`,
);
