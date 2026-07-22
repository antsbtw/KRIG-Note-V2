/**
 * AnnotationTypeSubmenu — context menu 🎨 改颜色子菜单(PR-α-3b 修订:走 legacy updateColor)
 *
 * 渲染 USER_THOUGHT_TYPES 5 色按钮,点击 → `lib.updateReadingThoughtBlockColor`
 * (改 BookAnchor.color 字段) → broadcastNoteListChanged → use-pdf-annotations
 * refreshForBook 回流 → AnnotationLayer 颜色变。
 *
 * 模式对齐 [ContextFrameSubmenu]:submenu 内组件直接调 capability API,不走 commandRegistry
 * (ContextMenuBinding execute 不传参数,而改色需要 type 参数)。
 *
 * id = bookAnchor.createdAt 字面串,从 ctx.contextInfo.custom.pdfAnnotationId 取。
 */

import type { ContextSubmenuContext } from '@slot/interaction-registries/context-menu-registry/context-menu-types';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { EBookLibraryApi } from '@capabilities/ebook-library/types';
import type {
  ThoughtCapabilityApi,
  BookLocator,
} from '@capabilities/thought/types';
import {
  THOUGHT_TYPE_META,
  USER_THOUGHT_TYPES,
  type ThoughtType,
} from '@shared/ipc/thought-types';

interface Props {
  ctx: ContextSubmenuContext;
}

export function AnnotationTypeSubmenu({ ctx }: Props) {
  const rawId = ctx.contextInfo.custom.pdfAnnotationId;
  const annotationId = typeof rawId === 'string' ? rawId : null;

  const apply = (type: ThoughtType): void => {
    if (!annotationId) return;
    const rawBookId = ctx.contextInfo.custom.activeBookId;
    const bookId = typeof rawBookId === 'string' ? rawBookId : null;
    if (!bookId) return;
    const createdAt = Number(annotationId);
    const color = THOUGHT_TYPE_META[type].color;
    const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
    const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
    void (async () => {
      // 双写(handoff 颜色同步 follow-up A):同步改标注 BookAnchor.color + 关联 thought.type
      // - 标注必改:lib.updateReadingThoughtBlockColor 改 legacy BookAnchor.color
      // - 关联 thought 可选:扫 listThoughtsBySource 找 anchor.locator.createdAt 匹配的
      //   thought atom,有则同步改 type;无则跳过(标注未升级到 thought,无 type 概念)
      await lib.updateReadingThoughtBlockColor(bookId, createdAt, color);
      const thoughts = await thoughtApi.listThoughtsBySource('book', bookId);
      const matched = thoughts.find(
        (t) =>
          t.anchor?.source === 'book' &&
          (t.anchor.locator as BookLocator).createdAt === createdAt,
      );
      if (matched) {
        await thoughtApi.updateThought(matched.id, { type });
      }
    })();
    ctx.close();
  };

  return (
    <div className="krig-ebook-annotation-type-submenu">
      {USER_THOUGHT_TYPES.map((t) => {
        const meta = THOUGHT_TYPE_META[t];
        return (
          <button
            key={t}
            type="button"
            className="krig-ebook-annotation-type-submenu__btn"
            style={{ backgroundColor: meta.color }}
            title={`${meta.icon} ${meta.label}`}
            onMouseDown={(e) => {
              e.preventDefault();
              apply(t);
            }}
          />
        );
      })}
    </div>
  );
}
