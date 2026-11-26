import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';
import type { Character, GameState } from './types.ts';

export type UiStyle =
  | 'yellow'
  | 'pink'
  | 'red'
  | 'dim'
  | 'bold'
  | 'bone'
  | 'ochre'
  | 'rust'
  | 'bile'
  | 'agi'
  | 'pre'
  | 'str'
  | 'tou'
  | 'reset';

// Muted grimdark MÖRK BORG 256-color palette
const ANSI: Record<UiStyle, string> = {
  yellow: '\x1b[38;5;179m', // muted ochre-gold
  pink: '\x1b[38;5;132m',   // tarnished rose/magenta
  red: '\x1b[38;5;160m',    // dried-blood crimson
  dim: '\x1b[38;5;243m',    // ash grey
  bold: '\x1b[1;38;5;252m', // bold pale bone
  bone: '\x1b[38;5;250m',   // pale bone
  ochre: '\x1b[38;5;137m',  // tarnished brass
  rust: '\x1b[38;5;130m',   // rusted iron
  bile: '\x1b[38;5;108m',   // sickly moss/bile
  agi: '\x1b[38;5;72m',     // muted slate-teal (Agility)
  pre: '\x1b[38;5;132m',    // tarnished rose (Presence)
  str: '\x1b[38;5;167m',    // dull crimson-rust (Strength)
  tou: '\x1b[38;5;179m',    // muted ochre (Toughness)
  reset: '\x1b[0m',
};

const SPINNER_FRAMES = ['[|]', '[/]', '[-]', '[\\]'];

let cachedPrompts: string[] | null = null;
function loadRollPrompts(): string[] {
  if (cachedPrompts) return cachedPrompts;
  try {
    const raw = readFileSync(join(process.cwd(), 'data', 'roll_prompts.json'), 'utf8');
    const parsed = JSON.parse(raw) as { prompts?: string[] };
    if (Array.isArray(parsed.prompts) && parsed.prompts.length > 0) {
      cachedPrompts = parsed.prompts;
      return cachedPrompts;
    }
  } catch {
    // Fallback if missing
  }
  cachedPrompts = ['What wretch fate awaits you?'];
  return cachedPrompts;
}

export function pickRandomRollPrompt(): string {
  const list = loadRollPrompts();
  return list[Math.floor(Math.random() * list.length)];
}

export function paint(text: string, style: UiStyle, stealth: boolean): string {
  if (stealth) return text;
  return `${ANSI[style]}${text}${ANSI.reset}`;
}

type InputMode = 'idle' | 'skip' | 'line';

class TerminalController {
  private initialized = false;
  private isInteractive = false;
  private mode: InputMode = 'idle';
  private lineBuf = '';
  private lineResolve: ((line: string | null) => void) | null = null;
  private skipResolve: (() => void) | null = null;
  private pipedLines: string[] = [];
  private pipedClosed = false;
  private pipedWaiter: ((line: string | null) => void) | null = null;
  private rl: ReturnType<typeof createInterface> | null = null;

  private readonly onTtyData = (chunk: Buffer | string) => {
    const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (str.includes('\x03')) {
      this.close();
      process.exit(130);
    }
    if (this.mode === 'idle') {
      return;
    }
    if (this.mode === 'skip') {
      this.mode = 'idle';
      const cb = this.skipResolve;
      this.skipResolve = null;
      cb?.();
      return;
    }
    // Raw-mode line editor
    let i = 0;
    while (i < str.length) {
      const ch = str[i];
      if (ch === '\x1b') {
        // Ignore ANSI escape sequences (arrows, function keys, etc.)
        if (str[i + 1] === '[') {
          i += 2;
          while (i < str.length && !/[A-Za-z~]/.test(str[i])) i += 1;
        }
        i += 1;
        continue;
      }
      if (ch === '\r' || ch === '\n') {
        // Consume paired \r\n
        if (ch === '\r' && str[i + 1] === '\n') i += 1;
        stdout.write('\n');
        const out = this.lineBuf;
        this.lineBuf = '';
        this.mode = 'idle';
        const res = this.lineResolve;
        this.lineResolve = null;
        res?.(out);
        return;
      }
      if (ch === '\x7f' || ch === '\b') {
        if (this.lineBuf.length > 0) {
          this.lineBuf = this.lineBuf.slice(0, -1);
          stdout.write('\b \b');
        }
      } else if (ch >= ' ') {
        this.lineBuf += ch;
        stdout.write(ch);
      }
      i += 1;
    }
  };

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.isInteractive = Boolean(stdin.isTTY);
    if (this.isInteractive) {
      if (typeof stdin.setRawMode === 'function') {
        stdin.setRawMode(true);
      }
      stdin.resume();
      stdin.on('data', this.onTtyData);
      stdin.on('end', () => {
        this.pipedClosed = true;
        if (this.lineResolve) {
          const res = this.lineResolve;
          this.lineResolve = null;
          res(null);
        }
      });
    } else {
      this.rl = createInterface({ input: stdin });
      this.rl.on('line', (line) => {
        if (this.pipedWaiter) {
          const res = this.pipedWaiter;
          this.pipedWaiter = null;
          res(line);
        } else {
          this.pipedLines.push(line);
        }
      });
      this.rl.on('close', () => {
        this.pipedClosed = true;
        if (this.pipedWaiter) {
          const res = this.pipedWaiter;
          this.pipedWaiter = null;
          res(null);
        }
      });
    }
  }

  close(): void {
    if (!this.initialized) return;
    this.initialized = false;
    this.mode = 'idle';
    if (this.isInteractive) {
      stdin.off('data', this.onTtyData);
      if (typeof stdin.setRawMode === 'function') {
        stdin.setRawMode(false);
      }
      stdin.pause();
    } else {
      this.rl?.close();
    }
  }

  async readLine(prompt = '> '): Promise<string | null> {
    this.init();
    stdout.write(prompt);
    if (this.isInteractive) {
      if (this.pipedClosed) return null;
      this.lineBuf = '';
      this.mode = 'line';
      return new Promise((resolve) => {
        this.lineResolve = resolve;
      });
    }
    if (this.pipedLines.length > 0) {
      return this.pipedLines.shift() ?? null;
    }
    if (this.pipedClosed) {
      return null;
    }
    return new Promise((resolve) => {
      this.pipedWaiter = resolve;
    });
  }

  armSkip(onSkip: () => void): () => void {
    if (!this.isInteractive) return () => {};
    this.init();
    this.mode = 'skip';
    this.skipResolve = onSkip;
    return () => {
      if (this.mode === 'skip') {
        this.mode = 'idle';
      }
      if (this.skipResolve === onSkip) {
        this.skipResolve = null;
      }
    };
  }
}

const terminal = new TerminalController();

export function initTerminal(): void {
  terminal.init();
}

export function closeTerminal(): void {
  terminal.close();
}

export function readTerminalLine(prompt = '> '): Promise<string | null> {
  return terminal.readLine(prompt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepAbortable(ms: number, signal: { skipped: boolean; wake: (() => void) | null }): Promise<void> {
  if (signal.skipped) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (signal.wake === done) signal.wake = null;
      resolve();
    }, ms);
    const done = () => {
      clearTimeout(timer);
      signal.wake = null;
      resolve();
    };
    signal.wake = done;
  });
}

export async function typewriteText(
  text: string,
  stealth: boolean,
  options?: { instant?: boolean },
): Promise<void> {
  if (!text) return;
  if (stealth || options?.instant || !stdout.isTTY) {
    console.log(text);
    return;
  }

  const signal: { skipped: boolean; wake: (() => void) | null } = { skipped: false, wake: null };
  const disarm = terminal.armSkip(() => {
    signal.skipped = true;
    signal.wake?.();
  });

  try {
    let i = 0;
    while (i < text.length) {
      if (signal.skipped) {
        stdout.write(text.slice(i));
        break;
      }
      const ch = text[i];
      // Emit ANSI escape codes atomically with zero delay
      if (ch === '\x1b' && text[i + 1] === '[') {
        let end = i + 2;
        while (end < text.length && text[end] !== 'm') end += 1;
        stdout.write(text.slice(i, end + 1));
        i = end + 1;
        continue;
      }
      stdout.write(ch);
      i += 1;
      if (ch === '.' || ch === '!' || ch === '?' || ch === '\n') {
        await sleepAbortable(220, signal);
      } else if (ch === ',' || ch === ';' || ch === ':') {
        await sleepAbortable(80, signal);
      } else {
        await sleepAbortable(18, signal);
      }
    }
    stdout.write('\n');
  } finally {
    disarm();
  }
}

export async function pauseTransition(
  message: string,
  stealth: boolean,
  delayMs = 550,
): Promise<void> {
  if (stealth || !stdout.isTTY) return;
  console.log(paint(`\n--- ${message} ---`, 'dim', false));
  await sleep(delayMs);
}

const GM_WARNING_PHRASES = [
  'Choosing your doom...',
  'The GM rolls in the dark...',
  'Verhu weighs your wretched fate...',
  'The bones clatter against the stone...',
  'Nechrubel counts the seconds...',
];

export function inferDiceSpecs(label: string): number[] {
  if (/\bd6x8\b/i.test(label)) {
    return [6, 8];
  }
  const repeatMatch = label.match(/\bd(\d+)x(\d+)\b/i);
  if (repeatMatch) {
    const sides = Number.parseInt(repeatMatch[1], 10);
    const count = Math.min(12, Math.max(1, Number.parseInt(repeatMatch[2], 10)));
    if (sides >= 2 && sides <= 100) {
      return Array.from({ length: count }, () => sides);
    }
  }

  const specs: number[] = [];
  const regex = /\b(\d*)d(\d+)(?=$|\D)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(label)) !== null) {
    const rawCount = match[1] ? Number.parseInt(match[1], 10) : 1;
    const sides = Number.parseInt(match[2], 10);
    if (sides === 66 && !match[1]) {
      specs.push(6, 6);
      continue;
    }
    const count = Math.min(12, Math.max(1, rawCount));
    if (sides >= 2 && sides <= 100) {
      for (let i = 0; i < count; i += 1) {
        specs.push(sides);
      }
    }
  }
  return specs.length > 0 ? specs : [20];
}

function formatDiceRollDisplay(specs: number[], faces: number[]): string {
  const allSame = specs.every((s) => s === specs[0]);
  if (specs.length === 1) {
    const pad = specs[0] >= 10 ? 2 : 1;
    return `[d${specs[0]}: ${String(faces[0]).padStart(pad, ' ')}]`;
  }
  if (allSame) {
    const pad = specs[0] >= 10 ? 2 : 1;
    const faceStr = faces.map((f) => String(f).padStart(pad, ' ')).join(', ');
    return `[${specs.length}d${specs[0]}: ${faceStr}]`;
  }
  const parts = specs.map((s, idx) => `d${s}: ${String(faces[idx]).padStart(s >= 10 ? 2 : 1, ' ')}`);
  return `[${parts.join(' | ')}]`;
}

export async function animateInlineRoll(
  label: string,
  stealth: boolean,
  options?: { isGmRoll?: boolean; forceInteractive?: boolean },
): Promise<void> {
  const isTty = options?.forceInteractive || Boolean(stdout.isTTY);
  if (!isTty) {
    console.log(`  * ${label}`);
    return;
  }

  const specs = inferDiceSpecs(label);
  const isGmRoll = Boolean(options?.isGmRoll);
  const prefix = isGmRoll
    ? GM_WARNING_PHRASES[Math.floor(Math.random() * GM_WARNING_PHRASES.length)]
    : 'Rolling fate...';

  if (isGmRoll && !stealth) {
    await typewriteText(paint(`  * ${prefix}`, 'pink', false), false);
  }

  // Decelerating die-face simulation (>= 5,000ms total), skippable with any key
  const delays = [
    35, 40, 45, 55, 65, 80, 95, 115, 140, 170,
    210, 260, 320, 390, 470, 560, 680, 820, 950,
  ]; // 5,495ms

  const signal: { skipped: boolean; wake: (() => void) | null } = { skipped: false, wake: null };
  const disarm = terminal.armSkip(() => {
    signal.skipped = true;
    signal.wake?.();
  });

  try {
    for (let i = 0; i < delays.length; i += 1) {
      if (signal.skipped) break;
      const frame = SPINNER_FRAMES[i % SPINNER_FRAMES.length];
      const faces = specs.map((sides) => Math.floor(Math.random() * sides) + 1);
      const msg = `  ${frame} ${prefix} ${formatDiceRollDisplay(specs, faces)}`;
      stdout.write(`\r${paint(msg, isGmRoll ? 'pink' : 'ochre', stealth)}`);
      await sleepAbortable(delays[i], signal);
    }
  } finally {
    disarm();
  }

  stdout.write('\r\x1b[2K');
  if (!stealth && (label.includes('MISERY ') || label.includes('ARCANE CATASTROPHE'))) {
    const colonIdx = label.indexOf(': ');
    if (colonIdx > 0) {
      stdout.write(paint(`  * ${label.slice(0, colonIdx + 2)}`, 'red', false));
      await typewriteText(label.slice(colonIdx + 2), stealth);
      await sleep(140);
      return;
    }
  }
  const styled = label.includes('[CRIT!]') || label.includes('SLAIN')
    ? paint(`  * ${label}`, 'bile', stealth)
    : label.includes('[FUMBLE!]') || label.includes('DEAD') || label.includes('INFECTED')
      ? paint(`  * ${label}`, 'red', stealth)
      : paint(`  * ${label}`, 'bone', stealth);
  console.log(styled);
  await sleep(140);
}

export async function animateLines(
  lines: string[],
  stealth: boolean,
  delayMs = 90,
): Promise<void> {
  const isTty = Boolean(stdout.isTTY);
  for (const line of lines) {
    if (
      !stealth &&
      isTty &&
      (line.startsWith('Origin:') ||
        line.startsWith('Terrible Traits:') ||
        line.startsWith('Broken Body:') ||
        line.startsWith('Bad Habit:') ||
        line.startsWith('Troubling Tale:'))
    ) {
      await typewriteText(line, stealth);
    } else {
      console.log(line);
      if (isTty && !stealth) {
        await sleep(delayMs);
      }
    }
  }
}

export function startWaitingAnimation(stealth: boolean): () => void {
  if (stealth || !stdout.isTTY) {
    return () => {};
  }
  const flavors = [
    'Consulting the Nameless Scriptures...',
    'Verhu whispers in the dark...',
    'Counting bones in the catacombs...',
    'Listening to the wind from Sarkash...',
  ];
  let tick = 0;
  const interval = setInterval(() => {
    const frame = SPINNER_FRAMES[tick % SPINNER_FRAMES.length];
    const msg = flavors[Math.floor(tick / 16) % flavors.length];
    stdout.write(`\r${paint(`${frame} ${msg}`, 'dim', false)}`);
    tick += 1;
  }, 150);

  return () => {
    clearInterval(interval);
    stdout.write('\r\x1b[2K');
  };
}

function fmtMod(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

export function renderPartyBar(state: GameState, stealth: boolean): string {
  const header = `DAY ${state.calendar.day} (${String(state.calendar.hour).padStart(2, '0')}:00) | CAL d${state.calendar.die} [${state.calendar.triggeredMiseries.length}/7 Miseries] | ${state.currentRegionName} | ${state.currentWeather}`;
  const pcs = state.party.members
    .map((m, idx) => {
      const activeMark = idx === state.party.activePcIndex ? '*' : '';
      const statusTag = m.status === 'alive' ? '' : `(${m.status.toUpperCase()})`;
      return `[${idx + 1}${activeMark}] ${m.name} HP:${m.hp}/${m.maxHp}${statusTag} Om:${m.omens} ${m.silver}s`;
    })
    .join('  |  ');

  const followers =
    state.party.followers.length > 0
      ? `\nOutcasts: ${state.party.followers.map((f) => `${f.name} (${f.hp}/${f.maxHp} HP, ${f.status})`).join(', ')}`
      : '';

  return [
    paint('========================================================================', 'rust', stealth),
    paint(header, 'pink', stealth),
    paint(pcs, 'bold', stealth) + (followers ? paint(followers, 'ochre', stealth) : ''),
    paint('========================================================================', 'rust', stealth),
  ].join('\n');
}

export function renderCharacterSheet(pc: Character, stealth: boolean): string {
  const lines: string[] = [
    paint(`=== ${pc.name} — ${pc.className} [${pc.status.toUpperCase()}] ===`, 'yellow', stealth),
    paint('Wretched soul bound to the Dying World; abilities range -3 to +6, 0 HP is Broken.', 'dim', stealth),
    paint(`HP: ${pc.hp}/${pc.maxHp} | Omens: ${pc.omens} (d${pc.omenDie}) | Powers today: ${pc.powersRemaining}/${pc.powersMaxToday}${pc.dizzyHours > 0 ? ' [DIZZY]' : ''} | Silver: ${pc.silver}s`, 'bone', stealth),
    `Abilities: ${paint(`AGI ${fmtMod(pc.abilities.agility)}`, 'agi', stealth)} | ${paint(`PRE ${fmtMod(pc.abilities.presence)}`, 'pre', stealth)} | ${paint(`STR ${fmtMod(pc.abilities.strength)}`, 'str', stealth)} | ${paint(`TOU ${fmtMod(pc.abilities.toughness)}`, 'tou', stealth)}`,
    paint(`Weapon: ${pc.weapon.name} (${pc.weapon.damageDie}${pc.weaponBroken ? ' - BROKEN' : ''}${pc.weapon.ranged ? `, Ammo: ${pc.ammo}` : ''})`, 'bone', stealth),
    paint(`Armor: ${pc.armorName} (Tier ${pc.armorTier}/${pc.armorMaxTier})${pc.hasShield ? ' + Shield' : ''}`, 'bone', stealth),
    paint(`Supplies: Food ${pc.foodDays}d | Water ${pc.waterDays}d${pc.infected ? ' | [INFECTED]' : ''}${pc.brokenNote ? ` | [${pc.brokenNote}]` : ''}`, pc.infected ? 'red' : 'bile', stealth),
    paint(`Carrying: ${pc.inventory.length}/${pc.carryingCapacity} (${pc.containerName})`, 'bone', stealth),
    `Origin: ${pc.traits.origin}`,
    `Terrible Traits: ${pc.traits.terrible.join(' / ')}`,
    `Broken Body: ${pc.traits.brokenBody}`,
    `Bad Habit: ${pc.traits.badHabit}`,
    `Troubling Tale: ${pc.traits.troublingTale}`,
  ];

  if (pc.classFeatures.length > 0) {
    lines.push(paint('Class Features:', 'pink', stealth));
    for (const f of pc.classFeatures) lines.push(paint(`  - ${f}`, 'bone', stealth));
  }

  lines.push(paint('Inventory:', 'pink', stealth));
  if (pc.inventory.length === 0) {
    lines.push(paint('  (empty)', 'dim', stealth));
  } else {
    pc.inventory.forEach((item, i) => {
      const usesStr = item.uses !== undefined ? ` (${item.uses} uses)` : '';
      lines.push(paint(`  ${i + 1}. ${item.name}${usesStr}`, 'bone', stealth));
    });
  }

  if (pc.arcaneCatastrophes.length > 0) {
    lines.push(paint(`Arcane Catastrophes suffered: #${pc.arcaneCatastrophes.join(', #')}`, 'red', stealth));
  }
  if (pc.notes.length > 0) {
    lines.push(paint(`Notes: ${pc.notes.join('; ')}`, 'ochre', stealth));
  }

  return lines.join('\n');
}

export interface GameScreenParts {
  beforeNarration: string;
  narration: string;
  afterNarration: string;
}

export function renderAbilityModTable(stealth: boolean): string {
  return [
    paint('--- Ability Modifier Table (3d6 sum -> Mod) ---', 'ochre', stealth),
    paint('  1-4: -3 | 5-6: -2 | 7-8: -1 | 9-12: ±0 | 13-14: +1 | 15-16: +2 | 17-20: +3', 'dim', stealth),
  ].join('\n');
}

export function renderClassRollModifiers(
  cls: {
    name: string;
    abilityRolls: { agility: string; presence: string; strength: string; toughness: string };
    hpDie: number;
    omenDie: number;
    weaponDie: number;
    armorDie: number;
    silverFormula: string;
    canCastInMediumArmor?: boolean;
    canUseScrolls?: boolean;
  } | undefined,
  stealth: boolean,
): string {
  if (!cls) {
    return paint(
      '  Modifiers: 4d6 drop lowest on 2 random abilities (3d6 on 2) | HP: TOU+d8 | Omens: d2 | Wpn: d10 | Arm: d4 | Silver: 2d6*10',
      'dim',
      stealth,
    );
  }
  const extras: string[] = [];
  if (cls.canCastInMediumArmor) extras.push('Powers OK in Medium Armor');
  if (cls.canUseScrolls === false) extras.push('Illiterate (no scrolls)');
  const extraText = extras.length > 0 ? ` | ${extras.join(', ')}` : '';
  return paint(
    `  Modifiers: AGI ${cls.abilityRolls.agility} | PRE ${cls.abilityRolls.presence} | STR ${cls.abilityRolls.strength} | TOU ${cls.abilityRolls.toughness} | HP TOU+d${cls.hpDie} | Omens d${cls.omenDie} | Wpn d${cls.weaponDie} | Arm d${cls.armorDie} | Silver ${cls.silverFormula}${extraText}`,
    'dim',
    stealth,
  );
}

export function renderDrAndCombatModTable(stealth: boolean): string {
  return [
    paint('--- DR, Armor & Combat Modifier Tables ---', 'ochre', stealth),
    paint('  DR Scale: 6 Simple | 8 Routine | 10 Pretty simple | 12 Normal | 14 Difficult | 16 Really hard | 18 Impossible', 'dim', stealth),
    paint('  Armor: T1 (-d2) | T2 (-d4, +2 AGI/Def DR) | T3 (-d6, +4 AGI DR, +2 Def DR) | Carry > STR+8: +2 STR/AGI DR', 'dim', stealth),
    paint('  Crit (nat 20): 2x dmg / auto-pass | Fumble (nat 1): weapon breaks / 2x dmg taken', 'dim', stealth),
    paint('  Broken (0 HP, d4): 1 KO d4 rnds | 2 Lost limb/eye | 3 Hemorrhage (DR16+, dies d2h) | 4 Dead', 'dim', stealth),
    paint('  Reaction (2d6): 2-3 Kill | 4-6 Angered | 7-8 Indifferent | 9-10 Almost friendly | 11-12 Helpful | Morale: 2d6 > Morale (d6: 1-3 Flee, 4-6 Surrender)', 'dim', stealth),
  ].join('\n');
}

export function renderSummaryOverview(state: GameState, stealth: boolean): string {
  const c = state.activeContract;
  const lines: string[] = [
    renderPartyBar(state, stealth),
    paint(
      `Contract #${c.contractNumber}: ${c.objectiveTitle} (${c.dungeonName}) | Status: ${c.objectiveSecured ? 'OBJECTIVE SECURED' : 'Pending'} | Bounty: ${c.rewardSilver}s`,
      'yellow',
      stealth,
    ),
    paint(`Seer Prophecies: 1) ${c.prophecies[0]} | 2) ${c.prophecies[1]}`, 'dim', stealth),
  ];
  if (state.chronicle.length > 0) {
    lines.push(paint('Recent Chronicle:', 'pink', stealth));
    for (const entry of state.chronicle.slice(-5)) {
      lines.push(paint(`  - ${entry}`, 'bone', stealth));
    }
  }
  return lines.join('\n');
}

export function getGameScreenParts(state: GameState, stealth: boolean): GameScreenParts {
  const before: string[] = [];
  const after: string[] = [];

  if (state.lastEvents.length > 0) {
    before.push(paint('--- Rolls & Events ---', 'dim', stealth));
    for (const ev of state.lastEvents) {
      before.push(paint(`  * ${ev}`, 'bone', stealth));
    }
  }

  if (state.mode === 'game_over') {
    before.push(paint('\n*** THE END HAS COME ***', 'red', stealth));
    after.push(paint('Commands: quit', 'dim', stealth));
    return {
      beforeNarration: before.join('\n'),
      narration: state.gameOverReason ?? 'All is lost.',
      afterNarration: after.join('\n'),
    };
  }

  if (state.mode === 'combat' && state.activeCombat) {
    const c = state.activeCombat;
    before.push(paint(`\n--- VIOLENCE: ROUND ${c.round} ---`, 'red', stealth));
    before.push(paint('Player-facing combat: roll to attack (DR12) and roll Agility (DR12) to defend.', 'dim', stealth));
    before.push(renderDrAndCombatModTable(stealth));
    c.enemies.forEach((e, idx) => {
      const st = e.status === 'active' ? `${e.hp}/${e.maxHp} HP` : e.status.toUpperCase();
      before.push(
        paint(
          `  [${idx + 1}] ${e.name} | ${st} | Atk DR${e.attackDr} Def DR${e.defenceDr} | ${e.attackName} (${e.damageDie})${e.armorDie ? ` Armor -${e.armorDie}` : ''}`,
          e.status === 'active' ? 'bone' : 'dim',
          stealth,
        ),
      );
    });
    const activePc = state.party.members[state.party.activePcIndex];
    after.push(paint(`\nActing PC: ${activePc?.name ?? 'None'} (use "pc <1-4>" to switch)`, 'ochre', stealth));
    after.push(paint('Combat Actions:', 'yellow', stealth));
    after.push(paint('  1. Attack enemy #1 (or type: attack <enemy#>)', 'bone', stealth));
    after.push(paint('  2. Attack #1 spending 1 Omen for MAX damage', 'bone', stealth));
    after.push(paint('  3. Attack #1 spending 1 Omen for -4 DR', 'bone', stealth));
    after.push(paint('  4. Cast a scroll (or type: cast <scroll#>)', 'bone', stealth));
    after.push(paint('  5. Flee combat (Agility DR12)', 'bone', stealth));
    return {
      beforeNarration: before.join('\n'),
      narration: '',
      afterNarration: after.join('\n'),
    };
  }

  // Spoiler-free dungeon view: only current room label + visible exits
  if (state.mode === 'dungeon' && state.activeDungeon) {
    const d = state.activeDungeon;
    const cur = d.rooms[d.currentRoomId];
    before.push(paint(`\n--- ${d.name} | ${cur.label} ---`, 'ochre', stealth));
    const visibleExits = cur.exits.filter((id) => !d.rooms[id]?.secretHidden || d.puzzleSolved);
    before.push(
      paint(
        `Exits: ${visibleExits.map((id) => `Room #${id + 1}`).join(', ')} (or choose below)`,
        'dim',
        stealth,
      ),
    );
  }

  if (state.pendingChoices.length > 0) {
    after.push(paint('Choices (type number, freeform action, or "help"):', 'yellow', stealth));
    state.pendingChoices.forEach((ch, idx) => {
      after.push(paint(`  ${idx + 1}. ${ch}`, 'bone', stealth));
    });
  }

  return {
    beforeNarration: before.join('\n'),
    narration: state.pendingNarration,
    afterNarration: after.join('\n'),
  };
}

export function renderGameScreen(state: GameState, stealth: boolean): string {
  const parts = getGameScreenParts(state, stealth);
  return [parts.beforeNarration, parts.narration, parts.afterNarration].filter(Boolean).join('\n\n');
}
