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
import { mediaResolvePath } from '@capabilities/media-storage';

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
   * L5-B3.12:noteLink NodeView 同步目标 title 用 — 由 view 接 noteCapability.getNote
   * 返回 null = 目标 note 不存在(NodeView 切红色"未找到"态)
   * 注:resolver 形态保持同步,view 端用本地缓存的 NoteInfo 列表查 title
   *    (异步 IPC 查询不适合 NodeView render 路径)
   */
  resolveNoteTitle?: (noteId: string) => string | null;
  /**
   * L7 block atomization Stage 5(decision 026 §7.3):
   * 用户点击旧 URL(krig://block/<noteId>/<V1 anchor>)字面触发,view 字面弹 toast 提示
   * "链接已失效,请重新复制"。
   * 可选 — 若 view 不实现,driver 字面 console.warn 静默退出。
   */
  onLegacyBlockAnchor?: (anchor: string) => void;
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
 * 字面判断:此 anchor 是 V1 旧格式(含 ':' 表 idx:text;或纯文本不是 ULID 格式)?
 *
 * L7 block atomization Stage 5(decision 026 §7.3):
 * 新 URL 字面 `krig://block/<noteId>/<blockId>`,blockId 字面是 ULID(26 字符 Crockford Base32 大写)。
 *
 * V1 旧格式两种字面命中:
 * - `<idx>:<前30字>` — 字面含 ':' 字符
 * - `<heading text 前60字>` — 不含 ':' 但 length / charset 字面跟 ULID 不匹配
 *
 * ULID 字面 26 字符,字符集 0-9 + A-Z(不含 I/L/O/U,Crockford Base32)。
 */
function isV1LegacyAnchor(anchor: string): boolean {
  // 含 ':' → 字面 V1 'idx:text' 格式
  if (anchor.includes(':')) return true;
  // 长度不是 26 字符 → 不是 ULID
  if (anchor.length !== 26) return true;
  // 字符集校验:大写 + 数字 + Crockford(去 I/L/O/U)
  return !/^[0-9A-HJ-KM-NP-TV-Z]{26}$/.test(anchor);
}

/**
 * 滚动到目标 block(同文档 krig://block 路径 / 加载完成后路径)。
 *
 * L7 block atomization Stage 5 升级(decision 026 §7.3):
 * 旧版按 heading text / idx:text 字面匹配 — 字面漂移失效。
 * 新版按 blockId(== PM attrs.id)字面精确定位,跨编辑稳定。
 *
 * 字面检测旧格式 anchor → console.error + 调 onLegacyAnchor callback(view 端字面弹 toast)。
 */
export function scrollToBlockAnchor(view: EditorView, anchor: string): void {
  // 旧格式字面检测 — 弹 UI 提示
  if (isV1LegacyAnchor(anchor)) {
    console.warn(
      `[link-click] V1 旧格式 anchor 字面失效(L7 block atomization):${anchor}\n` +
        `  字面请重新复制链接(新格式 krig://block/<noteId>/<blockId>,blockId 是 26 字符 ULID)。`,
    );
    activeHandler?.onLegacyBlockAnchor?.(anchor);
    return;
  }

  const blockId = anchor; // 新格式 anchor 字面就是 blockId
  const doc = view.state.doc;
  let targetPos: number | null = null;

  doc.descendants((node, pos) => {
    if (targetPos !== null) return false;
    const id = node.attrs?.id as string | null | undefined;
    if (id === blockId) {
      targetPos = pos;
      return false;
    }
    return true;
  });

  if (targetPos === null) {
    console.warn(`[link-click] blockId ${blockId} not found in current doc`);
    return;
  }

  const dom = view.nodeDOM(targetPos);
  // [feedback_pm_dom_at_pos_text_node] DOM 字面可能是 text node → parentElement 兜底
  const target =
    dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target.classList.add('krig-block-link-highlight');
  window.setTimeout(() => target.classList.remove('krig-block-link-highlight'), 2000);
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

        // krig://block/{id}/{blockId}  (L7 升级:blockId 取代 idx:text / heading text)
        if (href.startsWith('krig://block/')) {
          const parts = href.replace('krig://block/', '').split('/');
          const noteId = parts[0];
          const blockAnchor = parts.slice(1).join('/');
          if (!noteId) return true;
          // L7 旧格式字面早检测(避免跨文档跳转还传脏 anchor 让目标 view 找不到)
          if (blockAnchor && isV1LegacyAnchor(blockAnchor)) {
            console.warn(
              `[link-click] V1 旧格式 anchor 字面失效:${href}`,
            );
            activeHandler?.onLegacyBlockAnchor?.(blockAnchor);
            return true;
          }
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
        // L5-B3.15:URL decoded path — FileTab 输出 href 用 encodeURIComponent,
        // openPath 需要原始 OS 路径(空格 / 中文等)
        if (href.startsWith('file://')) {
          let filePath: string;
          try {
            filePath = decodeURIComponent(new URL(href).pathname);
          } catch {
            filePath = href.replace(/^file:\/\//, '');
          }
          window.electronAPI?.openPath?.(filePath);
          return true;
        }

        // media:// (L5-B3.15)— 走 mediaResolvePath → openPath(对齐 fileBlock 打开)
        if (href.startsWith('media://')) {
          void mediaResolvePath(href).then((p) => {
            if (p) window.electronAPI?.openPath?.(p);
            else console.warn('[link-click] mediaResolvePath failed:', href);
          });
          return true;
        }

        // 未知协议 — 静默(用户可能输错)
        console.warn('[link-click] 未识别的协议:', href);
        return true;
      },
    },
  });
}
