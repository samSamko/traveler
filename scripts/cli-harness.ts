import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function runCli(saveDir: string, stdinText: string): string {
  return execFileSync(
    process.execPath,
    [join(process.cwd(), 'src', 'index.ts'), '--stealth', '--no-anim'],
    {
      input: stdinText,
      encoding: 'utf8',
      env: { ...process.env, MORKBORG_SAVE_DIR: saveDir },
      timeout: 15000,
    },
  );
}

function main(): void {
  const saveDir = mkdtempSync(join(tmpdir(), 'mb-cli-harness-'));
  try {
    // Transcript 1: Solo random class -> tables, summary, shop, sell, depart, quit (creates save)
    const out1 = runCli(
      saveDir,
      '3\n2\n1\ntables\nsummary\nshop\nbuy 1\nsell all\ndepart\nquit\n',
    );
    assert.ok(out1.includes('Ability Modifier Table'), 'CLI #1 should display tables');
    assert.ok(out1.includes('Quartermaster & Services'), 'CLI #1 should display Quartermaster');
    assert.ok(out1.includes('Run saved.'), 'CLI #1 should save cleanly on quit');
    assert.ok(existsSync(join(saveDir, 'active_run.json')), 'CLI #1 should create active_run.json');

    // Transcript 2: Resume saved run -> map/summary -> quit
    const out2 = runCli(saveDir, '1\nsummary\ncalendar\nquit\n');
    assert.ok(out2.includes('Existing run found:'), 'CLI #2 should prompt to resume');
    assert.ok(out2.includes('Calendar of Nechrubel'), 'CLI #2 should display calendar');
    assert.ok(out2.includes('Run saved.'), 'CLI #2 should re-save on quit');

    // Transcript 3: Wipe existing run -> party manual classes (2..6 / 0..6) -> sheet, rest, quit
    const out3 = runCli(
      saveDir,
      '2\n3\n1\n2\n0\n1\n2\n3\nsheet 1\nrest\nquit\n',
    );
    assert.ok(out3.includes('Classes & Roll Modifiers'), 'CLI #3 should display class table');
    assert.ok(out3.includes('Day 2 dawns.'), 'CLI #3 should run Dawn rest');
    assert.ok(out3.includes('Run saved.'), 'CLI #3 should exit cleanly');

    // Transcript 4: Wipe -> d2 apocalypse run -> rest loop until 7:7 game over or quit
    const rests = Array.from({ length: 40 }, () => 'rest').join('\n');
    const out4 = runCli(saveDir, `2\n5\n2\n1\n${rests}\nquit\n`);
    assert.ok(
      out4.includes('Run saved.') || out4.includes('THE END HAS COME') || out4.includes('Seventh Misery') || out4.includes('perished'),
      'CLI #4 should reach apocalypse/death or quit cleanly',
    );

    console.log('CLI harness verification PASSED (4 transcripts: solo, resume, manual party, d2 apocalypse).');
  } finally {
    rmSync(saveDir, { recursive: true, force: true });
  }
}

main();
