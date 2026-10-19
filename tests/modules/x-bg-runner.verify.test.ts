/**
 * ⭐⭐ 后台 runner 调度(tickOnce)—— 真 SurrealDB 摆任务 + 内存摆 ws 状态(skipIf 没二进制)
 *
 * tickOnce 从库挑任务,所以用真库摆真任务最贴近真实(注入假 repo 验不到「真从库挑」)。
 * 真采集(drive)注入假的、只记录「谁被跑了」—— 调度判断才是这里要钉的命脉:
 * 同 ws 串行 / 没开 X 网页跳过 / 你在忙让路 / 挑到期任务 / 间隔未到不跑。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Surreal } from 'surrealdb';
import { __setXDBForTest } from '@storage/surreal/client';
import { x_migration_1_2_26, x_migration_1_2_24, x_migration_1_2_34 } from '@storage/surreal/x-schema';
import { createJob, saveJob, readJob } from '@modules/x/x-bg-job-repo';
import { tickOnce, _resetBgRunner } from '@modules/x/x-bg-runner';
import { setXHostState, clearXHostState, setXHostBusy } from '@modules/x/x-host-registry';
import type { BgJob } from '@modules/x/x-bg-job';

function findBinary(): string | null {
  for (const c of ['/opt/homebrew/bin/surreal', '/usr/local/bin/surreal']) if (existsSync(c)) return c;
  return null;
}
const BINARY = findBinary();
const PORT = 8603; // 避开 app(8533)/verify(8601)
let proc: ChildProcess | null = null;
let db: Surreal | null = null;
let dbDir: string | null = null;

async function waitReady(): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 25000) { // 全量高负载下 surreal 启动慢,15s 偶发超时(污染基线);< beforeAll 的 30000
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('surreal 没起来');
}

describe.skipIf(!BINARY)('x-bg-runner tickOnce —— 真库调度', () => {
  beforeAll(async () => {
    if (!BINARY) return;
    dbDir = mkdtempSync(path.join(tmpdir(), 'krig-bgrunner-'));
    proc = spawn(BINARY, ['start', '--bind', `127.0.0.1:${PORT}`, '--username', 'root', '--password', 'v', '--log', 'warn', `rocksdb://${dbDir}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    await waitReady();
    db = new Surreal();
    await db.connect(`ws://127.0.0.1:${PORT}/rpc`);
    await db.signin({ username: 'root', password: 'v' });
    await db.use({ namespace: 'krig', database: 'bgrunner' });
    await x_migration_1_2_24(db); // x_setting(节奏设置读它,没有则用默认)
    await x_migration_1_2_26(db);
    /** 1.2.34(2026-10-19)加了名单任务的字段 —— createJob / saveJob 会写它们,结构固定的表没定义就拒收 */
    await x_migration_1_2_34(db); // x_bg_job
    __setXDBForTest(db);
  }, 40000);

  afterAll(async () => {
    __setXDBForTest(null);
    _resetBgRunner();
    await db?.close();
    proc?.kill();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    _resetBgRunner();
    // 清掉上个用例的任务与 host 状态
    await db?.query('DELETE x_bg_job');
    for (const ws of ['ws-1', 'ws-2', 'ws-3']) clearXHostState(ws);
  });

  /** 记录「哪些 job 被 drive 跑了」的假 drive */
  function recordingDrive(): { drive: (ws: string, wc: number, job: BgJob) => Promise<void>; ran: string[] } {
    const ran: string[] = [];
    return { ran, drive: async (_ws, _wc, job) => { ran.push(job.id); } };
  }

  it('⭐ 开了 X 网页 + 有到期任务 → 跑它', async () => {
    const { id } = await createJob({ restId: '1', handle: 'a', wsId: 'ws-1', range: 'all' });
    setXHostState('ws-1', 101, 'https://x.com/a');
    const { drive, ran } = recordingDrive();
    await tickOnce(drive, new Date());
    expect(ran).toContain(id);
  });

  it('⭐⭐ 没开 X 网页 → 跳过(没法采)', async () => {
    await createJob({ restId: '2', handle: 'b', wsId: 'ws-1', range: 'all' });
    // 不 setXHostState
    const { drive, ran } = recordingDrive();
    await tickOnce(drive, new Date());
    expect(ran, '没开 X 网页还去采').toEqual([]);
  });

  it('⭐⭐ 你在手动操作该 ws(busy)→ 让路,不跑', async () => {
    await createJob({ restId: '3', handle: 'c', wsId: 'ws-1', range: 'all' });
    setXHostState('ws-1', 102, 'https://x.com/c');
    setXHostBusy(102, '正在核对');
    try {
      const { drive, ran } = recordingDrive();
      await tickOnce(drive, new Date());
      expect(ran, 'ws 忙还去采 —— 没让路').toEqual([]);
    } finally {
      setXHostBusy(102, null);
    }
  });

  it('⭐⭐⭐ 两个 ws 各一个任务 → 都跑(跨 ws 并行)', async () => {
    const a = await createJob({ restId: '4', handle: 'd', wsId: 'ws-1', range: 'all' });
    const b = await createJob({ restId: '5', handle: 'e', wsId: 'ws-2', range: 'all' });
    setXHostState('ws-1', 201, 'https://x.com/d');
    setXHostState('ws-2', 202, 'https://x.com/e');
    const { drive, ran } = recordingDrive();
    await tickOnce(drive, new Date());
    expect(ran.sort()).toEqual([a.id, b.id].sort());
  });

  it('⭐⭐ 同一 ws 两个任务 → 一轮只跑一个(同 ws 串行)', async () => {
    await createJob({ restId: '6', handle: 'f', wsId: 'ws-1', range: 'all' });
    await createJob({ restId: '7', handle: 'g', wsId: 'ws-1', range: 'year' });
    setXHostState('ws-1', 301, 'https://x.com/f');
    const { drive, ran } = recordingDrive();
    await tickOnce(drive, new Date());
    expect(ran.length, '同 ws 一轮跑了多个 —— 并行采同一号是强风控信号').toBe(1);
  });

  it('⭐⭐ 任务暂停 → 不跑', async () => {
    const { id } = await createJob({ restId: '8', handle: 'h', wsId: 'ws-1', range: 'all' });
    const j = (await readJob(id))!;
    await saveJob({ ...j, status: 'paused' });
    setXHostState('ws-1', 401, 'https://x.com/h');
    const { drive, ran } = recordingDrive();
    await tickOnce(drive, new Date());
    expect(ran, '暂停的任务还在跑').toEqual([]);
  });

  it('⭐⭐ 距上段没够间隔 → 不跑(节奏)', async () => {
    const { id } = await createJob({ restId: '9', handle: 'i', wsId: 'ws-1', range: 'all' });
    const j = (await readJob(id))!;
    // 刚跑过一段(lastSegmentAt = 现在),默认间隔 120s 没到
    await saveJob({ ...j, status: 'running', lastSegmentAt: new Date().toISOString() });
    setXHostState('ws-1', 501, 'https://x.com/i');
    const { drive, ran } = recordingDrive();
    await tickOnce(drive, new Date());
    expect(ran, '间隔没到还在跑').toEqual([]);

    // 过了足够久 → 跑
    const later = new Date(Date.now() + 200_000);
    const { drive: d2, ran: r2 } = recordingDrive();
    await tickOnce(d2, later);
    expect(r2, '间隔到了却不跑').toContain(id);
  });
});
