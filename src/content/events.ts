import type { EventCard, GameState } from '../types.ts';
import { resolveCheck } from '../dice.ts';
import { adjustFaction, hasFlag, pronouns, recordChronicle, setFlag } from '../memory.ts';
import { addItemToInventory, consumeInventoryItem } from '../combat.ts';

function hasItem(state: GameState, itemId: string): boolean {
  return state.player.inventory.some((e) => e.id === itemId && e.qty > 0);
}

export const EVENTS: EventCard[] = [
  {
    id: 'kale_deserter',
    title: 'Kale the Oath-Breaker',
    locations: ['kings_causeway'],
    weight: 3,
    condition: (state) => !hasFlag(state, 'kale_fate'),
    prompt: (state) =>
      `Half-hidden under a broken mile-stone kneels Kale, an Iron-Vow deserter clutching a chalky white rash creeping up his wrist. "Wait, ${pronouns(state.player.sex).formal.toLowerCase()}, don't call the dogs. I fled when the Watchtower sang, not from cowardice."`,
    choices: [
      {
        id: 'kale_cure',
        label: 'Cure Kale',
        visible: (state) =>
          state.player.race === 'grixi' ||
          state.player.race === 'ael_thalor' ||
          state.player.background === 'shrine_penitent' ||
          hasItem(state, 'poultice'),
        resolve: (state) => {
          const p = state.player;
          if (p.race !== 'grixi' && p.race !== 'ael_thalor' && p.background !== 'shrine_penitent') {
            consumeInventoryItem(state, 'poultice', 1);
          }
          setFlag(state, 'kale_fate', 'redeemed');
          adjustFaction(state, 'iron_vow', -1);
          p.rations += 1;
          recordChronicle(
            state,
            'Spared Kale',
            'Saved the deserter Kale from calcifying; he swore to aid you at the Sunken Belfry.',
            'kale',
          );
          return {
            messages: [
              'Kale gasps as the chalky crust retreats from his veins. He presses travel rations into your pack and swears to meet you on the Belfry gallery.',
            ],
          };
        },
      },
      {
        id: 'kale_execute',
        label: 'Execute',
        resolve: (state) => {
          setFlag(state, 'kale_fate', 'executed');
          adjustFaction(state, 'iron_vow', 1);
          state.player.crowns += 24;
          recordChronicle(
            state,
            'Executed Kale',
            'Took the Iron-Vow bounty on the deserter Kale along the Causeway.',
            'kale',
          );
          return {
            messages: [
              'A clean stroke ends his terror before the Pale Root claims him. You take his iron levy-tag for the garrison bounty.',
            ],
          };
        },
      },
      {
        id: 'kale_rob',
        label: 'Rob',
        resolve: (state) => {
          setFlag(state, 'kale_fate', 'abandoned');
          state.player.crowns += 15;
          addItemToInventory(state, 'fire_pot', 1);
          recordChronicle(
            state,
            'Abandoned Kale',
            'Robbed the infected deserter and left him to hollow on the roadside.',
            'kale',
          );
          return {
            messages: [
              'You wrench his satchel free. Behind you, his coughing turns into a dry, bronze rattle.',
            ],
          };
        },
      },
    ],
  },

  {
    id: 'husk_kale_ambush',
    title: 'The Hollowed Betrayer',
    locations: ['kings_causeway', 'ash_fen', 'petrified_starwood'],
    weight: 4,
    condition: (state) => hasFlag(state, 'kale_fate', 'abandoned') && !hasFlag(state, 'kale_husk_slain'),
    prompt: () =>
      'Pale roots drag a broken mail-shirt out of the ditch. Kale\'s jaw hangs unhinged, rattling a bronze echo from his chest.',
    choices: [
      {
        id: 'fight_husk_kale',
        label: 'Draw Steel',
        resolve: () => ({
          messages: ['Husk-Stalker Kale lunges from the ditch.'],
          startCombat: {
            enemyId: 'husk_kale',
            canFlee: true,
            onVictoryFlag: 'kale_husk_slain',
            onVictoryChronicle: {
              title: 'Laid Husk-Kale Rest',
              summary: 'Put down the monster Kale became after being abandoned.',
              tag: 'kale',
            },
          },
        }),
      },
    ],
  },

  {
    id: 'silk_assassin_ambush',
    title: 'Whisper on the Silk-Wind',
    locations: ['kings_causeway', 'ash_fen', 'petrified_starwood', 'crown_watchtower'],
    weight: 4,
    condition: (state) => hasFlag(state, 'stole_cistern_vesper') && !hasFlag(state, 'silk_assassin_slain'),
    prompt: () =>
      'A silver wire sings past your ear and snaps into a milestone. From the mist steps a veiled Cistern hunter bearing twin Vesper-glass stilettos.',
    choices: [
      {
        id: 'fight_silk_assassin',
        label: 'Draw Steel',
        resolve: () => ({
          messages: ['The Cistern Vengeance darts out of the fog.'],
          startCombat: {
            enemyId: 'silk_assassin',
            canFlee: true,
            onVictoryFlag: 'silk_assassin_slain',
            onVictoryChronicle: {
              title: 'Survived Vengeance',
              summary: 'Slew the veiled assassin sent by the Silken Cistern.',
              tag: 'dark',
            },
          },
        }),
      },
    ],
  },

  {
    id: 'press_gang',
    title: 'The Iron-Vow Press-Gang',
    locations: ['kings_causeway', 'ash_fen'],
    weight: 2,
    prompt: (state) => {
      if (state.player.sex === 'female') {
        return 'Grim pike-levies block the culvert. Their sergeant spits into the ash: "No lone woman wanders past Cinderford without a pass or a toll."';
      }
      return 'Grim pike-levies block the culvert. Their sergeant taps an Iron-Vow roll: "Every able man owes silver or wall-service, traveler."';
    },
    choices: [
      {
        id: 'pg_vaelorian_charter',
        label: 'Flash Charter',
        visible: (state) => state.player.race === 'vaelorian',
        resolve: (state) => {
          adjustFaction(state, 'iron_vow', 1);
          state.player.torches += 1;
          return {
            messages: [
              'You bare your ancestral kiln-scar and rattle off the Vaelish March-Code. The sergeant snaps upright, hands over a spare pitch-torch, and waves you through.',
            ],
          };
        },
      },
      {
        id: 'pg_grixi_audit',
        label: 'Guild Audit',
        visible: (state) => state.player.race === 'grixi',
        resolve: (state) => {
          adjustFaction(state, 'under_warren', 1);
          state.player.crowns += 10;
          return {
            messages: [
              'You flash a stamped brass guild-seal and threaten a salt-ration audit on their captain. Nervous, the sergeant pays a road courier fee to keep quiet.',
            ],
          };
        },
      },
      {
        id: 'pg_pay',
        label: 'Pay Toll',
        enabled: (state) => ({ ok: state.player.crowns >= 8, reason: 'Insufficient Crowns' }),
        resolve: (state) => {
          state.player.crowns -= 8;
          return { messages: ['You toss silver onto their drumhead and pass without bloodshed.'] };
        },
      },
      {
        id: 'pg_intimidate',
        label: 'Outface',
        resolve: (state) => {
          const check = resolveCheck(state, 'might', 13, { label: 'Outface Press-Gang' });
          if (check.success) {
            adjustFaction(state, 'iron_vow', 1);
            return {
              messages: [check.logLine, 'Seeing cold steel in your eyes, the sergeant steps aside in silence.'],
            };
          }
          return {
            messages: [check.logLine, 'Two hollowed brigands break ranks and charge with halberds.'],
            startCombat: { enemyIds: ['iron_deserter', 'ash_hound'], canFlee: true },
          };
        },
      },
    ],
  },

  {
    id: 'mourning_widow',
    title: 'The Widow of Barrow-Downs',
    locations: ['weeping_barrow', 'cinderford', 'kings_causeway'],
    weight: 2,
    prompt: (state) =>
      state.player.sex === 'female'
        ? 'Beside a slate cairn kneels a hooded woman weaving pale hair into a bell-cord. Seeing another woman on the road, she beckons softly: "Sister, hold the lantern while I finish this knot."'
        : 'Beside a slate cairn kneels a hooded woman weaving pale hair into a bell-cord. She pulls her shawl tight as you approach: "Keep your distance, stranger. Men only walk this road with shovels or taxes."',
    choices: [
      {
        id: 'mw_sisterhood',
        label: 'Sit Quietly',
        visible: (state) => state.player.sex === 'female',
        resolve: (state) => {
          state.player.focus = Math.min(state.player.maxFocus, state.player.focus + 4);
          addItemToInventory(state, 'poultice', 1);
          return {
            messages: [
              'She murmurs old hearth-prayers while binding the stone, then presses dried bog-heal into your belt.',
            ],
          };
        },
      },
      {
        id: 'mw_penitent_rite',
        label: 'Unbind',
        visible: (state) =>
          state.player.background === 'shrine_penitent' || state.player.race === 'ael_thalor',
        resolve: (state) => {
          adjustFaction(state, 'silken_cistern', 1);
          state.player.xp += 12;
          return {
            messages: [
              'Your quiet litany stills the creeping root-threads beneath the cairn. The widow bows deeply in wordless peace.',
            ],
          };
        },
      },
      {
        id: 'mw_offer_ration',
        label: 'Leave Bread',
        enabled: (state) => ({ ok: state.player.rations >= 1, reason: 'No rations' }),
        resolve: (state) => {
          state.player.rations -= 1;
          state.player.xp += 10;
          return {
            messages: ['You lay salted bread upon the stone. Her quiet nod follows you into the mist.'],
          };
        },
      },
      {
        id: 'mw_pass',
        label: 'Pass',
        resolve: () => ({
          messages: ['You leave the widow to her silent vigil.'],
        }),
      },
    ],
  },

  {
    id: 'chitin_vent_cache',
    title: 'Collapsed Chitin-Vent',
    locations: ['ash_fen', 'drowned_forge', 'weeping_barrow'],
    weight: 2,
    prompt: () =>
      'Beneath an uprooted birch yawns a tight brass-lined ventilation flue smelling of lamp-oil and ozone. Something glints three arm-lengths down through pale webbing.',
    choices: [
      {
        id: 'cv_grixi',
        label: 'Crawl Flue',
        visible: (state) => state.player.race === 'grixi',
        resolve: (state) => {
          state.player.crowns += 18;
          addItemToInventory(state, 'vesper_tonic', 1);
          return {
            messages: [
              'Built for narrow warren ducts, you slip clean past the spore-pods and lift an intact surveyor tin.',
            ],
          };
        },
      },
      {
        id: 'cv_durnfolk',
        label: 'Crack Stone',
        visible: (state) => state.player.race === 'durnfolk',
        resolve: (state) => {
          state.player.crowns += 16;
          addItemToInventory(state, 'fire_pot', 1);
          return {
            messages: [
              'One calculated hammer-tap splits the collar stone without waking the nest below.',
            ],
          };
        },
      },
      {
        id: 'cv_reach',
        label: 'Reach In',
        resolve: (state) => {
          const check = resolveCheck(state, 'agility', 13, { label: 'Vent Cache' });
          if (check.success) {
            state.player.crowns += 14;
            return { messages: [check.logLine, 'You hook a leather coin purse clear of the webbing.'] };
          }
          return {
            messages: [check.logLine, 'Your sleeve tears open a web-sac and wakes a nest of weavers.'],
            startCombat: { enemyIds: ['chitin_weaver', 'chitin_weaver'], canFlee: true },
          };
        },
      },
      {
        id: 'cv_leave',
        label: 'Leave',
        resolve: () => ({ messages: ['Better not to disturb sleeping tunnels.'] }),
      },
    ],
  },

  {
    id: 'deep_vitriol_gamble',
    title: "The Deep-Delver's Camp",
    locations: ['drowned_forge', 'ash_fen', 'kings_causeway'],
    weight: 2,
    prompt: () =>
      'Two soot-streaked prospectors huddle over a smoking slate stove, passing a stone jug of green forge-vitriol. "Half a purse says it melts your gullet, traveler."',
    choices: [
      {
        id: 'dv_durnfolk',
        label: 'Drink Deep',
        visible: (state) => state.player.race === 'durnfolk',
        resolve: (state) => {
          state.player.crowns += 22;
          state.player.stamina = state.player.maxStamina;
          return {
            messages: [
              'The copper-laced liquor warms your stone ribs like spiced milk. The prospectors slap down their bet in awe.',
            ],
          };
        },
      },
      {
        id: 'dv_grit',
        label: 'Wager',
        resolve: (state) => {
          const check = resolveCheck(state, 'grit', 14, { label: 'Forge Vitriol' });
          if (check.success) {
            state.player.crowns += 20;
            return { messages: [check.logLine, 'Eyes watering, you slam the horn down upright and claim their silver.'] };
          }
          state.player.hp = Math.max(1, state.player.hp - 5);
          return {
            messages: [check.logLine, 'Liquid fire tears down your throat as they laugh over the empty cup.'],
          };
        },
      },
      {
        id: 'dv_trade_rumors',
        label: 'Warm Up',
        resolve: (state) => {
          state.player.stamina = Math.min(state.player.maxStamina, state.player.stamina + 2);
          return {
            messages: ['You share trail warnings over the hot stove and catch your breath.'],
          };
        },
      },
    ],
  },

  {
    id: 'singing_saplings',
    title: 'Singing Saplings',
    locations: ['petrified_starwood', 'ash_fen', 'crown_watchtower'],
    weight: 2,
    prompt: () =>
      'Three pale saplings shaped like kneeling ribs hum in soft three-part harmony across the trail. Listening too long makes your teeth ache.',
    choices: [
      {
        id: 'ss_ael_thalor',
        label: 'Sing',
        visible: (state) => state.player.race === 'ael_thalor',
        resolve: (state) => {
          state.player.focus = Math.min(state.player.maxFocus, state.player.focus + 4);
          state.player.xp += 14;
          return {
            messages: [
              'You weave an elder twilight counterpoint. The saplings curl shut like sleeping ferns, leaving quiet focus.',
            ],
          };
        },
      },
      {
        id: 'ss_burn',
        label: 'Burn Shoots',
        visible: (state) => state.player.abilities.includes('kiln_spark') || state.player.torches > 0,
        resolve: (state) => {
          if (!state.player.abilities.includes('kiln_spark')) {
            state.player.torches -= 1;
          }
          addItemToInventory(state, 'husk_gland', 1);
          return {
            messages: [
              'Ash-fire blackens the humming stems cleanly, leaving a crystallized spore gland in the soot.',
            ],
          };
        },
      },
      {
        id: 'ss_endure',
        label: 'Sprint Past',
        resolve: (state) => {
          const check = resolveCheck(state, 'grit', 12, { label: 'Choir Harmonics' });
          if (check.success) {
            return { messages: [check.logLine, 'You clear the glade before the resonance bites.'] };
          }
          return {
            messages: [check.logLine, 'The humming draws two Root-Husks out of the brush.'],
            startCombat: { enemyIds: ['root_husk', 'root_husk'], canFlee: true },
          };
        },
      },
    ],
  },

  {
    id: 'imperial_courier_coffer',
    title: "The Courier's Coffer",
    locations: ['kings_causeway', 'weeping_barrow', 'crown_watchtower'],
    weight: 2,
    prompt: () =>
      'Half-buried beneath a rotted saddlebag lies a bronze dispatch box sealed with triple High Vaelish wax. Faint wards still prickle across the keyhole.',
    choices: [
      {
        id: 'ic_vaelorian',
        label: 'Break Seal',
        visible: (state) => state.player.race === 'vaelorian',
        resolve: (state) => {
          state.player.crowns += 24;
          addItemToInventory(state, 'vesper_tonic', 1);
          return {
            messages: [
              'Knowing the old dynasty finger-press, you disarm the needle ward cleanly and empty the box.',
            ],
          };
        },
      },
      {
        id: 'ic_pick',
        label: 'Pick Lock',
        resolve: (state) => {
          const check = resolveCheck(state, 'agility', 13, {
            label: 'Vaelish Ward',
            isCraftOrStealth: true,
          });
          if (check.success) {
            state.player.crowns += 22;
            return { messages: [check.logLine, 'The ward clicks slack, yielding intact courier silver.'] };
          }
          state.player.hp = Math.max(1, state.player.hp - 5);
          return {
            messages: [check.logLine, 'A spring-needle snaps into your knuckle and spoils the lock.'],
          };
        },
      },
      {
        id: 'ic_leave',
        label: 'Leave',
        resolve: () => ({ messages: ['Dead empires leave sharp traps. You leave it in the mud.'] }),
      },
    ],
  },

  {
    id: 'hollow_bride_shrine',
    title: 'The Veil-Wreath Shrine',
    locations: ['petrified_starwood', 'weeping_barrow', 'ash_fen'],
    weight: 2,
    prompt: (state) =>
      state.player.sex === 'female'
        ? 'An ivy-choked stone maiden holds out an empty wooden bowl. Faint silver whispers greet your step: "Daughter of the Reach, leave bronze or breath."'
        : 'An ivy-choked stone maiden holds out an empty wooden bowl. Its hollow eyes gleam coldly at a male traveler: "Pay the toll of iron, trespasser."',
    choices: [
      {
        id: 'hb_pray_female',
        label: 'Touch Veil',
        visible: (state) => state.player.sex === 'female',
        resolve: (state) => {
          state.player.hp = Math.min(state.player.maxHp, state.player.hp + 6);
          state.player.statuses.push({ type: 'blessed', turns: 4, power: 2 });
          return {
            messages: ['Warm silver light traces your palm, easing wounds and steadying your hand.'],
          };
        },
      },
      {
        id: 'hb_coin',
        label: 'Drop Coin',
        enabled: (state) => ({ ok: state.player.crowns >= 5, reason: 'Insufficient Crowns' }),
        resolve: (state) => {
          state.player.crowns -= 5;
          state.player.focus = Math.min(state.player.maxFocus, state.player.focus + 3);
          return { messages: ['The stone chimes softly in answer, restoring clear focus.'] };
        },
      },
      {
        id: 'hb_loot',
        label: 'Steal Ring',
        resolve: (state) => {
          state.player.crowns += 18;
          adjustFaction(state, 'husk_choir', 1);
          state.player.statuses.push({ type: 'blighted', turns: 2, power: 2 });
          return {
            messages: [
              'The silver ring snaps free, though cold spore-dust puffs into your lungs.',
            ],
          };
        },
      },
    ],
  },

  {
    id: 'under_warren_broker',
    title: 'The Brass-Lantern Smuggler',
    locations: ['ash_fen', 'drowned_forge', 'kings_causeway'],
    weight: 2,
    prompt: () =>
      'A hunched lantern-peddler squats atop a drainage pipe, rattling a string of brass tags. A Grixi brass-guild emblem hangs around his neck.',
    choices: [
      {
        id: 'uw_grixi',
        label: 'Guild Cut',
        visible: (state) => state.player.race === 'grixi',
        resolve: (state) => {
          adjustFaction(state, 'under_warren', 2);
          addItemToInventory(state, 'fire_pot', 1);
          state.player.crowns += 12;
          return {
            messages: [
              'Two sharp finger-clicks establish guild seniority. He splits his salvage purse with you.',
            ],
          };
        },
      },
      {
        id: 'uw_buy_ration',
        label: 'Buy Supplies',
        enabled: (state) => ({ ok: state.player.crowns >= 12, reason: 'Insufficient Crowns' }),
        resolve: (state) => {
          state.player.crowns -= 12;
          state.player.rations += 2;
          state.player.torches += 1;
          return { messages: ['Fair weight, dry bacon, and a fresh pitch-torch.'] };
        },
      },
      {
        id: 'uw_sell_gland',
        label: 'Sell Gland',
        visible: (state) => hasItem(state, 'husk_gland'),
        resolve: (state) => {
          consumeInventoryItem(state, 'husk_gland', 1);
          state.player.crowns += 26;
          adjustFaction(state, 'under_warren', 1);
          return { messages: ['His eyes shine behind brass goggles as he counts out silver for the gland.'] };
        },
      },
      {
        id: 'uw_nod',
        label: 'Pass',
        resolve: () => ({ messages: ['He tips his lantern and vanishes back down the pipe.'] }),
      },
    ],
  },

  {
    id: 'ash_hound_pack',
    title: 'Cinder-Maw Pack',
    locations: ['kings_causeway', 'weeping_barrow', 'petrified_starwood'],
    weight: 2,
    prompt: () =>
      'Grey embers drift from behind an overturned cart as two gaunt, ember-breathed hounds pad into the trail, ears flattened.',
    choices: [
      {
        id: 'ah_ration',
        label: 'Toss Ration',
        enabled: (state) => ({ ok: state.player.rations >= 1, reason: 'No rations' }),
        resolve: (state) => {
          state.player.rations -= 1;
          return { messages: ['They snap over the salted meat and melt back into the fog.'] };
        },
      },
      {
        id: 'ah_fight',
        label: 'Draw Steel',
        resolve: () => ({
          messages: ['Two Cinder-Maw Hounds lunge through the smoke.'],
          startCombat: { enemyIds: ['ash_hound', 'ash_hound'], canFlee: true },
        }),
      },
    ],
  },

  {
    id: 'choir_procession',
    title: 'Lanternless Choir',
    locations: ['petrified_starwood', 'crown_watchtower', 'drowned_forge'],
    weight: 2,
    prompt: () =>
      'A Choir Acolyte swings a smoking censer along the ridge road while a shambling Root-Husk trails behind, muttering the Third Toll countdown.',
    choices: [
      {
        id: 'cp_ambush',
        label: 'Ambush',
        resolve: () => ({
          messages: ['You rush the chanting pair in the mist.'],
          startCombat: { enemyIds: ['blight_acolyte', 'root_husk'], canFlee: true },
        }),
      },
      {
        id: 'cp_stealth',
        label: 'Slip Past',
        resolve: (state) => {
          const check = resolveCheck(state, 'agility', 13, {
            label: 'Choir Patrol',
            isCraftOrStealth: true,
          });
          if (check.success) {
            return { messages: [check.logLine, 'You hold your breath until the bell-smoke fades.'] };
          }
          return {
            messages: [check.logLine, 'Loose slate clatters and draws the chanting pair straight toward you.'],
            startCombat: { enemyIds: ['blight_acolyte', 'root_husk'], canFlee: true },
          };
        },
      },
    ],
  },

  {
    id: 'lost_pilgrim_wagon',
    title: 'Overturned Cart',
    locations: ['kings_causeway', 'ash_fen'],
    weight: 2,
    prompt: () =>
      'A broken pilgrim handcart lies half-sunk in axle mud, its canvas flapping like torn skin.',
    choices: [
      {
        id: 'lp_salvage',
        label: 'Salvage',
        resolve: (state) => {
          state.player.rations += 1;
          state.player.torches += 1;
          addItemToInventory(state, 'poultice', 1);
          return { messages: ['Beneath soaked blankets you rescue rations, a torch, and a clean poultice.'] };
        },
      },
      {
        id: 'lp_scholar',
        label: 'Read Notes',
        visible: (state) => state.player.background === 'root_scholar',
        resolve: (state) => {
          state.player.xp += 15;
          state.player.focus = state.player.maxFocus;
          return {
            messages: ['Margin notes on Belfry harmonics sharpen your focus cleanly.'],
          };
        },
      },
    ],
  },

  {
    id: 'whispering_bell_post',
    title: 'The Cracked Bell-Post',
    locations: ['weeping_barrow', 'crown_watchtower', 'petrified_starwood'],
    weight: 2,
    prompt: () =>
      'An iron gibbet-post holds a small, green-tarnished warning bell that rings softly even though the air is dead still.',
    choices: [
      {
        id: 'wbp_silence',
        label: 'Muffle Bell',
        resolve: (state) => {
          state.player.xp += 12;
          adjustFaction(state, 'husk_choir', -1);
          return {
            messages: [
              'The discordant hum dies immediately. Somewhere beneath the earth, a distant echo falters.',
            ],
          };
        },
      },
      {
        id: 'wbp_listen',
        label: 'Listen',
        resolve: (state) => {
          const check = resolveCheck(state, 'wit', 13, {
            label: 'Bell Harmonics',
            isLoreOrPerception: true,
          });
          if (check.success) {
            state.player.maxFocus += 1;
            state.player.focus += 1;
            return { messages: [check.logLine, 'You map the subtle under-notes, deepening your focus.'] };
          }
          state.player.hp = Math.max(1, state.player.hp - 3);
          return { messages: [check.logLine, 'A sudden toll splits your eardrums with blind pain.'] };
        },
      },
    ],
  },

  {
    id: 'calcified_sentinel',
    title: 'The Stone-Knight',
    locations: ['crown_watchtower', 'drowned_forge'],
    weight: 2,
    prompt: () =>
      'A soldier fused mid-prayer into pale limestone sits blocking a narrow ledge. Still clasped in stony fingers gleams an intact flask.',
    choices: [
      {
        id: 'cs_pry',
        label: 'Pry Flask',
        resolve: (state) => {
          const check = resolveCheck(state, 'might', 12, { label: 'Stone Fingers' });
          if (check.success) {
            addItemToInventory(state, 'stamina_draught', 1);
            state.player.crowns += 10;
            return { messages: [check.logLine, 'You free the iron-root draught and tucked silver.'] };
          }
          return {
            messages: [check.logLine, 'The limestone shatters and wakes two lurking Root-Husks.'],
            startCombat: { enemyIds: ['root_husk', 'root_husk'], canFlee: true },
          };
        },
      },
      {
        id: 'cs_respect',
        label: 'Salute',
        resolve: (state) => {
          state.player.stamina = Math.min(state.player.maxStamina, state.player.stamina + 2);
          return { messages: ['Steady breathing returns in the quiet pass.'] };
        },
      },
    ],
  },

  {
    id: 'grixi_scrap_cart',
    title: 'Brass-Warren Cart',
    locations: ['ash_fen', 'drowned_forge'],
    weight: 2,
    prompt: () =>
      'A low iron-wheeled handcart sits wedged between mossy boulders, stamped with Under-Warren guild runes.',
    choices: [
      {
        id: 'gsc_loot',
        label: 'Loot Tools',
        resolve: (state) => {
          state.player.crowns += state.player.race === 'grixi' ? 20 : 12;
          addItemToInventory(state, 'antitoxin', 1);
          addItemToInventory(state, 'bog_herb', 1);
          return {
            messages: ['You salvage intact silver, bog herbs, and an antitoxin from the hidden drawer.'],
          };
        },
      },
    ],
  },

  {
    id: 'star_glass_obelisk',
    title: 'Star-Glass Obelisk',
    locations: ['weeping_barrow', 'petrified_starwood'],
    weight: 2,
    prompt: () =>
      'A jagged shard of midnight glass juts from the earth, still holding reflections of stars invisible behind the valley cloud-bank.',
    choices: [
      {
        id: 'sgo_commune',
        label: 'Touch Glass',
        resolve: (state) => {
          state.player.focus = Math.min(state.player.maxFocus, state.player.focus + 4);
          return { messages: ['Starlight-cold clarity fills your veins, restoring focus.'] };
        },
      },
      {
        id: 'sgo_chip',
        label: 'Chip Shard',
        resolve: (state) => {
          state.player.hp = Math.max(1, state.player.hp - 2);
          state.player.crowns += 15;
          return { messages: ['The glass nicks your palm while yielding a gleaming silver-worth sliver.'] };
        },
      },
    ],
  },
];
