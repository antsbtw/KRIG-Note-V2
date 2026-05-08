/**
 * paste-media plugin — 剪贴板图片粘贴(L5-B3.13)
 *
 * V1 → V2 直迁:src/plugins/note/plugins/paste-media.ts
 *
 * 行为:
 * - 检测 clipboardData.items 中第一个 image/* 文件
 * - HTML 含结构化标签(table / tr / th / td / h1-6)→ 让步给后续 handler
 *   (Word/Excel 通常会附带 PNG fallback,但真正想要的是结构化 HTML)
 *   — Phase E smart-paste 接入时本规则前向兼容,无需改本插件
 * - 同步:dataUrl 占位插入(用户立即看到图)
 * - 异步:mediaPutBase64 → 替换 src 为 media:// URL(刷新不丢);失败留 dataUrl
 *
 * 智能位置(对齐 V1):
 * - 当前在空 text-block(非 title)→ 替换为 image
 * - 否则在当前 block 之后插入(用 $from.depth 兼容 callout/blockquote 嵌套)
 *
 * V1 → V2 关键差异:
 * - 节点名 textBlock → 'text-block'(短横线)
 * - schema typed:schema.nodes.image.create({ src }, captionNode)
 * - L5-B3.11 isTitle 守卫:空 title 不可被替换(必须保留)
 * - mediaStore 异步落盘(对齐 image NodeView upload 路径)
 */

import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { mediaPutBase64 } from '@capabilities/media-storage';

/** 同步插入 image node 到光标位置 — 返回插入后 image 节点的 PM pos(给异步 setNodeAttribute 用)*/
function insertImageAtCursor(view: EditorView, imageNode: PMNode): number | null {
  const { state } = view;
  const { $from } = state.selection;

  // 用 $from.depth 兼容嵌套容器(callout / blockquote / table cell)
  const depth = Math.max(1, $from.depth);
  const blockPos = $from.before(depth);
  const blockNode = state.doc.nodeAt(blockPos);
  if (!blockNode) return null;

  let tr = state.tr;
  let insertedPos: number;

  if (
    blockNode.type.name === 'text-block' &&
    blockNode.textContent.length === 0 &&
    !blockNode.attrs.isTitle
  ) {
    // 空 text-block(非 title)→ 替换
    tr = tr.replaceWith(blockPos, blockPos + blockNode.nodeSize, imageNode);
    insertedPos = blockPos;
  } else {
    // 否则在当前 block 之后插入
    const afterPos = blockPos + blockNode.nodeSize;
    tr = tr.insert(afterPos, imageNode);
    insertedPos = afterPos;
  }

  view.dispatch(tr);
  return insertedPos;
}

export function buildPasteMediaPlugin(): Plugin {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const cd = event.clipboardData;
        const items = cd?.items;
        if (!cd || !items) return false;

        // 1. 找第一个 image/* 文件
        let imageFile: File | null = null;
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            imageFile = items[i].getAsFile();
            if (imageFile) break;
          }
        }
        if (!imageFile) return false;

        // 2. HTML 含结构化标签 → 让步(Word/Excel PNG fallback 场景)
        const html = cd.getData('text/html') || '';
        if (/<\s*(table|thead|tbody|tr|th|td|h[1-6])\b/i.test(html)) {
          return false;
        }

        // 3. schema 校验
        const { schema } = view.state;
        const imageType = schema.nodes.image;
        const textBlockType = schema.nodes['text-block'];
        if (!imageType || !textBlockType) return false;

        // 4. FileReader → dataUrl → 同步占位插入 + 异步落 mediaStore
        const file = imageFile; // 闭包捕获
        const reader = new FileReader();
        reader.onload = async () => {
          if (view.isDestroyed) return;
          const dataUrl = reader.result as string;
          if (!dataUrl) return;

          // 同步:占位插入(dataUrl)
          const captionNode = textBlockType.create();
          const tempImg = imageType.create({ src: dataUrl, alt: file.name }, captionNode);
          const insertedPos = insertImageAtCursor(view, tempImg);
          if (insertedPos == null) return;

          // 异步:落 mediaStore → 替换 src 为 media:// URL
          let r: Awaited<ReturnType<typeof mediaPutBase64>>;
          try {
            r = await mediaPutBase64(dataUrl, file.type, file.name);
          } catch (err) {
            console.warn('[paste-media] mediaPutBase64 threw:', err);
            return; // 留 dataUrl,session 内可见
          }
          if (view.isDestroyed) return;
          if (!r.success || !r.mediaUrl) {
            console.warn('[paste-media] mediaPutBase64 failed:', r.error);
            return; // 留 dataUrl
          }

          // setNodeAttribute 替换 src — pos 漂移用 try/catch 兜底
          // (用户在异步窗口期可能继续编辑,insertedPos 失效则忽略)
          try {
            const node = view.state.doc.nodeAt(insertedPos);
            if (node?.type.name !== 'image') return; // pos 已漂移到非 image
            const tr = view.state.tr.setNodeAttribute(insertedPos, 'src', r.mediaUrl);
            tr.setMeta('addToHistory', false); // 替换不记入 history(用户认为是同一次粘贴)
            view.dispatch(tr);
          } catch (err) {
            console.warn('[paste-media] setNodeAttribute failed (pos drift?):', err);
          }
        };
        reader.readAsDataURL(file);

        // 5. 阻止 PM 默认粘贴(我们已经接管)
        return true;
      },
    },
  });
}
