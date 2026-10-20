/**
 * X 库(krig_x)migration runner —— **独立于笔记库的版本序列**。
 *
 * X 库有自己的 schema_version 表,版本号从 1.0.0 起,与笔记库的 1.9.x 互不干扰:
 * 两条序列各跑各的,一边加 migration 不会惊动另一边(这正是独立 database 的收益之一)。
 *
 * 结构与 runner.ts 刻意保持一致(同样的 fail-loud + rethrow 语义),
 * 版本比较复用 runner.ts 的 compareVersions,不另写一份。
 */
import type { Surreal } from 'surrealdb';
import { compareVersions } from './runner';
import { x_migration_1_0_0, x_migration_1_0_1, x_migration_1_0_2, x_migration_1_0_3, x_migration_1_0_4, x_migration_1_0_5, x_migration_1_0_6, x_migration_1_0_7, x_migration_1_0_8, x_migration_1_0_9, x_migration_1_1_0, x_migration_1_1_1, x_migration_1_1_2, x_migration_1_1_3, x_migration_1_1_4, x_migration_1_1_5, x_migration_1_1_6, x_migration_1_1_7, x_migration_1_1_8, x_migration_1_1_9, x_migration_1_2_0, x_migration_1_2_1, x_migration_1_2_2, x_migration_1_2_3, x_migration_1_2_4, x_migration_1_2_5, x_migration_1_2_6, x_migration_1_2_7, x_migration_1_2_8, x_migration_1_2_9, x_migration_1_2_10, x_migration_1_2_11, x_migration_1_2_12, x_migration_1_2_13, x_migration_1_2_14, x_migration_1_2_15, x_migration_1_2_16, x_migration_1_2_17, x_migration_1_2_18, x_migration_1_2_19, x_migration_1_2_20, x_migration_1_2_21, x_migration_1_2_22, x_migration_1_2_23, x_migration_1_2_24, x_migration_1_2_25, x_migration_1_2_26, x_migration_1_2_27, x_migration_1_2_28, x_migration_1_2_29, x_migration_1_2_30, x_migration_1_2_31, x_migration_1_2_32, x_migration_1_2_33, x_migration_1_2_34, x_migration_1_2_35 } from '../surreal/x-schema';

interface XMigration {
  version: string;
  description: string;
  up: (db: Surreal) => Promise<void>;
}

const X_MIGRATIONS: XMigration[] = [
  {
    version: '1.0.0',
    description: 'X database initial schema (data isolation phase 0)',
    up: x_migration_1_0_0,
  },
  {
    version: '1.0.1',
    description: 'Reply relationship authoritative fields (in_reply_to_user / conversation_id)',
    up: x_migration_1_0_1,
  },
  {
    version: '1.0.2',
    description: 'Normalize author_handle (strip @, lowercase) across x_tweet / tweet_feedback',
    up: x_migration_1_0_2,
  },
  {
    version: '1.0.3',
    description: 'Collection cursor table (resume via X own Bottom cursor)',
    up: x_migration_1_0_3,
  },
  {
    version: '1.0.4',
    description: 'Account baseline counts (tweet_count = collection completeness denominator)',
    up: x_migration_1_0_4,
  },
  {
    version: '1.0.5',
    description: 'Disable TTL: keep all X tweets permanently',
    up: x_migration_1_0_5,
  },
  {
    version: '1.0.6',
    description: 'X per-ws role table (search / campaign / idle)',
    up: x_migration_1_0_6,
  },
  {
    version: '1.0.7',
    description: 'Campaign reply table (contract idempotency key + push state)',
    up: x_migration_1_0_7,
  },
  {
    version: '1.0.8',
    description: 'Per-ws logged-in account (identity belongs to ws, not global)',
    up: x_migration_1_0_8,
  },
  {
    version: '1.0.9',
    description: 'Inbound interactions from notifications (named actors)',
    up: x_migration_1_0_9,
  },
  {
    version: '1.1.0',
    description: 'Interaction target metadata for per-article verification',
    up: x_migration_1_1_0,
  },
  {
    version: '1.1.1',
    description: 'Interaction quoted_status_id (quote-retweet attribution)',
    up: x_migration_1_1_1,
  },
  {
    version: '1.1.2',
    description: 'Reply feedback (learning period: AI text vs user edit)',
    up: x_migration_1_1_2,
  },
  {
    version: '1.1.3',
    description: 'Reply decision trace (poster read / trigger) for regression review',
    up: x_migration_1_1_3,
  },
  {
    version: '1.1.4',
    description: 'Backfill x_author from x_tweet (people seen but never registered)',
    up: x_migration_1_1_4,
  },
  {
    version: '1.1.5',
    description: 'tweet_inbox.in_reply_to_user (reply context for step 1 gate)',
    up: x_migration_1_1_5,
  },
  {
    version: '1.1.6',
    description: 'Author relationship perspectives + bio (step 2 activity signals)',
    up: x_migration_1_1_6,
  },
  {
    version: '1.1.7',
    description: 'Parent tweet snapshot (context for step 1 gate)',
    up: x_migration_1_1_7,
  },
  {
    version: '1.1.8',
    description: 'Task table (recipes become tasks; params driven by strategy schema)',
    up: x_migration_1_1_8,
  },
  {
    version: '1.1.9',
    description: 'Tasks belong to a ws (unassigned default to ws-2)',
    up: x_migration_1_1_9,
  },
  {
    version: '1.2.0',
    description: 'Drop dead table tweet_inbox (all reads/writes long since on x_tweet)',
    up: x_migration_1_2_0,
  },
  {
    version: '1.2.1',
    description: 'Publish gate (scenario x lang; enabled only ever set by the user)',
    up: x_migration_1_2_1,
  },
  {
    version: '1.2.2',
    description: 'x_author.location (people harvest carries it, had nowhere to store)',
    up: x_migration_1_2_2,
  },
  {
    version: '1.2.3',
    description: 'x_author list_seq/list_source (evidence for list ordering)',
    up: x_migration_1_2_3,
  },
  {
    version: '1.2.4',
    description: 'x_author list_memberships (a person can be in several lists)',
    up: x_migration_1_2_4,
  },
  {
    version: '1.2.5',
    description: 'x_list_snapshot —— 每次采集的名次快照(增量采集 + 排序证据)',
    up: x_migration_1_2_5,
  },
  {
    version: '1.2.6',
    description: 'x_tweet.metrics_at —— metrics 的观测时刻(没有时刻的计数不可比)',
    up: x_migration_1_2_6,
  },
  {
    version: '1.2.7',
    description: 'x_tweet.is_article —— 长文标记(正文只在详情页,先得找得出哪些是长文)',
    up: x_migration_1_2_7,
  },
  {
    version: '1.2.8',
    description: 'x_reply_draft —— 拟出来的草稿落库(AI 学习的训练信号)',
    up: x_migration_1_2_8,
  },
  {
    version: '1.2.9',
    description: 'x_reply_feedback.dismiss_reason —— 否决原因(学习信号第一层)',
    up: x_migration_1_2_9,
  },
  {
    version: '1.2.10',
    description: 'x_product_facts —— 产品事实清单可编辑(用户要能随时改口径)',
    up: x_migration_1_2_10,
  },
  {
    version: '1.2.11',
    description: 'x_reply_draft 语境快照/建议原文/人改了什么 —— 学习环节的地基',
    up: x_migration_1_2_11,
  },
  {
    version: '1.2.12',
    description: '自动回复开关 —— ⭐**按配方**不是全局(配方精确率差一个数量级)',
    up: x_migration_1_2_12,
  },
  {
    version: '1.2.13',
    description: 'x_search_watermark —— 按搜索词记「采到的最新一条」(全局,不按 ws)',
    up: x_migration_1_2_13,
  },
  {
    version: '1.2.14',
    description: 'x_tweet 五维字段:物(媒体URL/外链/标签/提及)+人(关系用 X 原词)+我的动作',
    up: x_migration_1_2_14,
  },
  {
    version: '1.2.15',
    description: 'media 数组元素 FLEXIBLE —— 否则 media[0].type 被整条拒收',
    up: x_migration_1_2_15,
  },
  {
    version: '1.2.16',
    description: 'x_author 补 rest_id(handle 会改名)—— 用户表就是 x_author,不建新表',
    up: x_migration_1_2_16,
  },
  {
    version: '1.2.17',
    description: '人的字段补齐(真载荷实测):website / is_verified / is_protected',
    up: x_migration_1_2_17,
  },
  {
    version: '1.2.18',
    description: '断点续采:x_collect_cursor 补 last_round / last_reason / total_seen',
    up: x_migration_1_2_18,
  },
  {
    version: '1.2.19',
    description: '落库账本 x_collect_log(只追加:增长曲线 / 名单更新时间 / 对账)',
    up: x_migration_1_2_19,
  },
  {
    version: '1.2.20',
    description: 'x_author 身份改为 rest_id(handle 只是当前名字,旧名进 handle_history;合并改名重复)',
    up: x_migration_1_2_20,
  },
  {
    version: '1.2.21',
    description: '排除(不在分析范围):excluded / excluded_source / excluded_at / excluded_reason',
    up: x_migration_1_2_21,
  },
  {
    version: '1.2.22',
    description: '人的自由标签 tags(人打的,关键词过滤)',
    up: x_migration_1_2_22,
  },
  {
    version: '1.2.23',
    description: '人被哪个配方找到 found_via_recipes(只加不减)',
    up: x_migration_1_2_23,
  },
  {
    version: '1.2.24',
    description: '运营设置 x_setting + 只追加的动作记录 x_action_log(取关)',
    up: x_migration_1_2_24,
  },
  {
    version: '1.2.25',
    description: '推文互动对象(回复/提及/引用/转发,全用数字 id)—— 朋友圈的原料',
    up: x_migration_1_2_25,
  },
  {
    version: '1.2.26',
    description: '后台采集任务 x_bg_job(朋友圈半年/一年/全部,断点存库跨重启)',
    up: x_migration_1_2_26,
  },
  {
    version: '1.2.27',
    description: '关系按号存 x_relation(号 × 人);x_ws_account 按 ws 定位',
    up: x_migration_1_2_27,
  },
  {
    version: '1.2.28',
    description: '关系变化记录 x_relation_change(只在变了时追加)',
    up: x_migration_1_2_28,
  },
  {
    version: '1.2.29',
    description: '配方加 blue_only(只看蓝V)/ include_replies(补存老勾选框)',
    up: x_migration_1_2_29,
  },
  {
    version: '1.2.30',
    description: '人的互关倾向(人 > AI > 算法,存依据原句)',
    up: x_migration_1_2_30,
  },
  {
    version: '1.2.31',
    description: '动作记录放开「关注」',
    up: x_migration_1_2_31,
  },
  {
    version: '1.2.32',
    description: '求关:动作记录放开点赞 / 留言,建 x_ask',
    up: x_migration_1_2_32,
  },
  {
    version: '1.2.33',
    description: '查回关运行记录 x_follow_check',
    up: x_migration_1_2_33,
  },
  {
    version: '1.2.34',
    description: '后台任务加名单种类 + x_list_member',
    up: x_migration_1_2_34,
  },
  {
    version: '1.2.35',
    description: '关系采集任务 + 节奏自调',
    up: x_migration_1_2_35,
  },
];

export async function runXMigrations(db: Surreal): Promise<void> {
  let currentVersion = '0.0.0';
  try {
    // ORDER BY 字段必须出现在 SELECT 子句里(SurrealDB 3.0.4),否则 parse error
    // 被 catch 吞掉 → currentVersion 恒 0.0.0 → 每次启动全量重跑(笔记库踩过)。
    const versionRes = await db.query<[Array<{ version: string; appliedAt: number }>]>(
      `SELECT version, appliedAt FROM schema_version ORDER BY appliedAt DESC LIMIT 1`,
    );
    currentVersion = versionRes[0]?.[0]?.version ?? '0.0.0';
  } catch (err) {
    // 冷启动时 X 库连 schema_version 表都没有 —— 属预期。但不静默:
    // 打 warn 露出诊断信息,避免真实的 SQL 错误被当成"冷启动"埋掉。
    console.warn(
      '[storage/x-migrations] schema_version SELECT failed, treating as 0.0.0:',
      err,
    );
  }

  for (const mig of X_MIGRATIONS) {
    if (compareVersions(currentVersion, mig.version) < 0) {
      console.log(`[storage/x-migrations] applying ${mig.version}: ${mig.description}`);
      try {
        await mig.up(db);
      } catch (err) {
        // fail loud + 停在第一个坏 migration(理由同 runner.ts):
        // 单条 DDL parse error 会让**整段**被服务端拒收 —— 现场表现是
        // "表建了一半 / 看着像没跑",而不是一条清晰的报错。先把这行找出来。
        console.error(
          `[storage/x-migrations] ✗ X migration ${mig.version} FAILED — X schema 停在 ${currentVersion},` +
            ` 后续已跳过。先修这条再启动:`,
          err,
        );
        throw err;
      }
    }
  }
}
