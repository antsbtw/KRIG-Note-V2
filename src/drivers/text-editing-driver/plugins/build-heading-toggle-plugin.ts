/**
 * heading-toggle — h1~h6 行内折叠三角(▸/▾)
 *
 * 折叠**逻辑**不在这里 —— 它早已完整实现在 build-heading-collapse-plugin.ts。
 * 本 plugin 只提供「行内可点的入口」:在标题左侧画一个三角,点它调 toggle。
 *
 * 模式:widget decoration(每个可折叠 heading 一个),不是浮动单例 —
 *   与 block-handle 的浮动 ⋮⋮ 不同,三角要**跟着标题走**(折叠态常驻可见,
 *   滚动/换行都不能错位),widget 由 PM 自己维护位置最稳。
 *
 * 显示规则(对齐 Notion):
 *   - 展开态:hover 标题所在行才显形(常驻符号干扰阅读)
 *   - 折叠态:⭐ 常驻可见 —— 否则「哪些标题被折叠了」一眼看不出来
 *   - 下面没内容的标题:不画三角(显了是骗人 → hasCollapsibleContent)
 *
 * ⚠️ 折叠状态存哪不归本 plugin 管:读/写都走 CollapseSource(下面),
 * 默认实现指向既有 plugin state。下一轮 mind 映射要接「持久折叠」时,
 * 换一个 source 注入即可,不用动这里的渲染/交互。
 * (本轮**不实现**那个注入 —— 只是别把路堵死。)
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { EditorState } from 'prosemirror-state';
import {
  hasCollapsibleContent,
  isHeadingCollapsed,
  toggleHeadingCollapse,
} from './build-heading-collapse-plugin';

const headingToggleKey = new PluginKey('text-editing-driver:heading-toggle');

export const HEADING_TOGGLE_CLASS = 'krig-heading-toggle';

/**
 * 折叠状态的读/写接口 —— ⭐ 可替换点(见文件头 §6 说明)。
 * 默认实现读写 heading-collapse plugin state;mind 那边将来可换成读写 G 层。
 */
export interface CollapseSource {
  isCollapsed(state: EditorState, pos: number): boolean;
  toggle(view: EditorView, pos: number): void;
}

const pluginStateCollapseSource: CollapseSource = {
  isCollapsed: isHeadingCollapsed,
  toggle: toggleHeadingCollapse,
};

/** widget DOM:一个 contentEditable=false 的三角按钮 */
function renderToggle(collapsed: boolean, onClick: () => void): HTMLElement {
  const el = document.createElement('span');
  el.className = HEADING_TOGGLE_CLASS + (collapsed ? ` ${HEADING_TOGGLE_CLASS}--collapsed` : '');
  el.contentEditable = 'false';
  el.setAttribute('role', 'button');
  el.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  el.title = collapsed ? '展开' : '折叠';
  // 字符由 CSS ::before 出(▸/▾ 随 --collapsed 切),DOM 只负责状态与点击
  el.addEventListener('mousedown', (e) => {
    // preventDefault:不让点击抢走编辑器选区(否则光标会跳到标题里)
    e.preventDefault();
    e.stopPropagation();
  });
  el.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return el;
}

export function buildHeadingTogglePlugin(source: CollapseSource = pluginStateCollapseSource): Plugin {
  return new Plugin({
    key: headingToggleKey,
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];
        state.doc.forEach((node, pos) => {
          if (node.type.name !== 'heading') return;
          // 没内容可折 → 不画三角
          if (!hasCollapsibleContent(state.doc, pos)) return;
          const collapsed = source.isCollapsed(state, pos);
          decorations.push(
            // side: -1 → widget 排在 heading 内容之前
            Decoration.widget(
              pos + 1,
              (view) => renderToggle(collapsed, () => source.toggle(view, pos)),
              {
                side: -1,
                // key 参与 widget 复用判定 —— 必须同时含 pos 与状态:
                //   缺状态 → 折叠/展开时 DOM 被复用,▸/▾ 不切
                //   缺 pos  → 同状态的两个标题 widget 互相复用,点击闭包串到别的标题上
                key: `heading-toggle:${pos}:${collapsed ? 'c' : 'o'}`,
                // 三角不是文档内容:不进选区、不被拷贝、不参与 PM 的位置映射语义
                ignoreSelection: true,
              },
            ),
          );
          // 给 heading 自身打标记:CSS 靠它给标题留出三角的位置 + hover 显形
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, { class: 'has-heading-toggle' }),
          );
        });
        return decorations.length ? DecorationSet.create(state.doc, decorations) : null;
      },
    },
  });
}
