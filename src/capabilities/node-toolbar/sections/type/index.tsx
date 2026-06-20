/**
 * Type section(L5-G5 / G5.7)— 字体族 + 自由字号(画板专属)
 *
 * **与 Text 物理分离**(方案 B):字号/字体是 note 原生没有的画板专属能力,走 instance
 * 新字段 text_font / text_size(ctx.patchInstance),渲染管线据此重渲(§5.4)。
 *
 * 本期字体清单(用户拍板 G5.7 只上已装字体):Sans(Inter/Noto Sans SC)/ 等宽(JetBrains Mono)。
 * Serif / 手写体管线已接(pickFontForChar 覆盖就绪),字体文件待后续打包(SIL OFL 核 license),
 * 故下拉暂不列,避免选了无视觉变化。落地字体后只在此加选项 + fonts/index 加 ?url。
 */

import type { NodeSnapshot, SectionContext, SectionDef } from '../../types';

type FontFamily = NonNullable<NodeSnapshot['text_font']>;

/** 本期可选字体族(只列有专属字体文件的;serif/handwriting 待打包) */
const FONT_OPTIONS: ReadonlyArray<{ value: FontFamily; label: string }> = [
  { value: 'auto', label: '默认(自动)' },
  { value: 'sans', label: '黑体 / Sans(Inter · 思源黑)' },
  { value: 'mono', label: '等宽 / Mono(JetBrains Mono)' },
];

const DEFAULT_SIZE = 16; // §5.4b:新建文字节点默认 16(对齐 note 正文)
const MIN_SIZE = 6;
const MAX_SIZE = 200;

function TypePanel(ctx: SectionContext): React.ReactElement {
  const curFont: FontFamily = ctx.node.text_font ?? 'auto';
  const curSize = ctx.node.text_size ?? DEFAULT_SIZE;

  const setSize = (n: number): void => {
    const clamped = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(n)));
    ctx.patchInstance({ text_size: clamped });
  };

  return (
    <div>
      <div className="krig-node-toolbar__row">
        <span className="krig-node-toolbar__label">字体</span>
        <select
          className="krig-node-toolbar__select"
          value={curFont}
          onChange={(e) => ctx.patchInstance({ text_font: e.target.value as FontFamily })}
        >
          {FONT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="krig-node-toolbar__row">
        <span className="krig-node-toolbar__label">字号</span>
        <div className="krig-node-toolbar__stepper">
          <button type="button" onClick={() => setSize(curSize - 1)} aria-label="减小字号">
            −
          </button>
          <input
            type="number"
            value={curSize}
            min={MIN_SIZE}
            max={MAX_SIZE}
            step={1}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!Number.isNaN(v)) setSize(v);
            }}
          />
          <button type="button" onClick={() => setSize(curSize + 1)} aria-label="增大字号">
            +
          </button>
        </div>
        <span className="krig-node-toolbar__label">pt</span>
      </div>
    </div>
  );
}

export const typeSection: SectionDef = {
  id: 'type',
  title: '字体字号',
  icon: () => <span aria-hidden style={{ fontStyle: 'italic', fontWeight: 600 }}>F</span>,
  Panel: TypePanel,
};
