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

  it('⭐ 三件事各一个 tab(用户 10-22「上面一排 tab,里面再一排」);2 接求关,3 接互动', () => {
    const B = strip(read('src/modules/x/XTaskBlueMutual.tsx'));
    for (const t of ['找我还没关注的蓝V', '对有互关倾向的,互动求关', '已互关的蓝V,看互动情况']) expect(B).toContain(t);
    expect(B).toMatch(/<XTabs active=\{tab\}/);
    const s2 = B.slice(B.indexOf("id: 'ask'"), B.indexOf("id: 'engage'"));
    expect(s2.length).toBeGreaterThan(0);
    expect(s2).toMatch(/<FollowStep wsId=\{wsId\}/);
    const s3 = B.slice(B.indexOf("id: 'engage'"), B.indexOf('function Step'));
    expect(s3).toMatch(/<EngageStep wsId=\{wsId\}/);
    expect(s3).not.toMatch(/<button/);
  });

  it('⭐ 点名字 = 跳他主页 + 核对关系写回库 + 刷新名单(用户 10-23:「点开后要及时更新,否则就会列表错误」);收起不跳;忙就不跳', () => {
    const order = (fn: string, steps: string[]): void => {
      expect(fn.length).toBeGreaterThan(200);
      const at = steps.map((x) => { const i = fn.indexOf(x); expect(i, x).toBeGreaterThan(-1); return i; });
      expect(at).toEqual([...at].sort((a, b) => a - b));
    };
    const F = strip(read('src/modules/x/XTaskFollow.tsx'));
    order(F.slice(F.indexOf('const openAsked'), F.indexOf('const toggle')),
      ['if (!opening) return;', 'await xPageBusy(wcId)', 'await readProfileAndRefresh({ rest_id: x.person, handle: x.handle }, wcId)', 'loadFs();', 'setLineRev(']);
    expect(F).toMatch(/onClick=\{\(\) => void openAsked\(x\)\}/);
    expect(F).toMatch(/<XPersonTimeline wsId=\{wsId\} restId=\{x.person\} rev=\{lineRev\} \/>/);
    const E = strip(read('src/modules/x/XTaskEngage.tsx'));
    order(E.slice(E.indexOf('const openPerson'), E.indexOf('const toggle')),
      ['await xPageBusy(wcId)', 'await readProfileAndRefresh({ rest_id: p.restId, handle: p.handle }, wcId)', 'load();']);
    expect(E).toMatch(/onClick=\{\(\) => void openPerson\(p\)\}/);
  });

  it('⭐⭐ 平台判「放弃」不是最后仲裁:点开他的帖子 = 拉回来(用户 10-23)—— 先撤销排除成功,才换成用这条', () => {
    const A = strip(read('src/modules/x/XTaskAsk.tsx'));
    expect(A).toMatch(/\(prep\.plan\.kind === 'skip' && prep\.plan\.alreadyRelated\)/);
    const fn = A.slice(A.indexOf('const overrule'), A.indexOf('const followLeft'));
    expect(fn.length).toBeGreaterThan(200);
    const i1 = fn.indexOf("op: 'setExcluded', restId: who.restId, excluded: false");
    const i2 = fn.indexOf("if (r.status === 'failed')");
    const i3 = fn.indexOf("setPrep({ ...prep, plan: { kind: 'other', tweet");
    expect(i1).toBeGreaterThan(-1);
    expect(i1 < i2 && i2 < i3).toBe(true);
    const fl = A.slice(A.indexOf('const followLeft'), A.indexOf('const cycle'));
    expect((fl.match(/await overrule\(/g) ?? []).length).toBe(2);
  });

  it('⭐⭐ 2 求关(10-17 改):勾选 → 逐个人出求关卡;不再「勾了就直接关注」', () => {
    const F = strip(read('src/modules/x/XTaskFollow.tsx'));
    /** 用户 10-17:「莫名其妙关注,不求互关…最终只是你关注对方,对方不回关你!」 */
    expect(F).not.toMatch(/op: 'followQueueAdd'/);
    const start = F.slice(F.indexOf('const startAsk'), F.indexOf('const control'));
    expect(start).toMatch(/setAsking\(list\)/);
    expect(F).toMatch(/<AskRun wsId=\{wsId\} queue=\{asking\}/);
    expect(F).toMatch(/op: 'followQueueControl', wsId, action/);
    expect(F).toMatch(/op: 'blueMutualCandidates'/);
    expect(F).toMatch(/op: 'blueMutualFollowProgress'/);
    const A = strip(read('src/modules/x/XTaskAsk.tsx'));
    expect(A).toMatch(/op: 'askPrepare', wsId, restId: who\.restId, handle: who\.handle/);
  });

  it('⭐ 求关成了自动到下一个人(用户 10-17);没成才停在这张卡', () => {
    const A = strip(read('src/modules/x/XTaskAsk.tsx'));
    const act = A.slice(A.indexOf('const act = async'), A.indexOf('const cycle'));
    expect(act.length).toBeGreaterThan(100);
    expect(act).toMatch(/if \(v\.ok\) \{ next\(/);
    expect(act.indexOf('if (v.ok)')).toBeLessThan(act.indexOf('setResult(v)'));
  });

  it('⭐⭐ 放弃才排除 —— 只在「采到了、账对上、确实没求关」时;没采到不算到他头上', () => {
    const P = strip(read('src/modules/x/x-ask-prepare.ts'));
    const body = P.slice(P.indexOf('export async function prepareAsk'));
    const at = body.indexOf('EXCLUDE_RULE_SQL');
    expect(at).toBeGreaterThan(0);
    const cond = body.slice(body.lastIndexOf('if (', at), at);
    expect(cond).toMatch(/plan\.kind === 'skip'/);
    expect(cond).toMatch(/plan\.recent\.length > 0/);
    expect(cond).toMatch(/r\.ledgerProblem === undefined/);
    /** 人 > AI > 算法:人 / AI 排除过的不改 */
    expect(P).toMatch(/WHERE excluded_source = NONE OR excluded_source = 'rule'/);
  });

  it('⭐ 1 找人:走已验证的滚动截获,跑完扫一遍互关倾向再刷新(否则候选恒 0)', () => {
    const B = strip(read('src/modules/x/XTaskBlueMutual.tsx'));
    const f = B.slice(B.indexOf('const findOnce'), B.indexOf('const t = last?.totals'));
    expect(f).toMatch(/op: 'searchScroll'/);
    expect(f.indexOf("op: 'scanMutualIntent'")).toBeGreaterThan(f.indexOf("op: 'searchScroll'"));
    expect(f.indexOf('load();')).toBeGreaterThan(f.indexOf("op: 'scanMutualIntent'"));
  });
});

describe('候选名单:点 = 跳主页,勾 = 选定(10-16 用户:「注意时点击,而不是勾选,勾选是选定」)', () => {
  it('行不是 label(否则点哪都勾);勾选框只 toggle;名字区域 onClick 跳主页', () => {
    const F = strip(read('src/modules/x/XTaskFollow.tsx'));
    const list = F.slice(F.indexOf('(cands ?? []).map((c) => ('), F.indexOf('最近关注'));
    expect(list.length).toBeGreaterThan(200);
    expect(list).not.toMatch(/<label/);
    expect(list).toMatch(/<input type="checkbox"[^>]*onChange=\{\(\) => toggle\(c\.rest_id\)\}/);
    expect(list).toMatch(/onClick=\{\(\) => void openInX\(c\)\}/);
  });
  it('⭐ 正在关注某人 / 网页忙 → 不跳(跳走会打断关注)', () => {
    const F = strip(read('src/modules/x/XTaskFollow.tsx'));
    const fn = F.slice(F.indexOf('const openInX'), F.indexOf('const toggle'));
    const guard = fn.indexOf('if (qs?.current)');
    const busy = fn.indexOf('await xPageBusy(wcId)');
    /** 2026-10-21 起跳转改为「去主页并读关系」(readProfileAndRefresh),读到已关注就从候选里拿掉 */
    const go = fn.indexOf('await readProfileAndRefresh(');
    expect(guard).toBeGreaterThan(-1);
    expect(go).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(go);
    expect(busy).toBeLessThan(go);
    expect(fn).toMatch(/if \(v\.rec\.following === true\) \{\s*setCands\(/);
  });
  it('认号:X 网页后登记好会再认一次', () => {
    const A = strip(read('src/modules/x/XAccountBadge.tsx'));
    expect(A).toMatch(/if \(wcId !== null && note !== null && note\.includes\('网页没开'\) && !busy\) void identify\(\);/);
  });
});
