import type { Character, CombatEnemy, WeaponDef } from '../types.ts';
import { nextRandom } from '../dice.ts';

export type WeaponClass =
  | 'blade_light'
  | 'blade_heavy'
  | 'blunt'
  | 'polearm'
  | 'ranged'
  | 'unarmed'
  | 'magic';

export type BodyClass =
  | 'humanoid'
  | 'undead'
  | 'beast'
  | 'ooze_plague'
  | 'arcane';

export interface DungeonRiddle {
  id: string;
  prompt: string;
  options: [string, string, string];
  correctIndex: 0 | 1 | 2;
  solveText: string;
  failText: string;
}

export interface RoadVignette {
  id: string;
  regions: string[];
  setup: string;
  actLabel: string;
  actCheck: 'presence' | 'agility' | 'strength' | 'toughness';
  actDr: number;
  actSuccessText: string;
  actFailText: string;
  rewardSilver?: number;
  rewardRation?: number;
  failDamageDie?: string;
  bypassLabel: string;
  bypassText: string;
}

function pick<T>(items: readonly T[], rngState?: { rngState: number }): T {
  const idx = Math.floor(nextRandom(rngState) * items.length) % items.length;
  return items[idx];
}

export function classifyWeapon(weapon: WeaponDef | null): WeaponClass {
  if (!weapon || weapon.id === 'unarmed') return 'unarmed';
  if (weapon.ranged || /bow|crossbow|sling|musket|pistol|dart/i.test(weapon.name)) return 'ranged';
  if (/staff|wand|scroll|censer/i.test(weapon.name)) return 'magic';
  if (/spear|halberd|pike|glaive|trident|pole/i.test(weapon.name)) return 'polearm';
  if (/maul|hammer|flail|mace|club|cudgel|femur|morningstar/i.test(weapon.name)) return 'blunt';
  if (/zweih|greatsword|claymore|longsword|axe|cleaver|scimitar/i.test(weapon.name)) return 'blade_heavy';
  if (/dagger|knife|shortsword|rapier|blade|hook|shiv/i.test(weapon.name)) return 'blade_light';
  return weapon.damageDie === 'd8' || weapon.damageDie === 'd10' ? 'blade_heavy' : 'blade_light';
}

export function classifyBody(enemy: CombatEnemy): BodyClass {
  const id = enemy.creatureId.toLowerCase();
  const name = enemy.name.toLowerCase();
  if (/skeleton|zombie|lich|wraith|ghoul|margrave|drowned|undead|bone|skull/.test(id + ' ' + name)) return 'undead';
  if (/slime|plague|pustule|rot|gut|worm|grub|carrion/.test(id + ' ' + name)) return 'ooze_plague';
  if (/warlock|archon|hierophant|matriarch|lich|cult|golem|demon|wyvern|basilisk/.test(id + ' ' + name)) return 'arcane';
  if (/wolf|hound|rat|bear|spider|troll|beast|bat|boar|gore/.test(id + ' ' + name)) return 'beast';
  return 'humanoid';
}

export function narratePcHit(
  pc: Character,
  weapon: WeaponDef | null,
  enemy: CombatEnemy,
  damage: number,
  rngState?: { rngState: number },
): string {
  const wClass = classifyWeapon(weapon);
  const bClass = classifyBody(enemy);
  const wName = weapon?.name ?? 'bare fists';

  const byWeapon: Record<WeaponClass, readonly string[]> = {
    blade_light: [
      `${pc.name} slips inside ${enemy.name}'s guard, drawing a quick red ribbon with the ${wName}.`,
      `${pc.name} darts in low, punching the ${wName} into soft tissue.`,
      `A flick of ${pc.name}'s wrist opens a smoking seam across ${enemy.name}.`,
    ],
    blade_heavy: [
      `${pc.name} swings the ${wName} in a heavy arc that bites deep into ${enemy.name}.`,
      `Steel meets meat with a wet crunch as ${pc.name}'s ${wName} carves into ${enemy.name}.`,
      `${pc.name} brings the ${wName} crashing down, staggering ${enemy.name} backward.`,
    ],
    blunt: [
      `${pc.name}'s ${wName} hammers ${enemy.name} with a dull, marrow-shaking thud.`,
      `Bone and gristle give way beneath ${pc.name}'s brutal ${wName} blow.`,
      `${pc.name} drives the ${wName} into ${enemy.name}, snapping posture and breath alike.`,
    ],
    polearm: [
      `${pc.name} lunges from reach, skewering ${enemy.name} on the tip of the ${wName}.`,
      `${pc.name} hooks and thrusts the ${wName}, punching ${enemy.name} back into the gloom.`,
      `The long haft of ${pc.name}'s ${wName} drives iron straight into ${enemy.name}'s flank.`,
    ],
    ranged: [
      `${pc.name}'s shot streaks through the foul air and punches cleanly into ${enemy.name}.`,
      `A sharp snap, and ${pc.name}'s projectile buries itself deep in ${enemy.name}.`,
      `${pc.name} looses into the press, clipping ${enemy.name} through a gap in its guard.`,
    ],
    unarmed: [
      `${pc.name} slams knuckles and heel into ${enemy.name}, bruising flesh and pride.`,
      `${pc.name} grapples close, driving a desperate elbow straight into ${enemy.name}.`,
      `${pc.name} tears at ${enemy.name} with bare, bloodied hands.`,
    ],
    magic: [
      `${pc.name} lashes out with the ${wName}, scorched sparks biting into ${enemy.name}.`,
      `Black static crackles off ${pc.name}'s ${wName}, bruising ${enemy.name} from within.`,
    ],
  };

  const bodySuffix: Record<BodyClass, readonly string[]> = {
    humanoid: ['Dark blood spatters the flagstone.', 'It snarls through clenched teeth.', ''],
    undead: ['Dry dust and marrow chips burst free.', 'Yellowed bone splinters under the impact.', ''],
    beast: ['Thick hide parts, oozing steaming crimson.', 'It thrashes with a ragged, bestial shriek.', ''],
    ooze_plague: ['Vile ichor splatters across boots and stone.', 'Blisters rupture in a sour hiss.', ''],
    arcane: ['Unnatural ash flakes from the wound.', 'Foul light flickers where the blow lands.', ''],
  };

  const base = pick(byWeapon[wClass], rngState);
  const tail = pick(bodySuffix[bClass], rngState);
  return tail ? `${base} ${tail} (-${damage} HP)` : `${base} (-${damage} HP)`;
}

export function narratePcCrit(
  pc: Character,
  weapon: WeaponDef | null,
  enemy: CombatEnemy,
  damage: number,
  rngState?: { rngState: number },
): string {
  const wName = weapon?.name ?? 'bare hands';
  const lines = [
    `CRIT! ${pc.name} finds the hollow behind ${enemy.name}'s guard — the ${wName} buries to the hilt (-${damage} HP)!`,
    `CRIT! A pitiless strike from ${pc.name}'s ${wName} caves in ${enemy.name}'s stance (-${damage} HP)!`,
    `CRIT! ${pc.name} tears right through ${enemy.name}'s defense with the ${wName}, doubling the ruin (-${damage} HP)!`,
  ];
  return pick(lines, rngState);
}

export function narratePcMiss(
  pc: Character,
  weapon: WeaponDef | null,
  enemy: CombatEnemy,
  rngState?: { rngState: number },
): string {
  const wClass = classifyWeapon(weapon);
  const wName = weapon?.name ?? 'fists';
  if (wClass === 'ranged') {
    return pick([
      `${pc.name}'s shot skitters off damp stone, showering sparks beside ${enemy.name}.`,
      `${enemy.name} jerks aside at the last heartbeat; ${pc.name}'s bolt vanishes into the dark.`,
    ], rngState);
  }
  return pick([
    `${pc.name}'s ${wName} whistles wide through foul air as ${enemy.name} twists clear.`,
    `${enemy.name} bats ${pc.name}'s ${wName} aside in a shower of sparks.`,
    `${pc.name} overextends on slick filth; the ${wName} bites only shadow.`,
  ], rngState);
}

export function narratePcFumble(
  pc: Character,
  weapon: WeaponDef | null,
  enemy: CombatEnemy,
  rngState?: { rngState: number },
): string {
  const wName = weapon?.name ?? 'grip';
  return pick([
    `FUMBLE! ${pc.name}'s ${wName} catches in bone or stone — the weapon wrenches free and defense collapses!`,
    `FUMBLE! ${pc.name} slips in dark grease before ${enemy.name}, losing both footing and weapon!`,
  ], rngState);
}

export function narratePcKill(
  pc: Character,
  weapon: WeaponDef | null,
  enemy: CombatEnemy,
  rngState?: { rngState: number },
): string {
  const bClass = classifyBody(enemy);
  const wName = weapon?.name ?? 'bare hands';
  const byBody: Record<BodyClass, readonly string[]> = {
    humanoid: [
      `${enemy.name} folds over ${pc.name}'s ${wName}, choking out a wet rattle as it hits the floor.`,
      `${pc.name} ends ${enemy.name} cleanly; boots twitch once in spreading mire and go still.`,
    ],
    undead: [
      `${enemy.name} shatters into yellowed ribs and ash beneath ${pc.name}'s ${wName}.`,
      `The unnatural spark behind ${enemy.name}'s eyes gutters out; dead bones clatter flat.`,
    ],
    beast: [
      `${pc.name} drops ${enemy.name} mid-lunge; the beast skids across stone in a steaming pool.`,
      `${enemy.name}'s final snarl snaps off abruptly under ${pc.name}'s ${wName}.`,
    ],
    ooze_plague: [
      `${enemy.name} bursts apart into foul sludge and inert filth at ${pc.name}'s feet.`,
      `Rot and bile drain out of ${enemy.name} until nothing moves in the puddle.`,
    ],
    arcane: [
      `${enemy.name} collapses in a hiss of scorched ozone and black soot under ${pc.name}'s ${wName}.`,
      `Whatever tether held ${enemy.name} upright snaps; its husk drops lifeless to the stone.`,
    ],
  };
  return pick(byBody[bClass], rngState);
}

export function narrateEnemyHit(
  enemy: CombatEnemy,
  targetName: string,
  finalDmg: number,
  absorbed: number,
  rngState?: { rngState: number },
): string {
  const bClass = classifyBody(enemy);
  const verbs: Record<BodyClass, readonly string[]> = {
    humanoid: ['slashes', 'hacks', 'drives corroded iron into'],
    undead: ['rakes yellowed talons across', 'batters', 'tears at'],
    beast: ['snaps dripping jaws onto', 'mauls', 'gores'],
    ooze_plague: ['lashes acidic filth over', 'slams putrid mass against', 'scalds'],
    arcane: ['lashes black force into', 'rends', 'strikes'],
  };
  const verb = pick(verbs[bClass], rngState);
  const armorNote = absorbed > 0 ? ` (${absorbed} soaked by armor)` : '';
  return `${enemy.name} ${verb} ${targetName} for ${finalDmg} dmg${armorNote}!`;
}

export function narratePcDodge(
  pc: Character,
  enemy: CombatEnemy,
  rngState?: { rngState: number },
): string {
  return pick([
    `${pc.name} ducks low beneath ${enemy.name}'s wild swing; stale wind parts their hair.`,
    `${pc.name} sidesteps in slick mud, letting ${enemy.name}'s blow crash harmlessly into stone.`,
    `${pc.name} twists clear by a fingernail as ${enemy.name} lunges past.`,
  ], rngState);
}

export function narrateArmorSoak(
  pc: Character,
  enemy: CombatEnemy,
  rngState?: { rngState: number },
): string {
  return pick([
    `${enemy.name}'s blow skids shrieking across ${pc.name}'s plates without drawing blood.`,
    `${pc.name}'s armor eats the whole shock — battered leather and iron hold fast.`,
  ], rngState);
}

export const DUNGEON_RIDDLES: readonly DungeonRiddle[] = [
  {
    id: 'riddle_coffin',
    prompt: 'The iron door whispers from rusted rivets: "Who makes me has no use for me; who buys me never keeps me; who uses me never sees me."',
    options: ['A coffin', 'A lantern', 'A silver coin'],
    correctIndex: 0,
    solveText: 'The coffin latch clicks like a breaking jaw. The iron door swings open.',
    failText: 'Frosty iron screams against your palms as false runes flare.',
  },
  {
    id: 'riddle_shadow',
    prompt: 'A stone mouth demands in hollow rasps: "I dog your boots by torchlight, vanish in the pitch black, and cannot bleed when pierced."',
    options: ['A hound', 'A shadow', 'A leech'],
    correctIndex: 1,
    solveText: 'The stone jaw unhinges in silence, yielding the passage.',
    failText: 'Ash belches from the mouth, searing lungs and skin.',
  },
  {
    id: 'riddle_fire',
    prompt: 'Scorched brass letters ask: "Feed me dry timber and I grow fat and bright; pour me water and I die in black smoke."',
    options: ['Mold', 'Rust', 'Fire'],
    correctIndex: 2,
    solveText: 'Cinders drop inward as the bolt slides clear.',
    failText: 'Red-hot brass bites back across your knuckles.',
  },
  {
    id: 'riddle_silence',
    prompt: 'A weeping angel statue bears an inscription: "Say my name aloud and you have already broken me."',
    options: ['Silence', 'Oath', 'Mercy'],
    correctIndex: 0,
    solveText: 'You trace "Silence" across the dusty stone without a sound. The lock yields.',
    failText: 'A bell tolls inside your skull, bursting capillary blood.',
  },
  {
    id: 'riddle_worm',
    prompt: 'Carved ribs frame a slate plaque: "Kings and beggars alike feed me at the last, though I have neither coin nor crown."',
    options: ['The graveworm', 'The taxman', 'The sea'],
    correctIndex: 0,
    solveText: 'The rib-bars grind apart, opening the way.',
    failText: 'Jagged bone spurs snap shut on your wrist.',
  },
  {
    id: 'riddle_salt',
    prompt: 'Damp slate bears faded chalk: "Born of the dead sea, I preserve meat yet poison the well; I fall from weeping eyes."',
    options: ['Bile', 'Salt', 'Ash'],
    correctIndex: 1,
    solveText: 'Brine crystals crumble away from the keyhole. The bar drops.',
    failText: 'Bitter static shocks you back a pace.',
  },
  {
    id: 'riddle_bell',
    prompt: 'A tongue-less bronze head asks: "I have a throat and a heavy tongue, yet I speak only when struck with iron."',
    options: ['A drum', 'A bell', 'A beggar'],
    correctIndex: 1,
    solveText: 'A faint chime rings once behind the stone and the seal releases.',
    failText: 'A deafening clang bruises your ribs.',
  },
  {
    id: 'riddle_breath',
    prompt: 'Frosted glass frames an engraving: "Invisible as a ghost, warmer than stone, the last thing a hanged man parts with."',
    options: ['Gold', 'Pride', 'Breath'],
    correctIndex: 2,
    solveText: 'The frosted glass fogs and slides downward into the sill.',
    failText: 'Cold knives of air slash across your fingers.',
  },
  {
    id: 'riddle_ash',
    prompt: 'Cinder-stained lintels ask: "I am the only coin the pyre leaves behind, gray as winter sky and lighter than chaff."',
    options: ['Ash', 'Lead', 'Glass'],
    correctIndex: 0,
    solveText: 'Charred bolts crumble cleanly, unbarring the threshold.',
    failText: 'A burst of soot and sparks blisters your face.',
  },
  {
    id: 'riddle_key',
    prompt: 'An oil-slicked bronze plate reads: "I have teeth that never chew, turn in darkness without eyes, and open what prayers cannot."',
    options: ['A saw', 'A key', 'A trap'],
    correctIndex: 1,
    solveText: 'Tumblers clatter home inside the door frame.',
    failText: 'Spring-needles jab from the bronze plate.',
  },
];

export const ROAD_VIGNETTES: readonly RoadVignette[] = [
  {
    id: 'galgenbeck_toll_cart',
    regions: ['galgenbeck', 'graven_tosk', 'bergen_chrypt'],
    setup: 'An overturned ink-cart smolders across the sunken flagstones; crow-picked corpses clutch a padlocked strongbox under the axle.',
    actLabel: 'Pry the strongbox clear before scavengers close in (Strength DR12)',
    actCheck: 'strength',
    actDr: 12,
    actSuccessText: 'The rusted hasp snaps! You pocket wet coin and salvage dry rations from the boot.',
    actFailText: 'The axle shifts and crushes your fingers before you yank free empty-handed.',
    rewardSilver: 18,
    rewardRation: 1,
    failDamageDie: 'd4',
    bypassLabel: 'Circle wide through the ditch and leave the dead to the crows',
    bypassText: 'You skirt the cart in silence; only wet wingbeats follow you.',
  },
  {
    id: 'sarkash_lantern_tree',
    regions: ['sarkash', 'graven_tosk'],
    setup: 'Three iron birdcages swing from black pine boughs, one holding a twitching pilgrim lantern still burning green oil.',
    actLabel: 'Cut down the lantern cage cleanly without waking the thicket (Agility DR12)',
    actCheck: 'agility',
    actDr: 12,
    actSuccessText: 'You catch the brass oil-pot before it drops and siphon silver charms from the ribs.',
    actFailText: 'Brittle branches whip back across your face as the cage crashes into brambles.',
    rewardSilver: 14,
    failDamageDie: 'd4',
    bypassLabel: 'Keep heads down and slip past under the moss',
    bypassText: 'The swaying cages creak overhead until the fog swallows them.',
  },
  {
    id: 'kergus_frozen_courier',
    regions: ['kergus', 'bergen_chrypt'],
    setup: 'Half-buried in blue sleet, a frozen Galgenbeck courier kneels upright, ice cementing a wax-sealed pouch to his ribs.',
    actLabel: 'Chip the frozen pouch free without shattering the vials inside (Presence DR12)',
    actCheck: 'presence',
    actDr: 12,
    actSuccessText: 'Warm breath and careful knife-work free dry biscuit and stamped courier silver.',
    actFailText: 'Rime-frost cracks wrong — frostbitten needles sting your palms.',
    rewardSilver: 16,
    rewardRation: 1,
    failDamageDie: 'd3',
    bypassLabel: 'Leave the ice-corpse facing north',
    bypassText: 'Wind erases your bootprints before the corpse leaves sight.',
  },
  {
    id: 'tveland_bone_cairn',
    regions: ['tveland', 'bergen_chrypt'],
    setup: 'Shepherds stacked a mile-cairn of blackened goat skulls; beneath the lowest stone glints a leather satchel and a bloodied copper bell.',
    actLabel: 'Balance the cairn stones while fishing out the satchel (Agility DR12)',
    actCheck: 'agility',
    actDr: 12,
    actSuccessText: 'Not a skull clatters. Inside lie tarnished coins and cured strip-meat.',
    actFailText: 'The skull pile collapses onto your shins with a sickening hollow roar.',
    rewardSilver: 15,
    rewardRation: 1,
    failDamageDie: 'd4',
    bypassLabel: 'Spit toward the cairn and keep walking',
    bypassText: 'The copper bell gives one faint, unprompted ring behind you.',
  },
  {
    id: 'allians_ash_shrine',
    regions: ['allians', 'valley_of_unfortunate_undead'],
    setup: 'Basalt steps sink into gray ash beside a broken Basilisk relief; tarnished alms bowls hold blackened silver and stale wafers.',
    actLabel: 'Read the ward glyphs before sweeping the alms bowls (Presence DR12)',
    actCheck: 'presence',
    actDr: 12,
    actSuccessText: 'You step over the hair-thin salt line and pocket the offerings unscathed.',
    actFailText: 'Ash flares pale green under your heel, blistering through wet boot leather.',
    rewardSilver: 20,
    failDamageDie: 'd4',
    bypassLabel: 'Bow stiffly and march past the relief',
    bypassText: 'Gray dust settles motionless across the empty bowls.',
  },
  {
    id: 'lake_ondra_wreck',
    regions: ['lake_ondra', 'wästland'],
    setup: 'A flat-bottomed salt barge lies ribs-up in black silt; bloated reeds hide an iron tackle box chained to the tiller.',
    actLabel: 'Haul the tackle box out of the sucking mud (Strength DR12)',
    actCheck: 'strength',
    actDr: 12,
    actSuccessText: 'Silt gives up a watertight tin of salted pork and smugglers silver.',
    actFailText: 'A hidden gaff-hook rips through your sleeve as you lose your grip.',
    rewardSilver: 16,
    rewardRation: 1,
    failDamageDie: 'd4',
    bypassLabel: 'Stick to the high gravel dike',
    bypassText: 'Something long and pale turns silently beneath the reed bed.',
  },
  {
    id: 'wastland_flagellant_camp',
    regions: ['wästland', 'valley_of_unfortunate_undead', 'galgenbeck'],
    setup: 'Three ragged flagellants sit around cold ashes, murmuring Misery verses while guarding a cracked lard-crock and copper bowls.',
    actLabel: 'Trade grim omens and bluff them out of spare rations (Presence DR12)',
    actCheck: 'presence',
    actDr: 12,
    actSuccessText: 'Moved by your hollow stare, they press a dry loaf and pennies into your palm.',
    actFailText: 'They shriek "Heresy!" and hurl flint stones before bolting into the scrub.',
    rewardSilver: 10,
    rewardRation: 1,
    failDamageDie: 'd3',
    bypassLabel: 'Pass the ash-ring without meeting their eyes',
    bypassText: 'Their monotone chant fades behind the wind.',
  },
  {
    id: 'universal_gallow_crow',
    regions: [],
    setup: 'A roadside gibbet groans under wet leather; a dead cutpurse clutches a grease-stained pack tangled high in the chains.',
    actLabel: 'Climb the slick gibbet beam and cut the pack loose (Agility DR12)',
    actCheck: 'agility',
    actDr: 12,
    actSuccessText: 'Chains shriek, the leather strap parts, and coin spills into your glove.',
    actFailText: 'A rusted iron link snaps, dumping you hard onto gravel.',
    rewardSilver: 17,
    failDamageDie: 'd4',
    bypassLabel: 'Leave the gibbet swinging in the drizzle',
    bypassText: 'Crows settle back onto the crossbeam before you clear the bend.',
  },
  {
    id: 'universal_plague_well',
    regions: [],
    setup: 'An old stone well wears a wooden quarantine lid nailed shut — yet a pewter bucket sits brimming with wrapped trade-bars on the rim.',
    actLabel: 'Endure the foul miasma long enough to wrench free the trade-bars (Toughness DR12)',
    actCheck: 'toughness',
    actDr: 12,
    actSuccessText: 'You hold your breath through the copper-sweet stench and snatch the silver.',
    actFailText: 'A lungful of gray well-damp leaves you coughing bile by the verge.',
    rewardSilver: 22,
    failDamageDie: 'd4',
    bypassLabel: 'Kick dirt over the well stones and keep moving',
    bypassText: 'Something knocks twice against the underside of the lid.',
  },
  {
    id: 'universal_toll_dog',
    regions: [],
    setup: 'A scarred mastiff wearing a brass spike-collar guards an abandoned mule cart loaded with damp salt sacks.',
    actLabel: 'Stare the starved hound down and ransack the cart box (Presence DR12)',
    actCheck: 'presence',
    actDr: 12,
    actSuccessText: 'The beast slinks under the axle while you claim salt-silver and dried meat.',
    actFailText: 'Yellow fangs tear across your forearm before you vault clear.',
    rewardSilver: 14,
    rewardRation: 1,
    failDamageDie: 'd4',
    bypassLabel: 'Toss pebbles wide and slip past',
    bypassText: 'The mastiff watches with milky eyes without leaving its cart.',
  },
];

export function pickRoadVignette(regionId: string, usedIds: string[], rngState?: { rngState: number }): RoadVignette {
  const regional = ROAD_VIGNETTES.filter(
    (v) => v.regions.includes(regionId) && !usedIds.includes(v.id),
  );
  if (regional.length > 0) return pick(regional, rngState);
  const unused = ROAD_VIGNETTES.filter((v) => !usedIds.includes(v.id));
  if (unused.length > 0) return pick(unused, rngState);
  return pick(ROAD_VIGNETTES, rngState);
}
