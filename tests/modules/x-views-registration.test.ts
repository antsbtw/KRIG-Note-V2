/**
 * ⭐⭐ X 的**两个独立 view** —— 行为测试(不是源码扫描)
 *
 * ── 用户 2026-10-01 定的形态 ──
 *
 * 「x 的访问页面在左边;x 模块的操作作为一个单独的 view 在 right slot,
 * 　随时可以关闭。**也就是说,两个都是独立的 view**。」
 *
 * | view | 位置 | 入口 | 为什么 |
 * |---|---|---|---|
 * | `x-web-view` | 左栏 | navSide tab 𝕏 | 人在用的,要全宽、长期开 |
 * | `x-workbench-view` | 右栏 | SlotPicker | 工具,用完就关,不该占死一栏 |
 *
 * ⭐ 两个独立 ⇒ 可以**只开一个**。
 *
 * ⚠️ 用**行为测试**而非源码扫描:`toMatch(/registerView/)` 遇上
 * `void 0 && registerView(...)` 会全绿(文本在、行为没了)——
 * 见 `feedback-source-scan-cant-see-execution`。
 * 这里真的 import 模块、真的查注册表。
 */
import { describe, it, expect } from 'vitest';
import { viewTypeRegistry } from '@slot/view-type-registry/view-type-registry';
// ⭐ 真的触发自注册 —— 这一行本身就是在验「副作用 import 生效」
import '@modules/x/renderer';

const all = () => viewTypeRegistry.getAll();
const byId = (id: string) => all().find((v) => v.id === id);

describe('⭐⭐ X 的两个 view 各自独立', () => {
  it('前提自检:X 的两个 view 真的注册上了(否则整段空转)', () => {
    /**
     * ⚠️ 这条第一版写 `> 2` —— 以为注册表里会有全仓的 view。
     * 实际单测环境**只 import 了 X**,别的 view 没进来,于是恒红。
     * ⭐ 改成钉本模块自己的两个:≥ 2 且都能按 id 找到。
     */
    expect(all().length, 'X 的 view 一个都没注册 —— 守卫在空转').toBeGreaterThanOrEqual(2);
    expect(byId('x-web-view'), 'x-web-view 不在注册表').toBeDefined();
    expect(byId('x-workbench-view'), 'x-workbench-view 不在注册表').toBeDefined();
  });

  it('⭐ 左栏「网页」:上 navSide 切换条', () => {
    const v = byId('x-web-view');
    expect(v, 'x-web-view 没注册 —— navSide 上不会出现 𝕏').toBeDefined();
    expect(v!.navSideTab?.label).toBe('X');
    expect(v!.navSideTab?.order, 'order 变了 —— 会与别的 tab 争位置').toBe(6);
    /**
     * ⚠️ webview 类 view 要全宽:切过来收起 navSide,
     * 且禁止点已激活 tab 展开空面板(与 AI / Mail 同款)。
     * ⭐ 接 webview 前就按终态写,免得将来忘 —— 这条钉住它别被改掉。
     */
    expect(v!.navSideTab?.navSideOnSwitch, '切过来没收起 navSide —— webview 会被挤窄').toBe('collapse');
    expect(v!.navSideTab?.navSideDisabled, '没禁用空面板 —— 点 tab 会展开一栏空的').toBe(true);
  });

  it('⭐⭐ 右栏「操作台」:**不占** navSide,只进 SlotPicker', () => {
    const v = byId('x-workbench-view');
    expect(v, 'x-workbench-view 没注册 —— SlotPicker 里召不出来').toBeDefined();
    expect(
      v!.navSideTab,
      '操作台占了 navSide 切换条 —— 用户要的是「随时可关的右栏工具」,\n'
      + '占 navSide 等于把它变成第二个常驻入口',
    ).toBeUndefined();
    expect(v!.slotPickerEntry?.label).toBe('X 操作台');
  });

  it('⭐ 两个是**不同的** view(不是同一个挂两处)', () => {
    const a = byId('x-web-view');
    const b = byId('x-workbench-view');
    expect(a!.component, '两个 view 用了同一个组件 —— 那就不是「各自独立」了')
      .not.toBe(b!.component);
  });

  it('⚠️ view id 不许与别的模块撞', () => {
    const ids = all().map((v) => v.id);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dup, 'view id 重复 —— 后注册的会覆盖先注册的,且不报错:\n  ' + dup.join('\n  '))
      .toEqual([]);
  });
});
