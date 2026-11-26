import type { GameState } from '../types.ts';
import { LOCATIONS } from '../content/locations.ts';
import { getEffectiveStat, nextRandom, resolveCheck, rollDie } from '../dice.ts';
import { WEATHER_DATA, advanceHours, isDarkPeriod } from './clock.ts';
import { tendInjury } from './injuries.ts';
import { repairEquippedArmor } from './frontier.ts';
import { addItemToInventory, startCombatEncounter } from '../combat.ts';

export function enterMobileCamp(state: GameState): string[] {
  const loc = LOCATIONS[state.locationId];
  if (loc?.regionType === 'town') {
    return ['You cannot pitch a wild camp inside town walls. Use Rest at the hearth instead.'];
  }
  state.scene = 'camp';
  state.subMenu = 'root';
  state.camp = {
    fireLit: false,
    hoursCamped: 0,
    tendedThisCamp: false,
    foragedThisCamp: false,
  };
  return [
    'You clear wet slush beneath broken stone and lay out a solo camp.',
  ];
}

export function getCampChoices(
  state: GameState,
): Array<{ index: number; id: string; label: string; enabled: boolean; reason?: string }> {
  const camp = state.camp;
  if (!camp) return [];
  const opts: Array<{ index: number; id: string; label: string; enabled: boolean; reason?: string }> = [];

  opts.push({
    index: opts.length + 1,
    id: 'camp:brief_rest',
    label: 'Brief Rest',
    enabled: state.player.reserves > 0,
    reason: state.player.reserves > 0 ? undefined : 'No Reserves left',
  });
  opts.push({ index: opts.length + 1, id: 'camp:full_rest', label: 'Full Rest', enabled: true });

  if (!camp.fireLit) {
    const canLight =
      state.player.torches > 0 ||
      state.player.abilities.includes('kiln_spark');
    opts.push({
      index: opts.length + 1,
      id: 'camp:kindle',
      label: 'Kindle',
      enabled: canLight,
      reason: canLight ? undefined : 'No torch or fire spark',
    });
  }

  opts.push({
    index: opts.length + 1,
    id: 'camp:tend',
    label: 'Tend',
    enabled: !camp.tendedThisCamp,
    reason: camp.tendedThisCamp ? 'Already tended here' : undefined,
  });

  opts.push({
    index: opts.length + 1,
    id: 'camp:forage',
    label: 'Forage',
    enabled: !camp.foragedThisCamp,
    reason: camp.foragedThisCamp ? 'Surroundings picked clean' : undefined,
  });

  opts.push({ index: opts.length + 1, id: 'camp:repair', label: 'Repair', enabled: true });
  opts.push({ index: opts.length + 1, id: 'camp:craft', label: 'Craft', enabled: true });
  opts.push({ index: opts.length + 1, id: 'open_journal', label: 'Journal', enabled: true });
  opts.push({ index: opts.length + 1, id: 'camp:pack_up', label: 'Pack Up', enabled: true });

  return opts;
}

export function executeCampAction(state: GameState, actionId: string): string[] {
  const camp = state.camp;
  if (!camp) return [];
  const p = state.player;
  const loc = LOCATIONS[state.locationId];

  if (actionId === 'camp:kindle') {
    if (!p.abilities.includes('kiln_spark')) {
      if (p.torches <= 0) return ['No torch left to strike fire.'];
      p.torches -= 1;
    }
    camp.fireLit = true;
    const msgs = ['Dry sparks catch kindling into a low, sheltered ember-fire.'];
    if (p.race === 'durnfolk' && !p.weaponHoned) {
      p.weaponHoned = true;
      msgs.push('By firelight you whet your weapon edge with a basalt stone.');
    }
    return msgs;
  }

  if (actionId === 'camp:tend') {
    camp.tendedThisCamp = true;
    const clockMsgs = advanceHours(state, 1, { sheltered: camp.fireLit });
    if (p.injuries.length > 0) {
      const hasPoultice = p.inventory.some((i) => i.id === 'poultice' && i.qty > 0);
      return [...tendInjury(state, p.injuries[0], hasPoultice), ...clockMsgs];
    }
    p.hp = Math.min(p.maxHp, p.hp + 6);
    p.statuses = [];
    return ['You wash ash from scrapes and wrap clean linen tight.', ...clockMsgs];
  }

  if (actionId === 'camp:repair') {
    const clockMsgs = advanceHours(state, 1, { sheltered: camp.fireLit });
    return [...repairEquippedArmor(state, true), ...clockMsgs];
  }

  if (actionId === 'camp:forage') {
    camp.foragedThisCamp = true;
    const clockMsgs = advanceHours(state, 2);
    const check = resolveCheck(state, 'wit', 11, {
      label: 'Forage Surroundings',
      isLoreOrPerception: true,
    });
    if (check.success) {
      if (state.locationId === 'ash_fen' || state.locationId === 'silken_cistern') {
        addItemToInventory(state, 'bog_herb', 1);
        return [check.logLine, 'You gather fresh Bog Herb from damp reeds.', ...clockMsgs];
      }
      if (state.locationId === 'petrified_starwood' || state.locationId === 'drowned_forge') {
        addItemToInventory(state, 'ash_resin', 1);
        return [check.logLine, 'You scrape clear Ash Resin from scorched timber.', ...clockMsgs];
      }
      p.rations += 1;
      return [check.logLine, 'You snare lean trail meat and dry edible roots.', ...clockMsgs];
    }
    return [check.logLine, 'Only damp ash and barren stalks reward your search.', ...clockMsgs];
  }

  if (actionId === 'camp:brief_rest') {
    if (p.reserves <= 0) {
      return ['No Reserves remain until a Full Rest.'];
    }
    p.reserves -= 1;
    const clockMsgs = advanceHours(state, 1, { sheltered: camp.fireLit });
    const healRoll = rollDie(8, state) + Math.max(0, getEffectiveStat(state, 'grit')) + (camp.fireLit ? 2 : 0);
    p.hp = Math.min(p.maxHp, p.hp + healRoll);
    p.stamina = Math.min(p.maxStamina, p.stamina + Math.ceil(p.maxStamina / 2));
    p.focus = Math.min(p.maxFocus, p.focus + Math.ceil(p.maxFocus / 2));
    camp.hoursCamped += 1;
    return [
      `You catch your breath and bind scrapes, spending 1 Reserve to recover ${healRoll} HP and half Stamina and Focus.`,
      ...clockMsgs,
    ];
  }

  if (actionId === 'camp:full_rest') {
    const msgs: string[] = [];
    const weatherMod = WEATHER_DATA[state.clock.weather].ambushBonus;
    const darkMod = isDarkPeriod(state.clock.hour) ? 0.1 : 0;
    const fireMod = camp.fireLit ? -0.15 : 0.08;
    const elfSafety = p.race === 'ael_thalor' ? -0.25 : 0;
    const ambushChance = Math.max(
      0,
      Math.min(0.6, loc.danger * 0.1 + weatherMod + darkMod + fireMod + elfSafety),
    );

    let fed = false;
    if (p.rations > 0) {
      p.rations -= 1;
      fed = true;
    }

    msgs.push(...advanceHours(state, 8, { sheltered: camp.fireLit }));

    if (nextRandom(state) < ambushChance && loc.danger > 0) {
      state.camp = null;
      const ambusher =
        state.locationId === 'ash_fen'
          ? 'root_husk'
          : state.locationId === 'kings_causeway'
            ? 'ash_hound'
            : 'chitin_weaver';
      msgs.push('A snapping branch jolts you awake in the dark as something closes on your camp.');
      const { introMessages } = startCombatEncounter(state, {
        enemyId: ambusher,
        canFlee: true,
      });
      return [...msgs, ...introMessages];
    }

    const healAmt = fed
      ? camp.fireLit
        ? p.maxHp
        : Math.floor(p.maxHp * 0.75)
      : Math.floor(p.maxHp * 0.45);
    p.hp = Math.min(p.maxHp, p.hp + healAmt);
    p.stamina = p.maxStamina;
    p.focus = p.maxFocus;
    p.resolve = p.maxResolve;
    p.statuses = [];
    p.determinationAvailable = true;
    const recoveredReserves = Math.max(1, Math.floor(p.maxReserves / 2));
    p.reserves = Math.min(p.maxReserves, p.reserves + recoveredReserves);
    const graceGain = rollDie(2, state);
    p.grace = Math.min(p.maxGrace, p.grace + graceGain);
    camp.hoursCamped += 8;
    camp.tendedThisCamp = false;
    camp.foragedThisCamp = false;

    msgs.push(
      fed
        ? camp.fireLit
          ? 'Warm embers and a hot ration carry you cleanly through the night. Reserves and Grace refresh.'
          : 'A ration steadies you through cold sleep beneath wet stone. Reserves and Grace refresh.'
        : 'Sleeping on an empty belly leaves you gaunt and stiff, though Reserves and Grace still stir.',
    );
    if (p.defilement >= 30) {
      msgs.push('Low bronze vibrations echoed through your dreams all night.');
    }
    return msgs;
  }

  if (actionId === 'camp:pack_up') {
    state.camp = null;
    state.scene = state.locationId === 'camp_hub' ? 'camp_hub' : 'location';
    state.subMenu = 'root';
    return ['You kick ash over your camp and shoulder your pack.'];
  }

  return ['Unknown camp action.'];
}
