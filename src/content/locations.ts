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
        return "Cinderford's timber gate hangs crooked on rusted hinges. Pale tendrils curl out of the granary roof, and the watch-bell lies cracked in gray slush.";
      }
      const p = state.player;
      const base =
        'Timber palisades ring a blackened stone keep above the mire. Lanterns swing over the Iron-Vow muster yard, while nervous townsfolk watch the sealed granary near the well.';
      if (p.race === 'grixi') {
        return `${base} Sentries eye your brass-warren satchel warily, though the quartermaster keeps a discreet ledger beneath the counter for Grixi coin.`;
      }
      if (p.race === 'vaelorian') {
        return `${base} Old Imperial eagles cling to the gate lintel, and the garrison greets Vaelorian blood like distant kin.`;
      }
      return base;
    },
    shop: {
      name: 'Cinderford Quartermaster',
      keeper: 'Quartermaster Harken',
      greeting: (state) => {
        if (hasFlag(state, 'cinderford_fallen')) {
          return 'Harken is gone; only empty crates remain.';
        }
        return hasFlag(state, 'granary_burned')
          ? 'Harken taps a notched tally-stick. Grain prices remain steep since the fire.'
          : 'Harken taps a notched tally-stick beside stacked crates.';
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
    npcs: [
      {
        id: 'captain_vane',
        name: 'Captain Vane',
        shortLabel: 'Captain Vane',
        visible: (state) => !hasFlag(state, 'cinderford_fallen'),
        greeting: (state) => {
          if (state.player.race === 'vaelorian') {
            return 'Captain Vane eyes the old Vaelorian cut of your brow across the muster table.';
          }
          if (state.player.sex === 'female') {
            return 'Captain Vane glances up from his iron muster-roll, his gaze cold and skeptical.';
          }
          return 'Captain Vane beckons you toward the scarred oak muster table.';
        },
        topics: [
          {
            id: 'vane_charter',
            label: 'Blood Charter',
            visible: (state) =>
              state.player.race === 'vaelorian' && !hasFlag(state, 'vane_visited'),
            resolve: (state) => {
              setFlag(state, 'vane_visited', true);
              adjustFaction(state, 'iron_vow', 2);
              state.player.crowns += 22;
              state.player.rations += 1;
              recordChronicle(
                state,
                'Imperial Charter at Cinderford',
                'Captain Vane honored your Vaelorian blood-charter with coin and provisions.',
                'iron_vow',
              );
              return {
                stayInDialogue: true,
                messages: [
                  `Captain Vane salutes crisply. "Blood of the Charter. Good to see an Ash-Born ${pronouns(state.player.sex).kinTitle.toLowerCase()} holding the Reach." He presses a levy purse and trail bread into your hands.`,
                ],
              };
            },
          },
          {
            id: 'vane_muster',
            label: 'Muster',
            visible: (state) =>
              state.player.race !== 'vaelorian' &&
              state.player.sex === 'male' &&
              !hasFlag(state, 'vane_visited'),
            resolve: (state) => {
              setFlag(state, 'vane_visited', true);
              adjustFaction(state, 'iron_vow', 1);
              state.player.crowns += 16;
              state.player.torches += 1;
              recordChronicle(
                state,
                'Mustered with Iron-Vow',
                'Captain Vane enrolled you as an auxiliary and issued coin and a torch.',
                'iron_vow',
              );
              return {
                stayInDialogue: true,
                messages: [
                  'Captain Vane nods across the scarred oak table. "Able men are thin on the road, brother. Take a bounty chit and bring word from the Watchtower."',
                ],
              };
            },
          },
          {
            id: 'vane_challenge',
            label: 'Challenge',
            visible: (state) =>
              state.player.race !== 'vaelorian' &&
              state.player.sex === 'female' &&
              !hasFlag(state, 'vane_visited'),
            resolve: (state) => {
              setFlag(state, 'vane_visited', true);
              const check = resolveCheck(state, 'might', 12, { label: 'Muster Table' });
              if (check.success) {
                adjustFaction(state, 'iron_vow', 2);
                state.player.crowns += 24;
                state.player.maxHp += 2;
                state.player.hp += 2;
                recordChronicle(
                  state,
                  'Outfaced Captain Vane',
                  "Refused dismissal at the muster table and won the veterans' respect.",
                  'iron_vow',
                );
                return {
                  stayInDialogue: true,
                  messages: [
                    'Captain Vane waves a dismissive gauntlet: "These marches aren\'t a seamstress hall, lass."',
                    'You drive your weapon flat into the oak plank beside his thumb. The veterans erupt in rough cheers; Vane grunts and slides over an officer purse.',
                  ],
                };
              }
              adjustFaction(state, 'iron_vow', -1);
              state.player.crowns += 10;
              return {
                stayInDialogue: true,
                messages: [
                  'Captain Vane scoffs at your stance and tosses a thin messenger fee across the wood.',
                ],
              };
            },
          },
          {
            id: 'vane_granary',
            label: 'Granary',
            resolve: (state) => ({
              stayInDialogue: true,
              messages: [
                hasFlag(state, 'cinderford_saved')
                  ? 'Vane nods toward the well. "With the granary settled, we might actually outlast winter."'
                  : 'Vane lowers his voice. "White mold crept under the granary sills last night. Inspect it before Day 8 or this keep rots from within."',
              ],
            }),
          },
          {
            id: 'vane_rumors',
            label: 'Rumors',
            resolve: () => ({
              stayInDialogue: true,
              messages: [
                'Vane taps three points on his slate: "Sir Vorne still holds the Crown-Gate watchtower, the blind Matrons whisper beneath Ash-Fen, and the Weeping Barrow hides pre-Shattering cipher stones."',
              ],
            }),
          },
        ],
      },
      {
        id: 'innkeeper_martha',
        name: 'Innkeeper Martha',
        shortLabel: 'Martha',
        visible: (state) => !hasFlag(state, 'cinderford_fallen'),
        greeting: (state) =>
          hasFlag(state, 'granary_purified')
            ? 'Martha ladles hot barley broth with a warm smile.'
            : 'Martha wipes cracked stoneware beside the peat hearth.',
        topics: [
          {
            id: 'martha_rumors',
            label: 'Rumors',
            resolve: () => ({
              stayInDialogue: true,
              messages: [
                '"A deserter named Kale bolted down the King\'s Causeway coughing chalk," Martha murmurs. "And if you descend to the Silken Cistern, mind how the Matrons weigh men against sisters."',
              ],
            }),
          },
          {
            id: 'martha_soup',
            label: 'Broth',
            visible: (state) => !hasFlag(state, 'martha_broth_today'),
            resolve: (state) => {
              setFlag(state, 'martha_broth_today', true);
              state.player.hp = Math.min(state.player.maxHp, state.player.hp + 4);
              return {
                stayInDialogue: true,
                messages: ['Martha pushes a steaming wooden bowl across the counter.'],
              };
            },
          },
        ],
      },
    ],
    actions: [
      {
        id: 'cf_granary_outer',
        label: 'Granary',
        visible: (state) =>
          !hasFlag(state, 'cinderford_fallen') &&
          !hasFlag(state, 'cf_granary_opened') &&
          !hasFlag(state, 'cinderford_saved'),
        resolve: (state) => {
          setFlag(state, 'cf_granary_opened', true);
          return {
            messages: [
              'You unbar the swollen oak door. Sweet, chalky spore-mist curls up from the lower grain cellar.',
            ],
          };
        },
      },
      {
        id: 'cf_granary_cellar',
        label: 'Cellar Spores',
        visible: (state) =>
          !hasFlag(state, 'cinderford_fallen') &&
          hasFlag(state, 'cf_granary_opened') &&
          !hasFlag(state, 'cinderford_saved'),
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
                  ? 'You draw the pale spores into a clay brazier and turn them to harmless grey ash, sparing every sack of barley.'
                  : 'You distill Vesper Tonic across the seed-bins, burning out the pale mycelium while sparing every sack of grain.',
              ],
            };
          }

          const check = resolveCheck(state, 'wit', 14, {
            label: 'Cellar Quarantine',
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
                'You trace the damp root-vein to a single rotted cask and excise it cleanly before the blight spreads.',
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
              'The blight spreads too swiftly for steel. You bar the shutters and put the granary to the torch, sparing the keep at bitter cost.',
            ],
          };
        },
      },
      {
        id: 'cf_durnfolk_masonry',
        label: 'Curtain Wall',
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
              'Your Durnfolk eyes spot settling mortar above the sluice-gate. You wedge basalt shims and instruct the masons in deep-forge bracing; the master builder pays your fee gratefully.',
            ],
          };
        },
      },
      {
        id: 'cf_fallen_ruins',
        label: 'Storehouse',
        visible: (state) => hasFlag(state, 'cinderford_fallen') && !hasFlag(state, 'cf_looted_ruin'),
        resolve: (state) => {
          setFlag(state, 'cf_looted_ruin', true);
          state.player.rations += 1;
          addItemToInventory(state, 'poultice', 1);
          return {
            messages: ['Among spilled grain sacks you rescue a bundle of rations and a clean poultice.'],
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
        id: 'kc_milestones',
        label: 'Milestones',
        visible: (state) => !hasFlag(state, 'kc_milestones_checked'),
        resolve: (state) => {
          setFlag(state, 'kc_milestones_checked', true);
          const check = resolveCheck(state, 'wit', 11, {
            label: 'Milestone Ciphers',
            isLoreOrPerception: true,
          });
          if (check.success) {
            state.player.rations += 1;
            state.player.torches += 1;
            state.player.crowns += 8;
            return {
              messages: [
                check.logLine,
                'Beneath a loose keystone rests an emergency courier cache with rations, a torch, and silver.',
              ],
            };
          }
          return {
            messages: [check.logLine, 'You spot cart tracks leading into a sunken drainage ditch nearby.'],
          };
        },
      },
      {
        id: 'kc_ditch',
        label: 'Courier Ditch',
        visible: (state) => hasFlag(state, 'kc_milestones_checked') && !hasFlag(state, 'kc_ditch_cleared'),
        resolve: (state) => {
          setFlag(state, 'kc_ditch_cleared', true);
          addItemToInventory(state, 'ash_resin', 1);
          return {
            messages: [
              'Half-buried in ash mud sits a scorched saddlebag holding resin, though a gaunt hound snarls from the culvert.',
            ],
            startCombat: { enemyId: 'ash_hound', canFlee: true },
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
        id: 'wb_outer_steps',
        label: 'Outer Steps',
        visible: (state) => !hasFlag(state, 'wb_steps_entered'),
        resolve: (state) => {
          const p = state.player;
          const msgs: string[] = [];
          if (p.heirloom === 'kiln_lantern') {
            msgs.push('Your Kiln Lantern bathes the drowned stairs in steady amber light.');
          } else if (p.torches > 0) {
            p.torches -= 1;
            msgs.push('You strike a pitch-torch and drive back the wet dark.');
          } else {
            msgs.push('Stone splinters slice your shins in the blind dark before you feel your way down.');
            p.hp = Math.max(1, p.hp - 3);
          }
          setFlag(state, 'wb_steps_entered', true);
          msgs.push('Below the threshold wait an inner sarcophagus chamber and a sealed frieze wall.');
          return { messages: msgs };
        },
      },
      {
        id: 'wb_inner_crypt',
        label: 'Inner Crypt',
        visible: (state) => hasFlag(state, 'wb_steps_entered') && !hasFlag(state, 'wb_crypt_cleared'),
        resolve: (state) => {
          setFlag(state, 'wb_crypt_cleared', true);
          setFlag(state, 'vorne_oath_known', true);
          addItemToInventory(state, 'echo_shell', 1);
          return {
            messages: [
              'Upon the central sarcophagus rests a silver-inlaid tablet naming Sir Vorne\'s forgotten oath: "Hold the Crown-Gate until the First Bell answers twice — never yield to the Choir." Beside it lies a Resonant Echo-Shell.',
            ],
          };
        },
      },
      {
        id: 'wb_altar_frieze',
        label: 'Altar Frieze',
        visible: (state) => hasFlag(state, 'wb_crypt_cleared') && !hasFlag(state, 'kiln_cipher_learned'),
        resolve: (state) => {
          const p = state.player;
          if (p.race === 'vaelorian' || p.race === 'ael_thalor' || p.background === 'root_scholar') {
            setFlag(state, 'kiln_cipher_learned', true);
            recordChronicle(
              state,
              'Learned First Kiln Cipher',
              'Translated the pre-Shattering ignition sigils inside the Weeping Barrow.',
              'seal',
            );
            return {
              messages: [
                'Reading the ancient script directly from the scorched marble, you master the First Kiln Cipher.',
              ],
            };
          }
          const check = resolveCheck(state, 'wit', 13, {
            label: 'Kiln Altar',
            isLoreOrPerception: true,
          });
          if (check.success) {
            setFlag(state, 'kiln_cipher_learned', true);
            recordChronicle(
              state,
              'Learned First Kiln Cipher',
              'Pieced together the pre-Shattering Kiln sigils from the tomb lintel.',
              'seal',
            );
            return {
              messages: [check.logLine, 'You copy the First Kiln Cipher onto your travel-slate.'],
            };
          }
          return {
            messages: [check.logLine, 'The broken glyphs refuse to cohere under your lamp.'],
          };
        },
      },
      {
        id: 'wb_durnfolk_vault',
        label: 'Basalt Vault',
        visible: (state) =>
          state.player.race === 'durnfolk' &&
          hasFlag(state, 'wb_steps_entered') &&
          !hasFlag(state, 'wb_dwarf_vault'),
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
              'Tapping the third lintel with your knuckle drops a hidden stone pin. A counterweight chamber swings open, revealing a Runic Warhammer and ancient silver.',
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
      'Knee-deep gray bog dotted with sunken stone lanterns and pale, bell-shaped fungi. Beneath the cattails, an ancient stone culvert descends toward the Silken Cistern.',
    actions: [
      {
        id: 'af_herbs',
        label: 'Herb Bank',
        visible: (state) => !hasFlag(state, 'af_herbs_picked'),
        resolve: (state) => {
          setFlag(state, 'af_herbs_picked', true);
          addItemToInventory(state, 'bog_herb', 2);
          return {
            messages: ['You cut two bundles of silver-veined bog herb from the reeds.'],
          };
        },
      },
      {
        id: 'af_stones',
        label: 'Stepping Stones',
        visible: (state) => !hasFlag(state, 'af_stones_crossed'),
        resolve: (state) => {
          const check = resolveCheck(state, 'agility', 12, { label: 'Mire Stones' });
          setFlag(state, 'af_stones_crossed', true);
          if (check.success) {
            return {
              messages: [check.logLine, 'You cross the bone-white stones cleanly to reach a sunken shrine.'],
            };
          }
          state.player.hp = Math.max(1, state.player.hp - 4);
          return {
            messages: [
              check.logLine,
              'A slab tilts into freezing mire and thorn-leeches tear your calf before you reach the shrine.',
            ],
          };
        },
      },
      {
        id: 'af_shrine',
        label: 'Sunken Shrine',
        visible: (state) => hasFlag(state, 'af_stones_crossed') && !hasFlag(state, 'af_shrine_done'),
        resolve: (state) => {
          setFlag(state, 'af_shrine_done', true);
          addItemToInventory(state, 'poultice', 1);
          state.player.focus = Math.min(state.player.maxFocus, state.player.focus + 3);
          return {
            messages: [
              'Beneath the drowned altar you retrieve a dry poultice and steady your mind.',
            ],
          };
        },
      },
      {
        id: 'af_grixi_salvage',
        label: 'Mire Vents',
        visible: (state) => state.player.race === 'grixi' && !hasFlag(state, 'af_grixi_skimmed'),
        resolve: (state) => {
          setFlag(state, 'af_grixi_skimmed', true);
          addItemToInventory(state, 'fire_pot', 1);
          addItemToInventory(state, 'antitoxin', 1);
          state.player.crowns += 16;
          return {
            messages: [
              'Knowing Under-Warren drainage traps by scent alone, you fish out an intact brass canister holding alchemical pots and silver.',
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
      name: 'Loom Apothecary',
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
    npcs: [
      {
        id: 'matron_veyra',
        name: 'Matron Veyra',
        shortLabel: 'Matron Veyra',
        visible: (state) => !hasFlag(state, 'stole_cistern_vesper'),
        greeting: (state) =>
          state.player.sex === 'female'
            ? '"Step past the silk, Sister. Let our blind looms weigh your breath."'
            : '"Halt at the black water, man. Speak why the loom should spare your weight."',
        topics: [
          {
            id: 'veyra_shell',
            label: 'Echo Shell',
            visible: (state) => hasItem(state, 'echo_shell') && !hasFlag(state, 'seal_of_silence'),
            resolve: (state) => {
              consumeInventoryItem(state, 'echo_shell', 1);
              setFlag(state, 'seal_of_silence', true);
              adjustFaction(state, 'silken_cistern', 3);
              state.player.maxFocus += 1;
              state.player.focus = state.player.maxFocus;
              recordChronicle(
                state,
                'Earned Seal of Silence',
                'Returned the Echo-Shell to the blind Matrons and received their counter-harmonic Seal.',
                'seal',
              );
              return {
                stayInDialogue: true,
                messages: [
                  `Matron Veyra gasps as you lay the Echo-Shell on the altar. "The barrow's lost voice! Keep faith with the deep waters, ${pronouns(state.player.sex).formal}." She binds the silver Seal of Silence around your wrist.`,
                ],
              };
            },
          },
          {
            id: 'veyra_sisterhood',
            label: 'Sisterhood',
            visible: (state) => state.player.sex === 'female' && !hasFlag(state, 'seal_of_silence'),
            resolve: (state) => {
              adjustFaction(state, 'silken_cistern', 1);
              const check = resolveCheck(state, 'wit', 11, {
                label: 'Sisterhood Rite',
                isLoreOrPerception: true,
              });
              if (check.success) {
                setFlag(state, 'seal_of_silence', true);
                recordChronicle(
                  state,
                  'Earned Seal of Silence',
                  'Passed the Unveiled Sisterhood rite before the Matrons of the Silken Cistern.',
                  'seal',
                );
                return {
                  stayInDialogue: true,
                  messages: [
                    'Veyra welcomes you behind the inner veil. Your quiet pulse stills the silk basin, and she binds the Seal of Silence to your wrist.',
                  ],
                };
              }
              return {
                stayInDialogue: true,
                messages: [
                  'The silk trembles at the edge of the basin. "Bring us the Echo-Shell from the Weeping Barrow, Sister, or still your breath."',
                ],
              };
            },
          },
          {
            id: 'veyra_liturgy',
            label: 'Liturgy',
            visible: (state) =>
              state.player.sex === 'male' &&
              (state.player.race === 'ael_thalor' || state.player.background === 'shrine_penitent') &&
              !hasFlag(state, 'seal_of_silence'),
            resolve: (state) => {
              const check = resolveCheck(state, 'grit', 13, {
                label: 'Water Liturgy',
                isLoreOrPerception: true,
              });
              if (check.success) {
                setFlag(state, 'seal_of_silence', true);
                adjustFaction(state, 'silken_cistern', 2);
                recordChronicle(
                  state,
                  'Earned Seal of Silence',
                  "Won the Matrons' trust through ancient liturgy.",
                  'seal',
                );
                return {
                  stayInDialogue: true,
                  messages: [
                    'Matron Veyra bows slightly as your pre-Shattering water-liturgy echoes across the cistern. "Take the Seal of Silence."',
                  ],
                };
              }
              return {
                stayInDialogue: true,
                messages: [
                  'The blind weavers turn away. "Bring the Echo-Shell from the Barrow, man, or spill blood upon the threshold."',
                ],
              };
            },
          },
          {
            id: 'veyra_blood',
            label: 'Blood Oath',
            visible: (state) =>
              state.player.sex === 'male' && !hasFlag(state, 'seal_of_silence') && state.player.hp > 6,
            resolve: (state) => {
              const check = resolveCheck(state, 'grit', 14, { label: 'Loom Blood-Oath' });
              state.player.hp -= 5;
              if (check.success) {
                setFlag(state, 'seal_of_silence', true);
                adjustFaction(state, 'silken_cistern', 1);
                recordChronicle(
                  state,
                  'Blood-Oath of Cistern',
                  'Spilled your own blood upon the Loom-threshold to earn the Seal of Silence.',
                  'seal',
                );
                return {
                  stayInDialogue: true,
                  messages: [
                    'You draw steel across your palm. Your blood sinks cleanly into the black water without waking the Choir-spores, earning the Seal of Silence.',
                  ],
                };
              }
              return {
                stayInDialogue: true,
                messages: [
                  'The dark water ripples angrily against your bleeding palm. "Not enough. Bring the Echo-Shell."',
                ],
              };
            },
          },
          {
            id: 'veyra_belfry',
            label: 'Belfry',
            resolve: (state) => ({
              stayInDialogue: true,
              messages: [
                hasFlag(state, 'seal_of_silence')
                  ? '"With our Seal around your wrist, Malakor\'s Drowning Toll cannot shatter your mind," Veyra whispers.'
                  : '"Malakor prepares the Third Toll beneath the Belfry. Without our Seal or severed roots beneath the forge, his bell crushes bone."',
              ],
            }),
          },
        ],
      },
    ],
    actions: [
      {
        id: 'sc_pool_rest',
        label: 'Quiet Pool',
        visible: (state) => !hasFlag(state, 'stole_cistern_vesper'),
        resolve: (state) => {
          state.player.hp = Math.min(state.player.maxHp, state.player.hp + 12);
          state.player.focus = state.player.maxFocus;
          state.player.stamina = state.player.maxStamina;
          state.player.statuses = [];
          return {
            advanceDay: 1,
            messages: ['Cool subterranean water washes away fatigue and lingering root-spores.'],
          };
        },
      },
      {
        id: 'sc_steal_font',
        label: 'Vesper Font',
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
            'Plundered Vesper-Font',
            'Siphoned the sacred cistern amber, turning the blind Matrons into mortal enemies.',
            'dark',
          );
          return {
            messages: [
              'While the watchers chant, you shatter the silver basin and siphon pure soul-amber into your flask. Behind you, the Matrons scream in a single discordant voice.',
            ],
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
        return "Colossal ivory-stone trunks spiral toward a pale sky — your exiled kin's ancient home, now strangled by vibrating root-veins.";
      }
      return 'Fossilized white trunks tower like cathedral ribs. Pale blossoms chime faintly when the wind brushes them, and antlers scrape somewhere in the silver brush.';
    },
    actions: [
      {
        id: 'sw_resin_grove',
        label: 'Resin Grove',
        visible: (state) => !hasFlag(state, 'sw_grove_searched'),
        resolve: (state) => {
          setFlag(state, 'sw_grove_searched', true);
          addItemToInventory(state, 'ash_resin', 2);
          return {
            messages: [
              'You scrape volatile amber resin from petrified boughs and clear a deer trail into the Heart-Glade.',
            ],
          };
        },
      },
      {
        id: 'sw_star_stag',
        label: 'Heart Glade',
        visible: (state) => hasFlag(state, 'sw_grove_searched') && !hasFlag(state, 'star_stag_resolved'),
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
                'You kneel and sing the elder Memory-Canticle. The great Star-Stag halts, shakes pale vines from its silver antlers, and leaves a Star-Glaive gleaming in the mossy plinth.',
              ],
            };
          }

          return {
            messages: [
              'A towering stag plated in chalky bark bursts from the petrified ferns, pale chimes rattling from its antlers.',
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
        label: 'Root Conduit',
        visible: (state) =>
          hasFlag(state, 'star_stag_resolved') && !hasFlag(state, 'root_conduit_severed'),
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
                "Flame tears into the throbbing pale taproot. The forest shudders as the Belfry's outer armor-conduit snaps.",
              ],
            };
          }

          const check = resolveCheck(state, 'might', 14, { label: 'Root-Core' });
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
                "With brutal strokes you sever the pulsing conduit, starving Malakor's bark-aegis.",
              ],
            };
          }

          p.hp = Math.max(1, p.hp - 5);
          return {
            messages: [check.logLine, 'The iron-hard root lashes back across your shoulder.'],
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
        label: 'Sluice Hall',
        visible: (state) => !hasFlag(state, 'forge_cleared'),
        resolve: (state) => {
          const p = state.player;
          if (p.race === 'durnfolk') {
            setFlag(state, 'forge_cleared', true);
            addItemToInventory(state, 'basalt_plate', 1);
            recordChronicle(
              state,
              'Commanded Forge-Warden',
              'Used ancestral Durnfolk master-signs to stand down the Basalt Kiln-Warden.',
              'durnfolk',
            );
            return {
              messages: [
                'You rap the ancient guild-cadence twice upon your helm. The towering Basalt Kiln-Warden kneels in grinding stone deference, opening the armory locker.',
              ],
            };
          }
          if (p.race === 'grixi') {
            const check = resolveCheck(state, 'agility', 12, {
              label: 'Flue Bypass',
              isCraftOrStealth: true,
            });
            if (check.success) {
              setFlag(state, 'forge_cleared', true);
              addItemToInventory(state, 'basalt_plate', 1);
              return {
                messages: [
                  check.logLine,
                  'You wriggle through the ash-exhaust duct behind the golem, pull its pressure pin, and claim the Basalt Cuirass.',
                ],
              };
            }
          }

          return {
            messages: ['Steam hisses from copper joints as the Basalt Kiln-Warden lurches forward with a furnace hammer.'],
            startCombat: {
              enemyId: 'forge_automaton',
              canFlee: true,
              onVictoryFlag: 'forge_cleared',
              onVictoryChronicle: {
                title: 'Shattered Kiln-Warden',
                summary: 'Defeated the ancient Durnfolk automaton inside the Drowned Forge-Vault.',
                tag: 'combat',
              },
            },
          };
        },
      },
      {
        id: 'df_hone_weapon',
        label: 'Runic Brazier',
        visible: (state) => hasFlag(state, 'forge_cleared') && !state.player.weaponHoned,
        resolve: (state) => {
          state.player.weaponHoned = true;
          return {
            messages: [
              'You draw your weapon across the warm basalt whetstone. Sparks of old Kiln-steel kiss the edge.',
            ],
          };
        },
      },
      {
        id: 'df_drain_conduit',
        label: 'Abyssal Valve',
        visible: (state) => hasFlag(state, 'forge_cleared') && !hasFlag(state, 'root_conduit_severed'),
        resolve: (state) => {
          setFlag(state, 'root_conduit_severed', true);
          recordChronicle(
            state,
            'Choked Deep Conduit',
            "Closed the flooded Durnfolk sluice-valves, starving Malakor's root-shield.",
            'seal',
          );
          return {
            messages: [
              "You haul the heavy bronze wheel shut. Superheated brine floods the lower root-shaft, crippling Malakor's Belfry Aegis.",
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
      return 'A shattered parapet overlooking the abyssal crater of the Sunken Belfry. On a bronze plinth sits Sir Vorne, motionless save for the slow ring of his bell-helm in the wind.';
    },
    npcs: [
      {
        id: 'sir_vorne_npc',
        name: 'Sir Vorne',
        shortLabel: 'Sir Vorne',
        visible: (state) => !hasFlag(state, 'vorne_resolved'),
        greeting: () =>
          'Beneath a great bronze bell-helm, Sir Vorne grips his massive cleaver without rising.',
        topics: [
          {
            id: 'vorne_oath',
            label: 'Recite Oath',
            visible: (state) => hasFlag(state, 'vorne_oath_known'),
            resolve: (state) => {
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
                  'You recite the exact oath engraved in the Weeping Barrow. Sir Vorne freezes, sighs deeply through his visor, presses his Bell-Cleaver into your hands, and marches down to break Malakor\'s choir.',
                ],
              };
            },
          },
          {
            id: 'vorne_challenge',
            label: 'Challenge',
            visible: (state) =>
              state.player.race === 'vaelorian' || state.player.background === 'ashen_blade',
            resolve: (state) => {
              const check = resolveCheck(state, 'grit', 14, { label: 'Knightly Oath' });
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
                    'You utter the old Vaelish knight dismissal. Sir Vorne lowers his blade, yields his Bell-Cleaver, and pledges his final charge to break Malakor\'s choir.',
                  ],
                };
              }
              return {
                messages: [check.logLine, 'Sir Vorne rises slowly, bell-helm tolling once as he draws his cleaver.'],
                startCombat: {
                  enemyId: 'sir_vorne',
                  canFlee: true,
                  onVictoryFlag: 'vorne_resolved',
                  onVictoryChronicle: {
                    title: 'Slain Sir Vorne',
                    summary: 'Defeated Sir Vorne in single combat at the Crown-Gate.',
                    tag: 'vorne',
                  },
                },
              };
            },
          },
          {
            id: 'vorne_fight',
            label: 'Draw Steel',
            resolve: () => ({
              messages: ['"None pass the Crown-Gate unweighed," Sir Vorne rumbles, hoisting his massive Bell-Cleaver.'],
              startCombat: {
                enemyId: 'sir_vorne',
                canFlee: true,
                onVictoryFlag: 'vorne_resolved',
                onVictoryChronicle: {
                  title: 'Slain Sir Vorne',
                  summary: 'Defeated Sir Vorne in single combat at the Crown-Gate.',
                  tag: 'vorne',
                },
              },
            }),
          },
        ],
      },
    ],
    actions: [
      {
        id: 'cw_parapet',
        label: 'Parapet',
        visible: (state) => !hasFlag(state, 'cw_parapet_checked'),
        resolve: (state) => {
          setFlag(state, 'cw_parapet_checked', true);
          addItemToInventory(state, 'poultice', 1);
          return {
            messages: [
              'Tucked behind a fallen battlement you uncover a dry watchman satchel and a clear vantage over the Sunken Belfry below.',
            ],
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
      'At the bottom of a drowned stone amphitheater hangs an upside-down bronze bell as large as a keep. Pale roots weave a living throne beneath it where Malakor awaits the Third Drowning Toll.',
    actions: [
      {
        id: 'sb_confront_malakor',
        label: 'Choir Pit',
        visible: (state) => !hasFlag(state, 'malakor_slain'),
        resolve: (state) => {
          const brokenSeals: string[] = [];
          const msgs: string[] = [
            'You descend onto the cracked bronze dais. Above you, the great drowned bell trembles with gathered air.',
          ];
          let preDamageRatio = 0;
          let thrallCleared = false;

          if (hasFlag(state, 'kale_fate', 'redeemed')) {
            preDamageRatio += 0.2;
            thrallCleared = true;
            msgs.push(
              'A shout echoes from the upper gallery as Kale hurls chain-shot into the choir pillars, cutting down Malakor\'s acolyte guard.',
            );
          }
          if (hasFlag(state, 'vorne_redeemed')) {
            preDamageRatio += 0.15;
            thrallCleared = true;
            msgs.push(
              'Heavy bronze footsteps thunder beside you as Sir Vorne charges into the pale choir, breaking their outer guard.',
            );
          }
          if (hasFlag(state, 'seal_of_silence')) {
            brokenSeals.push('seal_of_silence');
            msgs.push('Your Seal of Silence hums against the air, dampening the bell.');
          }
          if (hasFlag(state, 'root_conduit_severed')) {
            brokenSeals.push('root_conduit_severed');
            msgs.push('With the deep Root Conduit severed, Malakor\'s bark-shield crumbles.');
          }
          if (hasFlag(state, 'kiln_cipher_learned')) {
            brokenSeals.push('kiln_cipher_learned');
            preDamageRatio += 0.12;
            msgs.push('Speaking the First Kiln Cipher sears Malakor\'s throne with pale fire.');
          }

          return {
            messages: msgs,
            startCombat: {
              enemyIds: thrallCleared ? ['malakor'] : ['malakor', 'blight_acolyte'],
              canFlee: false,
              preDamageRatio: Math.min(0.55, preDamageRatio),
              brokenSeals,
              onVictoryFlag: 'malakor_slain',
              onVictoryChronicle: {
                title: 'Slew Malakor',
                summary: 'Defeated the Choir-Husk beneath the Sunken Belfry.',
                tag: 'boss',
              },
            },
          };
        },
      },
      {
        id: 'sb_ending_shatter',
        label: 'Shatter Bell',
        visible: (state) => hasFlag(state, 'malakor_slain'),
        resolve: () => ({
          messages: ['You raise your weapon against the cracked heart of the great bronze bell.'],
          triggerEnding: {
            endingId: 'shatter_belfry',
            title: 'Silence Over the Reach',
            openingText: 'The great bell fractures into harmless bronze rain.',
          },
        }),
      },
      {
        id: 'sb_ending_kiln',
        label: 'Rekindle Kiln',
        visible: (state) =>
          hasFlag(state, 'malakor_slain') &&
          (hasFlag(state, 'kiln_cipher_learned') ||
            state.player.race === 'vaelorian' ||
            state.player.race === 'durnfolk'),
        resolve: () => ({
          messages: ['You turn from the dead bell toward the dormant furnace beneath the altar.'],
          triggerEnding: {
            endingId: 'rekindle_kiln',
            title: 'Heir of the First Kiln',
            openingText: 'Pale ember flares back into the ancient conduits of stone.',
          },
        }),
      },
      {
        id: 'sb_ending_ascend',
        label: 'Claim Crown',
        visible: (state) =>
          hasFlag(state, 'malakor_slain') &&
          (state.memory.factions.husk_choir >= 2 ||
            hasFlag(state, 'stole_cistern_vesper') ||
            state.player.race === 'ael_thalor' ||
            state.player.background === 'root_scholar'),
        resolve: () => ({
          messages: ["You reach down through settling spore-dust for Malakor's bell-crown."],
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
