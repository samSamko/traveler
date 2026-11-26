import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AbilityName, ArmorDef, ArmorTier, ClassId, WeaponDef } from '../types.ts';
import { WORLD_DB_SCHEMA } from './schema.ts';

export interface TraitProfileRecord {
  category: 'terrible' | 'broken_body' | 'bad_habit' | 'troubling_tale';
  roll: number;
  tags: string[];
  proseVariants: string[];
  reactionMod: number;
  drMod: { context: string; delta: number } | null;
  unlockedChoice: { contextTag: string; label: string; effectKey: string } | null;
  pursuer: { creatureId: string; intro: string } | null;
}

export interface CampaignPatronRecord {
  id: string;
  name: string;
  hookIntro: string;
}

export interface CampaignObjectiveRecord {
  id: string;
  kind: 'rescue_heir' | 'slay_boss' | 'steal_relic' | 'sabotage';
  title: string;
  targetName: string;
  brief: string;
  refusesLeave: boolean;
}

export interface CentralHazardRecord {
  id: string;
  name: string;
  description: string;
  testAbility: AbilityName;
  testDr: number;
  failDamageDie: string;
  apexCreatureId: string;
  sensoryHint: string;
}

export interface RivalFactionRecord {
  id: string;
  name: string;
  leaderName: string;
  appearance: string;
  agenda: string;
  brewName: string;
  zealotCreatureId: string;
}

export interface PuzzleStatueRecord {
  id: string;
  name: string;
  description: string;
  socketItemName: string;
  unlockText: string;
}

export interface TableAEncounterRecord {
  seq: number;
  creatureId: string;
  countFormula: string;
  intro: string;
}

export interface TableBAnomalyRecord {
  id: string;
  name: string;
  description: string;
}

export interface ClassRecord {
  id: Exclude<ClassId, 'classless'>;
  name: string;
  description: string;
  silverFormula: string;
  omenDie: number;
  hpDie: number;
  abilityRolls: {
    agility: string;
    presence: string;
    strength: string;
    toughness: string;
  };
  weaponDie: number;
  armorDie: number;
  canRerollHeavyArmor: boolean;
  canUseScrolls: boolean;
  canCastInMediumArmor: boolean;
  normalAgilityDr: number;
  stealthDrMod: number;
  specialAttack: string;
  originsTitle: string;
  originsDie: number;
  featuresCount: number;
  origins: Array<{ rollMin: number; rollMax: number; text: string }>;
  features: Array<{ roll: number; name: string; description: string }>;
}

export interface ScrollRecord {
  kind: 'unclean' | 'sacred';
  roll: number;
  name: string;
  effect: string;
}

export interface CreatureRecord {
  id: string;
  name: string;
  hp: number;
  morale: number | null;
  armorName: string;
  armorDie: string | null;
  attackName: string;
  damageDie: string;
  attackDr: number;
  defenceDr: number;
  attacksPerRound: number;
  special: string;
  bounty: string;
}

export interface OutcastRecord {
  id: string;
  name: string;
  description: string;
  hp: number;
  morale: number;
  armorName: string;
  weaponName: string;
  traits: string[];
  specialties: string[];
  values: string[];
}

export interface WorldDatabase {
  db: DatabaseSync;
  names: Array<{ d6: number; d8: number; name: string }>;
  classes: ClassRecord[];
  classesById: Record<string, ClassRecord>;
  herbmasterDecoctions: Array<{ roll: number; name: string; effect: string }>;
  startingContainers: Array<{ rollMin: number; rollMax: number; id: string; name: string; capacityBonus: number }>;
  startingGearA: Array<{ roll: number; name: string; kind: string }>;
  startingGearB: Array<{ roll: number; name: string; kind: string }>;
  weapons: WeaponDef[];
  weaponsById: Record<string, WeaponDef>;
  armors: ArmorDef[];
  armorsByTier: Record<number, ArmorDef>;
  shopItems: Array<{ name: string; silver: number; notes: string }>;
  services: Array<{ name: string; silver: string }>;
  beasts: Array<{ name: string; silver: number }>;
  occultTreasures: Array<{ roll: number; name: string; effect: string }>;
  corpsePlundering: Array<{ code: string; text: string; silver: number; damage: string | null }>;
  uncleanScrolls: ScrollRecord[];
  sacredScrolls: ScrollRecord[];
  arcaneCatastrophes: Array<{ roll: number; text: string }>;
  terribleTraits: Array<{ roll: number; text: string }>;
  brokenBodies: Array<{ roll: number; text: string }>;
  badHabits: Array<{ roll: number; text: string }>;
  troublingTales: Array<{ roll: number; text: string }>;
  creatures: CreatureRecord[];
  creaturesById: Record<string, CreatureRecord>;
  outcasts: OutcastRecord[];
  outcastsById: Record<string, OutcastRecord>;
  regions: Array<{ id: string; name: string; summary: string }>;
  regionsById: Record<string, { id: string; name: string; summary: string }>;
  calendarPsalms: Array<{ code: string; text: string; isFinal: boolean }>;
  weather: Array<{ roll: number; text: string }>;
  whereDoYouWander: Array<{ roll: number; regionId: string; text: string }>;
  whoContactsYou: Array<{ roll: number; text: string }>;
  adventureSparks: Array<{ rollMin: number; rollMax: number; text: string }>;
  basilisksDemand: Array<{ roll: number; text: string }>;
  dungeonTables: {
    nameFirst: string[];
    nameSecond: string[];
    inactiveReasons: string[];
    imminentDangers: string[];
    dwellers: string[];
    distinctiveFeatures: string[];
    sampleRooms: string[];
    trapsAndDevilry: string[];
  };
  traitProfiles: TraitProfileRecord[];
  campaigns: {
    patrons: CampaignPatronRecord[];
    objectives: CampaignObjectiveRecord[];
    centralHazards: CentralHazardRecord[];
    rivalFactions: RivalFactionRecord[];
    puzzleStatues: PuzzleStatueRecord[];
    bosses: Array<{ id: string; keyName: string }>;
    tableAEncounters: TableAEncounterRecord[];
    tableBAnomalies: TableBAnomalyRecord[];
  };
  proseFragments: {
    seerIntros: string[];
    overlandOpenings: string[];
    weatherMoods: string[];
    sensorySmells: string[];
    sensorySounds: string[];
    lightingDetails: string[];
    roomAtmospheres: string[];
    combatAftermaths: string[];
  };
}

let cachedDb: WorldDatabase | null = null;

function readJson<T>(dataDir: string, filename: string): T {
  const fullPath = join(dataDir, filename);
  return JSON.parse(readFileSync(fullPath, 'utf8')) as T;
}

export function loadWorldDatabase(dataDir = join(process.cwd(), 'data')): WorldDatabase {
  if (cachedDb && dataDir === join(process.cwd(), 'data')) {
    return cachedDb;
  }

  const db = new DatabaseSync(':memory:');
  db.exec(WORLD_DB_SCHEMA);

  const namesJson = readJson<{ names: Array<{ d6: number; d8: number; name: string }> }>(dataDir, 'names.json');
  const classesJson = readJson<{
    classes: ClassRecord[];
    herbmasterDecoctions: Array<{ roll: number; name: string; effect: string }>;
  }>(dataDir, 'classes.json');
  const equipJson = readJson<{
    startingContainers: Array<{ rollMin: number; rollMax: number; id: string; name: string; capacityBonus: number }>;
    startingGearA: Array<{ roll: number; name: string; kind: string }>;
    startingGearB: Array<{ roll: number; name: string; kind: string }>;
    weapons: WeaponDef[];
    armors: ArmorDef[];
    shopItems: Array<{ name: string; silver: number; notes: string }>;
    services: Array<{ name: string; silver: string }>;
    beasts: Array<{ name: string; silver: number }>;
    occultTreasures: Array<{ roll: number; name: string; effect: string }>;
    corpsePlundering: Array<{ code: string; text: string; silver: number; damage: string | null }>;
  }>(dataDir, 'equipment.json');
  const powersJson = readJson<{
    uncleanScrolls: Array<{ roll: number; name: string; effect: string }>;
    sacredScrolls: Array<{ roll: number; name: string; effect: string }>;
    arcaneCatastrophes: Array<{ roll: number; text: string }>;
  }>(dataDir, 'powers.json');
  const traitsJson = readJson<{
    terribleTraits: Array<{ roll: number; text: string }>;
    brokenBodies: Array<{ roll: number; text: string }>;
    badHabits: Array<{ roll: number; text: string }>;
    troublingTales: Array<{ roll: number; text: string }>;
  }>(dataDir, 'traits.json');
  const creaturesJson = readJson<{ creatures: CreatureRecord[] }>(dataDir, 'creatures.json');
  const outcastsJson = readJson<{ outcasts: OutcastRecord[] }>(dataDir, 'outcasts.json');
  const worldJson = readJson<{
    regions: Array<{ id: string; name: string; summary: string }>;
    calendarPsalms: Array<{ code: string; text: string; isFinal: boolean }>;
    weather: Array<{ roll: number; text: string }>;
    whereDoYouWander: Array<{ roll: number; regionId: string; text: string }>;
    whoContactsYou: Array<{ roll: number; text: string }>;
    adventureSparks: Array<{ rollMin: number; rollMax: number; text: string }>;
    basilisksDemand: Array<{ roll: number; text: string }>;
  }>(dataDir, 'world.json');
  const dungeonsJson = readJson<{
    nameFirst: string[];
    nameSecond: string[];
    inactiveReasons: string[];
    imminentDangers: string[];
    dwellers: string[];
    distinctiveFeatures: string[];
    sampleRooms: string[];
    trapsAndDevilry: string[];
  }>(dataDir, 'dungeons.json');
  const traitProfilesJson = readJson<{ profiles: TraitProfileRecord[] }>(dataDir, 'trait_profiles.json');
  const campaignsJson = readJson<{
    patrons: CampaignPatronRecord[];
    objectives: CampaignObjectiveRecord[];
    centralHazards: CentralHazardRecord[];
    rivalFactions: RivalFactionRecord[];
    puzzleStatues: PuzzleStatueRecord[];
    bosses: Array<{ id: string; keyName: string }>;
    tableAEncounters: Array<{ creatureId: string; countFormula: string; intro: string }>;
    tableBAnomalies: TableBAnomalyRecord[];
  }>(dataDir, 'campaigns.json');
  const proseJson = readJson<Record<string, string[]>>(dataDir, 'prose_fragments.json');

  const insName = db.prepare('INSERT INTO names (d6, d8, name) VALUES (?, ?, ?)');
  for (const row of namesJson.names) insName.run(row.d6, row.d8, row.name);

  const insClass = db.prepare(`
    INSERT INTO classes (
      id, name, description, silver_formula, omen_die, hp_die,
      agility_roll, presence_roll, strength_roll, toughness_roll,
      weapon_die, armor_die, can_reroll_heavy_armor, can_use_scrolls,
      can_cast_in_medium_armor, normal_agility_dr, stealth_dr_mod,
      special_attack, origins_title, origins_die, features_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insOrigin = db.prepare('INSERT INTO class_origins (class_id, roll_min, roll_max, text) VALUES (?, ?, ?, ?)');
  const insFeature = db.prepare('INSERT INTO class_features (class_id, roll, name, description) VALUES (?, ?, ?, ?)');

  for (const c of classesJson.classes) {
    insClass.run(
      c.id,
      c.name,
      c.description,
      c.silverFormula,
      c.omenDie,
      c.hpDie,
      c.abilityRolls.agility,
      c.abilityRolls.presence,
      c.abilityRolls.strength,
      c.abilityRolls.toughness,
      c.weaponDie,
      c.armorDie,
      c.canRerollHeavyArmor ? 1 : 0,
      c.canUseScrolls ? 1 : 0,
      c.canCastInMediumArmor ? 1 : 0,
      c.normalAgilityDr,
      c.stealthDrMod,
      c.specialAttack,
      c.originsTitle,
      c.originsDie,
      c.featuresCount,
    );
    for (const o of c.origins) insOrigin.run(c.id, o.rollMin, o.rollMax, o.text);
    for (const f of c.features) insFeature.run(c.id, f.roll, f.name, f.description);
  }

  const insDecoct = db.prepare('INSERT INTO herbmaster_decoctions (roll, name, effect) VALUES (?, ?, ?)');
  for (const d of classesJson.herbmasterDecoctions) insDecoct.run(d.roll, d.name, d.effect);

  const insContainer = db.prepare('INSERT INTO starting_containers (roll_min, roll_max, id, name, capacity_bonus) VALUES (?, ?, ?, ?, ?)');
  for (const c of equipJson.startingContainers) insContainer.run(c.rollMin, c.rollMax, c.id, c.name, c.capacityBonus);

  const insGear = db.prepare('INSERT INTO starting_gear (table_slot, roll, name, kind) VALUES (?, ?, ?, ?)');
  for (const g of equipJson.startingGearA) insGear.run('A', g.roll, g.name, g.kind);
  for (const g of equipJson.startingGearB) insGear.run('B', g.roll, g.name, g.kind);

  const insWeapon = db.prepare('INSERT INTO weapons (id, table_roll, name, damage_die, ranged, two_handed, silver) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const w of equipJson.weapons) insWeapon.run(w.id, w.tableRoll, w.name, w.damageDie, w.ranged ? 1 : 0, w.twoHanded ? 1 : 0, w.silver);

  const insArmor = db.prepare('INSERT INTO armors (tier, table_roll, name, reduction_die, agility_dr_penalty, defence_dr_penalty, silver) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const a of equipJson.armors) insArmor.run(a.tier, a.tableRoll, a.name, a.reductionDie, a.agilityDrPenalty, a.defenceDrPenalty, a.silver);

  const insShop = db.prepare('INSERT INTO shop_items (name, silver, notes) VALUES (?, ?, ?)');
  for (const s of equipJson.shopItems) insShop.run(s.name, s.silver, s.notes);

  const insService = db.prepare('INSERT INTO services (name, silver) VALUES (?, ?)');
  for (const s of equipJson.services) insService.run(s.name, s.silver);

  const insBeast = db.prepare('INSERT INTO beasts (name, silver) VALUES (?, ?)');
  for (const b of equipJson.beasts) insBeast.run(b.name, b.silver);

  const insTreasure = db.prepare('INSERT INTO occult_treasures (roll, name, effect) VALUES (?, ?, ?)');
  for (const t of equipJson.occultTreasures) insTreasure.run(t.roll, t.name, t.effect);

  const insPlunder = db.prepare('INSERT INTO corpse_plundering (code, text, silver, damage) VALUES (?, ?, ?, ?)');
  for (const p of equipJson.corpsePlundering) insPlunder.run(p.code, p.text, p.silver, p.damage);

  const insScroll = db.prepare('INSERT INTO scrolls (kind, roll, name, effect) VALUES (?, ?, ?, ?)');
  for (const s of powersJson.uncleanScrolls) insScroll.run('unclean', s.roll, s.name, s.effect);
  for (const s of powersJson.sacredScrolls) insScroll.run('sacred', s.roll, s.name, s.effect);

  const insCat = db.prepare('INSERT INTO arcane_catastrophes (roll, text) VALUES (?, ?)');
  for (const c of powersJson.arcaneCatastrophes) insCat.run(c.roll, c.text);

  const insTrait = db.prepare('INSERT INTO traits (category, roll, text) VALUES (?, ?, ?)');
  for (const t of traitsJson.terribleTraits) insTrait.run('terrible', t.roll, t.text);
  for (const t of traitsJson.brokenBodies) insTrait.run('broken_body', t.roll, t.text);
  for (const t of traitsJson.badHabits) insTrait.run('bad_habit', t.roll, t.text);
  for (const t of traitsJson.troublingTales) insTrait.run('troubling_tale', t.roll, t.text);

  const insCreature = db.prepare(`
    INSERT INTO creatures (
      id, name, hp, morale, armor_name, armor_die, attack_name, damage_die,
      attack_dr, defence_dr, attacks_per_round, special, bounty
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const c of creaturesJson.creatures) {
    insCreature.run(
      c.id,
      c.name,
      c.hp,
      c.morale,
      c.armorName,
      c.armorDie,
      c.attackName,
      c.damageDie,
      c.attackDr,
      c.defenceDr,
      c.attacksPerRound,
      c.special,
      c.bounty,
    );
  }

  const insOutcast = db.prepare(`
    INSERT INTO outcasts (id, name, description, hp, morale, armor_name, weapon_name, traits_json, specialties_json, values_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const o of outcastsJson.outcasts) {
    insOutcast.run(
      o.id,
      o.name,
      o.description,
      o.hp,
      o.morale,
      o.armorName,
      o.weaponName,
      JSON.stringify(o.traits),
      JSON.stringify(o.specialties),
      JSON.stringify(o.values),
    );
  }

  const insRegion = db.prepare('INSERT INTO regions (id, name, summary) VALUES (?, ?, ?)');
  for (const r of worldJson.regions) insRegion.run(r.id, r.name, r.summary);

  const insPsalm = db.prepare('INSERT INTO calendar_psalms (code, text, is_final) VALUES (?, ?, ?)');
  for (const p of worldJson.calendarPsalms) insPsalm.run(p.code, p.text, p.isFinal ? 1 : 0);

  const insWeather = db.prepare('INSERT INTO weather (roll, text) VALUES (?, ?)');
  for (const w of worldJson.weather) insWeather.run(w.roll, w.text);

  const insWhere = db.prepare('INSERT INTO where_wander (roll, region_id, text) VALUES (?, ?, ?)');
  for (const w of worldJson.whereDoYouWander) insWhere.run(w.roll, w.regionId, w.text);

  const insWho = db.prepare('INSERT INTO who_contacts (roll, text) VALUES (?, ?)');
  for (const w of worldJson.whoContactsYou) insWho.run(w.roll, w.text);

  const insSpark = db.prepare('INSERT INTO adventure_sparks (roll_min, roll_max, text) VALUES (?, ?, ?)');
  for (const s of worldJson.adventureSparks) insSpark.run(s.rollMin, s.rollMax, s.text);

  const insDemand = db.prepare('INSERT INTO basilisks_demand (roll, text) VALUES (?, ?)');
  for (const d of worldJson.basilisksDemand) insDemand.run(d.roll, d.text);

  const insDungeon = db.prepare('INSERT INTO dungeon_tables (category, seq, text) VALUES (?, ?, ?)');
  const dungeonEntries: Array<[string, string[]]> = [
    ['name_first', dungeonsJson.nameFirst],
    ['name_second', dungeonsJson.nameSecond],
    ['inactive_reasons', dungeonsJson.inactiveReasons],
    ['imminent_dangers', dungeonsJson.imminentDangers],
    ['dwellers', dungeonsJson.dwellers],
    ['distinctive_features', dungeonsJson.distinctiveFeatures],
    ['sample_rooms', dungeonsJson.sampleRooms],
    ['traps_and_devilry', dungeonsJson.trapsAndDevilry],
  ];
  for (const [cat, list] of dungeonEntries) {
    list.forEach((text, idx) => insDungeon.run(cat, idx + 1, text));
  }

  const insTraitProfile = db.prepare(`
    INSERT INTO trait_profiles (
      category, roll, tags_json, prose_variants_json, reaction_mod, dr_mod_json, unlocked_choice_json, pursuer_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const tp of traitProfilesJson.profiles) {
    insTraitProfile.run(
      tp.category,
      tp.roll,
      JSON.stringify(tp.tags),
      JSON.stringify(tp.proseVariants),
      tp.reactionMod,
      tp.drMod ? JSON.stringify(tp.drMod) : null,
      tp.unlockedChoice ? JSON.stringify(tp.unlockedChoice) : null,
      tp.pursuer ? JSON.stringify(tp.pursuer) : null,
    );
  }

  const insPatron = db.prepare('INSERT INTO campaign_patrons (id, name, hook_intro) VALUES (?, ?, ?)');
  for (const p of campaignsJson.patrons) insPatron.run(p.id, p.name, p.hookIntro);

  const insObj = db.prepare('INSERT INTO campaign_objectives (id, kind, title, target_name, brief, refuses_leave) VALUES (?, ?, ?, ?, ?, ?)');
  for (const o of campaignsJson.objectives) insObj.run(o.id, o.kind, o.title, o.targetName, o.brief, o.refusesLeave ? 1 : 0);

  const insHazard = db.prepare(`
    INSERT INTO central_hazards (id, name, description, test_ability, test_dr, fail_damage_die, apex_creature_id, sensory_hint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const h of campaignsJson.centralHazards) {
    insHazard.run(h.id, h.name, h.description, h.testAbility, h.testDr, h.failDamageDie, h.apexCreatureId, h.sensoryHint);
  }

  const insRival = db.prepare(`
    INSERT INTO rival_factions (id, name, leader_name, appearance, agenda, brew_name, zealot_creature_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of campaignsJson.rivalFactions) {
    insRival.run(r.id, r.name, r.leaderName, r.appearance, r.agenda, r.brewName, r.zealotCreatureId);
  }

  const insStatue = db.prepare('INSERT INTO puzzle_statues (id, name, description, socket_item_name, unlock_text) VALUES (?, ?, ?, ?, ?)');
  for (const s of campaignsJson.puzzleStatues) insStatue.run(s.id, s.name, s.description, s.socketItemName, s.unlockText);

  const insBoss = db.prepare('INSERT INTO campaign_bosses (creature_id, key_name) VALUES (?, ?)');
  for (const b of campaignsJson.bosses) insBoss.run(b.id, b.keyName);

  const insTableA = db.prepare('INSERT INTO table_a_encounters (seq, creature_id, count_formula, intro) VALUES (?, ?, ?, ?)');
  campaignsJson.tableAEncounters.forEach((e, idx) => insTableA.run(idx + 1, e.creatureId, e.countFormula, e.intro));

  const insTableB = db.prepare('INSERT INTO table_b_anomalies (id, name, description) VALUES (?, ?, ?)');
  for (const b of campaignsJson.tableBAnomalies) insTableB.run(b.id, b.name, b.description);

  const insProse = db.prepare('INSERT INTO prose_fragments (category, seq, text) VALUES (?, ?, ?)');
  for (const [cat, arr] of Object.entries(proseJson)) {
    arr.forEach((txt, idx) => insProse.run(cat, idx + 1, txt));
  }

  // Query back from SQLite to guarantee relational reads match source data
  const names = db.prepare('SELECT d6, d8, name FROM names ORDER BY d6, d8').all() as Array<{ d6: number; d8: number; name: string }>;
  const rawClasses = db.prepare('SELECT * FROM classes').all() as Array<Record<string, unknown>>;
  const classes: ClassRecord[] = rawClasses.map((row) => {
    const id = String(row.id) as Exclude<ClassId, 'classless'>;
    const origins = (db.prepare('SELECT roll_min, roll_max, text FROM class_origins WHERE class_id = ? ORDER BY roll_min').all(id) as Array<Record<string, unknown>>)
      .map((o) => ({ rollMin: Number(o.roll_min), rollMax: Number(o.roll_max), text: String(o.text) }));
    const features = (db.prepare('SELECT roll, name, description FROM class_features WHERE class_id = ? ORDER BY roll').all(id) as Array<Record<string, unknown>>)
      .map((f) => ({ roll: Number(f.roll), name: String(f.name), description: String(f.description) }));
    return {
      id,
      name: String(row.name),
      description: String(row.description),
      silverFormula: String(row.silver_formula),
      omenDie: Number(row.omen_die),
      hpDie: Number(row.hp_die),
      abilityRolls: {
        agility: String(row.agility_roll),
        presence: String(row.presence_roll),
        strength: String(row.strength_roll),
        toughness: String(row.toughness_roll),
      },
      weaponDie: Number(row.weapon_die),
      armorDie: Number(row.armor_die),
      canRerollHeavyArmor: Boolean(row.can_reroll_heavy_armor),
      canUseScrolls: Boolean(row.can_use_scrolls),
      canCastInMediumArmor: Boolean(row.can_cast_in_medium_armor),
      normalAgilityDr: Number(row.normal_agility_dr),
      stealthDrMod: Number(row.stealth_dr_mod),
      specialAttack: String(row.special_attack),
      originsTitle: String(row.origins_title),
      originsDie: Number(row.origins_die),
      featuresCount: Number(row.features_count),
      origins,
      features,
    };
  });

  const classesById: Record<string, ClassRecord> = {};
  for (const c of classes) classesById[c.id] = c;

  const weapons = (db.prepare('SELECT * FROM weapons').all() as Array<Record<string, unknown>>).map((w) => ({
    id: String(w.id),
    tableRoll: w.table_roll === null ? null : Number(w.table_roll),
    name: String(w.name),
    damageDie: String(w.damage_die),
    ranged: Boolean(w.ranged),
    twoHanded: Boolean(w.two_handed),
    silver: Number(w.silver),
  }));
  const weaponsById: Record<string, WeaponDef> = {};
  for (const w of weapons) weaponsById[w.id] = w;

  const armors = (db.prepare('SELECT * FROM armors ORDER BY tier').all() as Array<Record<string, unknown>>).map((a) => ({
    tier: Number(a.tier) as ArmorTier,
    tableRoll: Number(a.table_roll),
    name: String(a.name),
    reductionDie: a.reduction_die === null ? null : String(a.reduction_die),
    agilityDrPenalty: Number(a.agility_dr_penalty),
    defenceDrPenalty: Number(a.defence_dr_penalty),
    silver: Number(a.silver),
  }));
  const armorsByTier: Record<number, ArmorDef> = {};
  for (const a of armors) armorsByTier[a.tier] = a;

  const uncleanScrolls = (db.prepare("SELECT kind, roll, name, effect FROM scrolls WHERE kind = 'unclean' ORDER BY roll").all() as unknown) as ScrollRecord[];
  const sacredScrolls = (db.prepare("SELECT kind, roll, name, effect FROM scrolls WHERE kind = 'sacred' ORDER BY roll").all() as unknown) as ScrollRecord[];

  const creatures = (db.prepare('SELECT * FROM creatures').all() as Array<Record<string, unknown>>).map((c) => ({
    id: String(c.id),
    name: String(c.name),
    hp: Number(c.hp),
    morale: c.morale === null ? null : Number(c.morale),
    armorName: String(c.armor_name),
    armorDie: c.armor_die === null ? null : String(c.armor_die),
    attackName: String(c.attack_name),
    damageDie: String(c.damage_die),
    attackDr: Number(c.attack_dr),
    defenceDr: Number(c.defence_dr),
    attacksPerRound: Number(c.attacks_per_round),
    special: String(c.special),
    bounty: String(c.bounty),
  }));
  const creaturesById: Record<string, CreatureRecord> = {};
  for (const c of creatures) creaturesById[c.id] = c;

  const outcasts = (db.prepare('SELECT * FROM outcasts').all() as Array<Record<string, unknown>>).map((o) => ({
    id: String(o.id),
    name: String(o.name),
    description: String(o.description),
    hp: Number(o.hp),
    morale: Number(o.morale),
    armorName: String(o.armor_name),
    weaponName: String(o.weapon_name),
    traits: JSON.parse(String(o.traits_json)) as string[],
    specialties: JSON.parse(String(o.specialties_json)) as string[],
    values: JSON.parse(String(o.values_json)) as string[],
  }));
  const outcastsById: Record<string, OutcastRecord> = {};
  for (const o of outcasts) outcastsById[o.id] = o;

  const regions = db.prepare('SELECT id, name, summary FROM regions').all() as Array<{ id: string; name: string; summary: string }>;
  const regionsById: Record<string, { id: string; name: string; summary: string }> = {};
  for (const r of regions) regionsById[r.id] = r;

  const calendarPsalms = (db.prepare('SELECT code, text, is_final FROM calendar_psalms').all() as Array<Record<string, unknown>>).map((p) => ({
    code: String(p.code),
    text: String(p.text),
    isFinal: Boolean(p.is_final),
  }));

  const whereDoYouWander = (db.prepare('SELECT roll, region_id, text FROM where_wander ORDER BY roll').all() as Array<Record<string, unknown>>).map((w) => ({
    roll: Number(w.roll),
    regionId: String(w.region_id),
    text: String(w.text),
  }));

  const adventureSparks = (db.prepare('SELECT roll_min, roll_max, text FROM adventure_sparks ORDER BY roll_min').all() as Array<Record<string, unknown>>).map((s) => ({
    rollMin: Number(s.roll_min),
    rollMax: Number(s.roll_max),
    text: String(s.text),
  }));

  const getDungeonCat = (cat: string): string[] =>
    (db.prepare('SELECT text FROM dungeon_tables WHERE category = ? ORDER BY seq').all(cat) as Array<{ text: string }>).map((r) => r.text);

  const getProseCat = (cat: string): string[] =>
    (db.prepare('SELECT text FROM prose_fragments WHERE category = ? ORDER BY seq').all(cat) as Array<{ text: string }>).map((r) => r.text);

  const traitProfiles: TraitProfileRecord[] = (
    db.prepare('SELECT * FROM trait_profiles ORDER BY category, roll').all() as Array<Record<string, unknown>>
  ).map((r) => ({
    category: String(r.category) as TraitProfileRecord['category'],
    roll: Number(r.roll),
    tags: JSON.parse(String(r.tags_json)) as string[],
    proseVariants: JSON.parse(String(r.prose_variants_json)) as string[],
    reactionMod: Number(r.reaction_mod),
    drMod: r.dr_mod_json ? (JSON.parse(String(r.dr_mod_json)) as { context: string; delta: number }) : null,
    unlockedChoice: r.unlocked_choice_json
      ? (JSON.parse(String(r.unlocked_choice_json)) as { contextTag: string; label: string; effectKey: string })
      : null,
    pursuer: r.pursuer_json ? (JSON.parse(String(r.pursuer_json)) as { creatureId: string; intro: string }) : null,
  }));

  const patrons = (db.prepare('SELECT id, name, hook_intro FROM campaign_patrons').all() as Array<Record<string, unknown>>).map((p) => ({
    id: String(p.id),
    name: String(p.name),
    hookIntro: String(p.hook_intro),
  }));
  const objectives = (db.prepare('SELECT * FROM campaign_objectives').all() as Array<Record<string, unknown>>).map((o) => ({
    id: String(o.id),
    kind: String(o.kind) as CampaignObjectiveRecord['kind'],
    title: String(o.title),
    targetName: String(o.target_name),
    brief: String(o.brief),
    refusesLeave: Boolean(o.refuses_leave),
  }));
  const centralHazards = (db.prepare('SELECT * FROM central_hazards').all() as Array<Record<string, unknown>>).map((h) => ({
    id: String(h.id),
    name: String(h.name),
    description: String(h.description),
    testAbility: String(h.test_ability) as AbilityName,
    testDr: Number(h.test_dr),
    failDamageDie: String(h.fail_damage_die),
    apexCreatureId: String(h.apex_creature_id),
    sensoryHint: String(h.sensory_hint),
  }));
  const rivalFactions = (db.prepare('SELECT * FROM rival_factions').all() as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    leaderName: String(r.leader_name),
    appearance: String(r.appearance),
    agenda: String(r.agenda),
    brewName: String(r.brew_name),
    zealotCreatureId: String(r.zealot_creature_id),
  }));
  const puzzleStatues = (db.prepare('SELECT * FROM puzzle_statues').all() as Array<Record<string, unknown>>).map((s) => ({
    id: String(s.id),
    name: String(s.name),
    description: String(s.description),
    socketItemName: String(s.socket_item_name),
    unlockText: String(s.unlock_text),
  }));
  const bosses = (db.prepare('SELECT creature_id, key_name FROM campaign_bosses').all() as Array<Record<string, unknown>>).map((b) => ({
    id: String(b.creature_id),
    keyName: String(b.key_name),
  }));
  const tableAEncounters = (db.prepare('SELECT * FROM table_a_encounters ORDER BY seq').all() as Array<Record<string, unknown>>).map((e) => ({
    seq: Number(e.seq),
    creatureId: String(e.creature_id),
    countFormula: String(e.count_formula),
    intro: String(e.intro),
  }));
  const tableBAnomalies = (db.prepare('SELECT * FROM table_b_anomalies').all() as Array<Record<string, unknown>>).map((b) => ({
    id: String(b.id),
    name: String(b.name),
    description: String(b.description),
  }));

  const result: WorldDatabase = {
    db,
    names,
    classes,
    classesById,
    herbmasterDecoctions: db.prepare('SELECT roll, name, effect FROM herbmaster_decoctions ORDER BY roll').all() as Array<{ roll: number; name: string; effect: string }>,
    startingContainers: (db.prepare('SELECT roll_min, roll_max, id, name, capacity_bonus FROM starting_containers ORDER BY roll_min').all() as Array<Record<string, unknown>>).map((c) => ({
      rollMin: Number(c.roll_min),
      rollMax: Number(c.roll_max),
      id: String(c.id),
      name: String(c.name),
      capacityBonus: Number(c.capacity_bonus),
    })),
    startingGearA: db.prepare("SELECT roll, name, kind FROM starting_gear WHERE table_slot = 'A' ORDER BY roll").all() as Array<{ roll: number; name: string; kind: string }>,
    startingGearB: db.prepare("SELECT roll, name, kind FROM starting_gear WHERE table_slot = 'B' ORDER BY roll").all() as Array<{ roll: number; name: string; kind: string }>,
    weapons,
    weaponsById,
    armors,
    armorsByTier,
    shopItems: db.prepare('SELECT name, silver, notes FROM shop_items').all() as Array<{ name: string; silver: number; notes: string }>,
    services: db.prepare('SELECT name, silver FROM services').all() as Array<{ name: string; silver: string }>,
    beasts: db.prepare('SELECT name, silver FROM beasts').all() as Array<{ name: string; silver: number }>,
    occultTreasures: db.prepare('SELECT roll, name, effect FROM occult_treasures ORDER BY roll').all() as Array<{ roll: number; name: string; effect: string }>,
    corpsePlundering: db.prepare('SELECT code, text, silver, damage FROM corpse_plundering ORDER BY code').all() as Array<{ code: string; text: string; silver: number; damage: string | null }>,
    uncleanScrolls,
    sacredScrolls,
    arcaneCatastrophes: db.prepare('SELECT roll, text FROM arcane_catastrophes ORDER BY roll').all() as Array<{ roll: number; text: string }>,
    terribleTraits: db.prepare("SELECT roll, text FROM traits WHERE category = 'terrible' ORDER BY roll").all() as Array<{ roll: number; text: string }>,
    brokenBodies: db.prepare("SELECT roll, text FROM traits WHERE category = 'broken_body' ORDER BY roll").all() as Array<{ roll: number; text: string }>,
    badHabits: db.prepare("SELECT roll, text FROM traits WHERE category = 'bad_habit' ORDER BY roll").all() as Array<{ roll: number; text: string }>,
    troublingTales: db.prepare("SELECT roll, text FROM traits WHERE category = 'troubling_tale' ORDER BY roll").all() as Array<{ roll: number; text: string }>,
    creatures,
    creaturesById,
    outcasts,
    outcastsById,
    regions,
    regionsById,
    calendarPsalms,
    weather: db.prepare('SELECT roll, text FROM weather ORDER BY roll').all() as Array<{ roll: number; text: string }>,
    whereDoYouWander,
    whoContactsYou: db.prepare('SELECT roll, text FROM who_contacts ORDER BY roll').all() as Array<{ roll: number; text: string }>,
    adventureSparks,
    basilisksDemand: db.prepare('SELECT roll, text FROM basilisks_demand ORDER BY roll').all() as Array<{ roll: number; text: string }>,
    dungeonTables: {
      nameFirst: getDungeonCat('name_first'),
      nameSecond: getDungeonCat('name_second'),
      inactiveReasons: getDungeonCat('inactive_reasons'),
      imminentDangers: getDungeonCat('imminent_dangers'),
      dwellers: getDungeonCat('dwellers'),
      distinctiveFeatures: getDungeonCat('distinctive_features'),
      sampleRooms: getDungeonCat('sample_rooms'),
      trapsAndDevilry: getDungeonCat('traps_and_devilry'),
    },
    traitProfiles,
    campaigns: {
      patrons,
      objectives,
      centralHazards,
      rivalFactions,
      puzzleStatues,
      bosses,
      tableAEncounters,
      tableBAnomalies,
    },
    proseFragments: {
      seerIntros: getProseCat('seerIntros'),
      overlandOpenings: getProseCat('overlandOpenings'),
      weatherMoods: getProseCat('weatherMoods'),
      sensorySmells: getProseCat('sensorySmells'),
      sensorySounds: getProseCat('sensorySounds'),
      lightingDetails: getProseCat('lightingDetails'),
      roomAtmospheres: getProseCat('roomAtmospheres'),
      combatAftermaths: getProseCat('combatAftermaths'),
    },
  };

  if (dataDir === join(process.cwd(), 'data')) {
    cachedDb = result;
  }
  return result;
}
