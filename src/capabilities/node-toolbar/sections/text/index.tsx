/**
 * Text section(L5-G5 / G5.5;G6 合并 Type)— 文字颜色 + 对齐 + 字体族 + 字号
 *
 * 用户拍板(2026-06-20 复盘)合并方案:
 * - 节点浮条只管**整节点级**文字属性;字符级(B/I/U/列表/选中改色)交给双击编辑态
 * - 删 B/I/U + 列表(双击编辑态浮动条已有,不重复)
 * - 文字颜色:整节点改色,用**和 Fill 同款色板**(默认色清除 + 13 彩 + 取色器),不直接弹原生调色板
 * - 合并原 Type section:字体族 + 字号并入(浮条文字节点 trigger 从 [●][Aa][F] 收为 [●][Aa])
 *
 * 落地分流:
 * - 文字色 / 对齐 → ctx.runTextCommand(headless 整 doc 改 note mark)
 * - 字体族 / 字号 → ctx.patchInstance(画板专属 instance 字段 text_font/text_size)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeSnapshot, SectionContext, SectionDef, SystemFontInfo } from '../../types';
import { PALETTE_14, normalizeHex } from '../palette';

type FontFamily = NonNullable<NodeSnapshot['text_font']>;

/** 字体族下拉(L5-G6 全字体已打包,中英文按字符自动选对应字体) */
const FONT_OPTIONS: ReadonlyArray<{ value: FontFamily; label: string }> = [
  { value: 'auto', label: '默认(自动)' },
  { value: 'sans', label: '黑体 / Sans(思源黑 · Inter)' },
  { value: 'serif', label: '宋体 / Serif(思源宋 · Source Serif)' },
  { value: 'handwriting', label: '手写 / 楷(文楷 · Caveat)' },
  { value: 'mono', label: '等宽 / Mono(JetBrains Mono)' },
];

const DEFAULT_SIZE = 16; // §5.4b:新建文字节点默认 16(对齐 note 正文)
const MIN_SIZE = 6;
const MAX_SIZE = 200;

/** 文字色板首格 = 默认色(清除 textStyle 颜色,回到节点默认文字色) */
const DEFAULT_COLOR_SWATCH = { name: '默认色', color: '' };

function TextPanel(ctx: SectionContext): React.ReactElement {
  const curFont: FontFamily = ctx.node.text_font ?? 'auto';
  const curSize = ctx.node.text_size ?? DEFAULT_SIZE;

  const setColor = (color: string): void => {
    // 整节点改色(空串 = 清除颜色回默认);走 headless 整 doc 改 textStyle mark
    ctx.runTextCommand({ kind: 'setTextColor', color });
  };
  const setSize = (n: number): void => {
    const clamped = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(n)));
    ctx.patchInstance({ text_size: clamped });
  };

  return (
    <div>
      {/* 文字颜色:默认色 + 13 彩(和 Fill 同款色板) */}
      <div className="krig-node-toolbar__label" style={{ marginBottom: 6 }}>文字颜色</div>
      <div className="krig-node-toolbar__swatch-grid">
        {/* 首格:默认色(清除),斜杠示意"无/默认" */}
        <button
          key={DEFAULT_COLOR_SWATCH.name}
          type="button"
          className="krig-node-toolbar__swatch"
          title={DEFAULT_COLOR_SWATCH.name}
          style={{
            background:
              'repeating-linear-gradient(45deg, #555 0 5px, #2a2a2a 5px 10px)',
          }}
          onClick={() => setColor('')}
        />
        {/* 取 13 个彩色(跳过色板里的白,留默认色占首格) */}
        {PALETTE_14.slice(1).map((sw) => (
          <button
            key={sw.name}
            type="button"
            className="krig-node-toolbar__swatch"
            style={{ background: sw.color }}
            title={sw.name}
            onClick={() => setColor(sw.color)}
          />
        ))}
      </div>
      <div className="krig-node-toolbar__row" style={{ marginTop: 8 }}>
        <input
          type="color"
          className="krig-node-toolbar__color-input"
          title="自定义文字颜色"
          defaultValue={normalizeHex(undefined)}
          onChange={(e) => setColor(e.target.value)}
        />
        <span className="krig-node-toolbar__label">自定义</span>
      </div>

      {/* 对齐 */}
      <div className="krig-node-toolbar__row">
        <span className="krig-node-toolbar__label">对齐</span>
        <button
          type="button"
          className="krig-node-toolbar__icon-btn"
          title="左对齐"
          onClick={() => ctx.runTextCommand({ kind: 'setAlign', align: 'left' })}
        >
          ⬅
        </button>
        <button
          type="button"
          className="krig-node-toolbar__icon-btn"
          title="居中"
          onClick={() => ctx.runTextCommand({ kind: 'setAlign', align: 'center' })}
        >
          ⬌
        </button>
        <button
          type="button"
          className="krig-node-toolbar__icon-btn"
          title="右对齐"
          onClick={() => ctx.runTextCommand({ kind: 'setAlign', align: 'right' })}
        >
          ➡
        </button>
      </div>

      {/* 字体族:打包字体下拉 + 系统字体(L5-G7,可搜索 + 嵌入) */}
      <div className="krig-node-toolbar__row">
        <span className="krig-node-toolbar__label">字体</span>
        <select
          className="krig-node-toolbar__select"
          value={curFont.startsWith('embed:') ? '__embedded__' : curFont}
          onChange={(e) => {
            if (e.target.value === '__embedded__') return; // 当前嵌入字体占位项,不动作
            ctx.patchInstance({ text_font: e.target.value as FontFamily });
          }}
        >
          {FONT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
          {curFont.startsWith('embed:') && (
            <option value="__embedded__">已嵌入系统字体</option>
          )}
        </select>
      </div>

      {/* 系统字体导入(view 注入 listSystemFonts 才显) */}
      {ctx.listSystemFonts && ctx.embedSystemFont && <SystemFontGroup ctx={ctx} />}

      {/* 字号(原 Type section 合并入) */}
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

/** license 常驻提示文案(设计 §6 锁定;系统字体分组下方 ⓘ) */
const LICENSE_HINT =
  '嵌入字体会随画板内容一起保存和分发。系统预装的商业字体(如苹方、微软雅黑等)' +
  '可能限制再分发,导出 / 分享前请确认你拥有分发权利。';

/**
 * 系统字体分组(L5-G7.4):折叠区 → 展开懒加载本机系统字体 → 可搜索 → 点击嵌入。
 * 嵌入走 view 注入的 ctx.embedSystemFont(view 端弹 8MB 守卫 + license 确认弹窗)。
 * 同 family 多 style 折叠成一项(默认选 Regular,无则取第一条),避免列表爆炸。
 */
function SystemFontGroup({ ctx }: { ctx: SectionContext }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fonts, setFonts] = useState<SystemFontInfo[] | null>(null);
  const [query, setQuery] = useState('');
  const [embedding, setEmbedding] = useState<string | null>(null);
  const loadedRef = useRef(false);

  // 首次展开懒加载
  useEffect(() => {
    if (!expanded || loadedRef.current || !ctx.listSystemFonts) return;
    loadedRef.current = true;
    setLoading(true);
    ctx
      .listSystemFonts()
      .then((list) => setFonts(list))
      .catch(() => setFonts([]))
      .finally(() => setLoading(false));
  }, [expanded, ctx]);

  // family 去重:每 family 选一条代表(优先 Regular),供列表展示
  const families = useMemo(() => {
    if (!fonts) return [];
    const byFamily = new Map<string, SystemFontInfo>();
    for (const f of fonts) {
      const prev = byFamily.get(f.family);
      if (!prev) byFamily.set(f.family, f);
      else if (/regular/i.test(f.style) && !/regular/i.test(prev.style)) byFamily.set(f.family, f);
    }
    let arr = [...byFamily.values()];
    const q = query.trim().toLowerCase();
    if (q) arr = arr.filter((f) => f.family.toLowerCase().includes(q));
    return arr.slice(0, 300); // 上限防极端长列表卡 DOM
  }, [fonts, query]);

  const onPick = async (font: SystemFontInfo): Promise<void> => {
    if (!ctx.embedSystemFont || embedding) return;
    setEmbedding(font.family);
    try {
      const res = await ctx.embedSystemFont(font);
      if (res) ctx.patchInstance({ text_font: `embed:${res.fontId}` });
    } finally {
      setEmbedding(null);
    }
  };

  return (
    <div className="krig-node-toolbar__sysfont">
      <button
        type="button"
        className="krig-node-toolbar__sysfont-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? '▾' : '▸'} 系统字体
        <span className="krig-node-toolbar__sysfont-info" title={LICENSE_HINT} aria-label={LICENSE_HINT}>
          ⓘ
        </span>
      </button>

      {expanded && (
        <div className="krig-node-toolbar__sysfont-body">
          <input
            type="text"
            className="krig-node-toolbar__sysfont-search"
            placeholder="搜索字体…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {loading && <div className="krig-node-toolbar__sysfont-hint">扫描本机字体中…</div>}
          {!loading && families.length === 0 && (
            <div className="krig-node-toolbar__sysfont-hint">无匹配字体</div>
          )}
          {!loading && families.length > 0 && (
            <ul className="krig-node-toolbar__sysfont-list">
              {families.map((f) => (
                <li key={`${f.family}@${f.path}#${f.fontIndex}`}>
                  <button
                    type="button"
                    className="krig-node-toolbar__sysfont-item"
                    disabled={embedding !== null}
                    onClick={() => void onPick(f)}
                  >
                    <span className="krig-node-toolbar__sysfont-name">{f.family}</span>
                    {embedding === f.family && (
                      <span className="krig-node-toolbar__sysfont-spin">嵌入中…</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="krig-node-toolbar__sysfont-license">{LICENSE_HINT}</div>
        </div>
      )}
    </div>
  );
}

export const textSection: SectionDef = {
  id: 'text',
  title: '文字',
  icon: () => <span aria-hidden style={{ fontWeight: 600 }}>Aa</span>,
  Panel: TextPanel,
};
