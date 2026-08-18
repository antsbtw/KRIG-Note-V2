/**
 * HandleFormatSubmenu — handle 菜单 ¶ Format 子菜单(block-scoped)
 *
 * 对齐 V1 Format submenu 布局:
 *   ┌────────────┬────────────┐
 *   │ ⇥ Indent   │ ⇤ Outdent  │
 *   ├────────────┴────────────┤
 *   │ ↦ Text Indent     ⇧⌘I  │   (仅 paragraph/heading 显示)
 *   ├─────────────────────────┤
 *   │ Align Left              │   (仅 paragraph/heading 显示)
 *   │ Align Center            │
 *   │ Align Right             │
 *   └─────────────────────────┘
 *
 * 直接调 driver api(不走 commandRegistry,与 Color picker 同款模式)。
 * instanceId 自取(workspaceManager.getActiveId();handle 触发时 PM 实例还在 focus)。
 */

import { useRef } from 'react';
import type { HandleSubmenuContext } from '@slot/interaction-registries/handle-registry/handle-types';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';

interface Props {
  ctx: HandleSubmenuContext;
}

const MAX_INDENT = 8;
const ALIGN_LABELS: Array<['left' | 'center' | 'right', string]> = [
  ['left', 'Align Left'],
  ['center', 'Align Center'],
  ['right', 'Align Right'],
];

export function HandleFormatSubmenu({ ctx }: Props) {
  // instanceId 必须是 driver 的 per-slot 复合 id(`${wsId}::slot:<left|right>`),
  // 不能用裸 wsId —— instanceRegistry 取不到实例,block API 会静默 no-op(同 LinkPanel 回归)。
  // 快照:handle 菜单点开后 PM 已失焦,getFocusedInstanceId() 现读会返 null。
  const instanceIdRef = useRef<string | null>(null);
  if (instanceIdRef.current === null) {
    instanceIdRef.current = requireCapabilityApi<TextEditingApi>('text-editing')
      .instanceRegistry.getFocusedInstanceId();
  }
  const instanceId = instanceIdRef.current;
  const api = requireCapabilityApi<TextEditingApi>('text-editing').api;
  const format = instanceId ? api.getBlockFormat(instanceId, ctx.blockPos) : null;

  const indent = format?.indent ?? 0;
  const align = format?.align ?? null;
  const textIndent = format?.textIndent ?? null;
  const supportsTextIndent = textIndent !== null; // paragraph/heading
  const supportsAlign = align !== null;            // paragraph/heading

  const doIndent = (delta: 1 | -1) => {
    if (!instanceId) return;
    api.adjustBlockIndent(instanceId, ctx.blockPos, delta);
    ctx.close();
  };

  const doToggleTextIndent = () => {
    if (!instanceId) return;
    api.toggleBlockTextIndent(instanceId, ctx.blockPos);
    ctx.close();
  };

  const doSetAlign = (a: 'left' | 'center' | 'right') => {
    if (!instanceId) return;
    api.setBlockAlign(instanceId, ctx.blockPos, a);
    ctx.close();
  };

  return (
    <div className="krig-format-submenu">
      {/* Block Indent / Outdent — 一行两列 */}
      <div className="krig-format-submenu__row">
        <button
          type="button"
          className="krig-format-submenu__btn krig-format-submenu__btn--half"
          disabled={indent >= MAX_INDENT}
          title="Indent (Tab)"
          onMouseDown={(e) => { e.preventDefault(); doIndent(1); }}
        >
          <span className="krig-format-submenu__icon">⇥</span>
          <span>Indent</span>
        </button>
        <button
          type="button"
          className="krig-format-submenu__btn krig-format-submenu__btn--half"
          disabled={indent <= 0}
          title="Outdent (Shift+Tab)"
          onMouseDown={(e) => { e.preventDefault(); doIndent(-1); }}
        >
          <span className="krig-format-submenu__icon">⇤</span>
          <span>Outdent</span>
        </button>
      </div>

      {/* Text Indent — paragraph / heading only */}
      {supportsTextIndent && (
        <>
          <div className="krig-format-submenu__divider" />
          <button
            type="button"
            className={
              'krig-format-submenu__btn' +
              (textIndent ? ' krig-format-submenu__btn--active' : '')
            }
            onMouseDown={(e) => { e.preventDefault(); doToggleTextIndent(); }}
          >
            <span className="krig-format-submenu__icon">↦</span>
            <span className="krig-format-submenu__label">Text Indent</span>
            <span className="krig-format-submenu__shortcut">⇧⌘I</span>
          </button>
        </>
      )}

      {/* Align — paragraph / heading only */}
      {supportsAlign && (
        <>
          <div className="krig-format-submenu__divider" />
          {ALIGN_LABELS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={
                'krig-format-submenu__btn' +
                (align === value ? ' krig-format-submenu__btn--active' : '')
              }
              onMouseDown={(e) => { e.preventDefault(); doSetAlign(value); }}
            >
              <span className="krig-format-submenu__icon">≡</span>
              <span>{label}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
