/**
 * 策略:盯某个推主(`agent/Module5-02-x-pipeline.md` §1.2 / §1.4)
 *
 * ⭐⭐ **它是「可插拔」的证明**(§8 建议顺序②):
 *
 * > 「只有第二个接进来时零改动,『可插拔』才算被证明。」
 *
 * 所以这个文件的价值不只是功能 —— 它是**判据本身**:
 * 加它没有改动任何现有文件,没有改动 UI。
 *
 * ── ⚠️ 实测:这条路「四层齐了,唯独采集循环从没跑起来」 ──
 *
 * | 层 | 状态 |
 * |---|---|
 * | 存储(`x_author.watched/watch_depth`) | ✅ |
 * | Repo(`watchAuthor`/`listWatched`) | ✅ |
 * | IPC(`X_WATCHLIST`) | ✅ |
 * | UI(`WatchlistView`) | ✅ |
 * | **定时采集** | ❌ **不存在** —— 调度器里只有 `scanRecipe` |
 *
 * 「可以把人加进名单、能看到名单和统计,但**没有任何东西会因为『他在名单里』
 *   而去定期抓他的新推**。」
 *
 * ── ⚠️⚠️ 措辞纪律(用户 2026-09-09 纠正过一次)──
 *
 * schema 里那条「watchlist 推文**不进 AI 判断队列**」只管**排不排队等 Gemma**,
 * **不管采不采、存不存**。采集/入库层**无条件全采全存**(用户 2026-09-03 定)。
 *
 * > 一律写「不进判断队列」,**绝不许写成「不采」「过滤掉」「跳过」** ——
 * > 那会重演「在采集层丢掉、永远查不回来」那个已被否决过的错。
 *
 * ── 为什么走 `/with_replies` 而不是搜索 ──
 *
 * 搜索语法易变、不可信;`/<handle>/with_replies` 是**一级导航,稳定**。
 * ⚠️ 且该页上本账号的每一条**都是回复**(原创推在 Posts 标签页)。
 */

import type {
  CollectArrival,
  CollectParams,
  CollectStop,
  CollectStrategy,
  CollectTarget,
} from '@shared/types/x-collect-strategy';

/**
 * handle 归一化 —— ⚠️ 必须与 `normalizeHandle()` 同口径(去 @、转小写)。
 *
 * ⚠️ **2026-09-14 实测更正**:此处初稿引用了「库里 `author_handle` 存
 * 『@Miekko22』带 @ 保留大小写」这个说法 —— **与实际数据不符**。
 * 活库 11739 行 `x_tweet` 里带 @ 的 **0 条**、含大写 **0 条**,`x_author` 亦然,
 * 两侧本来就同形(见 commit「侧栏徽章改 count()」)。
 *
 * ⭐ 但**写入端归一化这条本身仍然成立**,理由换成真的那个:
 * `idx_author_handle` 是 UNIQUE,不归一化则 `Foo`/`foo` 成两行,
 * 同一人屏蔽两次只生效一次;且与 `applyFilter` 的比对对不上 ——
 * **屏蔽点了没反应且不报错**。
 *
 * ⚠️ 与之相对:**读取端不要**在 SQL 里再包 `string::lowercase`/`string::replace`,
 * 那既无必要,又让字段吃不到 `idx_tweet_author`。
 */
function normalize(h: string): string {
  return h.trim().replace(/^@+/, '').toLowerCase();
}

export const authorWatchStrategy: CollectStrategy = {
  id: 'author-watch',
  name: '盯推主',
  description:
    '定期抓某个账号的全部发言(走 /with_replies 一级导航,不走搜索语法)。' +
    '⚠️ 采到的推文入库但**不进 Gemma 判断队列**(否则刷爆队列),走单独的人工视图。',

  paramsSchema: [
    {
      key: 'handle',
      label: '账号',
      kind: 'string',
      required: true,
      help: '不带 @;大小写不敏感。⚠️ 必填 —— 缺了明确失败,不猜一个默认值',
    },
    {
      key: 'depth',
      label: '抓多少条',
      kind: 'number',
      min: 1,
      max: 500,
      defaultValue: 40,
      help: '对应 x_author.watch_depth。⚠️ 数的是跨轮去重后的 id 数,不是 DOM 元素个数',
    },
  ],

  /** ① 去哪 —— 拼 /with_replies */
  target(params: CollectParams): CollectTarget {
    const handle = normalize(String(params.handle ?? ''));
    if (!handle) {
      // fail loud:空 handle 会拼出 https://x.com//with_replies 这种垃圾 URL,
      // 导航「成功」但落在 404 页,而判到位只查 URL 含不含 handle —— 空串恒真。
      throw new Error('[x-collect/author-watch] handle 为空,拒绝拼 URL');
    }
    return {
      url: `https://x.com/${handle}/with_replies`,
      describe: `盯推主:@${handle}`,
    };
  },

  /**
   * ② 怎样算到位 —— URL 里得真有这个 handle。
   *
   * ⚠️ 与 keyword 同理:X 是 SPA,被弹回首页时「页面上有推文」照样成立。
   */
  arrived(params: CollectParams): CollectArrival {
    const handle = normalize(String(params.handle ?? ''));
    return {
      urlIncludes: `/${handle}/with_replies`,
      awaitSelector: 'article[data-testid="tweet"]',
    };
  },

  /**
   * ③ 什么时候停 —— 收够 depth 条。
   *
   * ⚠️ 与 keyword 的 `atBottom` 不同:盯人不需要翻到底(一个活跃账号能翻几年),
   * 收够就走。这正是「停的条件由策略回答」的价值 —— 底座不预设哪种对。
   */
  stop(params: CollectParams): CollectStop {
    const depth = typeof params.depth === 'number' ? params.depth : 40;
    return { kind: 'itemCount', n: depth };
  },
};
