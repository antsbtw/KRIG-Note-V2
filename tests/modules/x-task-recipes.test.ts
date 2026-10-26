/**
 * ⭐⭐ 任务 → 搜索配方(2026-10-26 从操作台搬来;原守卫在 x-console-symmetry 配方栏那一组,操作台拆了随它挪过来)
 *
 * 用户 10-04:「配方的配置功能也要增加上来哦。」→ 增删改都要有、每条显示实际会搜什么、翻译不出来的点不了;
 * 用户 10-03:「我自己选定一个页面,点击开始采集,就采集」→ 配方只把页面打开,不替人采。
 * 用户 10-26:「「运营」--这个等于dashboard,「任务」--才是真正的执行者。」→ 配方在任务页。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const R = strip(read('src/modules/x/XTaskRecipes.tsx'));
const list = R.slice(R.indexOf('export function RecipesTask'), R.indexOf('function blankRecipe'));

describe('任务 → 搜索配方', () => {
  it('扫描本身没坏', () => {
    expect(list.length).toBeGreaterThan(1000);
  });
  it('⭐ 在任务页的任务清单里(不在运营页)', () => {
    const T = strip(read('src/modules/x/XTaskView.tsx'));
    expect(T).toMatch(/\{ id: 'recipes', label: '搜索配方' \}/);
    expect(T).toMatch(/task === 'recipes' && <RecipesTask wsId=\{workspaceId\} \/>/);
    expect(strip(read('src/modules/x/XOpsView.tsx'))).not.toMatch(/RecipesTask/);
  });
  it('⭐⭐ 增删改三样都要有 —— 只能看不能改不算「配置功能」', () => {
    for (const [op, what] of [["op: 'list'", '读'], ["op: 'upsert', recipe", '存'], ["op: 'delete', recipeId", '删']] as const) {
      expect(list, `少了「${what}」`).toContain(op);
    }
    expect(list).toMatch(/<RecipeEditor value=\{editing\}/);
  });
  it('⭐⭐⭐ 每条配方都显示实际会搜什么(配方填的词与发出去的串不是一回事)', () => {
    expect(list).toContain('recipeToQuery(r)');
    expect(list).toContain('q.q');
    expect(list).toContain('q.explain');
  });
  it('⚠️⚠️ 翻译不出来的配方点不了 —— 不许点了才失败', () => {
    expect(list).toMatch(/disabled=\{q\.problems\.length > 0\}/);
  });
  it('⚠️ 「按它搜索」只让左边打开那个搜索(能力 x.page.open),不自己采集、不直接驱动网页', () => {
    expect(list).toMatch(/openInLeft\(wsId, \{ q: q\.q, f: q\.resultType \}\)/);
    expect(R).not.toMatch(/harvest|webDomInvoke|searchScroll/);
  });
});
