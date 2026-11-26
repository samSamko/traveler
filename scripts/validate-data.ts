import assert from 'node:assert/strict';
import { loadWorldDatabase } from '../src/db/loader.ts';

function main(): void {
  const world = loadWorldDatabase();

  assert.equal(world.names.length, 48, 'Expected 48 names (d6 x d8)');
  assert.equal(world.classes.length, 6, 'Expected 6 Optional Classes');
  assert.equal(world.herbmasterDecoctions.length, 8, 'Expected 8 Occult Herbmaster decoctions');
  assert.equal(world.startingGearA.length, 12, 'Expected 12 Starting Gear A rows');
  assert.equal(world.startingGearB.length, 12, 'Expected 12 Starting Gear B rows');
  assert.equal(world.weapons.filter((w) => w.tableRoll !== null && w.tableRoll > 0).length, 10, 'Expected 10 weapon table rows');
  assert.equal(world.armors.length, 4, 'Expected 4 armor tiers (0..3)');
  assert.equal(world.occultTreasures.length, 10, 'Expected 10 Occult Treasures');
  assert.equal(world.corpsePlundering.length, 36, 'Expected 36 d66 Corpse Plundering entries');
  assert.equal(world.uncleanScrolls.length, 10, 'Expected 10 Unclean Scrolls');
  assert.equal(world.sacredScrolls.length, 10, 'Expected 10 Sacred Scrolls');
  assert.equal(world.arcaneCatastrophes.length, 20, 'Expected 20 Arcane Catastrophes');
  assert.equal(world.terribleTraits.length, 20, 'Expected 20 Terrible Traits');
  assert.equal(world.brokenBodies.length, 20, 'Expected 20 Broken Bodies');
  assert.equal(world.badHabits.length, 20, 'Expected 20 Bad Habits');
  assert.equal(world.troublingTales.length, 20, 'Expected 20 Troubling Tales');
  assert.equal(world.creatures.length, 28, 'Expected 28 Creatures (12 Bare Bones + 16 Sludge/Boss/Apex)');
  assert.equal(world.traitProfiles.length, 80, 'Expected 80 trait profiles (20 per category)');
  assert.equal(world.campaigns.patrons.length, 12, 'Expected 12 campaign patrons');
  assert.equal(world.campaigns.objectives.length, 12, 'Expected 12 campaign objectives');
  assert.equal(world.campaigns.centralHazards.length, 6, 'Expected 6 central hazards');
  assert.equal(world.campaigns.rivalFactions.length, 8, 'Expected 8 rival factions');
  assert.equal(world.campaigns.puzzleStatues.length, 6, 'Expected 6 puzzle statues');
  assert.equal(world.campaigns.bosses.length, 4, 'Expected 4 campaign bosses');
  assert.equal(world.campaigns.tableAEncounters.length, 4, 'Expected 4 Table A encounters');
  assert.equal(world.campaigns.tableBAnomalies.length, 4, 'Expected 4 Table B anomalies');
  assert.ok(world.proseFragments.overlandOpenings.length >= 15, 'Expected >= 15 overland openings');
  assert.ok(world.proseFragments.sensorySmells.length >= 10, 'Expected >= 10 sensory smells');
  assert.ok(world.proseFragments.sensorySounds.length >= 10, 'Expected >= 10 sensory sounds');
  assert.equal(world.outcasts.length, 4, 'Expected 4 Outcast archetypes');
  assert.equal(world.regions.length, 10, 'Expected 10 Dying World regions');
  assert.equal(world.calendarPsalms.length, 37, 'Expected 36 Psalms (1:1..6:6) + 7:7');
  assert.equal(world.calendarPsalms.filter((p) => p.isFinal).length, 1, 'Expected exactly one final Psalm (7:7)');
  assert.equal(world.weather.length, 12, 'Expected 12 Weather entries');
  assert.equal(world.whereDoYouWander.length, 12, 'Expected 12 Where entries');
  assert.equal(world.whoContactsYou.length, 20, 'Expected 20 Who entries');
  assert.equal(world.adventureSparks.length, 50, 'Expected 50 Adventure Sparks (d100)');
  assert.equal(world.basilisksDemand.length, 20, 'Expected 20 Basilisks Demand entries');
  assert.equal(world.dungeonTables.nameFirst.length, 12, 'Expected 12 dungeon first-name parts');
  assert.equal(world.dungeonTables.nameSecond.length, 12, 'Expected 12 dungeon second-name parts');
  assert.equal(world.dungeonTables.imminentDangers.length, 10, 'Expected 10 dungeon imminent dangers');
  assert.equal(world.dungeonTables.dwellers.length, 12, 'Expected 12 dungeon dwellers');
  assert.equal(world.dungeonTables.distinctiveFeatures.length, 12, 'Expected 12 dungeon distinctive features');
  assert.equal(world.dungeonTables.sampleRooms.length, 24, 'Expected 24 dungeon sample rooms (d4 x d6)');
  assert.equal(world.dungeonTables.trapsAndDevilry.length, 12, 'Expected 12 traps and devilry');

  console.log('MORK BORG SQLite validation passed: all Bare Bones tables verified.');
}

main();
