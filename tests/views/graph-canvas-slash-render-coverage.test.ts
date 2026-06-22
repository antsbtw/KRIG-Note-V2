/**
 * L5 编辑↔渲染一致性专项 E1 — 不变量单测:graph 编辑态可插块 ⊆ 渲染态可渲块
 *
 * 守「功能黑洞」闸(prompt §1):graph 画板节点 slash/turn-into 能插的块,渲染态
 * (atomsToSvg dispatch)必须能渲;否则用户插了渲不出的块 → Esc 退出编辑后渲成灰字
 * 占位 / 丢内容。
 *
 * 三条断言:
 *  1. filterSlashItemsToRenderable 过滤后,canvas slash 每个 turn-into item 的目标块
 *     ∈ RENDERABLE_ATOM_TYPES(核心不变量)。
 *  2. gate 映射表覆盖 createTurnIntoItems 产出的全部 turn-into 命令(防新增 turn-into
 *     命令未登记 → isSlashItemRenderable 走"非 turn-into 放行"分支静默漏过黑洞)。
 *  3. 过滤确实剔掉了渲染态当前不支持的块(divider/task/toggle),防过滤失效空转。
 */
import { describe, it, expect } from 'vitest';
import { RENDERABLE_ATOM_TYPES } from '../../src/lib/atom-serializers/svg';
import { createTurnIntoItems, createMathBlockItem } from '../../src/capabilities/text-editing/ui/slash-menu/items';
import {
  filterSlashItemsToRenderable,
  isSlashItemRenderable,
  SLASH_TURN_COMMAND_TO_ATOM_TYPE,
} from '../../src/views/graph-canvas-view/slash-render-gate';

const VIEW = 'graph-canvas-view';

describe('E1 不变量 — graph 可插块 ⊆ 渲染态可渲块', () => {
  it('过滤后每个 turn-into item 的目标块 ∈ RENDERABLE_ATOM_TYPES', () => {
    const registered = filterSlashItemsToRenderable([
      ...createTurnIntoItems(VIEW),
      createMathBlockItem(VIEW),
    ]);
    expect(registered.length).toBeGreaterThan(0);
    for (const item of registered) {
      const atomType = SLASH_TURN_COMMAND_TO_ATOM_TYPE[item.command];
      // turn-into item:目标块必须可渲;非 turn-into(math-block)走放行分支,不在此查
      if (atomType !== undefined) {
        expect(
          RENDERABLE_ATOM_TYPES.has(atomType),
          `slash item "${item.label}"(${item.command})→${atomType} 渲染态不支持却放进 canvas slash`,
        ).toBe(true);
      }
    }
  });

  it('gate 映射表覆盖 createTurnIntoItems 全部 turn-into 命令(防新命令未登记静默漏过)', () => {
    const turnIntoCommands = createTurnIntoItems(VIEW).map((i) => i.command);
    for (const cmd of turnIntoCommands) {
      expect(
        Object.prototype.hasOwnProperty.call(SLASH_TURN_COMMAND_TO_ATOM_TYPE, cmd),
        `turn-into 命令 ${cmd} 未在 slash-render-gate 映射表登记 → 会被当非 turn-into 放行,可能漏黑洞`,
      ).toBe(true);
    }
  });

  it('E4 后:divider/task/toggle 渲染态已补 → slash 闸放开(不再剔)', () => {
    const all = createTurnIntoItems(VIEW);
    const filtered = filterSlashItemsToRenderable(all);
    // E4 补了 horizontalRule/taskList/toggleList 渲染器 + RENDERABLE_ATOM_TYPES 追加
    // → 闸自动放开,这三项现在保留(对齐「编辑⊆渲染」:渲染能渲了就放）。
    expect(filtered.some((i) => i.command === 'text-editing.slash-turn-divider')).toBe(true);
    expect(filtered.some((i) => i.command === 'text-editing.slash-turn-task')).toBe(true);
    expect(filtered.some((i) => i.command === 'text-editing.slash-turn-toggle')).toBe(true);
    // 当前 createTurnIntoItems 全部 12 项渲染态都支持 → 一个不剔(全覆盖)。
    // 此断言锁定「闸不空转误剔可渲块」;将来若加渲染态不支持的 turn-into,本测会提醒更新。
    expect(filtered.length).toBe(all.length);
  });

  it('isSlashItemRenderable:非 turn-into item(math-block)放行', () => {
    expect(isSlashItemRenderable(createMathBlockItem(VIEW))).toBe(true);
  });
});
