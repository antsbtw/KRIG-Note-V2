/**
 * 守卫:自动回复的三条硬约束。
 *
 * ① **红线**:全链路只填不发,代码里不得出现「点发布/点回复按钮」的动作。
 * ② **正文只来自模板库**:模型不生成一个字(它不知道「7天10G」是否仍有效,
 *    且 X 判垃圾看重复度,模型改写只会制造一堆 90% 相似的变体)。
 * ③ **前置过滤不问模型**:刷屏/冷却/已回过是跨条现象,模型一次只看一条判不出。
 *    2026-09-04 评测里唯一残留的假阳正是此类 ——
 *    「我有小火箭加速器,求推荐一个好用的VPN」在库里一字不差出现 3 次。
 *
 * ⚠️ 纯逻辑部分(指纹/轮换)测真实行为;涉及 Electron/DB 的部分测源码约束。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { textFingerprint, pickTemplate, DUPLICATE_FINGERPRINT_THRESHOLD } from
  '../../src/platform/main/x/x-reply-planner';
import {
  REPLY_TEMPLATES, getTemplate, hasStaleShortLink, needsRef, REPLY_CONFIDENCE_FLOOR,
  buildRef, renderTemplate, REF_PLACEHOLDER, LANDING_BASE,
  langOf, templatesFor, LINK_PARAMS, isInThread,
} from '../../src/shared/types/x-reply-types';
import { verifyGeneratedReply, buildGenerationPrompt, PRODUCT_FACTS } from
  '../../src/shared/types/x-reply-facts';

const PLANNER = readFileSync(
  resolve(__dirname, '../../src/platform/main/x/x-reply-planner.ts'), 'utf-8');
const HANDLERS = readFileSync(
  resolve(__dirname, '../../src/platform/main/x/x-timeline-handlers.ts'), 'utf-8');
const UI_RAW = readFileSync(
  resolve(__dirname, '../../src/views/x-inbox/ReplyDraftsView.tsx'), 'utf-8');
const DIALOG_RAW = readFileSync(
  resolve(__dirname, '../../src/views/x-inbox/ReplyComposeDialog.tsx'), 'utf-8');
const stripComments = (t: string) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const DIALOG = stripComments(DIALOG_RAW);
const REPO_RAW = readFileSync(
  resolve(__dirname, '../../src/platform/main/db/x-reply-feedback-repo.ts'), 'utf-8');
/**
 * 去掉注释后的代码 —— 「禁止出现 X」这类守卫必须只看**代码**。
 * 否则「本视图不存在任何一键全发」这句**说明它没做**的注释,
 * 反而会把守卫弄红(踩过:首次写完就是这样),
 * 之后为了让测试变绿去删注释,等于把最该留的说明删掉。
 */
const UI = UI_RAW
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('红线:只填不发', () => {
  it('⭐ planner 不得有任何点击发布/回复按钮的动作', () => {
    // 写方向最高红线(x-write.ts §9):发布那一下永远留给用户
    const clicks = [...PLANNER.matchAll(/\.click\(\)|clickSendButton|clickPublish|pressEnter/g)];
    expect(
      clicks.map((m) => m[0]),
      'planner 里出现了点击动作 —— 违反「绝不程序自动点发布」红线',
    ).toEqual([]);
  });

  it('⭐ planner 不得直接驱动 webview(它只产数据)', () => {
    // 填充走既有的 pasteReply(它自己也只填不点),planner 不该碰 webContents
    expect(
      /executeJavaScript|webContents|sendInputEvent/.test(PLANNER),
      'planner 碰了 webview —— 规划与填充必须分开,否则「产草稿」会顺手把内容送出去',
    ).toBe(false);
  });

  it('⭐ X_PLAN_REPLIES handler 不得调用 pasteReply(规划 ≠ 填充)', () => {
    const start = HANDLERS.indexOf('X_PLAN_REPLIES');
    const body = HANDLERS.slice(start, HANDLERS.indexOf('X_INBOX_QUERY', start));
    expect(
      /pasteReply|pasteTweet/.test(body),
      '规划顺手就填进去了 —— 用户失去逐条过目的机会',
    ).toBe(false);
  });
});

describe('UI:只填不发', () => {
  it('⭐ 不得有「全部填入/一键全发」这类批量动作', () => {
    // 逐条过目是这个功能的核心 —— 有了批量按钮,红线形同虚设
    expect(
      /全部填入|一键|批量发|fillAll|sendAll|replyAll/i.test(UI),
      'UI 出现了批量发送入口 —— 逐条过目被绕过',
    ).toBe(false);
  });

  it('⭐ UI 必须明示「不会替你点发布」', () => {
    expect(UI_RAW).toMatch(/不会替你点发布/);
  });

  it('⭐ 填入后不得自动写 markReplied(填入 ≠ 已发布)', () => {
    // 填进去你没点发布的话,这条得还能再出现;自动标已回复会让它永远消失
    expect(
      /markReplied/.test(UI),
      '填入即标已回复 —— 没点发布的会被永久漏掉',
    ).toBe(false);
  });

  it('⭐ 手改正文不得回写模板库', () => {
    // 手滑污染模板会影响之后所有回复
    expect(
      /REPLY_TEMPLATES\s*[.[]\s*\w*\s*=|\.text\s*=\s*/.test(UI),
      'UI 在写模板库 —— 手改应只作用于当前这一条',
    ).toBe(false);
  });

  it('⭐ 英文文案的待审核提示必须真的渲染出来', () => {
    expect(UI).toMatch(/needsHumanReview/);
    expect(UI_RAW).toMatch(/没有语料依据/);
  });

  it('⭐ 跳过的条目要能展开看原因(不静默丢)', () => {
    expect(UI).toMatch(/SKIP_LABEL/);
    for (const k of ['duplicate_text', 'author_recent', 'blocked_author', 'low_confidence']) {
      expect(UI, `跳过原因 ${k} 没有对应人话`).toContain(k);
    }
  });

  it('⭐ 回放失败必须报错,不能留空列表装作「没什么可回的」', () => {
    // 批量「规划草稿」已删(全局入口),同一条不变量现在落在回放路径上
    expect(UI_RAW).toMatch(/回放失败/);
  });
});

describe('回复是逐条的事,不能有全局入口', () => {
  const INBOX = readFileSync(
    resolve(__dirname, '../../src/views/x-inbox/XInboxView.tsx'), 'utf-8');

  it('⭐ 「送入回复」必须在卡片里、且带上这一条推文', () => {
    // 用户 2026-09-06:「回复应该是针对每一条推文,而不是总体只有一个 button」
    expect(INBOX).toMatch(/sendToReply\(t\)/);
  });

  it('⭐ 顶栏不得再出现批量拟回复入口', () => {
    // 顶栏那个「✎ 拟回复」正是「总体一个 button」,已删。
    // ⚠️ 别用「两个标识之间切片」定位顶栏:startScan 在文件里其实**排在
    //    triggerJudge 前面**,那样切出来是空串,守卫会永远通过(踩过)。
    //    直接找 setView('drafts') 那颗按钮,检查它的文字。
    const i = INBOX.indexOf("setView('drafts')");
    expect(i, "找不到回放入口按钮").toBeGreaterThan(-1);
    const btn = INBOX.slice(i, INBOX.indexOf('</Btn>', i));
    expect(
      /拟回复|规划草稿/.test(btn),
      `顶栏又出现了批量拟回复 —— 回复应该逐条进行:${btn.trim()}`,
    ).toBe(false);
  });

  it('⭐ 回放页不得再有批量规划按钮', () => {
    expect(
      /规划草稿|planReplies\(/.test(stripComments(UI_RAW)),
      '回放页又能批量产草稿了 —— 那就是变相的全局回复入口',
    ).toBe(false);
  });

  it('回放页要指明日常回复的正确入口', () => {
    expect(UI_RAW).toMatch(/送入回复/);
  });
});

describe('卡片弹窗:确认后才填,填入不等于发布', () => {
  it('⭐ 弹窗不得替用户点发布', () => {
    expect(/\.click\(\)|clickPublish|clickSendButton/.test(DIALOG)).toBe(false);
    expect(DIALOG_RAW).toMatch(/不会替你发布/);
  });

  it('⭐ 填入后不得写 markReplied(填入 ≠ 已发布)', () => {
    // 没点发布的话这条得还能再出现;自动标已回复会让它永久消失
    expect(/markReplied/.test(DIALOG)).toBe(false);
  });

  it('⭐ 原推正文必须显示在弹窗里', () => {
    // 判断「该不该这么回」的依据。看不到原推就是在信息更少的地方做同一个决定
    expect(DIALOG).toMatch(/tweet\.text/);
  });

  it('⭐ 填入与跳过都要记学习期反馈', () => {
    expect(DIALOG).toMatch(/recordFeedback\('filled'/);
    expect(DIALOG).toMatch(/recordFeedback\('dismissed'/);
  });

  it('⭐ 被挡掉时要说明原因,不给空框', () => {
    expect(DIALOG).toMatch(/SKIP_LABEL/);
    expect(DIALOG_RAW).toMatch(/没有生成回复/);
  });

  it('⭐ 回落模板时要显示回落原因', () => {
    expect(DIALOG).toMatch(/fallbackReason/);
  });
});

describe('追踪名单 UI 与搜索语法 spike', () => {
  const WL_RAW = readFileSync(
    resolve(__dirname, '../../src/views/x-inbox/WatchlistView.tsx'), 'utf-8');
  const WL = stripComments(WL_RAW);
  const SPIKE = readFileSync(
    resolve(__dirname, '../../src/platform/main/x/x-search-syntax-spike.ts'), 'utf-8');

  it('⭐ UI 必须说清「这不是 X 的关注」', () => {
    // 设计 §0:混用措辞会让人以为在这里操作会改动 X 上的关注关系
    expect(WL_RAW).toMatch(/和你在 X 上「关注」谁.{0,10}没有任何关系|不会去关注对方/);
  });

  it('⭐ spike 判据是「有没有真的回复」,不是「有没有报错」', () => {
    // 错的写法不会报错,只会静默地只返回原创推 —— 这是最容易误判成「能用」的形态
    expect(SPIKE).toMatch(/replies/);
    expect(SPIKE).toMatch(/Replying to/);
    // verdict 必须看 replies 而不是只看 total
    const v = SPIKE.slice(SPIKE.indexOf('const winners'));
    expect(v.slice(0, 200)).toMatch(/p\.replies > 0/);
  });

  it('⭐ 三种候选写法都要测,不能预设哪个对', () => {
    for (const k of ['include:replies', 'filter:replies']) {
      expect(SPIKE, `候选写法少了 ${k}`).toContain(k);
    }
    // 还要有个不加任何修饰的对照组,否则不知道基线是多少
    expect(SPIKE).toMatch(/from:\$\{h\}`/);
  });

  it('⭐ spike 只读:不许点任何按钮', () => {
    expect(/\.click\(\)/.test(stripComments(SPIKE)), 'spike 里出现了点击').toBe(false);
  });

  it('移出名单的提示要说明历史数据保留', () => {
    expect(WL_RAW).toMatch(/历史数据保留/);
  });

  it('统计现算而非读存储字段', () => {
    // UI 直接用 handler 返回的 stats(那边走 getAuthorStats 现算)
    expect(WL).toMatch(/w\.stats/);
  });
});

describe('人表:见过的人都要留档', () => {
  const AREPO = readFileSync(
    resolve(__dirname, '../../src/platform/main/db/x-author-repo.ts'), 'utf-8');
  const TREPO = readFileSync(
    resolve(__dirname, '../../src/platform/main/db/tweet-inbox-repo.ts'), 'utf-8');

  it('⭐ 采集写推文时必须顺带登记作者', () => {
    // 用户 2026-09-06 发现:见过 3458 个作者,x_author 只有 36 行 ——
    // 采集链路从不写人表,只有「对某人动作」才建行
    expect(TREPO).toMatch(/registerSeenAuthor/);
    const fn = TREPO.slice(TREPO.indexOf('export async function upsertTweet'));
    expect(fn.slice(0, 900)).toMatch(/registerSeenAuthor/);
  });

  it('⭐ 登记不得覆盖已有行的意志字段', () => {
    // 这个人可能已被 blocked/watched,采到他新推不该把那些清掉
    const fn = AREPO.slice(AREPO.indexOf('export async function registerSeenAuthor'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
    const updateSeg = body.slice(body.indexOf('UPDATE x_author'));
    expect(/blocked\s*=|watched\s*=|is_self\s*=/.test(updateSeg.slice(0, 300)),
      '登记时动了意志字段 —— 会把屏蔽/追踪状态冲掉').toBe(false);
  });

  it('⭐ 登记只写标识,不写计数字段', () => {
    // 设计 §4.1(4):seen_count/replied_count 是可重算的第三层属性
    const fn = AREPO.slice(AREPO.indexOf('export async function registerSeenAuthor'));
    expect(/seen_count|replied_count|accepted_count/.test(fn.slice(0, 1500)),
      '计数字段混进登记了 —— 会有与真实数据不同步的老问题').toBe(false);
  });

  it('⭐ 登记失败不能拦住推文入库', () => {
    // 推文是主数据,人表是派生登记
    const fn = TREPO.slice(TREPO.indexOf('export async function upsertTweet'));
    expect(fn.slice(0, 900)).toMatch(/catch/);
  });

  it('⭐ 回填迁移不能用那条静默失败的纯 SQL', () => {
    // 实测:FOR ... IN array::distinct(...) 对 6762 行返回空响应、
    // 一行没建、且不报错。改成 GROUP BY + 分批。
    const schema = readFileSync(
      resolve(__dirname, '../../src/storage/surreal/x-schema.ts'), 'utf-8');
    const fn = schema.slice(schema.indexOf('export async function x_migration_1_1_4'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/GROUP BY author_handle/);
    // 只看代码:注释里正解释着为什么不用它,别自己撞上
    expect(/array::distinct/.test(stripComments(body)),
      '又用回那条静默失败的写法了').toBe(false);
  });
});

describe('追踪名单(watchlist)', () => {
  const REPO = readFileSync(
    resolve(__dirname, '../../src/platform/main/db/x-author-repo.ts'), 'utf-8');
  const HAND = readFileSync(
    resolve(__dirname, '../../src/platform/main/x/x-timeline-handlers.ts'), 'utf-8');

  it('⭐ 措辞:代码里不许把追踪叫「关注」(会和 X 的 follow 混淆)', () => {
    // 设计文档 §0 明令。混用会让人以为改这里会动 X 上的关注关系。
    const code = stripComments(REPO) + stripComments(HAND);
    const bad = [...code.matchAll(/关注(名单|列表|某人|了他)/g)].map((m) => m[0]);
    expect(bad, `出现了「关注」措辞:${bad.join(',')}`).toEqual([]);
  });

  it('⭐ 移出名单只清标记,绝不删行', () => {
    // 同一行还挂着 blocked / 画像计数 / is_self,删行会连带丢掉别的意志
    const fn = REPO.slice(REPO.indexOf('export async function unwatchAuthor'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/UPDATE x_author SET watched = false/);
    expect(/DELETE/.test(body), 'unwatch 在删行 —— 会丢掉同一行上的其它意志').toBe(false);
  });

  it('⭐ 追踪与屏蔽互斥 —— 加入追踪要清掉 blocked', () => {
    // 两个都为 true 是矛盾状态,不能留给查询端各自解释
    const fn = REPO.slice(REPO.indexOf('export async function watchAuthor'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toMatch(/blocked = false/);
  });

  it('⭐ 统计按需聚合,不在 x_author 存计数字段', () => {
    // 设计 §4.1(4):那些是第三层计算属性,混进「人」表是层次不清,
    // 且计数字段与真实数据不同步是最常见的 bug 源
    expect(REPO).toMatch(/export async function getAuthorStats/);
    const schema = readFileSync(
      resolve(__dirname, '../../src/storage/surreal/x-schema.ts'), 'utf-8');
    const seg = schema.slice(schema.indexOf('DEFINE TABLE IF NOT EXISTS x_author'),
      schema.indexOf('DEFINE TABLE IF NOT EXISTS x_tweet'));
    expect(/seen_count|replied_count|accepted_count/.test(seg),
      '计数字段又混进 x_author 了 —— 那是可重算的第三层属性').toBe(false);
  });

  it('⭐ n=1 自动入列只在真回复时触发,dismissed 不入列', () => {
    // dismissed 表示「这条不该回」,不该因此追踪这个人
    const seg = HAND.slice(HAND.indexOf('X_REPLY_FEEDBACK'));
    expect(seg).toMatch(/action !== 'dismissed'[\s\S]{0,200}watchAuthor/);
  });

  it('⭐ n≥2 不实现(设计 §3.4:先看清 n=1 的真实规模)', () => {
    // 预先实现会爆炸,门槛得看真实数据说话
    expect(REPO).toMatch(/n≥2\s*\*\*不实现\*\*|n≥2.{0,10}不实现/);
  });

  it('include:replies 必须标注未经实机验证', () => {
    // 设计 §4.4⑤(a) 明令先 spike;照文档假设正是 selector 屡次翻车的老路
    const scan = readFileSync(
      resolve(__dirname, '../../src/platform/main/x/x-timeline-scan.ts'), 'utf-8');
    expect(scan).toMatch(/未经实机验证/);
  });
});

describe('账号画像:去挖事实,不靠猜', () => {
  const PROFILE = readFileSync(
    resolve(__dirname, '../../src/platform/main/x/x-author-profile.ts'), 'utf-8');
  const FACTS = readFileSync(
    resolve(__dirname, '../../src/shared/types/x-reply-facts.ts'), 'utf-8');

  it('⭐ 必须真的采账号载荷,不能只读库', () => {
    // 用户 2026-09-06:「你的逻辑限制在现有数据,而不是去挖掘事实」
    // 能力勘查 §2.4 早已实测 UserByScreenName 带全部画像字段
    expect(PROFILE).toMatch(/UserByScreenName/);
    expect(PROFILE).toMatch(/saveAuthorCounts/);
  });

  it('⭐ 解析不得写死响应路径(改版会静默取不到)', () => {
    expect(PROFILE).toMatch(/findUserResult/);
    // 只看代码:注释里正解释着「不要写死 data.user.result」,别自己撞上
    expect(
      /data\.user\.result/.test(stripComments(PROFILE)),
      '写死路径了 —— X 改版后会静默返回 undefined',
    ).toBe(false);
  });

  it('⭐ 采不到必须报错,不能返回空画像', () => {
    // 空画像会被下游当成「这人没粉丝、刚注册」,比没有更糟
    expect(PROFILE).toMatch(/未截获/);
    const fn = PROFILE.slice(PROFILE.indexOf('export async function harvestAuthorProfile'));
    expect(fn).toMatch(/if \(!profile\)[\s\S]{0,120}error/);
  });

  it('⭐ 只 detach 自己 attach 的(否则会掐掉别人的监听)', () => {
    // harvester / notification-watch 也在用同一个 debugger
    expect(PROFILE).toMatch(/if \(attached\)/);
  });

  it('⭐ 有资料就用资料判断,没资料才退回看正文', () => {
    expect(FACTS).toMatch(/posterBlock/);
    expect(FACTS).toMatch(/已查证|verified, you may rely/);
    expect(FACTS).toMatch(/未采集到|not collected/);
  });

  it('⭐ 画像采集失败不能拦住回复', () => {
    // 拿不到资料就不给回复,是因小失大;没资料时模型会倾向 unclear,那是诚实降级
    const h = readFileSync(
      resolve(__dirname, '../../src/platform/main/x/x-timeline-handlers.ts'), 'utf-8');
    const seg = h.slice(h.indexOf('X_PLAN_ONE_REPLY'), h.indexOf('X_REPLY_FEEDBACK'));
    expect(seg).toMatch(/不拦回复|不拦住回复/);
  });

  it('画像有新鲜度概念(粉丝数会变)', () => {
    expect(PROFILE).toMatch(/PROFILE_STALE_HOURS/);
  });
});

describe('推断链留档(回归分析的依据)', () => {
  it('⭐ 三步都要输出:作者判断 / 因由 / 正文', () => {
    // 用户 2026-09-06:只记正文的话,回错了无法定位是哪一步坏的
    const facts = readFileSync(
      resolve(__dirname, '../../src/shared/types/x-reply-facts.ts'), 'utf-8');
    const fn = facts.slice(facts.indexOf('export function buildSingleReplyPrompt'));
    for (const k of ['posterKind', 'posterRead', 'trigger']) {
      expect(fn, `prompt 里少了 ${k}`).toContain(k);
    }
  });

  it('⭐ prompt 必须允许并鼓励 unclear(不许猜)', () => {
    // 库里没有账号资料,判不出来就该说判不出来
    const facts = readFileSync(
      resolve(__dirname, '../../src/shared/types/x-reply-facts.ts'), 'utf-8');
    const fn = facts.slice(facts.indexOf('export function buildSingleReplyPrompt'));
    expect(fn).toMatch(/unclear/);
    expect(fn).toMatch(/不要猜|rather than guessing/);
  });

  it('⭐ posterKind 越界值必须归 unclear,不能勉强塞进某一类', () => {
    expect(PLANNER).toMatch(/KINDS\.includes/);
    expect(PLANNER).toMatch(/: 'unclear'/);
  });

  it('⭐ 推断链必须落库(否则谈不上事后回归)', () => {
    const repo = readFileSync(
      resolve(__dirname, '../../src/platform/main/db/x-reply-feedback-repo.ts'), 'utf-8');
    for (const k of ['poster_kind', 'poster_read', 'trigger', 'ai_reason', 'in_thread']) {
      expect(repo, `落库字段少了 ${k}`).toContain(k);
    }
    // 弹窗要真的把它传上去,否则字段永远是空的
    expect(DIALOG).toMatch(/poster_kind:\s*draft\.trace\?\.posterKind/);
  });

  it('⭐ 不回的理由也要带推断链(为什么没回同样要能复查)', () => {
    const fn = PLANNER.slice(PLANNER.indexOf('export async function planOneReply'));
    const seg = fn.slice(fn.indexOf('if (!parsed?.worth)'));
    expect(seg.slice(0, 600)).toMatch(/trace\.posterKind/);
  });

  it('⭐ UI 必须标明①是推断而非账号资料', () => {
    // 别让人把模型的猜测当成查证过的事实
    expect(DIALOG_RAW).toMatch(/不是账号资料/);
    expect(DIALOG).toMatch(/POSTER_LABEL/);
  });
});

describe('上下文缺失要让用户知道', () => {
  it('⭐ 生成只喂正文 —— 这是事实,别假装喂了上下文', () => {
    // 现状:{ role: 'user', content: tweet.text }。没有父推/会话串。
    // 这条守卫不是禁止改进,是钉住「现状必须与 UI 提示一致」——
    // 哪天真喂了上下文,这里会红,提示语也该跟着改。
    const fn = PLANNER.slice(PLANNER.indexOf('export async function planOneReply'));
    expect(fn).toMatch(/content:\s*tweet\.text/);
  });

  it('⭐ 串内回复必须能认出来 —— 不能只信 in_reply_to 字段', () => {
    // 实测:search 采集的 3782 条里只有 48 条有关系字段。
    // 只信字段 = 永远判 false = 提示形同虚设。必须有正文形态兜底。
    expect(isInThread({ in_reply_to: '123', text: '随便' })).toBe(true);
    expect(isInThread({ text: '@someone 你说的那个梯子叫啥' })).toBe(true);
    expect(isInThread({ text: '  @a @b 我也想知道' })).toBe(true);
    // 独立求助推不该被误标(否则每条都弹警告 = 提示失效)
    expect(isInThread({ text: '大家有没有好用的VPN推荐' })).toBe(false);
    expect(isInThread({ text: 'anyone know a good VPN? mine keeps dropping' })).toBe(false);
  });

  it('⭐ 弹窗必须显示这个警告', () => {
    expect(DIALOG).toMatch(/draft\.inThread/);
    expect(DIALOG_RAW).toMatch(/没有上文/);
  });

  it('⭐ inThread 必须真的算出来,不能恒 false', () => {
    // 写死 false 会让守卫全绿而提示永不出现
    expect(PLANNER).toMatch(/inThread:\s*isInThread\(/);
    expect(/inThread:\s*false/.test(PLANNER), 'inThread 被写死了').toBe(false);
  });
});

describe('单条路径的延迟约束', () => {
  it('⭐ 单条必须一次问完(判断+生成合并),不能两趟串行', () => {
    // 用户 2026-09-06「生成很慢」:两趟串行是主因(~27s 热启动)
    expect(PLANNER).toMatch(/buildSingleReplyPrompt/);
    const fn = PLANNER.slice(PLANNER.indexOf('export async function planOneReply'));
    const calls = [...fn.matchAll(/await callOllama/g)];
    expect(calls.length, `planOneReply 里有 ${calls.length} 次模型调用,应该只有 1 次`).toBe(1);
  });

  it('⭐ 单条契约必须是对象,不能用数组', () => {
    // 实测:数组 grammar 让模型难判何时收尾 —— 11-36s 且方差极大;
    // 对象稳定 6-7s。这不是风格问题,是实测出来的性能差异。
    const facts = readFileSync(
      resolve(__dirname, '../../src/shared/types/x-reply-facts.ts'), 'utf-8');
    const fn = facts.slice(facts.indexOf('export function buildSingleReplyPrompt'));
    expect(fn).toMatch(/JSON 对象|JSON object/);
    expect(/输出 JSON 数组|Output a JSON array/.test(fn.slice(0, fn.indexOf('\n}'))), 
      '单条 prompt 又要求数组了 —— 会慢 2-5 倍').toBe(false);
  });

  it('⭐ 不得用 num_predict 提速(会变成静默截断)', () => {
    // 实测:200/300/400 三档模型把预算烧光返回**空串**,512 时灵时不灵。
    // 那是把「慢」换成「悄悄发不出去」,比慢严重得多。
    const all = PLANNER + readFileSync(
      resolve(__dirname, '../../src/platform/main/local-llm/ollama-client.ts'), 'utf-8');
    expect(/num_predict/.test(all), 'num_predict 是陷阱,见 x-reply-facts 顶部说明').toBe(false);
  });

  it('⭐ 前置规则必须在模型调用之前(挡掉的连推理时间都不花)', () => {
    const fn = PLANNER.slice(PLANNER.indexOf('export async function planOneReply'));
    const dup = fn.indexOf("skip('duplicate_text'");
    const model = fn.indexOf('await callOllama');
    expect(dup).toBeGreaterThan(-1);
    expect(dup < model, '前置规则跑到模型后面了 —— 白白花掉推理时间').toBe(true);
  });

  it('⭐ handler 的取数必须并行(三次 5000 行串行是实测耗时点)', () => {
    const h = readFileSync(
      resolve(__dirname, '../../src/platform/main/x/x-timeline-handlers.ts'), 'utf-8');
    const seg = h.slice(h.indexOf('X_PLAN_ONE_REPLY'), h.indexOf('X_REPLY_FEEDBACK'));
    expect(seg).toMatch(/await Promise\.all\(\[/);
  });
});

describe('学习期判据', () => {
  it('⭐ edited 必须由主进程判定,不信 renderer', () => {
    // 这是判据的分子 —— renderer 传错(或被改)会让「原样通过率」失真
    const h = readFileSync(
      resolve(__dirname, '../../src/platform/main/x/x-timeline-handlers.ts'), 'utf-8');
    const seg = h.slice(h.indexOf('X_REPLY_FEEDBACK'));
    expect(seg).toMatch(/edited:\s*p\.final_text\.trim\(\) !== p\.ai_text\.trim\(\)/);
  });

  it('⭐ 通过率必须分语言算', () => {
    // 合起来算会让样本多的一边淹掉另一边,得出「整体达标」的假结论
    expect(REPO_RAW).toMatch(/for \(const lang of \['zh', 'en'\]/);
  });

  it('⭐ 只统计 filled,dismissed 不算进通过率', () => {
    // dismissed = 这条根本不该回,是判断层的问题,不是「写得好不好」
    expect(REPO_RAW).toMatch(/action = 'filled'/);
  });

  it('⭐ 少样本只取原样通过的例子', () => {
    // 用户改过的说明 AI 那版不够好,拿它当范例是在教模型重复被否决的写法
    const seg = REPO_RAW.slice(REPO_RAW.indexOf('getApprovedExamples'));
    expect(seg).toMatch(/edited = false/);
  });

  it('⭐ 通过率的分子必须是 edited=false(分母是全部 filled)', () => {
    // 差点踩到:注入实验误把分子的 edited=false 去掉,
    // 两条 count 变成一样 → 通过率恒 100% → **门槛永远"达标"**,
    // 而且看不出异常。这条守卫就是钉这个。
    const seg = REPO_RAW.slice(REPO_RAW.indexOf('export async function getReadiness'));
    const sql = seg.slice(seg.indexOf('`'), seg.indexOf('`', seg.indexOf('`') + 1));
    const lines = sql.split(';').filter((x) => x.includes('count()'));
    expect(lines.length, '应有两条 count:分母(全部 filled)与分子(未改动)').toBe(2);
    expect(lines[0].includes('edited'), '分母不该带 edited 条件').toBe(false);
    expect(lines[1].includes('edited = false'), '分子必须只数未改动的').toBe(true);
  });

  it('放手门槛是可调常量,不是埋在逻辑里的魔数', () => {
    expect(REPO_RAW).toMatch(/AUTO_REPLY_MIN_SAMPLES\s*=\s*\d+/);
    expect(REPO_RAW).toMatch(/AUTO_REPLY_MIN_PASS_RATE\s*=\s*[\d.]+/);
  });
});

describe('正文只来自模板库', () => {
  it('⭐ 判断 prompt 只判该不该回,不掺正文/模板字段', () => {
    // 判断与生成是两次调用、两份 prompt。判断这次只要 reply/confidence/reason
    const promptStart = PLANNER.indexOf('REPLY_SYSTEM_PROMPT');
    const prompt = PLANNER.slice(promptStart, PLANNER.indexOf('`;', promptStart));
    expect(prompt).toMatch(/你不生成任何回复正文/);
    expect(prompt).not.toMatch(/"template"\s*:/);
  });

  it('⭐ 模板选择仍不问模型(一致率 37%,语料本身无信号)', () => {
    const pick = PLANNER.slice(PLANNER.indexOf('export function pickTemplate'));
    const body = pick.slice(0, pick.indexOf('\n}'));
    expect(/decision|verdict|ollama/i.test(body)).toBe(false);
  });

  it('⭐ 生成的正文必须过校验才用(校验不过一律回落,不硬发)', () => {
    // link_altered 尤其隐蔽:发出去看不出异常,但那次点击永远归不了因
    expect(PLANNER).toMatch(/verifyGeneratedReply/);
    const gen = PLANNER.slice(PLANNER.indexOf('for (const raw of items2)'));
    const body = gen.slice(0, gen.indexOf('\n    }\n  }'));
    expect(
      /if \(bad\)[\s\S]{0,200}continue/.test(body),
      '校验结果没有拦住写入 —— 不合格正文会被当成合格发出去',
    ).toBe(true);
  });

  it('⭐ 回落模板必须留原因(否则发现不了「校验一直在拦」)', () => {
    expect(PLANNER).toMatch(/fallbackReason/);
    expect(PLANNER).toMatch(/回落模板/);
  });

  it('⭐ 模板仍是兜底路径,不能被删掉', () => {
    // 模型挂了/Ollama 不在时还得能发,回落是保底不是摆设
    expect(PLANNER).toMatch(/renderTemplate\(tpl, ref\)/);
    expect(PLANNER).toMatch(/source = 'template'/);
  });

  it('模板库非空,且每个模板都有正文', () => {
    expect(REPLY_TEMPLATES.length).toBeGreaterThan(0);
    for (const t of REPLY_TEMPLATES) {
      expect(t.text.trim().length, `模板 ${t.id} 正文为空`).toBeGreaterThan(0);
    }
  });

  it('⭐ 模板正文不得自带 @提及(X 回复框会自动带,重复会变 @@xxx)', () => {
    for (const t of REPLY_TEMPLATES) {
      expect(/^@\w+/.test(t.text.trim()), `模板 ${t.id} 自带了 @提及`).toBe(false);
    }
  });

  it('getTemplate 对未知 id 必须 throw(不静默回退第一个模板)', () => {
    // 静默回退 = 发错内容出去才发现
    expect(() => getTemplate('nope' as never)).toThrow();
  });

  it('⭐ 模板里不得残留 X 的 t.co 短链', () => {
    // t.co 是 X 发布时生成的包装,硬编码它 = 丢掉 ref 统计参数,
    // 且指向一条我们控制不了也更新不了的跳转
    for (const t of REPLY_TEMPLATES) {
      expect(hasStaleShortLink(t), `模板 ${t.id} 还带着 t.co 短链`).toBe(false);
    }
  });
});

describe('事实清单与生成校验', () => {
  const LINK = 'https://situstechnologies.com/x?ref=tw_t&lang=zh&v=6';

  it('⭐ 链接必须逐字存在 —— 缺了/改了都要拦', () => {
    // 链接是统计资产:模型改一个字符不报错、发出去看不出来,
    // 但那次点击永远归不了因。这条不能靠模型自觉。
    expect(verifyGeneratedReply(`试试这个 ${LINK}`, LINK)).toBeNull();
    expect(verifyGeneratedReply('试试这个吧', LINK)).toBe('link_missing');
    expect(verifyGeneratedReply(
      '试试 https://situstechnologies.com/x?ref=CHANGED&lang=zh&v=6', LINK)).toBe('link_altered');
  });

  it('⭐ 最高级/稳定性承诺必须拦(外语实测踩过)', () => {
    // 俄语加过「稳定运行」、波斯语加过「最佳选择」
    expect(verifyGeneratedReply(`本产品稳定运行 ${LINK}`, LINK)).toBe('superlative');
    expect(verifyGeneratedReply(`这是最佳选择 ${LINK}`, LINK)).toBe('superlative');
    expect(verifyGeneratedReply(`the best option ${LINK}`, LINK)).toBe('superlative');
  });

  it('⭐ 自带 @提及要拦(X 会再带一次 → @@xxx)', () => {
    expect(verifyGeneratedReply(`@someone 试试 ${LINK}`, LINK)).toBe('has_mention');
  });

  it('空正文与超长要拦', () => {
    expect(verifyGeneratedReply('', LINK)).toBe('empty');
    expect(verifyGeneratedReply('啊'.repeat(300) + LINK, LINK)).toBe('too_long');
  });

  it('⭐ 事实清单里禁止项必须显式列出(比"别瞎说"有效)', () => {
    for (const k of ['价格', '速度数字', '节点数量', '优惠活动', '退款政策']) {
      expect(PRODUCT_FACTS.forbidden, `禁止项少了 ${k}`).toContain(k);
    }
  });

  it('⭐ 生成 prompt 必须带事实清单和「原样照抄链接」', () => {
    const zh = buildGenerationPrompt('zh', LINK);
    expect(zh).toContain(LINK);
    expect(zh).toMatch(/原样照抄/);
    expect(zh).toMatch(/严禁/);
    const en = buildGenerationPrompt('en', LINK);
    expect(en).toContain(LINK);
    expect(en).toMatch(/verbatim/);
    expect(en).toMatch(/NEVER/);
  });

  it('⭐ 少样本示例会进 prompt(学习期修改的回流路径)', () => {
    const withEx = buildGenerationPrompt('zh', LINK, [{ tweet: '求推荐', reply: '试试这个' }]);
    expect(withEx).toContain('求推荐');
    expect(withEx).toContain('试试这个');
  });
});

describe('追踪标识 ref', () => {
  it('⭐ 模板用原始落地页 + {ref} 占位', () => {
    for (const t of REPLY_TEMPLATES) {
      expect(t.text, `模板 ${t.id} 没用落地页`).toContain(LANDING_BASE);
      expect(needsRef(t), `模板 ${t.id} 少了 {ref} 占位`).toBe(true);
    }
  });

  it('⭐ renderTemplate 必须把占位全换掉', () => {
    for (const t of REPLY_TEMPLATES) {
      const out = renderTemplate(t, 'tw_x_20260904');
      expect(out, `模板 ${t.id} 渲染后仍有占位`).not.toContain(REF_PLACEHOLDER);
      expect(out).toContain('ref=tw_x_20260904');
    }
  });

  it('⭐ 有占位却不给 ref 必须 throw(不能把 {ref} 字面量发出去)', () => {
    // 静默留着占位 = 推给用户一条明显坏掉的链接
    expect(() => renderTemplate(REPLY_TEMPLATES[0], '')).toThrow();
    expect(() => renderTemplate(REPLY_TEMPLATES[0], '   ')).toThrow();
  });

  it('ref 形态:tw_<账号>_<日期>[_<配方>],只含 URL 安全字符', () => {
    const at = new Date('2026-09-04T10:00:00Z');
    expect(buildRef('netlab2gfw', at)).toBe('tw_netlab2gfw_20260904');
    expect(buildRef('netlab2gfw', at, 'vpn-help')).toBe('tw_netlab2gfw_20260904_vpnhelp');
    // 非法字符必须被剔除,不能带进 URL
    expect(buildRef('a@b#c', at)).toMatch(/^tw_abc_\d{8}$/);
  });

  it('⭐ ref 按批次不按条 —— 同一批各条正文必须完全相同', () => {
    // 每条唯一 = 正文条条不同 = 水军最直接的特征之一
    const ref = buildRef('netlab2gfw', new Date());
    const a = renderTemplate(REPLY_TEMPLATES[0], ref);
    const b = renderTemplate(REPLY_TEMPLATES[0], ref);
    expect(a).toBe(b);
  });
});

describe('前置过滤不问模型', () => {
  it('⭐ 文本指纹能识别「同一句话」的刷屏', () => {
    // 这两条在库里一字不差出现过 3 次,是评测里唯一残留假阳的来源
    const a = textFingerprint('我有小火箭加速器，求推荐一个好用的VPN');
    const b = textFingerprint('@someone 我有小火箭加速器，求推荐一个好用的VPN https://t.co/abc');
    expect(a, '@提及与链接不同就认不出是同一句 —— 刷屏必然漏网').toBe(b);
  });

  it('⭐ 不同内容必须有不同指纹(否则会误杀真求助)', () => {
    const a = textFingerprint('大家有什么好用的机场推荐吗');
    const b = textFingerprint('我有小火箭加速器，求推荐一个好用的VPN');
    expect(a).not.toBe(b);
  });

  it('阈值为 2 —— 真人不会一字不差发两遍', () => {
    expect(DUPLICATE_FINGERPRINT_THRESHOLD).toBe(2);
  });

  it('⭐ 前置过滤必须在调用模型之前(省算力,更要省误回)', () => {
    const filterAt = PLANNER.indexOf("push('duplicate_text'");
    // 判断调用在 planReplies 内(生成调用在 generateReplies 里,更靠前定义)
    const modelAt = PLANNER.indexOf('const response = await callOllama');
    expect(filterAt, '找不到刷屏过滤').toBeGreaterThan(-1);
    expect(modelAt, '找不到判断调用').toBeGreaterThan(-1);
    expect(
      filterAt < modelAt,
      '过滤跑在模型之后 —— 刷屏推文会先被模型判成「该回」',
    ).toBe(true);
  });

  it('⭐ 冷却/已回过/屏蔽三道闸都要在', () => {
    for (const k of ['already_replied', 'blocked_author', 'author_recent', 'duplicate_text']) {
      expect(PLANNER, `少了 ${k} 这道闸`).toContain(k);
    }
  });

  it('⭐ 被挡掉的必须留原因,不静默丢', () => {
    // 否则「为什么没回这条」无从查起
    expect(PLANNER).toMatch(/skips\.push/);
    expect(PLANNER).toMatch(/skipReason/);
  });
});

describe('模板轮换(不问模型)', () => {
  it('⭐ 连续选取不重复 —— 避免连发同一句被判水军', () => {
    for (const lang of ['zh', 'en'] as const) {
      const pool = templatesFor(lang);
      const picked: string[] = [];
      let recent: ReturnType<typeof pickTemplate>[] = [];
      for (let i = 0; i < pool.length; i++) {
        const id = pickTemplate(recent, lang);
        picked.push(id);
        recent = [id, ...recent];
      }
      expect(new Set(picked).size, `${lang} 轮换失效,${pool.length} 次里出现重复`)
        .toBe(pool.length);
    }
  });

  it('⭐ 模板选择不得依赖模型返回', () => {
    // 离线一致率仅 37%,且语料本身无信号(同质父推人工也用了不同模板)
    const pick = PLANNER.slice(PLANNER.indexOf('export function pickTemplate'));
    const body = pick.slice(0, pick.indexOf('\n}'));
    expect(
      /decision|verdict|ollama|d\.template/i.test(body),
      'pickTemplate 又去看模型输出了 —— 那是在学噪声',
    ).toBe(false);
  });
});

describe('中英文分流', () => {
  it('⭐ 中文推用中文模板,其余一律英文', () => {
    // 给英文推回中文文案,对方看不懂 = 白发一条还留垃圾记录
    expect(langOf('zh')).toBe('zh');
    expect(langOf('zh-Hans')).toBe('zh');
    expect(langOf('en')).toBe('en');
    expect(langOf('ja')).toBe('en');       // 非中文回退英文(国际通用)
    expect(langOf(undefined)).toBe('en');
  });

  it('⭐ 两种语言都必须有可用模板(否则 pickTemplate 会 throw)', () => {
    expect(templatesFor('zh').length).toBeGreaterThan(0);
    expect(templatesFor('en').length).toBeGreaterThan(0);
  });

  it('⭐ 选出的模板语言必须与请求一致', () => {
    for (const lang of ['zh', 'en'] as const) {
      const id = pickTemplate([], lang);
      expect(getTemplate(id).lang, `lang=${lang} 选出了别的语言的模板`).toBe(lang);
    }
  });

  it('⭐ 链接参数按语言:中文 lang=zh&v=6,英文 lang=en&v=7', () => {
    // 用户 2026-09-04 给定,两者均已实测 307 → 200
    expect(LINK_PARAMS.zh).toBe('lang=zh&v=6');
    expect(LINK_PARAMS.en).toBe('lang=en&v=7');
    for (const t of REPLY_TEMPLATES) {
      expect(t.text, `模板 ${t.id} 链接参数与其语言不符`).toContain(LINK_PARAMS[t.lang]);
    }
  });

  it('⭐ 英文文案必须标 needsHumanReview(全库 0 条英文语料,是新写的)', () => {
    // 语料里像英文句子的回复是 0 条 —— 那 115 条「无中文」全是数字和 emoji。
    // 发出去的是产品承诺,不能让用户不知情地发未经检验的文案。
    for (const t of templatesFor('en')) {
      expect(t.needsHumanReview, `英文模板 ${t.id} 没标待审核`).toBe(true);
    }
  });

  it('中文文案有语料依据,不该标待审核', () => {
    for (const t of templatesFor('zh')) {
      expect(t.needsHumanReview ?? false, `中文模板 ${t.id} 被误标待审核`).toBe(false);
      expect(t.observedCount).toBeGreaterThan(0);
    }
  });
});

describe('失败要响,不静默产出空草稿', () => {
  it('⭐ 模型返回结构异常必须 throw(同 x-ai-judge 的教训)', () => {
    // 回复层丢一批 = 该回的没回,而面板显示一切正常,比判断层后果更重
    expect(PLANNER).toContain('contains no decision array');
    const ex = PLANNER.slice(PLANNER.indexOf('function extractDecisions'));
    expect(
      /\?\?\s*\[\]/.test(ex.slice(0, ex.indexOf('\n}'))),
      '又出现了 `?? []` 兜底 —— 整批会被静默当成空批',
    ).toBe(false);
  });

  it('⭐ 置信度下限存在且不为 0(宁可漏不可扰)', () => {
    expect(REPLY_CONFIDENCE_FLOOR).toBeGreaterThan(0);
    expect(PLANNER).toContain('low_confidence');
  });

  it('模型漏判某条时不得当成「不该回」而无痕跳过', () => {
    expect(PLANNER).toMatch(/模型未返回该条判断/);
  });
});
