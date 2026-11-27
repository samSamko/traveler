import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function main(): void {
  const root = process.cwd();
  const loaderPath = join(root, 'src', 'db', 'loader.ts');
  const proceduralPath = join(root, 'src', 'gm', 'procedural.ts');
  const dungeonPath = join(root, 'src', 'rules', 'dungeon.ts');
  const enginePath = join(root, 'src', 'engine.ts');
  const typesPath = join(root, 'src', 'types.ts');

  const loaderSrc = readFileSync(loaderPath, 'utf8');
  const proceduralSrc = readFileSync(proceduralPath, 'utf8');
  const dungeonSrc = readFileSync(dungeonPath, 'utf8');
  const engineSrc = readFileSync(enginePath, 'utf8');
  const typesSrc = readFileSync(typesPath, 'utf8');

  const allNonLoaderFiles = collectTsFiles(join(root, 'src'))
    .filter((p) => p !== loaderPath)
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n');

  // 1. Audit WorldDatabase properties for unreferenced datasets
  const worldDbBlockMatch = loaderSrc.match(/export interface WorldDatabase \{([\s\S]*?)\n\}/);
  assert.ok(worldDbBlockMatch, 'Could not parse WorldDatabase interface in src/db/loader.ts');

  const allowUnused = new Set<string>([
    'db',       // Raw DatabaseSync handle used inside loader / schema validation
    'services', // Flavor price table mirrored in SHOP_CATALOG
  ]);

  const topProps: string[] = [];
  let braceDepth = 0;
  for (const line of worldDbBlockMatch[1].split('\n')) {
    const trimmed = line.trim();
    if (braceDepth === 0) {
      const m = trimmed.match(/^([a-zA-Z0-9_]+)\s*:/);
      if (m) topProps.push(m[1]);
    }
    for (const ch of line) {
      if (ch === '{') braceDepth += 1;
      else if (ch === '}') braceDepth -= 1;
    }
  }

  const isPropUsed = (p: string): boolean => new RegExp(`\\.${p}\\b`).test(allNonLoaderFiles);
  const unusedProps: string[] = [];
  for (const prop of topProps) {
    if (allowUnused.has(prop)) continue;
    if (isPropUsed(prop)) continue;
    // Allow array/map index aliases only when the sibling index of the exact same table is used
    if (prop.endsWith('ById') && isPropUsed(prop.slice(0, -4))) continue;
    if (isPropUsed(`${prop}ById`)) continue;
    unusedProps.push(prop);
  }
  assert.equal(unusedProps.length, 0, `Unused WorldDatabase properties detected: ${unusedProps.join(', ')}`);

  // 2. Audit RoomInteractable['kind'] values emitted vs handled
  const interBlockMatch = typesSrc.match(/export interface RoomInteractable \{[\s\S]*?kind:([\s\S]*?);/);
  assert.ok(interBlockMatch, 'Could not parse RoomInteractable.kind in src/types.ts');
  const declaredInterKinds = [...interBlockMatch[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
  const unhandledInterKinds = declaredInterKinds.filter((k) => {
    const isSpiritNote = k === 'spirit'; // Handled via Table B log message
    if (isSpiritNote) return false;
    return !proceduralSrc.includes(`inter.kind === '${k}'`);
  });
  assert.equal(
    unhandledInterKinds.length,
    0,
    `Unhandled RoomInteractable kinds in executeInteractable: ${unhandledInterKinds.join(', ')}`,
  );

  // 3. Audit actionId literals emitted in procedural.ts
  const emittedActions = new Set<string>();
  for (const m of proceduralSrc.matchAll(/actionId:\s*'([a-z0-9_]+)'/g)) {
    emittedActions.add(m[1]);
  }
  const combinedHandlers = `${proceduralSrc}\n${engineSrc}`;
  const unhandledActions = [...emittedActions].filter(
    (id) => !combinedHandlers.includes(`actionId === '${id}'`),
  );
  assert.equal(
    unhandledActions.length,
    0,
    `Unhandled ChoiceOption actionIds: ${unhandledActions.join(', ')}`,
  );

  // 4. Verify every DungeonRoomRole declared in types.ts is reachable in dungeon.ts
  const roleBlockMatch = typesSrc.match(/export type DungeonRoomRole =([\s\S]*?);/);
  assert.ok(roleBlockMatch, 'Could not parse DungeonRoomRole in src/types.ts');
  const declaredRoles = [...roleBlockMatch[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
  const missingRoles = declaredRoles.filter((r) => !dungeonSrc.includes(`'${r}'`));
  assert.equal(missingRoles.length, 0, `Unused DungeonRoomRole values: ${missingRoles.join(', ')}`);

  // 5. Ensure old/ legacy folder never comes back
  assert.equal(existsSync(join(root, 'old')), false, 'Legacy old/ directory must not exist');

  console.log(
    `Static audit PASSED: ${topProps.length} WorldDatabase datasets, ${declaredInterKinds.length} interactables, ${emittedActions.size} actionIds, ${declaredRoles.length} room roles verified.`,
  );
}

main();
