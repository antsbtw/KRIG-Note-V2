/**
 * ⭐⭐⭐ **配方 → 搜索查询串** —— 纯函数,不碰页面不碰库
 *
 * 配方(`search_recipes` 表)记的是**意图**:要哪些词、谁发的、多久以内、
 * 热度门槛。这一层把意图翻译成 X 认的查询语法,交给 `x.search` 去搜。
 *
 * ⚠️ 为什么单独一层:`x.search` 收的是**拼好的 `q`**,
 * 配方怎么翻译是业务知识,不该塞进页面表(页面表只管「语义页 → URL」)。
 *
 * ⚠️⚠️ 本模块**不读库不发请求** —— 吃一个 `SearchRecipe` 吐一个串,
 * 所以它能在单测里把四个模板逐个验过,不用真机。
 */

import type { SearchRecipe } from '@shared/types/x-timeline-types';

/** ⭐ 翻译结果 —— 连**为什么这么拼**一起给,面板要能显示 */
export type RecipeQuery = {
  /** 交给 `x.search` 的 `q` */
  readonly q: string;
  /** 交给 `x.search` 的 `f` */
  readonly resultType: 'latest' | 'top';
  /**
   * ⭐⭐ 一句话说明这条配方**实际会搜什么** —— 人点之前要看得见。
   * ⚠️ 配方里填的词与最终发出去的串**不是一回事**(会加 OR、引号、
   * from:、filter:、min_faves、since:),不显示的话人只能靠猜。
   */
  readonly explain: string;
  /** ⚠️ 翻译不出来的原因 —— 空数组才算可用 */
  readonly problems: readonly string[];
};

/** ⭐ 词组要加引号 —— 不加的话 X 当成多个词 AND,噪音暴涨 */
function quote(w: string): string {
  const t = w.trim();
  if (!t) return '';
  /** ⚠️ 已经带引号或带操作符的原样放行 —— 别套两层 */
  if (/^".*"$/.test(t) || /[:()]/.test(t)) return t;
  /**
   * ⭐ 话题标签(`#蓝V互关`)原样放行 —— 加了引号 X 就按短语搜,不再按话题搜(2026-10-16)。
   * 用户:「一般蓝V互关的特征是带了"#蓝V互关 #真诚交友"这样的特征,它给出一个搜索的标签。」
   */
  if (/^#\S+$/.test(t)) return t;
  return `"${t}"`;
}

/** ⭐ 一组词拼成 OR;一个词不加括号(省得 `("a")` 这种噪音) */
function orGroup(words: readonly string[]): string {
  const qs = words.map(quote).filter(Boolean);
  if (qs.length === 0) return '';
  if (qs.length === 1) return qs[0];
  return `(${qs.join(' OR ')})`;
}

/** ⭐ `from:` 组 —— ⚠️ handle 要去掉 @,X 不认 `from:@xxx` */
function fromGroup(handles: readonly string[]): string {
  const hs = handles
    .map((h) => h.trim().replace(/^@/, ''))
    .filter((h) => h.length > 0)
    .map((h) => `from:${h}`);
  if (hs.length === 0) return '';
  return hs.length === 1 ? hs[0] : `(${hs.join(' OR ')})`;
}

/**
 * ⭐ 小时 → `since:` 的日期。
 * ⚠️ X 的 `since:` **只到天级**,所以小时数要**向上取整到天**,
 * 否则 `sinceHours=6` 会被算成「今天」而漏掉昨夜那几条
 * (`DEFAULT_SEARCH_DAYS` 那条注释记的就是这个坑:
 * 「2 天不是 24 小时:since: 只到天级 + 索引有延迟」)。
 */
function sinceFrom(hours: number, now: number): string {
  const days = Math.max(1, Math.ceil(hours / 24));
  return new Date(now - days * 86_400_000).toISOString().split('T')[0];
}

/**
 * ⭐⭐⭐ 把一条配方翻译成查询。
 *
 * 四个模板的区别**只在用哪几组词**,不在拼法:
 * · `trending`     关键词
 * · `vip-tracking` 只认 from:(盯人,不筛词)
 * · `help-wanted`  关键词 **且** 求助信号词(两组都要命中)
 * · `custom`       有什么用什么
 *
 * ⚠️ `now` 可注入 —— 否则测试里 `since:` 每天都不一样,没法钉。
 */
export function recipeToQuery(r: SearchRecipe, now: number = Date.now()): RecipeQuery {
  const problems: string[] = [];
  const parts: string[] = [];
  const why: string[] = [];

  const keywords = r.keywords ?? [];
  const accounts = r.fromAccounts ?? [];
  const signals = r.helpSignals ?? [];

  // ── ① 词与人 ──
  if (r.template === 'vip-tracking') {
    /** ⚠️ 盯人模板**只认 from:** —— 没有账号就没得搜 */
    const f = fromGroup(accounts);
    if (!f) problems.push('vip-tracking 配方没填 fromAccounts —— 盯人却不知道盯谁');
    else { parts.push(f); why.push(`盯 ${accounts.length} 个账号`); }
  } else {
    const kw = orGroup(keywords);
    if (kw) { parts.push(kw); why.push(`${keywords.length} 个关键词任一命中`); }

    /**
     * ⭐ `help-wanted`:关键词 **且** 求助信号 —— 两组是 AND 关系。
     * ⚠️ 这是模板的全部意义:只搜「vpn」会捞回一堆广告,
     * 加上「怎么办/求助/连不上」才是真求助。
     */
    if (r.template === 'help-wanted') {
      const sig = orGroup(signals);
      if (!sig) problems.push('help-wanted 配方没填 helpSignals —— 退化成普通关键词搜索');
      else { parts.push(sig); why.push(`且命中 ${signals.length} 个求助信号词之一`); }
    }

    /** ⭐ 非盯人模板里 `from:` 是**额外收窄**,可选 */
    const f = fromGroup(accounts);
    if (f) { parts.push(f); why.push(`限这 ${accounts.length} 个账号`); }

    if (parts.length === 0) {
      problems.push('配方既没关键词也没账号 —— 搜不出东西');
    }
  }

  // ── ② 门槛 ──
  if (typeof r.minLikes === 'number' && r.minLikes > 0) {
    parts.push(`min_faves:${r.minLikes}`);
    why.push(`赞 ≥ ${r.minLikes}`);
  }
  if (typeof r.minRetweets === 'number' && r.minRetweets > 0) {
    parts.push(`min_retweets:${r.minRetweets}`);
    why.push(`转 ≥ ${r.minRetweets}`);
  }
  if (r.lang) { parts.push(`lang:${r.lang}`); why.push(`${r.lang} 语`); }

  /**
   * ⭐⭐ 连回复一起抓 —— ⚠️ 用 `filter:replies`。
   * `include:replies` **X 已不支持**,加上去结果会变 0 条(**静默,不报错**)。
   * 实测 2026-09-06:from: 裸查 12 条/回复 11,+filter:replies 22 条/回复 22。
   */
  if (r.includeReplies) { parts.push('filter:replies'); why.push('连回复一起'); }
  /** ⭐ 只看蓝V作者(蓝V互关 M1)—— ⚠️ 语法未经真机验证,第一次搜要核对结果是否全是蓝V */
  if (r.blueOnly) { parts.push('filter:blue_verified'); why.push('只看蓝V作者'); }

  // ── ③ 时间窗 ──
  const hours = typeof r.sinceHours === 'number' && r.sinceHours > 0 ? r.sinceHours : 24;
  const since = sinceFrom(hours, now);
  parts.push(`since:${since}`);
  why.push(`${since} 起`);

  return {
    q: parts.join(' '),
    resultType: r.resultType === 'top' ? 'top' : 'latest',
    explain: why.join('　·　'),
    problems,
  };
}

/**
 * ⭐ 查询串 → 配方名(2026-10-08)—— 推文上记的是查询串(`search_recipe`),不是配方名。
 * ⚠️ 查询串里的 `since:` / `until:` 每天都变,比对前去掉;其余必须**完全一致**。
 * 对不上(配方后来改过、或不是配方发起的搜索)返回 undefined —— **不猜**。
 */
export function recipeNameForQuery(
  q: string | undefined, recipes: readonly SearchRecipe[], now: number = Date.now(),
): string | undefined {
  if (q === undefined || q.trim() === '') return undefined;
  const strip = (x: string): string => x.replace(/\s*\b(since|until):\S+/g, '').trim();
  const want = strip(q);
  const hits = recipes.filter((r) => strip(recipeToQuery(r, now).q) === want);
  /** ⚠️ 两个配方生成同一个查询串时也不猜 */
  return hits.length === 1 ? hits[0].name : undefined;
}
