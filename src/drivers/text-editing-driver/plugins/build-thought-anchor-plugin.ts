/**
 * thought-anchor plugin — 横切思考层 view-bridge(thought-view-port.md v0.5 §5.5)
 *
 * 负责三件事(driver 内只做"在 PM 内识别 anchor + 通知 view",所有跨槽 / capability
 * 调用走 callback 让 view 注入 — 同 link-click 模式):
 *
 * 1. **inline mark 点击** → 触发 onAnchorClick({ thoughtId, anchorType:'inline', pos })
 * 2. **node attr 点击**(image.thoughtId 非空)→ 触发 onAnchorClick({ thoughtId, anchorType:'node', pos })
 * 3. **block decoration** → 按 block.attrs.frameThoughtId 画外框装饰(色由 type meta 决定,
 *    type 由 callback resolveThoughtType 注入,driver 不 import capability)
 *
 * driver 边界:
 * - 不知道 thought atom 长什么样
 * - 不直接调 thought capability(charter §1.1 driver 不依赖 capability 运行时值)
 * - 只暴露 callback,等 view 注入
 *
 * 模式对齐:src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts(activeHandler)
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorView } from 'prosemirror-view';

export const thoughtAnchorKey = new PluginKey('thoughtAnchor');

export interface ThoughtAnchorClickPayload {
  thoughtId: string;
  /** 'inline' = mark / 'node' = image attr / 'block' = frameThoughtId(本期 click 仅前 2 种,
   *  block 由背景外框点击吃事件,语义仍是激活该 thought) */
  anchorType: 'inline' | 'node' | 'block';
  /** PM 内位置(view 用此 scroll/highlight) */
  pos: number;
}

export interface ThoughtAnchorHandler {
  /** 用户点击 anchor(mark/node/block frame)→ view 决定:开 right slot + 激活 ThoughtView 对应卡片 */
  onAnchorClick: (payload: ThoughtAnchorClickPayload) => void;
  /**
   * 给 driver 查 thought 类型(用于 decoration 颜色)— 同步(view 端有本地缓存,
   * 异步 IPC 不适合 decoration render 路径)。返 null 则用默认色。
   */
  resolveThoughtType?: (thoughtId: string) => string | null;
}

let activeHandler: ThoughtAnchorHandler | null = null;

export function setThoughtAnchorHandler(handler: ThoughtAnchorHandler | null): void {
  activeHandler = handler;
}

export function getThoughtAnchorHandler(): ThoughtAnchorHandler | null {
  return activeHandler;
}

/** 给定 EditorView 滚到指定 pos(thought scroll-to-anchor 时用) */
export function scrollToThoughtAnchor(view: EditorView, pos: number): void {
  if (pos < 0 || pos >= view.state.doc.content.size) return;
  const dom = view.nodeDOM(pos) ?? view.domAtPos(pos).node;
  if (dom instanceof HTMLElement) {
    dom.scrollIntoView({ behavior: 'smooth', block: 'center' });
    dom.classList.add('krig-thought-anchor-flash');
    window.setTimeout(() => dom.classList.remove('krig-thought-anchor-flash'), 1500);
  }
}

const NODE_ANCHOR_TYPES = new Set(['image']);

function buildBlockDecorations(view: EditorView): DecorationSet {
  const decorations: Decoration[] = [];
  view.state.doc.descendants((node, pos) => {
    const frameThoughtId = node.attrs.frameThoughtId as string | null | undefined;
    if (!frameThoughtId) return;
    // 用 NodeDecoration 给该 block 加 data-thought-block-id;color 通过 css var 注入
    const thoughtType = activeHandler?.resolveThoughtType?.(frameThoughtId) ?? 'thought';
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        'data-thought-block-id': frameThoughtId,
        'data-thought-type': thoughtType,
        class: 'krig-thought-block-frame',
      }),
    );
  });
  return DecorationSet.create(view.state.doc, decorations);
}

export function buildThoughtAnchorPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: thoughtAnchorKey,
    state: {
      init: (_, state) => {
        // init 时 view 还没装上(buildBlockDecorations 需 view.state.doc)。
        // 用空 set 起步,首次 view update 时重算。
        const decorations: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          const frameThoughtId = node.attrs.frameThoughtId as string | null | undefined;
          if (!frameThoughtId) return;
          const thoughtType = activeHandler?.resolveThoughtType?.(frameThoughtId) ?? 'thought';
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              'data-thought-block-id': frameThoughtId,
              'data-thought-type': thoughtType,
              class: 'krig-thought-block-frame',
            }),
          );
        });
        return DecorationSet.create(state.doc, decorations);
      },
      apply(tr, old) {
        // doc 变化时重算 decoration(简单策略 — block 不多,O(n) 可接受)
        if (!tr.docChanged) return old;
        const decorations: Decoration[] = [];
        tr.doc.descendants((node, pos) => {
          const frameThoughtId = node.attrs.frameThoughtId as string | null | undefined;
          if (!frameThoughtId) return;
          const thoughtType = activeHandler?.resolveThoughtType?.(frameThoughtId) ?? 'thought';
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              'data-thought-block-id': frameThoughtId,
              'data-thought-type': thoughtType,
              class: 'krig-thought-block-frame',
            }),
          );
        });
        return DecorationSet.create(tr.doc, decorations);
      },
    },
    props: {
      decorations(state) {
        return thoughtAnchorKey.getState(state);
      },
      handleClick(view, pos, event) {
        if (event.button !== 0) return false;

        // 1) inline mark 点击
        const $pos = view.state.doc.resolve(pos);
        const thoughtMarkType = view.state.schema.marks.thought;
        if (thoughtMarkType) {
          const mark = $pos.marks().find((m) => m.type === thoughtMarkType);
          if (mark) {
            const thoughtId = mark.attrs.thoughtId as string;
            if (thoughtId) {
              event.preventDefault();
              activeHandler?.onAnchorClick({ thoughtId, anchorType: 'inline', pos });
              return true;
            }
          }
        }

        // 2) node attr 点击(image 等)
        for (let d = $pos.depth; d >= 0; d--) {
          const node = $pos.node(d);
          if (NODE_ANCHOR_TYPES.has(node.type.name)) {
            const thoughtId = node.attrs.thoughtId as string | null;
            if (thoughtId) {
              event.preventDefault();
              activeHandler?.onAnchorClick({
                thoughtId,
                anchorType: 'node',
                pos: $pos.before(d),
              });
              return true;
            }
            break;
          }
        }

        // 3) block frame:暂不在 handleClick 拦截(用户点 block 内部正常文字应能 focus 进编辑);
        //    block frame 点击进 thought 通过 CSS hover + 工具栏按钮触发,或键盘命令 — 留 Phase 3.5

        return false;
      },
    },
    view() {
      return {
        update(view) {
          // resolveThoughtType 可能在初始化后才注入 → 重算一次 decoration 保证色对(简单兜底)
          const next = buildBlockDecorations(view);
          // PM 通过 state.apply 更新 decoration,这里仅用于 force-refresh 场景预留
          void next;
        },
      };
    },
  });
}
