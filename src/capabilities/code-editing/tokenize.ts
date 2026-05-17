/**
 * tokenize — 语法 token 抽取(capability 内 CM6/Lezer 单点屏障)
 *
 * 用途:inline syntax highlight plugin(Phase 2)的同步消费 API。
 *
 * **本模块是 capability 内的 token 适配层**,把 CM6 LanguageSupport / StreamLanguage
 * 两种 SDK 形态统一成"输入 source string → 输出 Token[]";driver 拿到的是纯数据
 * `{ from, to, tag }[]`,**不直接 import @codemirror/* 或 @lezer/***。
 *
 * 设计:
 * - 异步 loader 缓存:第一次 tokenize(lang) 时 await item.loader();后续同步命中缓存
 * - 两种 language 路径:
 *   - `StreamLanguage`(mermaid 类型):用 parser.token(stream, state) 行扫
 *   - `LanguageSupport`(JS/TS/Py/JSON/MD):用 language.parser.parse → highlightTree
 *     + tagHighlighter 拿 tag 字符串
 * - tag 字符串归一(对齐 theme-dark.ts 的 8 类):keyword / comment / string / number /
 *   operator / variableName / attributeName / punctuation;未识别 tag 不产 token
 *
 * 性能:
 * - LanguageSupport(JS/TS/Py)用 Lezer 增量 parse,O(n) 单次几 ms 内
 * - StreamLanguage(mermaid)行扫,O(n*行长)
 * - capability 缓存 loader 实例;driver 侧 plugin 自己防抖按需触发(state apply 不调
 *   tokenize 太频繁)
 */

import { StreamLanguage, type StringStream, Language } from '@codemirror/language';
import { highlightTree, type Highlighter, tagHighlighter, tags } from '@lezer/highlight';
import { getLanguage } from './languages/registry';

export interface TokenSpan {
  /** source 内起点(>=0) */
  from: number;
  /** source 内终点(exclusive) */
  to: number;
  /** 归一后的 tag 名 — 见模块顶部 8 类 */
  tag: string;
}

// ─────────────────────────────────────────────────────────
// Loader 缓存
// ─────────────────────────────────────────────────────────

interface LoadedLang {
  /** loader 返回的对象 — LanguageSupport / StreamLanguage / 其它 */
  ext: unknown;
}

const cache: Map<string, LoadedLang> = new Map();
const inflight: Map<string, Promise<LoadedLang>> = new Map();

/**
 * 确保 language 已 load(若已缓存直接返回);供 plugin 在 init / lang 切换时预热
 */
export async function ensureLanguageLoaded(language: string): Promise<void> {
  if (cache.has(language)) return;
  const existing = inflight.get(language);
  if (existing) {
    await existing;
    return;
  }
  const item = getLanguage(language);
  if (!item) return;
  const p = (async () => {
    try {
      const ext = await item.loader();
      const entry: LoadedLang = { ext };
      cache.set(language, entry);
      return entry;
    } finally {
      inflight.delete(language);
    }
  })();
  inflight.set(language, p);
  await p;
}

/** 同步查询是否已加载(driver plugin state apply 内决定走同步还是异步路径) */
export function isLanguageLoaded(language: string): boolean {
  return cache.has(language);
}

// ─────────────────────────────────────────────────────────
// Tag 归一
// ─────────────────────────────────────────────────────────

// LanguageSupport 路径:用 tagHighlighter 把 Lezer tag 映射到字符串名
// 8 类对齐 theme-dark.ts;额外加几条同义映射(typeName / className 等都归入 variableName,
// 简化 inline 视觉)
const inlineHighlighter: Highlighter = tagHighlighter([
  { tag: tags.keyword, class: 'keyword' },
  { tag: tags.controlKeyword, class: 'keyword' },
  { tag: tags.operatorKeyword, class: 'keyword' },
  { tag: tags.modifier, class: 'keyword' },
  { tag: tags.definitionKeyword, class: 'keyword' },
  { tag: tags.moduleKeyword, class: 'keyword' },
  { tag: tags.comment, class: 'comment' },
  { tag: tags.lineComment, class: 'comment' },
  { tag: tags.blockComment, class: 'comment' },
  { tag: tags.docComment, class: 'comment' },
  { tag: tags.string, class: 'string' },
  { tag: tags.special(tags.string), class: 'string' },
  { tag: tags.regexp, class: 'string' },
  { tag: tags.number, class: 'number' },
  { tag: tags.integer, class: 'number' },
  { tag: tags.float, class: 'number' },
  { tag: tags.operator, class: 'operator' },
  { tag: tags.arithmeticOperator, class: 'operator' },
  { tag: tags.logicOperator, class: 'operator' },
  { tag: tags.bitwiseOperator, class: 'operator' },
  { tag: tags.compareOperator, class: 'operator' },
  { tag: tags.updateOperator, class: 'operator' },
  { tag: tags.variableName, class: 'variableName' },
  { tag: tags.typeName, class: 'variableName' },
  { tag: tags.className, class: 'variableName' },
  { tag: tags.propertyName, class: 'variableName' },
  { tag: tags.function(tags.variableName), class: 'variableName' },
  { tag: tags.attributeName, class: 'attributeName' },
  { tag: tags.punctuation, class: 'punctuation' },
  { tag: tags.bracket, class: 'punctuation' },
  { tag: tags.paren, class: 'punctuation' },
  { tag: tags.brace, class: 'punctuation' },
]);

// ─────────────────────────────────────────────────────────
// Tokenize 主入口(同步,要求已 load — 通过 ensureLanguageLoaded 提前预热)
// ─────────────────────────────────────────────────────────

/**
 * 同步 tokenize — language 必须已 load;未 load 返回空数组(plugin 应先 ensure)
 *
 * 返回的 token 是覆盖 source 的稀疏区间(无 token 的位置不渲染装饰)。
 */
export function tokenizeSync(language: string, source: string): TokenSpan[] {
  if (!language || !source) return [];
  const entry = cache.get(language);
  if (!entry) return [];

  const ext = entry.ext;

  // StreamLanguage 形态(mermaid 自定义)
  if (ext instanceof StreamLanguage) {
    return tokenizeStream(ext, source);
  }

  // LanguageSupport 形态(JS/TS/Py/JSON/MD —— SDK 返回 { language: Language, ... })
  // ext 上有 .language 字段 = Language 实例;Language.parser 是 Lezer parser
  const lang = (ext as { language?: Language }).language;
  if (lang instanceof Language) {
    return tokenizeLezer(lang, source);
  }

  // 兜底:未识别形态
  console.warn(`[code-editing/tokenize] unsupported language ext shape for '${language}'`);
  return [];
}

// ─────────────────────────────────────────────────────────
// Lezer 树 tokenize(LanguageSupport 路径)
// ─────────────────────────────────────────────────────────

function tokenizeLezer(lang: Language, source: string): TokenSpan[] {
  const tree = lang.parser.parse(source);
  const tokens: TokenSpan[] = [];
  highlightTree(tree, inlineHighlighter, (from, to, cls) => {
    if (cls) tokens.push({ from, to, tag: cls });
  });
  return tokens;
}

// ─────────────────────────────────────────────────────────
// StreamLanguage tokenize(mermaid 类型 —— 实际本 plugin 不会处理 mermaid,见 plugin filter)
// ─────────────────────────────────────────────────────────

// StreamLanguage 实例上拿 streamParser 用反射(类型未导出)
interface StreamLangInternal {
  streamParser: {
    startState: () => unknown;
    token: (stream: StringStream, state: unknown) => string | null;
    copyState?: (state: unknown) => unknown;
  };
}

function tokenizeStream(streamLang: StreamLanguage<unknown>, source: string): TokenSpan[] {
  const parser = (streamLang as unknown as StreamLangInternal).streamParser;
  if (!parser) return [];
  const tokens: TokenSpan[] = [];
  const lines = source.split('\n');
  let state = parser.startState();
  let absPos = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    // 构造一个最小 StringStream;CM6 不允许直接 new StringStream,但 @codemirror/language
    // 不导出 StringStream 构造器;用类型守门 + 简易实现兼容(只覆盖 streamParser.token
    // 实际依赖的几个 method —— mermaid-lang.ts 用到的:match / next / current / skipToEnd / eol)
    const stream = createStringStream(line);
    while (!stream.eol()) {
      const startCol = stream.pos;
      stream.start = startCol;
      const tag = parser.token(stream, state);
      const endCol = stream.pos;
      if (endCol === startCol) {
        // 没消费 → 推进一个字符防死循环
        stream.next();
      }
      if (tag) {
        // tag 直接是 string(对齐 inlineHighlighter class 名,如 'keyword' / 'string' / 'number')
        const normalized = normalizeStreamTag(tag);
        if (normalized) {
          tokens.push({
            from: absPos + startCol,
            to: absPos + Math.max(endCol, startCol + 1),
            tag: normalized,
          });
        }
      }
    }
    absPos += line.length + 1; // +1 for '\n'
  }
  return tokens;
}

/** StreamLanguage 的 tag 名可能包含 modifier(如 'string.special');取首段归一 */
function normalizeStreamTag(tag: string): string | null {
  const head = tag.split(/[.\s]/)[0];
  const allowed = new Set([
    'keyword', 'comment', 'string', 'number',
    'operator', 'variableName', 'attributeName', 'punctuation',
  ]);
  if (allowed.has(head)) return head;
  // 兜底 — 把 atom / property / def 等映射到最接近的类
  if (head === 'atom' || head === 'def' || head === 'property') return 'variableName';
  if (head === 'tag') return 'keyword';
  if (head === 'attribute') return 'attributeName';
  return null;
}

// ─────────────────────────────────────────────────────────
// 最小 StringStream 实现(StreamLanguage 走的内部 stream;CM6 未公开导出构造器)
//
// 只覆盖 mermaid-lang.ts / 常见 StreamParser 实现使用的 method:
// match / next / current / skipToEnd / eol / peek / eat / pos
// ─────────────────────────────────────────────────────────

function createStringStream(line: string): StringStream {
  // 用代理实现 StringStream 必需接口;CM6 内部 StreamLanguage.parse 不要求精确 instanceof
  const s = {
    string: line,
    pos: 0,
    start: 0,
    lineStart: 0,
    lastColumnPos: 0,
    lastColumnValue: 0,
    indentUnit: 2,
    tabSize: 2,
    eol(): boolean {
      return this.pos >= this.string.length;
    },
    sol(): boolean {
      return this.pos === 0;
    },
    peek(): string | undefined {
      return this.string.charAt(this.pos) || undefined;
    },
    next(): string | undefined {
      if (this.pos < this.string.length) return this.string.charAt(this.pos++);
      return undefined;
    },
    eat(match: string | RegExp | ((ch: string) => boolean)): string | undefined {
      const ch = this.string.charAt(this.pos);
      let ok = false;
      if (typeof match === 'string') ok = ch === match;
      else if (match instanceof RegExp) ok = match.test(ch);
      else ok = match(ch);
      if (ok) {
        this.pos++;
        return ch;
      }
      return undefined;
    },
    eatWhile(match: string | RegExp | ((ch: string) => boolean)): boolean {
      const start = this.pos;
      while (this.eat(match)) {
        // continue
      }
      return this.pos > start;
    },
    eatSpace(): boolean {
      const start = this.pos;
      while (/\s/.test(this.string.charAt(this.pos))) this.pos++;
      return this.pos > start;
    },
    skipToEnd(): void {
      this.pos = this.string.length;
    },
    skipTo(ch: string): boolean {
      const i = this.string.indexOf(ch, this.pos);
      if (i > -1) {
        this.pos = i;
        return true;
      }
      return false;
    },
    backUp(n: number): void {
      this.pos -= n;
    },
    column(): number {
      return this.pos;
    },
    indentation(): number {
      return 0;
    },
    match(pattern: string | RegExp, consume?: boolean, caseInsensitive?: boolean): unknown {
      if (typeof pattern === 'string') {
        const cased = (s: string): string => (caseInsensitive ? s.toLowerCase() : s);
        const sub = cased(this.string.substr(this.pos, pattern.length));
        if (sub === cased(pattern)) {
          if (consume !== false) this.pos += pattern.length;
          return true;
        }
        return null;
      }
      const m = this.string.slice(this.pos).match(pattern);
      if (m && m.index === 0) {
        if (consume !== false) this.pos += m[0].length;
        return m;
      }
      return null;
    },
    current(): string {
      return this.string.slice(this.start, this.pos);
    },
  };
  return s as unknown as StringStream;
}
