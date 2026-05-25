/**
 * BookAnchor — eBook 标注定位元数据 (decision 022 §1.3.1)
 *
 * sub-phase 022 落地: annotation 概念消亡,所有标注转 thought PM block;
 * 24 种 block.attrs 全部加 optional `bookAnchor` 字段承载定位 / 颜色 / 类型 / 截图。
 *
 * 字面三种类型映射 (decision 022 §7.3 convertAnnotationToBlock):
 *   - PDF 框选 (type='rect') + thumbnail → image block + bookAnchor
 *   - PDF 划线 (type='underline') → paragraph block + bookAnchor
 *   - EPUB 选区 (type='highlight') + textContent → blockquote block + bookAnchor
 *
 * cardinality: optional (default null) — 既有 24 block 字面 default null 不影响
 * 既有 note / thought 字面行为 (Step 5.1 场景 3a/3b binary verify PASS)。
 */

export interface BookAnchor {
  /** PDF 页码 (1-based); EPUB 标注此字段 = 0 占位 */
  pageNum: number;
  /** rect 模式: PDF 框选页面坐标 (scale=1);
   *  highlight/strikethrough: 选区 boundingRect (兜底渲染);
   *  EPUB 无 */
  rect?: { x: number; y: number; w: number; h: number };
  /** PR-α-3 (highlight/strikethrough): 选区跨行 rects 数组 (scale=1, 每行一 rect);
   *  rect / underline 不用; EPUB 无 */
  textRects?: Array<{ x: number; y: number; w: number; h: number }>;
  /** EPUB CFI 锚点; PDF 无 */
  cfi?: string;
  /** 选区文本: EPUB 自始, PDF highlight/strikethrough 自 PR-α-3 起也存 */
  textContent?: string;
  /** PDF rect 截图 base64 inline (沿 D-7=A); 文字流不需要 */
  thumbnail?: string;
  /** 5 色 picker: #ffd43b / #69db7c / #74c0fc / #b197fc / #ff6b6b */
  color: string;
  /** rect = PDF 框选, underline = PDF 划线占位,
   *  highlight = 半透明文字背景 (EPUB + PDF 文字流),
   *  strikethrough = PDF 文字中线 (PR-α-3) */
  type: 'rect' | 'underline' | 'highlight' | 'strikethrough';
  createdAt: number;
}
