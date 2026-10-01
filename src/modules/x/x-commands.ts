/**
 * X 模块的命令 —— ⚠️ 本步只有「开/关右栏」两条,零业务
 *
 * ⭐ 这两条是**用户要的那个形态**的前提:
 * 「x 的操作作为一个单独的 view 在 right slot,**随时可以关闭**」——
 * 没有命令就既召不出也关不掉。
 *
 * ⚠️ 命令注册需要**本窗口的 wsId**(异步到),所以走 `ViewDefinition.commands`
 * 由 registry 收着、等 `onMyWsIdReady` 后统一跑
 * (见 `project-module-self-register-commands`:
 *  多窗口下用 `snapshot.activeId` 顶替会把命令注册到别人头上)。
 */

import { registerWsCommand } from '@slot/command-registry/register-ws-command';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';

export function registerXCommands(wsId: string): void {
  /**
   * SlotPicker 视图切换 —— 在 right slot 打开选中的 view。
   *
   * ⚠️ commandArg 与别的 view 的 `open-right-slot` **完全一致**
   * (同一个 SlotPickerPopup 回调):
   *   · string → 目标 viewId
   *   · { viewId, subId } → 带子项的 view
   * ⭐ 形状不一致的话 popup 选中后会静默无反应 —— 它不知道你收的是别的形状。
   */
  registerWsCommand('x-view.open-right-slot', () => wsId, (ctx, arg: unknown) => {
    const bus = workspaceManager.getBus(ctx.wsId);
    if (!bus) return;
    if (typeof arg === 'string') {
      bus.slot.openRight(arg);
    } else if (arg && typeof arg === 'object' && 'viewId' in arg) {
      const { viewId, subId } = arg as { viewId: string; subId?: string };
      bus.slot.openRight(viewId, subId ? { subId } : undefined);
    }
  });

  /** 关 right slot —— SlotToggle 再次点击已激活项时触发 */
  registerWsCommand('x-view.close-right-slot', () => wsId, (ctx) => {
    const bus = workspaceManager.getBus(ctx.wsId);
    if (!bus) return;
    bus.slot.closeRight();
  });
}
