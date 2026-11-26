export const WORLD_DB_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE names (
  d6 INTEGER NOT NULL,
  d8 INTEGER NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (d6, d8)
);

CREATE TABLE classes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  silver_formula TEXT NOT NULL,
  omen_die INTEGER NOT NULL,
  hp_die INTEGER NOT NULL,
  agility_roll TEXT NOT NULL,
  presence_roll TEXT NOT NULL,
  strength_roll TEXT NOT NULL,
  toughness_roll TEXT NOT NULL,
  weapon_die INTEGER NOT NULL,
  armor_die INTEGER NOT NULL,
  can_reroll_heavy_armor INTEGER NOT NULL,
  can_use_scrolls INTEGER NOT NULL,
  can_cast_in_medium_armor INTEGER NOT NULL,
  normal_agility_dr INTEGER NOT NULL,
  stealth_dr_mod INTEGER NOT NULL,
  special_attack TEXT NOT NULL,
  origins_title TEXT NOT NULL,
  origins_die INTEGER NOT NULL,
  features_count INTEGER NOT NULL
);

CREATE TABLE class_origins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  roll_min INTEGER NOT NULL,
  roll_max INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE TABLE class_features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  roll INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE herbmaster_decoctions (
  roll INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  effect TEXT NOT NULL
);

CREATE TABLE starting_containers (
  roll_min INTEGER NOT NULL,
  roll_max INTEGER NOT NULL,
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  capacity_bonus INTEGER NOT NULL
);

CREATE TABLE starting_gear (
  table_slot TEXT NOT NULL,
  roll INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  PRIMARY KEY (table_slot, roll)
);

CREATE TABLE weapons (
  id TEXT PRIMARY KEY,
  table_roll INTEGER,
  name TEXT NOT NULL,
  damage_die TEXT NOT NULL,
  ranged INTEGER NOT NULL,
  two_handed INTEGER NOT NULL,
  silver INTEGER NOT NULL
);

CREATE TABLE armors (
  tier INTEGER PRIMARY KEY,
  table_roll INTEGER NOT NULL,
  name TEXT NOT NULL,
  reduction_die TEXT,
  agility_dr_penalty INTEGER NOT NULL,
  defence_dr_penalty INTEGER NOT NULL,
  silver INTEGER NOT NULL
);

CREATE TABLE shop_items (
  name TEXT PRIMARY KEY,
  silver INTEGER NOT NULL,
  notes TEXT NOT NULL
);

CREATE TABLE services (
  name TEXT PRIMARY KEY,
  silver TEXT NOT NULL
);

CREATE TABLE beasts (
  name TEXT PRIMARY KEY,
  silver INTEGER NOT NULL
);

CREATE TABLE occult_treasures (
  roll INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  effect TEXT NOT NULL
);

CREATE TABLE corpse_plundering (
  code TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  silver INTEGER NOT NULL,
  damage TEXT
);

CREATE TABLE scrolls (
  kind TEXT NOT NULL,
  roll INTEGER NOT NULL,
  name TEXT NOT NULL,
  effect TEXT NOT NULL,
  PRIMARY KEY (kind, roll)
);

CREATE TABLE arcane_catastrophes (
  roll INTEGER PRIMARY KEY,
  text TEXT NOT NULL
);

CREATE TABLE traits (
  category TEXT NOT NULL,
  roll INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (category, roll)
);

CREATE TABLE creatures (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hp INTEGER NOT NULL,
  morale INTEGER,
  armor_name TEXT NOT NULL,
  armor_die TEXT,
  attack_name TEXT NOT NULL,
  damage_die TEXT NOT NULL,
  attack_dr INTEGER NOT NULL,
  defence_dr INTEGER NOT NULL,
  attacks_per_round INTEGER NOT NULL,
  special TEXT NOT NULL,
  bounty TEXT NOT NULL
);

CREATE TABLE outcasts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  hp INTEGER NOT NULL,
  morale INTEGER NOT NULL,
  armor_name TEXT NOT NULL,
  weapon_name TEXT NOT NULL,
  traits_json TEXT NOT NULL,
  specialties_json TEXT NOT NULL,
  values_json TEXT NOT NULL
);

CREATE TABLE regions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT NOT NULL
);

CREATE TABLE calendar_psalms (
  code TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  is_final INTEGER NOT NULL
);

CREATE TABLE weather (
  roll INTEGER PRIMARY KEY,
  text TEXT NOT NULL
);

CREATE TABLE where_wander (
  roll INTEGER PRIMARY KEY,
  region_id TEXT NOT NULL REFERENCES regions(id),
  text TEXT NOT NULL
);

CREATE TABLE who_contacts (
  roll INTEGER PRIMARY KEY,
  text TEXT NOT NULL
);

CREATE TABLE adventure_sparks (
  roll_min INTEGER NOT NULL,
  roll_max INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (roll_min, roll_max)
);

CREATE TABLE basilisks_demand (
  roll INTEGER PRIMARY KEY,
  text TEXT NOT NULL
);

CREATE TABLE dungeon_tables (
  category TEXT NOT NULL,
  seq INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (category, seq)
);

CREATE TABLE trait_profiles (
  category TEXT NOT NULL,
  roll INTEGER NOT NULL,
  tags_json TEXT NOT NULL,
  prose_variants_json TEXT NOT NULL,
  reaction_mod INTEGER NOT NULL,
  dr_mod_json TEXT,
  unlocked_choice_json TEXT,
  pursuer_json TEXT,
  PRIMARY KEY (category, roll),
  FOREIGN KEY (category, roll) REFERENCES traits(category, roll) ON DELETE CASCADE
);

CREATE TABLE campaign_patrons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hook_intro TEXT NOT NULL
);

CREATE TABLE campaign_objectives (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  target_name TEXT NOT NULL,
  brief TEXT NOT NULL,
  refuses_leave INTEGER NOT NULL
);

CREATE TABLE central_hazards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  test_ability TEXT NOT NULL,
  test_dr INTEGER NOT NULL,
  fail_damage_die TEXT NOT NULL,
  apex_creature_id TEXT NOT NULL REFERENCES creatures(id),
  sensory_hint TEXT NOT NULL
);

CREATE TABLE rival_factions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  leader_name TEXT NOT NULL,
  appearance TEXT NOT NULL,
  agenda TEXT NOT NULL,
  brew_name TEXT NOT NULL,
  zealot_creature_id TEXT NOT NULL REFERENCES creatures(id)
);

CREATE TABLE puzzle_statues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  socket_item_name TEXT NOT NULL,
  unlock_text TEXT NOT NULL
);

CREATE TABLE campaign_bosses (
  creature_id TEXT PRIMARY KEY REFERENCES creatures(id),
  key_name TEXT NOT NULL
);

CREATE TABLE table_a_encounters (
  seq INTEGER PRIMARY KEY,
  creature_id TEXT NOT NULL REFERENCES creatures(id),
  count_formula TEXT NOT NULL,
  intro TEXT NOT NULL
);

CREATE TABLE table_b_anomalies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE prose_fragments (
  category TEXT NOT NULL,
  seq INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (category, seq)
);
`;
