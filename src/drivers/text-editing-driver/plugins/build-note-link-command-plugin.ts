/**
 * note-link-command plugin — 监听 `[[` 输入触发笔记搜索面板(L5-B3.12)
 *
 * V1 → V2 直迁:src/plugins/note/plugins/note-link-command.ts
 *
 * state:
 * - active:面板是否打开
 * - query:`[[` 后的输入(供搜索面板过滤)
 * - from / to:`[[` 起始 + 当前末尾 PM pos(供面板插入 noteLink 时清掉源文本)
 *
 * 触发:handleTextInput 检测连续两个 `[`(textBefore.endsWith('[[') 严格判断)→
 * dispatch open meta + 调 view 层注入的 onOpen callback(view 层启 popup)
 *
 * 关闭:Escape / `]]` 出现 / [[ 被删 / view 层 popup close 时 dispatch close meta
 *
 * V2 拆分后:paragraph / heading 节点内都允许触发 [[(原 V1 合一节点行为)
 * - active 时 Enter / 上下方向键由 view 层 popup 拿走(plugin 让 keydown 返回 true 阻断 PM)
 * - open / close 通过 view 注入 onOpenSearch / onCloseSearch 通知 view 启停 popup
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

export interface NoteLinkCommandState {
  active: boolean;
  query: string;
  /** [[ 起始 PM pos(含 [[ 那两个字符)*/
  from: number;
  /** 当前末尾 PM pos(用户继续输入会推进)*/
  to: number;
}

const INITIAL: NoteLinkCommandState = { active: false, query: '', from: 0, to: 0 };

export const noteLinkCommandKey = new PluginKey<NoteLinkCommandState>('noteLinkCommand');

/**
 * view 层注入的 popup 控制 callback(view 不知道 PM 内部 state,plugin 不知道 popup UI)
 */
export interface NoteLinkSearchHandler {
  /** plugin 检测到 [[ → 调本回调,view 层启 popup(传 view + state for 后续操作)*/
  onOpen: (view: EditorView) => void;
  /** plugin 收到关闭信号 → view 层关 popup */
  onClose: () => void;
}

let activeHandler: NoteLinkSearchHandler | null = null;

export function setNoteLinkSearchHandler(handler: NoteLinkSearchHandler | null): void {
  activeHandler = handler;
}

/** 当前 active 的 view(panel 用来读 plugin state + dispatch tr 插入 noteLink)*/
let activeView: EditorView | null = null;

export function getNoteLinkActiveView(): EditorView | null {
  return activeView;
}

export function buildNoteLinkCommandPlugin(): Plugin<NoteLinkCommandState> {
  return new Plugin<NoteLinkCommandState>({
    key: noteLinkCommandKey,

    state: {
      init(): NoteLinkCommandState {
        return INITIAL;
      },
      apply(tr, prev): NoteLinkCommandState {
        const meta = tr.getMeta(noteLinkCommandKey) as
          | { open?: true; from?: number; to?: number }
          | { close: true }
          | undefined;
        if (meta && 'close' in meta && meta.close) return INITIAL;
        if (meta && 'open' in meta && meta.open && typeof meta.from === 'number' && typeof meta.to === 'number') {
          return { active: true, query: '', from: meta.from, to: meta.to };
        }

        if (!prev.active) return prev;

        // 文档变化 — 重算 query;[[ 被删或出现 ]] → 关闭
        if (tr.docChanged) {
          const $from = tr.doc.resolve(tr.selection.from);
          const textBefore = $from.parent.textBetween(0, $from.parentOffset);
          const bracketIdx = textBefore.lastIndexOf('[[');
          if (bracketIdx < 0) return INITIAL;
          const query = textBefore.slice(bracketIdx + 2);
          if (query.includes(']]')) return INITIAL;
          const blockStart = $from.start();
          return {
            active: true,
            query,
            from: blockStart + bracketIdx,
            to: tr.selection.from,
          };
        }

        return prev;
      },
    },

    props: {
      handleTextInput(view, _from, _to, text) {
        // 仅在输入 `[` 时检查(连续 [ 即触发)
        if (text !== '[') return false;
        const state = noteLinkCommandKey.getState(view.state);
        if (state?.active) return false;

        const { $from } = view.state.selection;
        if ($from.parent.type.name !== 'paragraph' && $from.parent.type.name !== 'heading') return false;

        // 让本次 `[` 输入先落到文档,再延后检查 textBefore 是否以 [[ 结尾
        setTimeout(() => {
          if (view.isDestroyed) return;
          const cur = noteLinkCommandKey.getState(view.state);
          if (cur?.active) return;

          const { $from: $f } = view.state.selection;
          if ($f.parent.type.name !== 'paragraph' && $f.parent.type.name !== 'heading') return;
          const textBefore = $f.parent.textBetween(0, $f.parentOffset);
          if (!textBefore.endsWith('[[')) return;

          const blockStart = $f.start();
          const bracketPos = blockStart + textBefore.length - 2;
          view.dispatch(
            view.state.tr.setMeta(noteLinkCommandKey, {
              open: true,
              from: bracketPos,
              to: view.state.selection.from,
            }),
          );
          activeView = view;
          activeHandler?.onOpen(view);
        }, 0);

        return false;
      },

      handleKeyDown(view, event) {
        const state = noteLinkCommandKey.getState(view.state);
        if (!state?.active) return false;

        if (event.key === 'Escape') {
          view.dispatch(view.state.tr.setMeta(noteLinkCommandKey, { close: true }));
          activeView = null;
          activeHandler?.onClose();
          return true;
        }

        // active 时 Enter / 上下方向键由 popup 拿走 — 阻止 PM 默认行为
        if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          return true;
        }

        return false;
      },
    },

    view() {
      return {
        update(view, prev) {
          // state 切换 active = true → false 时(query 自然消失,如 [[ 被删 / ]] 输入)
          // 通知 view 关 popup
          const cur = noteLinkCommandKey.getState(view.state);
          const before = noteLinkCommandKey.getState(prev);
          if (before?.active && !cur?.active) {
            activeView = null;
          activeHandler?.onClose();
          }
        },
      };
    },
  });
}
