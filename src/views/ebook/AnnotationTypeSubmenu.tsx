/**
 * AnnotationTypeSubmenu — context menu 🎨 改颜色子菜单
 *
 * 渲染 USER_THOUGHT_TYPES 5 色按钮,点击直接调 thoughtCap.updateThought({ type })。
 * 颜色由 type 反查 THOUGHT_TYPE_META.color(单一真相源,对齐 AnnotationLayer)。
 *
 * 模式对齐 [ContextFrameSubmenu](src/capabilities/text-editing/ui/frame-picker/ContextFrameSubmenu.tsx):
 * - submenu 内组件**直接调 capability API**,不走 commandRegistry
 *   (ContextMenuBinding execute 不传参数,而改色需要 type 参数)
 * - 操作完调 ctx.close() 关菜单
 *
 * pdfAnnotationId 走 ctx.contextInfo.custom(由 ebook view 注册的 contextInfoProvider 贡献)。
 */

import type { ContextSubmenuContext } from '@slot/interaction-registries/context-menu-registry/context-menu-types';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { ThoughtCapabilityApi } from '@capabilities/thought/types';
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
    const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
    void thoughtApi.updateThought(annotationId, { type });
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
