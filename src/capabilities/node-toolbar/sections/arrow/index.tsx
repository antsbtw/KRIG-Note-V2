/**
 * Arrow section — 线两端的端形(`index.ts` 里「arrow section 待后续」那一条,现已补上)
 *
 * 写 `style_overrides.arrow({ begin, end })`;走 `ctx.patchStyle`(与 Fill / Line 同一条路)。
 * 六种端形复用 shape-library 既有词表 `ArrowEndKind`,渲染见
 * `canvas-rendering/scene/arrow-geometry.ts`(**六种各画各的**,不是统一三角)。
 *
 * ⚠️ 只对 line 类节点显示(`visibleWhen`)—— 几何 shape 没有"端"可言。
 */

import type { ArrowEndKind } from '@capabilities/shape-library/types';
import type { SectionContext, SectionDef } from '../../types';

/** 六种端形 + SVG 预览(与渲染层几何同形,免得浮条画的和画布上的两个样) */
const KIND_OPTIONS: ReadonlyArray<{ value: ArrowEndKind; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'arrow', label: '开口箭头' },
  { value: 'triangle', label: '实心三角' },
  { value: 'stealth', label: '燕尾' },
  { value: 'diamond', label: '菱形' },
  { value: 'oval', label: '圆点' },
];

/**
 * 端形预览 —— ⭐ 朝右画,与「线的终点」方向一致。
 * ⚠️ 形状必须与 arrow-geometry 的产出同形,否则「浮条选的」和「画布出的」对不上。
 */
function KindPreview({ kind }: { kind: ArrowEndKind }): React.ReactElement {
  const tipX = 22;
  const size = 10;
  const half = size * 0.45;
  const body = (): React.ReactNode => {
    switch (kind) {
      case 'none':
        return null;
      case 'arrow':
        return (
          <polyline
            points={`${tipX - size},${6 - half} ${tipX},6 ${tipX - size},${6 + half}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        );
      case 'triangle':
        return (
          <polygon
            points={`${tipX},6 ${tipX - size},${6 - half} ${tipX - size},${6 + half}`}
            fill="currentColor"
          />
        );
      case 'stealth':
        return (
          <polygon
            points={`${tipX},6 ${tipX - size},${6 - half} ${tipX - size * 0.65},6 ${tipX - size},${6 + half}`}
            fill="currentColor"
          />
        );
      case 'diamond':
        return (
          <polygon
            points={`${tipX},6 ${tipX - size / 2},${6 - half} ${tipX - size},6 ${tipX - size / 2},${6 + half}`}
            fill="currentColor"
          />
        );
      case 'oval':
        return <circle cx={tipX - half} cy="6" r={half} fill="currentColor" />;
      default:
        return null;
    }
  };
  return (
    <svg width="26" height="12" aria-hidden>
      <line x1="2" y1="6" x2={tipX - size} y2="6" stroke="currentColor" strokeWidth="1.4" />
      {body()}
    </svg>
  );
}

function ArrowPanel(ctx: SectionContext): React.ReactElement {
  const arrow = ctx.node.style_overrides?.arrow;
  const curEnd: ArrowEndKind = arrow?.end ?? 'none';
  const curBegin: ArrowEndKind = arrow?.begin ?? 'none';

  const row = (
    which: 'begin' | 'end',
    cur: ArrowEndKind,
    label: string,
  ): React.ReactElement => (
    <div className="krig-node-toolbar__row">
      <span className="krig-node-toolbar__label">{label}</span>
      {KIND_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={
            'krig-node-toolbar__icon-btn' + (cur === opt.value ? ' is-active' : '')
          }
          title={opt.label}
          onClick={() => ctx.patchStyle({ arrow: { [which]: opt.value } })}
        >
          {/* 起点端的预览左右镜像,所见即所得 */}
          <span style={which === 'begin' ? { display: 'inline-flex', transform: 'scaleX(-1)' } : undefined}>
            <KindPreview kind={opt.value} />
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <div>
      {row('end', curEnd, '终点')}
      {row('begin', curBegin, '起点')}
    </div>
  );
}

/** trigger 图标:当前终点端形 */
function ArrowIcon(ctx: SectionContext): React.ReactElement {
  return <KindPreview kind={ctx.node.style_overrides?.arrow?.end ?? 'none'} />;
}

export const arrowSection: SectionDef = {
  id: 'arrow',
  title: '端形',
  icon: ArrowIcon,
  Panel: ArrowPanel,
  // ⚠️ 只有线才有"端";几何 shape / 文字框显示它没有意义
  visibleWhen: (ctx) => ctx.node.kind === 'line',
};
