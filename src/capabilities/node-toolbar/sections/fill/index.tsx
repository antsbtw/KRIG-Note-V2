/**
 * Fill section(L5-G5 / G5.3)— 填充色板
 *
 * 写 style_overrides.fill({ type:'none'|'solid', color });走 ctx.patchStyle →
 * view → canvas-rendering host.updateInstance(已内置 style_overrides 嵌套合并).
 * 数据层就绪,本 section 纯 UI + patchStyle。
 *
 * 直迁 V1 色板视觉(14 色 + No Fill + 取色器),不重写极简版。
 */

import type { SectionContext, SectionDef } from '../../types';
import { PALETTE_14, normalizeHex } from '../palette';

function currentFill(ctx: SectionContext): { type: 'none' | 'solid'; color?: string } {
  const fill = ctx.node.style_overrides?.fill;
  return { type: fill?.type ?? 'solid', color: fill?.color };
}

function FillPanel(ctx: SectionContext): React.ReactElement {
  const cur = currentFill(ctx);
  const pickColor = (color: string): void => {
    ctx.patchStyle({ fill: { type: 'solid', color } });
  };
  return (
    <div>
      <div className="krig-node-toolbar__swatch-grid">
        {PALETTE_14.map((sw) => {
          const active = cur.type === 'solid' && (cur.color ?? '').toLowerCase() === sw.color.toLowerCase();
          return (
            <button
              key={sw.name}
              type="button"
              className={'krig-node-toolbar__swatch' + (active ? ' is-active' : '')}
              style={{ background: sw.color }}
              title={sw.name}
              onClick={() => pickColor(sw.color)}
            />
          );
        })}
      </div>
      <div className="krig-node-toolbar__row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className={'krig-node-toolbar__bar-btn' + (cur.type === 'none' ? ' is-active' : '')}
          onClick={() => ctx.patchStyle({ fill: { type: 'none' } })}
        >
          无填充
        </button>
        <input
          type="color"
          className="krig-node-toolbar__color-input"
          title="自定义颜色"
          value={normalizeHex(cur.color)}
          onChange={(e) => pickColor(e.target.value)}
        />
      </div>
    </div>
  );
}

/** trigger 图标:显示当前填充色圆点(none 时空心) */
function FillIcon(ctx: SectionContext): React.ReactElement {
  const cur = currentFill(ctx);
  const isNone = cur.type === 'none';
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 14,
        height: 14,
        borderRadius: '50%',
        border: '1px solid #777',
        background: isNone ? 'transparent' : cur.color ?? '#888',
      }}
    />
  );
}

export const fillSection: SectionDef = {
  id: 'fill',
  title: '填充',
  icon: FillIcon,
  Panel: FillPanel,
};
