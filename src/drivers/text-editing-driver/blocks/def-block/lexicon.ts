/**
 * def 块词法 —— ⭐ note 的能力,图种无关(`00 §2.5` / 归属见 `00 §2.5.9`)
 *
 * ```
 * # 技术选型         ← 被定义的块(甲:def 定义紧挨它前面那个块)
 * +++
 * id: B
 * shape: 菱形
 * B -.支撑.-> C
 * +++
 * ```
 *
 * ── 边界(⚠️ 别越界)────────────────────────────────────
 * ⭐ 本模块只做**词法**:拆行、认形态、原样保留、别名分配。
 * ⚠️ **不解释任何 key 的含义** —— `role:` 是什么是 mind 的事,
 * bpmn 可以有完全不同的词表(`00 §2.5.5`:**共用解析器可以,共用含义不行**)。
 * ⚠️ 同一行 `A --> B` 在 mind 是树外附加、在 bpmn 是骨架本身,
 * 本模块只报告「这是一条关系行,源 A、目标 B」,含义留给调用方。
 *
 * ⚠️ 归属:def **一开始就是 note 的能力**,不是从 mind 抽出来的共性 ——
 * 前一版建在 `capabilities/diglot-model/` 是把地基盖在二楼,已整体回退
 * (c8475b55 / 588df07e)。词法逻辑经验证正确,搬来 note 侧。
 */

/** def 块的开合记号。⚠️ 不用 `---`:行首 `---` 已被 horizontalRule 输入规则占用。 */
export const DEF_FENCE = '+++';

/** 一行在 def 块里的归类(`01 §7.7.1` 的 ①~⑥)。 */
export type DefLine =
  | { readonly kind: 'kv'; readonly key: string; readonly value: string; readonly raw: string }
  | {
      readonly kind: 'rel';
      readonly source: string;
      readonly target: string;
      readonly label?: string;
      readonly raw: string;
    }
  | { readonly kind: 'other'; readonly raw: string };

export interface DefBlock {
  readonly lines: readonly DefLine[];
}

/**
 * 关系行:`A -.标签.-> C` / `A -.-> C`。
 *
 * ⚠️ 两种写法都要认。第一版只写了 `-\.([^.]*)\.->`,要求标签两侧各一个点 ——
 * 而 `-.->` 只有两个点(两侧共用),于是**无标签写法整个匹配不上**
 * (探针实证:`A -.-> C` 被归成 other → 边根本没造出来)。
 */
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
 * def 块正文(不含首尾 `+++`)→ 归类后的行。
 *
 * ⭐ 输入是**块内文本**:defBlock 是真块(`content: 'text*'`),`+++` 是块的
 * 边框由 NodeView 画,不在文本里 —— 与前一版「paragraph 里塞两行 `+++`」不同。
 */
export function parseDefText(text: string): DefBlock {
  // ⚠️ 空块 = 零行,不是「一行空串」—— 否则写回会多出一个空行,往返不收敛。
  if (text === '') return { lines: [] };
  return { lines: text.split('\n').map(classifyDefLine) };
}

/**
 * def 块 → 块内文本(写回)。
 *
 * ⭐⭐ **逐字节互逆的关键**:每行都写 `raw`,不重新格式化 ——
 * 用户写 `id:B`(无空格)就还他 `id:B`,不许"顺手规范化"成 `id: B`。
 * ⚠️ 往返不收敛是「正文存盘即丢」「节点增殖」两个坑的共同根因(`01 §7.7.3`)。
 */
export function serializeDefText(block: DefBlock): string {
  return block.lines.map((l) => l.raw).join('\n');
}

/** 取某个 key 的值(最后一次出现为准)。 */
export function defValue(block: DefBlock, key: string): string | undefined {
  let out: string | undefined;
  for (const l of block.lines) if (l.kind === 'kv' && l.key === key) out = l.value;
  return out;
}

/** 该块声明的全部关系行(⚠️ 别名尚未解析成任何 id,由调用方解)。 */
export function defRelations(
  block: DefBlock,
): readonly { source: string; target: string; label?: string }[] {
  return block.lines.filter((l): l is Extract<DefLine, { kind: 'rel' }> => l.kind === 'rel');
}

/**
 * 分配一个没被占用的别名。
 *
 * ⭐ 取**第一个没被占的**(A,B,…,Z,A2,B2…),⚠️ **不是按个数递增** ——
 * 用户删掉中间节点后那个字母该能重用;按个数递增会在删除后撞车,
 * 撞车的别名让关系行指向错节点(`00 §2.5.4`)。
 * ⚠️ 26 个用完继续 A2/B2…,**不许塌缩成重复**;真耗尽 throw,不静默返空串。
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
  throw new Error('[def-block] 别名耗尽(已用满 A..Z999)');
}

/**
 * ⭐⭐ 层级别名:`L<层号>-<同层序号>`(用户 2026-09-13 拍板,推翻纯 A/B/C)。
 *
 * > 用户原话:「根据层级来做标识……这样用户不要翻究竟是哪个层级的节点,
 * > **很容易判断和再标注**。」
 *
 * ```
 * # 主题        L1-1
 * ## 分支A      L2-1
 * ### 叶子1     L3-1
 * ### 叶子3     L3-2
 * ## 分支B      L2-2
 * ### 叶子2     L3-3     ← ⭐ 同层连续编号(不按父分组)
 * ```
 *
 * ⚠️⚠️ **别名仍然不是身份**(`00 §2.5.3` 那条没变)——
 * 真身份永远是 block id(ULID)。L 编号只是**人写的书写便利**,
 * 且因为它**编码了位置**,层级一变就得重编号(见 `renumberAliases`)。
 *
 * ⚠️ 层号从 **1** 起(顶层 = L1),与用户口径一致;
 * 内部树深度从 0 起,故 `层号 = depth + 1`。
 */
export function levelAlias(depth: number, indexInLevel: number): string {
  return `L${depth + 1}-${indexInLevel + 1}`;
}

/** ⭐ 认出 L 编号形态(用于判断某别名是不是机器管的)。⚠️ 手写的 A/B/C 不匹配。 */
const LEVEL_ALIAS_RE = /^L(\d+)-(\d+)$/;

export function isLevelAlias(alias: string): boolean {
  return LEVEL_ALIAS_RE.test(alias);
}

/**
 * ⭐⭐ 按新层级重写 def 文本里的别名 —— **`id:` 行与关系行同步改**。
 *
 * ⚠️⚠️ **这是本特性唯一危险的地方**:机器改用户写的文本。
 * 两条纪律钉死风险:
 * 1. ⭐ **只动 L 编号**(`isLevelAlias`)—— 用户手写的 `id: A`、`id: 我的节点`
 *    **一个字都不碰**。想要机器管就用 L 编号,想自己管就写别的名字。
 * 2. ⭐ **只动别名 token**,行里其它字节(标签、空格、注释)原样 ——
 *    `B -.支撑.-> C` 只换 B/C 两个 token,`-.支撑.->` 与空格排布不动。
 *
 * @param text     def 块原文
 * @param rename   旧别名 → 新别名(只含 L 编号)
 */
export function renumberAliasesInText(
  text: string,
  rename: ReadonlyMap<string, string>,
): string {
  if (rename.size === 0) return text;
  const block = parseDefText(text);
  const lines = block.lines.map((l) => {
    if (l.kind === 'kv') {
      // ⚠️ 只改 `id:` 行的**值**;shape/color/role 等其它 kv 的值不是别名,不许碰
      if (l.key !== 'id') return l;
      const next = rename.get(l.value);
      if (next === undefined) return l;
      // ⭐ 保住原行的书写形态(`id:B` 无空格就还他无空格)——只换值那一段
      const raw = l.raw.replace(
        new RegExp(`(:\\s*)${escapeForRegExp(l.value)}(\\s*)$`),
        `$1${next}$2`,
      );
      return { ...l, value: next, raw };
    }
    if (l.kind === 'rel') {
      const src = rename.get(l.source) ?? l.source;
      const tgt = rename.get(l.target) ?? l.target;
      if (src === l.source && tgt === l.target) return l;
      // ⭐ 逐 token 替换,不重建整行 —— 标签与空格排布原样
      let raw = l.raw;
      if (src !== l.source) raw = replaceFirstToken(raw, l.source, src);
      if (tgt !== l.target) raw = replaceLastToken(raw, l.target, tgt);
      return { ...l, source: src, target: tgt, raw };
    }
    return l; // other:注释 / 不认识的行 —— ⚠️ 一个字节都不碰
  });
  return serializeDefText({ lines });
}

function escapeForRegExp(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 换掉行里**第一个**该 token(关系行的源端)。 */
function replaceFirstToken(raw: string, from: string, to: string): string {
  const re = new RegExp(`(^\\s*)${escapeForRegExp(from)}(?=\\s|-)`);
  return raw.replace(re, `$1${to}`);
}

/** 换掉行里**最后一个**该 token(关系行的目标端)。 */
function replaceLastToken(raw: string, from: string, to: string): string {
  const re = new RegExp(`(>\\s*)${escapeForRegExp(from)}(\\s*)$`);
  return raw.replace(re, `$1${to}$2`);
}

/**
 * `/def` 插入的骨架文本 —— 只有一行 `id:`。
 *
 * ⭐ 其余字段**用户按需补**(`00 §2.5.2`:行数可变、只写关键行、逐步补充),
 * 不预填一堆注释行去教学 —— 那会让每个节点下面都杵着一坨。
 */
export function buildDefSkeleton(alias: string): string {
  return `id: ${alias}`;
}
