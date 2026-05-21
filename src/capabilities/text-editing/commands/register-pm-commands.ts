/**
 * text-editing capability — PM 通用命令注册(C7 上提)
 *
 * 把原 NoteView 注册的 46 个 PM 通用命令统一迁到 capability 端,
 * 任何 PM-using view(NoteView / ThoughtView / canvas-text-node)装 'text-editing'
 * capability 都自带这 46 个命令(install 不需各自重复注册)。
 *
 * 决议:
 * - D-A 命令 id `text-editing.*`(C1 已重命名,本 commit 仅搬实现)
 * - D-B 命令实现走 driver capability api(requireCapabilityApi.api)
 * - N-1 唯一注册源 — 同 command id 全工程仅一处 register;C7 同步删 NoteView 旧 register
 * - L5-G4.5 focus-first instanceId 路径(canvas-text-node 嵌入 popup 复合 id 场景):
 *   优先用 instanceRegistry.getFocusedInstanceId();fallback 走 workspaceManager.getActiveId()
 *
 * 入口:capability/text-editing/index.ts 加载时调 registerTextEditingCommands()
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { handleMenuController } from '@slot/triggers/handle-menu-controller';
import { contextMenuController } from '@slot/triggers/context-menu-controller';
import { popupController } from '@slot/triggers/popup-controller';
import { textEditingDriverApi, type MarkName } from '@drivers/text-editing-driver';
import { instanceRegistry } from '@drivers/text-editing-driver/instance-registry';

const tea = textEditingDriverApi;

type TurnTarget =
  | 'paragraph' | 'h1' | 'h2' | 'h3'
  | 'bullet-list' | 'ordered-list' | 'task-list'
  | 'blockquote' | 'code-block' | 'horizontal-rule'
  | 'callout' | 'toggle-list';

/**
 * focus-first instanceId resolver(L5-G4.5)
 *
 * 优先用真正持有焦点的 PM 实例 id — 让 NoteView / ThoughtView / canvas-text-node
 * 嵌入的 popup 编辑器(instanceId 是 `${workspaceId}::${nodeId}` 复合)能正确路由。
 * Fallback:无 PM 实例聚焦时走 workspace activeId(等价 NoteView 单 PM 实例场景)。
 */
function resolveInstanceId(): string | null {
  return instanceRegistry.getFocusedInstanceId() ?? workspaceManager.getActiveId();
}

function withInstance(fn: (instanceId: string) => void): () => void {
  return () => {
    const id = resolveInstanceId();
    if (!id) return;
    fn(id);
  };
}

/** handle pos 解析(handle 命令作用于 handleMenuController.state.pos 指向的 block)
 *
 * fix/handle-menu-instance-id:不再走 resolveInstanceId() 的 focused-fallback。
 * controller state 自带 instanceId(handle plugin show 时显式传),命令必须用 state
 * 携带的 id — 否则多 PM 实例共存(thought 横切层等)时 focused 会指向无关 view,
 * 把 thought 的 pos 用到 NoteView 实例上误删数据(本 fix 起因)。
 */
function getHandlePos(): { instanceId: string; pos: number } | null {
  const state = handleMenuController.getState();
  if (!state.instanceId) return null;
  if (typeof state.pos !== 'number') return null;
  return { instanceId: state.instanceId, pos: state.pos };
}

/** context menu block pos 解析(从鼠标位置 resolveBlockAt) */
function getCmBlockPos(): { instanceId: string; pos: number } | null {
  const id = resolveInstanceId();
  if (!id) return null;
  const state = contextMenuController.getState();
  const result = tea.resolveBlockAt(id, { x: state.x, y: state.y });
  if (!result) return null;
  return { instanceId: id, pos: result.pos };
}

// ── 色板 ──(L5-B3.3 Plan C-1 缩水版 6 色 cycle;完整 ColorPickerPanel 走 popup)

const TEXT_COLOR_CYCLE = [
  '',           // default(移除色)
  '#9aa0a6',    // gray
  '#f5c518',    // yellow
  '#8ab4f8',    // blue
  '#ea4335',    // red
  '#34a853',    // green
];

const HIGHLIGHT_COLOR_CYCLE = [
  '',                                  // default
  'rgba(154, 160, 166, 0.2)',          // gray
  'rgba(245, 197, 24, 0.2)',           // yellow
  'rgba(138, 180, 248, 0.2)',          // blue
  'rgba(234, 67, 53, 0.2)',            // red
  'rgba(52, 168, 83, 0.2)',            // green
];

export function registerTextEditingCommands(): void {
  // ── L5-B2:Marks(toggleBold/Italic/Underline/Strike/Code) ──

  function registerToggleMark(commandId: string, markName: MarkName): void {
    commandRegistry.register(commandId, withInstance((instanceId) => {
      tea.toggleMark(instanceId, markName);
    }));
  }
  registerToggleMark('text-editing.toggle-bold', 'bold');
  registerToggleMark('text-editing.toggle-italic', 'italic');
  registerToggleMark('text-editing.toggle-underline', 'underline');
  registerToggleMark('text-editing.toggle-strike', 'strike');
  registerToggleMark('text-editing.toggle-code', 'code');

  // ── L5-B2:Heading ──

  commandRegistry.register('text-editing.set-heading-level', (level: unknown) => {
    const id = resolveInstanceId();
    if (!id) return;
    const lvl = typeof level === 'number' ? level : null;
    tea.setHeading(id, lvl);
  });

  // ── L5-B3.3:Color cycle(6 色) ──

  commandRegistry.register('text-editing.cycle-text-color', withInstance((instanceId) => {
    const cur = tea.getActiveTextColor(instanceId);
    const idx = TEXT_COLOR_CYCLE.indexOf(cur ?? '');
    const next = TEXT_COLOR_CYCLE[(idx + 1) % TEXT_COLOR_CYCLE.length];
    tea.setTextColor(instanceId, next);
  }));

  commandRegistry.register('text-editing.cycle-highlight', withInstance((instanceId) => {
    const cur = tea.getActiveHighlight(instanceId);
    const idx = HIGHLIGHT_COLOR_CYCLE.indexOf(cur ?? '');
    const next = HIGHLIGHT_COLOR_CYCLE[(idx + 1) % HIGHLIGHT_COLOR_CYCLE.length];
    tea.setHighlight(instanceId, next);
  }));

  // ── L5-B2:Undo / Redo ──

  commandRegistry.register('text-editing.undo', withInstance((instanceId) => {
    tea.undo(instanceId);
  }));
  commandRegistry.register('text-editing.redo', withInstance((instanceId) => {
    tea.redo(instanceId);
  }));

  // ── L5-B3.2:Slash turn-into(12 项 — 光标当前 block setHeading 路径) ──

  function registerSlashTurn(commandId: string, target: TurnTarget): void {
    commandRegistry.register(commandId, withInstance((instanceId) => {
      tea.clearSlashTrigger(instanceId);
      tea.turnIntoSelection(instanceId, target);
    }));
  }
  registerSlashTurn('text-editing.slash-turn-paragraph', 'paragraph');
  registerSlashTurn('text-editing.slash-turn-h1', 'h1');
  registerSlashTurn('text-editing.slash-turn-h2', 'h2');
  registerSlashTurn('text-editing.slash-turn-h3', 'h3');
  registerSlashTurn('text-editing.slash-turn-bullet', 'bullet-list');
  registerSlashTurn('text-editing.slash-turn-ordered', 'ordered-list');
  registerSlashTurn('text-editing.slash-turn-task', 'task-list');
  registerSlashTurn('text-editing.slash-turn-quote', 'blockquote');
  // slash-turn-code 单独注册:支持 payload { language } —— `/code python` 直接落语言
  commandRegistry.register('text-editing.slash-turn-code', (payload?: unknown) => {
    const id = resolveInstanceId();
    if (!id) return;
    tea.clearSlashTrigger(id);
    const lang =
      payload && typeof payload === 'object' && 'language' in payload
        ? String((payload as { language: unknown }).language ?? '')
        : '';
    tea.turnIntoSelection(id, 'code-block', lang || undefined);
  });
  registerSlashTurn('text-editing.slash-turn-divider', 'horizontal-rule');
  registerSlashTurn('text-editing.slash-turn-callout', 'callout');
  registerSlashTurn('text-editing.slash-turn-toggle', 'toggle-list');

  // ── L5-B3.6:Math 通用插入 ──

  commandRegistry.register('text-editing.slash-insert-math-block', withInstance((instanceId) => {
    tea.clearSlashTrigger(instanceId);
    tea.insertMathBlockAtSelection(instanceId);
  }));

  commandRegistry.register('text-editing.insert-math-inline', withInstance((instanceId) => {
    tea.insertMathInlineAtSelection(instanceId);
  }));

  // ── Mermaid block(V1 → V2 直迁) ──

  commandRegistry.register('text-editing.slash-insert-mermaid-block', withInstance((instanceId) => {
    tea.clearSlashTrigger(instanceId);
    tea.insertMermaidBlockAtSelection(instanceId);
  }));

  // ── HTML preview block(V1 → V2 直迁) ──

  commandRegistry.register('text-editing.slash-insert-html-block', withInstance((instanceId) => {
    tea.clearSlashTrigger(instanceId);
    tea.insertHtmlBlockAtSelection(instanceId);
  }));

  // ── Math Visual block(V1 → V2 迁移 Phase 1B,走 math-rendering capability) ──

  commandRegistry.register('text-editing.slash-insert-math-visual', withInstance((instanceId) => {
    tea.clearSlashTrigger(instanceId);
    tea.insertMathVisualAtSelection(instanceId);
  }));

  // ── L5-B3.2:Handle turn-into(11 项 — handleMenuController.pos 路径) ──

  function registerHandleTurn(commandId: string, target: TurnTarget): void {
    commandRegistry.register(commandId, () => {
      const ctx = getHandlePos();
      if (!ctx) return;
      tea.turnIntoAt(ctx.instanceId, ctx.pos, target);
      handleMenuController.hide();
    });
  }
  registerHandleTurn('text-editing.handle-turn-paragraph', 'paragraph');
  registerHandleTurn('text-editing.handle-turn-h1', 'h1');
  registerHandleTurn('text-editing.handle-turn-h2', 'h2');
  registerHandleTurn('text-editing.handle-turn-h3', 'h3');
  registerHandleTurn('text-editing.handle-turn-bullet', 'bullet-list');
  registerHandleTurn('text-editing.handle-turn-ordered', 'ordered-list');
  registerHandleTurn('text-editing.handle-turn-task', 'task-list');
  registerHandleTurn('text-editing.handle-turn-quote', 'blockquote');
  registerHandleTurn('text-editing.handle-turn-code', 'code-block');
  registerHandleTurn('text-editing.handle-turn-callout', 'callout');
  registerHandleTurn('text-editing.handle-turn-toggle', 'toggle-list');

  // ── Handle heading 折叠/展开(note-toc feature) ──

  commandRegistry.register('text-editing.handle-toggle-heading-collapse', () => {
    const ctx = getHandlePos();
    if (!ctx) return;
    tea.toggleHeadingCollapseAt(ctx.instanceId, ctx.pos);
    handleMenuController.hide();
  });

  // ── L5-B3.9:Handle block 操作(Copy / Duplicate / Delete) ──

  /**
   * Copy(D-5 修 bug):写 text/html + text/plain 双 envelope,粘回 KRIG 内 PM
   * smart-paste 还原原 block;粘到外部应用降级到 plain text(原 V1/V2 实现只写 plain)。
   */
  commandRegistry.register('text-editing.handle-copy-block', () => {
    const ctx = getHandlePos();
    if (!ctx) {
      handleMenuController.hide();
      return;
    }
    const env = tea.getBlockClipboardAt(ctx.instanceId, ctx.pos);
    if (env) {
      // 优先 ClipboardItem(支持双 MIME);不支持时降级 writeText(失去 HTML 格式)
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
        const item = new ClipboardItem({
          'text/html': new Blob([env.html], { type: 'text/html' }),
          'text/plain': new Blob([env.text], { type: 'text/plain' }),
        });
        void navigator.clipboard.write([item]).catch(() => {
          // 写入失败降级到 plain text
          void navigator.clipboard.writeText(env.text).catch(() => {});
        });
      } else {
        void navigator.clipboard.writeText(env.text).catch(() => {});
      }
    }
    handleMenuController.hide();
  });

  commandRegistry.register('text-editing.handle-duplicate-block', () => {
    const ctx = getHandlePos();
    if (!ctx) return;
    tea.copyBlockAt(ctx.instanceId, ctx.pos);
    handleMenuController.hide();
  });

  commandRegistry.register('text-editing.handle-delete-block', () => {
    const ctx = getHandlePos();
    if (!ctx) return;
    tea.deleteBlockAt(ctx.instanceId, ctx.pos);
    handleMenuController.hide();
  });

  // ── L5-B3.9:Context menu — clipboard 组(Cut/Copy/Paste/Select All) ──

  commandRegistry.register('text-editing.cm-cut', () => {
    document.execCommand('cut');
    contextMenuController.hide();
  });
  commandRegistry.register('text-editing.cm-copy', () => {
    document.execCommand('copy');
    contextMenuController.hide();
  });
  commandRegistry.register('text-editing.cm-paste', () => {
    // execCommand('paste') 在 Electron renderer 大多数情况不可用(安全策略)
    // 占位:后续 sub-stage 接 PM clipboardSerializer + handlePaste,先 noop
    // 用户走 Cmd+V 默认行为(PM 自带)即可
    contextMenuController.hide();
  });
  commandRegistry.register('text-editing.cm-select-all', () => {
    document.execCommand('selectAll');
    contextMenuController.hide();
  });

  // ── Context menu — block-actions / marks ──

  commandRegistry.register('text-editing.cm-delete-block', () => {
    const ctx = getCmBlockPos();
    if (!ctx) return;
    tea.deleteBlockAt(ctx.instanceId, ctx.pos);
    contextMenuController.hide();
  });

  commandRegistry.register('text-editing.cm-remove-marks', () => {
    // 占位:对当前选区移除所有 marks(L5-B+ 实现)
    console.warn('[text-editing] cm-remove-marks: 占位,未实现');
    contextMenuController.hide();
  });

  /**
   * L5-B3.15:右键移除链接(对应 has-link 条件项)
   *
   * UX 直觉:光标在 link 文字内(甚至无光标,只是右键到 link 上)就能移除,
   * 不强迫用户先选中文字。用 contextMenu 的鼠标坐标定位 PM pos,
   * 再扩展到完整 link 范围 + removeMark。
   */
  commandRegistry.register('text-editing.cm-remove-link', () => {
    const id = resolveInstanceId();
    if (!id) return;
    const cm = contextMenuController.getState();
    tea.removeLinkAtClientPoint(id, cm.x, cm.y);
    contextMenuController.hide();
  });

  // ── W4.1 / L5-B3.4:popup-link(Cmd+K / floating-toolbar 🔗 触发) ──

  /**
   * 选中文字弹 LinkPanel popover。
   *
   * anchor 优先用 floating-toolbar 的 link 按钮(若已显示),
   * fallback 用选区 rect 制造虚拟 div anchor(popup 后立即 remove)。
   */
  commandRegistry.register('text-editing.popup-link', () => {
    const linkBtn = document.querySelector(
      '.krig-floating-toolbar [title="🔗"], .krig-floating-toolbar-item[title="🔗"]',
    );
    if (linkBtn instanceof Element) {
      popupController.show('text-editing.popup.link', linkBtn);
      return;
    }
    // fallback:选区 rect 模拟虚拟 anchor
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const fake = document.createElement('div');
    fake.style.position = 'fixed';
    fake.style.left = `${rect.left}px`;
    fake.style.top = `${rect.bottom}px`;
    fake.style.width = '1px';
    fake.style.height = '1px';
    document.body.appendChild(fake);
    popupController.show('text-editing.popup.link', fake);
    window.setTimeout(() => fake.remove(), 0);
  });
}
