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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
    expect(v!.navSideTab?.label).toBe('X 网页');
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

  it('⭐⭐ 左栏必须有「召出右栏」的入口 —— 否则操作台开不出来', () => {
    /**
     * ⚠️ **实测踩到(2026-10-01)**:第一版只注册了两个 view,
     * 但 `XWebView` 里**没有打开 SlotPicker 的按钮** ——
     * 于是用户看到左栏、却**没有任何办法召出右栏那个独立 view**。
     *
     * ⭐ 别的 view(Note / AI / eBook / Mail)**都有**这个按钮,
     * 是我漏了。这条钉住它别再漏。
     *
     * 判据分两层:
     * ① 命令注册器挂上了(`commands` 字段)—— 没有它命令不存在
     * ② 组件里真的调了 SlotPicker —— 有命令没按钮同样召不出来
     */
    const v = byId('x-web-view');
    expect(
      v!.commands,
      '左栏 view 没挂 commands —— `x-view.open-right-slot` 不会被注册,\n'
      + 'SlotPicker 选中后会静默无反应',
    ).toBeTypeOf('function');

    // ⚠️ 组件那层只能看源码(组件没渲染就没法查行为)——
    //    但**命令那层是真查注册表的**,两层合起来才完整。
    const src = readFileSync(
      join(process.cwd(), 'src/modules/x/XWebView.tsx'),
      'utf-8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(
      src,
      '左栏组件里没有打开 SlotPicker 的调用 —— 右栏那个独立 view 召不出来',
    ).toMatch(/popupController\.toggle\s*\(\s*SLOT_PICKER_POPUP_ID/);
    expect(
      src,
      '没把本 view 的命令注入 slotPickerContext —— popup 选中后不知道该调谁',
    ).toMatch(/slotPickerContext\.setCommandId\(\s*['"]x-view\.open-right-slot['"]/);
  });

  it('⭐⭐ 两个入口在 SlotPicker 里必须**一眼分得出**', () => {
    /**
     * ⚠️ **实测踩到(2026-10-01)**:左栏叫「X」、右栏叫「X 操作台」,
     * 而 SlotPicker **两个都列**(一个有 navSideTab、一个有 slotPickerEntry)。
     * 用户点了「X」→ 右栏开出**第二个网页 view**,两栏都是「𝕏 网页」。
     *
     * ⭐ 不是功能坏了,是**名字没把用途说清楚** ——
     * 两项都以 X 开头、长得像,人只能靠猜。
     *
     * 判据:两个 label **互不为前缀**(光靠前缀分不出就等于没分)。
     */
    const web = byId('x-web-view')!.navSideTab!.label;
    const wb = byId('x-workbench-view')!.slotPickerEntry!.label;
    expect(web, 'label 为空').toBeTruthy();
    expect(wb, 'label 为空').toBeTruthy();
    expect(web).not.toBe(wb);
    expect(
      wb.startsWith(web) || web.startsWith(wb),
      `两个入口的名字互为前缀,SlotPicker 里分不出谁是谁:\n`
      + `  左栏「${web}」  右栏「${wb}」\n`
      + '⚠️ 实测后果:点错一个,右栏开出第二个网页 view',
    ).toBe(false);
  });

  it('⭐⭐ 左栏声明了 web-rendering —— 漏了会白屏', () => {
    /**
     * ⚠️ `XWebView` 里 `requireCapabilityApi('web-rendering')` 取不到会**抛**。
     * install 漏声明的表现是「切过去白屏 + 控制台一行报错」——
     * 而**测试照样全绿**(组件没渲染就不会抛)。
     * ⭐ 所以这条钉声明,不钉组件行为。
     */
    const v = byId('x-web-view');
    expect(
      v!.install,
      '左栏没声明 web-rendering —— webview 取不到 Host,切过去会白屏',
    ).toContain('web-rendering');
  });
});

