/**
 * 载荷**结构画像** —— ⭐ 回答「这条里有什么数据、有什么元数据」
 *
 * ── 用户 2026-10-02 ──
 * 「采集了几条,**每条的内容是什么,有哪些数据,有哪些元数据**?」
 *
 * ⚠️ 原来面板只显示「尾段 + KB」,人要一条条点开看原始 JSON ——
 * 那不叫「看得见」。⭐ 这个模块把每条载荷**概括成一行人话**。
 *
 * ⚠️ 本模块**不解析业务语义**(那是 `x-timeline-audit` 的活),
 * 只回答「这个 JSON 长什么样」—— 所以它对**任何站点**都能用,
 * 将来接论坛时原样复用。
 */

/** 一条载荷的结构画像 */
export type PayloadShape = {
  /** ⚠️ 空载荷(0 字节)—— 心跳/埋点类请求本来就没内容,不是故障 */
  readonly empty: boolean;
  /** 不是 JSON(HTML / 二进制 / 被截断) */
  readonly notJson: boolean;
  /** 顶层键 —— ⭐ 一眼看出这是什么类型的响应 */
  readonly topKeys: readonly string[];
  /** 整个结构里出现的**对象数组**及其长度(数据在哪、有多少) */
  readonly collections: ReadonlyArray<{ path: string; count: number }>;
  /** ⭐ 发现的**实体**特征 —— 这是「有哪些数据」的直接答案 */
  readonly entities: Readonly<Record<string, number>>;
  /** 一句话概括 */
  readonly summary: string;
};

/** 实体特征 —— ⚠️ 按**字段组合**认,不按嵌套路径(路径会随改版变) */
const ENTITY_MARKS: ReadonlyArray<{ name: string; has: readonly string[] }> = [
  { name: '推文', has: ['full_text'] },
  { name: '用户', has: ['screen_name'] },
  { name: '长推正文', has: ['note_tweet_results'] },
  { name: '长文', has: ['article_results'] },
  { name: '媒体', has: ['media_url_https'] },
  { name: '翻页游标', has: ['cursorType'] },
  { name: '互动数', has: ['favorite_count'] },
];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * ⭐ 概括一条载荷。
 *
 * ⚠️ 任何情况都**不抛** —— 这是观察工具,它自己崩掉比看不到更坏
 * (`project-x-readback-lies`:「工具谎报比采集出错更坏」)。
 */
export function describePayload(text: string): PayloadShape {
  if (!text || text.length === 0) {
    return {
      empty: true, notJson: false, topKeys: [], collections: [], entities: {},
      // ⚠️ 空不等于坏:心跳/埋点类请求本来就没响应体
      summary: '空响应（0 字节）—— 心跳／埋点类请求本来就没内容',
    };
  }

  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    const head = text.slice(0, 60).replace(/\s+/g, ' ');
    return {
      empty: false, notJson: true, topKeys: [], collections: [], entities: {},
      summary: `不是 JSON（${text.length} 字符，开头：${head}…）`,
    };
  }

  const topKeys = isObj(root) ? Object.keys(root).slice(0, 8) : [];
  const collections: Array<{ path: string; count: number }> = [];
  const entities: Record<string, number> = {};
  const seen = new Set<unknown>();

  const walk = (n: unknown, path: string, depth: number): void => {
    // ⚠️ 深度与去重都要有:X 的载荷有环,且嵌套很深
    if (depth > 14 || !n || typeof n !== 'object') return;
    if (seen.has(n)) return;
    seen.add(n);

    if (Array.isArray(n)) {
      // ⭐ 只记**对象数组**:字符串数组多半是 id 列表,不是「数据」
      if (n.length > 0 && n.some(isObj)) {
        collections.push({ path: path || '(根)', count: n.length });
      }
      for (const x of n.slice(0, 200)) walk(x, path, depth + 1);
      return;
    }

    const o = n as Record<string, unknown>;
    for (const m of ENTITY_MARKS) {
      if (m.has.every((k) => k in o)) entities[m.name] = (entities[m.name] ?? 0) + 1;
    }
    for (const [k, v] of Object.entries(o)) {
      walk(v, path ? `${path}.${k}` : k, depth + 1);
    }
  };
  walk(root, '', 0);

  // ⭐ 最大的那个集合最可能是「主数据」
  collections.sort((a, b) => b.count - a.count);

  const ent = Object.entries(entities).sort((a, b) => b[1] - a[1]);
  const summary = ent.length > 0
    ? ent.map(([k, v]) => `${k} ${v}`).join(' · ')
    : `没有可识别的实体（顶层键：${topKeys.join(', ') || '无'}）`;

  return {
    empty: false,
    notJson: false,
    topKeys,
    collections: collections.slice(0, 5),
    entities,
    summary,
  };
}
