import * as opentype from 'opentype.js';
import { FONT_URLS, type FontKey } from './fonts';

/**
 * 字体缓存键:打包字体 FontKey,或系统字体 `sysname:<family>`(L5-G7b 记名方案)。
 *
 * 转向(L5-G7b):画板**不嵌入字体本体**,只记 `sysname:<family>`。本机渲染 / 导出时
 * 经 IPC(fontReadByName)按 family 名实时向主进程要 buffer 喂 opentype。
 * 对方没装该字体 → 读不到 → 回退**打包字体**(打包字体字符全覆盖,红线:不乱码)。
 */
export type FontCacheKey = FontKey | `sysname:${string}`;

const SYSNAME_PREFIX = 'sysname:';
const SYSNAME_BOLD_PREFIX = 'sysname:bold:';

/** key 是否系统字体(记名;含 bold 变体 `sysname:bold:<family>`) */
export function isSysnameKey(key: string): key is `sysname:${string}` {
  return key.startsWith(SYSNAME_PREFIX);
}

/** sysname key → { family, bold }(`sysname:bold:<family>` = 粗体变体) */
function parseSysnameKey(key: `sysname:${string}`): { family: string; bold: boolean } {
  if (key.startsWith(SYSNAME_BOLD_PREFIX)) {
    return { family: key.slice(SYSNAME_BOLD_PREFIX.length), bold: true };
  }
  return { family: key.slice(SYSNAME_PREFIX.length), bold: false };
}

/** family + bold → sysname 缓存键(bold 变体独立键,缓存不撞)。供 pickFontForChar 用 */
function sysnameKeyOf(family: string, bold: boolean): `sysname:${string}` {
  return bold ? `${SYSNAME_BOLD_PREFIX}${family}` : `${SYSNAME_PREFIX}${family}`;
}

const cache = new Map<FontCacheKey, Promise<opentype.Font>>();

/** 字体加载耗时（v1.3 § 10.2 perf 指标） */
const loadStats: Partial<Record<string, { ms: number; sizeKb: number }>> = {};

export function getFontLoadStats(): Partial<Record<string, { ms: number; sizeKb: number }>> {
  return { ...loadStats };
}

/**
 * 加载字体(打包 FontKey 或系统字体 `sysname:<family>`)。
 * - 打包:fetch(FONT_URLS[key])
 * - 系统字体(记名):IPC fontReadByName(family) 向主进程要 buffer(主进程按名查扫描结果
 *   → readFontBinary 抽 sfnt)。读不到(对方没装 / 读失败)→ **throw**,由 text-to-path
 *   的 splitByFont 捕获并回退打包字体(红线:不乱码)。
 * 结果按 key 进 Map 缓存(打包 / 系统键互不撞)。
 */
export function loadFont(key: FontCacheKey): Promise<opentype.Font> {
  let p = cache.get(key);
  if (p) return p;

  p = (async () => {
    const t0 = performance.now();
    let buffer: ArrayBuffer;
    if (isSysnameKey(key)) {
      const { family, bold } = parseSysnameKey(key);
      // bold 变体:IPC 带 bold,主进程优先取该 family 的 Bold style 文件(无则回退 Regular)
      const ab = (await window.electronAPI?.fontReadByName?.(family, bold)) ?? null;
      if (!ab) {
        // 对方没装该字体 / 读失败 → fail loud + throw(splitByFont 回退打包字体)
        throw new Error(`[font-loader] 系统字体不可用,回退打包: ${family}${bold ? ' (bold)' : ''}`);
      }
      buffer = ab;
    } else {
      buffer = await fetch(FONT_URLS[key]).then((r) => r.arrayBuffer());
    }
    const font = opentype.parse(buffer);
    const dt = performance.now() - t0;
    const sizeKb = buffer.byteLength / 1024;
    loadStats[key] = { ms: dt, sizeKb };
    console.info(`[font-loader] ${key} loaded in ${dt.toFixed(1)}ms (${sizeKb.toFixed(0)}KB)`);
    return font;
  })();

  cache.set(key, p);
  // 系统字体读失败(对方没装)→ 从缓存剔除,下次仍可重试(用户后续装了 / 换字体)。
  // 打包字体加载失败属真异常,保留缓存以免反复重试。
  if (isSysnameKey(key)) p.catch(() => cache.delete(key));
  return p;
}

/** 简单 CJK 检测：U+4E00..U+9FFF 基本汉字区 + U+3400..U+4DBF + U+3000..U+303F 标点 */
export function isCjk(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0xff00 && code <= 0xffef) // 全角符号
  );
}

/**
 * Mark 集合：决定使用哪种字体变体。
 *
 * 优先级（顶到底）：
 * - code: 等宽字体（覆盖 bold/italic，因为我们没装 mono bold/italic）
 * - bold + italic: 暂用 bold（没装 BoldItalic）
 * - bold: bold 字体
 * - italic: italic 字体
 * - 默认: regular
 *
 * v1.3 § 4.4.1 / spec § 4.3 mark 优先级。
 */
export interface MarkSet {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  code?: boolean;
  /** textStyle mark.attrs.color — 文字颜色(CSS 颜色字符串) */
  textColor?: string;
  /** highlight mark.attrs.color — 文字背景颜色(CSS 颜色字符串) */
  bgColor?: string;
  /** link mark.attrs.href — 渲染时加下划线 + 链接色(若没显式 textColor) */
  linkHref?: string;
  /**
   * 字体族覆盖(L5-G5 Type section)。画板文字节点 instance.text_font 透传至此,
   * 优先于自动选择(仅作用于该字体覆盖的字符集 — CJK 字符仍强制走中文字体,
   * 西文字体无中文字形必丢字)。undefined / 'auto' = 维持自动选择。
   */
  fontFamily?: FontFamily;
}

/**
 * 字体族(L5-G5 §5.4,用户选项)。'auto' = 不覆盖,走 mark/CJK 自动选择。
 *
 * L5-G6 已打包(全 SIL OFL 1.1):中文 黑(Noto Sans SC)/ 宋(Noto Serif SC)/ 楷手写(LXGW 文楷);
 * 西文 Sans(Inter)/ Serif(Source Serif 4)/ Mono(JetBrains)/ 手写(Caveat)。
 * 仅 Regular 字重有专属文件;bold/italic 暂回退已装变体(见 resolveFamilyFont),不丢字不伪粗。
 *
 * L5-G7b:新增 `sysname:<family>` —— 记用户系统字体的 family 名(**不嵌入**)。
 * pickFontForChar 识别前缀直接用该系统字体;本机渲染按名 IPC 读 buffer,对方没装 /
 * 缺字 → 回退打包字体(G7-8 + 记名回退,见 text-to-path)。
 */
export type FontFamily = 'auto' | 'sans' | 'serif' | 'mono' | 'handwriting' | `sysname:${string}`;

/**
 * 字体族 + CJK + bold/italic → FontKey。
 *
 * CJK 强制走中文字体(西文字体无中文字形);西文按 family 选。
 * serif→中文宋/西文 Source Serif;handwriting→中文楷(LXGW)/西文 Caveat。
 */
function resolveFamilyFont(family: FontFamily, cjk: boolean, marks?: MarkSet): FontKey {
  if (cjk) {
    // 中文:按字体族选对应中文字体(L5-G6 已打包 黑/宋/楷)。
    // 注:Serif/楷 暂无专属 Bold 文件 → bold 时回退黑体 Bold(有真粗体笔形,不伪粗)。
    switch (family) {
      case 'serif':
        return marks?.bold ? 'notoSansScBold' : 'notoSerifSc';
      case 'handwriting':
        return marks?.bold ? 'notoSansScBold' : 'lxgwWenKai';
      case 'mono':
        // 中文无等宽变体 → 黑体(对齐 code mark 既有 fallback)
        return marks?.bold ? 'notoSansScBold' : 'notoSansSc';
      case 'sans':
      default:
        return marks?.bold ? 'notoSansScBold' : 'notoSansSc';
    }
  }
  switch (family) {
    case 'mono':
      return 'jetBrainsMono';
    case 'serif':
      // 西文衡线体(Source Serif 4);暂无专属 Bold/Italic 文件 → 回退 Inter 变体
      if (marks?.bold) return 'interBold';
      if (marks?.italic) return 'interItalic';
      return 'sourceSerif';
    case 'handwriting':
      // 西文手写(Caveat);暂无专属变体 → bold/italic 回退 Inter
      if (marks?.bold) return 'interBold';
      if (marks?.italic) return 'interItalic';
      return 'caveat';
    case 'sans':
    default:
      if (marks?.bold) return 'interBold';
      if (marks?.italic) return 'interItalic';
      return 'inter';
  }
}

/**
 * 根据字符 + mark 集合选字体：
 * - marks.fontFamily(Type section 覆盖,非 'auto')→ resolveFamilyFont
 * - code mark: JetBrains Mono（CJK 字符 fallback 到 Noto SC，因为 mono 没中文）
 * - CJK + bold: Noto SC Bold
 * - CJK: Noto SC Regular
 * - 西文 + bold: Inter Bold
 * - 西文 + italic: Inter Italic
 * - 西文: Inter Regular
 *
 * 注：当前未装 BoldItalic 变体，bold + italic 同时存在时优先 bold；
 * 未来需要时再加 Inter-BoldItalic.ttf。
 */
export function pickFontForChar(ch: string, marks?: MarkSet): FontCacheKey {
  const cjk = isCjk(ch);

  // Type section 字体族覆盖优先(code mark 仍强制等宽,语义不被字体族盖)
  const family = marks?.fontFamily;
  if (family && family !== 'auto' && !marks?.code) {
    // L5-G7b:系统字体(记名)。bold 修复:按 marks.bold 切粗体变体 key
    // (`sysname:bold:<family>` → IPC 取该 family 的 Bold style 文件)。
    // 对方没装 / 无 Bold 文件 / CJK 缺字 → 回退由 loadFont throw + text-to-path 兜底。
    if (isSysnameKey(family)) {
      const { family: fam } = parseSysnameKey(family);
      return sysnameKeyOf(fam, marks?.bold === true);
    }
    return resolveFamilyFont(family, cjk, marks);
  }

  if (marks?.code) {
    // code mark 用等宽字体;CJK 没等宽变体,fallback Noto SC
    return cjk ? 'notoSansSc' : 'jetBrainsMono';
  }

  if (cjk) {
    return marks?.bold ? 'notoSansScBold' : 'notoSansSc';
  }

  if (marks?.bold) return 'interBold';
  if (marks?.italic) return 'interItalic';
  return 'inter';
}

/**
 * L5-G7b(G7-8 缺字回退 + 记名回退):当系统字体没有某字符字形、或对方根本没装该
 * 系统字体时,选哪个**打包**字体兜底。等价于把 fontFamily 当 'auto' 重新走自动选字
 * (打包 CJK / Inter 等),保证不乱码不丢字(红线:回退落到打包字体)。
 * text-to-path 在探测到系统字体缺字 / 加载失败时调用。
 */
export function pickPackagedFallbackForChar(ch: string, marks?: MarkSet): FontKey {
  const noSys: MarkSet | undefined = marks ? { ...marks, fontFamily: 'auto' } : undefined;
  const key = pickFontForChar(ch, noSys);
  // noSys 后 pickFontForChar 不会再返回 sysname key,这里收窄类型
  return isSysnameKey(key) ? 'notoSansSc' : key;
}
