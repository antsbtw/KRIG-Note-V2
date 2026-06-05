/**
 * bottom-pad plugin — 文档末尾"空白尾区"交互(NoteView 专属)
 *
 * 三个能力(对齐用户需求 2026-06-05):
 * 1. 底部留白 —— 由 pm-host.css `.krig-pm-host.krig-pm-host--bottom-pad .ProseMirror`
 *    的 `padding-bottom` 提供(滚动到底时正文仍有呼吸空间、handle/光标不贴边)。
 *    本 plugin 只在 NoteView 装,故由 plugin 给 view.dom 打 class,避免 CSS 影响
 *    Thought 等单段编辑器。
 * 2. 双击底部空白处 —— 在文档末尾追加一个空 paragraph 并把光标放进去。
 *    判定:双击落点的 PM 文档坐标解析到最后一个 block 之后(即 padding/空白区),
 *    或干脆落在最后一个 block 内但已是空末段时直接聚焦它。
 * 3. 无光标(view 未聚焦)时按 Enter —— 同样在末尾追加空 paragraph 并聚焦。
 *    PM 在 view 没 focus 时收不到 keydown,故 Enter 兜底挂在 view.dom 的原生
 *    capture 监听(本 plugin 的 view() lifecycle 里挂/卸)。
 *
 * 复用既有"插段并定位"范式(见 blocks/image/keymap.ts):
 *   tr.insert(end, paragraph.create()) → TextSelection.create(tr.doc, end+1) → focus。
 *
 * **接入**:仅 NoteView(editor-view-builder 按 viewId === 'note-view' 守门),
 * 避免破坏 Thought 卡片"一卡一段"语义。
 */

import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

export const bottomPadKey = new PluginKey('text-editing-driver:bottom-pad');

/**
 * 在文档末尾追加一个空 paragraph,光标落入。
 * 若末段已是空 paragraph(非 title),则不新增,直接把光标放进去(避免堆一串空段)。
 */
function appendOrFocusTrailingParagraph(view: EditorView): boolean {
  const { state } = view;
  const paragraphType = state.schema.nodes.paragraph;
  if (!paragraphType) return false;

  const doc = state.doc;
  const lastChild = doc.lastChild;

  // 末段已是空普通 paragraph → 不新增,直接聚焦它(光标落到段内)
  if (
    lastChild &&
    lastChild.type.name === 'paragraph' &&
    !lastChild.attrs.isTitle &&
    lastChild.content.size === 0
  ) {
    const posInside = doc.content.size - 1; // 末段开 token 之后 = 段内
    const tr = state.tr
      .setSelection(TextSelection.create(doc, posInside))
      .scrollIntoView();
    view.dispatch(tr);
    view.focus();
    return true;
  }

  // 否则在 doc 末尾追加一个空 paragraph,光标落入新段
  const end = doc.content.size;
  const para = paragraphType.create();
  let tr = state.tr.insert(end, para);
  tr = tr.setSelection(TextSelection.create(tr.doc, end + 1)).scrollIntoView();
  view.dispatch(tr);
  view.focus();
  return true;
}

export function buildBottomPadPlugin(): Plugin {
  return new Plugin({
    key: bottomPadKey,

    view(editorView) {
      // 底部留白由 CSS 控制,只对挂了本 plugin 的 view(= NoteView)生效
      editorView.dom.classList.add('krig-pm-bottom-pad');

      // 无光标(view 未聚焦)时 Enter 兜底 —— PM 在 view 失焦时收不到 keydown,
      // 故挂原生 capture 监听。view 已聚焦的 Enter 不归本路径(交给 PM baseKeymap)。
      const onKeyDown = (e: KeyboardEvent): void => {
        if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
        if (editorView.hasFocus()) return; // 有光标 → 让 PM 正常处理
        e.preventDefault();
        appendOrFocusTrailingParagraph(editorView);
      };
      // 容器(.krig-pm-host)而非 view.dom —— 失焦时焦点可能在容器或其祖先上;
      // 挂在 host 容器能覆盖"点了空白区但没落到任何 block"的情形。
      const host = editorView.dom.parentElement ?? editorView.dom;
      host.addEventListener('keydown', onKeyDown, true);

      return {
        destroy() {
          host.removeEventListener('keydown', onKeyDown, true);
          editorView.dom.classList.remove('krig-pm-bottom-pad');
        },
      };
    },

    props: {
      /**
       * 双击 —— 落点在最后一个 block 之下(底部留白/空白尾区)时,追加空段并聚焦。
       * 落在正文 block 内/上的双击不拦(返回 false → PM 默认选词)。
       *
       * 判定用"点击 Y 是否在最后一个 block 的 DOM 底边之下":比单纯比 pos 更稳
       * —— PM 对底部 padding 内的点击,posAtCoords 常 clamp 到末段段内(pos <
       * content.size),只比 pos 会漏判。
       */
      handleDoubleClick(view, _pos, event) {
        const doc = view.state.doc;
        if (doc.childCount === 0) return appendOrFocusTrailingParagraph(view);

        // 最后一个顶层 block 的渲染起始 pos → nodeDOM → 底边 y
        const lastIndex = doc.childCount - 1;
        let lastPos = 0;
        for (let i = 0; i < lastIndex; i++) lastPos += doc.child(i).nodeSize;
        const dom = view.nodeDOM(lastPos) as HTMLElement | null;
        if (!dom || typeof dom.getBoundingClientRect !== 'function') {
          // 拿不到 DOM 兜底:仅当 pos 抵达 doc 末尾才接管
          return appendOrFocusTrailingParagraph(view);
        }
        const bottom = dom.getBoundingClientRect().bottom;
        // 点击在末块底边之下 → 空白尾区,接管;否则交给 PM 选词
        if (event.clientY <= bottom) return false;
        return appendOrFocusTrailingParagraph(view);
      },
    },
  });
}
