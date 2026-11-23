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
      `Half-hidden under a broken mile-stone kneels Kale, an Iron-Vow deserter clutching a chalky white rash creeping up his wrist. "Wait, ${pronouns(state.player.sex).formal.toLowerCase()}... don't call the dogs. I fled when the Watchtower sang, not from cowardice."`,
    choices: [
      {
        id: 'kale_cure_grixi_or_magic',
        label: '[Cure] Purge his pale-root rot with racial craft, miracle, or Poultice',
        tag: 'Grixi / Ael-Thalor / Penitent / Poultice',
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
            'Spared and Cured Kale',
            'Saved the deserter Kale from calcifying; he swore to repay the debt at the Sunken Belfry.',
            'kale',
          );
          return {
            messages: [
              'Kale gasps as the creeping chalk-crust shrivels back from his veins. He presses a dry travel pack into your hand (+1 Ration) and whispers: "When you reach the Sunken Belfry, look to the upper gallery. I will break their choir-ward for you."',
            ],
          };
        },
      },
      {
        id: 'kale_execute',
        label: 'Deliver the Iron-Vow Justice & Claim His Bounty Tag',
        tag: 'Iron-Vow +1, +24 Crowns',
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
              'A single clean stroke ends his terror before the Pale Root claims him. You collect his iron levy-tag (+24 Crowns, +1 Iron-Vow).',
            ],
          };
        },
      },
      {
        id: 'kale_rob',
        label: 'Strip His Satchel and Leave Him to the Root',
        tag: 'Cruel (+15 Crowns, +1 Fire-Pot)',
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
              'You wrench his satchel free (+15 Crowns, +1 Fire-Pot). His coughing turns into a low, bronze rattle behind you.',
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
      'Pale roots drag a broken mail-shirt out of the ditch. Kale\'s jaw hangs unhinged, rattling a bronze echo from his chest: "You left... the satchel..."',
    choices: [
      {
        id: 'fight_husk_kale',
        label: 'Draw Steel Against Husk-Stalker Kale',
        resolve: () => ({
          messages: ['Husk-Stalker Kale lunges from the ditch!'],
          startCombat: {
            enemyId: 'husk_kale',
            canFlee: true,
            onVictoryFlag: 'kale_husk_slain',
            onVictoryChronicle: {
              title: 'Laid Husk-Kale to Rest',
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
      'A silver wire sings past your ear and snaps into a milestone. From the mist steps a veiled Cistern hunter bearing twin Vesper-glass stilettos: "The Matrons remember every drop."',
    choices: [
      {
        id: 'fight_silk_assassin',
        label: 'Meet the Cistern Silk-Vengeance Blade to Blade',
        resolve: () => ({
          messages: ['The Silk-Vengeance darts out of the fog!'],
          startCombat: {
            enemyId: 'silk_assassin',
            canFlee: true,
            onVictoryFlag: 'silk_assassin_slain',
            onVictoryChronicle: {
              title: 'Survived Cistern Vengeance',
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
      const p = state.player;
      if (p.sex === 'female') {
        return 'Four grim pike-levies block the culvert. Their sergeant spits into the ash: "No lone woman wanders past Cinderford without a travel-pass or a heavy toll."';
      }
      return 'Four grim pike-levies block the culvert. Their sergeant taps an Iron-Vow conscription roll: "Every able man owes five silver or three days on the wall, traveler."';
    },
    choices: [
      {
        id: 'pg_vaelorian_charter',
        label: '[Vaelorian] Present Your Imperial Blood-Charter & Command Passage',
        tag: 'Vaelorian Only',
        visible: (state) => state.player.race === 'vaelorian',
        resolve: (state) => {
          adjustFaction(state, 'iron_vow', 1);
          state.player.torches += 1;
          return {
            messages: [
              '[Vaelorian] You bare your ancestral kiln-scar and rattle off the Vaelish March-Code. The sergeant snaps upright, hands over a spare pitch-torch (+1 Torch, +1 Iron-Vow), and waves you through.',
            ],
          };
        },
      },
      {
        id: 'pg_grixi_audit',
        label: '[Grixi] Cite Under-Warren Transit Tariff & Out-Bamboozle the Sergeant',
        tag: 'Grixi Only',
        visible: (state) => state.player.race === 'grixi',
        resolve: (state) => {
          adjustFaction(state, 'under_warren', 1);
          state.player.crowns += 10;
          return {
            messages: [
              '[Grixi] You pull a stamped brass guild-seal and threaten an immediate salt-ration audit on their captain. Nervous, the sergeant pays you a "road courier fee" (+10 Crowns) to keep quiet.',
            ],
          };
        },
      },
      {
        id: 'pg_pay',
        label: 'Pay the Road Toll (8 Crowns)',
        enabled: (state) => ({ ok: state.player.crowns >= 8, reason: 'Need 8 Crowns' }),
        resolve: (state) => {
          state.player.crowns -= 8;
          return { messages: ['You toss 8 Crowns onto their drumhead and pass without bloodshed.'] };
        },
      },
      {
        id: 'pg_intimidate',
        label: 'Face Down the Sergeant (Might DC 13)',
        resolve: (state) => {
          const check = resolveCheck(state, 'might', 13, { label: 'Outface Press-Gang' });
          if (check.success) {
            adjustFaction(state, 'iron_vow', 1);
            return {
              messages: [check.logLine, 'Seeing steel in your eyes, the sergeant steps aside in silence.'],
            };
          }
          return {
            messages: [check.logLine, '"Then bleed for the toll!" A hollowed brigand breaks ranks!'],
            startCombat: { enemyId: 'iron_deserter', canFlee: true },
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
    prompt: (state) => {
      const p = state.player;
      return p.sex === 'female'
        ? 'Beside a cairn of slate stones kneels a hooded woman weaving pale hair into a bell-cord. Seeing another woman on the cursed road, she beckons softly: "Sister, hold the lantern a moment so I may finish my husband\'s knot."'
        : 'Beside a cairn of slate stones kneels a hooded woman weaving pale hair into a bell-cord. She pulls her shawl tight as you approach: "Keep your distance, stranger. Men only come down this road with shovels or taxes."';
    },
    choices: [
      {
        id: 'mw_sisterhood',
        label: '[Female] Sit Beside Her and Share a Quiet Blessing',
        tag: 'Female Only',
        visible: (state) => state.player.sex === 'female',
        resolve: (state) => {
          state.player.focus = Math.min(state.player.maxFocus, state.player.focus + 4);
          addItemToInventory(state, 'poultice', 1);
          return {
            messages: [
              'She murmurs old hearth-prayers while binding the stone. In gratitude she presses a bundle of dried bog-heal into your belt (+1 Poultice, +4 Focus).',
            ],
          };
        },
      },
      {
        id: 'mw_penitent_rite',
        label: '[Shrine-Penitent / Ael-Thalor] Sing the Unbinding Litany Over the Cairn',
        tag: 'Class / Race',
        visible: (state) =>
          state.player.background === 'shrine_penitent' || state.player.race === 'ael_thalor',
        resolve: (state) => {
          adjustFaction(state, 'silken_cistern', 1);
          state.player.xp += 12;
          return {
            messages: [
              'Your quiet litany stills the creeping root-threads beneath the cairn. The widow bows deeply in wordless peace (+12 XP, +1 Silken Cistern).',
            ],
          };
        },
      },
      {
        id: 'mw_offer_ration',
        label: 'Leave 1 Ration by the Cairn & Move On',
        enabled: (state) => ({ ok: state.player.rations >= 1, reason: 'Need 1 Ration' }),
        resolve: (state) => {
          state.player.rations -= 1;
          state.player.xp += 10;
          return {
            messages: ['You lay salted bread upon the stone (-1 Ration). Her quiet nod follows you into the mist (+10 XP).'],
          };
        },
      },
      {
        id: 'mw_pass',
        label: 'Tip Your Hat and Continue Onward',
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
      'Beneath an uprooted birch yawns a tight brass-lined ventilation flue smelling of lamp-oil and ozone. Something glints three arm-lengths down, though the shaft is choked with pale webbing.',
    choices: [
      {
        id: 'cv_grixi',
        label: '[Grixi] Squeeze Inside Through the Narrow Chitin-Flue',
        tag: 'Grixi Only',
        visible: (state) => state.player.race === 'grixi',
        resolve: (state) => {
          state.player.crowns += 18;
          addItemToInventory(state, 'vesper_tonic', 1);
          return {
            messages: [
              '[Grixi] Built for narrow warren ducts, you slip clean past the spore-pods and lift a surveyor\'s tin (+18 Crowns, +1 Vesper Tonic).',
            ],
          };
        },
      },
      {
        id: 'cv_durnfolk',
        label: '[Durnfolk] Crack the Masonry Keystone Cleanly',
        tag: 'Durnfolk Only',
        visible: (state) => state.player.race === 'durnfolk',
        resolve: (state) => {
          state.player.crowns += 16;
          addItemToInventory(state, 'fire_pot', 1);
          return {
            messages: [
              '[Durnfolk] One calculated hammer-tap splits the collar stone without waking the nest (+16 Crowns, +1 Fire-Pot).',
            ],
          };
        },
      },
      {
        id: 'cv_reach',
        label: 'Reach Blindly into the Webbed Shaft (Agility DC 13)',
        resolve: (state) => {
          const check = resolveCheck(state, 'agility', 13, { label: 'Snatch Vent Cache' });
          if (check.success) {
            state.player.crowns += 14;
            return { messages: [check.logLine, 'You hook a leather purse free (+14 Crowns)!'] };
          }
          return {
            messages: [check.logLine, 'Your sleeve tears open a web-sac — a Chitin-Weaver Drone scrambles out!'],
            startCombat: { enemyId: 'chitin_weaver', canFlee: true },
          };
        },
      },
      {
        id: 'cv_leave',
        label: 'Leave the Shaft Undisturbed',
        resolve: () => ({ messages: ['Better not to poke sleeping tunnels.'] }),
      },
    ],
  },

  {
    id: 'deep_vitriol_gamble',
    title: "The Deep-Delver's Vitriol Camp",
    locations: ['drowned_forge', 'ash_fen', 'kings_causeway'],
    weight: 2,
    prompt: () =>
      'Two soot-streaked prospectors huddle over a smoking slate stove, passing a stone jug of green forge-vitriol. "Care to wet your whistle, traveler? Half a purse says it melts your gullet."',
    choices: [
      {
        id: 'dv_durnfolk',
        label: '[Durnfolk] Down the Whole Horn Without Blinking (Stone-Lung)',
        tag: 'Durnfolk Only',
        visible: (state) => state.player.race === 'durnfolk',
        resolve: (state) => {
          state.player.crowns += 22;
          state.player.stamina = state.player.maxStamina;
          return {
            messages: [
              '[Durnfolk] The copper-laced liquor warms your stone ribs like spiced milk. The prospectors slap down their bet in awe (+22 Crowns, Full Stamina).',
            ],
          };
        },
      },
      {
        id: 'dv_grit',
        label: 'Accept the Drinking Wager (Grit DC 14, Win 20c or -5 HP)',
        resolve: (state) => {
          const check = resolveCheck(state, 'grit', 14, { label: 'Stomach Forge-Vitriol' });
          if (check.success) {
            state.player.crowns += 20;
            return { messages: [check.logLine, 'Eyes watering, you slam the horn down upright! (+20 Crowns)'] };
          }
          state.player.hp = Math.max(1, state.player.hp - 5);
          return {
            messages: [check.logLine, 'Liquid fire tears down your throat (-5 HP) as they laugh over their empty cup.'],
          };
        },
      },
      {
        id: 'dv_trade_rumors',
        label: 'Share Trail Rumors and Warm Up Briefly (+2 Stamina)',
        resolve: (state) => {
          state.player.stamina = Math.min(state.player.maxStamina, state.player.stamina + 2);
          return {
            messages: ['They trade warnings about the Drowned Forge sluice-pipes (+2 Stamina).'],
          };
        },
      },
    ],
  },

  {
    id: 'singing_saplings',
    title: 'The Singing Pale-Saplings',
    locations: ['petrified_starwood', 'ash_fen', 'crown_watchtower'],
    weight: 2,
    prompt: () =>
      'Three pale saplings shaped like kneeling ribs hum in soft three-part harmony across the trail. Listening too long makes your teeth ache.',
    choices: [
      {
        id: 'ss_ael_thalor',
        label: '[Ael-Thalor] Harmonize a Memory-Canticle to Quieten the Saplings',
        tag: 'Ael-Thalor Only',
        visible: (state) => state.player.race === 'ael_thalor',
        resolve: (state) => {
          state.player.focus = Math.min(state.player.maxFocus, state.player.focus + 4);
          state.player.xp += 14;
          return {
            messages: [
              '[Ael-Thalor] You weave an elder twilight counterpoint. The saplings curl shut like sleeping ferns, yielding pure focus (+4 Focus, +14 XP).',
            ],
          };
        },
      },
      {
        id: 'ss_burn',
        label: 'Burn the Choir-Shoots with Kiln-Spark or Torch',
        visible: (state) => state.player.abilities.includes('kiln_spark') || state.player.torches > 0,
        resolve: (state) => {
          if (!state.player.abilities.includes('kiln_spark')) {
            state.player.torches -= 1;
          }
          addItemToInventory(state, 'husk_gland', 1);
          return {
            messages: [
              'Ash-fire blackens the humming stems cleanly, leaving a crystallized spore-gland in the soot (+1 Calcified Spore-Gland).',
            ],
          };
        },
      },
      {
        id: 'ss_endure',
        label: 'Plug Your Ears and Sprint Past (Grit DC 12)',
        resolve: (state) => {
          const check = resolveCheck(state, 'grit', 12, { label: 'Resist Choir Harmonics' });
          if (check.success) {
            return { messages: [check.logLine, 'You clear the glade before the resonance bites.'] };
          }
          return {
            messages: [check.logLine, 'The humming draws a Root-Husk Vagrant out of the brush!'],
            startCombat: { enemyId: 'root_husk', canFlee: true },
          };
        },
      },
    ],
  },

  {
    id: 'imperial_courier_coffer',
    title: "The Imperial Courier's Coffer",
    locations: ['kings_causeway', 'weeping_barrow', 'crown_watchtower'],
    weight: 2,
    prompt: () =>
      'Half-buried beneath a rotted saddlebag lies a bronze dispatch box sealed with triple High Vaelish wax. Spells still prickle across the keyhole.',
    choices: [
      {
        id: 'ic_vaelorian',
        label: '[Vaelorian] Break the Seal with the Royal Countersign',
        tag: 'Vaelorian Only',
        visible: (state) => state.player.race === 'vaelorian',
        resolve: (state) => {
          state.player.crowns += 24;
          addItemToInventory(state, 'vesper_tonic', 1);
          return {
            messages: [
              '[Vaelorian] Knowing the old dynasty\'s finger-press, you disarm the needle ward cleanly (+24 Crowns, +1 Vesper Tonic).',
            ],
          };
        },
      },
      {
        id: 'ic_pick',
        label: 'Disarm the Needle-Ward (Agility DC 13)',
        resolve: (state) => {
          const check = resolveCheck(state, 'agility', 13, {
            label: 'Pick Vaelish Ward',
            isCraftOrStealth: true,
          });
          if (check.success) {
            state.player.crowns += 22;
            return { messages: [check.logLine, 'Click. Inside rests courier silver (+22 Crowns)!'] };
          }
          state.player.hp = Math.max(1, state.player.hp - 5);
          return {
            messages: [check.logLine, 'A spring-needle snaps into your knuckle (-5 HP) and spoils the lock!'],
          };
        },
      },
      {
        id: 'ic_leave',
        label: 'Leave the Warded Box Behind',
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
        label: '[Female] Lay a Hand on the Veil & Receive Quiet Grace',
        tag: 'Female Only',
        visible: (state) => state.player.sex === 'female',
        resolve: (state) => {
          state.player.hp = Math.min(state.player.maxHp, state.player.hp + 6);
          state.player.statuses.push({ type: 'blessed', turns: 4, power: 2 });
          return {
            messages: [
              'Warm silver light traces your palm (+6 HP, Blessed +2 to d20 checks!).',
            ],
          };
        },
      },
      {
        id: 'hb_coin',
        label: 'Drop 5 Crowns into the Offering Bowl',
        enabled: (state) => ({ ok: state.player.crowns >= 5, reason: 'Need 5 Crowns' }),
        resolve: (state) => {
          state.player.crowns -= 5;
          state.player.focus = Math.min(state.player.maxFocus, state.player.focus + 3);
          return { messages: ['The stone chimes softly in answer (+3 Focus).'] };
        },
      },
      {
        id: 'hb_loot',
        label: 'Pry the Silver Ring from the Statue\'s Finger (+18 Crowns, Risk Curse)',
        resolve: (state) => {
          state.player.crowns += 18;
          adjustFaction(state, 'husk_choir', 1);
          state.player.statuses.push({ type: 'blighted', turns: 2, power: 2 });
          return {
            messages: [
              'The ring snaps free (+18 Crowns), but cold spore-dust puffs into your lungs (Blighted 2/t, +1 Choir Resonance).',
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
        label: '[Grixi] Flash Under-Cant Cipher & Claim Guild Cut',
        tag: 'Grixi Only',
        visible: (state) => state.player.race === 'grixi',
        resolve: (state) => {
          adjustFaction(state, 'under_warren', 2);
          addItemToInventory(state, 'fire_pot', 1);
          state.player.crowns += 12;
          return {
            messages: [
              '[Grixi] Two sharp finger-clicks establish guild seniority. He splits his salvage purse with you (+12 Crowns, +1 Fire-Pot, +2 Brass-Warren).',
            ],
          };
        },
      },
      {
        id: 'uw_buy_ration',
        label: 'Buy 2 Trail Rations & 1 Torch for 12 Crowns',
        enabled: (state) => ({ ok: state.player.crowns >= 12, reason: 'Need 12 Crowns' }),
        resolve: (state) => {
          state.player.crowns -= 12;
          state.player.rations += 2;
          state.player.torches += 1;
          return { messages: ['Fair weight, dry bacon (+2 Rations, +1 Torch).'] };
        },
      },
      {
        id: 'uw_sell_gland',
        label: 'Sell a Calcified Spore-Gland for 26 Crowns',
        visible: (state) => hasItem(state, 'husk_gland'),
        resolve: (state) => {
          consumeInventoryItem(state, 'husk_gland', 1);
          state.player.crowns += 26;
          adjustFaction(state, 'under_warren', 1);
          return { messages: ['His eyes shine behind brass goggles: "Fresh spore-amber! Here, 26 Crowns!"'] };
        },
      },
      {
        id: 'uw_nod',
        label: 'Pass Quietly',
        resolve: () => ({ messages: ['He tips his lantern and vanishes back down the pipe.'] }),
      },
    ],
  },

  {
    id: 'ash_hound_pack',
    title: 'Cinder-Maw Stalker',
    locations: ['kings_causeway', 'weeping_barrow', 'petrified_starwood'],
    weight: 2,
    prompt: () =>
      'Grey embers drift from behind an overturned cart as a gaunt, ember-breathed hound pads into the trail, ears flattened.',
    choices: [
      {
        id: 'ah_ration',
        label: 'Toss 1 Ration to Distract the Hound',
        enabled: (state) => ({ ok: state.player.rations >= 1, reason: 'Need 1 Ration' }),
        resolve: (state) => {
          state.player.rations -= 1;
          return { messages: ['It snaps up the salted meat and melts back into the fog.'] };
        },
      },
      {
        id: 'ah_fight',
        label: 'Stand Ready and Strike First',
        resolve: () => ({
          messages: ['The Cinder-Maw Hound lunges through the smoke!'],
          startCombat: { enemyId: 'ash_hound', canFlee: true },
        }),
      },
    ],
  },

  {
    id: 'choir_procession',
    title: 'Lanternless Choir Procession',
    locations: ['petrified_starwood', 'crown_watchtower', 'drowned_forge'],
    weight: 2,
    prompt: () =>
      'A lone Choir-Bell Acolyte swings a smoking censer along the ridge road, muttering the Third Toll countdown.',
    choices: [
      {
        id: 'cp_ambush',
        label: 'Strike Before the Censer Rises',
        resolve: () => ({
          messages: ['You rush the Choir-Bell Acolyte in the mist!'],
          startCombat: { enemyId: 'blight_acolyte', canFlee: true },
        }),
      },
      {
        id: 'cp_stealth',
        label: 'Slip Out of Sight Behind Ruined Masonry (Agility DC 13)',
        resolve: (state) => {
          const check = resolveCheck(state, 'agility', 13, {
            label: 'Evade Choir Acolyte',
            isCraftOrStealth: true,
          });
          if (check.success) {
            return { messages: [check.logLine, 'You hold your breath until the bell-smoke fades.'] };
          }
          return {
            messages: [check.logLine, 'Loose slate clatters — the Acolyte whips around!'],
            startCombat: { enemyId: 'blight_acolyte', canFlee: true },
          };
        },
      },
    ],
  },

  {
    id: 'lost_pilgrim_wagon',
    title: 'Overturned Pilgrim Cart',
    locations: ['kings_causeway', 'ash_fen'],
    weight: 2,
    prompt: () =>
      'A broken pilgrim handcart lies half-sunk in axle mud, its canvas flapping like torn skin.',
    choices: [
      {
        id: 'lp_salvage',
        label: 'Salvage What Supplies Remain',
        resolve: (state) => {
          state.player.rations += 1;
          state.player.torches += 1;
          addItemToInventory(state, 'poultice', 1);
          return { messages: ['Beneath soaked blankets you rescue +1 Ration, +1 Torch, and +1 Herb Poultice.'] };
        },
      },
      {
        id: 'lp_scholar',
        label: '[Root-Scholar] Recover Charred Prayer-Notes from the Box',
        tag: 'Root-Scholar Only',
        visible: (state) => state.player.background === 'root_scholar',
        resolve: (state) => {
          state.player.xp += 15;
          state.player.focus = state.player.maxFocus;
          return {
            messages: ['Margin notes on Belfry harmonics sharpen your mind (+15 XP, Full Focus).'],
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
        label: 'Muffle the Clapper with Rag & Wax',
        resolve: (state) => {
          state.player.xp += 12;
          adjustFaction(state, 'husk_choir', -1);
          return {
            messages: [
              'The discordant hum dies immediately. Somewhere beneath the earth, a distant echo falters (+12 XP, -1 Choir Resonance).',
            ],
          };
        },
      },
      {
        id: 'wbp_listen',
        label: 'Listen Intently to Locate Choir Currents (Wit DC 13)',
        resolve: (state) => {
          const check = resolveCheck(state, 'wit', 13, {
            label: 'Read Bell Harmonics',
            isLoreOrPerception: true,
          });
          if (check.success) {
            state.player.maxFocus += 1;
            state.player.focus += 1;
            return { messages: [check.logLine, 'You map the subtle under-notes (+1 Max Focus)!'] };
          }
          state.player.hp = Math.max(1, state.player.hp - 3);
          return { messages: [check.logLine, 'A sudden toll splits your eardrums (-3 HP).'] };
        },
      },
    ],
  },

  {
    id: 'calcified_sentinel',
    title: 'The Kneeling Stone-Knight',
    locations: ['crown_watchtower', 'drowned_forge'],
    weight: 2,
    prompt: () =>
      'A soldier fused mid-prayer into pale limestone sits blocking a narrow ledge. Still clasped in stony fingers gleams an intact flask.',
    choices: [
      {
        id: 'cs_pry',
        label: 'Pry the Flask Free Gently (Might DC 12)',
        resolve: (state) => {
          const check = resolveCheck(state, 'might', 12, { label: 'Free Stone-Knight Flask' });
          if (check.success) {
            addItemToInventory(state, 'stamina_draught', 1);
            state.player.crowns += 10;
            return { messages: [check.logLine, 'You claim +1 Iron-Root Draught and +10 Crowns.'] };
          }
          return {
            messages: [check.logLine, 'The limestone shatters and wakes a lurking Root-Husk!'],
            startCombat: { enemyId: 'root_husk', canFlee: true },
          };
        },
      },
      {
        id: 'cs_respect',
        label: 'Offer a Silent Salute and Step Around',
        resolve: (state) => {
          state.player.stamina = Math.min(state.player.maxStamina, state.player.stamina + 2);
          return { messages: ['Steady breathing returns in the quiet pass (+2 Stamina).'] };
        },
      },
    ],
  },

  {
    id: 'grixi_scrap_cart',
    title: 'Abandoned Brass-Warren Cart',
    locations: ['ash_fen', 'drowned_forge'],
    weight: 2,
    prompt: () =>
      'A low iron-wheeled handcart sits wedged between mossy boulders, stamped with Under-Warren guild runes.',
    choices: [
      {
        id: 'gsc_loot',
        label: 'Recover Intact Guild Tools',
        resolve: (state) => {
          state.player.crowns += state.player.race === 'grixi' ? 20 : 12;
          addItemToInventory(state, 'antitoxin', 1);
          return {
            messages: [
              `You salvage ${state.player.race === 'grixi' ? 'hidden guild-drawer silver (+20 Crowns)' : 'loose silver (+12 Crowns)'} and +1 Warren Antitoxin.`,
            ],
          };
        },
      },
    ],
  },

  {
    id: 'star_glass_obelisk',
    title: 'Shattered Star-Glass Obelisk',
    locations: ['weeping_barrow', 'petrified_starwood'],
    weight: 2,
    prompt: () =>
      'A jagged shard of midnight glass juts from the earth, still holding reflections of stars invisible behind the valley cloud-bank.',
    choices: [
      {
        id: 'sgo_commune',
        label: 'Touch the Cold Glass to Refill Focus (+4 Focus)',
        resolve: (state) => {
          state.player.focus = Math.min(state.player.maxFocus, state.player.focus + 4);
          return { messages: ['Starlight-cold clarity fills your veins (+4 Focus).'] };
        },
      },
      {
        id: 'sgo_chip',
        label: 'Chip Off a Resonant Sliver (+15 Crowns, -2 HP)',
        resolve: (state) => {
          state.player.hp = Math.max(1, state.player.hp - 2);
          state.player.crowns += 15;
          return { messages: ['The glass cuts your palm (-2 HP), yielding a gleaming sliver worth 15 Crowns.'] };
        },
      },
    ],
  },
];
