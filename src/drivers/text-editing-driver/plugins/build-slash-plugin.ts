/**
 * slash-command PM Plugin — driver 内部触发 slash menu
 *
 * Q6=A:行首/段首输入 `/` → slashMenuController.show
 *
 * 见 docs/RefactorV2/stages/L5B3.1-interactions-design.md § 3.1。
 *
 * State:
 *  - active:slash menu 是否激活
 *  - triggerPos:`/` 字符在 doc 中的位置
 *  - query:`/` 之后用户继续输入的文字(用于 slash registry 过滤)
 *
 * 关闭条件:
 *  - 选区变非空(用户拖选)
 *  - query 含换行
 *  - 光标移到 triggerPos 之前(用户删了 `/`)
 *  - Esc(由 SlashMenuBinding 监听)
 *
 * NOTE:空格不再关闭(Notion 行为)— 允许 "/2 col" / "task list" 等多词检索。
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { slashMenuController } from '@slot/triggers/slash-menu-controller';

export interface SlashState {
  active: boolean;
  triggerPos: number;
  query: string;
}

export const slashPluginKey = new PluginKey<SlashState>('text-editing-driver:slash');

const initialState: SlashState = { active: false, triggerPos: -1, query: '' };

export function buildSlashPlugin(viewId: string): Plugin {
  return new Plugin<SlashState>({
    key: slashPluginKey,
    state: {
      init: () => initialState,
      apply(tr: Transaction, prev: SlashState, _old, newState: EditorState): SlashState {
        const sel = newState.selection;

        // 选区非空 → 关
        if (!sel.empty) return initialState;

        // 已激活:更新 query 或关闭
        if (prev.active) {
          // 光标在 triggerPos 之前 / 同位 → / 被删了,关
          if (sel.from <= prev.triggerPos) return initialState;
          // 把 triggerPos 后到 sel.from 之间的文字作为 query
          const queryFrom = prev.triggerPos + 1;
          const queryTo = sel.from;
          if (queryTo < queryFrom) return initialState;
          const text = newState.doc.textBetween(queryFrom, queryTo, '\n');
          if (text.includes('\n')) return initialState;
          return { ...prev, query: text };
        }

        // 未激活:检测刚输入了 `/` 在行首/段首
        if (tr.steps.length === 0 || !tr.docChanged) return prev;
        const $from = sel.$from;
        if (sel.from < 1) return prev;
        const charBefore = newState.doc.textBetween(sel.from - 1, sel.from);
        if (charBefore !== '/') return prev;

        // 检查 / 前面是否在 block 起点(行首)
        const triggerPos = sel.from - 1;
        const blockStart = $from.start($from.depth);
        if (triggerPos !== blockStart) return prev;

        return { active: true, triggerPos, query: '' };
      },
    },
    view: () => ({
      update(view) {
        const state = slashPluginKey.getState(view.state);
        if (!state) return;
        const ctrl = slashMenuController.getState();

        if (state.active) {
          // 计算屏幕坐标(/ 字符上方,弹层在 / 下方一行)
          try {
            const coords = view.coordsAtPos(state.triggerPos);
            slashMenuController.show(coords.left, coords.bottom + 4, viewId, state.query);
          } catch {
            slashMenuController.hide();
          }
        } else {
          if (ctrl.visible && ctrl.viewId === viewId) {
            slashMenuController.hide();
          }
        }
      },
      destroy() {
        const ctrl = slashMenuController.getState();
        if (ctrl.visible && ctrl.viewId === viewId) slashMenuController.hide();
      },
    }),
  });
}

/**
 * 命令 helper:slash 选中后清除 / 跟 query
 *
 * commandRegistry 中的 slash 命令(setHeading 等)调用前先调此清除文本。
 */
export function clearSlashTrigger(view: EditorView): boolean {
  const state = slashPluginKey.getState(view.state);
  if (!state?.active) return false;
  const tr = view.state.tr.delete(state.triggerPos, view.state.selection.from);
  view.dispatch(tr);
  return true;
}
