/**
 * EBookView ContextMenu 注册(PR-α-2 — handoff: docs/tasks/context-menu-registry-handoff.md)
 *
 * 注册三类内容:
 *
 * 1. contextInfoProvider 'ebook'
 *    通过 `data-pdf-annotation-id` attr 检测命中标注 → 写 custom.pdfAnnotationId
 *    (AnnotationLayer 渲染时挂此 attr)
 *
 * 2. enabledWhen predicate 'has-pdf-annotation'
 *    ctx => !!ctx.custom.pdfAnnotationId
 *
 * 3. ContextMenu items(5 项;查词/翻译占位留 PR-α-3):
 *    - 💭 加思考       → thought-view.add-from-pdf-annotation(已存在)
 *    - 🤖 问 AI        → ebook-view.ask-ai-from-annotation(stub)
 *    - 🎨 改颜色       → submenu render AnnotationTypeSubmenu(5 色 → updateThought)
 *    - 🗑 删除标注     → ebook-view.delete-pdf-annotation(包装 thoughtCap.deleteThought)
 *    - 📸 截图复制     → ebook-view.copy-annotation-screenshot(BookLocator.thumbnail → ClipboardItem)
 *
 * 4. 新命令注册(ebook-view.* 命名空间):
 *    - ebook-view.delete-pdf-annotation         无参,从 context.custom.pdfAnnotationId 拿 id
 *    - ebook-view.copy-annotation-screenshot    同上
 *    - ebook-view.ask-ai-from-annotation        占位 stub(toast)
 *
 * 命令参数模式:ContextMenuBinding.executeItem 调 commandRegistry.execute(item.command)
 * 不传 arg(对齐 thought-view.delete-thought-at-cursor 模式);handler 内自取 controller state。
 */

import { createElement } from 'react';
import { contextMenuRegistry } from '@slot/interaction-registries/context-menu-registry/context-menu-registry';
import { contextInfoProviderRegistry } from '@slot/interaction-registries/context-info-provider-registry';
import { enabledWhenRegistry } from '@slot/interaction-registries/enabled-when-registry';
import { contextMenuController } from '@slot/triggers/context-menu-controller';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { ThoughtCapabilityApi, BookLocator } from '@capabilities/thought/types';
import { AnnotationTypeSubmenu } from './AnnotationTypeSubmenu';

const VIEW = 'ebook-view';

/**
 * 从 context.custom.pdfAnnotationId 读 id(类型 string-or-null,handler 内 type guard)。
 *
 * 抽取方便统一 — 三个命令都从同一字段读。
 */
function getPdfAnnotationId(): string | null {
  const raw = contextMenuController.getState().context.custom.pdfAnnotationId;
  return typeof raw === 'string' ? raw : null;
}

/**
 * 把 base64 dataUrl(`data:image/jpeg;base64,...`)写入剪贴板(图像形式)。
 *
 * 流程:dataUrl → fetch → blob → ClipboardItem({'image/png': blob}) → clipboard.write
 *
 * 注:ClipboardItem 仅支持 image/png 跨浏览器(image/jpeg 在部分浏览器拒绝);
 * 把 JPEG dataUrl 转 PNG blob 走 canvas 中转。
 */
async function copyDataUrlToClipboard(dataUrl: string): Promise<void> {
  // dataUrl → Image → canvas → png blob
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

  /** 💭 删除标注 — 包装 thoughtCap.deleteThought,无参从 context.custom.pdfAnnotationId 取 id */
  commandRegistry.register('ebook-view.delete-pdf-annotation', () => {
    const id = getPdfAnnotationId();
    if (!id) return;
    const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
    void thoughtApi.deleteThought(id);
  });

  /**
   * 📸 截图复制 — 读 thought.anchor.locator.thumbnail base64 写入剪贴板(图像形式)。
   *
   * thumbnail 在 createPdfAnnotation 时存(capturePageRect 2x DPR JPEG)。
   * 无 thumbnail(老数据 / 截图失败)时 no-op + warn(用户看不到反馈,但已 no-fallback)。
   */
  commandRegistry.register('ebook-view.copy-annotation-screenshot', () => {
    const id = getPdfAnnotationId();
    if (!id) return;
    void (async () => {
      const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
      const t = await thoughtApi.getThought(id);
      if (!t?.anchor || t.anchor.source !== 'book') {
        console.warn('[ebook-view.copy-screenshot] no book anchor');
        return;
      }
      const loc = t.anchor.locator as BookLocator;
      if (!loc.thumbnail) {
        console.warn('[ebook-view.copy-screenshot] no thumbnail');
        return;
      }
      try {
        await copyDataUrlToClipboard(loc.thumbnail);
      } catch (err) {
        console.error('[ebook-view.copy-screenshot] clipboard write failed', err);
      }
    })();
  });

  /** 🤖 问 AI(占位 — α-2 不实装,等 AIView 支持 image input) */
  commandRegistry.register('ebook-view.ask-ai-from-annotation', () => {
    console.info('[ebook-view.ask-ai] 占位 — 待 AIView 支持 image input 后实装');
  });

  // ── 4. ContextMenu items ──
  contextMenuRegistry.register([
    {
      id: 'ebook-view.cm.add-thought',
      label: '💭 加思考',
      // 复用 thought-view 既有命令 — 接 pdfAnnotationId 字符串参数 = thoughtId
      // (binding execute 不传参,这里走 wrapper 命令)
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

  /**
   * 💭 加思考 wrapper — 既有 thought-view.add-from-pdf-annotation 需 thoughtId 字符串参数,
   * ContextMenuBinding execute 不传参,故包一层从 context 取 id。
   */
  commandRegistry.register('ebook-view.add-thought-from-annotation', () => {
    const id = getPdfAnnotationId();
    if (!id) return;
    commandRegistry.execute('thought-view.add-from-pdf-annotation', id);
  });
}
