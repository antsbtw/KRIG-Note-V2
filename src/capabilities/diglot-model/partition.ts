/**
 * 数据分区 —— 交集 + 三份专用(规格 04 §0.6,用户 2026-09-10 拍板)
 *
 * > 「把数据分成几个部分:note / mermaid / graph 各自专用的部分 + 三部分的交集。
 * >  这就可以完整的表达了。」
 * > 「导出语法时,就使用**交集 + 专用部分**即成完整的数据了。」
 *
 * ⭐ 比原来的「S 层 / G 层」分法更准:S/G 分的是**语义 vs 图形**,
 * 这里分的是**归属** —— 谁能写、谁该读,一眼可判。
 *
 * ⭐ 三条规矩:
 *   ① 交集:谁都能读,谁都能写
 *   ② 专用:只有主人能写,别人**看都不看**
 *   ③ ⭐⭐ 不认识的一律**原样保留**(别人的专用区 + 自己不认识的字段)
 *
 * ⚠️ ③ 以前靠自觉(mergeKeepingBodies 是手写的特例),现在有结构性依据。
 */

/** 数据分区名。`unknown` = 谁都不认识的字段 —— ⭐ 必须原样保留,不是错误。 */
export type Partition = 'core' | 'note' | 'mermaid' | 'graph' | 'unknown';

/** 导出目标:三个 view,或 `all`(存盘全量)。 */
export type ExportTarget = 'note' | 'mermaid' | 'graph' | 'all';

/**
 * ⭐ 交集 —— 三个 view 都要的东西。
 *
 * ⚠️⚠️ `collapsed` **在这里,不在 graph**:note 画三角+藏内容,graph 裁子树,
 * **两边都读**。先前把它当「图形属性」塞进 G 层,导致 split brain
 * (三角切了、图收了,文字纹丝不动)——**放错格子,bug 就跟着来**。
 */
export const CORE_KEYS = [
  'id',
  'parent',
  'order',
  'content',
  'role',
  'collapsed',
] as const;

/**
 * note 专用 —— ⭐ 先留空。
 * 将来会有(如只影响 note 侧、不该同步到图上的视图态),现在不硬填。
 */
export const NOTE_KEYS = [] as const;

/**
 * mermaid 专用 —— ⭐ **大概率永远空**。
 * mermaid 是**投影**,不产生独有数据;它连 `id` 都表达不了。
 * 留这个空分区是为了让「导出 = 交集 + 专用」这条规矩对三方一致成立。
 */
export const MERMAID_KEYS = [] as const;

/** graph 专用 —— 只有画布用得上的东西。 */
export const GRAPH_KEYS = [
  'pos',
  'color',
  'shape',
  'structure',
  'structureParams',
  'float',
  /** 视口 center/zoom(债 7)。⚠️ 图级,不绑节点 —— 存放位置见 §0.6.5。 */
  'view',
] as const;

const LOOKUP: ReadonlyMap<string, Partition> = new Map<string, Partition>([
  ...CORE_KEYS.map((k) => [k, 'core'] as const),
  ...NOTE_KEYS.map((k) => [k, 'note'] as const),
  ...MERMAID_KEYS.map((k) => [k, 'mermaid'] as const),
  ...GRAPH_KEYS.map((k) => [k, 'graph'] as const),
]);

/**
 * 字段属于哪个分区。
 *
 * ⚠️ 不认识的返回 `'unknown'` 而**不是抛错** —— 那是「将来新增的字段被老版本读到」
 * 的正常情形(C9),老版本必须原样保留它,否则新版存的东西会被老版抹掉。
 */
export function partitionOf(key: string): Partition {
  return LOOKUP.get(key) ?? 'unknown';
}

/**
 * ⭐⭐ 某个导出目标要取哪些分区 —— 「交集 + 自己的专用区」。
 *
 * ⚠️ 任何单个 view 的导出**都不含别人的专用区**:
 * 那不是它的数据,读了会误解、写了会毁。
 *
 * ⭐ 只有 `'all'`(存盘)是无损的;单 view 导出的「有损」不是我们裁剪了数据,
 * 而是**那个投影面容不下** —— 责任在格式本身,不在实现。
 */
export function exportRegions(target: ExportTarget): Partition[] {
  if (target === 'all') return ['core', 'note', 'mermaid', 'graph'];
  return ['core', target];
}
