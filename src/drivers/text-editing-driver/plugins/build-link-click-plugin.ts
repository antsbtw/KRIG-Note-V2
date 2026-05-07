/**
 * link-click plugin — L5-B3.4
 *
 * 编辑器内点击 link mark 的位置时分发 5 协议路由:
 * - krig://note/{id}             → 切右栏 NoteView + setActiveNote
 * - krig://block/{id}/{anchor}   → 同文档当场滚动 / 跨文档右栏 + 滚动
 * - https:// | http://           → electron shell.openExternal(系统默认浏览器)
 * - file://...                   → electron shell.openPath(系统默认应用)
 * - media://...                  → 暂未实现(留 viewAPI 阶段)
 *
 * Cmd+[ / Cmd+] 历史前进/后退(笔记导航)— 见 build-link-click-plugin 内 handleKeyDown
 *
 * 注:driver 不该直接 import view 层(铁律 — 依赖反转),
 *    所以 noteOpen 行为通过 callback 由 view 注入,driver 只发"链接被点击了"事件。
 *    本阶段简化:driver 直接用 electronAPI(全局)+ 暴露 onLinkClick callback 给 view。
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

// 注:window.electronAPI 类型在 src/shared/ipc/electron-api.d.ts 全局声明

export const linkClickKey = new PluginKey('linkClick');

/**
 * link 点击处理回调 — view 注入
 *
 * driver 不知道"如何打开笔记"(slotBinding / setActiveNote 是 view 业务),
 * view 通过 setLinkClickHandler 注册,driver 检测到 krig://note 等 KRIG 内部协议
 * 时调本 callback 执行业务路由。
 */
export interface LinkClickHandler {
  /** 打开 note(用户点击 krig://note/{id} 或 krig://block/{id}/{anchor})*/
  onOpenNote: (noteId: string, blockAnchor?: string) => void;
  /** 当前 view 文档对应的笔记 id(同文档 anchor 滚动判断用)— 可选 */
  getCurrentNoteId?: () => string | null;
  /**
   * L5-B4:打开 http(s):// URL(view 决定是右栏开 web view 还是 shell.openExternal)
   * 可选 — 若 view 不实现,driver 退化为直接 shell.openExternal
   */
  onOpenWebUrl?: (url: string) => void;
  /**
   * L5-B3.12:noteLink NodeView 同步目标 title 用 — 由 view 接 noteStore.get
   * 返回 null = 目标 note 不存在(NodeView 切红色"未找到"态)
   */
  resolveNoteTitle?: (noteId: string) => string | null;
}

let activeHandler: LinkClickHandler | null = null;

export function setLinkClickHandler(handler: LinkClickHandler | null): void {
  activeHandler = handler;
}

/** 给 driver 内部 NodeView 用(noteLink 等)— view 层用 setLinkClickHandler 注入 */
export function getLinkClickHandler(): LinkClickHandler | null {
  return activeHandler;
}

/**
 * 滚动到目标 block(同文档 krig://block 路径 / 加载完成后路径)
 *
 * anchor 格式:
 * - 纯文本 → 按 heading 文本前缀匹配
 * - "idx:前缀文本" → 按顺序索引 + 文本前缀匹配(给非 heading block 用,本阶段暂不必)
 */
export function scrollToBlockAnchor(view: EditorView, anchor: string): void {
  const decoded = decodeURIComponent(anchor);
  const doc = view.state.doc;
  let targetPos: number | null = null;

  doc.forEach((node, offset) => {
    if (targetPos !== null) return;
    if (node.type.name === 'text-block' && node.attrs.level) {
      const text = node.textContent.trim();
      if (text === decoded || text.startsWith(decoded)) {
        targetPos = offset;
      }
    }
  });
  // 标题没匹配 → 全文前缀搜索兜底
  if (targetPos === null) {
    doc.forEach((node, offset) => {
      if (targetPos !== null) return;
      if (node.textContent.trim().startsWith(decoded)) {
        targetPos = offset;
      }
    });
  }

  if (targetPos !== null) {
    const dom = view.nodeDOM(targetPos);
    if (dom instanceof HTMLElement) {
      dom.scrollIntoView({ behavior: 'smooth', block: 'start' });
      dom.classList.add('krig-block-link-highlight');
      window.setTimeout(() => dom.classList.remove('krig-block-link-highlight'), 2000);
    }
  }
}

export function buildLinkClickPlugin(): Plugin {
  return new Plugin({
    key: linkClickKey,
    props: {
      handleClick(view, pos, event) {
        // 仅左键
        if (event.button !== 0) return false;
        // Cmd/Ctrl 修饰键 → 留给系统默认行为(如选中,本阶段不处理 Cmd-click)
        // 注:V1 link-click 也是无 modifier 直接触发

        const $pos = view.state.doc.resolve(pos);
        const linkType = view.state.schema.marks.link;
        if (!linkType) return false;
        const linkMark = $pos.marks().find((m) => m.type === linkType);
        if (!linkMark) return false;

        const href = linkMark.attrs.href as string;
        if (!href) return false;

        event.preventDefault();
        event.stopPropagation();

        // ── 协议分发 ──

        // krig://block/{id}/{anchor}
        if (href.startsWith('krig://block/')) {
          const parts = href.replace('krig://block/', '').split('/');
          const noteId = parts[0];
          const blockAnchor = parts.slice(1).join('/');
          if (!noteId) return true;
          // 同文档 → 当场滚动(对齐 V1 心智模型 — 不开右栏)
          const currentId = activeHandler?.getCurrentNoteId?.() ?? null;
          if (blockAnchor && currentId === noteId) {
            scrollToBlockAnchor(view, blockAnchor);
            return true;
          }
          // 跨文档 → view 处理(右栏 + 滚动)
          activeHandler?.onOpenNote(noteId, blockAnchor || undefined);
          return true;
        }

        // krig://note/{id}
        if (href.startsWith('krig://note/')) {
          const noteId = href.replace('krig://note/', '');
          if (noteId) activeHandler?.onOpenNote(noteId);
          return true;
        }

        // http(s)://
        if (href.startsWith('http://') || href.startsWith('https://')) {
          // L5-B4:view 注入 onOpenWebUrl 时优先(右栏开 web view);否则退化系统浏览器
          if (activeHandler?.onOpenWebUrl) {
            activeHandler.onOpenWebUrl(href);
          } else {
            window.electronAPI?.openExternal?.(href);
          }
          return true;
        }

        // file://
        if (href.startsWith('file://')) {
          const filePath = href.replace(/^file:\/\//, '');
          window.electronAPI?.openPath?.(filePath);
          return true;
        }

        // 未知协议 — 静默(用户可能输错)
        console.warn('[link-click] 未识别的协议:', href);
        return true;
      },
    },
  });
}
