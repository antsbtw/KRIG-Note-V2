/**
 * Phase A binary verify — bulkDeleteAtomsAndEdges edge DELETE 全表扫修法候选
 *
 * diagnose 报告(diagnose/bulk-delete-perf 13a744ad)字面锁定 dominant 真因:
 *   `DELETE edge WHERE subject.atomId INSIDE $ids
 *                   OR (object.kind='atom' AND object.atomId INSIDE $ids) RETURN BEFORE`
 * 因 跨字段 OR + 大数组 INSIDE 击穿 edge_subject / edge_object 索引,
 * 27 批每批全表扫整张 edge 表,累计 35.9s(占 58.6s 总耗时 61.3%)。
 *
 * 决定性指纹:edge_ms 从 2522ms 单调递减到 88ms(28×),
 * 但每批 edge_cnt(实删边数)恒定 ~2400 —— 耗时只随"表里剩余总边数"变,
 * 与"实删边数"无关 = 全表扫描签名。
 *
 * 本测 binary verify 3 候选(prompt §2.1)+ 对照 baseline,各跑 27 批模拟,记每批 edge_ms:
 *   - 对照:原 OR + INSIDE(复现 baseline 全表扫签名:edge_ms 单调递减)
 *   - 候选 A:拆 OR 为两条单字段 INSIDE DELETE(期望命中索引,edge_ms 不再递减)
 *   - 候选 B:逐 id 点查 = $id 循环(100% 索引命中,但 2N 条 SQL)
 *   - 候选 C:候选 A + 去 RETURN BEFORE(看 BEFORE 物化是否额外加速)
 * + atom DELETE 同步 verify(`DELETE atom WHERE id INSIDE $rids` 是否同样全表扫)。
 *
 * 关键纪律:
 *  - **真 rocksdb 引擎**,不是 mem://([[feedback_surrealdb_pipeline_rocksdb_limited]])。
 *    自 spawn `surreal start rocksdb://<tmp>` sidecar(镜像 surreal-multirow-verify.test.ts),
 *    走真 SDK WebSocket,**不复用** `@storage/index`(被 tests/setup.ts mock)。
 *  - SDK 版本绑定 verify([[feedback_sdk_version_binding_policy]]):升级 surrealdb SDK /
 *    SurrealDB server 前必跑本测,确认改写后 SQL 索引行为未变。
 *  - 环境无 surreal binary → 跳过(不伪 PASS,不伪 FAIL)。
 *  - 本测为永久 SDK regression(prompt §4),不删。
 *
 * 字面证据(实施期 grep):
 *   package.json:    "surrealdb": "^2.0.3"
 *   node_modules:    surrealdb@2.0.3
 *   surreal binary:  3.0.4 for macos on aarch64 (/opt/homebrew/bin/surreal)
 *   schema.ts:61/67: DEFINE INDEX edge_subject ON edge FIELDS subject.atomId / edge_object ... object.atomId
 *   queries-common.ts:5-9: atomRid/edgeRid = new RecordId('atom'|'edge', id)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Surreal, RecordId } from 'surrealdb';

// ── surreal binary 查找(镜像 surreal-multirow-verify.test.ts) ──
function findSurrealBinary(): string | null {
  const candidates = ['/opt/homebrew/bin/surreal', '/usr/local/bin/surreal'];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

const BINARY = findSurrealBinary();
const PORT = 8601; // 避开 app 默认 8533 + multirow-verify 8599
const NAMESPACE = 'krig';
const DATABASE = 'bulk_delete_verify';
const USERNAME = 'root';
const PASSWORD = 'verify-pass';
const READY_TIMEOUT = 15000;

// ── 数据规模(贴近 92 篇 markdown 真实场景:diagnose 实删 26569 atom / 63042 edge) ──
const N_ATOM = 27000; // 27 批 × 1000
const BATCH_SIZE = 1000; // DELETE_BATCH_SIZE 字面同款
const N_BATCH = N_ATOM / BATCH_SIZE; // 27 批
// 每个 atom 生 ~2.3 边(贴近 63042/26569 ≈ 2.37):subject 侧 belongsToNote + childOf,object 侧 nextSibling
const INSERT_CHUNK = 5000; // 单条 INSERT 行数上限(防 payload 过大)

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

// edge 表索引(字面镜像 schema.ts:60-70,本测自起的库无 migration,需手动 DEFINE)
const EDGE_INDEX_DDL = `
  DEFINE INDEX IF NOT EXISTS edge_predicate ON edge FIELDS predicate;
  DEFINE INDEX IF NOT EXISTS edge_subject ON edge FIELDS subject.atomId;
  DEFINE INDEX IF NOT EXISTS edge_object ON edge FIELDS object.atomId;
  DEFINE INDEX IF NOT EXISTS edge_subject_predicate ON edge FIELDS subject.atomId, predicate;
`;

// atom id(字面镜像 deleteFolder 收集的 26569 atom id 形态)
function atomIdAt(i: number): string {
  return `blk_${i}`;
}

// 一次种好全部 atom + edge(multi-row INSERT,档 3 同款套路)。
async function seedData(): Promise<{ totalEdges: number }> {
  const now = Date.now();

  // ── atom: N_ATOM 行 ──
  for (let off = 0; off < N_ATOM; off += INSERT_CHUNK) {
    const end = Math.min(off + INSERT_CHUNK, N_ATOM);
    const rows = [];
    for (let i = off; i < end; i++) {
      rows.push({
        id: new RecordId('atom', atomIdAt(i)),
        createdAt: now,
        updatedAt: now,
        createdBy: 'seed',
        payload: { domain: 'pm', payload: {} },
      });
    }
    await db!.query('INSERT INTO atom $rows', { rows });
  }

  // ── edge: 每个 atom 生 ~2.3 边 ──
  // subject 侧 2 边:belongsToNote(object=literal container) + childOf(object=atom parent)
  // object 侧 1 边(隔一个):nextSibling(subject=atom prev, object=atom 本块)
  let edgeSeq = 0;
  let totalEdges = 0;
  let edgeBuf: Array<Record<string, unknown>> = [];

  const flush = async () => {
    if (edgeBuf.length === 0) return;
    await db!.query('INSERT INTO edge $rows', { rows: edgeBuf });
    totalEdges += edgeBuf.length;
    edgeBuf = [];
  };

  for (let i = 0; i < N_ATOM; i++) {
    const aid = atomIdAt(i);
    // subject 侧边 1:belongsToNote(subject=本块 atom,object=literal 容器)
    // predicate 必须满足 schema.ts:44 regex ^(user|ai|sys):...,字面用 capability-impl.ts:50 同款 'sys:belongsToNote'
    // object literal 字面镜像 schema.ts:52-53(object.type / object.value),非 literalValue
    edgeBuf.push({
      id: new RecordId('edge', `e_${edgeSeq++}`),
      predicate: 'sys:belongsToNote',
      subject: { kind: 'atom', atomId: aid },
      object: { kind: 'literal', type: 'string', value: 'container-x' },
      createdAt: now,
      updatedAt: now,
      attrs: { createdBy: 'seed', createdAt: now },
    });
    // subject 侧边 2:childOf(subject=本块 atom,object=atom 父块)
    edgeBuf.push({
      id: new RecordId('edge', `e_${edgeSeq++}`),
      predicate: 'sys:childOf',
      subject: { kind: 'atom', atomId: aid },
      object: { kind: 'atom', atomId: atomIdAt(i === 0 ? 0 : i - 1) },
      createdAt: now,
      updatedAt: now,
      attrs: { createdBy: 'seed', createdAt: now },
    });
    // object 侧边(隔一个):nextSibling(subject=前块 atom,object=本块 atom)
    if (i % 2 === 0 && i > 0) {
      edgeBuf.push({
        id: new RecordId('edge', `e_${edgeSeq++}`),
        predicate: 'sys:nextSibling',
        subject: { kind: 'atom', atomId: atomIdAt(i - 1) },
        object: { kind: 'atom', atomId: aid },
        createdAt: now,
        updatedAt: now,
        attrs: { createdBy: 'seed', createdAt: now },
      });
    }
    if (edgeBuf.length >= INSERT_CHUNK) await flush();
  }
  await flush();
  return { totalEdges };
}

// 取第 b 批(0-based)的 atom id 子集 + RecordId 子集
function batchIds(b: number): { ids: string[]; rids: RecordId[] } {
  const off = b * BATCH_SIZE;
  const end = Math.min(off + BATCH_SIZE, N_ATOM);
  const ids: string[] = [];
  const rids: RecordId[] = [];
  for (let i = off; i < end; i++) {
    ids.push(atomIdAt(i));
    rids.push(new RecordId('atom', atomIdAt(i)));
  }
  return { ids, rids };
}

// 趋势判定:首批 / 末批 / 是否单调递减(全表扫签名)
function summarize(label: string, perBatch: number[]): {
  first: number;
  last: number;
  total: number;
  max: number;
  declineRatio: number;
} {
  const first = perBatch[0];
  const last = perBatch[perBatch.length - 1];
  const total = perBatch.reduce((a, b) => a + b, 0);
  const max = Math.max(...perBatch);
  // declineRatio = 首批/末批,>5 ≈ 强单调递减(全表扫);≈1 ≈ 平稳(走索引)
  const declineRatio = last > 0 ? first / last : Infinity;
  console.log(
    `[verify] ${label}: first=${first.toFixed(0)}ms last=${last.toFixed(0)}ms ` +
      `max=${max.toFixed(0)}ms total=${total.toFixed(0)}ms declineRatio=${declineRatio.toFixed(1)}x ` +
      `perBatch=[${perBatch.map((x) => x.toFixed(0)).join(',')}]`,
  );
  return { first, last, total, max, declineRatio };
}

describe.skipIf(!BINARY)('bulkDelete edge DELETE perf candidates (Phase A)', () => {
  beforeAll(async () => {
    if (!BINARY) return;
    dbDir = mkdtempSync(path.join(tmpdir(), 'krig-bulk-delete-verify-'));
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
    await db.query(EDGE_INDEX_DDL);
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

  // 每个候选独立 it:beforeEach 模式无法 reset 大数据(种一次太慢),
  // 故每个 it 内部自己 seed → 跑 27 批 → 验删空。describe 串行执行,库在 it 间不共享残留。

  it('对照(baseline): 原 OR + INSIDE — 复现全表扫签名(edge_ms 单调递减)', async () => {
    const { totalEdges } = await seedData();
    console.log(`[verify] baseline seeded: ${N_ATOM} atom / ${totalEdges} edge`);

    const edgeMs: number[] = [];
    let deletedEdges = 0;
    for (let b = 0; b < N_BATCH; b++) {
      const { ids } = batchIds(b);
      const t0 = performance.now();
      const res = await db!.query<[Array<unknown>]>(
        `DELETE edge
           WHERE subject.atomId INSIDE $ids
              OR (object.kind = 'atom' AND object.atomId INSIDE $ids)
           RETURN BEFORE`,
        { ids },
      );
      edgeMs.push(performance.now() - t0);
      deletedEdges += res[0]?.length ?? 0;
    }
    const s = summarize('baseline(OR+INSIDE)', edgeMs);
    // 删空全部(belongsToNote/childOf/nextSibling 全覆盖)
    const remain = await db!.query<[Array<unknown>]>('SELECT id FROM edge', {});
    console.log(`[verify] baseline deletedEdges=${deletedEdges} remain=${remain[0].length}`);
    expect(remain[0].length).toBe(0);
    // 仅记录趋势,不做硬断言(baseline 是对照,主目标是复现签名供对比)
    expect(deletedEdges).toBe(totalEdges);
    // 清 atom 给下一个 it 干净库
    await db!.query('DELETE atom', {});
  }, 180000);

  it('候选 A: 拆 OR 为两条单字段 INSIDE DELETE — 27 批', async () => {
    const { totalEdges } = await seedData();
    console.log(`[verify] candidate A seeded: ${N_ATOM} atom / ${totalEdges} edge`);

    const edgeMs: number[] = [];
    let deletedEdges = 0;
    for (let b = 0; b < N_BATCH; b++) {
      const { ids } = batchIds(b);
      const t0 = performance.now();
      const sres = await db!.query<[Array<unknown>]>(
        `DELETE edge WHERE subject.atomId INSIDE $ids RETURN BEFORE`,
        { ids },
      );
      const ores = await db!.query<[Array<unknown>]>(
        `DELETE edge WHERE object.kind = 'atom' AND object.atomId INSIDE $ids RETURN BEFORE`,
        { ids },
      );
      edgeMs.push(performance.now() - t0);
      deletedEdges += (sres[0]?.length ?? 0) + (ores[0]?.length ?? 0);
    }
    summarize('candidateA(拆OR)', edgeMs);
    const remain = await db!.query<[Array<unknown>]>('SELECT id FROM edge', {});
    console.log(`[verify] candidate A deletedEdges=${deletedEdges} remain=${remain[0].length}`);
    expect(remain[0].length).toBe(0);
    expect(deletedEdges).toBe(totalEdges);
    await db!.query('DELETE atom', {});
  }, 180000);

  it('候选 B: 逐 id 点查 = $id 循环 — 27 批', async () => {
    const { totalEdges } = await seedData();
    console.log(`[verify] candidate B seeded: ${N_ATOM} atom / ${totalEdges} edge`);

    const edgeMs: number[] = [];
    let deletedEdges = 0;
    for (let b = 0; b < N_BATCH; b++) {
      const { ids } = batchIds(b);
      const t0 = performance.now();
      for (const id of ids) {
        const sres = await db!.query<[Array<unknown>]>(
          `DELETE edge WHERE subject.atomId = $id RETURN BEFORE`,
          { id },
        );
        const ores = await db!.query<[Array<unknown>]>(
          `DELETE edge WHERE object.kind = 'atom' AND object.atomId = $id RETURN BEFORE`,
          { id },
        );
        deletedEdges += (sres[0]?.length ?? 0) + (ores[0]?.length ?? 0);
      }
      edgeMs.push(performance.now() - t0);
    }
    summarize('candidateB(逐id点查)', edgeMs);
    const remain = await db!.query<[Array<unknown>]>('SELECT id FROM edge', {});
    console.log(`[verify] candidate B deletedEdges=${deletedEdges} remain=${remain[0].length}`);
    expect(remain[0].length).toBe(0);
    expect(deletedEdges).toBe(totalEdges);
    await db!.query('DELETE atom', {});
  }, 300000);

  it('候选 C: 候选 A + 去 RETURN BEFORE — 27 批', async () => {
    const { totalEdges } = await seedData();
    console.log(`[verify] candidate C seeded: ${N_ATOM} atom / ${totalEdges} edge`);

    const edgeMs: number[] = [];
    for (let b = 0; b < N_BATCH; b++) {
      const { ids } = batchIds(b);
      const t0 = performance.now();
      await db!.query(`DELETE edge WHERE subject.atomId INSIDE $ids`, { ids });
      await db!.query(
        `DELETE edge WHERE object.kind = 'atom' AND object.atomId INSIDE $ids`,
        { ids },
      );
      edgeMs.push(performance.now() - t0);
    }
    summarize('candidateC(拆OR+去BEFORE)', edgeMs);
    const remain = await db!.query<[Array<unknown>]>('SELECT id FROM edge', {});
    console.log(`[verify] candidate C seeded=${totalEdges} remain=${remain[0].length}`);
    expect(remain[0].length).toBe(0);
    await db!.query('DELETE atom', {});
  }, 180000);

  it('atom DELETE 同步 verify: DELETE atom WHERE id INSIDE $rids — 27 批', async () => {
    const { totalEdges } = await seedData();
    console.log(`[verify] atom-path seeded: ${N_ATOM} atom / ${totalEdges} edge`);

    // 先删边(用候选 A 快路径,只为清场让 atom DELETE 单独计时)
    for (let b = 0; b < N_BATCH; b++) {
      const { ids } = batchIds(b);
      await db!.query(`DELETE edge WHERE subject.atomId INSIDE $ids`, { ids });
      await db!.query(
        `DELETE edge WHERE object.kind = 'atom' AND object.atomId INSIDE $ids`,
        { ids },
      );
    }

    const atomMs: number[] = [];
    let deletedAtoms = 0;
    for (let b = 0; b < N_BATCH; b++) {
      const { rids } = batchIds(b);
      const t0 = performance.now();
      const res = await db!.query<[Array<unknown>]>(
        `DELETE atom WHERE id INSIDE $rids RETURN BEFORE`,
        { rids },
      );
      atomMs.push(performance.now() - t0);
      deletedAtoms += res[0]?.length ?? 0;
    }
    summarize('atom-path(id INSIDE $rids)', atomMs);
    const remain = await db!.query<[Array<unknown>]>('SELECT id FROM atom', {});
    console.log(`[verify] atom-path deletedAtoms=${deletedAtoms} remain=${remain[0].length}`);
    expect(remain[0].length).toBe(0);
    expect(deletedAtoms).toBe(N_ATOM);
  }, 180000);

  // ── atom DELETE 修法候选(prompt §2.1 / §2.2)──────────────────
  // 上面 "atom DELETE 同步 verify" it 是 baseline(`DELETE atom WHERE id INSIDE $rids`,
  // declineRatio 17× 全表扫签名,27 批累计 ~10912ms)。以下 3 候选各自 seed → 清边 → 跑
  // 27(或 270)批 atom DELETE,记每批 atom_ms,对照 baseline。
  // 关键 verify(prompt §2.2 / §5.1):候选 A 的 `DELETE $rids` RecordId array 形式
  // 是否被 surrealdb@2.0.3 SDK + surreal 3.0.4 server 字面接受 —— 第一 it 若报
  // ValidationError 即字面 abort 候选 A,数据落在 try/catch 报告里转 B/C。

  it('atom 候选 A: DELETE $rids RecordId array — 27 批', async () => {
    const { totalEdges } = await seedData();
    console.log(`[verify] atom-A seeded: ${N_ATOM} atom / ${totalEdges} edge`);

    // 先清边(候选 A 快路径),只为隔离 atom 段计时
    for (let b = 0; b < N_BATCH; b++) {
      const { ids } = batchIds(b);
      await db!.query(`DELETE edge WHERE subject.atomId INSIDE $ids`, { ids });
      await db!.query(
        `DELETE edge WHERE object.kind = 'atom' AND object.atomId INSIDE $ids`,
        { ids },
      );
    }
    // §5.4 边引用交叉验证:atom 还在但边应已清空(隔离前置条件)
    const edgeRemain = await db!.query<[Array<unknown>]>('SELECT id FROM edge', {});
    console.log(`[verify] atom-A edge cleared before atom-delete: remain=${edgeRemain[0].length}`);
    expect(edgeRemain[0].length).toBe(0);

    // ── 语法探针:先单条 `DELETE $rid`(prompt §5.1 字面已知支持)再 array `DELETE $rids` ──
    let syntaxAccepted = true;
    let syntaxError = '';
    let returnShape = 'unknown';
    try {
      // 单条探针(不计入计时,只为分离 array vs 单条语法支持性)
      const probe = await db!.query<unknown>(`DELETE $rid RETURN BEFORE`, {
        rid: new RecordId('atom', atomIdAt(0)),
      });
      returnShape = Array.isArray(probe)
        ? `outer-array len=${(probe as unknown[]).length} inner=${
            Array.isArray((probe as unknown[])[0])
              ? `array len=${((probe as unknown[])[0] as unknown[]).length}`
              : typeof (probe as unknown[])[0]
          }`
        : typeof probe;
      console.log(`[verify] atom-A single $rid probe ok, returnShape=${returnShape}`);
    } catch (e) {
      syntaxAccepted = false;
      syntaxError = `single $rid: ${(e as Error).message}`;
      console.log(`[verify] atom-A single $rid probe FAILED: ${syntaxError}`);
    }

    const atomMs: number[] = [];
    let deletedAtoms = 0;
    let arrayFormAccepted = true;
    try {
      for (let b = 0; b < N_BATCH; b++) {
        const { rids } = batchIds(b);
        const t0 = performance.now();
        const res = await db!.query<unknown>(`DELETE $rids RETURN BEFORE`, { rids });
        atomMs.push(performance.now() - t0);
        // 计数兼容多种返回形态:[[...]] / [...] / 其它
        const inner = Array.isArray(res) ? (res as unknown[])[0] : res;
        deletedAtoms += Array.isArray(inner) ? inner.length : 0;
      }
    } catch (e) {
      arrayFormAccepted = false;
      syntaxError = `array $rids: ${(e as Error).message}`;
      console.log(`[verify] atom-A array $rids FAILED: ${syntaxError}`);
    }

    if (syntaxAccepted && arrayFormAccepted) {
      summarize('atom-A(DELETE $rids array)', atomMs);
    } else {
      console.log(
        `[verify] atom-A SYNTAX NOT ACCEPTED — single=${syntaxAccepted} array=${arrayFormAccepted} err=${syntaxError}`,
      );
    }
    const remain = await db!.query<[Array<unknown>]>('SELECT id FROM atom', {});
    console.log(
      `[verify] atom-A deletedAtoms=${deletedAtoms} remain=${remain[0].length} arrayAccepted=${arrayFormAccepted}`,
    );
    // 候选 A 若语法被接受:期望删干净。若不接受:此 it 仅为报告语法支持性,不硬断言删空。
    if (arrayFormAccepted) {
      expect(remain[0].length).toBe(0);
    }
    await db!.query('DELETE atom', {});
    await db!.query('DELETE edge', {});
  }, 180000);

  it('atom 候选 B: 逐 RecordId DELETE $rid 循环 — 27 批', async () => {
    const { totalEdges } = await seedData();
    console.log(`[verify] atom-B seeded: ${N_ATOM} atom / ${totalEdges} edge`);

    for (let b = 0; b < N_BATCH; b++) {
      const { ids } = batchIds(b);
      await db!.query(`DELETE edge WHERE subject.atomId INSIDE $ids`, { ids });
      await db!.query(
        `DELETE edge WHERE object.kind = 'atom' AND object.atomId INSIDE $ids`,
        { ids },
      );
    }

    const atomMs: number[] = [];
    let deletedAtoms = 0;
    for (let b = 0; b < N_BATCH; b++) {
      const { rids } = batchIds(b);
      const t0 = performance.now();
      for (const rid of rids) {
        const res = await db!.query<[Array<unknown>]>(`DELETE $rid RETURN BEFORE`, { rid });
        const inner = res[0];
        deletedAtoms += Array.isArray(inner) ? inner.length : inner ? 1 : 0;
      }
      atomMs.push(performance.now() - t0);
    }
    summarize('atom-B(逐 $rid 循环)', atomMs);
    const remain = await db!.query<[Array<unknown>]>('SELECT id FROM atom', {});
    console.log(`[verify] atom-B deletedAtoms=${deletedAtoms} remain=${remain[0].length}`);
    expect(remain[0].length).toBe(0);
    await db!.query('DELETE edge', {});
  }, 300000);

  it('atom 候选 C: 改 batch size 1000→100 — 270 批 DELETE atom WHERE id INSIDE $rids100', async () => {
    const { totalEdges } = await seedData();
    console.log(`[verify] atom-C seeded: ${N_ATOM} atom / ${totalEdges} edge`);

    for (let b = 0; b < N_BATCH; b++) {
      const { ids } = batchIds(b);
      await db!.query(`DELETE edge WHERE subject.atomId INSIDE $ids`, { ids });
      await db!.query(
        `DELETE edge WHERE object.kind = 'atom' AND object.atomId INSIDE $ids`,
        { ids },
      );
    }

    // batch size 100 → 270 批,原 SQL 形式(id INSIDE $rids100)不变
    const SMALL_BATCH = 100;
    const N_SMALL_BATCH = N_ATOM / SMALL_BATCH; // 270
    const atomMs: number[] = [];
    let deletedAtoms = 0;
    for (let b = 0; b < N_SMALL_BATCH; b++) {
      const off = b * SMALL_BATCH;
      const end = Math.min(off + SMALL_BATCH, N_ATOM);
      const rids100: RecordId[] = [];
      for (let i = off; i < end; i++) rids100.push(new RecordId('atom', atomIdAt(i)));
      const t0 = performance.now();
      const res = await db!.query<[Array<unknown>]>(
        `DELETE atom WHERE id INSIDE $rids RETURN BEFORE`,
        { rids: rids100 },
      );
      atomMs.push(performance.now() - t0);
      deletedAtoms += res[0]?.length ?? 0;
    }
    // 270 批太多,summarize 打印全 perBatch 会刷屏 → 只打首/末/累计三段
    const total = atomMs.reduce((a, b) => a + b, 0);
    const first = atomMs[0];
    const last = atomMs[atomMs.length - 1];
    console.log(
      `[verify] atom-C(batch100,270批): first=${first.toFixed(0)}ms last=${last.toFixed(0)}ms ` +
        `total=${total.toFixed(0)}ms declineRatio=${(last > 0 ? first / last : Infinity).toFixed(1)}x ` +
        `deletedAtoms=${deletedAtoms}`,
    );
    const remain = await db!.query<[Array<unknown>]>('SELECT id FROM atom', {});
    console.log(`[verify] atom-C deletedAtoms=${deletedAtoms} remain=${remain[0].length}`);
    expect(remain[0].length).toBe(0);
    expect(deletedAtoms).toBe(N_ATOM);
    await db!.query('DELETE edge', {});
  }, 300000);
});
