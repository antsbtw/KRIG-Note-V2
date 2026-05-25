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
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import {
  THOUGHT_TYPE_META,
  USER_THOUGHT_TYPES,
  type ThoughtType,
} from '@shared/ipc/thought-types';
import { getEBookWsState } from './data-model';

interface Props {
  ctx: ContextSubmenuContext;
}

function getActiveBookId(): string | null {
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return null;
  const ws = workspaceManager.get(wsId);
  if (!ws) return null;
  const state = getEBookWsState(ws);
  return state?.activeBookId ?? null;
}

export function AnnotationTypeSubmenu({ ctx }: Props) {
  const rawId = ctx.contextInfo.custom.pdfAnnotationId;
  const annotationId = typeof rawId === 'string' ? rawId : null;

  const apply = (type: ThoughtType): void => {
    if (!annotationId) return;
    const bookId = getActiveBookId();
    if (!bookId) return;
    const color = THOUGHT_TYPE_META[type].color;
    const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
    void lib.updateReadingThoughtBlockColor(bookId, Number(annotationId), color);
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
