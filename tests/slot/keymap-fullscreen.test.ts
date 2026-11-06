/**
 * @vitest-environment jsdom
 *
 * 全屏覆盖层打开时,全屏层里的按键不再退回到 workspace 活跃 view 的快捷键(2026-11-06)
 *
 * 起因:math-visual 全屏里按 ⌘[(图层下移)同时触发 note 的「后退」;按 ⌘K 报
 * 「无法解析目标 PM 实例,命令已跳过」(日志实证)。keymap-listener 找不到 data-view-id 时
 * 退回活跃 view,而全屏时 workspace 整层 display:none,它的快捷键不该响应。
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

// 让「找不到 data-view-id → 退回活跃 view」这条路真的能退回到 test-view。
// 不桩的话测试里没有 workspace,退回结果恒为 null,「全屏不响应」那条测试去掉修复也照样绿(已实测假绿)。
vi.mock('@workspace/workspace-instance/use-workspace', () => ({ getActiveWorkspaceIdSync: () => 'ws-test' }));
vi.mock('@workspace/workspace-state/active-slot', () => ({
  getActiveSlot: () => 'left',
  resolveActiveViewId: () => 'test-view',
}));
import { startKeymapListener } from '@slot/keymap-registry/keymap-listener';
import { keymapRegistry } from '@slot/keymap-registry/keymap-registry';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { fullscreenOverlayController } from '@slot/triggers/fullscreen-overlay-controller';

const spy = vi.fn();

function press(target: Element) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: '[', metaKey: true, bubbles: true }));
}

describe('keymap-listener × 全屏覆盖层', () => {
  let viewEl: HTMLElement;
  let fullscreenInner: HTMLElement;

  beforeAll(() => {
    commandRegistry.register('test.go-back', spy);
    keymapRegistry.register('test-view', [{ key: 'mod+[', command: 'test.go-back' }]);
    startKeymapListener(() => ({}) as never);

    viewEl = document.createElement('div');
    viewEl.dataset.viewId = 'test-view';
    document.body.appendChild(viewEl);

    const overlay = document.createElement('div');
    overlay.className = 'krig-fullscreen-overlay';
    fullscreenInner = document.createElement('div'); // 全屏面板里的普通元素,没有 data-view-id
    overlay.appendChild(fullscreenInner);
    document.body.appendChild(overlay);
  });

  afterEach(() => {
    spy.mockClear();
    fullscreenOverlayController.hide();
  });

  it('对照:按键在 view 里 → 照常执行', () => {
    press(viewEl);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('对照:全屏没打开时,不在任何 view 里的按键退回活跃 view 执行(证明退回这条路是通的)', () => {
    press(fullscreenInner);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('全屏打开、按键落在全屏层里 → 不执行 workspace 的快捷键', () => {
    fullscreenOverlayController.show('some-overlay');
    press(fullscreenInner);
    expect(spy).not.toHaveBeenCalled();
  });

  it('全屏打开时,带 data-view-id 的元素仍按它自己的 view 匹配', () => {
    fullscreenOverlayController.show('some-overlay');
    press(viewEl);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
