/**
 * EPUB 选区/标注 ContextMenu 注册(PR-α-3b followup 2026-05-25)
 *
 * 用户拍板:EPUB 标注操作全面对齐 PDF α-2/α-3b 注册式右键菜单。
 * 自动弹 picker 已废除,所有操作走 L4 contextMenuRegistry。
 *
 * 注册内容:
 *
 * 1. contextInfoProvider 'epub'
 *    EPUB iframe contextmenu 在 EBookView 收到回调 → contextMenuController.show
 *    时直接把 epubSelectionText / epubSelectionCfi / epubAnnotationCfi 写入 ContextInfo.custom;
 *    本 provider **不再 closest 检测**(EPUB DOM 在 iframe 内,L4 trigger 无法访问),
 *    custom 字段已由 EBookView 注入。
 *
 * 2. enabledWhen predicates:
 *    - 'has-epub-text-selection' — 选区文本非空 + cfi 存在(未标注的选区)
 *    - 'has-epub-annotation' — 右键 target 命中已有标注(epubAnnotationCfi 非空)
 *
 * 3. ContextMenu items(对齐用户截图设计):
 *    选区上:🖍 高亮 ▸ / 💭 加思考 ▸ / 🤖 问 AI / 📋 复制
 *    已标注上:💭 加思考 / 🤖 问 AI / 🎨 改颜色 ▸ / 📋 复制 / 🗑 删除标注
 *
 * 4. 命令(走 lib.addReadingThoughtBlock 直接落,无中间 hook 依赖):
 *    - ebook-view.epub-highlight                 创建高亮(只 legacy block)
 *    - ebook-view.epub-add-thought-from-selection 创建 thought + legacy + 召唤右槽
 *    - ebook-view.epub-add-thought-from-annotation 已有标注升级 thought + 召唤右槽
 *    - ebook-view.epub-ask-ai                    占位 stub
 *    - ebook-view.epub-copy                       clipboard.writeText
 *    - ebook-view.epub-delete-annotation          删 legacy + thought + host.removeHighlight
 *    - ebook-view.activate-thought-from-epub-annotation  双击 activate(双击 handler 调)
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
import type { LearningApi } from '@capabilities/learning/types';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import {
  THOUGHT_TYPE_META,
  USER_THOUGHT_TYPES,
  type ThoughtType,
} from '@shared/ipc/thought-types';
import { getEBookWsState } from './data-model';
import { EpubColorSubmenu } from './EpubColorSubmenu';

const VIEW = 'ebook-view';

function ctx(): {
  text: string;
  cfi: string | null;
  annotationCfi: string | null;
} {
  const custom = contextMenuController.getState().context.custom;
  return {
    text: typeof custom.epubSelectionText === 'string' ? custom.epubSelectionText : '',
    cfi: typeof custom.epubSelectionCfi === 'string' ? custom.epubSelectionCfi : null,
    annotationCfi:
      typeof custom.epubAnnotationCfi === 'string' ? custom.epubAnnotationCfi : null,
  };
}

function getActiveBookId(): string | null {
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return null;
  const ws = workspaceManager.get(wsId);
  if (!ws) return null;
  const state = getEBookWsState(ws);
  return state?.activeBookId ?? null;
}

/** 从 cfi 查 EPUB legacy bookAnchor(用于改色 / 加思考升级时取 createdAt 与现有字段) */
async function findEpubAnchorByCfi(
  bookId: string,
  cfi: string,
): Promise<BookAnchor | null> {
  const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
  const anchors = await lib.getReadingThoughtAnnotations(bookId);
  return anchors.find((a) => a.type === 'highlight' && a.cfi === cfi) ?? null;
}

/** 从 cfi 查关联 thought(已升级的标注) */
async function findEpubThoughtByCfi(bookId: string, cfi: string) {
  const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
  const thoughts = await thoughtApi.listThoughtsBySource('book', bookId);
  return (
    thoughts.find(
      (t) =>
        t.anchor?.source === 'book' &&
        (t.anchor.locator as BookLocator).cfi === cfi,
    ) ?? null
  );
}

export function registerEpubContextMenu(): void {
  // ── 1. contextInfoProvider(占位 — 实际字段由 EBookView 注入)──
  // 注:EPUB iframe 内 contextmenu 不冒泡到 EBookView body,L4 trigger 收不到,
  // EBookView 直接调 contextMenuController.show 注入 custom.epub* 字段。
  // 这里 provider 不主动检测,仅占位(保证 provider 注册存在;未来若 EBookView 路径
  // 改回 trigger 模式可填实)。
  contextInfoProviderRegistry.register({
    id: 'epub',
    provider: () => ({}),
  });

  // ── 2. enabledWhen predicates ──
  enabledWhenRegistry.register(
    'has-epub-text-selection',
    (c) =>
      typeof c.custom.epubSelectionText === 'string' &&
      c.custom.epubSelectionText.length > 0 &&
      !c.custom.epubAnnotationCfi, // 未标注的选区(标注上选完 cfi 仍存在,但要走 has-epub-annotation)
  );
  enabledWhenRegistry.register(
    'has-epub-annotation',
    (c) =>
      typeof c.custom.epubAnnotationCfi === 'string' &&
      c.custom.epubAnnotationCfi.length > 0,
  );

  // ── 3. 命令注册 ──

  /** 🖍 高亮 — 选区上 / submenu 选色 → 落 legacy block,不创 thought atom */
  commandRegistry.register('ebook-view.epub-highlight', (arg: unknown) => {
    const type = typeof arg === 'string' ? (arg as ThoughtType) : 'thought';
    const { cfi, text } = ctx();
    if (!cfi || !text) return;
    const bookId = getActiveBookId();
    if (!bookId) return;
    void (async () => {
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
      const color = THOUGHT_TYPE_META[type].color;
      const createdAt = Date.now();
      const bookAnchor: BookAnchor = {
        pageNum: 0,
        cfi,
        textContent: text,
        color,
        type: 'highlight',
        createdAt,
      };
      await lib.addReadingThoughtBlock(bookId, {
        type: 'blockquote',
        bookAnchor,
        textContent: text,
      });
      // host 高亮由 onListChanged 触发 hook refresh(addReadingThoughtBlock 内 broadcast)
    })();
  });

  /** 💭 加思考(选区上) — 落 legacy + 创 thought + 召唤右槽 */
  commandRegistry.register('ebook-view.epub-add-thought-from-selection', (arg: unknown) => {
    const type = typeof arg === 'string' ? (arg as ThoughtType) : 'thought';
    const { cfi, text } = ctx();
    if (!cfi || !text) return;
    const bookId = getActiveBookId();
    if (!bookId) return;
    void (async () => {
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
      const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
      const color = THOUGHT_TYPE_META[type].color;
      const createdAt = Date.now();
      const bookAnchor: BookAnchor = {
        pageNum: 0,
        cfi,
        textContent: text,
        color,
        type: 'highlight',
        createdAt,
      };
      await lib.addReadingThoughtBlock(bookId, {
        type: 'blockquote',
        bookAnchor,
        textContent: text,
      });
      const locator: BookLocator = {
        pageNum: 0,
        cfi,
        textContent: text,
        markStyle: 'highlight',
        createdAt,
      };
      const t = await thoughtApi.createThought({
        type,
        resolved: false,
        pinned: false,
        doc: {
          format: 'pm-doc-json',
          version: '0.1',
          payload: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: text ? [{ type: 'text', text }] : undefined,
              },
            ],
          },
        },
        folderId: null,
        anchor: { source: 'book', resourceId: bookId, locator },
      });
      const wsId = workspaceManager.getActiveId();
      const bus = wsId ? workspaceManager.getBus(wsId) : null;
      if (bus) {
        bus.slot.openRight('thought-view');
        bus.channels.emit('thought.activate', {
          thoughtId: t.id,
          anchor: t.anchor,
          emittedAt: Date.now(),
        });
        // PR-α-3b followup fix:右槽打开 → EPUB 主区被挤压重排,刚标注的 cfi 可能滑出当前页。
        // 重定位回标注位置,对齐 PDF α-3b 的 scroll-to-book-source 行为。
        bus.channels.emit('thought.scroll-to-book-source', {
          bookId,
          cfi,
          emittedAt: Date.now(),
        });
      }
    })();
  });

  /** 💭 加思考(已标注上) — 升级到 thought,复用 bookAnchor */
  commandRegistry.register('ebook-view.epub-add-thought-from-annotation', () => {
    const { annotationCfi } = ctx();
    if (!annotationCfi) return;
    const bookId = getActiveBookId();
    if (!bookId) return;
    void (async () => {
      const bookAnchor = await findEpubAnchorByCfi(bookId, annotationCfi);
      if (!bookAnchor) return;
      const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
      const locator: BookLocator = {
        pageNum: 0,
        cfi: bookAnchor.cfi!,
        textContent: bookAnchor.textContent,
        markStyle: 'highlight',
        createdAt: bookAnchor.createdAt,
      };
      const t = await thoughtApi.createThought({
        type: 'thought',
        resolved: false,
        pinned: false,
        doc: {
          format: 'pm-doc-json',
          version: '0.1',
          payload: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: bookAnchor.textContent
                  ? [{ type: 'text', text: bookAnchor.textContent }]
                  : undefined,
              },
            ],
          },
        },
        folderId: null,
        anchor: { source: 'book', resourceId: bookId, locator },
      });
      const wsId = workspaceManager.getActiveId();
      const bus = wsId ? workspaceManager.getBus(wsId) : null;
      if (bus) {
        bus.slot.openRight('thought-view');
        bus.channels.emit('thought.activate', {
          thoughtId: t.id,
          anchor: t.anchor,
          emittedAt: Date.now(),
        });
        // 同上:右槽打开挤压主区,重定位回标注位置
        bus.channels.emit('thought.scroll-to-book-source', {
          bookId,
          cfi: bookAnchor.cfi!,
          emittedAt: Date.now(),
        });
      }
    })();
  });

  /** 🤖 问 AI(占位 stub) */
  commandRegistry.register('ebook-view.epub-ask-ai', () => {
    console.info('[ebook-view.epub-ask-ai] 占位 — 待 AIView 接 EPUB textContent 后实装');
  });

  /** 📖 查词 — EPUB 选区单词 → DictionaryPanel lookup */
  commandRegistry.register('ebook-view.epub-dictionary-lookup', () => {
    const { text } = ctx();
    if (!text) return;
    const learning = requireCapabilityApi<LearningApi>('learning');
    learning.ui.dictionaryPanel.showLookup(text);
    contextMenuController.hide();
  });

  /** 🌐 翻译 — EPUB 选区句子 → DictionaryPanel translate */
  commandRegistry.register('ebook-view.epub-translate-text', () => {
    const { text } = ctx();
    if (!text) return;
    const learning = requireCapabilityApi<LearningApi>('learning');
    learning.ui.dictionaryPanel.showTranslate(text);
    contextMenuController.hide();
  });

  /** 📋 复制 — clipboard.writeText(选区 / 标注 textContent) */
  commandRegistry.register('ebook-view.epub-copy', () => {
    const { text, annotationCfi } = ctx();
    if (text) {
      void navigator.clipboard.writeText(text);
      return;
    }
    if (annotationCfi) {
      // 已标注上无选区时 → 找 textContent 复制
      const bookId = getActiveBookId();
      if (!bookId) return;
      void (async () => {
        const bookAnchor = await findEpubAnchorByCfi(bookId, annotationCfi);
        if (bookAnchor?.textContent) {
          await navigator.clipboard.writeText(bookAnchor.textContent);
        }
      })();
    }
  });

  /** 🗑 删除标注 — 删 legacy + 可能的 thought + 视觉移除走 hook diff */
  commandRegistry.register('ebook-view.epub-delete-annotation', () => {
    const { annotationCfi } = ctx();
    if (!annotationCfi) return;
    const bookId = getActiveBookId();
    if (!bookId) return;
    void (async () => {
      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
      const bookAnchor = await findEpubAnchorByCfi(bookId, annotationCfi);
      const matched = await findEpubThoughtByCfi(bookId, annotationCfi);
      if (bookAnchor) {
        await lib.removeReadingThoughtBlock(bookId, String(bookAnchor.createdAt));
      }
      if (matched) {
        const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
        await thoughtApi.deleteThought(matched.id);
      }
      // 视觉移除走 hook loadOnBookOpen 的 diff:lastDrawn - newList = 待删 cfis
    })();
  });

  /** EPUB 双击标注 → activate 关联 thought(同 PDF 双击 activate 模式)*/
  commandRegistry.register(
    'ebook-view.activate-thought-from-epub-annotation',
    (arg: unknown) => {
      if (typeof arg !== 'string') return;
      const cfi = arg;
      const bookId = getActiveBookId();
      if (!bookId) return;
      void (async () => {
        const matched = await findEpubThoughtByCfi(bookId, cfi);
        if (!matched || !matched.anchor) return;
        const wsId = workspaceManager.getActiveId();
        const bus = wsId ? workspaceManager.getBus(wsId) : null;
        if (bus) {
          bus.slot.openRight('thought-view');
          bus.channels.emit('thought.activate', {
            thoughtId: matched.id,
            anchor: matched.anchor,
            emittedAt: Date.now(),
          });
          // 同 add-thought-* — 右槽打开挤压主区,重定位回标注位置
          bus.channels.emit('thought.scroll-to-book-source', {
            bookId,
            cfi,
            emittedAt: Date.now(),
          });
        }
      })();
    },
  );

  // ── 4. ContextMenu items ──
  contextMenuRegistry.register([
    // 选区上(无标注):🖍 高亮 ▸ / 💭 加思考 ▸ / 🤖 问 AI / 📋 复制
    {
      id: 'ebook-view.epub.cm.highlight',
      label: '🖍 高亮',
      command: '',
      submenuId: 'epub-highlight-color',
      submenuRender: (sctx) =>
        createElement(EpubColorSubmenu, {
          ctx: sctx,
          actionCommand: 'ebook-view.epub-highlight',
          sectionLabel: '标注颜色',
        }),
      view: VIEW,
      enabledWhen: 'has-epub-text-selection',
      group: 'create',
      order: 10,
    },
    {
      id: 'ebook-view.epub.cm.add-thought-from-selection',
      label: '💭 加思考',
      command: '',
      submenuId: 'epub-thought-color',
      submenuRender: (sctx) =>
        createElement(EpubColorSubmenu, {
          ctx: sctx,
          actionCommand: 'ebook-view.epub-add-thought-from-selection',
          sectionLabel: '思考颜色',
        }),
      view: VIEW,
      enabledWhen: 'has-epub-text-selection',
      group: 'create',
      order: 20,
    },
    // 已标注上:💭 加思考 / 🤖 问 AI / 🎨 改颜色 ▸ / 🗑 删除标注
    {
      id: 'ebook-view.epub.cm.add-thought-from-annotation',
      label: '💭 加思考',
      command: 'ebook-view.epub-add-thought-from-annotation',
      view: VIEW,
      enabledWhen: 'has-epub-annotation',
      group: 'create',
      order: 30,
    },
    // 共用:🤖 问 AI
    {
      id: 'ebook-view.epub.cm.ask-ai-selection',
      label: '🤖 问 AI',
      command: 'ebook-view.epub-ask-ai',
      view: VIEW,
      enabledWhen: 'has-epub-text-selection',
      group: 'create',
      order: 40,
    },
    {
      id: 'ebook-view.epub.cm.ask-ai-annotation',
      label: '🤖 问 AI',
      command: 'ebook-view.epub-ask-ai',
      view: VIEW,
      enabledWhen: 'has-epub-annotation',
      group: 'create',
      order: 41,
    },
    // 📖 查词 / 🌐 翻译(选区上,2026-05-25 加;走 learning capability)
    {
      id: 'ebook-view.epub.cm.dictionary-lookup',
      label: '📖 查词',
      command: 'ebook-view.epub-dictionary-lookup',
      view: VIEW,
      enabledWhen: 'has-epub-text-selection',
      group: 'learning',
      order: 45,
    },
    {
      id: 'ebook-view.epub.cm.translate-text',
      label: '🌐 翻译',
      command: 'ebook-view.epub-translate-text',
      view: VIEW,
      enabledWhen: 'has-epub-text-selection',
      group: 'learning',
      order: 46,
    },
    // 改颜色(仅已标注):走 EpubColorSubmenu(同高亮 submenu 但 actionCommand 不同)
    {
      id: 'ebook-view.epub.cm.change-color',
      label: '🎨 改颜色',
      command: '',
      submenuId: 'epub-change-color',
      submenuRender: (sctx) =>
        createElement(EpubColorSubmenu, {
          ctx: sctx,
          actionCommand: 'ebook-view.epub-change-annotation-color',
          sectionLabel: '改为颜色',
        }),
      view: VIEW,
      enabledWhen: 'has-epub-annotation',
      group: 'modify',
      order: 50,
    },
    // 📋 复制(选区 + 标注都用同一 item — enabledWhen union 不支持,分两条)
    {
      id: 'ebook-view.epub.cm.copy-selection',
      label: '📋 复制',
      command: 'ebook-view.epub-copy',
      view: VIEW,
      enabledWhen: 'has-epub-text-selection',
      group: 'clipboard',
      order: 60,
    },
    {
      id: 'ebook-view.epub.cm.copy-annotation',
      label: '📋 复制',
      command: 'ebook-view.epub-copy',
      view: VIEW,
      enabledWhen: 'has-epub-annotation',
      group: 'clipboard',
      order: 61,
    },
    // 🗑 删除标注(仅已标注)
    {
      id: 'ebook-view.epub.cm.delete',
      label: '🗑 删除标注',
      command: 'ebook-view.epub-delete-annotation',
      view: VIEW,
      enabledWhen: 'has-epub-annotation',
      group: 'destructive',
      order: 90,
    },
  ]);

  /** 🎨 改颜色(EPUB 已标注上) — Submenu 选色后调本命令同步改色 */
  commandRegistry.register(
    'ebook-view.epub-change-annotation-color',
    (arg: unknown) => {
      const type = typeof arg === 'string' ? (arg as ThoughtType) : 'thought';
      const { annotationCfi } = ctx();
      if (!annotationCfi) return;
      const bookId = getActiveBookId();
      if (!bookId) return;
      void (async () => {
        const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
        const bookAnchor = await findEpubAnchorByCfi(bookId, annotationCfi);
        if (!bookAnchor) return;
        const color = THOUGHT_TYPE_META[type].color;
        await lib.updateReadingThoughtBlockColor(
          bookId,
          bookAnchor.createdAt,
          color,
        );
        // 同步关联 thought.type(若已升级)
        const matched = await findEpubThoughtByCfi(bookId, annotationCfi);
        if (matched) {
          const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
          await thoughtApi.updateThought(matched.id, { type });
        }
      })();
    },
  );

  // 防止 unused import
  void USER_THOUGHT_TYPES;
}
