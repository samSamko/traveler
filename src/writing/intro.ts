import type { GameState } from '../types.ts';
import { BACKGROUNDS, SOUTHERN_PASTS } from '../content/characters.ts';
import { pronouns } from '../memory.ts';

export const INTRO_BEAT_COUNT = 5;

export interface IntroBeat {
  title: string;
  body: string;
}

export function getIntroBeat(state: GameState, beatIndex: number): IntroBeat {
  const p = state.player;
  const pr = pronouns(p.sex);
  const bg = BACKGROUNDS[p.background];
  const a = p.anatomy;

  if (beatIndex === 0) {
    const raceHistory =
      p.race === 'vaelorian'
        ? p.background === 'ashen_blade'
          ? 'Southern magistrates do not hang deserters cleanly; they nail their names to river bridges and let bounty-men hunt them through the mud. After you broke formation rather than burn a starving hamlet, no barracks door in the south stayed unlatched to you.'
          : p.background === 'root_scholar'
            ? 'Cloister priors burn books first and question the ink-stained hands second. Once bailiffs found northern stone-rubbings stuffed under your straw mattress, your name went straight onto the heresy writ.'
            : p.background === 'barrow_stalker'
              ? 'Years of crooked cellar-digs and unpaid guild tallies left you owing silver to men who collect in fingers. With hired cudgels watching every ferry crossing, only the mountain road stayed open.'
              : 'Your own parish elder struck the iron collar shut around your wrists for speaking out against the tithe-barns, then drove you beyond the ditch wall before winter frost set in.'
        : p.race === 'ael_thalor'
          ? p.background === 'ashen_blade'
            ? 'Human captains gladly take highland steel on the flank until winter pay comes due. When your company butchered two wood-wards over salt rations, you cut your way clear and fled with a price on your pale ears.'
            : p.background === 'root_scholar'
              ? 'Even shrinking highland enclaves fear anyone who copies northern waystone marks onto bark. Driven out by your own elders and spat at by human gate-guards, you kept walking where fewer eyes followed.'
              : p.background === 'barrow_stalker'
                ? 'Villagers blamed your kind whenever calves dropped dead or wells soured, so robbing sunken southern barrows became the only trade left. When a lord lost his signet ring in the mud, every hound south of the river bayed your scent.'
                : 'Cast out from both highland groves and mortal chapels, you dragged old iron penance north while timber-guards threw stones after your cloak.'
          : p.race === 'durnfolk'
            ? p.background === 'ashen_blade'
              ? 'Oath-breakers do not keep seats at southern clan hearths. Once a mine-shaft collapse killed three kinsmen under your watch, the elders struck your family mark from the stone lintel and barred the iron doors.'
              : p.background === 'root_scholar'
                ? 'Stone-hold smiths distrust ink nearly as much as cave-rot. Caught sketching non-dwarven arch joints by oil-lamp, you were stripped of guild tools and shoved into the cold rain.'
                : p.background === 'barrow_stalker'
                  ? 'Selling hold-forged iron to human grave-diggers bought enough bread for two winters until the guild weigh-master checked your ledger. Fleeing the hammer meant taking the dirt tracks uphill.'
                  : 'For refusing to swear an unjust clan-blood oath, the wardens chained your ankles to cold iron and turned you out onto the gravel road without winter lard.'
            : p.background === 'ashen_blade'
              ? 'Wild packs along the ditches tried to slit your throat for wearing boiled leather, while human militia shot bolts at your shadow on sight. Learning how to trade and hold a blade only bought you longer odds on the gallows.'
              : p.background === 'root_scholar'
                ? 'Southern apothecaries bought your distilled tinctures out the back alley by night and sent watchmen after your heels by dawn. When a town bailiff caught you reading stolen road-maps, you bolted into the scrub.'
                : p.background === 'barrow_stalker'
                  ? 'Most of your kin survive on raw offal in wet tunnels; you learned lock-wire, coin weights, and clean speech instead. Neither side trusted a goblin with brass calipers, leaving the northern pass as your last bolt-hole.'
                  : 'Cursed by wild tribes for soft speech and beaten by southern parish-men for pointed ears, you hauled your scarred hide north before winter hunger made meat of you.';

    const scarClause =
      a.facialScars === 'Unmarked'
        ? 'Your face still carries no steel-mark'
        : `A ${a.facialScars.toLowerCase()} pulls tight across your face`;

    const sexFriction =
      p.sex === 'female'
        ? `At every toll-gate, guards eyed a ${a.height.toLowerCase()}, ${a.bodyShape.toLowerCase()} woman with ${a.skinColor.toLowerCase()} skin and ${a.musculature.toLowerCase()} shoulders as either easy prey or bad luck.`
        : `At every toll-gate, bailiffs sized up a ${a.height.toLowerCase()}, ${a.bodyShape.toLowerCase()} man with ${a.skinColor.toLowerCase()} skin and ${a.musculature.toLowerCase()} build as one more desperate cutthroat.`;

    const bodyAndScorn = `${scarClause}, and ${a.eyeColor.toLowerCase()} eyes draw narrow stares wherever lantern-light hits. ${sexFriction} By the last southern market town, nobody would sell you dry oats for silver—only point one thumb toward the grey mountain ridge where runaway criminals go to freeze.`;

    const pastDef = p.southernPast ? SOUTHERN_PASTS[p.southernPast] : undefined;
    const pastLine = pastDef ? `${pastDef.lore} ` : '';
    const closing = `${pastLine}With dry bread dwindling in oilcloth and bailiff posters nailed crooked to wet birch trunks behind you, you turned your boots north up the stone-strewn cart track and kept walking after daylight died.`;

    return {
      title: `THE ROAD BEHIND - ${p.name.toUpperCase()}`,
      body: [raceHistory, bodyAndScorn, closing].join('\n\n'),
    };
  }

  if (beatIndex === 1) {
    const marchRace =
      p.race === 'vaelorian'
        ? `Gale-force sleet hammers across your ${a.skinColor.toLowerCase()} skin as the mountain cart-track narrows to bare shale. ${a.facialScars === 'Unmarked' ? 'Frost numbs your bare cheeks red' : `Wind bites sharp along your ${a.facialScars.toLowerCase()}`}, and wet ${a.hairColor.toLowerCase()} hair whips stiffly across your brow.`
        : p.race === 'ael_thalor'
          ? `Thin mountain air claws at your ribs, carrying a dry metallic sting across your ${a.skinColor.toLowerCase()} skin. ${a.facialScars === 'Unmarked' ? 'Cold tightens across smooth, high cheekbones' : `Freezing grit stings the line of your ${a.facialScars.toLowerCase()}`}, while ${a.hairColor.toLowerCase()} strands freeze damp above your collar.`
          : p.race === 'durnfolk'
            ? `Even thick hold-born lungs rasp dry in the high gorge while sleet crusts onto your ${a.skinColor.toLowerCase()} skin. ${a.facialScars === 'Unmarked' ? 'Wind scrapes raw across your broad nose' : `Frost settles hard inside your ${a.facialScars.toLowerCase()}`}, and ice beads thick along your ${a.hairColor.toLowerCase()} hair.`
            : `Wet wool hangs heavy over your ${a.skinColor.toLowerCase()} skin as sharp scree chews through thin boot-soles. ${a.facialScars === 'Unmarked' ? 'Cold pinches your pointed ears numb' : `Sleet needles raw along your ${a.facialScars.toLowerCase()}`}, and ${a.eyeColor.toLowerCase()} eyes water behind matted ${a.hairColor.toLowerCase()} hair.`;

    const marchGrim =
      p.sex === 'female'
        ? `Days blur into grey shale and rotten spruce. Twice your salt pork turned chalky and sour inside waxed linen before sunset; twice wild dogs shadowed your heels from the scrub until stones drove them off. With every ridge climbed, a heavy, wordless itch behind your ribs pulls your chin straight north even when split leather rubs your heels bloody.`
        : `Days blur into grey shale and dead spruce. Salt pork spoiled greasy inside waxed linen before the third dusk, and gaunt crows followed three ridge-lines waiting for a twisted ankle. With every league uphill, a stubborn, silent pull deepens behind your breastbone, driving your boots forward long after common sense tells a man to turn back.`;

    const gearClause = `Your ${a.musculature.toLowerCase()} frame aches under wet pack-straps, ${a.height.toLowerCase()} stride shortening on black ice while you keep one hand near the worn knife slung at your belt.`;

    return {
      title: 'THE MOUNTAIN MARCH',
      body: [marchRace, marchGrim, gearClause].join('\n\n'),
    };
  }

  if (beatIndex === 2) {
    const approach =
      'At last the granite walls pinch tight enough to block the sky, ending against two towering doors carved out of seamless black stone. Fine geometric grooves cover the slabs from sill to lintel—no southern mason ever swung a mallet at heights like that. Air pouring off the threshold smells dry and burnt, sharp enough to ache inside your molars.';

    const frozenReaction =
      p.background === 'ashen_blade'
        ? 'Nine frozen corpses sprawl along the scree beside the sill, mail stiff with rime and fingers locked onto rusted pommels. You kneel beside a dead lancer to pry his dry oilcloth away, yet even his wool feels brittle as slate; the man died mid-step reaching blindly for the seam.'
        : p.background === 'root_scholar'
          ? 'Frozen wanderers sit hunched against the cliff wall like tallow candles left in sleet, ink-bottles burst black inside their satchels. You lean closer to trace one carved groove on the jamb with numb knuckles, pulling back fast when frost threatens to weld skin straight to stone.'
          : p.background === 'barrow_stalker'
            ? 'Half a dozen starved tomb-robbers lie petrified near the sill, packs slit open by crows that froze beside them. You tug a stiff leather purse off a dead wrist and find only chipped copper and frozen lard; whatever drove them this high killed them before they ever cleared the crack.'
            : 'Cast-off penitents kneel dead in the rime with iron cuffs rusted onto black wrists, eyes glazed white toward the shut doors. You bow your head briefly over their frozen rags, feeling cold shame and the relentless urge behind your ribs lock together.';

    const pushThrough = `By ${pr.poss} own weight or stubborn madness, turning back down the scree feels impossible—every muscle tightens toward the crack between the doors. You brace one shoulder against the freezing black stone, dig iron-shod heels into gravel, and heave until hidden pins groan apart wide enough to slip inside.`;

    return {
      title: 'THE BLACK STONE GATE',
      body: [approach, frozenReaction, pushThrough].join('\n\n'),
    };
  }

  if (beatIndex === 3) {
    const crossingShock =
      p.race === 'grixi' || a.musculature === 'Frail' || a.weight === 'Gaunt'
        ? 'The instant your second boot clears the sill, the air drops silent as a stopped drum. Your stomach heaves violently—you pitch sideways onto sharp gravel, retching bitter yellow bile into the frost while black spots swallow your vision for minutes at a stretch.'
        : p.race === 'durnfolk' || a.musculature === 'Hulking' || a.musculature === 'Broad'
          ? 'The instant your boots cross the threshold, sound drops out like slammed cellar oak. Heavy dizziness slams behind your ears; you drop hard onto one knee, palms slapping freezing stone as nausea churns your gut and cold sweat slicks your neck.'
          : p.race === 'ael_thalor'
            ? 'Stepping past the lintel hits like cold iron against a tuning fork. High, ringing stillness drills straight behind your eyes; your knees fold into grey ash and your gorge rises hot before your vision finally steadies.'
            : p.sex === 'female'
              ? 'One step past the stone sill and the ground seems to tilt sideways beneath your soles. Your boot catches a frost-heaved slab, dropping you hard to your elbows as bitter dizziness spins the sky and forces sour water up your throat.'
              : 'One step past the stone sill and every sound behind you cuts off dead. Violent vertigo buckles your knees onto the paving stones; you brace both palms in the ash, fighting back hot bile until the grey horizon stops tilting.';

    const vanishedGate =
      'When your breath finally steadies and you wipe frozen spit from your chin, you look back toward the narrow gorge. Only sheer, unbroken granite cliff rises behind you through drifting grit—no black stone doors, no seam, no trail back to the south.';

    const valleySight =
      'Ahead, the valley opens into something no southern ballad ever pictured properly: wide, cracked marble paving slabs laid for a longer stride, broken aqueduct piers standing dark against flat white sky, and stunted grey brush rattling in a wind that smells of wet lime and cold ash.';

    return {
      title: 'BEYOND THE THRESHOLD',
      body: [crossingShock, vanishedGate, valleySight].join('\n\n'),
    };
  }

  const shelterBeat =
    p.race === 'vaelorian'
      ? `Before darkness freezes your toes inside wet leather, you crawl beneath a half-collapsed stone milestone shed wedged against a split marble curb. You drag rotten pine boards across the windward gap, pile dry scrub inside the stone corner, and strike sparks until thin smoke curls against the lintel.`
      : p.race === 'ael_thalor'
        ? `Before night frost settles deep into your joints, you climb to a tight ring of frost-split pines clinging above a broken colonnade. Woven dead boughs cut the worst of the north gale while you scrape dry resin off split bark to catch a small, smokeless coal-bed.`
        : p.race === 'durnfolk'
          ? `Before black frost locks the valley floor, you duck into a dry stone culvert wedged solidly beneath an aqueduct pier. Heavy cut ashlar blocks the wind on three sides while you stack dry roots and strike clean flint sparks into tinder.`
          : `Before nightfall lets bigger beasts prowl the open paving, you squeeze behind a bent iron drainage grate tucked beneath the high road curb. Tight stonework keeps wolf-jaws outside while faint cellar warmth takes the worst bite off your wet wool.`;

  const settleBeat = `You rub feeling back into stiff knuckles, check the edge on your belt-knife, and count the last dry crusts left in oilcloth. Nothing from the south can follow you through blank rock, and whatever holds out ahead—deserters, scavengers, or worse—is just as trapped in the frost as you are.`;

  const closingBeat = `Embers settle low beneath grey stone as you claim this hollow for your Lone Camp, ${p.name}.`;

  return {
    title: 'THE FIRST CAMP',
    body: [shelterBeat, settleBeat, closingBeat].join('\n\n'),
  };
}
