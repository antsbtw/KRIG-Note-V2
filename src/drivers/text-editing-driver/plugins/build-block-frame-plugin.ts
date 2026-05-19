/**
 * block-frame plugin — 用户主动框定 block 的边框装饰
 *
 * 读 node attrs (frameColor/frameStyle/frameGroupId) 生成 node decoration,
 * 给框定的 block 加 `krig-block-frame` 类 + CSS 变量,样式细节走 CSS。
 *
 * 与 thought-anchor 的 block frame 区别:
 * - thought-anchor 走 frameThoughtId(系统派生),class `krig-thought-block-frame`
 * - 本 plugin 走 frameColor(用户主动),class `krig-block-frame`
 * 两者可同时存在(同一 block 同时是 thought anchor 又被用户框定),CSS 各自渲染。
 *
 * 分组规则(对齐 V1):
 * - 无 frameGroupId:单块 `only`(四边完整圆角框)
 * - 有 frameGroupId:多块共享 groupId 视为一组,首/中/尾 上下边连成整体
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

export const blockFramePluginKey = new PluginKey('blockFrame');

interface FramedBlock {
  pos: number;
  size: number;
  color: string;
  style: string;
  groupId: string | null;
}

function buildDecorations(doc: PMNode): DecorationSet {
  const framed: FramedBlock[] = [];
  doc.forEach((node, offset) => {
    if (!node.isBlock) return;
    const frameColor = node.attrs.frameColor as string | null;
    if (!frameColor) return;
    framed.push({
      pos: offset,
      size: node.nodeSize,
      color: frameColor,
      style: (node.attrs.frameStyle as string | null) || 'solid',
      groupId: (node.attrs.frameGroupId as string | null) || null,
    });
  });

  if (framed.length === 0) return DecorationSet.empty;

  const groups = new Map<string, FramedBlock[]>();
  const ungrouped: FramedBlock[] = [];
  for (const fb of framed) {
    if (fb.groupId) {
      const list = groups.get(fb.groupId) ?? [];
      list.push(fb);
      groups.set(fb.groupId, list);
    } else {
      ungrouped.push(fb);
    }
  }

  const decos: Decoration[] = [];

  for (const fb of ungrouped) {
    decos.push(
      Decoration.node(fb.pos, fb.pos + fb.size, {
        class: 'krig-block-frame krig-block-frame--only',
        style: `--krig-frame-color: ${fb.color}; --krig-frame-style: ${fb.style};`,
      }),
    );
  }

  for (const blocks of groups.values()) {
    // group 内已经按 pos 升序(forEach 顺序)
    const count = blocks.length;
    const color = blocks[0].color;
    const style = blocks[0].style;
    blocks.forEach((fb, i) => {
      let pos: 'only' | 'first' | 'middle' | 'last';
      if (count === 1) pos = 'only';
      else if (i === 0) pos = 'first';
      else if (i === count - 1) pos = 'last';
      else pos = 'middle';
      decos.push(
        Decoration.node(fb.pos, fb.pos + fb.size, {
          class: `krig-block-frame krig-block-frame--${pos}`,
          style: `--krig-frame-color: ${color}; --krig-frame-style: ${style};`,
        }),
      );
    });
  }

  return DecorationSet.create(doc, decos);
}

export function buildBlockFramePlugin(): Plugin {
  return new Plugin({
    key: blockFramePluginKey,
    state: {
      init(_, state) {
        return buildDecorations(state.doc);
      },
      apply(tr, value, _oldState, newState) {
        if (!tr.docChanged) return value;
        return buildDecorations(newState.doc);
      },
    },
    props: {
      decorations(state) {
        return blockFramePluginKey.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}
