import type { GameState, LocationNode } from '../types.ts';
import { resolveCheck } from '../dice.ts';
import { adjustFaction, hasFlag, pronouns, recordChronicle, setFlag } from '../memory.ts';
import { addItemToInventory, consumeInventoryItem } from '../combat.ts';
import { getNpcAppearanceReaction } from '../writing/anatomy.ts';

function hasItem(state: GameState, itemId: string): boolean {
  return state.player.inventory.some((e) => e.id === itemId && e.qty > 0);
}

function appendReaction(base: string, state: GameState, npcId: string): string {
  const react = getNpcAppearanceReaction(state, npcId);
  return react ? `${base} ${react}` : base;
}

export const LOCATIONS: Record<string, LocationNode> = {
  cinderford: {
    id: 'cinderford',
    name: 'Cinderford Keep',
    regionType: 'settlement',
    danger: 0,
    neighbors: ['weeping_barrow', 'kings_causeway', 'ash_fen'],
    asciiPos: { row: 2, col: 0, code: 'CF' },
    sensorySummary:
      'Blackened timber palisades ring a squat border keep above the mire. Pitch-lanterns hiss in the rain over the Iron-Vow muster yard, peat smoke drifts from the Ashen Flagon inn, and nervous townsfolk eye the barred oak granary near the well.',
    firstSightProse: (state) =>
      `${LOCATIONS.cinderford.sensorySummary} ${state.player.race === 'grixi' ? 'Sentries eye your brass-warren satchel warily from the catwalk.' : state.player.race === 'vaelorian' ? 'Weathered Imperial eagles cling to the gate lintel above you.' : 'Iron boots splash across wet slate as patrols change the watch.'}`,
    description: (state) => {
      if (hasFlag(state, 'cinderford_fallen')) {
        return "Cinderford's timber gate hangs crooked on rusted hinges. Pale tendrils curl out of the granary roof, and the watch-bell lies cracked in gray slush.";
      }
      const p = state.player;
      const base =
        'Timber palisades ring the blackened stone keep above the mire. Lanterns swing over the Iron-Vow muster yard while townsfolk watch the granary near the well.';
      if (p.race === 'grixi') {
        return `${base} The quartermaster keeps a discreet under-ledger beneath the counter for Grixi coin.`;
      }
      if (p.race === 'vaelorian') {
        return `${base} Old Imperial eagles still cling to the gate lintel.`;
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
        unidentifiedLabel: 'Scarred Officer',
        shortLabel: 'Captain Vane',
        visible: (state) => !hasFlag(state, 'cinderford_fallen'),
        firstSightProse: () =>
          'At the far end of the rain-slicked yard stands a broad-shouldered garrison officer leaning over a scarred oak table. Iron-grey hair sits cropped beneath a leather cap, an old sabre slash splits his left eyebrow, and gauntleted fingers drum steadily beside an iron muster roll.',
        greeting: (state) => {
          const base =
            state.player.race === 'vaelorian'
              ? 'Captain Vane eyes the old Vaelorian cut of your brow across the muster table.'
              : state.player.sex === 'female'
                ? 'Captain Vane glances up from his iron muster-roll, his gaze cold and skeptical.'
                : 'Captain Vane beckons you toward the scarred oak muster table.';
          return appendReaction(base, state, 'captain_vane');
        },
        anatomy: {
          height: 'Tall',
          weight: 'Solid',
          skinColor: 'Weathered Tan',
          hairLength: 'Cropped',
          hairStyle: 'Unkempt',
          hairColor: 'Iron-Grey',
          eyeShape: 'Deep-Set',
          eyeColor: 'Storm-Grey',
          musculature: 'Broad',
          bodyShape: 'Broad-Chested',
          facialScars: 'Brow Split',
          bodyScars: 'Old Spear-Mark',
          faceDetail: 'Deep-set storm-grey eyes sit beneath a jagged scar splitting his left eyebrow and a hard, stubbled jaw.',
          chestTorsoDetail: 'A heavy barrel chest fills out oiled Iron-Vow plate worn dull by frontier winters.',
          armsHandsDetail: 'Thick forearms end in scarred knuckles resting permanently near his sword pommel.',
          legsStanceDetail: 'Planted squarely behind the oak muster board as though holding a breach.',
          distinguishingMark: 'Wears a notched iron whistle chained across his breastplate.',
          visibleTags: ['humanoid', 'muscular', 'scarred_face'],
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
        unidentifiedLabel: 'Hearth Keeper',
        shortLabel: 'Martha',
        visible: (state) => !hasFlag(state, 'cinderford_fallen'),
        firstSightProse: () =>
          'Beside the smoking peat hearth stands a sturdy, grey-braided woman wiping cracked stoneware with a flour-dusted apron. Soot smudges her forearms, and shrewd amber eyes take in every wet cloak that crosses her threshold.',
        greeting: (state) => {
          const base = hasFlag(state, 'granary_purified')
            ? 'Martha ladles hot barley broth with a warm smile.'
            : 'Martha wipes cracked stoneware beside the peat hearth.';
          return appendReaction(base, state, 'innkeeper_martha');
        },
        anatomy: {
          height: 'Average',
          weight: 'Solid',
          skinColor: 'Warm Olive',
          hairLength: 'Long',
          hairStyle: 'Braided',
          hairColor: 'Iron-Grey',
          eyeShape: 'Almond',
          eyeColor: 'Amber',
          musculature: 'Toned',
          bodyShape: 'Full-Figured',
          facialScars: 'Unmarked',
          bodyScars: 'Unmarked',
          faceDetail: 'Laugh-creased amber eyes watch sharply above rosy, hearth-warmed cheeks.',
          chestTorsoDetail: 'Sturdy shoulders and a full apron bear flour dust and dried rosemary.',
          armsHandsDetail: 'Strong, burn-speckled forearms lift heavy iron kettles with ease.',
          legsStanceDetail: 'Unhurried, practical stride behind the timber counter.',
          distinguishingMark: 'Keeps a heavy brass key-ring looped through her apron sash.',
          visibleTags: ['humanoid'],
        },
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
    sensorySummary:
      'Broad Imperial flagstones buckle upward where pale subterranean roots split ancient mortar. Broken obelisks lean beside rusted deserter cages while cold ash drifts over rutted carriage tracks.',
    firstSightProse: () =>
      'The muddy lane widens abruptly onto immense gray flagstones laid for long-dead Imperial legions. Pale roots heave the stone blocks crooked, rusted gibbet cages creak above the ditches, and distant smoke hangs low over the road.',
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
              'Half-buried in ash mud sits a scorched saddlebag holding resin, though low smoke curls out of the culvert beside it.',
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
    sensorySummary:
      'A grass-bald burial mound older than the Shattering weeps rust-orange groundwater down mossy stone steps. Silver Star-Script glints across the sunken lintel.',
    firstSightProse: () =>
      'A swollen hill of wet slate rises out of the bracken, split by a narrow mouth of dressed granite. Iron-orange water trickles steadily down mossy steps into pitch blackness that smells of wet bronze and cold limestone.',
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
    sensorySummary:
      'Knee-deep gray bog dotted with sunken stone lanterns and pale, bell-shaped fungi. Beneath the cattails, an ancient stone culvert descends toward subterranean water.',
    firstSightProse: () =>
      'Solid earth gives way to cold, ash-gray mire smelling of wet peat and sweet mold. Half-drowned stone lanterns mark a crooked causeway of stepping stones, while clusters of pale bell-fungi tremble along the reeds.',
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
    sensorySummary:
      'Cathedral-tall subterranean aqueduct arches draped in pale luminous silk above mirror-still black water. Soft shuttle-clicks echo from blind looms hidden behind the curtains.',
    firstSightProse: () =>
      'Descending through the mire culvert opens into an immense vaulted cistern lit by pale, softly glowing curtains of spider-silk hanging from flooded arches. Mirror-still black water carries the rhythmic clack of unseen looms and the hushed whisper of veiled watchers.',
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
        unidentifiedLabel: 'Veiled Weaver',
        shortLabel: 'Matron Veyra',
        visible: (state) => !hasFlag(state, 'stole_cistern_vesper'),
        firstSightProse: () =>
          'Beside the black water stands a tall, slender woman wrapped from crown to heel in luminous white silk. Her eyes are bound beneath silver-stitched gauze, yet her pale hands trace invisible vibrations hanging in the cavern air.',
        greeting: (state) => {
          const base =
            state.player.sex === 'female'
              ? '"Step past the silk, Sister. Let our blind looms weigh your breath."'
              : '"Halt at the black water, man. Speak why the loom should spare your weight."';
          return appendReaction(base, state, 'matron_veyra');
        },
        anatomy: {
          height: 'Tall',
          weight: 'Lean',
          skinColor: 'Moon-Pale',
          hairLength: 'Waist-Length',
          hairStyle: 'Braided',
          hairColor: 'Ash-White',
          eyeShape: 'Almond',
          eyeColor: 'Blindfolded',
          musculature: 'Wiry',
          bodyShape: 'Slender',
          facialScars: 'Ritual Brand',
          bodyScars: 'Unmarked',
          faceDetail: 'Silver-stitched gauze wraps the upper face above pale, serene cheekbones and an unmoving mouth.',
          chestTorsoDetail: 'Layered luminous silk hangs straight across narrow shoulders and a spare, upright torso.',
          armsHandsDetail: 'Long, pale fingers stain faintly silver at the tips from drawing counter-harmonic thread.',
          legsStanceDetail: 'Stands motionless upon wet flagstone without shifting weight.',
          distinguishingMark: 'Fine luminous threads cling to her sleeves and stir whenever a bell rings far away.',
          visibleTags: ['humanoid', 'pale_skin', 'occult'],
        },
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
    sensorySummary:
      'Colossal ivory-stone trunks spiral like cathedral ribs into a pale cloudbank. Glassy silver needles chime in the breeze while pale root-veins crawl across the forest floor.',
    firstSightProse: () =>
      'The mud turns to crunchy silver dust beneath colossal white trunks turned wholly to stone. Frozen boughs lock high overhead like cathedral ribs, chiming faintly in the cold draft while something heavy scrapes its antlers deeper in the grove.',
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
                'You kneel and sing the elder Memory-Canticle. The immense silver stag halts, shakes pale vines from its chiming rack, and leaves a Star-Glaive gleaming in the mossy plinth.',
              ],
            };
          }

          return {
            messages: ['Silver ferns split apart as heavy hooves thunder into the glade.'],
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
    sensorySummary:
      'Flooded basalt furnace halls built by the Durnfolk before the Shattering. Warm brine laps against submerged anvils while steam hisses from copper sluice-pipes.',
    firstSightProse: () =>
      'Warm, sulfur-thick steam rolls out of a low square gate cut into black basalt. Knee-deep brine floods vast recessed forge floors where old anvils glow dull ember beneath the water and a massive sluice-wheel hums beyond the mist.',
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
            messages: ['Boiling water surges sideways as heavy basalt joints grind awake in the steam.'],
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
    sensorySummary:
      'A wind-scoured parapet jutting over the sunken amphitheater of the Belfry. Shattered arches frame the abyss below, where an old bronze plinth holds vigil.',
    firstSightProse: () =>
      'Steep stone stairs break out onto a wind-scoured cliff parapet hanging above a vast drowned crater. Below lies a sunken amphitheater crowned by a colossal inverted bell; on the broken flagstones before you sits a motionless, towering figure in green-tarnished bronze.',
    description: (state) => {
      if (hasFlag(state, 'vorne_resolved')) {
        return 'Wind howls through the ruined gate-arch overlooking the Sunken Belfry below. An empty bronze chair faces the chasm.';
      }
      return 'A shattered parapet overlooking the abyssal crater of the Sunken Belfry. On a bronze plinth sits a motionless bell-helmed sentinel whose visor hums in the wind.';
    },
    npcs: [
      {
        id: 'sir_vorne_npc',
        name: 'Sir Vorne',
        unidentifiedLabel: 'Bronze Sentinel',
        shortLabel: 'Sir Vorne',
        visible: (state) => !hasFlag(state, 'vorne_resolved'),
        firstSightProse: () =>
          'Seated upon a bronze plinth rests a towering knight whose gorget has fused seamlessly into a cast bronze bell-helm. Mountain wind draws a low, grieving ring from his visor while gauntleted fingers rest across a notched greatblade.',
        greeting: (state) => {
          const base =
            'Beneath a great bronze bell-helm, Sir Vorne grips his massive cleaver without rising.';
          return appendReaction(base, state, 'sir_vorne_npc');
        },
        anatomy: {
          height: 'Towering',
          weight: 'Heavy',
          skinColor: 'Hidden Under Plate',
          hairLength: 'None',
          hairStyle: 'None',
          hairColor: 'None',
          eyeShape: 'Narrow',
          eyeColor: 'Shadowed',
          musculature: 'Hulking',
          bodyShape: 'Broad-Chested',
          facialScars: 'Unmarked',
          bodyScars: 'Old Spear-Mark',
          faceDetail: 'Only cold shadow answers behind the slit of his fused bronze bell-helm.',
          chestTorsoDetail: 'Massive green-tarnished pauldrons and breastplate stand weathered by mountain wind.',
          armsHandsDetail: 'Gauntleted hands rest lightly across the pommel of a bronze greatblade.',
          legsStanceDetail: 'Greaved legs sit straight and motionless upon the stone plinth.',
          distinguishingMark: 'The mountain gale rings faintly off his cast bronze helm.',
          visibleTags: ['humanoid', 'towering', 'armored'],
        },
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
    sensorySummary:
      'A drowned stone amphitheater cradling an immense upside-down bronze bell. Living white roots braid a high throne directly beneath its trembling rim.',
    firstSightProse: () =>
      'The tunnel opens onto the rim of a colossal sunken amphitheater flooded with shallow, mirror-black ash-water. Suspended upside-down across the pit hangs a bronze bell vast as a keep, humming softly over a living throne of braided white roots.',
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
