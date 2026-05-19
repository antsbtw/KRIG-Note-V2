/**
 * ContextFrameSubmenu — context menu 右键 ▣ 框定 子菜单
 *
 * 复用 ColorSwatchGrid 的 BG_COLORS 色板,加线型(单/双线)切换 + 删除按钮。
 *
 * 作用域语义(对齐 V1 ContextMenu frame 行为):
 * - 命中 block 已有框定 → 更新该 block(group 同步) / 删除框定
 * - 命中 block 无框定 → setBlockFrame 当前选区覆盖的所有顶层 block(多块自动 group)
 *
 * instanceId 走 ctx.contextInfo.pmInstanceId(右键触发瞬间快照)。
 */

import { useMemo } from 'react';
import type { ContextSubmenuContext } from '@slot/interaction-registries/context-menu-registry/context-menu-types';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import { BG_COLORS } from '../color-picker/ColorSwatchGrid';

interface Props {
  ctx: ContextSubmenuContext;
}

export function ContextFrameSubmenu({ ctx }: Props) {
  const instanceId = ctx.contextInfo.pmInstanceId;
  const api = requireCapabilityApi<TextEditingApi>('text-editing').api;

  // 解析当前点击的单 block(用于读 active state 和 update / remove)
  const targetBlock = useMemo(() => {
    if (!instanceId) return null;
    const res = api.resolveBlockAt(instanceId, { x: ctx.contextInfo.x, y: ctx.contextInfo.y });
    if (!res) return null;
    return res.pos;
  }, [instanceId, ctx.contextInfo.x, ctx.contextInfo.y, api]);

  const current = useMemo(() => {
    if (!instanceId || targetBlock == null) return null;
    return api.getBlockFrame(instanceId, targetBlock);
  }, [instanceId, targetBlock, api]);
  const hasFrame = current !== null;

  const applyColor = (color: string) => {
    if (!instanceId) return;
    if (hasFrame && targetBlock != null) {
      api.updateBlockFrameColor(instanceId, targetBlock, color);
    } else {
      // 新建框定:取选区覆盖的所有顶层 block(多块自动 group)
      let positions = api.getSelectedTopLevelBlockPositions(instanceId);
      if (positions.length === 0 && targetBlock != null) {
        positions = [targetBlock];
      }
      if (positions.length === 0) return;
      api.setBlockFrame(instanceId, positions, color, current?.style === 'double' ? 'double' : 'solid');
    }
    ctx.close();
  };

  const applyStyle = (style: 'solid' | 'double') => {
    if (!instanceId || !hasFrame || targetBlock == null) return;
    api.updateBlockFrameStyle(instanceId, targetBlock, style);
    ctx.close();
  };

  const removeFrame = () => {
    if (!instanceId || !hasFrame || targetBlock == null) return;
    api.removeBlockFrame(instanceId, targetBlock);
    ctx.close();
  };

  // 排除"Default"色(BG_COLORS 第一个是空字符串清除色,框定不需要)
  const swatches = BG_COLORS.filter((s) => s.color !== '');

  return (
    <div className="krig-frame-picker">
      <div className="krig-frame-picker__section-label">边框颜色</div>
      <div className="krig-frame-picker__color-grid">
        {swatches.map((s) => {
          const active = current?.color === s.color;
          return (
            <button
              key={s.color}
              type="button"
              className="krig-frame-picker__swatch"
              title={s.name}
              style={{
                background: s.color,
                outline: active ? '2px solid #e8eaed' : '2px solid transparent',
                outlineOffset: '1px',
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                applyColor(s.color);
              }}
            />
          );
        })}
      </div>

      <div className="krig-frame-picker__section-label" style={{ marginTop: 8 }}>线条样式</div>
      <div className="krig-frame-picker__style-row">
        {(['solid', 'double'] as const).map((s) => {
          const active = current?.style === s;
          return (
            <button
              key={s}
              type="button"
              className={`krig-frame-picker__style-btn${active ? ' krig-frame-picker__style-btn--active' : ''}`}
              disabled={!hasFrame}
              onMouseDown={(e) => {
                e.preventDefault();
                applyStyle(s);
              }}
            >
              <svg width="24" height="16" viewBox="0 0 24 16" aria-hidden>
                {s === 'solid' ? (
                  <rect x="2" y="2" width="20" height="12" rx="2" fill="none"
                    stroke={current?.color || '#888'} strokeWidth="2" />
                ) : (
                  <>
                    <rect x="1" y="1" width="22" height="14" rx="2" fill="none"
                      stroke={current?.color || '#888'} strokeWidth="1" />
                    <rect x="3" y="3" width="18" height="10" rx="1" fill="none"
                      stroke={current?.color || '#888'} strokeWidth="1" />
                  </>
                )}
              </svg>
              <span>{s === 'solid' ? '单线' : '双线'}</span>
            </button>
          );
        })}
      </div>

      {hasFrame && (
        <>
          <div className="krig-frame-picker__separator" />
          <button
            type="button"
            className="krig-frame-picker__remove-btn"
            onMouseDown={(e) => {
              e.preventDefault();
              removeFrame();
            }}
          >
            删除框定
          </button>
        </>
      )}
    </div>
  );
}
