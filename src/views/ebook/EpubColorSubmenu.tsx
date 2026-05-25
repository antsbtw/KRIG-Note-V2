/**
 * EpubColorSubmenu — EPUB 右键菜单 5 色 submenu(PR-α-3b followup)
 *
 * 视觉对齐 note 框定 submenu(.krig-frame-picker)— section label + 横排色按钮,
 * 视觉是独立卡片,而不是延续主菜单 row 的窄条。
 *
 * 同 PDF AnnotationTypeSubmenu 模式,但通过 `actionCommand` 参数接不同命令 +
 * `sectionLabel` 区分用途:
 *   - 🖍 高亮 → 'ebook-view.epub-highlight'              · label='标注颜色'
 *   - 💭 加思考 → 'ebook-view.epub-add-thought-from-selection'  · label='思考颜色'
 *   - 🎨 改颜色 → 'ebook-view.epub-change-annotation-color'    · label='改为颜色'
 */

import type { ContextSubmenuContext } from '@slot/interaction-registries/context-menu-registry/context-menu-types';
import { commandRegistry } from '@slot/command-registry/command-registry';
import {
  THOUGHT_TYPE_META,
  USER_THOUGHT_TYPES,
  type ThoughtType,
} from '@shared/ipc/thought-types';

interface Props {
  ctx: ContextSubmenuContext;
  actionCommand: string;
  sectionLabel: string;
}

export function EpubColorSubmenu({ ctx, actionCommand, sectionLabel }: Props) {
  const apply = (type: ThoughtType): void => {
    commandRegistry.execute(actionCommand, type);
    ctx.close();
  };

  return (
    <div className="krig-epub-color-picker">
      <div className="krig-epub-color-picker__section-label">{sectionLabel}</div>
      <div className="krig-epub-color-picker__color-row">
        {USER_THOUGHT_TYPES.map((t) => {
          const meta = THOUGHT_TYPE_META[t];
          return (
            <button
              key={t}
              type="button"
              className="krig-epub-color-picker__swatch"
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
    </div>
  );
}
