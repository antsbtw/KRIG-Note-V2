/**
 * ⭐⭐ 运营 → 「人」:分组 / 筛选 / 排序 → SQL,结果解析(纯函数,离线可测)
 *
 * ── 用户 2026-10-07/08 定的规矩 ──
 * · 事实**只从三个标记来**(蓝V / 关注我 / 我关注),不用名单归属 ——
 *   「蓝V/关注我/我关注这三个关键要素能够采集下来，就不存在千面的数据错误了。」
 * · 页面三段:我的号 / 关系概览(点格子列出这群人)/ 列表 + 人卡
 *
 * ── ⚠️ 守着的几件事 ──
 * ① 「否」写 `!= true`:option<bool> 的 NONE(不知道)也算「没有」,与状态页口径一致
 * ② 身份是 rest_id(schema 1.2.20),人卡按 rest_id 取,不按 handle
 * ③ 时间在 SQL 里转字符串 —— SDK 原样给 DateTime 类,过不了 IPC
 * ④ 用户输入一律走参数,不拼进 SQL
 */

/** 关系分组 —— 方向都从「我」出发说 */
export type PeopleGroup = 'all' | 'mutual' | 'iWait' | 'theyWait';

export const PEOPLE_GROUPS: ReadonlyArray<{ readonly id: PeopleGroup; readonly label: string; readonly where: string }> = [
  { id: 'all', label: '全部', where: '' },
  { id: 'mutual', label: '互关', where: 'i_follow = true AND follows_me = true' },
  { id: 'iWait', label: '我关注·他没回关', where: 'i_follow = true AND follows_me != true' },
  { id: 'theyWait', label: '他关注·我没回关', where: 'follows_me = true AND i_follow != true' },
];

export type PeopleSort = 'followersDesc' | 'followersAsc' | 'createdDesc' | 'createdAsc';

export const PEOPLE_SORTS: ReadonlyArray<{ readonly id: PeopleSort; readonly label: string; readonly order: string }> = [
  { id: 'followersDesc', label: '粉丝 多→少', order: 'followers_count DESC' },
  { id: 'followersAsc', label: '粉丝 少→多', order: 'followers_count ASC' },
  { id: 'createdDesc', label: '注册 新→旧', order: 'account_created_at DESC' },
  { id: 'createdAsc', label: '注册 旧→新', order: 'account_created_at ASC' },
];

/**
 * ⭐ 范围 —— 默认只看**没排除**的人(schema 1.2.21)。
 * 用户:「我看到不愿意再需要分析的用户，就右键排除」—— 排除过的人不该再出现在分析里,
 * 但要能找回来(点错了、或改主意)。
 */
export type PeopleScope = 'in' | 'excluded';
const SCOPE_WHERE: Record<PeopleScope, string> = {
  in: 'excluded != true',
  excluded: 'excluded = true',
};

/**
 * ⭐⭐ 自由标签(schema 1.2.22)—— 只有人打,关键词过滤。
 * 用户:「部分是精确字段，部分是标签…对于部分标签定义准确的，可以慢慢固定为精确字段。」
 */
/** 一个标签最长多少字 —— 太长的多半是把一句话当标签了 */
export const TAG_MAX_LEN = 30;

/**
 * ⭐ 标签清洗:去首尾空格、压缩中间空白、去空、**不分大小写去重**(保留第一次的写法)。
 * ⚠️ 自由标签最常见的坑是同一个意思写成好几种(「客户」「客户 」)—— 这里能挡的先挡掉。
 */
export function normalizeTags(raw: readonly string[]): { readonly tags: string[]; readonly problems: string[] } {
  const seen = new Set<string>();
  const tags: string[] = [];
  const problems: string[] = [];
  for (const r of raw) {
    const t = r.trim().replace(/\s+/g, ' ');
    if (t === '') continue;
    if (t.length > TAG_MAX_LEN) { problems.push(`「${t.slice(0, 12)}…」超过 ${TAG_MAX_LEN} 字`); continue; }
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(t);
  }
  return { tags, problems };
}

/** 输入框一次加多个:中英文逗号、顿号、换行都算分隔 */
export function splitTagInput(input: string): string[] {
  return input.split(/[,，、\n]/);
}

/** ⭐ 标签目录(有哪些标签、各几人)—— 从人身上统计,不单独存 */
export function tagCatalog(rows: ReadonlyArray<{ readonly tags?: readonly string[] }>): Array<{ tag: string; count: number }> {
  const m = new Map<string, number>();
  for (const r of rows) for (const t of r.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export type PeopleFilter = {
  readonly scope: PeopleScope;
  readonly group: PeopleGroup;
  readonly blueOnly: boolean;
  /**
   * 名字或 bio 里有中文 —— ⚠️ 这只是**字面信号**,不是「大陆背景」:
   * 港台、海外华人都会命中。「大陆背景」是第 2 块的标注字段(人 > AI > 算法)。
   */
  readonly cnText: boolean;
  readonly text: string;
  /** 标签关键词 —— 有任何一个标签**包含**它就算命中(「客户」也命中「潜在客户」) */
  readonly tag: string;
  readonly sort: PeopleSort;
};

export const DEFAULT_PEOPLE_FILTER: PeopleFilter = {
  scope: 'in', group: 'all', blueOnly: false, cnText: false, text: '', tag: '', sort: 'followersDesc',
};

/** 中文字符 —— 走参数,免得在 SQL 字符串里层层转义 */
const CN_REGEX = '[\\x{4e00}-\\x{9fff}]';
const CN_WHERE = '(string::matches(display_name ?? \'\', $cn) OR string::matches(bio ?? \'\', $cn))';

/** 列表一行 —— 只取列表要显示的,人卡另取全量 */
export type PersonRow = {
  readonly rest_id: string;
  readonly handle: string;
  readonly display_name?: string;
  readonly avatar?: string;
  readonly bio?: string;
  readonly followers_count?: number;
  readonly is_blue_verified?: boolean;
  readonly i_follow?: boolean;
  readonly follows_me?: boolean;
  readonly account_created_at?: string;
  readonly excluded?: boolean;
  readonly tags?: readonly string[];
};

const LIST_FIELDS = `rest_id, handle, display_name, avatar, bio, followers_count,
  is_blue_verified, i_follow, follows_me, excluded, tags,
  (IF account_created_at != NONE THEN <string> account_created_at ELSE NONE END) AS account_created_at`;

export function buildPeopleQuery(
  f: PeopleFilter, limit: number, start: number,
): { readonly sql: string; readonly vars: Record<string, unknown> } {
  const where: string[] = [];
  const vars: Record<string, unknown> = { limit, start };
  const g = PEOPLE_GROUPS.find((x) => x.id === f.group);
  if (g === undefined) throw new Error(`[x.people] 不认识的分组 ${String(f.group)}`);
  const scope = SCOPE_WHERE[f.scope];
  if (scope === undefined) throw new Error(`[x.people] 不认识的范围 ${String(f.scope)}`);
  where.push(scope);
  if (g.where !== '') where.push(g.where);
  if (f.blueOnly) where.push('is_blue_verified = true');
  if (f.cnText) { where.push(CN_WHERE); vars.cn = CN_REGEX; }
  const text = f.text.trim().toLowerCase().replace(/^@/, '');
  if (text !== '') {
    where.push(`(string::contains(handle, $text)
      OR string::contains(string::lowercase(display_name ?? ''), $text)
      OR string::contains(string::lowercase(bio ?? ''), $text))`);
    vars.text = text;
  }
  const tag = (f.tag ?? '').trim().toLowerCase();
  if (tag !== '') {
    /**
     * ⚠️ 用换行把标签拼起来再找 —— 关键词不会含换行,所以不会「前一个标签的尾 + 后一个的头」
     * 拼出一个假命中(2026-10-08 临时库验过)。
     */
    where.push("string::contains(string::lowercase(array::join(tags ?? [], '\\n')), $tag)");
    vars.tag = tag;
  }
  const sort = PEOPLE_SORTS.find((x) => x.id === f.sort) ?? PEOPLE_SORTS[0];
  const w = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  return {
    sql: `SELECT count() AS n FROM x_author ${w} GROUP ALL;
SELECT ${LIST_FIELDS} FROM x_author ${w} ORDER BY ${sort.order} LIMIT $limit START $start;`,
    vars,
  };
}

export function parsePeopleResult(res: readonly unknown[]): { readonly total: number; readonly rows: PersonRow[] } {
  return {
    total: (res[0] as Array<{ n: number }> | undefined)?.[0]?.n ?? 0,
    rows: (res[1] as PersonRow[] | undefined) ?? [],
  };
}

/**
 * ⭐ 关系概览:每组人数 + 其中蓝V —— 一条语句,一次扫表。
 * ⚠️ 只算**范围内**(没排除)的人:排除就是「不在分析范围」,概览是分析的入口。
 * 另给已排除总数,让人知道藏起来了多少。
 */
export type PeopleOverview = Readonly<Record<PeopleGroup, { readonly total: number; readonly blue: number }>> & {
  readonly excludedTotal: number;
};

export function buildOverviewQuery(): string {
  const inScope = SCOPE_WHERE.in;
  const cols = PEOPLE_GROUPS.flatMap((g) => {
    const cond = g.where === '' ? inScope : `${inScope} AND ${g.where}`;
    return [
      `count(${cond}) AS ${g.id}_total`,
      `count((${cond}) AND is_blue_verified = true) AS ${g.id}_blue`,
    ];
  });
  cols.push(`count(${SCOPE_WHERE.excluded}) AS excluded_total`);
  return `SELECT ${cols.join(', ')} FROM x_author GROUP ALL;`;
}

export function parseOverview(res: readonly unknown[]): PeopleOverview {
  const r = ((res[0] as Array<Record<string, number>> | undefined)?.[0]) ?? {};
  const out = {} as Record<PeopleGroup, { total: number; blue: number }>;
  for (const g of PEOPLE_GROUPS) out[g.id] = { total: r[`${g.id}_total`] ?? 0, blue: r[`${g.id}_blue`] ?? 0 };
  return { ...out, excludedTotal: r.excluded_total ?? 0 };
}

/**
 * ⭐⭐ 排除 / 取消排除 —— **人的决定**(source = human),AI 与算法以后不能覆盖它。
 * ⚠️ 取消排除也存成 human + false(而不是清空):清空的话,算法下次又会建议排除他。
 * ⚠️ 人不存在时 UPDATE 返回空数组**不报错** —— 调用方必须检查返回,见 repo。
 */
/** ⭐ 写一个人的全部标签(整组替换;清洗在调用前做)。⚠️ 人不存在时同样返回空不报错 */
export const SET_TAGS_SQL = `UPDATE type::record('x_author', $rest_id) SET tags = $tags RETURN rest_id, tags;`;

/** 标签目录的原料:所有带标签的人的标签 */
export const TAG_ROWS_SQL = 'SELECT tags FROM x_author WHERE array::len(tags ?? []) > 0;';

export const SET_EXCLUDED_SQL = `UPDATE type::record('x_author', $rest_id) SET
  excluded = $excluded, excluded_source = 'human', excluded_at = time::now()
  RETURN rest_id, excluded;`;

/** 人卡 —— 全量字段,按 rest_id 取 */
export type PersonDetail = PersonRow & {
  readonly location?: string;
  readonly website?: string;
  readonly following_count?: number;
  readonly tweet_count?: number;
  readonly is_verified?: boolean;
  readonly is_protected?: boolean;
  readonly handle_history?: readonly string[];
  readonly fetched_at?: string;
  readonly excluded_source?: string;
  readonly excluded_at?: string;
};

export const PERSON_DETAIL_SQL = `SELECT ${LIST_FIELDS}, location, website, following_count, tweet_count,
  is_verified, is_protected, handle_history, excluded_source,
  (IF fetched_at != NONE THEN <string> fetched_at ELSE NONE END) AS fetched_at,
  (IF excluded_at != NONE THEN <string> excluded_at ELSE NONE END) AS excluded_at
  FROM type::record('x_author', $rest_id);`;

/** 关系的说法 —— 列表与人卡共用一份 */
export function relationLabel(p: { readonly i_follow?: boolean; readonly follows_me?: boolean }): string {
  if (p.i_follow === true && p.follows_me === true) return '互关';
  if (p.i_follow === true) return '我关注·他没回关';
  if (p.follows_me === true) return '他关注·我没回关';
  return '无关注关系';
}
