/**
 * Phase A binary verify — SurrealDB multi-row INSERT 支持性 + 加速比验证
 *
 * 档 3 (createNotesBatch perf) 前置 gate:确认
 *   `INSERT INTO atom $rows`（$rows = array of objects）
 * 在本机实际 SurrealDB server + SDK 版本下:
 *   1. 语法被接受(不报 ValidationError)
 *   2. 真正批量写入(SELECT 回来 row 数 == N)
 *   3. 相对 N 次串行 CREATE 至少 10x 加速
 *
 * 关键纪律:
 *  - **真 rocksdb 引擎**,不是 mem://([[feedback_surrealdb_pipeline_rocksdb_limited]])。
 *    本测自己 spawn `surreal start rocksdb://<tmp>` sidecar(镜像 src/storage/surreal/client.ts
 *    的连接逻辑),走真 SDK WebSocket,**不复用** `@storage/index`(被 tests/setup.ts mock)。
 *  - SDK 版本绑定 verify([[feedback_sdk_version_binding_policy]]):升级 surrealdb SDK /
 *    SurrealDB server 前必跑本测,确认 multi-row INSERT 语义未变。
 *  - 环境无 surreal binary → 跳过(不伪 PASS,不伪 FAIL)。
 *
 * 字面证据(实施期 grep):
 *   package.json:    "surrealdb": "^2.0.3"
 *   node_modules:    surrealdb@2.0.3
 *   surreal binary:  3.0.4 for macos on aarch64 (/opt/homebrew/bin/surreal)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Surreal, RecordId } from 'surrealdb';

// ── surreal binary 查找(镜像 client.ts findBinary 候选,但不依赖 electron app) ──
function findSurrealBinary(): string | null {
  const candidates = [
    '/opt/homebrew/bin/surreal',
    '/usr/local/bin/surreal',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

const BINARY = findSurrealBinary();
const PORT = 8599; // 避开 app 默认 8533,防撞正在跑的 dev server
const NAMESPACE = 'krig';
const DATABASE = 'multirow_verify';
const USERNAME = 'root';
const PASSWORD = 'verify-pass';
const READY_TIMEOUT = 15000;

let serverProcess: ChildProcess | null = null;
let db: Surreal | null = null;
let dbDir: string | null = null;

async function waitForReady(): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`surreal server failed to start within ${READY_TIMEOUT}ms`);
}

// SurrealDB 在同一 ms 内 array index 区分;为唯一性用进程内单调计数器
let idCounter = 0;
function uid(): number {
  return idCounter++;
}

describe.skipIf(!BINARY)('SurrealDB multi-row INSERT verify (Phase A)', () => {
  beforeAll(async () => {
    if (!BINARY) return;
    dbDir = mkdtempSync(path.join(tmpdir(), 'krig-multirow-verify-'));
    serverProcess = spawn(
      BINARY,
      [
        'start',
        '--bind', `127.0.0.1:${PORT}`,
        '--username', USERNAME,
        '--password', PASSWORD,
        '--log', 'warn',
        `rocksdb://${dbDir}`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    serverProcess.stdout?.on('data', (d: Buffer) =>
      console.log(`[surreal] ${d.toString().trim()}`),
    );
    serverProcess.stderr?.on('data', (d: Buffer) =>
      console.log(`[surreal] ${d.toString().trim()}`),
    );
    await waitForReady();

    db = new Surreal();
    await db.connect(`ws://127.0.0.1:${PORT}/rpc`);
    await db.signin({ username: USERNAME, password: PASSWORD });
    await db.use({ namespace: NAMESPACE, database: DATABASE });
  }, 30000);

  afterAll(async () => {
    try { await db?.close(); } catch { /* ignore */ }
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGKILL');
    }
    if (dbDir) {
      try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('multi-row: INSERT INTO atom $rows 接受 array 且真批量写入', async () => {
    const N = 1000;
    const marker = `verify-multi-${uid()}`;
    const now = Date.now();
    const rows = Array.from({ length: N }, (_, i) => ({
      // 字面镜像 atomRid(): new RecordId('atom', id)(Phase B batchPutAtomsViaTx 同款)
      id: new RecordId('atom', `multi_${marker}_${i}`),
      createdAt: now,
      updatedAt: now,
      createdBy: marker,
      payload: { domain: 'pm', payload: {} },
    }));

    const t0 = performance.now();
    // Phase B 字面将用的 SQL 形式
    await db!.query('INSERT INTO atom $rows', { rows });
    const dur = performance.now() - t0;
    console.log(`[verify] multi-row N=${N} dur=${dur.toFixed(1)}ms`);

    // 真 verify:SELECT 回来 row 数 == N
    const selected = await db!.query<[Array<{ id: unknown }>]>(
      'SELECT id FROM atom WHERE createdBy = $u',
      { u: marker },
    );
    expect(selected[0].length).toBe(N);
  }, 30000);

  it('serial baseline: N 次串行 CREATE 计时(对比基线)', async () => {
    const N = 1000;
    const marker = `verify-serial-${uid()}`;
    const now = Date.now();

    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      // 字面镜像 putAtomViaTx 的 CREATE $rid 形式(rid = RecordId,非 string)
      await db!.query(
        'CREATE $rid SET createdAt = $now, updatedAt = $now, createdBy = $u, payload = $p',
        {
          rid: new RecordId('atom', `serial_${marker}_${i}`),
          now,
          u: marker,
          p: { domain: 'pm', payload: {} },
        },
      );
    }
    const dur = performance.now() - t0;
    console.log(`[verify] serial N=${N} dur=${dur.toFixed(1)}ms`);

    const selected = await db!.query<[Array<{ id: unknown }>]>(
      'SELECT id FROM atom WHERE createdBy = $u',
      { u: marker },
    );
    expect(selected[0].length).toBe(N);
  }, 60000);

  it('加速比判据: multi-row ≥ 10x serial 且 multi-row < 500ms', async () => {
    const N = 1000;
    const now = Date.now();

    // multi-row
    const multiMarker = `verify-ratio-multi-${uid()}`;
    const rows = Array.from({ length: N }, (_, i) => ({
      id: new RecordId('atom', `rmulti_${multiMarker}_${i}`),
      createdAt: now,
      updatedAt: now,
      createdBy: multiMarker,
      payload: { domain: 'pm', payload: {} },
    }));
    const tm0 = performance.now();
    await db!.query('INSERT INTO atom $rows', { rows });
    const multiDur = performance.now() - tm0;

    // serial
    const serialMarker = `verify-ratio-serial-${uid()}`;
    const ts0 = performance.now();
    for (let i = 0; i < N; i++) {
      await db!.query(
        'CREATE $rid SET createdAt = $now, updatedAt = $now, createdBy = $u, payload = $p',
        {
          rid: new RecordId('atom', `rserial_${serialMarker}_${i}`),
          now,
          u: serialMarker,
          p: { domain: 'pm', payload: {} },
        },
      );
    }
    const serialDur = performance.now() - ts0;

    const ratio = serialDur / multiDur;
    console.log(
      `[verify] RATIO N=${N} multi=${multiDur.toFixed(1)}ms serial=${serialDur.toFixed(1)}ms ratio=${ratio.toFixed(1)}x`,
    );

    // 字面判据(prompt §2.1):multi < 500ms 且 ratio ≥ 10
    expect(multiDur).toBeLessThan(500);
    expect(ratio).toBeGreaterThanOrEqual(10);
  }, 60000);
});
