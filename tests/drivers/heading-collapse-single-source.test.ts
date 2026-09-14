/**
 * 折叠单一真源守卫
 *
 * ⚠️⚠️ 真机踩过的 bug:把**三角**的读写换成外部来源(G 层)后,
 * 三角切了、画布也收了,但 **note 的文字没藏** ——
 * 因为「藏内容」靠的是 heading-collapse plugin **自己的 Set**,
 * 它根本不知道外部发生了什么。⭐ 两个 plugin 各读各的 = split brain。
 *
 * 本文件钉住:**三角读哪儿,藏内容就得读哪儿**。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf-8');

describe('折叠必须单一真源', () => {
  it('⭐⭐ 两个 plugin 都能接外部来源(不许只接一个)', () => {
    const toggle = read('src/drivers/text-editing-driver/plugins/build-heading-toggle-plugin.ts');
    const collapse = read('src/drivers/text-editing-driver/plugins/build-heading-collapse-plugin.ts');
    // 画三角的:CollapseSource
    expect(toggle).toContain('CollapseSource');
    // ⭐ 藏内容的:CollapsedSetSource —— 缺它就是 split brain
    expect(
      collapse.includes('CollapsedSetSource'),
      '藏内容的 plugin 必须也能接外部来源,否则三角切了内容不藏',
    ).toBe(true);
  });

  it('⭐ builder 把同一个 source 同时喂给两个 plugin', () => {
    const b = read('src/drivers/text-editing-driver/editor-view-builder.ts');
    // 两处都要用到 headingCollapseSource
    const uses = b.split('headingCollapseSource').length - 1;
    expect(uses, 'source 必须同时喂给 collapse(藏内容)与 toggle(画三角)').toBeGreaterThanOrEqual(3);
  });

  it('⭐ 外部来源模式下每次都重问(画布折叠时 doc 没变)', () => {
    const collapse = read('src/drivers/text-editing-driver/plugins/build-heading-collapse-plugin.ts');
    // ⚠️ 只在 docChanged 时问会漏:画布折叠不改 doc
    expect(collapse).toContain('collapsedPositions(newState.doc)');
  });

  it('⭐ 有强制重算入口(画布侧改了折叠要能推 note 重算)', () => {
    const collapse = read('src/drivers/text-editing-driver/plugins/build-heading-collapse-plugin.ts');
    const api = read('src/drivers/text-editing-driver/api.ts');
    expect(collapse).toContain('export function refreshHeadingCollapse');
    expect(api).toContain('refreshHeadingCollapseFor');
  });

  it('⚠️ 不传 source 时保持 note 本体行为(内建 Set 分支还在)', () => {
    const collapse = read('src/drivers/text-editing-driver/plugins/build-heading-collapse-plugin.ts');
    // 内建路径:meta 覆写 + rebase
    expect(collapse).toContain('rebaseCollapsed');
    expect(collapse).toContain('getMeta(headingCollapseKey)');
  });
});
