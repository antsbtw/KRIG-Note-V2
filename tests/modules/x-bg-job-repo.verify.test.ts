/**
 * ⭐⭐ x_bg_job repo —— **真 SurrealDB** 行为验证(起本机 surreal 二进制,skipIf 没有)
 *
 * 为什么是真库不是 mock:datetime cast、option NONE、去重 WHERE、record::id、
 * 「UPSERT...WHERE 没匹配静默不写」这些坑**只有真库答得出**
 * (记忆 project-surreal-datetime-vs-string / project-surreal-sdk-vs-http-shape)。
 * 调的是 repo 的**真函数**(经 __setXDBForTest 指向测试库),不是重放 SQL。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Surreal } from 'surrealdb';
import { __setXDBForTest } from '@storage/surreal/client';
import { x_migration_1_2_26 } from '@storage/surreal/x-schema';
import {
  createJob, readJob, listJobs, activeJobsForWs, wsWithActiveJobs,
  saveJob, setJobStatus, deleteJob,
} from '@modules/x/x-bg-job-repo';
import { mergeSegment, type SegmentOutcome } from '@modules/x/x-bg-job';

function findBinary(): string | null {
  for (const c of ['/opt/homebrew/bin/surreal', '/usr/local/bin/surreal']) {
    if (existsSync(c)) return c;
  }
  return null;
}
const BINARY = findBinary();
const PORT = 8601; // 避开 app(8533) 与别的 verify 测试(8599)
const READY_TIMEOUT = 25000; // 全量高负载下 surreal 启动慢,15s 偶发超时(污染基线);< beforeAll 的 30000

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

describe.skipIf(!BINARY)('x_bg_job repo —— 真 SurrealDB 验证', () => {
  beforeAll(async () => {
    if (!BINARY) return;
    dbDir = mkdtempSync(path.join(tmpdir(), 'krig-bgjob-verify-'));
    proc = spawn(BINARY, ['start', '--bind', `127.0.0.1:${PORT}`,
      '--username', 'root', '--password', 'verify', '--log', 'warn', `rocksdb://${dbDir}`],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    await waitReady();
    db = new Surreal();
    await db.connect(`ws://127.0.0.1:${PORT}/rpc`);
    await db.signin({ username: 'root', password: 'verify' });
    await db.use({ namespace: 'krig', database: 'bgjob_verify' });
    await x_migration_1_2_26(db);
    __setXDBForTest(db);
  }, 40000);

  afterAll(async () => {
    __setXDBForTest(null);
    await db?.close();
    proc?.kill();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  it('⭐ 建任务 → 读回,字段对、option 没传为空、是 queued', async () => {
    const { id, created } = await createJob({ restId: '111', handle: 'alice', wsId: 'ws-1', range: 'all' });
    expect(created).toBe(true);
    const j = await readJob(id);
    expect(j).not.toBeNull();
    expect(j!.restId).toBe('111');
    expect(j!.status).toBe('queued');
    expect(j!.range).toBe('all');
    expect(j!.profile.done).toBe(false);
    expect(j!.profile.cursor, 'option 没传却有值').toBeUndefined();
    expect(j!.totalPages).toBe(0);
  });

  it('⭐⭐ 去重:同人同范围再建 → created=false、返回同一个 id', async () => {
    const a = await createJob({ restId: '222', handle: 'bob', wsId: 'ws-1', range: 'year' });
    const b = await createJob({ restId: '222', handle: 'bob', wsId: 'ws-1', range: 'year' });
    expect(a.created).toBe(true);
    expect(b.created, '同人同范围居然又建了一个 → 会并行采同一人').toBe(false);
    expect(b.id).toBe(a.id);
  });

  it('⭐ 不同范围不算重复', async () => {
    const a = await createJob({ restId: '333', handle: 'carol', wsId: 'ws-1', range: 'halfYear' });
    const b = await createJob({ restId: '333', handle: 'carol', wsId: 'ws-1', range: 'year' });
    expect(b.created).toBe(true);
    expect(b.id).not.toBe(a.id);
  });

  it('⭐⭐⭐ 存一段(datetime cast)→ 读回 oldestAt / lastSegmentAt 是真时间不是全表', async () => {
    const { id } = await createJob({ restId: '444', handle: 'dave', wsId: 'ws-2', range: 'all' });
    const j0 = await readJob(id);
    const out: SegmentOutcome = { tab: 'profile', pages: 5, saved: 80, nextCursor: 'cur5', tabDone: false, oldestAt: '2026-05-01T00:00:00.000Z' };
    const merged = mergeSegment(j0!, out, new Date('2026-10-13T12:00:00.000Z'));
    await saveJob(merged);
    const j1 = await readJob(id);
    expect(j1!.status).toBe('running');
    expect(j1!.profile.cursor).toBe('cur5');
    expect(j1!.profile.oldestAt?.slice(0, 10)).toBe('2026-05-01');
    expect(j1!.totalPages).toBe(5);
    expect(j1!.totalSaved).toBe(80);
    expect(j1!.lastSegmentAt, 'lastSegmentAt 没存 → 间隔判断失灵').toBeTruthy();
  });

  it('⭐⭐ 三页全到底 → saveJob 后 status=done', async () => {
    const { id } = await createJob({ restId: '555', handle: 'eve', wsId: 'ws-2', range: 'halfYear' });
    let j = (await readJob(id))!;
    for (const tab of ['profile', 'replies', 'reposts'] as const) {
      const out: SegmentOutcome = { tab, pages: 1, saved: 1, tabDone: true };
      j = mergeSegment(j, out, new Date());
      await saveJob(j);
    }
    const done = await readJob(id);
    expect(done!.status).toBe('done');
  });

  it('⭐⭐ activeJobsForWs 只取 queued/running,不含 done/paused', async () => {
    // ws-3 专用,避免与别的用例串
    const q = await createJob({ restId: '661', handle: 'f1', wsId: 'ws-3', range: 'all' });
    const p = await createJob({ restId: '662', handle: 'f2', wsId: 'ws-3', range: 'all' });
    await setJobStatus(p.id, 'paused');
    const active = await activeJobsForWs('ws-3');
    const ids = active.map((j) => j.id);
    expect(ids, 'queued 的没在').toContain(q.id);
    expect(ids, 'paused 的不该在活跃里').not.toContain(p.id);
  });

  it('⭐ wsWithActiveJobs 列出有活跃任务的 ws', async () => {
    const wss = await wsWithActiveJobs();
    expect(wss).toContain('ws-3');
  });

  it('⭐ setJobStatus 暂停↔恢复', async () => {
    const { id } = await createJob({ restId: '777', handle: 'grace', wsId: 'ws-4', range: 'all' });
    await setJobStatus(id, 'paused');
    expect((await readJob(id))!.status).toBe('paused');
    await setJobStatus(id, 'queued');
    expect((await readJob(id))!.status).toBe('queued');
  });

  it('⭐ deleteJob 删掉(取消)', async () => {
    const { id } = await createJob({ restId: '888', handle: 'heidi', wsId: 'ws-4', range: 'all' });
    await deleteJob(id);
    expect(await readJob(id)).toBeNull();
  });

  it('⭐ listJobs 按 ws 过滤', async () => {
    const only = await listJobs('ws-2');
    expect(only.length, 'ws-2 该有任务').toBeGreaterThan(0);
    expect(only.every((j) => j.wsId === 'ws-2'), '串进了别的 ws').toBe(true);
  });
});
