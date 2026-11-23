import type { GameState, LocationNode } from '../types.ts';
import { resolveCheck } from '../dice.ts';
import { adjustFaction, hasFlag, pronouns, recordChronicle, setFlag } from '../memory.ts';
import { addItemToInventory, consumeInventoryItem } from '../combat.ts';

function hasItem(state: GameState, itemId: string): boolean {
  return state.player.inventory.some((e) => e.id === itemId && e.qty > 0);
}

export const LOCATIONS: Record<string, LocationNode> = {
  cinderford: {
    id: 'cinderford',
    name: 'Cinderford Keep',
    regionType: 'settlement',
    danger: 0,
    neighbors: ['weeping_barrow', 'kings_causeway', 'ash_fen'],
    asciiPos: { row: 2, col: 0, code: 'CF' },
    description: (state) => {
      if (hasFlag(state, 'cinderford_fallen')) {
        return "Cinderford's timber gate hangs crooked on rusted hinges. Pale tendrils curl out of the granary roof, and the watch-bell lies cracked in gray slush. Only ash-carrion answers the wind.";
      }
      const p = state.player;
      const base =
        'Timber palisades ring a blackened stone keep above the mire. Lanterns swing over the Iron-Vow muster yard, while nervous townsfolk watch the sealed granary near the well.';
      if (p.race === 'grixi') {
        return `${base} Sentries eye your brass-warren satchel warily, though the quartermaster keeps a discreet ledger beneath the counter for Grixi coin.`;
      }
      if (p.race === 'vaelorian') {
        return `${base} Old Imperial eagles still cling to the gate lintel; the garrison treats Vaelorian kin as distant cousins of the old crown.`;
      }
      return base;
    },
    shop: {
      name: 'Cinderford Quartermaster & Black-Ledger',
      keeper: 'Quartermaster Harken',
      greeting: (state) => {
        if (hasFlag(state, 'cinderford_fallen')) {
          return 'Harken is gone; only scattered salvage crates remain in the deserted storehouse.';
        }
        const rationNote = hasFlag(state, 'granary_burned')
          ? ' (Grain is scarce since the granary fire — rations cost +3c.)'
          : '';
        return `Harken taps a notched tally-stick.${rationNote}`;
      },
      items: [
        { itemId: 'poultice', price: 11 },
        { itemId: 'stamina_draught', price: 13 },
        { itemId: 'fire_pot', price: 15 },
        { itemId: 'antitoxin', price: 11 },
        { itemId: 'vesper_tonic', price: 16, underWarrenOnly: true },
        { itemId: 'grixi_loupe', price: 28, underWarrenOnly: true },
        { itemId: 'vesper_needle', price: 52, underWarrenOnly: true },
      ],
    },
    actions: [
      {
        id: 'cf_granary_inspect',
        label: 'Address the Cinderford Granary Crisis (Spore Contamination)',
        tag: 'Quest / Consequence',
        visible: (state) =>
          !hasFlag(state, 'cinderford_fallen') && !hasFlag(state, 'cinderford_saved'),
        resolve: (state) => {
          const p = state.player;
          const canPurifyFree =
            p.race === 'ael_thalor' ||
            p.background === 'root_scholar' ||
            p.background === 'shrine_penitent';

          if (canPurifyFree || hasItem(state, 'vesper_tonic')) {
            if (!canPurifyFree) {
              consumeInventoryItem(state, 'vesper_tonic', 1);
            }
            setFlag(state, 'cinderford_saved', true);
            setFlag(state, 'granary_purified', true);
            adjustFaction(state, 'iron_vow', 2);
            p.crowns += 18;
            p.rations += 2;
            recordChronicle(
              state,
              'Purified Cinderford Granary',
              'Cleansed the infected grain stores without fire, saving the winter harvest.',
              'cinderford',
            );
            return {
              messages: [
                canPurifyFree
                  ? `Drawing on your ${p.race === 'ael_thalor' ? 'Ael-Thalor root-canticle' : 'sacred/occult training'}, you draw the pale spores out into a clay brazier and turn them to harmless grey dust.`
                  : 'You distill your Vesper Tonic across the seed-bins, burning away the pale mycelium while sparing every sack of barley.',
                'The townsfolk weep in relief. Cinderford saves its harvest (+2 Rations, +18 Crowns, +2 Iron-Vow, free Inn beds!).',
              ],
            };
          }

          const check = resolveCheck(state, 'wit', 14, {
            label: 'Granary Quarantine',
            isLoreOrPerception: true,
          });
          if (check.success) {
            setFlag(state, 'cinderford_saved', true);
            setFlag(state, 'granary_purified', true);
            adjustFaction(state, 'iron_vow', 2);
            p.rations += 2;
            p.crowns += 15;
            recordChronicle(
              state,
              'Purified Cinderford Granary',
              'Isolated and purged the spore-blight from the town grain stores.',
              'cinderford',
            );
            return {
              messages: [
                check.logLine,
                'You trace the damp root-vein to a single rotted cask and excise it cleanly before the choir-blight spreads (+2 Rations, +15 Crowns, +2 Iron-Vow).',
              ],
            };
          }

          setFlag(state, 'cinderford_saved', true);
          setFlag(state, 'granary_burned', true);
          adjustFaction(state, 'iron_vow', 1);
          recordChronicle(
            state,
            'Burned Cinderford Granary',
            'Put the contaminated granary to the torch to halt the Husk-Tide.',
            'cinderford',
          );
          return {
            messages: [
              check.logLine,
              'The blight spreads faster than your knife. Forced into grim mercy, you seal the doors and put the granary to the torch.',
              'Cinderford is spared an outbreak (+1 Iron-Vow), but smoke hangs bitter over the yard and ration prices rise (+3c).',
            ],
          };
        },
      },
      {
        id: 'cf_muster_yard',
        label: 'Report to Captain Vane at the Iron-Vow Muster Table',
        tag: 'Sex & Race Reactive',
        visible: (state) => !hasFlag(state, 'cinderford_fallen') && !hasFlag(state, 'vane_visited'),
        resolve: (state) => {
          const p = state.player;
          setFlag(state, 'vane_visited', true);

          if (p.race === 'vaelorian') {
            adjustFaction(state, 'iron_vow', 2);
            p.crowns += 22;
            p.rations += 1;
            recordChronicle(
              state,
              'Imperial Charter at Cinderford',
              'Captain Vane honored your Vaelorian blood-charter with coin and war-provisions.',
              'iron_vow',
            );
            return {
              messages: [
                `Captain Vane salutes the old Vaelorian cut of your brow: "Blood of the Charter! Good to see an Ash-Born ${pronouns(p.sex).kinTitle.toLowerCase()} holding the Reach."`,
                'He presses a levy purse into your palm (+22 Crowns, +1 Ration, +2 Iron-Vow).',
              ],
            };
          }

          if (p.sex === 'male') {
            adjustFaction(state, 'iron_vow', 1);
            p.crowns += 16;
            p.torches += 1;
            recordChronicle(
              state,
              'Mustered with the Iron-Vow',
              'Captain Vane enrolled you as a frontier auxiliary and issued garrison gear.',
              'iron_vow',
            );
            return {
              messages: [
                'Captain Vane sizes up your shoulders across the scarred oak table: "Able men are thin on the road, brother. Take a bounty chit and bring back word from the Watchtower."',
                'You receive a muster advance (+16 Crowns, +1 Torch, +1 Iron-Vow).',
              ],
            };
          }

          const check = resolveCheck(state, 'might', 12, { label: 'Defy Muster Prejudice' });
          if (check.success) {
            adjustFaction(state, 'iron_vow', 2);
            p.crowns += 24;
            p.maxHp += 2;
            p.hp += 2;
            recordChronicle(
              state,
              'Outfaced Captain Vane',
              "Refused dismissal at the patriarchal muster table and won the veterans' fierce respect.",
              'iron_vow',
            );
            return {
              messages: [
                'Captain Vane waves a dismissive gauntlet: "These marches aren\'t a seamstress hall, lass — leave the Watchtower road to sworn men."',
                check.logLine,
                "You slam your weapon flat onto his tally-board, splitting the oak knot beside his thumb. The veterans erupt in rough cheers; Vane grunts and slides over an officer's purse (+24 Crowns, +2 Max HP, +2 Iron-Vow).",
              ],
            };
          }

          adjustFaction(state, 'iron_vow', -1);
          p.crowns += 10;
          return {
            messages: [
              'Captain Vane waves a dismissive gauntlet: "These marches aren\'t a seamstress hall, lass."',
              check.logLine,
              'The table snickers before you turn away, pocketing only a grudging messenger fee (+10 Crowns, -1 Iron-Vow).',
            ],
          };
        },
      },
      {
        id: 'cf_durnfolk_masonry',
        label: "[Durnfolk] Inspect Cinderford Keep's Cracking Curtain-Wall",
        tag: 'Durnfolk Only',
        visible: (state) =>
          state.player.race === 'durnfolk' &&
          !hasFlag(state, 'cinderford_fallen') &&
          !hasFlag(state, 'cf_wall_repaired'),
        resolve: (state) => {
          setFlag(state, 'cf_wall_repaired', true);
          adjustFaction(state, 'iron_vow', 1);
          state.player.crowns += 18;
          return {
            messages: [
              'Your Durnfolk eyes spot settling mortar above the sluice-gate immediately. You wedge basalt shims and instruct the masons in deep-forge bracing.',
              'The master builder gladly pays your guild fee (+18 Crowns, +1 Iron-Vow).',
            ],
          };
        },
      },
      {
        id: 'cf_inn_rest',
        label: 'Rest at the Ashen Flagon Inn (Heals Full, Clears Statuses, +1 Day)',
        tag: 'Inn',
        visible: (state) => !hasFlag(state, 'cinderford_fallen'),
        resolve: (state) => {
          const free = hasFlag(state, 'granary_purified');
          const cost = free ? 0 : 6;
          if (state.player.crowns < cost) {
            return { messages: [`Innkeeper Martha asks for ${cost} Crowns for hearth and broth.`] };
          }
          state.player.crowns -= cost;
          state.player.hp = state.player.maxHp;
          state.player.stamina = state.player.maxStamina;
          state.player.focus = state.player.maxFocus;
          state.player.statuses = [];
          state.player.determinationAvailable = true;
          return {
            advanceDay: 1,
            messages: [
              free
                ? 'Martha waves away your coin — "Cinderford never charges the savior of its bread." Warm stew and deep sleep restore you completely.'
                : `You pay ${cost} Crowns for a straw cot by the peat hearth and wake restored.`,
            ],
          };
        },
      },
    ],
  },

  kings_causeway: {
    id: 'kings_causeway',
    name: "The Old King's Causeway",
    regionType: 'road',
    danger: 1,
    neighbors: ['cinderford', 'petrified_starwood', 'silken_cistern'],
    asciiPos: { row: 2, col: 1, code: 'KC' },
    description: () =>
      'Flagstones wide enough for Imperial war-wagons heave upward where white roots split the mortar. Toppled milestone obelisks bear faded Vaelish edicts beside hanged deserter cages.',
    actions: [
      {
        id: 'kc_forage',
        label: 'Search the Roadside Milestones & Scavenge Supplies',
        resolve: (state) => {
          if (hasFlag(state, 'kc_scavenged')) {
            return { messages: ['Only windblown gravel and broken wagon spokes remain here.'] };
          }
          setFlag(state, 'kc_scavenged', true);
          const check = resolveCheck(state, 'wit', 11, {
            label: 'Read Milestone Ciphers',
            isLoreOrPerception: true,
          });
          if (check.success) {
            state.player.rations += 1;
            state.player.torches += 1;
            state.player.crowns += 8;
            return {
              messages: [
                check.logLine,
                'Beneath a loose keystone you find an emergency courier cache (+1 Ration, +1 Torch, +8 Crowns).',
              ],
            };
          }
          return {
            messages: [
              check.logLine,
              'The weathered moss hides any seam; you find nothing useful.',
            ],
          };
        },
      },
    ],
  },

  weeping_barrow: {
    id: 'weeping_barrow',
    name: 'The Weeping Barrow',
    regionType: 'ruin',
    danger: 2,
    dark: true,
    neighbors: ['cinderford', 'petrified_starwood'],
    asciiPos: { row: 0, col: 0, code: 'WB' },
    description: (state) => {
      const darkNote =
        state.player.heirloom === 'kiln_lantern' || state.player.torches > 0
          ? 'Warm light catches silver Star-Script carved across the weeping lintel.'
          : 'The burial vault yawns in pitch blackness; unlit steps reek of wet bronze.';
      return `An ancient pre-Shattering tumulus weeping iron-stained groundwater down mossy steps. ${darkNote}`;
    },
    actions: [
      {
        id: 'wb_explore_crypt',
        label: 'Explore the Inner Reliquary (Torch/Lantern Recommended)',
        tag: 'Key Lead',
        visible: (state) => !hasFlag(state, 'wb_crypt_cleared'),
        resolve: (state) => {
          const p = state.player;
          const msgs: string[] = [];
          if (p.heirloom === 'kiln_lantern') {
            msgs.push('Your Lantern of the First Kiln bathes the tomb in steady amber light.');
          } else if (p.torches > 0) {
            p.torches -= 1;
            msgs.push('You strike a pitch-torch (-1 Torch), driving back the wet dark.');
          } else {
            msgs.push('In the blind dark, stone splinters slice your shins (-3 HP).');
            p.hp = Math.max(1, p.hp - 3);
          }

          setFlag(state, 'wb_crypt_cleared', true);
          setFlag(state, 'vorne_oath_known', true);
          addItemToInventory(state, 'echo_shell', 1);
          msgs.push(
            'Upon the central sarcophagus rests a silver-inlaid tablet naming Sir Vorne\'s forgotten oath: "Hold the Crown-Gate until the First Bell answers twice — never yield to the Choir."',
          );
          msgs.push('You also recover a Resonant Echo-Shell (+1 Echo-Shell, sought by the Silken Cistern).');

          if (p.race === 'vaelorian' || p.race === 'ael_thalor' || p.background === 'root_scholar') {
            setFlag(state, 'kiln_cipher_learned', true);
            recordChronicle(
              state,
              'Learned the First Kiln Cipher',
              'Translated the pre-Shattering ignition sigils inside the Weeping Barrow.',
              'seal',
            );
            msgs.push(
              `Your ${p.race === 'vaelorian' ? 'High Vaelish lineage' : p.race === 'ael_thalor' ? 'Star-Script mastery' : 'Root-Scholar training'} decodes the scorched altar frieze! You learn the First Kiln Cipher (Counter-Seal unlocked).`,
            );
          } else {
            const check = resolveCheck(state, 'wit', 13, {
              label: 'Decipher Kiln Altar',
              isLoreOrPerception: true,
            });
            msgs.push(check.logLine);
            if (check.success) {
              setFlag(state, 'kiln_cipher_learned', true);
              recordChronicle(
                state,
                'Learned the First Kiln Cipher',
                'Pieced together the pre-Shattering Kiln sigils from the tomb lintel.',
                'seal',
              );
              msgs.push('You copy the First Kiln Cipher into your travel-slate (Counter-Seal unlocked!).');
            } else {
              msgs.push("The broken glyphs elude your grasp, though Vorne's oath tablet is clear.");
            }
          }

          return { messages: msgs };
        },
      },
      {
        id: 'wb_durnfolk_vault',
        label: '[Durnfolk] Trigger the Hidden Basalt Counterweight Vault',
        tag: 'Durnfolk Only',
        visible: (state) => state.player.race === 'durnfolk' && !hasFlag(state, 'wb_dwarf_vault'),
        resolve: (state) => {
          setFlag(state, 'wb_dwarf_vault', true);
          addItemToInventory(state, 'runic_warhammer', 1);
          state.player.crowns += 20;
          recordChronicle(
            state,
            'Opened Barrow Vault',
            'Sprang an ancestral Durnfolk counterweight chamber inside the Weeping Barrow.',
            'durnfolk',
          );
          return {
            messages: [
              'Tapping the third lintel with your knuckle, you hear a hollow stone pin drop into place. A hidden alcove rotates open!',
              'Inside lies a Khaz-Durn Runic Warhammer and 20 ancient Crowns!',
            ],
          };
        },
      },
    ],
  },

  ash_fen: {
    id: 'ash_fen',
    name: 'The Ash-Fen & Spore-Mire',
    regionType: 'road',
    danger: 2,
    neighbors: ['cinderford', 'silken_cistern'],
    asciiPos: { row: 4, col: 0, code: 'AF' },
    description: () =>
      'Knee-deep gray bog dotted with sunken stone lanterns and pale, bell-shaped fungi. Beneath the cattails, an ancient stone culvert leads downward toward the Silken Cistern.',
    actions: [
      {
        id: 'af_grixi_salvage',
        label: '[Grixi] Skim the Mire-Vents for Volatile Alchemy & Salvage',
        tag: 'Grixi Only',
        visible: (state) => state.player.race === 'grixi' && !hasFlag(state, 'af_grixi_skimmed'),
        resolve: (state) => {
          setFlag(state, 'af_grixi_skimmed', true);
          addItemToInventory(state, 'fire_pot', 1);
          addItemToInventory(state, 'antitoxin', 1);
          state.player.crowns += 16;
          return {
            messages: [
              'Knowing the Under-Warren drainage traps by smell alone, you fish out an intact brass canister (+1 Fire-Pot, +1 Antitoxin, +16 Crowns).',
            ],
          };
        },
      },
      {
        id: 'af_wade_shrine',
        label: 'Search the Sunken Wayfarer Shrine in the Mire',
        visible: (state) => !hasFlag(state, 'af_shrine_done'),
        resolve: (state) => {
          setFlag(state, 'af_shrine_done', true);
          const check = resolveCheck(state, 'agility', 12, { label: 'Cross Bog Stepping-Stones' });
          if (check.success) {
            addItemToInventory(state, 'poultice', 1);
            state.player.focus = Math.min(state.player.maxFocus, state.player.focus + 3);
            return {
              messages: [
                check.logLine,
                'You leap cleanly across the bone-white stones and claim a dry offering satchel (+1 Poultice, +3 Focus).',
              ],
            };
          }
          state.player.hp = Math.max(1, state.player.hp - 4);
          return {
            messages: [
              check.logLine,
              'A slab tilts into freezing mire; thorn-leeches tear your calf (-4 HP) before you scramble back.',
            ],
          };
        },
      },
    ],
  },

  silken_cistern: {
    id: 'silken_cistern',
    name: 'The Silken Cistern',
    regionType: 'sanctuary',
    danger: 1,
    neighbors: ['ash_fen', 'kings_causeway', 'drowned_forge'],
    asciiPos: { row: 4, col: 1, code: 'SC' },
    description: (state) => {
      const p = state.player;
      if (hasFlag(state, 'stole_cistern_vesper')) {
        return 'The vast underground aqueduct stands dead silent. White silk curtains hang slashed, and the drained Vesper-Font weeps bitter mist.';
      }
      if (p.sex === 'female') {
        return 'Vast subterranean vaults draped in pale luminous spider-silk above mirror-still black water. The blind Matrons incline their veiled heads toward you in quiet sisterhood.';
      }
      return 'Vast subterranean vaults draped in pale luminous spider-silk above mirror-still black water. Blind Matrons stand rigid beside the Loom-Gate, turning sightless faces toward your masculine footstep.';
    },
    shop: {
      name: 'Cistern Loom-Apothecary',
      keeper: 'Sister Orla',
      greeting: (state) =>
        hasFlag(state, 'stole_cistern_vesper')
          ? 'The stalls are abandoned and cursed.'
          : state.player.sex === 'female'
            ? '"Peace to your step, Sister. Take what helps silence the Choir."'
            : '"Speak your business briefly, stranger, and touch no loom-thread."',
      items: [
        { itemId: 'vesper_tonic', price: 14 },
        { itemId: 'antitoxin', price: 10 },
        { itemId: 'chitin_mantle', price: 46 },
        { itemId: 'silken_veil', price: 42 },
      ],
    },
    actions: [
      {
        id: 'sc_audience',
        label: "Seek the Matrons' Audience & the Seal of Silence",
        tag: 'Sex & Race Reactive / Seal',
        visible: (state) =>
          !hasFlag(state, 'stole_cistern_vesper') && !hasFlag(state, 'seal_of_silence'),
        resolve: (state) => {
          const p = state.player;
          const hasShell = hasItem(state, 'echo_shell');

          if (hasShell) {
            consumeInventoryItem(state, 'echo_shell', 1);
            setFlag(state, 'seal_of_silence', true);
            adjustFaction(state, 'silken_cistern', 3);
            p.maxFocus += 1;
            p.focus = p.maxFocus;
            recordChronicle(
              state,
              'Earned the Seal of Silence',
              'Returned the Resonant Echo-Shell to the blind Matrons and received their counter-harmonic Seal.',
              'seal',
            );
            return {
              messages: [
                `You lay the Resonant Echo-Shell onto the Loom-Altar. Matron Veyra gasps: "The barrow's lost voice! Whatever your blood, ${pronouns(p.sex).formal}, you keep faith with the deep waters."`,
                "She binds a silver thread around your wrist: Seal of Silence acquired (+1 Max Focus, +3 Cistern, weakens Malakor's Drowning Toll!).",
              ],
            };
          }

          if (p.sex === 'female') {
            adjustFaction(state, 'silken_cistern', 1);
            const check = resolveCheck(state, 'wit', 11, {
              label: 'Unveiled Sisterhood Rite',
              isLoreOrPerception: true,
            });
            if (check.success) {
              setFlag(state, 'seal_of_silence', true);
              recordChronicle(
                state,
                'Earned the Seal of Silence',
                'Passed the Unveiled Sisterhood rite before the Matrons of the Silken Cistern.',
                'seal',
              );
              return {
                messages: [
                  'Matron Veyra welcomes you past the inner veil: "Sister, let us hear whether your breath carries the Root\'s falsehood or the quiet water."',
                  check.logLine,
                  'Your pulse steadies the silk basin. You receive the Seal of Silence (Counter-Seal unlocked!).',
                ],
              };
            }
            return {
              messages: [
                'Matron Veyra welcomes you as Sister, though the silk trembles during the listening rite.',
                check.logLine,
                '"Bring us the Echo-Shell from the Weeping Barrow, Sister, or return when your spirit stills."',
              ],
            };
          }

          if (p.race === 'ael_thalor' || p.background === 'shrine_penitent') {
            const check = resolveCheck(state, 'grit', 13, {
              label: 'Canticle at the Silk Threshold',
              isLoreOrPerception: true,
            });
            if (check.success) {
              setFlag(state, 'seal_of_silence', true);
              adjustFaction(state, 'silken_cistern', 2);
              recordChronicle(
                state,
                'Earned the Seal of Silence',
                "Won the Matrons' rare trust through ancient liturgy despite their distrust of men.",
                'seal',
              );
              return {
                messages: [
                  'The Matrons bar the bridge against a male intruder until you intone the pre-Shattering water-liturgy.',
                  check.logLine,
                  'Veyra bows slightly: "An unbroken tongue in an age of noise. Take the Seal of Silence."',
                ],
              };
            }
            return {
              messages: [
                check.logLine,
                'The Matrons turn their blind heads away. "Return with the Weeping Barrow\'s Echo-Shell, man, or spill blood upon the threshold to prove your oath."',
              ],
            };
          }

          if (p.hp > 6) {
            const check = resolveCheck(state, 'grit', 14, { label: 'Blood-Oath on the Loom' });
            p.hp -= 5;
            if (check.success) {
              setFlag(state, 'seal_of_silence', true);
              adjustFaction(state, 'silken_cistern', 1);
              recordChronicle(
                state,
                'Blood-Oath of the Cistern',
                'Spilled your own blood upon the Loom-threshold to earn the Seal of Silence.',
                'seal',
              );
              return {
                messages: [
                  '"No man crosses unbled," Matron Veyra decrees. You draw steel across your palm (-5 HP).',
                  check.logLine,
                  'Your blood sinks cleanly without waking the Choir-spores. You receive the Seal of Silence!',
                ],
              };
            }
            return {
              messages: [
                'You cut your palm (-5 HP), yet the dark water ripples angrily.',
                check.logLine,
                '"Not enough. Bring the Echo-Shell from the Weeping Barrow."',
              ],
            };
          }

          return {
            messages: ["You are too wounded to attempt the Matrons' Blood-Oath safely."],
          };
        },
      },
      {
        id: 'sc_steal_font',
        label: 'Desecrate & Drain the Sacred Vesper-Font (Risky Power vs Cistern Wrath)',
        tag: 'Dark Choice',
        visible: (state) => !hasFlag(state, 'stole_cistern_vesper'),
        resolve: (state) => {
          setFlag(state, 'stole_cistern_vesper', true);
          adjustFaction(state, 'silken_cistern', -5);
          adjustFaction(state, 'husk_choir', 2);
          state.player.maxFocus += 2;
          state.player.focus = state.player.maxFocus;
          state.player.crowns += 45;
          recordChronicle(
            state,
            'Plundered the Vesper-Font',
            'Siphoned the sacred cistern amber, turning the blind Matrons into mortal enemies.',
            'dark',
          );
          return {
            messages: [
              'While the watchers chant, you shatter the silver basin and siphon pure soul-amber into your flask (+2 Max Focus, +45 Crowns, +2 Choir Resonance)!',
              'Behind you, the Matrons scream in a single discordant voice — Silk-Vengeance assassins now hunt your trail (-5 Silken Cistern).',
            ],
          };
        },
      },
      {
        id: 'sc_pool_rest',
        label: 'Bathe in the Quiet Cistern Waters (Heal 12 HP & Full Focus, +1 Day)',
        visible: (state) => !hasFlag(state, 'stole_cistern_vesper'),
        resolve: (state) => {
          state.player.hp = Math.min(state.player.maxHp, state.player.hp + 12);
          state.player.focus = state.player.maxFocus;
          state.player.stamina = state.player.maxStamina;
          state.player.statuses = [];
          return {
            advanceDay: 1,
            messages: ['Cool subterranean water washes away fatigue and root-spores (+12 HP, Full Focus/Stamina).'],
          };
        },
      },
    ],
  },

  petrified_starwood: {
    id: 'petrified_starwood',
    name: 'The Petrified Star-Wood',
    regionType: 'ruin',
    danger: 2,
    neighbors: ['weeping_barrow', 'kings_causeway', 'crown_watchtower'],
    asciiPos: { row: 0, col: 1, code: 'SW' },
    description: (state) => {
      if (state.player.race === 'ael_thalor') {
        return "Colossal ivory-stone trunks spiral toward a pale sky — your exiled kin's ancient home, now strangled by vibrating pale root-veins.";
      }
      return 'Fossilized white trunks tower like cathedral ribs. Pale blossoms chime faintly when the wind brushes them, and antlers scrape somewhere in the silver brush.';
    },
    actions: [
      {
        id: 'sw_star_stag',
        label: 'Confront the Corrupted Star-Stag at the Heart-Glade',
        tag: 'Elite / Race Reactive',
        visible: (state) => !hasFlag(state, 'star_stag_resolved'),
        resolve: (state) => {
          if (state.player.race === 'ael_thalor') {
            setFlag(state, 'star_stag_resolved', true);
            addItemToInventory(state, 'star_glaive', 1);
            state.player.maxFocus += 1;
            recordChronicle(
              state,
              'Calmed the Star-Stag',
              'Sang the Ael-Thalor Memory-Canticle to free the Star-Stag without bloodshed.',
              'ael_thalor',
            );
            return {
              messages: [
                '[Ael-Thalor] You kneel and sing the elder Memory-Canticle. The great Star-Stag halts mid-charge, shaking the choking pale vines from its silver rack.',
                'Bowing its head, it leaves a Silver Star-Glaive embedded in the mossy plinth (+1 Star-Glaive, +1 Max Focus).',
              ],
            };
          }

          return {
            messages: [
              'A towering stag plated in chalky bark bursts from the petrified ferns, pale chimes rattling from its antlers!',
            ],
            startCombat: {
              enemyId: 'star_stag',
              canFlee: true,
              onVictoryFlag: 'star_stag_resolved',
              onVictoryChronicle: {
                title: 'Felled the Star-Stag',
                summary: 'Slew the corrupted guardian of the Petrified Star-Wood.',
                tag: 'combat',
              },
            },
          };
        },
      },
      {
        id: 'sw_sever_conduit',
        label: 'Sever the Western Pale-Root Conduit',
        tag: 'Counter-Seal',
        visible: (state) => !hasFlag(state, 'root_conduit_severed'),
        resolve: (state) => {
          const p = state.player;
          if (p.abilities.includes('kiln_spark') || p.abilities.includes('cinder_brand') || hasItem(state, 'fire_pot')) {
            if (!p.abilities.includes('kiln_spark') && !p.abilities.includes('cinder_brand')) {
              consumeInventoryItem(state, 'fire_pot', 1);
            }
            setFlag(state, 'root_conduit_severed', true);
            recordChronicle(
              state,
              'Severed Root Conduit',
              'Burned out the pulsing Pale-Root taproot beneath the Petrified Star-Wood.',
              'seal',
            );
            return {
              messages: [
                "Flame tears into the throbbing pale taproot! The forest shudders as the Belfry's outer armor-conduit snaps (Counter-Seal unlocked!).",
              ],
            };
          }

          const check = resolveCheck(state, 'might', 14, { label: 'Hack Through Root-Core' });
          if (check.success) {
            setFlag(state, 'root_conduit_severed', true);
            recordChronicle(
              state,
              'Severed Root Conduit',
              'Hacked apart the Pale-Root conduit beneath the Star-Wood.',
              'seal',
            );
            return {
              messages: [
                check.logLine,
                "With brutal strokes you sever the pulsing conduit! Sap sprays across the snow as Malakor's root-aegis weakens (Counter-Seal unlocked!).",
              ],
            };
          }

          p.hp = Math.max(1, p.hp - 5);
          return {
            messages: [
              check.logLine,
              'The iron-hard root snaps back, whipping your shoulder (-5 HP). Fire or greater strength is needed.',
            ],
          };
        },
      },
    ],
  },

  drowned_forge: {
    id: 'drowned_forge',
    name: 'The Drowned Forge-Vault',
    regionType: 'ruin',
    danger: 3,
    dark: true,
    neighbors: ['silken_cistern', 'sunken_belfry'],
    asciiPos: { row: 4, col: 2, code: 'DF' },
    description: () =>
      'Flooded basalt halls built by the Durnfolk before the Kiln shattered. Half-submerged anvils glow faintly under sluggish steam while an iron sluice-wheel hums behind a watchful bronze sentinel.',
    actions: [
      {
        id: 'df_warden',
        label: 'Confront or Bypass the Basalt Kiln-Warden',
        tag: 'Elite / Race Reactive',
        visible: (state) => !hasFlag(state, 'forge_cleared'),
        resolve: (state) => {
          const p = state.player;
          if (p.race === 'durnfolk') {
            setFlag(state, 'forge_cleared', true);
            addItemToInventory(state, 'basalt_plate', 1);
            recordChronicle(
              state,
              'Commanded the Forge-Warden',
              'Used ancestral Durnfolk master-signs to stand down the Basalt Kiln-Warden peacefully.',
              'durnfolk',
            );
            return {
              messages: [
                '[Durnfolk] You rap the ancient guild-cadence twice upon your helm. The towering Basalt Kiln-Warden kneels in grinding stone deference, opening the armory locker (+1 Basalt-Kiln Cuirass!).',
              ],
            };
          }
          if (p.race === 'grixi') {
            const check = resolveCheck(state, 'agility', 12, {
              label: 'Slip Chitin-Flue Bypass',
              isCraftOrStealth: true,
            });
            if (check.success) {
              setFlag(state, 'forge_cleared', true);
              addItemToInventory(state, 'basalt_plate', 1);
              return {
                messages: [
                  check.logLine,
                  '[Grixi] You wriggle through the ash-exhaust duct behind the golem, pull its pressure pin, and loot the Basalt-Kiln Cuirass without waking it!',
                ],
              };
            }
          }

          return {
            messages: ['Steam hisses from copper joints as the Basalt Kiln-Warden lurches forward with a furnace hammer!'],
            startCombat: {
              enemyId: 'forge_automaton',
              canFlee: true,
              onVictoryFlag: 'forge_cleared',
              onVictoryChronicle: {
                title: 'Shattered the Kiln-Warden',
                summary: 'Defeated the ancient Durnfolk automaton inside the Drowned Forge-Vault.',
                tag: 'combat',
              },
            },
          };
        },
      },
      {
        id: 'df_hone_weapon',
        label: 'Hone Your Equipped Weapon at the Glowing Runic Brazier',
        visible: (state) => hasFlag(state, 'forge_cleared') && !state.player.weaponHoned,
        resolve: (state) => {
          state.player.weaponHoned = true;
          return {
            messages: [
              'You draw your weapon across the warm basalt whetstone. Sparks of old Kiln-steel kiss the edge (+1 permanent Weapon Damage!).',
            ],
          };
        },
      },
      {
        id: 'df_drain_conduit',
        label: 'Shut the Sluice-Valve & Choke the Abyssal Root-Conduit',
        tag: 'Counter-Seal',
        visible: (state) => hasFlag(state, 'forge_cleared') && !hasFlag(state, 'root_conduit_severed'),
        resolve: (state) => {
          setFlag(state, 'root_conduit_severed', true);
          recordChronicle(
            state,
            'Choked Deep Root Conduit',
            "Closed the flooded Durnfolk sluice-valves, starving Malakor's root-shield.",
            'seal',
          );
          return {
            messages: [
              "You haul the heavy bronze wheel shut. Superheated brine floods the lower root-shaft, crippling Malakor's Belfry Aegis (Counter-Seal unlocked!).",
            ],
          };
        },
      },
    ],
  },

  crown_watchtower: {
    id: 'crown_watchtower',
    name: 'Crown-Gate Watchtower',
    regionType: 'ruin',
    danger: 3,
    neighbors: ['petrified_starwood', 'sunken_belfry'],
    asciiPos: { row: 0, col: 2, code: 'CW' },
    description: (state) => {
      if (hasFlag(state, 'vorne_resolved')) {
        return 'Wind howls through the ruined gate-arch overlooking the Sunken Belfry below. An empty bronze chair faces the chasm.';
      }
      return 'A shattered parapet overlooking the abyssal crater of the Sunken Belfry. On a bronze plinth sits Sir Vorne, the Bell-Knight, motionless save for the slow ring of his helm in the wind.';
    },
    actions: [
      {
        id: 'cw_vorne',
        label: 'Approach Sir Vorne, the Hollowed Bell-Knight',
        tag: 'Mini-Boss / Memory Reactive',
        visible: (state) => !hasFlag(state, 'vorne_resolved'),
        resolve: (state) => {
          const p = state.player;
          if (hasFlag(state, 'vorne_oath_known')) {
            setFlag(state, 'vorne_resolved', true);
            setFlag(state, 'vorne_redeemed', true);
            addItemToInventory(state, 'bell_cleaver', 1);
            recordChronicle(
              state,
              'Redeemed Sir Vorne',
              'Spoke the forgotten Weeping Barrow oath, freeing Sir Vorne to strike at the Belfry steps.',
              'vorne',
            );
            return {
              messages: [
                'Sir Vorne rises slowly, bell-helm groaning — until you recite the exact oath engraved in the Weeping Barrow.',
                "He freezes. A long, rusted sigh escapes his visor: \"The First Bell... I kept the gate.\" He presses his Bell-Cleaver into your hands and descends toward the Belfry bridge to break Malakor's guard (+1 Vorne's Bell-Cleaver!).",
              ],
            };
          }

          if (p.race === 'vaelorian' || p.background === 'ashen_blade') {
            const check = resolveCheck(state, 'grit', 14, {
              label: 'Challenge Knightly Oath',
            });
            if (check.success) {
              setFlag(state, 'vorne_resolved', true);
              setFlag(state, 'vorne_redeemed', true);
              addItemToInventory(state, 'bell_cleaver', 1);
              recordChronicle(
                state,
                'Redeemed Sir Vorne',
                'Recalled Sir Vorne to knightly honor at the Crown-Gate Watchtower.',
                'vorne',
              );
              return {
                messages: [
                  check.logLine,
                  "You stand unyielding and utter the Vaelish knight's dismissal. Sir Vorne lowers his blade, yields his Bell-Cleaver, and pledges his final charge to break Malakor's choir.",
                ],
              };
            }
          }

          return {
            messages: ['"None pass the Crown-Gate unweighed," Sir Vorne rumbles, hoisting his massive Bell-Cleaver!'],
            startCombat: {
              enemyId: 'sir_vorne',
              canFlee: true,
              onVictoryFlag: 'vorne_resolved',
              onVictoryChronicle: {
                title: 'Slain Sir Vorne',
                summary: 'Defeated Sir Vorne, the Bell-Knight, in single combat at the Crown-Gate.',
                tag: 'vorne',
              },
            },
          };
        },
      },
    ],
  },

  sunken_belfry: {
    id: 'sunken_belfry',
    name: 'The Sunken Belfry',
    regionType: 'belfry',
    danger: 4,
    dark: true,
    neighbors: ['crown_watchtower', 'drowned_forge'],
    asciiPos: { row: 2, col: 2, code: 'SB' },
    description: () =>
      'At the bottom of a drowned stone amphitheater hangs an upside-down bronze bell as large as a keep. Pale roots weave a living throne beneath it where Malakor, the Choir-Husk, awaits the Third Drowning Toll.',
    actions: [
      {
        id: 'sb_confront_malakor',
        label: 'Descend into the Choir-Pit and Confront Malakor, the Choir-Husk',
        tag: 'FINAL BOSS',
        visible: (state) => !hasFlag(state, 'malakor_slain'),
        resolve: (state) => {
          const brokenSeals: string[] = [];
          const msgs: string[] = [
            'You step onto the cracked bronze dais. Above you, the great drowned bell trembles with gathered air.',
          ];
          let preDamageRatio = 0;

          if (hasFlag(state, 'kale_fate', 'redeemed')) {
            preDamageRatio += 0.2;
            msgs.push(
              "A shout echoes from the upper gallery! Kale, the redeemed deserter, hurls a chain-shot into the Choir pillars, shattering Malakor's outer ward (-20% Boss HP)!",
            );
          }
          if (hasFlag(state, 'vorne_redeemed')) {
            preDamageRatio += 0.15;
            msgs.push(
              'Heavy bronze footsteps thunder beside you — Sir Vorne charges into the pale choir-thralls, cleaving open your path (-15% Boss HP)!',
            );
          }
          if (hasFlag(state, 'seal_of_silence')) {
            brokenSeals.push('seal_of_silence');
            msgs.push("[Counter-Seal] Your Seal of Silence hums — Malakor's Drowning Toll is halved!");
          }
          if (hasFlag(state, 'root_conduit_severed')) {
            brokenSeals.push('root_conduit_severed');
            msgs.push("[Counter-Seal] The severed Root Conduit starves Malakor's bark-shield (-2 Boss Armor)!");
          }
          if (hasFlag(state, 'kiln_cipher_learned')) {
            brokenSeals.push('kiln_cipher_learned');
            preDamageRatio += 0.12;
            msgs.push("[Counter-Seal] Speaking the First Kiln Cipher sears Malakor's throne with ancient fire (-12% Boss HP)!");
          }

          return {
            messages: msgs,
            startCombat: {
              enemyId: 'malakor',
              canFlee: false,
              preDamageRatio: Math.min(0.55, preDamageRatio),
              brokenSeals,
              onVictoryFlag: 'malakor_slain',
              onVictoryChronicle: {
                title: 'Slew Malakor, the Choir-Husk',
                summary: 'Defeated the Choir-Husk beneath the Sunken Belfry.',
                tag: 'boss',
              },
            },
          };
        },
      },
      {
        id: 'sb_ending_shatter',
        label: '[Ending] Shatter the Sunken Bell & End the Husk-Tide',
        tag: 'Victory',
        visible: (state) => hasFlag(state, 'malakor_slain'),
        resolve: () => ({
          messages: ['You raise your weapon against the cracked heart of the great bronze bell...'],
          triggerEnding: {
            endingId: 'shatter_belfry',
            title: 'Silence Over the Reach',
            openingText: 'The great bell fractures into harmless bronze rain.',
          },
        }),
      },
      {
        id: 'sb_ending_kiln',
        label: '[Ending] Speak the Cipher and Rekindle the First Kiln',
        tag: 'Vaelorian / Durnfolk / Cipher',
        visible: (state) =>
          hasFlag(state, 'malakor_slain') &&
          (hasFlag(state, 'kiln_cipher_learned') ||
            state.player.race === 'vaelorian' ||
            state.player.race === 'durnfolk'),
        resolve: () => ({
          messages: ['You turn from the dead bell toward the dormant furnace beneath the altar...'],
          triggerEnding: {
            endingId: 'rekindle_kiln',
            title: 'Heir of the First Kiln',
            openingText: 'Pale ember flares back into the ancient conduits of stone.',
          },
        }),
      },
      {
        id: 'sb_ending_ascend',
        label: '[Ending] Claim the Bell-Crown & Ascend as the New Choir-Warden',
        tag: 'Dark / Occult',
        visible: (state) =>
          hasFlag(state, 'malakor_slain') &&
          (state.memory.factions.husk_choir >= 2 ||
            hasFlag(state, 'stole_cistern_vesper') ||
            state.player.race === 'ael_thalor' ||
            state.player.background === 'root_scholar'),
        resolve: () => ({
          messages: ["You reach down through the settling spore-dust for Malakor's crown..."],
          triggerEnding: {
            endingId: 'ascend_warden',
            title: 'The Quiet Crown',
            openingText: 'The Pale Root bows in sudden, uncanny obedience.',
          },
        }),
      },
    ],
  },
};
