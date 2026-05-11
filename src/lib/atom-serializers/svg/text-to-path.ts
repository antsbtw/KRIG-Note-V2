import { loadFont, pickFontForChar, type MarkSet } from './font-loader';
import type { FontKey } from './fonts';

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

  const segments = splitByFont(text, marks);
  const parts: string[] = [];
  let x = startX;

  for (const seg of segments) {
    const font = await loadFont(seg.fontKey);
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
  fontKey: FontKey;
}

function splitByFont(text: string, marks?: MarkSet): FontSegment[] {
  const out: FontSegment[] = [];
  let current: FontSegment | null = null;

  for (const ch of text) {
    const fontKey = pickFontForChar(ch, marks);
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
