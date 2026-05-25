/**
 * EBookView ContextMenu 注册(PR-α-3b 修订:legacy reading-thought-block 路径)
 *
 * 架构(handoff §α-3b 拍板):
 *   - 标注 = 纯视觉(framing ▢ / 文字流 ✎),落 legacy reading-thought-block
 *   - **无独立 thought atom**,id = bookAnchor.createdAt 字面串
 *   - 5 项右键菜单全部走 legacy API + thought capability(只在 💭 加思考 时创建 thought)
 *
 * 5 项菜单:
 *   💭 加思考       → lib.getReadingThoughtBlock(bookId, id) 拿 bookAnchor →
 *                    bookAnchor → BookLocator 转换 → thoughtApi.createThought(anchor=book) →
 *                    召唤右槽 thought-view + activate 新卡片
 *   🤖 问 AI        → 占位 stub(同 α-2)
 *   🎨 改颜色 ▸     → submenu render AnnotationTypeSubmenu(5 色 → lib.updateReadingThoughtBlockColor)
 *   📸 截图复制     → lib.getReadingThoughtBlock 拿 thumbnail → 剪贴板
 *   🗑 删除标注     → lib.removeReadingThoughtBlock(bookId, id)
 */

import { createElement } from 'react';
import { contextMenuRegistry } from '@slot/interaction-registries/context-menu-registry/context-menu-registry';
import { contextInfoProviderRegistry } from '@slot/interaction-registries/context-info-provider-registry';
import { enabledWhenRegistry } from '@slot/interaction-registries/enabled-when-registry';
import { contextMenuController } from '@slot/triggers/context-menu-controller';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  EBookLibraryApi,
  BookAnchor,
} from '@capabilities/ebook-library/types';
import type {
  ThoughtCapabilityApi,
  BookLocator,
} from '@capabilities/thought/types';
import type { MediaStorageApi } from '@capabilities/media-storage/types';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { getEBookWsState } from './data-model';
import { AnnotationTypeSubmenu } from './AnnotationTypeSubmenu';

const VIEW = 'ebook-view';

/** 从 context.custom.pdfAnnotationId 读 id(= bookAnchor.createdAt 字符串) */
function getPdfAnnotationId(): string | null {
  const raw = contextMenuController.getState().context.custom.pdfAnnotationId;
  return typeof raw === 'string' ? raw : null;
}

/** 取当前 active bookId(legacy 路径所有操作都需要) */
function getActiveBookId(): string | null {
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return null;
  const ws = workspaceManager.get(wsId);
  if (!ws) return null;
  const state = getEBookWsState(ws);
  return state?.activeBookId ?? null;
}

/** BookAnchor (legacy) → BookLocator (thought atom),用于 💭 加思考创建 thought */
function bookAnchorToLocator(anchor: BookAnchor): BookLocator {
  return {
    pageNum: anchor.pageNum,
    rect: anchor.rect,
    textRects: anchor.textRects,
    cfi: anchor.cfi,
    textContent: anchor.textContent,
    thumbnail: anchor.thumbnail,
    markStyle: anchor.type,
    createdAt: anchor.createdAt,
  };
}

/**
 * dataUrl(base64 jpeg)→ PNG blob → ClipboardItem(剪贴板)
 *
 * ClipboardItem 跨浏览器仅稳支持 image/png;走 canvas 中转 JPEG → PNG。
 */
async function copyDataUrlToClipboard(dataUrl: string): Promise<void> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const cx = canvas.getContext('2d');
  if (!cx) throw new Error('2d context unavailable');
  cx.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png');
  });
  if (!blob) throw new Error('canvas toBlob returned null');
  await navigator.clipboard.write([
    new ClipboardItem({ 'image/png': blob }),
  ]);
}

export function registerContextMenu(): void {
  // ── 1. contextInfoProvider ──
  contextInfoProviderRegistry.register({
    id: 'ebook',
    provider: (target: HTMLElement) => {
      const el = target.closest('[data-pdf-annotation-id]');
      const pdfAnnotationId = el?.getAttribute('data-pdf-annotation-id') ?? null;
      return { pdfAnnotationId };
    },
  });

  // ── 2. enabledWhen predicate ──
  enabledWhenRegistry.register(
    'has-pdf-annotation',
    (ctx) => !!ctx.custom.pdfAnnotationId,
  );

  // ── 3. 命令注册 ──

  /**
   * 💭 加思考 — 把"纯视觉标注"升级:创建用户 thought atom + anchor 指向 highlight
   *   (legacy block.bookAnchor → thought.anchor.locator),然后召唤右槽 + activate 新卡片。
   * 不删 legacy block — highlight 继续显示在 PDF;thought 卡片显示在右槽。
   */
  commandRegistry.register('ebook-view.add-thought-from-annotation', () => {
    const id = getPdfAnnotationId();
    if (!id) return;
    const bookId = getActiveBookId();
    if (!bookId) return;
    void (async () => {
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
      const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
      const createdAt = Number(id);
      const bookAnchor = await lib.getReadingThoughtBlock(bookId, createdAt);
      if (!bookAnchor) {
        console.warn('[ebook-view.add-thought] anchor not found', id);
        return;
      }
      const locator = bookAnchorToLocator(bookAnchor);

      // 摘要分支(2026-05-25 用户拍板):按 bookAnchor.type 二选一,不同时出现
      // - 框选 'rect':doc 第一行 = image 节点(thumbnail 上传 mediaStorage → mediaUrl)
      // - 文字流 'highlight' / 'strikethrough':doc 第一行 = paragraph 含 textContent
      //   (用户标的就是这段文字,直接放进 doc 起点,下面写笔记)
      const docContent: Array<Record<string, unknown>> = [];
      const isFramedScreenshot = bookAnchor.type === 'rect' && bookAnchor.thumbnail;
      const isTextFlow =
        bookAnchor.type === 'highlight' || bookAnchor.type === 'strikethrough';

      if (isFramedScreenshot) {
        let imageMediaUrl: string | null = null;
        try {
          const mediaApi = requireCapabilityApi<MediaStorageApi>('media-storage');
          const r = await mediaApi.mediaPutBase64(
            bookAnchor.thumbnail!,
            'image/jpeg',
            `pdf-anchor-${createdAt}.jpg`,
          );
          if (r.success && r.mediaUrl) imageMediaUrl = r.mediaUrl;
        } catch (err) {
          console.warn('[ebook-view.add-thought] mediaPutBase64 failed:', err);
        }
        if (imageMediaUrl) {
          docContent.push({
            type: 'image',
            attrs: { src: imageMediaUrl, alignment: 'center' },
          });
        }
      } else if (isTextFlow && bookAnchor.textContent) {
        docContent.push({
          type: 'paragraph',
          content: [{ type: 'text', text: bookAnchor.textContent }],
        });
      }

      // 用户笔记起手 paragraph(总在最后,方便用户直接键入)
      docContent.push({ type: 'paragraph' });

      const t = await thoughtApi.createThought({
        type: 'thought',
        resolved: false,
        pinned: false,
        thumbnail: bookAnchor.thumbnail,
        doc: {
          format: 'pm-doc-json',
          version: '0.1',
          payload: { type: 'doc', content: docContent },
        },
        folderId: null,
        anchor: { source: 'book', resourceId: bookId, locator },
      });
      const wsId = workspaceManager.getActiveId();
      const bus = wsId ? workspaceManager.getBus(wsId) : null;
      if (bus) {
        bus.slot.openRight('thought-view');
        // 跳到标注所在页(双屏 paged 模式右槽 thought-view 打开后会自动收成单页;
        // 若 currentPage 仍是左页,用户标注的右页会被挤出视野。emit
        // scroll-to-book-source 让 EBookView 触发 host.goToPage,把 currentPage
        // 切到 bookAnchor.pageNum)
        bus.channels.emit('thought.scroll-to-book-source', {
          bookId,
          pageNum: bookAnchor.pageNum,
          thoughtId: t.id,
          emittedAt: Date.now(),
        });
        bus.channels.emit('thought.activate', {
          thoughtId: t.id,
          anchor: t.anchor,
          emittedAt: Date.now(),
        });
      }
    })();
  });

  /** 🤖 问 AI(占位 — 等 AIView 支持 image input) */
  commandRegistry.register('ebook-view.ask-ai-from-annotation', () => {
    console.info('[ebook-view.ask-ai] 占位 — 待 AIView 支持 image input 后实装');
  });

  /**
   * 双击标注 → activate 关联 thought(召唤右槽 + 滚动锚定到卡片)。
   *
   * 流程:扫 listThoughtsBySource('book', bookId) 找 anchor.locator.createdAt 匹配的
   * thought atom → 有则 openRight + emit 'thought.activate'(ThoughtView 自动滚卡 + 高亮)。
   * 没找到 → 静默 return(标注未升级到 thought,双击无反应;用户需先右键 💭 加思考)。
   *
   * 参数:annotationId(= bookAnchor.createdAt 字符串)直接传入。
   * 不从 contextMenuController 取(双击事件不走右键菜单)。
   */
  commandRegistry.register(
    'ebook-view.activate-thought-from-annotation',
    (arg: unknown) => {
      if (typeof arg !== 'string') return;
      const bookId = getActiveBookId();
      if (!bookId) return;
      const createdAt = Number(arg);
      void (async () => {
        const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
        const thoughts = await thoughtApi.listThoughtsBySource('book', bookId);
        const matched = thoughts.find(
          (t) =>
            t.anchor?.source === 'book' &&
            (t.anchor.locator as BookLocator).createdAt === createdAt,
        );
        if (!matched || !matched.anchor) return; // 无关联 thought / 无 anchor,双击 no-op
        const wsId = workspaceManager.getActiveId();
        const bus = wsId ? workspaceManager.getBus(wsId) : null;
        if (bus) {
          bus.slot.openRight('thought-view');
          // 同 add-thought:双屏 paged 模式右槽打开会收成单页,需跳到标注所在页
          // 避免用户双击的右页被挤出视野
          const loc = matched.anchor.locator as BookLocator;
          bus.channels.emit('thought.scroll-to-book-source', {
            bookId,
            pageNum: loc.pageNum,
            thoughtId: matched.id,
            emittedAt: Date.now(),
          });
          bus.channels.emit('thought.activate', {
            thoughtId: matched.id,
            anchor: matched.anchor,
            emittedAt: Date.now(),
          });
        }
      })();
    },
  );

  /**
   * 📸 截图复制 — 读 bookAnchor.thumbnail base64 → ClipboardItem(image/png)。
   * 文字流标注无 thumbnail → warn + no-op。
   */
  commandRegistry.register('ebook-view.copy-annotation-screenshot', () => {
    const id = getPdfAnnotationId();
    if (!id) return;
    const bookId = getActiveBookId();
    if (!bookId) return;
    void (async () => {
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
      const createdAt = Number(id);
      const bookAnchor = await lib.getReadingThoughtBlock(bookId, createdAt);
      if (!bookAnchor) {
        console.warn('[ebook-view.copy-screenshot] anchor not found', id);
        return;
      }
      if (!bookAnchor.thumbnail) {
        console.warn('[ebook-view.copy-screenshot] no thumbnail(文字流标注不含截图)');
        return;
      }
      try {
        await copyDataUrlToClipboard(bookAnchor.thumbnail);
      } catch (err) {
        console.error('[ebook-view.copy-screenshot] clipboard write failed', err);
      }
    })();
  });

  /** 🗑 删除标注 — 走 legacy removeReadingThoughtBlock(createdAt key) */
  commandRegistry.register('ebook-view.delete-pdf-annotation', () => {
    const id = getPdfAnnotationId();
    if (!id) return;
    const bookId = getActiveBookId();
    if (!bookId) return;
    const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
    void lib.removeReadingThoughtBlock(bookId, id);
  });

  // ── 4. ContextMenu items(5 项,顺序与 α-2 一致)──
  contextMenuRegistry.register([
    {
      id: 'ebook-view.cm.add-thought',
      label: '💭 加思考',
      command: 'ebook-view.add-thought-from-annotation',
      view: VIEW,
      enabledWhen: 'has-pdf-annotation',
      group: 'thought',
      order: 10,
    },
    {
      id: 'ebook-view.cm.ask-ai',
      label: '🤖 问 AI',
      command: 'ebook-view.ask-ai-from-annotation',
      view: VIEW,
      enabledWhen: 'has-pdf-annotation',
      group: 'thought',
      order: 20,
    },
    {
      id: 'ebook-view.cm.change-color',
      label: '🎨 改颜色',
      command: '',
      submenuId: 'ebook-annotation-type',
      submenuRender: (ctx) =>
        createElement(AnnotationTypeSubmenu, { ctx }),
      view: VIEW,
      enabledWhen: 'has-pdf-annotation',
      group: 'thought',
      order: 30,
    },
    {
      id: 'ebook-view.cm.copy-screenshot',
      label: '📸 截图复制',
      command: 'ebook-view.copy-annotation-screenshot',
      view: VIEW,
      enabledWhen: 'has-pdf-annotation',
      group: 'clipboard',
      order: 40,
    },
    {
      id: 'ebook-view.cm.delete',
      label: '🗑 删除标注',
      command: 'ebook-view.delete-pdf-annotation',
      view: VIEW,
      enabledWhen: 'has-pdf-annotation',
      group: 'destructive',
      order: 90,
    },
  ]);
}
