/**
 * block-visual-spec — 块视觉规格**单一真源**(L5 编辑↔渲染一致性专项 E2)
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 缘起:graph 画板节点有两套独立渲染同一份 doc —
 *   - 编辑态 = note 同源 PM NodeView + pm-host.css(成熟权威,**不动**)
 *   - 渲染态 = atomsToSvg → SVGLoader → THREE mesh(各 block 各自硬编码常量)
 * 两套视觉规格各定各的 → 处处差。本模块抽**公共数值真源**,让**渲染态**读它向
 * **编辑态(note)看齐**,从根上消除"各定各的"。
 *
 * ⭐ 方案乙(总指挥 2026-06-22 拍板):
 *   - 本表是唯一真源;**初值逐条 = pm-host.css 现值**(note 权威观感)。
 *   - **渲染态** atom-serializers/svg/blocks/* 读本表替换硬编码 → 向 note 看齐。
 *   - **pm-host.css(note 消费)一个字不改**(R-shared:note 成熟,只让 graph 适应 note)。
 *   - 单测 `tests/lib/block-visual-spec-vs-pm-host-css.test.ts` 断言本表值 == pm-host.css
 *     权威值,防将来漂移(非物理单一真源,但单测兜底:css 改了不同步会红)。
 *
 * ⚠️ W5:本模块在 `src/lib/visual-spec`(中性位),**纯数据,0 import three / 0 import
 *   pm-host.css / 0 import drivers 运行时**。atom-serializers 可安全 import 它。
 *
 * ⚠️ 改本表 = 改 graph 渲染态观感。改 pm-host.css 对应值时**必须同步本表**(单测会提醒)。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 单位约定:
 * - 字号 / 尺寸:px(绝对值,基于 note 基准字号 BASE_FONT_SIZE=16)。
 * - lineHeight:无量纲倍率(× 字号);pm-host.css 用 1.7。
 * - 渲染态 instance.text_size 缩放:渲染器把绝对 px × (实际 baseFontSize / BASE_FONT_SIZE)
 *   等比缩放(保留画板节点字号语义),故本表存 base16 下的绝对值。
 */

/** note 基准正文字号(pm-host.css `.krig-pm-host` font-size:16px)。渲染态缩放基准。 */
export const BASE_FONT_SIZE = 16;

export interface BlockVisualSpec {
  /** 正文 / 根容器(pm-host.css `.krig-pm-host`) */
  readonly body: {
    /** font-size px(L10 16px) */
    readonly fontSize: number;
    /** line-height 倍率(L11 1.7) */
    readonly lineHeight: number;
    /** color(L8 #e8eaed) */
    readonly color: string;
  };
  /** heading 绝对字号 px(总指挥拍:绝对 px 模型,h1=38/h2=28/h3=22)。h4-h6 退正文。 */
  readonly headings: {
    readonly h1: { readonly fontSize: number; readonly fontWeight: number };
    readonly h2: { readonly fontSize: number; readonly fontWeight: number };
    readonly h3: { readonly fontSize: number; readonly fontWeight: number };
  };
  /** 列表(pm-host.css `.ProseMirror li` / bullet ::before) */
  readonly list: {
    /** li padding-left = marker 列宽 px(L107-111 24px) */
    readonly indentPerLevel: number;
    /** L1 实心圆直径 px(L114-124 6px) */
    readonly bulletDiameter: number;
    /** ordered 序号字号 = 正文 px(继承)。存绝对,渲染态按 base 缩放。 */
    readonly numberFontSize: number;
  };
  /** blockquote(pm-host.css `.krig-blockquote` L253-264) */
  readonly quote: {
    /** 左竖条宽 px(border-left 3px) */
    readonly barWidth: number;
    /** 左竖条 + 文字色(border `#555`;文字 `#aaa`)*/
    readonly barColor: string;
    readonly textColor: string;
    /** padding-left px(16px) */
    readonly indent: number;
    /** 文字斜体(font-style:italic) */
    readonly italic: boolean;
  };
  /** callout(pm-host.css `.krig-callout` L336-378) */
  readonly callout: {
    /** 背景(rgba(255,255,255,0.04)) */
    readonly bgFill: string;
    /** 圆角 px(4px) */
    readonly radius: number;
    /** padding px(16px 四向) */
    readonly padX: number;
    readonly padY: number;
    /** 图标框 px(24px;= base16 × 1.5) */
    readonly iconBox: number;
    /** 图标-文字间距 px(flex gap 8px) */
    readonly iconGap: number;
  };
  /** codeBlock(pm-host.css `.krig-code-block` L267-286) */
  readonly code: {
    /** font-size px(14px) */
    readonly fontSize: number;
    /** line-height 倍率(1.5) */
    readonly lineHeight: number;
    /** 背景(#2a2a2a) */
    readonly bgFill: string;
    /** 边框色(1px solid #3a3a3a) */
    readonly borderColor: string;
    /** 圆角 px(4px) */
    readonly radius: number;
    /** padding px(12px 16px = y x) */
    readonly padX: number;
    readonly padY: number;
    /** 文字色(#e8eaed) */
    readonly textColor: string;
  };
  /** inline marks */
  readonly marks: {
    /** inline code:bg #2a2a2a / 字 #f78c6c 橙 / 圆角 3px(pm-host.css `.ProseMirror code` L76-83) */
    readonly inlineCode: {
      readonly bgFill: string;
      readonly textColor: string;
      readonly radius: number;
    };
    /** link:color #8ab4f8 + underline(`.ProseMirror a[href]` L381-389) */
    readonly link: { readonly color: string };
  };
}

/**
 * ⭐ 单一真源实例。**初值逐条 = pm-host.css 现值**(行号见各注释)。
 *
 * 单测守:`block-visual-spec-vs-pm-host-css.test.ts` 从 pm-host.css 抽对应选择器值核对。
 */
export const BLOCK_VISUAL_SPEC: BlockVisualSpec = {
  body: {
    fontSize: 16,        // pm-host.css .krig-pm-host font-size:16px
    lineHeight: 1.7,     // .krig-pm-host line-height:1.7
    color: '#e8eaed',    // .krig-pm-host color:#e8eaed
  },
  headings: {
    h1: { fontSize: 38, fontWeight: 700 }, // .ProseMirror h1 38px/700
    h2: { fontSize: 28, fontWeight: 600 }, // .ProseMirror h2 28px/600
    h3: { fontSize: 22, fontWeight: 600 }, // .ProseMirror h3 22px/600
  },
  list: {
    indentPerLevel: 24,  // .ProseMirror li padding-left:24px
    bulletDiameter: 6,   // .krig-bullet-list>li::before 6px
    numberFontSize: 16,  // 序号继承正文 16
  },
  quote: {
    barWidth: 3,         // .krig-blockquote border-left:3px
    barColor: '#555',    // border-left color #555
    textColor: '#aaa',   // color:#aaa
    indent: 16,          // padding-left:16px
    italic: true,        // font-style:italic
  },
  callout: {
    bgFill: 'rgba(255,255,255,0.04)', // .krig-callout background
    radius: 4,           // border-radius:4px
    padX: 16,            // padding:16px
    padY: 16,
    iconBox: 24,         // .krig-callout__emoji 24px
    iconGap: 8,          // flex gap:8px
  },
  code: {
    fontSize: 14,        // .krig-code-block font-size:14px
    lineHeight: 1.5,     // line-height:1.5
    bgFill: '#2a2a2a',   // background:#2a2a2a
    borderColor: '#3a3a3a', // border:1px solid #3a3a3a
    radius: 4,           // border-radius:4px
    padX: 16,            // padding:12px 16px → x16
    padY: 12,            //                   → y12
    textColor: '#e8eaed', // color:#e8eaed
  },
  marks: {
    inlineCode: {
      bgFill: '#2a2a2a',   // .ProseMirror code background:#2a2a2a
      textColor: '#f78c6c', // color:#f78c6c
      radius: 3,           // border-radius:3px
    },
    link: { color: '#8ab4f8' }, // .ProseMirror a[href] color:#8ab4f8
  },
};

/**
 * heading level → 字号 px(绝对模型)。paragraph(无 level)/ h4-h6 退正文。
 * 渲染态据此 × (baseFontSize/BASE_FONT_SIZE) 等比缩放(保留 instance.text_size 语义)。
 */
export function headingFontSize(level: unknown): number {
  switch (level) {
    case 1: return BLOCK_VISUAL_SPEC.headings.h1.fontSize;
    case 2: return BLOCK_VISUAL_SPEC.headings.h2.fontSize;
    case 3: return BLOCK_VISUAL_SPEC.headings.h3.fontSize;
    default: return BLOCK_VISUAL_SPEC.body.fontSize; // paragraph / h4-h6
  }
}
