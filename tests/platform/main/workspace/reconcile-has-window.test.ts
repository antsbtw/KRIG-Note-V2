/**
 * hasWindow 退出前对账 —— 启动重复开窗 bug 的回归钉。
 *
 * bug:hasWindow 只在 createWindow 置 true,置回 false 那条路被 `!appIsQuitting` 守卫
 * 挡住 → 用 New Window 开过第二个 ws 后直接 Cmd+Q,该 ws 的 hasWindow 永久停在 true
 * → 下次启动 index.ts 按 hasWindow 过滤又开一窗 → 又置 true → 自我永续。
 *
 * 本测试钉住 reconcileHasWindow 的契约:退出瞬间「存活的 true / 其余一律 false」。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// electron:workspace-manager-main 模块级 import BrowserWindow / session
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  session: { fromPartition: () => ({ setProxy: async () => {}, setUserAgent: () => {} }) },
}));

// 代理节点 store(applyWsConfigToSession 用,本测试不触发)
vi.mock('@platform/main/web-proxy/proxy-node-store', () => ({
  proxyNodeStore: { resolveRules: async () => 'direct://' },
}));

/** 写库 mock:记录每次 UPSERT 的 workspaces 快照 */
const persisted: Array<Array<{ id: string; hasWindow?: boolean }>> = [];
let failNextWrite = false;

// 只覆盖 getDB,其余导出保留真实实现 —— 整模块替换会在同 worker 里泄漏给其他用到
// 本模块真实导出的测试文件(bulk-delete-perf-verify 自 spawn 真 sidecar 即经此模块)。
vi.mock('@storage/surreal/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@storage/surreal/client')>()),
  getDB: () => ({
    query: async (_sql: string, vars: { workspaces: Array<{ id: string; hasWindow?: boolean }> }) => {
      if (failNextWrite) throw new Error('db down');
      persisted.push(vars.workspaces.map((w) => ({ id: w.id, hasWindow: w.hasWindow })));
      return [];
    },
  }),
}));

import {
  reconcileHasWindow,
  getFullState,
  wsCreate,
  wsRemove,
} from '@platform/main/workspace/workspace-manager-main';

/** 每 test 起点:清空模块内 workspaces(经公共 API,模块状态是单例) */
function resetWorkspaces(): void {
  for (const ws of getFullState().workspaces) wsRemove(ws.id);
}

/** 建 n 个 ws 并返回 id;wsCreate 会因 activateAnotherOpen 兜底多建,故显式取用 */
function seedWorkspaces(n: number): string[] {
  return Array.from({ length: n }, () => wsCreate().id);
}

function hasWindowOf(id: string): boolean | undefined {
  return getFullState().workspaces.find((w) => w.id === id)?.hasWindow;
}

describe('reconcileHasWindow —— 退出前按真实存活窗口对账', () => {
  beforeEach(() => {
    persisted.length = 0;
    failNextWrite = false;
    resetWorkspaces();
  });

  it('存活的置 true,未存活的置 false', async () => {
    const [a, b, c] = seedWorkspaces(3);

    await reconcileHasWindow([a, c]);

    expect(hasWindowOf(a)).toBe(true);
    expect(hasWindowOf(b)).toBe(false);
    expect(hasWindowOf(c)).toBe(true);
  });

  it('清除粘滞的 hasWindow —— 正是重复开窗 bug 的自愈路径', async () => {
    const [a, b] = seedWorkspaces(2);
    // 模拟脏状态:两个 ws 都停在 hasWindow=true(上次直接 Cmd+Q 留下的)
    await reconcileHasWindow([a, b]);
    expect(hasWindowOf(b)).toBe(true);

    // 这次退出时只有 a 还开着窗
    await reconcileHasWindow([a]);

    expect(hasWindowOf(a)).toBe(true);
    expect(hasWindowOf(b)).toBe(false);

    // 启动侧据此只会开 1 个窗口
    const wouldOpen = getFullState().workspaces.filter((w) => w.hasWindow);
    expect(wouldOpen.map((w) => w.id)).toEqual([a]);
  });

  it('一个窗口都不存活时全部置 false', async () => {
    const ids = seedWorkspaces(2);
    await reconcileHasWindow(ids);

    await reconcileHasWindow([]);

    expect(getFullState().workspaces.every((w) => w.hasWindow === false)).toBe(true);
  });

  it('只写一次库(退出路径紧接关库,N 次异步写未必落完)', async () => {
    seedWorkspaces(3);
    persisted.length = 0;

    await reconcileHasWindow([]);

    expect(persisted).toHaveLength(1);
  });

  it('落盘的是对账后的值,不是对账前的快照', async () => {
    const [a, b] = seedWorkspaces(2);
    persisted.length = 0;

    await reconcileHasWindow([a]);

    expect(persisted).toHaveLength(1);
    const snapshot = persisted[0];
    expect(snapshot.find((w) => w.id === a)?.hasWindow).toBe(true);
    expect(snapshot.find((w) => w.id === b)?.hasWindow).toBe(false);
  });

  it('写库失败必须抛出 —— 吞掉会让调用方误以为对好了(本 bug 的失效模式)', async () => {
    seedWorkspaces(2);
    failNextWrite = true;

    await expect(reconcileHasWindow([])).rejects.toThrow('db down');
  });
});
