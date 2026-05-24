/**
 * text-editing capability 在 L4 contextInfoProviderRegistry / enabledWhenRegistry
 * 注册业务字段贡献 + 谓词(handoff: docs/tasks/context-menu-registry-handoff.md
 * §字段迁移清单)。
 *
 * 贡献字段(ContextInfo.custom):
 * - hasLink           : DOM 路径(target.closest a[href])∪ selection 路径
 *                       (activeMarks 含 'link') — "移除链接"用
 * - hasMarks          : selection.activeMarks 非空 — "移除格式"用
 * - hasBlockSelection : selection.kind ∈ {block, multi-block} — "删除 Block"用
 * - pmInstanceId      : driver instanceRegistry.getFocusedInstanceId() 快照
 *                       (右键事件触发瞬间 PM 还有焦点;contextMenuController.show
 *                        之后 focus 转向菜单,query 返 null)
 *
 * 注册的 enabledWhen 谓词:
 * - 'has-link'            → !!ctx.custom.hasLink
 * - 'has-marks'           → !!ctx.custom.hasMarks
 * - 'has-block-selection' → !!ctx.custom.hasBlockSelection
 *
 * 在 capability index 加载时调用一次(早于 view self-register,顺序由 renderer/index.tsx
 * import 顺序保证 — capabilities 在 views 之前)。
 */

import { contextInfoProviderRegistry } from '@slot/interaction-registries/context-info-provider-registry';
import { enabledWhenRegistry } from '@slot/interaction-registries/enabled-when-registry';
import { selection } from '@capabilities/selection';
import { instanceRegistry } from '@drivers/text-editing-driver/instance-registry';

export function registerTextEditingContextInfo(): void {
  contextInfoProviderRegistry.register({
    id: 'text-editing',
    provider: (target: HTMLElement) => {
      // L5-B3.15:hasLink 双重判定 — 用户在 link 内右键就该能"移除链接",
      //   不应该强迫先选中文字。两条互补路径:
      //
      // (1) DOM 路径:右键 target 的祖先有 <a href> 元素(link mark 渲染)
      //     — 光标在 link 文字内或贴在 link 边界都能命中,最可靠
      // (2) selection 路径:driver emit 的 activeMarks 含 'link'
      //     — 选区跨多个字符且至少一个位置覆盖 link 时命中(包含 collapsed 选区
      //       时 driver 自己已用 $from.marks() 处理)
      const inLinkDom = !!target.closest('a[href]');
      const selPayload = selection.api.getCurrent();
      const inLinkSel = !!selPayload?.activeMarks?.includes('link');
      const hasLink = inLinkDom || inLinkSel;

      // "移除格式" 用 — 选区上覆盖至少一个 mark(光标态/无选区/空 mark 集都 false)
      const hasMarks =
        !!selPayload?.activeMarks && selPayload.activeMarks.length > 0;
      // "删除 Block" 用 — block/multi-block 选区(NodeSelection 或跨多 block 文本选区)
      const hasBlockSelection =
        selPayload?.kind === 'block' || selPayload?.kind === 'multi-block';

      // 抓拍 focused PM 实例(右键事件触发那一刻 PM 还有焦点;contextMenuController.show
      // 之后 focus 转向菜单,getFocusedInstanceId 会返 null)。命令 handler 从
      // controller.context.custom.pmInstanceId 拿。
      const pmInstanceId = instanceRegistry.getFocusedInstanceId() ?? null;

      return {
        hasLink,
        hasMarks,
        hasBlockSelection,
        pmInstanceId,
      };
    },
  });

  enabledWhenRegistry.register('has-link', (ctx) => !!ctx.custom.hasLink);
  enabledWhenRegistry.register('has-marks', (ctx) => !!ctx.custom.hasMarks);
  enabledWhenRegistry.register(
    'has-block-selection',
    (ctx) => !!ctx.custom.hasBlockSelection,
  );
}
