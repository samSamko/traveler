import type { EntityLink } from '../types.ts';

export const ENTITY_LINKS: EntityLink[] = [
  // Places <-> NPCs
  { from: 'npc:captain_vane', relation: 'commands', to: 'place:cinderford', note: 'Holds the Iron-Vow muster yard at Cinderford Keep.' },
  { from: 'npc:innkeeper_martha', relation: 'tends', to: 'place:cinderford', note: 'Runs the Ashen Flagon hearth inside the timber walls.' },
  { from: 'npc:matron_veyra', relation: 'presides_over', to: 'place:silken_cistern', note: 'Leads the blind weavers above the black aqueduct.' },
  { from: 'npc:sir_vorne_npc', relation: 'guards', to: 'place:crown_watchtower', note: 'Keeps hollow watch on the bronze plinth overlooking the Belfry.' },

  // NPCs <-> Items & Secrets
  { from: 'npc:matron_veyra', relation: 'seeks', to: 'item:echo_shell', note: 'Trades the Seal of Silence for the barrow Echo-Shell.' },
  { from: 'npc:sir_vorne_npc', relation: 'wields', to: 'item:bell_cleaver', note: 'Carries his resonant bronze greatblade at the Crown-Gate.' },
  { from: 'place:weeping_barrow', relation: 'holds', to: 'item:echo_shell', note: 'Rests beside Sir Vorne\'s forgotten oath tablet in the inner crypt.' },
  { from: 'place:weeping_barrow', relation: 'holds', to: 'item:runic_warhammer', note: 'Sealed behind a Durnfolk counterweight chamber.' },
  { from: 'place:drowned_forge', relation: 'holds', to: 'item:basalt_plate', note: 'Locked in the deep armory behind the Basalt Kiln-Warden.' },
  { from: 'place:petrified_starwood', relation: 'holds', to: 'item:star_glaive', note: 'Guarded by the Corrupted Star-Stag in the Heart-Glade.' },

  // Enemies <-> Places & Reagents
  { from: 'enemy:ash_hound', relation: 'prowls', to: 'place:kings_causeway', note: 'Hunts along the broken Imperial flagstones in embers and smoke.' },
  { from: 'enemy:ash_hound', relation: 'yields', to: 'item:ash_resin', note: 'Scorched hide often carries volatile ember-resin.' },
  { from: 'enemy:root_husk', relation: 'haunts', to: 'place:ash_fen', note: 'Rises wherever pale spores take root in damp earth.' },
  { from: 'enemy:root_husk', relation: 'yields', to: 'item:husk_gland', note: 'Calcified spore sacs form inside hollow ribcages.' },
  { from: 'enemy:chitin_weaver', relation: 'nests_in', to: 'place:ash_fen', note: 'Spins acid silk across drainage flues and sunken vents.' },
  { from: 'enemy:iron_deserter', relation: 'ambushes', to: 'place:kings_causeway', note: 'Stragglers from the frontier levy extract road tolls by force.' },
  { from: 'enemy:blight_acolyte', relation: 'serves', to: 'enemy:malakor', note: 'Swings pale-root censers to amplify the Third Drowning Toll.' },
  { from: 'enemy:star_stag', relation: 'guards', to: 'place:petrified_starwood', note: 'Ancient wood-spirit strangled by chiming pale vines.' },
  { from: 'enemy:forge_automaton', relation: 'guards', to: 'place:drowned_forge', note: 'Ancient basalt construct watching the abyssal sluice-valve.' },
  { from: 'enemy:sir_vorne', relation: 'guards', to: 'place:crown_watchtower', note: 'Tests every traveler approaching the Sunken Belfry from above.' },
  { from: 'enemy:malakor', relation: 'throned_in', to: 'place:sunken_belfry', note: 'Prepares the Third Drowning Toll beneath the drowned bronze bell.' },
  { from: 'enemy:silk_assassin', relation: 'serves', to: 'faction:silken_cistern', note: 'Dispatched if the sacred Vesper-Font is plundered.' },
  { from: 'enemy:husk_kale', relation: 'haunts', to: 'place:kings_causeway', note: 'What remains of the deserter Kale if left to hollow.' },

  // Factions <-> Places
  { from: 'faction:iron_vow', relation: 'based_at', to: 'place:cinderford', note: 'Holds the last standing palisade on the frontier.' },
  { from: 'faction:silken_cistern', relation: 'based_at', to: 'place:silken_cistern', note: 'Maintains the counter-harmonic looms beneath Ash-Fen.' },
  { from: 'faction:under_warren', relation: 'trades_at', to: 'place:cinderford', note: 'Maintains a hidden black-ledger beneath Quartermaster Harken\'s stall.' },
  { from: 'faction:husk_choir', relation: 'based_at', to: 'place:sunken_belfry', note: 'Draws pale roots upward toward Day 14.' },
];

export function getRelatedLinks(entityId: string): EntityLink[] {
  return ENTITY_LINKS.filter((l) => l.from === entityId || l.to === entityId);
}
