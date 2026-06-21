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

/** 字体值(打包族枚举 / 'auto' / 'embed:<id>');打包族下拉已删,仅作类型 + fallback */
type FontFamily = NonNullable<NodeSnapshot['text_font']>;

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

      {/* 字体:内切字体列表(第一项「默认」+ 本机字体,可搜索)。
          对用户透明 —— 不暴露"系统字体"概念,选了就用(底层按需嵌入)。
          打包字体仍作底层 fallback 隐式存在(text_font 缺省=自动选字 + CJK 缺字回退)。 */}
      {ctx.listSystemFonts && ctx.embedSystemFont && <FontList ctx={ctx} curFont={curFont} />}

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

/** license 提示(设计 §6;降级为「字体」标题旁 ⓘ tooltip,不占视觉、保提示义务) */
const LICENSE_HINT =
  '选用本机字体会随画板内容一起保存和分发。系统预装的商业字体(如苹方、微软雅黑等)' +
  '可能限制再分发,导出 / 分享前请确认你拥有分发权利。';

/**
 * 字体列表(L5-G7.4 内切版):标题 + 搜索 + 列表,直接铺进 Aa 面板,与颜色 / 对齐同级。
 *
 * 对用户透明 —— 不暴露"系统字体"概念,就是一个「字体」列表:
 * - 第一项「默认」= text_font:'auto'(回到自动选字)
 * - 其余 = 本机字体名;点击即用(底层 embedSystemFont 按需嵌入,无感)
 * - 当前选中项打勾高亮
 * - 首次挂载懒加载(扫描 ~0.5s);可搜索
 */
function FontList({ ctx, curFont }: { ctx: SectionContext; curFont: FontFamily }): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [fonts, setFonts] = useState<SystemFontInfo[] | null>(null);
  const [query, setQuery] = useState('');
  const [embedding, setEmbedding] = useState<string | null>(null);
  const loadedRef = useRef(false);

  // 首次挂载懒加载本机字体
  useEffect(() => {
    if (loadedRef.current || !ctx.listSystemFonts) return;
    loadedRef.current = true;
    setLoading(true);
    ctx
      .listSystemFonts()
      .then((list) => setFonts(list))
      .catch(() => setFonts([]))
      .finally(() => setLoading(false));
  }, [ctx]);

  // family 去重(每 family 留一条代表,优先 Regular)+ 搜索过滤
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

  const isDefault = !curFont.startsWith('embed:');

  const pickDefault = (): void => ctx.patchInstance({ text_font: 'auto' });

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
    <div className="krig-node-toolbar__fontlist">
      <div className="krig-node-toolbar__fontlist-head">
        <span className="krig-node-toolbar__label">字体</span>
        <span className="krig-node-toolbar__fontlist-info" title={LICENSE_HINT} aria-label={LICENSE_HINT}>
          ⓘ
        </span>
      </div>

      <input
        type="text"
        className="krig-node-toolbar__fontlist-search"
        placeholder="搜索字体…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <ul className="krig-node-toolbar__fontlist-items">
        {/* 第一项:默认(回到自动选字)。搜索时无关键词或匹配"默认"才显。 */}
        {(!query.trim() || '默认'.includes(query.trim())) && (
          <li>
            <button
              type="button"
              className={
                'krig-node-toolbar__fontlist-item' + (isDefault ? ' is-active' : '')
              }
              onClick={pickDefault}
            >
              <span className="krig-node-toolbar__fontlist-name">默认</span>
              {isDefault && <span className="krig-node-toolbar__fontlist-check">✓</span>}
            </button>
          </li>
        )}

        {loading && (
          <li className="krig-node-toolbar__fontlist-hint">加载字体…</li>
        )}
        {!loading &&
          families.map((f) => (
            <li key={`${f.family}@${f.path}#${f.fontIndex}`}>
              <button
                type="button"
                className="krig-node-toolbar__fontlist-item"
                disabled={embedding !== null}
                onClick={() => void onPick(f)}
              >
                <span className="krig-node-toolbar__fontlist-name">{f.family}</span>
                {embedding === f.family && (
                  <span className="krig-node-toolbar__fontlist-spin">…</span>
                )}
              </button>
            </li>
          ))}
      </ul>
    </div>
  );
}

export const textSection: SectionDef = {
  id: 'text',
  title: '文字',
  icon: () => <span aria-hidden style={{ fontWeight: 600 }}>Aa</span>,
  Panel: TextPanel,
};
