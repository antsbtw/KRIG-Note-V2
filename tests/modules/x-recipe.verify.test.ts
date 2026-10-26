/**
 * ⭐ 配方开关存得上(1.2.29,蓝V互关 M1)—— **真 SurrealDB**,调 repo 的真函数 upsertRecipe
 * 为什么真库:SCHEMAFULL 表里没定义的字段会被**静默丢掉** —— include_replies 当年就是这么丢的。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Surreal } from 'surrealdb';
import { __setXDBForTest } from '@storage/surreal/client';
import { runXMigrations } from '@storage/migrations/x-runner';
import { upsertRecipe, getRecipeById } from '@platform/main/db/search-recipe-repo';
import { BLUE_MUTUAL_RECIPES } from '../../scripts/x-seed-blue-mutual-recipes';

function findBinary(): string | null {
  for (const c of ['/opt/homebrew/bin/surreal', '/usr/local/bin/surreal']) if (existsSync(c)) return c;
  return null;
}
const BINARY = findBinary();
const PORT = 8605; // 避开 app(8533)与别的 verify(8599/8601/8603)
const READY_TIMEOUT = 25000;

let proc: ChildProcess | null = null;
let db: Surreal | null = null;
let dbDir: string | null = null;

async function waitReady(): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`surreal 没在 ${READY_TIMEOUT}ms 内起来`);
}

describe.skipIf(!BINARY)('配方开关 —— 真 SurrealDB 验证', () => {
  beforeAll(async () => {
    if (!BINARY) return;
    dbDir = mkdtempSync(path.join(tmpdir(), 'krig-recipe-verify-'));
    proc = spawn(BINARY, ['start', '--bind', `127.0.0.1:${PORT}`,
      '--username', 'root', '--password', 'verify', '--log', 'warn', `rocksdb://${dbDir}`],
    { stdio: ['ignore', 'pipe', 'pipe'] });
    await waitReady();
    db = new Surreal();
    await db.connect(`ws://127.0.0.1:${PORT}/rpc`);
    await db.signin({ username: 'root', password: 'verify' });
    await db.use({ namespace: 'krig', database: 'recipe_verify' });
    await runXMigrations(db);
    __setXDBForTest(db);
  }, 60000);

  afterAll(async () => {
    __setXDBForTest(null);
    await db?.close();
    proc?.kill();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  it('⭐⭐ 新建:只看蓝V / 连回复 存上并读回', async () => {
    const r = await upsertRecipe({ ...BLUE_MUTUAL_RECIPES[0], includeReplies: true });
    expect(r.blueOnly).toBe(true);
    expect(r.includeReplies, 'include_replies 又没存上(老 bug)').toBe(true);
    expect(r.keywords).toContain('互关必回');
  });

  it('⭐⭐ 修改:关掉也能存(不是只会存 true)', async () => {
    const r = await upsertRecipe({ ...BLUE_MUTUAL_RECIPES[1] });
    const off = await upsertRecipe({ ...r, blueOnly: false, includeReplies: false });
    expect([off.blueOnly, off.includeReplies]).toEqual([false, false]);
    const on = await upsertRecipe({ ...off, blueOnly: true });
    expect((await getRecipeById(on.id))?.blueOnly).toBe(true);
  });
});
