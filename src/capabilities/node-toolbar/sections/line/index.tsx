/**
 * Line section(L5-G5 / G5.3)— 描边线型 / 粗细 / 颜色
 *
 * 写 style_overrides.line({ type, color, width, dashType });走 ctx.patchStyle。
 * dashType 5 值复用 shape-library 既有定义(solid/dash/dot/dashDot/longDash)。
 * 数据层就绪,纯 UI + patchStyle。
 */

import type { DashType } from '@capabilities/shape-library/types';
import type { SectionContext, SectionDef } from '../../types';
import { normalizeHex } from '../palette';

/** 5 dashType + 视觉(SVG dash 预览) */
const DASH_OPTIONS: ReadonlyArray<{ value: DashType; label: string; dash: string }> = [
  { value: 'solid', label: '实线', dash: '' },
  { value: 'dash', label: '虚线', dash: '5,4' },
  { value: 'dot', label: '点线', dash: '1.5,3' },
  { value: 'dashDot', label: '点划线', dash: '6,3,1.5,3' },
  { value: 'longDash', label: '长划线', dash: '10,5' },
];

const DEFAULT_WIDTH = 1;
const MIN_WIDTH = 0.5;
const MAX_WIDTH = 20;

function DashPreview({ dash }: { dash: string }): React.ReactElement {
  return (
    <svg width="26" height="12" aria-hidden>
      <line
        x1="2"
        y1="6"
        x2="24"
        y2="6"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray={dash || undefined}
      />
    </svg>
  );
}

function LinePanel(ctx: SectionContext): React.ReactElement {
  const line = ctx.node.style_overrides?.line;
  const curDash: DashType = line?.dashType ?? 'solid';
  const curWidth = line?.width ?? DEFAULT_WIDTH;
  const isNone = line?.type === 'none';

  const setDash = (dashType: DashType): void => {
    ctx.patchStyle({ line: { type: 'solid', dashType } });
  };
  const setWidth = (w: number): void => {
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w));
    ctx.patchStyle({ line: { type: 'solid', width: clamped } });
  };

  return (
    <div>
      {/* 线型 + 无 */}
      <div className="krig-node-toolbar__row">
        <button
          type="button"
          className={'krig-node-toolbar__icon-btn' + (isNone ? ' is-active' : '')}
          title="无描边"
          onClick={() => ctx.patchStyle({ line: { type: 'none' } })}
        >
          ⊘
        </button>
        {DASH_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={
              'krig-node-toolbar__icon-btn' +
              (!isNone && curDash === opt.value ? ' is-active' : '')
            }
            title={opt.label}
            onClick={() => setDash(opt.value)}
          >
            <DashPreview dash={opt.dash} />
          </button>
        ))}
      </div>
      {/* 粗细(pt)+ 颜色 */}
      <div className="krig-node-toolbar__row">
        <span className="krig-node-toolbar__label">粗细</span>
        <div className="krig-node-toolbar__stepper">
          <button type="button" onClick={() => setWidth(curWidth - 0.5)} aria-label="减小">
            −
          </button>
          <input
            type="number"
            value={curWidth}
            min={MIN_WIDTH}
            max={MAX_WIDTH}
            step={0.5}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!Number.isNaN(v)) setWidth(v);
            }}
          />
          <button type="button" onClick={() => setWidth(curWidth + 0.5)} aria-label="增大">
            +
          </button>
        </div>
        <span className="krig-node-toolbar__label">pt</span>
        <input
          type="color"
          className="krig-node-toolbar__color-input"
          title="描边颜色"
          value={normalizeHex(line?.color)}
          onChange={(e) => ctx.patchStyle({ line: { type: 'solid', color: e.target.value } })}
        />
      </div>
    </div>
  );
}

/** trigger 图标:当前线型斜线预览 */
function LineIcon(ctx: SectionContext): React.ReactElement {
  const dash = ctx.node.style_overrides?.line?.dashType ?? 'solid';
  const opt = DASH_OPTIONS.find((o) => o.value === dash) ?? DASH_OPTIONS[0];
  return <DashPreview dash={opt.dash} />;
}

export const lineSection: SectionDef = {
  id: 'line',
  title: '描边',
  icon: LineIcon,
  Panel: LinePanel,
};
