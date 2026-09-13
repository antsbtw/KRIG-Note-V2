/**
 * def 块 —— note ⇄ graph 的映射通道(记法 `00 §2.5`,mind 词表 `01 §7.7`)
 *
 * ⭐⭐ **就是一段普通 paragraph**,首尾各一行 `+++`,零新块类型:
 * ```
 * # 技术选型
 * +++
 * id: B
 * shape: 菱形
 * B -.支撑.-> C
 * +++
 * 这里开始才是正文
 * ```
 *
 * ⚠️ **为什么非有不可**(离线探针实测):联系线**存盘即丢** ——
 * `treeToNoteDoc` 只吐 block 序列不碰 edges,`noteDocToTree` 反向硬写 `edges: []`。
 * ⭐ 与「正文存盘即丢」(`03 §5.6.1`)同一形态:**不是某层代码错,是存储格式装不下**。
 *
 * ── 本模块的边界(⚠️ 别越界)────────────────────────────
 * ⭐ 这里只做**词法**(图种无关):拆行、分类、别名表、原样保留。
 * ⚠️ **不认识任何 mind 语义** —— 「关系行是联系线还是骨架」由调用方判断
 * (`00 §2.5.5`:mind 的 `A --> B` 是树外附加,bpmn 是骨架本身,可汇合可回边;
 *  ⭐ **共用解析器可以,共用含义不行**)。
 *
 * ⚠️ 按 `00 §2.5.9`:**不预建通用能力目录** —— 现在只有 mind 一个真实使用者,
 * 拿一个用例设计通用层极易做出「只适合 mind 的通用层」。故本文件是纯函数、
 * 不绑树假设,等 bpmn 开工(第二个使用者)再谈抽象。
 */

/** def 块的开合记号。⚠️ 不用 `---`:行首 `---` 在 note 里已被 horizontalRule 占用。 */
export const DEF_FENCE = '+++';

/** 一行在 def 块里的归类(`01 §7.7.1` 的 ①~⑥)。 */
export type DefLine =
  | { readonly kind: 'kv'; readonly key: string; readonly value: string; readonly raw: string }
  | { readonly kind: 'rel'; readonly source: string; readonly target: string; readonly label?: string; readonly raw: string }
  | { readonly kind: 'other'; readonly raw: string };

export interface DefBlock {
  readonly lines: readonly DefLine[];
}

/**
 * 关系行:`A -.标签.-> C` / `A -.-> C`。
 *
 * ⚠️ mind **只认虚线箭头** —— 实线 `-->` 留给 bpmn 当序列流(`01 §7.7.2`):
 * 树的父子由 hn 层级表达,不该有第二种写法。
 */
// ⚠️ 两种写法都要认:带标签 `-.支撑.->` 与不带标签 `-.->`。
//   第一版只写了 `-\.([^.]*)\.->`,要求标签两侧各一个点 ——
//   而 `-.->` 只有两个点(两侧共用),于是**无标签写法整个匹配不上**
//   (探针实证:`A -.-> C` 被归成 other → 边根本没造出来)。
const REL_RE = /^\s*(\S+)\s*-\.(?:([^.]*)\.)?->\s*(\S+)\s*$/;
/** `key: value`。⚠️ 值可以含冒号(如 URL),故只切第一个。 */
const KV_RE = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/;

/** 单行 → 归类。⚠️ 认不出的一律 `other`(**原样保留**,`04 §0.6.3`)。 */
export function classifyDefLine(raw: string): DefLine {
  const rel = REL_RE.exec(raw);
  if (rel) {
    const label = (rel[2] ?? '').trim();
    return { kind: 'rel', source: rel[1], target: rel[3], ...(label ? { label } : {}), raw };
  }
  // ⚠️ 注释行(`#` 起头)归 other —— 解析忽略,但写回时保留
  if (!raw.trimStart().startsWith('#')) {
    const kv = KV_RE.exec(raw);
    if (kv) return { kind: 'kv', key: kv[1], value: kv[2].trim(), raw };
  }
  return { kind: 'other', raw };
}

/**
 * 把 paragraph 的 inline 内容摊成文本行(hardBreak = 换行)。
 * ⚠️ 只认 text / hardBreak:def 块里出现富文本(公式等)不该发生,
 * 真出现了也走 `other` 原样保留,不报错。
 */
function inlineToLines(content: readonly { type: string; text?: string }[] | undefined): string[] {
  const lines: string[] = [''];
  for (const n of content ?? []) {
    if (n.type === 'hardBreak') lines.push('');
    else if (typeof n.text === 'string') lines[lines.length - 1] += n.text;
  }
  return lines;
}

/**
 * 这个块是不是 def 块?
 *
 * 判据:paragraph、首行 `+++`、且**有闭合** `+++`。
 * ⚠️ 没闭合 → **不是 def 块**,按普通正文处理(fail safe:
 * 少写一行 `+++` 不会把后文全吞进元数据区)。
 */
export function isDefBlock(node: { type: string; content?: readonly { type: string; text?: string }[] }): boolean {
  if (node.type !== 'paragraph') return false;
  const lines = inlineToLines(node.content);
  if (lines.length < 2) return false;
  if (lines[0].trim() !== DEF_FENCE) return false;
  return lines.slice(1).some((l) => l.trim() === DEF_FENCE);
}

/** 解析 def 块 —— 取首尾 `+++` 之间的行。⚠️ 调用前先 `isDefBlock`。 */
export function parseDefBlock(node: { content?: readonly { type: string; text?: string }[] }): DefBlock {
  const lines = inlineToLines(node.content);
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === DEF_FENCE);
  const body = close < 0 ? lines.slice(1) : lines.slice(1, close);
  return { lines: body.map(classifyDefLine) };
}

/**
 * def 块 → paragraph(写回)。
 *
 * ⭐⭐ **逐字节互逆的关键**:每行都写 `raw`,不重新格式化 ——
 * 用户写 `id:B`(无空格)就还他 `id:B`,不许"顺手规范化"成 `id: B`。
 * ⚠️ 往返不收敛是「正文存盘即丢」「节点增殖」两个坑的共同根因(`01 §7.7.3`)。
 */
export function serializeDefBlock(block: DefBlock): { type: 'paragraph'; content: { type: string; text?: string }[] } {
  const all = [DEF_FENCE, ...block.lines.map((l) => l.raw), DEF_FENCE];
  const content: { type: string; text?: string }[] = [];
  all.forEach((line, i) => {
    if (i > 0) content.push({ type: 'hardBreak' });
    if (line !== '') content.push({ type: 'text', text: line });
  });
  return { type: 'paragraph', content };
}

/** 取某个 key 的值(最后一次出现为准)。 */
export function defValue(block: DefBlock, key: string): string | undefined {
  let out: string | undefined;
  for (const l of block.lines) if (l.kind === 'kv' && l.key === key) out = l.value;
  return out;
}

/** 该块声明的全部关系行(⚠️ 别名尚未解析成 NodeId,由调用方解)。 */
export function defRelations(block: DefBlock): readonly { source: string; target: string; label?: string }[] {
  return block.lines.filter((l): l is Extract<DefLine, { kind: 'rel' }> => l.kind === 'rel');
}

// ─────────────────────────────────────────────────────────
// `/def` 入口用:骨架生成与别名分配(`00 §2.5.7`)
// ─────────────────────────────────────────────────────────

/**
 * 下一个可用别名 —— A, B, C … Z, A2, B2 …
 *
 * ⭐ 取**第一个没被占的**,不是按个数递增:
 * 用户删掉中间某个节点后,那个字母该能被重新用上。
 * ⚠️ 26 个用完后**不许塌缩成重复** —— 撞车的别名会让关系行指向错误的节点。
 */
export function nextDefAlias(used: readonly string[]): string {
  const taken = new Set(used);
  for (let round = 1; round < 1000; round += 1) {
    for (let i = 0; i < 26; i += 1) {
      const name = String.fromCharCode(65 + i) + (round === 1 ? '' : String(round));
      if (!taken.has(name)) return name;
    }
  }
  // ⚠️ fail loud:真走到这里说明别名用尽(2.6 万个),不静默返回空串
  throw new Error('def 别名耗尽');
}

/**
 * `/def` 插入的骨架 —— 只有一行 `id:`。
 *
 * ⭐ 其余字段**用户按需补**(`00 §2.5.2`:行数可变、只写关键行、逐步补充),
 * 不预填一堆注释行去教学 —— 那会让每个节点下面都杵着一坨。
 */
export function buildDefSkeleton(alias: string): {
  type: 'paragraph';
  content: { type: string; text?: string }[];
} {
  return serializeDefBlock({ lines: [classifyDefLine(`id: ${alias}`)] });
}
