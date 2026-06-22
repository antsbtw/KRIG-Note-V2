import {
  loadFont,
  pickFontForChar,
  pickPackagedFallbackForChar,
  isSysnameKey,
  type MarkSet,
  type FontCacheKey,
} from './font-loader';

/**
 * F1 路径：opentype.js 把文字 outline 化为 SVG path。
 *
 * 字符级混排策略：
 * - 文本按字符切分
 * - 每字符按 CJK + mark 选择字体（Inter / NotoSC / JetBrains Mono × R/B/I）
 * - 同字体连续字符合并一次 getPath 调用，减小 path 数量
 * - 输出多个 <path d="..." fill="..." />，水平串联
 *
 * Marks 支持（v1.3 § 4.3 / Phase 2.2）：
 * - bold:      切到 *-Bold 字重
 * - italic:    切到 Inter-Italic（CJK 无 italic 变体，回退 regular）
 * - code:      切到 JetBrains Mono（CJK 回退 Noto SC）+ 调用方加背景 path
 * - underline: 调用方在文字下方加一根 path（本函数返回 advance 让调用方计算）
 *
 * 返回的 svg path 默认 fill="#dddddd"（适合深色背景），调用方可覆盖。
 */
export async function textToPath(
  text: string,
  fontSize: number,
  startX: number,
  baselineY: number,
  fill = '#dddddd',
  marks?: MarkSet,
): Promise<{ svg: string; advance: number }> {
  if (!text) return { svg: '', advance: 0 };

  const segments = await splitByFont(text, marks);
  const parts: string[] = [];
  let x = startX;

  for (const seg of segments) {
    // 记名方案:系统字体可能加载失败(对方没装)→ 回退打包字体重选(红线:不乱码)。
    let font;
    try {
      font = await loadFont(seg.fontKey);
    } catch {
      const fb = pickPackagedFallbackForChar(seg.text[0] ?? 'A', marks);
      font = await loadFont(fb);
    }
    const path = font.getPath(seg.text, x, baselineY, fontSize);
    const d = path.toPathData(2);
    if (d) {
      parts.push(`<path d="${d}" fill="${fill}" />`);
    }
    const advance = font.getAdvanceWidth(seg.text, fontSize);
    x += advance;
  }

  return { svg: parts.join(''), advance: x - startX };
}

interface FontSegment {
  text: string;
  fontKey: FontCacheKey;
}

/**
 * 按字符选字体分段。系统字体(L5-G7b 记名)回退:若选中的是 sysname 字体,但
 *  - 对方没装该字体(loadFont 抛错),或
 *  - 该字符在系统字体里没有字形(charToGlyphIndex === 0),
 * 则回退到**打包字体**(G7-8 + 记名回退,红线:不乱码不丢字)。
 * 因需探测系统字体字形 → 异步(loadFont 有缓存,探测廉价)。
 */
async function splitByFont(text: string, marks?: MarkSet): Promise<FontSegment[]> {
  const out: FontSegment[] = [];
  let current: FontSegment | null = null;

  for (const ch of text) {
    let fontKey = pickFontForChar(ch, marks);
    // 系统字体没装 / 缺字 → 回退打包字体(保证任意字符不乱码)
    if (isSysnameKey(fontKey) && !(await sysnameHasGlyph(fontKey, ch))) {
      fontKey = pickPackagedFallbackForChar(ch, marks);
    }
    if (current && current.fontKey === fontKey) {
      current.text += ch;
    } else {
      if (current) out.push(current);
      current = { text: ch, fontKey };
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * 系统字体(记名)是否含某字符字形(glyph index !== 0 = 非 .notdef)。
 * 加载失败(对方没装该字体)→ 按"无字形"回退打包字体(红线:不乱码)。
 */
async function sysnameHasGlyph(fontKey: `sysname:${string}`, ch: string): Promise<boolean> {
  try {
    const font = await loadFont(fontKey);
    return font.charToGlyphIndex(ch) !== 0;
  } catch {
    return false;
  }
}
