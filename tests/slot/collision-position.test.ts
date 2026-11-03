/**
 * 浮层碰撞翻转 —— slash 菜单上翻不许盖住 `/` 那一行(用户 2026-11-03 报:弹出挡住了「/」,输入也看不见)
 *
 * 根因:slash 锚点 y = `/` 行底边 +4;上翻用 `y - 菜单高` → 菜单底边落在该行底边,整行被盖。
 * 修法:上翻时菜单底边贴 flipAnchorY(= 该行顶边 −4)。
 *
 * ⚠️ 注入验红:把 computeCollisionPosition 里 `flipAnchorY - size.height` 改回 `anchorY - size.height`
 *    → 第一条变红。
 */
import { describe, it, expect } from 'vitest';
import { computeCollisionPosition } from '@slot/frame-bindings/use-collision-position';

const viewport = { width: 1600, height: 1000 };
const menu = { width: 300, height: 360 };

describe('computeCollisionPosition', () => {
  it('⭐ 下方放不下往上翻:菜单底边在 `/` 行顶边之上,不盖住这一行', () => {
    const lineTop = 900;
    const lineBottom = 920;
    const { y } = computeCollisionPosition(menu, viewport, 100, lineBottom + 4, 8, lineTop - 4);
    expect(y + menu.height).toBeLessThanOrEqual(lineTop);
  });

  it('下方放得下:照旧贴在行下方', () => {
    const { y } = computeCollisionPosition(menu, viewport, 100, 304, 8, 280);
    expect(y).toBe(304);
  });

  it('不传 flipAnchorY 的调用方(右键菜单等,锚点就是鼠标点)行为不变', () => {
    const { y } = computeCollisionPosition(menu, viewport, 100, 900, 8, 900);
    expect(y).toBe(900 - menu.height);
  });
});
