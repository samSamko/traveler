import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type {
  AbilityDef,
  BackgroundDef,
  BackgroundId,
  BodyModDef,
  DungeonDef,
  DungeonExitDef,
  DungeonRoomDef,
  EnemyTemplate,
  EntityLink,
  EventCard,
  ExploreEncounterDef,
  HeirloomDef,
  HeirloomId,
  InjuryDef,
  ItemDef,
  LocationNode,
  NpcNode,
  PerkDef,
  RaceDef,
  RaceId,
  RecipeDef,
  SecretSubAreaDef,
  ShopListing,
} from '../types.ts';
import { WORLD_DB_SCHEMA } from './schema.ts';
import {
  evaluateCondition,
  executeEffect,
  selectProseVariant,
  type ConditionSpec,
  type EffectSpec,
  type ProseVariant,
} from './rules.ts';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');

function readDataJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, filename), 'utf8')) as T;
}

export interface WorldRepository {
  db: DatabaseSync;
  races: Record<RaceId, RaceDef>;
  backgrounds: Record<BackgroundId, BackgroundDef>;
  heirlooms: Record<HeirloomId, HeirloomDef>;
  abilities: Record<string, AbilityDef>;
  perks: Record<string, PerkDef>;
  items: Record<string, ItemDef>;
  recipes: RecipeDef[];
  bodyMods: Record<string, BodyModDef>;
  injuries: Record<string, InjuryDef>;
  enemies: Record<string, EnemyTemplate>;
  locations: Record<string, LocationNode>;
  events: EventCard[];
  entityLinks: EntityLink[];
  npcReactions: Array<{ npcId: string; cond: ConditionSpec; text: string }>;
  subAreas: Record<string, SecretSubAreaDef>;
  encounters: ExploreEncounterDef[];
  dungeons: Record<string, DungeonDef>;
}

let cachedWorld: WorldRepository | null = null;

export function loadWorldDatabase(): WorldRepository {
  if (cachedWorld) return cachedWorld;

  const db = new DatabaseSync(':memory:');
  db.exec(WORLD_DB_SCHEMA);

  const charJson = readDataJson<{
    races: Record<RaceId, RaceDef>;
    backgrounds: Record<BackgroundId, BackgroundDef>;
    heirlooms: Record<HeirloomId, HeirloomDef>;
    abilities: Record<string, AbilityDef>;
    perks: Record<string, PerkDef>;
  }>('characters.json');

  const itemsJson = readDataJson<{
    items: Record<string, ItemDef>;
    recipes: RecipeDef[];
  }>('items.json');

  const modsJson = readDataJson<{
    bodyMods: Record<string, BodyModDef>;
    injuries: Record<string, InjuryDef>;
  }>('bodymods.json');

  const enemiesJson = readDataJson<{
    enemies: Record<string, EnemyTemplate>;
  }>('enemies.json');

  const placesJson = readDataJson<{
    places: Array<{
      id: string;
      name: string;
      regionType: 'town' | 'special' | 'area';
      danger: number;
      dark: boolean;
      neighbors: string[];
      asciiPos: { row: number; col: number; code: string };
      sensorySummary: string;
      firstSightVariants: ProseVariant[];
      descriptionVariants: ProseVariant[];
      shop?: {
        name: string;
        keeper: string;
        greetingVariants: ProseVariant[];
        items: ShopListing[];
      };
      actions: Array<{
        id: string;
        label: string;
        visible?: ConditionSpec;
        effect: EffectSpec;
      }>;
      npcs: Array<{
        id: string;
        name: string;
        unidentifiedLabel: string;
        shortLabel: string;
        visible?: ConditionSpec;
        firstSightProse: string;
        greetingVariants: ProseVariant[];
        anatomy: NpcNode['anatomy'];
        topics: Array<{
          id: string;
          label: string;
          visible?: ConditionSpec;
          effect: EffectSpec;
        }>;
      }>;
    }>;
  }>('places.json');

  const eventsJson = readDataJson<{
    events: Array<{
      id: string;
      title: string;
      locations: string[];
      minDay?: number;
      maxDay?: number;
      periods?: string[];
      weathers?: string[];
      minDefilement?: number;
      maxDefilement?: number;
      requiredTags?: string[];
      repeatable?: boolean;
      cooldownHours?: number;
      weight?: number;
      condition?: ConditionSpec;
      promptVariants: ProseVariant[];
      choices: Array<{
        id: string;
        label: string;
        visible?: ConditionSpec;
        enabled?: ConditionSpec;
        disabledReason?: string;
        effect: EffectSpec;
      }>;
    }>;
  }>('events.json');

  const linksJson = readDataJson<{
    entityLinks: EntityLink[];
    npcReactions: Array<{
      npcId: string;
      sortOrder: number;
      cond: ConditionSpec;
      text: string;
    }>;
  }>('links.json');

  const encountersJson = readDataJson<{
    subAreas: SecretSubAreaDef[];
    encounters: ExploreEncounterDef[];
  }>('encounters.json');

  const dungeonsJson = readDataJson<{
    dungeons: Array<{
      id: string;
      parentAreaId: string;
      name: string;
      description: string;
      entryRoomId: string;
      danger: number;
      rooms: Array<
        Omit<DungeonRoomDef, 'dungeonId' | 'exits'> & {
          exits: Array<Omit<DungeonExitDef, 'fromRoomId'>>;
        }
      >;
    }>;
  }>('dungeons.json');

  db.exec('BEGIN');
  try {
    // 1. Items
    const insItem = db.prepare(
      `INSERT INTO items (
        id, name, slot, value, description, damage_type, damage_dice_json, bonus_damage,
        stat_scaling, armor_bonus, resistances_json, max_hp_bonus, max_focus_bonus,
        max_stamina_bonus, max_resolve_bonus, stat_bonus_json, heal_hp, restore_stamina,
        restore_focus, restore_resolve, cure_negative, tends_injury, grants_body_mod_id,
        throw_damage, throw_damage_type, throw_status_json, action_cost, two_handed,
        armor_tier, traits_json, visible_tags_json, granted_ability_id,
        coating_json, draught_json, ash_text_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of Object.values(itemsJson.items)) {
      insItem.run(
        item.id,
        item.name,
        item.slot,
        item.value,
        item.description,
        item.damageType ?? null,
        item.damageDice ? JSON.stringify(item.damageDice) : null,
        item.bonusDamage ?? null,
        item.statScaling ?? null,
        item.armorBonus ?? null,
        item.resistances ? JSON.stringify(item.resistances) : null,
        item.maxHpBonus ?? null,
        item.maxFocusBonus ?? null,
        item.maxStaminaBonus ?? null,
        item.maxResolveBonus ?? null,
        item.statBonus ? JSON.stringify(item.statBonus) : null,
        item.healHp ?? null,
        item.restoreStamina ?? null,
        item.restoreFocus ?? null,
        item.restoreResolve ?? null,
        item.cureNegative ? 1 : 0,
        item.tendsInjury ? 1 : 0,
        item.grantsBodyModId ?? null,
        item.throwDamage ?? null,
        item.throwDamageType ?? null,
        item.throwStatus ? JSON.stringify(item.throwStatus) : null,
        item.actionCost ?? null,
        item.twoHanded ? 1 : 0,
        item.armorTier ?? 0,
        item.traits ? JSON.stringify(item.traits) : null,
        item.visibleTags ? JSON.stringify(item.visibleTags) : null,
        item.grantedAbilityId ?? null,
        item.coatingDamageType
          ? JSON.stringify({
              damageType: item.coatingDamageType,
              bonusDamage: item.coatingBonusDamage ?? 0,
              charges: item.coatingCharges ?? 3,
            })
          : null,
        item.draughtDefilement !== undefined || item.draughtPurgeDefilement !== undefined
          ? JSON.stringify({
              defilement: item.draughtDefilement ?? 0,
              purge: item.draughtPurgeDefilement ?? 0,
              status: item.draughtStatus ?? null,
            })
          : null,
        item.ashTextEffect
          ? JSON.stringify({ dc: item.ashTextDc ?? 12, effect: item.ashTextEffect })
          : null,
      );
    }

    // 2. Abilities
    const insAbility = db.prepare(
      `INSERT INTO abilities (
        id, name, kind, action_cost, damage_type, non_lethal, stamina_cost, focus_cost, hp_cost,
        stat, base_damage, damage_dice_json, heal_amount, restore_resolve,
        restore_stamina, restore_focus, apply_enemy_status_json, apply_self_status_json,
        pierce_armor, shatter_guard, bonus_vs_debuffed, purge_negative, is_aoe, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const ab of Object.values(charJson.abilities)) {
      insAbility.run(
        ab.id,
        ab.name,
        ab.kind,
        ab.actionCost ?? null,
        ab.damageType ?? null,
        ab.nonLethal ? 1 : 0,
        ab.staminaCost,
        ab.focusCost,
        ab.hpCost ?? 0,
        ab.stat,
        ab.baseDamage ?? 0,
        ab.damageDice ? JSON.stringify(ab.damageDice) : null,
        ab.healAmount ?? 0,
        ab.restoreResolve ?? 0,
        ab.restoreStamina ?? 0,
        ab.restoreFocus ?? 0,
        ab.applyEnemyStatus ? JSON.stringify(ab.applyEnemyStatus) : null,
        ab.applySelfStatus ? JSON.stringify(ab.applySelfStatus) : null,
        ab.pierceArmor ? 1 : 0,
        ab.shatterGuard ? 1 : 0,
        ab.bonusVsDebuffed ?? 0,
        ab.purgeNegativeStatuses ? 1 : 0,
        ab.isAoE ? 1 : 0,
        ab.description,
      );
    }

    // 3. Races, Backgrounds, Heirlooms, Perks
    const insRace = db.prepare(
      `INSERT INTO races (id, name, subtitle, lore, stat_mods_json, resistances_json, passive_id, passive_name, passive_desc, racial_ability_id, world_reactions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of Object.values(charJson.races)) {
      insRace.run(
        r.id,
        r.name,
        r.subtitle,
        r.lore,
        JSON.stringify(r.statMods),
        JSON.stringify(r.resistances ?? {}),
        r.passive.id,
        r.passive.name,
        r.passive.description,
        r.racialAbilityId,
        r.worldReactions,
      );
    }

    const insBg = db.prepare(
      `INSERT INTO backgrounds (id, name, subtitle, lore, stat_mods_json, starting_weapon_id, starting_armor_id, starting_trinket_id, starting_items_json, starting_crowns, starting_rations, starting_torches, ability_ids_json, passive_id, passive_name, passive_desc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const b of Object.values(charJson.backgrounds)) {
      insBg.run(
        b.id,
        b.name,
        b.subtitle,
        b.lore,
        JSON.stringify(b.statMods),
        b.startingWeaponId,
        b.startingArmorId,
        b.startingTrinketId ?? null,
        JSON.stringify(b.startingItems),
        b.startingCrowns,
        b.startingRations,
        b.startingTorches,
        JSON.stringify(b.abilityIds),
        b.passive.id,
        b.passive.name,
        b.passive.description,
      );
    }

    const insHeirloom = db.prepare(
      `INSERT INTO heirlooms (id, name, unlock_requirement, description, combat_description) VALUES (?, ?, ?, ?, ?)`,
    );
    for (const h of Object.values(charJson.heirlooms)) {
      insHeirloom.run(h.id, h.name, h.unlockRequirement, h.description, h.combatDescription);
    }

    const insPerk = db.prepare(
      `INSERT INTO perks (id, name, description, stat_bonus_json, max_hp_bonus, max_stamina_bonus, max_focus_bonus, max_resolve_bonus, armor_bonus, damage_bonus, extra_main_actions, extra_swift_actions, swift_items)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const pk of Object.values(charJson.perks)) {
      insPerk.run(
        pk.id,
        pk.name,
        pk.description,
        pk.statBonus ? JSON.stringify(pk.statBonus) : null,
        pk.maxHpBonus ?? null,
        pk.maxStaminaBonus ?? null,
        pk.maxFocusBonus ?? null,
        pk.maxResolveBonus ?? null,
        pk.armorBonus ?? null,
        pk.damageBonus ?? null,
        pk.extraMainActions ?? null,
        pk.extraSwiftActions ?? null,
        pk.swiftItems ? 1 : 0,
      );
    }

    // 4. Recipes
    const insRec = db.prepare(
      `INSERT INTO recipes (id, name, output_item_id, output_qty, grixi_or_scholar_only) VALUES (?, ?, ?, ?, ?)`,
    );
    const insRecIng = db.prepare(
      `INSERT INTO recipe_ingredients (recipe_id, item_id, qty) VALUES (?, ?, ?)`,
    );
    for (const rec of itemsJson.recipes) {
      insRec.run(rec.id, rec.name, rec.outputItemId, rec.outputQty, rec.grixiOrScholarOnly ? 1 : 0);
      for (const ing of rec.ingredients) {
        insRecIng.run(rec.id, ing.itemId, ing.qty);
      }
    }

    // 5. Body Mods & Injuries
    const insMod = db.prepare(
      `INSERT INTO body_mods (id, name, kind, slot, defilement_load, description, bonus_summary, drawback_summary, stat_mods_json, max_hp_mod, max_stamina_mod, max_focus_mod, max_resolve_mod, armor_mod, resistances_json, granted_ability_id, anatomy_overlay_json, added_tags_json, excision_scar)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const m of Object.values(modsJson.bodyMods)) {
      insMod.run(
        m.id,
        m.name,
        m.kind,
        m.slot,
        m.defilementLoad,
        m.description,
        m.bonusSummary,
        m.drawbackSummary,
        m.statMods ? JSON.stringify(m.statMods) : null,
        m.maxHpMod ?? null,
        m.maxStaminaMod ?? null,
        m.maxFocusMod ?? null,
        m.maxResolveMod ?? null,
        m.armorMod ?? null,
        m.resistances ? JSON.stringify(m.resistances) : null,
        m.grantedAbilityId ?? null,
        JSON.stringify(m.anatomyOverlay),
        JSON.stringify(m.addedTags),
        m.excisionScar,
      );
    }

    const insInj = db.prepare(
      `INSERT INTO injuries (id, name, severity, description, stat_penalty_json, max_hp_penalty, max_stamina_penalty, max_resolve_penalty, heal_dc, scar_on_heal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const inj of Object.values(modsJson.injuries)) {
      insInj.run(
        inj.id,
        inj.name,
        inj.severity,
        inj.description,
        inj.statPenalty ? JSON.stringify(inj.statPenalty) : null,
        inj.maxHpPenalty ?? null,
        inj.maxStaminaPenalty ?? null,
        inj.maxResolvePenalty ?? null,
        inj.healDc,
        inj.scarOnHeal,
      );
    }

    // 6. Enemies
    const insEnemy = db.prepare(
      `INSERT INTO enemies (id, name, unidentified_name, category, max_hp, armor, stats_json, resistances_json, visible_gear_json, anatomy_json, first_sight_prose, return_sight_prose, xp_reward, crown_min, crown_max, harvest_item_id, harvest_mod_id, interrogate_hint, is_boss, is_elite, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insIntent = db.prepare(
      `INSERT INTO enemy_intents (enemy_id, sort_order, kind, label, damage, damage_type, resolve_damage, defilement_gain, status_json, armor_gain, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insLoot = db.prepare(
      `INSERT INTO enemy_loot (enemy_id, item_id, chance) VALUES (?, ?, ?)`,
    );
    for (const e of Object.values(enemiesJson.enemies)) {
      insEnemy.run(
        e.id,
        e.name,
        e.unidentifiedName,
        e.category,
        e.maxHp,
        e.armor,
        JSON.stringify(e.stats),
        JSON.stringify(e.resistances ?? {}),
        JSON.stringify(e.visibleGear),
        JSON.stringify(e.anatomy),
        e.firstSightProse,
        e.returnSightProse,
        e.xpReward,
        e.crownReward[0],
        e.crownReward[1],
        e.harvestItemId ?? null,
        e.harvestModId ?? null,
        e.interrogateHint ?? null,
        e.isBoss ? 1 : 0,
        e.isElite ? 1 : 0,
        e.description,
      );
      e.intents.forEach((intent, idx) => {
        insIntent.run(
          e.id,
          idx,
          intent.kind,
          intent.label,
          intent.damage,
          intent.damageType,
          intent.resolveDamage ?? null,
          intent.defilementGain ?? null,
          intent.status ? JSON.stringify(intent.status) : null,
          intent.armorGain ?? null,
          intent.description,
        );
      });
      for (const drop of e.lootTable) {
        insLoot.run(e.id, drop.itemId, drop.chance);
      }
    }

    // 7. Places, Connections, Actions, NPCs, Topics
    const insPlace = db.prepare(
      `INSERT INTO places (id, name, region_type, danger, dark, ascii_row, ascii_col, ascii_code, sensory_summary, first_sight_variants_json, description_variants_json, shop_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const pl of placesJson.places) {
      insPlace.run(
        pl.id,
        pl.name,
        pl.regionType,
        pl.danger,
        pl.dark ? 1 : 0,
        pl.asciiPos.row,
        pl.asciiPos.col,
        pl.asciiPos.code,
        pl.sensorySummary,
        JSON.stringify(pl.firstSightVariants),
        JSON.stringify(pl.descriptionVariants),
        pl.shop ? JSON.stringify(pl.shop) : null,
      );
    }

    const insConn = db.prepare(
      `INSERT INTO place_connections (from_place_id, to_place_id, sort_order) VALUES (?, ?, ?)`,
    );
    const insPlaceAct = db.prepare(
      `INSERT INTO place_actions (id, place_id, sort_order, label, visible_cond_json, effect_json) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insNpc = db.prepare(
      `INSERT INTO npcs (id, place_id, name, unidentified_label, short_label, visible_cond_json, first_sight_prose, greeting_variants_json, anatomy_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insTopic = db.prepare(
      `INSERT INTO npc_topics (id, npc_id, sort_order, label, visible_cond_json, effect_json) VALUES (?, ?, ?, ?, ?, ?)`,
    );

    for (const pl of placesJson.places) {
      pl.neighbors.forEach((toId, idx) => insConn.run(pl.id, toId, idx));
      pl.actions.forEach((act, idx) => {
        insPlaceAct.run(
          act.id,
          pl.id,
          idx,
          act.label,
          act.visible ? JSON.stringify(act.visible) : null,
          JSON.stringify(act.effect),
        );
      });
      for (const npc of pl.npcs) {
        insNpc.run(
          npc.id,
          pl.id,
          npc.name,
          npc.unidentifiedLabel,
          npc.shortLabel,
          npc.visible ? JSON.stringify(npc.visible) : null,
          npc.firstSightProse,
          JSON.stringify(npc.greetingVariants),
          JSON.stringify(npc.anatomy),
        );
        npc.topics.forEach((top, idx) => {
          insTopic.run(
            top.id,
            npc.id,
            idx,
            top.label,
            top.visible ? JSON.stringify(top.visible) : null,
            JSON.stringify(top.effect),
          );
        });
      }
    }

    // 8. Events & Choices
    const insEvent = db.prepare(
      `INSERT INTO events (id, title, locations_json, min_day, max_day, periods_json, weathers_json, min_defilement, max_defilement, required_tags_json, repeatable, cooldown_hours, weight, condition_json, prompt_variants_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insChoice = db.prepare(
      `INSERT INTO event_choices (id, event_id, sort_order, label, visible_cond_json, enabled_cond_json, disabled_reason, effect_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const ev of eventsJson.events) {
      insEvent.run(
        ev.id,
        ev.title,
        JSON.stringify(ev.locations),
        ev.minDay ?? null,
        ev.maxDay ?? null,
        ev.periods ? JSON.stringify(ev.periods) : null,
        ev.weathers ? JSON.stringify(ev.weathers) : null,
        ev.minDefilement ?? null,
        ev.maxDefilement ?? null,
        ev.requiredTags ? JSON.stringify(ev.requiredTags) : null,
        ev.repeatable ? 1 : 0,
        ev.cooldownHours ?? null,
        ev.weight ?? 1,
        ev.condition ? JSON.stringify(ev.condition) : null,
        JSON.stringify(ev.promptVariants),
      );
      ev.choices.forEach((ch, idx) => {
        insChoice.run(
          ch.id,
          ev.id,
          idx,
          ch.label,
          ch.visible ? JSON.stringify(ch.visible) : null,
          ch.enabled ? JSON.stringify(ch.enabled) : null,
          ch.disabledReason ?? null,
          JSON.stringify(ch.effect),
        );
      });
    }

    // 9. Entity Links & NPC Reactions
    const insLink = db.prepare(
      `INSERT INTO entity_links (from_ref, relation, to_ref, note) VALUES (?, ?, ?, ?)`,
    );
    for (const l of linksJson.entityLinks) {
      insLink.run(l.from, l.relation, l.to, l.note);
    }

    const insReact = db.prepare(
      `INSERT INTO npc_reactions (npc_id, sort_order, cond_json, reaction_text) VALUES (?, ?, ?, ?)`,
    );
    for (const rx of linksJson.npcReactions) {
      insReact.run(rx.npcId, rx.sortOrder, JSON.stringify(rx.cond), rx.text);
    }

    // 10. Sub-Areas & Explore Encounters
    const insSubArea = db.prepare(
      `INSERT INTO sub_areas (id, parent_area_id, name, description, danger_bonus) VALUES (?, ?, ?, ?, ?)`,
    );
    for (const sa of encountersJson.subAreas) {
      insSubArea.run(sa.id, sa.parentAreaId, sa.name, sa.description, sa.dangerBonus);
    }

    const insEnc = db.prepare(
      `INSERT INTO explore_encounters (
        id, scope_type, scope_id, kind, weight, label, prose,
        enemy_ids_json, item_id, crowns_min, crowns_max, target_unlock_id, shop_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const enc of encountersJson.encounters) {
      insEnc.run(
        enc.id,
        enc.scopeType,
        enc.scopeId,
        enc.kind,
        enc.weight,
        enc.label,
        enc.prose,
        enc.enemyIds ? JSON.stringify(enc.enemyIds) : null,
        enc.itemId ?? null,
        enc.crownsMin ?? null,
        enc.crownsMax ?? null,
        enc.targetUnlockId ?? null,
        enc.shop ? JSON.stringify(enc.shop) : null,
      );
    }

    // 11. Dungeons, Rooms & Exits
    const insDung = db.prepare(
      `INSERT INTO dungeons (id, parent_area_id, name, description, entry_room_id, danger) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insRoom = db.prepare(
      `INSERT INTO dungeon_rooms (
        id, dungeon_id, name, row, col, room_type, description, enemy_ids_json,
        loot_item_id, crowns, trap_dc, trap_damage, switch_id, switch_label, is_boss
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insExit = db.prepare(
      `INSERT INTO dungeon_exits (id, from_room_id, to_room_id, label, locked_by_switch_id, locked_by_item_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const d of dungeonsJson.dungeons) {
      insDung.run(d.id, d.parentAreaId, d.name, d.description, d.entryRoomId, d.danger);
      for (const r of d.rooms) {
        insRoom.run(
          r.id,
          d.id,
          r.name,
          r.row,
          r.col,
          r.roomType,
          r.description,
          r.enemyIds ? JSON.stringify(r.enemyIds) : null,
          r.lootItemId ?? null,
          r.crowns ?? null,
          r.trapDc ?? null,
          r.trapDamage ?? null,
          r.switchId ?? null,
          r.switchLabel ?? null,
          r.isBoss ? 1 : 0,
        );
      }
      for (const r of d.rooms) {
        for (const ex of r.exits) {
          insExit.run(
            ex.id,
            r.id,
            ex.toRoomId,
            ex.label,
            ex.lockedBySwitchId ?? null,
            ex.lockedByItemId ?? null,
          );
        }
      }
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
  if (fkViolations.length > 0) {
    throw new Error(`SQLite foreign key check failed: ${JSON.stringify(fkViolations)}`);
  }

  // Query SQLite back into typed domain objects
  const locations: Record<string, LocationNode> = {};
  const placeRows = db.prepare('SELECT * FROM places').all() as Array<Record<string, unknown>>;
  const connStmt = db.prepare('SELECT to_place_id FROM place_connections WHERE from_place_id = ? ORDER BY sort_order');
  const actStmt = db.prepare('SELECT * FROM place_actions WHERE place_id = ? ORDER BY sort_order');
  const npcStmt = db.prepare('SELECT * FROM npcs WHERE place_id = ?');
  const topicStmt = db.prepare('SELECT * FROM npc_topics WHERE npc_id = ? ORDER BY sort_order');

  const npcReactions: Array<{ npcId: string; cond: ConditionSpec; text: string }> = [];
  const reactRows = db.prepare('SELECT * FROM npc_reactions ORDER BY npc_id, sort_order').all() as Array<Record<string, unknown>>;
  for (const r of reactRows) {
    npcReactions.push({
      npcId: String(r.npc_id),
      cond: JSON.parse(String(r.cond_json)) as ConditionSpec,
      text: String(r.reaction_text),
    });
  }

  for (const row of placeRows) {
    const id = String(row.id);
    const neighbors = (connStmt.all(id) as Array<{ to_place_id: string }>).map((r) => r.to_place_id);
    const firstSightVariants = JSON.parse(String(row.first_sight_variants_json)) as ProseVariant[];
    const descVariants = JSON.parse(String(row.description_variants_json)) as ProseVariant[];
    const shopObj = row.shop_json
      ? (JSON.parse(String(row.shop_json)) as {
          name: string;
          keeper: string;
          greetingVariants: ProseVariant[];
          items: ShopListing[];
        })
      : undefined;

    const actRows = actStmt.all(id) as Array<Record<string, unknown>>;
    const actions: LocationNode['actions'] = actRows.map((a) => {
      const visCond = a.visible_cond_json ? (JSON.parse(String(a.visible_cond_json)) as ConditionSpec) : null;
      const eff = JSON.parse(String(a.effect_json)) as EffectSpec;
      return {
        id: String(a.id),
        label: String(a.label),
        visible: visCond ? (state) => evaluateCondition(state, visCond) : undefined,
        resolve: (state) => executeEffect(state, eff),
      };
    });

    const npcRows = npcStmt.all(id) as Array<Record<string, unknown>>;
    const npcs: NpcNode[] = npcRows.map((n) => {
      const npcId = String(n.id);
      const visCond = n.visible_cond_json ? (JSON.parse(String(n.visible_cond_json)) as ConditionSpec) : null;
      const greetVariants = JSON.parse(String(n.greeting_variants_json)) as ProseVariant[];
      const anatomy = JSON.parse(String(n.anatomy_json)) as NpcNode['anatomy'];
      const topicRows = topicStmt.all(npcId) as Array<Record<string, unknown>>;

      const topics: NpcNode['topics'] = topicRows.map((t) => {
        const tVis = t.visible_cond_json ? (JSON.parse(String(t.visible_cond_json)) as ConditionSpec) : null;
        const tEff = JSON.parse(String(t.effect_json)) as EffectSpec;
        return {
          id: String(t.id),
          label: String(t.label),
          visible: tVis ? (state) => evaluateCondition(state, tVis) : undefined,
          resolve: (state) => executeEffect(state, tEff),
        };
      });

      return {
        id: npcId,
        name: String(n.name),
        unidentifiedLabel: String(n.unidentified_label),
        shortLabel: String(n.short_label),
        visible: visCond ? (state) => evaluateCondition(state, visCond) : undefined,
        firstSightProse: () => String(n.first_sight_prose),
        greeting: (state) => {
          const base = selectProseVariant(state, greetVariants);
          const rx = npcReactions.find((r) => r.npcId === npcId && evaluateCondition(state, r.cond));
          return rx ? `${base} ${rx.text}` : base;
        },
        anatomy,
        topics,
      };
    });

    locations[id] = {
      id,
      name: String(row.name),
      regionType: row.region_type as LocationNode['regionType'],
      danger: Number(row.danger),
      dark: Boolean(row.dark),
      neighbors,
      asciiPos: {
        row: Number(row.ascii_row),
        col: Number(row.ascii_col),
        code: String(row.ascii_code),
      },
      sensorySummary: String(row.sensory_summary),
      firstSightProse: (state) => selectProseVariant(state, firstSightVariants),
      description: (state) => selectProseVariant(state, descVariants),
      actions,
      npcs,
      shop: shopObj
        ? {
            name: shopObj.name,
            keeper: shopObj.keeper,
            greeting: (state) => selectProseVariant(state, shopObj.greetingVariants),
            items: shopObj.items,
          }
        : undefined,
    };
  }

  // Hydrate events from SQLite
  const events: EventCard[] = [];
  const evRows = db.prepare('SELECT * FROM events').all() as Array<Record<string, unknown>>;
  const chStmt = db.prepare('SELECT * FROM event_choices WHERE event_id = ? ORDER BY sort_order');

  for (const er of evRows) {
    const evId = String(er.id);
    const cond = er.condition_json ? (JSON.parse(String(er.condition_json)) as ConditionSpec) : null;
    const promptVariants = JSON.parse(String(er.prompt_variants_json)) as ProseVariant[];
    const chRows = chStmt.all(evId) as Array<Record<string, unknown>>;

    const choices: EventCard['choices'] = chRows.map((cr) => {
      const vis = cr.visible_cond_json ? (JSON.parse(String(cr.visible_cond_json)) as ConditionSpec) : null;
      const en = cr.enabled_cond_json ? (JSON.parse(String(cr.enabled_cond_json)) as ConditionSpec) : null;
      const disabledReason = cr.disabled_reason ? String(cr.disabled_reason) : undefined;
      const eff = JSON.parse(String(cr.effect_json)) as EffectSpec;
      return {
        id: String(cr.id),
        label: String(cr.label),
        visible: vis ? (state) => evaluateCondition(state, vis) : undefined,
        enabled: en
          ? (state) => ({ ok: evaluateCondition(state, en), reason: disabledReason })
          : undefined,
        resolve: (state) => executeEffect(state, eff),
      };
    });

    events.push({
      id: evId,
      title: String(er.title),
      locations: JSON.parse(String(er.locations_json)) as string[],
      minDay: er.min_day !== null ? Number(er.min_day) : undefined,
      maxDay: er.max_day !== null ? Number(er.max_day) : undefined,
      periods: er.periods_json ? (JSON.parse(String(er.periods_json)) as EventCard['periods']) : undefined,
      weathers: er.weathers_json ? (JSON.parse(String(er.weathers_json)) as EventCard['weathers']) : undefined,
      minDefilement: er.min_defilement !== null ? Number(er.min_defilement) : undefined,
      maxDefilement: er.max_defilement !== null ? Number(er.max_defilement) : undefined,
      requiredTags: er.required_tags_json ? (JSON.parse(String(er.required_tags_json)) as string[]) : undefined,
      repeatable: Boolean(er.repeatable),
      cooldownHours: er.cooldown_hours !== null ? Number(er.cooldown_hours) : undefined,
      weight: Number(er.weight ?? 1),
      condition: cond ? (state) => evaluateCondition(state, cond) : undefined,
      prompt: (state) => selectProseVariant(state, promptVariants),
      choices,
    });
  }

  const subAreas: Record<string, SecretSubAreaDef> = {};
  for (const sa of encountersJson.subAreas) {
    subAreas[sa.id] = sa;
  }

  const dungeons: Record<string, DungeonDef> = {};
  for (const d of dungeonsJson.dungeons) {
    const rooms: Record<string, DungeonRoomDef> = {};
    for (const r of d.rooms) {
      rooms[r.id] = {
        ...r,
        dungeonId: d.id,
        exits: r.exits.map((ex) => ({ ...ex, fromRoomId: r.id })),
      };
    }
    dungeons[d.id] = {
      id: d.id,
      parentAreaId: d.parentAreaId,
      name: d.name,
      description: d.description,
      entryRoomId: d.entryRoomId,
      danger: d.danger,
      rooms,
    };
  }

  cachedWorld = {
    db,
    races: charJson.races,
    backgrounds: charJson.backgrounds,
    heirlooms: charJson.heirlooms,
    abilities: charJson.abilities,
    perks: charJson.perks,
    items: itemsJson.items,
    recipes: itemsJson.recipes,
    bodyMods: modsJson.bodyMods,
    injuries: modsJson.injuries,
    enemies: enemiesJson.enemies,
    locations,
    events,
    entityLinks: linksJson.entityLinks,
    npcReactions,
    subAreas,
    encounters: encountersJson.encounters,
    dungeons,
  };

  return cachedWorld;
}

export function getWorldDatabase(): DatabaseSync {
  return loadWorldDatabase().db;
}
