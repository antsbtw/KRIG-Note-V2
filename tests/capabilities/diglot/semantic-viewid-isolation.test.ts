/**
 * 语义面 viewId 隔离守卫
 *
 * ⚠️⚠️ 守的是一条**两边需求相反**的边界:
 *
 * | | 画布文字节点 | note tab(语义面) |
 * |---|---|---|
 * | viewId | `graph-canvas-view` | ⭐ `mind-semantic` |
 * | 渲染方式 | atomsToSvg → mesh | 普通 DOM |
 * | slash 需不需要闸 | ⭐ **要**(能插 ⊆ 能渲,否则功能黑洞) | 不要 |
 * | handle 菜单 | 不注册 | ⭐ 全套 |
 *
 * ⭐ 共用 viewId 就只能二选一:放开 → 画布出功能黑洞;不放开 → 语义面残废。
 * 故必须**分开**。本文件把这条边界钉住,防止将来有人图省事合回去。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf-8');

describe('语义面 viewId 与画布节点隔离', () => {
  it('⭐ 语义面用独立 viewId,不是 graph-canvas-view', () => {
    const menus = read('src/views/graph-canvas-view/mind-semantic-menus.ts');
    expect(menus).toContain("MIND_SEMANTIC_VIEW_ID = 'mind-semantic'");
    // ⚠️ 不许退回共用
    expect(
      /MIND_SEMANTIC_VIEW_ID\s*=\s*'graph-canvas-view'/.test(menus),
      '语义面若用回 graph-canvas-view,会与画布节点的渲染态闸冲突',
    ).toBe(false);
  });

  it('⭐ Host config 传的正是那个独立 viewId', () => {
    const pane = read('src/views/graph-canvas-view/MindSemanticPane.tsx');
    expect(pane).toContain('viewId: MIND_SEMANTIC_VIEW_ID');
    // ⚠️ 硬编码 'graph-canvas-view' 会让菜单查不到自己注册的项
    expect(
      /viewId:\s*'graph-canvas-view'/.test(pane),
      'config.viewId 必须与注册时的 viewId 一致,否则菜单恒为空',
    ).toBe(false);
  });

  it('⭐⭐ 画布节点那套注册**保持不动**(渲染态闸还在)', () => {
    const idx = read('src/views/graph-canvas-view/index.ts');
    // 画布仍走 filterSlashItemsToRenderable —— 这是「能插 ⊆ 能渲」的守卫
    expect(idx).toContain('filterSlashItemsToRenderable');
    expect(
      idx.includes('createMermaidBlockItem') || idx.includes('createHtmlBlockItem'),
      '画布节点不该注册渲染态不支持的块(会出功能黑洞)',
    ).toBe(false);
  });

  it('⭐ 语义面注册了画布缺的 handle 菜单(之前点手柄是空的)', () => {
    const menus = read('src/views/graph-canvas-view/mind-semantic-menus.ts');
    for (const factory of [
      'createTurnIntoContainer',
      'createColorContainer',
      'createFormatContainer',
      'createHeadingCollapseItem',
      'createBlockActions',
    ]) {
      expect(menus, `handle 菜单缺 ${factory}`).toContain(factory);
    }
  });

  it('⚠️ 注册是幂等的(多张导图共用一套,重复注册会堆重复项)', () => {
    const menus = read('src/views/graph-canvas-view/mind-semantic-menus.ts');
    expect(menus).toContain('if (registered) return;');
  });
});
