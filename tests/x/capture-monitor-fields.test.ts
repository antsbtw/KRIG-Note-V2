/**
 * ⭐⭐ 采集监视器:字段补全 + 盯人过滤(2026-09-15)
 *
 * 用户拍板两条:
 * > ②「建议补全,进一步做画像会需要的」
 * > ③「上部分有一个 card,是这个人的 bio,下边就是可以滚动的正在抓推文及其他信息」
 *
 * ── 守什么 ──
 *
 * ⚠️ 补全字段的**真正风险不是漏传,是传了不用**。
 * 载荷层 `HarvestedTweet` 早就有 20+ 字段,而 snapshot 只挑了 7 个传出去 ——
 * 「采到了但看不到」。补全之后如果 UI 还只显示 likes,等于白补,
 * 而且**没有任何测试会红**(类型对得上、编译得过、界面照样跑)。
 *
 * ⭐ 所以这里钉三层:main 传了 → 契约声明了 → **UI 真的渲染了**。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf-8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const MONITOR = read('src/platform/main/x/x-capture-monitor.ts');
const MONITOR_CODE = strip(MONITOR);
const DTS = read('src/shared/ipc/electron-api.d.ts');
/**
 * ⚠️ 2026-09-15 改钉新面板:盯人这套一度在**两个**面板里各有一份 ——
 * 旧面板 XInboxView 那份进不去(`view === 'capture'` 的顶栏入口早被撤了,
 * 见 XInboxView 837 行注释),所以用户点了没反应、问「还是这个UI?」。
 * 用户拍板「删掉旧面板那份,守卫改钉新面板」= 一份实现一份守卫。
 *
 * ⭐ 守卫必须钉**活代码**:钉在没有入口的分支上,全绿也证明不了用户点得到。
 */
const VIEW = read('src/views/x-workbench/XWorkbenchView.tsx');
const VIEW_CODE = strip(VIEW);
const HARVESTER = read('src/platform/main/x/x-timeline-harvester.ts');

/** 做画像要用、且载荷层确实有的字段 */
const RICH_FIELDS = [
  'inReplyToStatusId',
  'inReplyToScreenName',
  'conversationId',
  'quotedStatusId',
  'hasMedia',
  'authorRestId',
  'isLongText',
] as const;

describe('⭐⭐ 字段补全:三层都要有,少一层就等于没补', () => {
  it('⭐ 前提自检:载荷层确实有这些字段(否则本组是空转的)', () => {
    for (const f of RICH_FIELDS) {
      expect(HARVESTER, `HarvestedTweet 没有 ${f} —— 那这条守卫在守一个不存在的东西`)
        .toMatch(new RegExp(`\\b${f}\\b`));
    }
  });

  it('⭐⭐ main 侧 snapshot 把它们**传出去**(不是只在类型里声明)', () => {
    // 只看 recent 的组装体 —— 类型声明里有不算数,要真的赋值
    const at = MONITOR_CODE.indexOf('const recent = onScreenTweets.map(');
    expect(at, '锚点过时:找不到 recent 组装').toBeGreaterThan(0);
    const body = MONITOR_CODE.slice(at, MONITOR_CODE.indexOf('return {', at));
    for (const f of RICH_FIELDS) {
      expect(body, `snapshot 没传 ${f} —— 采到了但传不出去`).toContain(f);
    }
    // 完整 metrics 与自身状态(此前只传了 likes)
    expect(body, 'metrics 又被裁成单个 likes').toMatch(/metrics:\s*t\.metrics/);
    expect(body).toMatch(/self:\s*t\.self/);
  });

  it('⭐ 契约(d.ts)与 main 同步 —— 两端不一致时 renderer 拿不到', () => {
    for (const f of RICH_FIELDS) {
      expect(DTS, `electron-api.d.ts 缺 ${f}`).toMatch(new RegExp(`\\b${f}\\b`));
    }
  });

  it('⭐⭐ UI **真的渲染**了它们 —— 传了不用是「白补」', () => {
    // ⚠️ 这条才是本组的核心:上面两层都过了、UI 不显示,照样没有测试会红
    for (const f of ['inReplyToScreenName', 'inReplyToStatusId', 'hasMedia', 'isLongText']) {
      expect(VIEW_CODE, `面板没用 ${f} —— 补了字段却不显示,等于白补`)
        .toMatch(new RegExp(`t\\.${f}`));
    }
    // 完整互动数:至少转发/回复要露出来,不能只剩 likes
    expect(VIEW_CODE).toMatch(/t\.metrics\?\.retweets/);
    expect(VIEW_CODE).toMatch(/t\.metrics\?\.replies/);
    // 我自己的状态
    expect(VIEW_CODE).toMatch(/t\.self\?\./);
  });
});

describe('⭐⭐ 盯人:过滤在呈现层,不在采集层', () => {
  it('⭐⭐ 采集层**不按作者过滤** —— 采集层无条件全收是本仓已定的原则', () => {
    /**
     * 用户 2026-09-03 定:「不要过滤,入库后前端就可以请求了」——
     * 「原先在采集层就把推荐流丢掉,结果是**丢掉的永远查不回来**」。
     * 所以盯人只是「少显示」,不是「少采」。
     */
    const at = MONITOR_CODE.indexOf('const recent = onScreenTweets.map(');
    const body = MONITOR_CODE.slice(Math.max(0, at - 800), at);
    expect(body, '监视器按 handle 过滤了 —— 采集层丢数据,丢了就查不回来')
      .not.toMatch(/watchHandle|targetHandle|onlyAuthor/);
  });

  it('⭐ 呈现层有过滤,且列表用的是过滤后的结果', () => {
    expect(VIEW_CODE).toMatch(/const shown = \(snap\?\.recent \?\? \[\]\)\.filter/);
    // ⚠️ 定义了 shown 却还渲染 snap.recent = 过滤形同虚设(本次会话犯过同款)
    expect(VIEW_CODE, '列表没用 shown —— 过滤白做').toMatch(/\{shown\.map\(/);
    expect(VIEW_CODE).not.toMatch(/\{\(snap\?\.recent \?\? \[\]\)\.map\(/);
  });

  it('⭐⭐ 计数口径要说清:显示的是「他的 N 条」而不是拿全局数字冒充', () => {
    // 否则会出现「列表 3 条、采集率 99%」这种对不上的账
    expect(VIEW_CODE).toMatch(/shown\.length/);
    expect(VIEW_CODE, '盯人时要标注屏幕总数,别让人以为屏幕上只有这几条')
      .toMatch(/屏幕共/);
  });
});

describe('⭐ bio 卡片', () => {
  it('⭐⭐ 抓画像是**手动触发** —— 它会导航,自动跑会顶掉用户正在看的页面', () => {
    const handlers = strip(read('src/platform/main/x/x-timeline-handlers.ts'));
    expect(handlers).toMatch(/X_FETCH_PROFILE/);
    expect(handlers, '空 handle 会导航到首页,然后把首页当成他的主页解析')
      .toMatch(/handle 必填/);
    // 面板侧:按钮触发,不在 useEffect 里自动调
    expect(VIEW_CODE).toMatch(/onClick=\{fetchProfile\}/);
    expect(VIEW_CODE, '抓画像被放进了自动执行路径 —— 会打断左侧浏览')
      .not.toMatch(/useEffect\([\s\S]{0,200}fetchProfile\(\)/);
  });

  it('⭐ 四端名字一致(?. 会让不一致静默失败,永远抓不到画像)', () => {
    const preload = read('src/platform/main/preload/main-window-preload.ts');
    const channels = read('src/shared/ipc/channel-names.ts');
    expect(preload).toMatch(/fetchAuthorProfile\(handle: string/);
    expect(DTS).toMatch(/fetchAuthorProfile\(handle: string/);
    expect(VIEW_CODE).toMatch(/fetchAuthorProfile\?\.\(/);
    expect(channels).toMatch(/X_FETCH_PROFILE:\s*'x:fetch-profile'/);
  });

  it('⭐ 卡片显示 bio 与三个计数(做画像的基础事实)', () => {
    for (const f of ['bio', 'followersCount', 'followingCount', 'tweetCount']) {
      expect(VIEW_CODE, `bio 卡片没显示 ${f}`).toMatch(new RegExp(`profile\\.${f}`));
    }
  });
});
