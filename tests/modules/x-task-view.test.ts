/**
 * ⭐⭐ 任务(2026-10-16)—— 与运营同级;第一个任务「蓝V互关」按设计文档的三件事展示
 * 用户:「是否增加一个和运营同级的task(任务),这个任务就是蓝V互关」「围绕需要做的事情来展现或构建就好了」
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('任务 view', () => {
  it('注册:navSide「任务」order 6.6(紧挨运营);X 网页顶条按钮开的是同一个 id', () => {
    const R = read('src/modules/x/renderer.ts');
    expect(R).toMatch(/export const X_TASK_VIEW_ID = 'x-task-view';/);
    expect(R).toMatch(/id: X_TASK_VIEW_ID,[\s\S]{0,80}component: XTaskView,[\s\S]{0,60}label: '任务'/);
    const W = strip(read('src/modules/x/XWebView.tsx'));
    expect(W).toContain("const X_TASK_VIEW_ID = 'x-task-view';");
    expect(W).toMatch(/bus\.slot\.openRight\(X_TASK_VIEW_ID\)/);
  });

  it('✕ 由框架给的 slot 决定(不反推自己在哪栏)', () => {
    const V = strip(read('src/modules/x/XTaskView.tsx'));
    const close = V.slice(V.indexOf('const handleClose'), V.indexOf('}, [workspaceId, slot]);'));
    expect(close).toMatch(/if \(slot === 'right'\) bus\.slot\.closeRight\(\);\s*else bus\.slot\.closeLeft\(\);/);
    expect(V).not.toMatch(/slotBinding/);
  });

  it('⭐ 三件事都在;2 已接关注队列;还没做的 3 不放假按钮', () => {
    const B = strip(read('src/modules/x/XTaskBlueMutual.tsx'));
    for (const t of ['找我还没关注的蓝V', '对有互关倾向的,互动求关', '已互关的蓝V,看互动情况']) expect(B).toContain(t);
    const s2 = B.slice(B.indexOf('<Step n={2}'), B.indexOf('<Step n={3}'));
    expect(s2).toMatch(/<FollowStep wsId=\{wsId\}/);
    const s3 = B.slice(B.indexOf('<Step n={3}'), B.indexOf('function Step'));
    expect(s3).not.toMatch(/<button/);
  });

  it('⭐⭐ 2 求关:勾选 → 进关注队列(主进程按节奏关);队列可暂停 / 继续 / 清空', () => {
    const F = strip(read('src/modules/x/XTaskFollow.tsx'));
    expect(F).toMatch(/op: 'followQueueAdd', wsId, items/);
    expect(F).toMatch(/op: 'followQueueControl', wsId, action/);
    expect(F).toMatch(/op: 'blueMutualCandidates'/);
    expect(F).toMatch(/op: 'blueMutualFollowProgress'/);
  });

  it('⭐ 1 找人:走已验证的滚动截获,跑完扫一遍互关倾向再刷新(否则候选恒 0)', () => {
    const B = strip(read('src/modules/x/XTaskBlueMutual.tsx'));
    const f = B.slice(B.indexOf('const findOnce'), B.indexOf('const t = last?.totals'));
    expect(f).toMatch(/op: 'searchScroll'/);
    expect(f.indexOf("op: 'scanMutualIntent'")).toBeGreaterThan(f.indexOf("op: 'searchScroll'"));
    expect(f.indexOf('load();')).toBeGreaterThan(f.indexOf("op: 'scanMutualIntent'"));
  });
});
