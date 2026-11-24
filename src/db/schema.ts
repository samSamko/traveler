export const WORLD_DB_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE races (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  lore TEXT NOT NULL,
  stat_mods_json TEXT NOT NULL,
  resistances_json TEXT NOT NULL,
  passive_id TEXT NOT NULL,
  passive_name TEXT NOT NULL,
  passive_desc TEXT NOT NULL,
  racial_ability_id TEXT NOT NULL,
  world_reactions TEXT NOT NULL
);

CREATE TABLE abilities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  action_cost TEXT,
  damage_type TEXT,
  non_lethal INTEGER NOT NULL DEFAULT 0,
  stamina_cost INTEGER NOT NULL DEFAULT 0,
  focus_cost INTEGER NOT NULL DEFAULT 0,
  hp_cost INTEGER NOT NULL DEFAULT 0,
  stat TEXT NOT NULL,
  base_damage INTEGER NOT NULL DEFAULT 0,
  damage_dice_json TEXT,
  heal_amount INTEGER NOT NULL DEFAULT 0,
  restore_resolve INTEGER NOT NULL DEFAULT 0,
  restore_stamina INTEGER NOT NULL DEFAULT 0,
  restore_focus INTEGER NOT NULL DEFAULT 0,
  apply_enemy_status_json TEXT,
  apply_self_status_json TEXT,
  pierce_armor INTEGER NOT NULL DEFAULT 0,
  shatter_guard INTEGER NOT NULL DEFAULT 0,
  bonus_vs_debuffed INTEGER NOT NULL DEFAULT 0,
  purge_negative INTEGER NOT NULL DEFAULT 0,
  is_aoe INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slot TEXT NOT NULL,
  value INTEGER NOT NULL,
  description TEXT NOT NULL,
  damage_type TEXT,
  damage_dice_json TEXT,
  bonus_damage INTEGER,
  stat_scaling TEXT,
  armor_bonus INTEGER,
  resistances_json TEXT,
  max_hp_bonus INTEGER,
  max_focus_bonus INTEGER,
  max_stamina_bonus INTEGER,
  max_resolve_bonus INTEGER,
  stat_bonus_json TEXT,
  heal_hp INTEGER,
  restore_stamina INTEGER,
  restore_focus INTEGER,
  restore_resolve INTEGER,
  cure_negative INTEGER NOT NULL DEFAULT 0,
  tends_injury INTEGER NOT NULL DEFAULT 0,
  grants_body_mod_id TEXT,
  throw_damage INTEGER,
  throw_damage_type TEXT,
  throw_status_json TEXT,
  action_cost TEXT,
  two_handed INTEGER NOT NULL DEFAULT 0,
  armor_tier INTEGER NOT NULL DEFAULT 0,
  traits_json TEXT,
  visible_tags_json TEXT,
  granted_ability_id TEXT,
  coating_json TEXT,
  draught_json TEXT,
  ash_text_json TEXT
);

CREATE TABLE backgrounds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  lore TEXT NOT NULL,
  stat_mods_json TEXT NOT NULL,
  starting_weapon_id TEXT NOT NULL REFERENCES items(id),
  starting_armor_id TEXT NOT NULL REFERENCES items(id),
  starting_trinket_id TEXT REFERENCES items(id),
  starting_items_json TEXT NOT NULL,
  starting_crowns INTEGER NOT NULL,
  starting_rations INTEGER NOT NULL,
  starting_torches INTEGER NOT NULL,
  ability_ids_json TEXT NOT NULL,
  passive_id TEXT NOT NULL,
  passive_name TEXT NOT NULL,
  passive_desc TEXT NOT NULL
);

CREATE TABLE heirlooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unlock_requirement TEXT NOT NULL,
  description TEXT NOT NULL,
  combat_description TEXT NOT NULL
);

CREATE TABLE perks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  stat_bonus_json TEXT,
  max_hp_bonus INTEGER,
  max_stamina_bonus INTEGER,
  max_focus_bonus INTEGER,
  max_resolve_bonus INTEGER,
  armor_bonus INTEGER,
  damage_bonus INTEGER,
  extra_main_actions INTEGER,
  extra_swift_actions INTEGER,
  swift_items INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  output_item_id TEXT NOT NULL REFERENCES items(id),
  output_qty INTEGER NOT NULL,
  grixi_or_scholar_only INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE recipe_ingredients (
  recipe_id TEXT NOT NULL REFERENCES recipes(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  qty INTEGER NOT NULL,
  PRIMARY KEY (recipe_id, item_id)
);

CREATE TABLE body_mods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  slot TEXT NOT NULL,
  defilement_load INTEGER NOT NULL,
  description TEXT NOT NULL,
  bonus_summary TEXT NOT NULL,
  drawback_summary TEXT NOT NULL,
  stat_mods_json TEXT,
  max_hp_mod INTEGER,
  max_stamina_mod INTEGER,
  max_focus_mod INTEGER,
  max_resolve_mod INTEGER,
  armor_mod INTEGER,
  resistances_json TEXT,
  granted_ability_id TEXT REFERENCES abilities(id),
  anatomy_overlay_json TEXT NOT NULL,
  added_tags_json TEXT NOT NULL,
  excision_scar TEXT NOT NULL
);

CREATE TABLE injuries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  severity TEXT NOT NULL,
  description TEXT NOT NULL,
  stat_penalty_json TEXT,
  max_hp_penalty INTEGER,
  max_stamina_penalty INTEGER,
  max_resolve_penalty INTEGER,
  heal_dc INTEGER NOT NULL,
  scar_on_heal TEXT NOT NULL
);

CREATE TABLE enemies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unidentified_name TEXT NOT NULL,
  category TEXT NOT NULL,
  max_hp INTEGER NOT NULL,
  armor INTEGER NOT NULL,
  stats_json TEXT NOT NULL,
  resistances_json TEXT NOT NULL,
  visible_gear_json TEXT NOT NULL,
  anatomy_json TEXT NOT NULL,
  first_sight_prose TEXT NOT NULL,
  return_sight_prose TEXT NOT NULL,
  xp_reward INTEGER NOT NULL,
  crown_min INTEGER NOT NULL,
  crown_max INTEGER NOT NULL,
  harvest_item_id TEXT REFERENCES items(id),
  harvest_mod_id TEXT REFERENCES body_mods(id),
  interrogate_hint TEXT,
  is_boss INTEGER NOT NULL DEFAULT 0,
  is_elite INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL
);

CREATE TABLE enemy_intents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enemy_id TEXT NOT NULL REFERENCES enemies(id),
  sort_order INTEGER NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  damage INTEGER NOT NULL,
  damage_type TEXT NOT NULL,
  resolve_damage INTEGER,
  defilement_gain INTEGER,
  status_json TEXT,
  armor_gain INTEGER,
  description TEXT NOT NULL
);

CREATE TABLE enemy_loot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enemy_id TEXT NOT NULL REFERENCES enemies(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  chance REAL NOT NULL
);

CREATE TABLE places (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region_type TEXT NOT NULL,
  danger INTEGER NOT NULL,
  dark INTEGER NOT NULL DEFAULT 0,
  ascii_row INTEGER NOT NULL,
  ascii_col INTEGER NOT NULL,
  ascii_code TEXT NOT NULL,
  sensory_summary TEXT NOT NULL,
  first_sight_variants_json TEXT NOT NULL,
  description_variants_json TEXT NOT NULL,
  shop_json TEXT
);

CREATE TABLE place_connections (
  from_place_id TEXT NOT NULL REFERENCES places(id),
  to_place_id TEXT NOT NULL REFERENCES places(id),
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (from_place_id, to_place_id)
);

CREATE TABLE place_actions (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id),
  sort_order INTEGER NOT NULL,
  label TEXT NOT NULL,
  visible_cond_json TEXT,
  effect_json TEXT NOT NULL
);

CREATE TABLE npcs (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id),
  name TEXT NOT NULL,
  unidentified_label TEXT NOT NULL,
  short_label TEXT NOT NULL,
  visible_cond_json TEXT,
  first_sight_prose TEXT NOT NULL,
  greeting_variants_json TEXT NOT NULL,
  anatomy_json TEXT NOT NULL
);

CREATE TABLE npc_topics (
  id TEXT PRIMARY KEY,
  npc_id TEXT NOT NULL REFERENCES npcs(id),
  sort_order INTEGER NOT NULL,
  label TEXT NOT NULL,
  visible_cond_json TEXT,
  effect_json TEXT NOT NULL
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  locations_json TEXT NOT NULL,
  min_day INTEGER,
  max_day INTEGER,
  periods_json TEXT,
  weathers_json TEXT,
  min_defilement INTEGER,
  max_defilement INTEGER,
  required_tags_json TEXT,
  repeatable INTEGER NOT NULL DEFAULT 0,
  cooldown_hours INTEGER,
  weight INTEGER NOT NULL DEFAULT 1,
  condition_json TEXT,
  prompt_variants_json TEXT NOT NULL
);

CREATE TABLE event_choices (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  sort_order INTEGER NOT NULL,
  label TEXT NOT NULL,
  visible_cond_json TEXT,
  enabled_cond_json TEXT,
  disabled_reason TEXT,
  effect_json TEXT NOT NULL
);

CREATE TABLE entity_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_ref TEXT NOT NULL,
  relation TEXT NOT NULL,
  to_ref TEXT NOT NULL,
  note TEXT NOT NULL
);

CREATE TABLE npc_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  npc_id TEXT NOT NULL REFERENCES npcs(id),
  sort_order INTEGER NOT NULL,
  cond_json TEXT NOT NULL,
  reaction_text TEXT NOT NULL
);

CREATE TABLE sub_areas (
  id TEXT PRIMARY KEY,
  parent_area_id TEXT NOT NULL REFERENCES places(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  danger_bonus INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE explore_encounters (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  label TEXT NOT NULL,
  prose TEXT NOT NULL,
  enemy_ids_json TEXT,
  item_id TEXT REFERENCES items(id),
  crowns_min INTEGER,
  crowns_max INTEGER,
  target_unlock_id TEXT,
  shop_json TEXT
);

CREATE TABLE dungeons (
  id TEXT PRIMARY KEY,
  parent_area_id TEXT NOT NULL REFERENCES places(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  entry_room_id TEXT NOT NULL,
  danger INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE dungeon_rooms (
  id TEXT PRIMARY KEY,
  dungeon_id TEXT NOT NULL REFERENCES dungeons(id),
  name TEXT NOT NULL,
  row INTEGER NOT NULL,
  col INTEGER NOT NULL,
  room_type TEXT NOT NULL,
  description TEXT NOT NULL,
  enemy_ids_json TEXT,
  loot_item_id TEXT REFERENCES items(id),
  crowns INTEGER,
  trap_dc INTEGER,
  trap_damage INTEGER,
  switch_id TEXT,
  switch_label TEXT,
  is_boss INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE dungeon_exits (
  id TEXT PRIMARY KEY,
  from_room_id TEXT NOT NULL REFERENCES dungeon_rooms(id),
  to_room_id TEXT NOT NULL REFERENCES dungeon_rooms(id),
  label TEXT NOT NULL,
  locked_by_switch_id TEXT,
  locked_by_item_id TEXT REFERENCES items(id)
);
`;
