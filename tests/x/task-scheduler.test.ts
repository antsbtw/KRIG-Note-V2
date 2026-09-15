/**
 * ⭐⭐ 调度器从**任务表**驱动 + webview 租约(1b)
 *
 * 守的是用户 2026-09-14 拍板的两件事:
 *
 * > 「未来所有的执行从先在面板配置任务,然后才执行」
 * > 「对于两个任务撞车的,**不能同时执行**」
 *
 * ⚠️ 全是扫源码断言 —— 真跑一轮要活的 X webview(D 类真机)。
 * 这里守的是「结构上不可能退化回旧形态」。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf-8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const SCHED = read('src/platform/main/x/x-search-scheduler.ts');
const CODE = strip(SCHED);
const MIGRATION = read('src/storage/surreal/x-schema.ts');
const KEYWORD = read('src/capabilities/x-collect/strategies/keyword.ts');

describe('⭐⭐ 调度器读任务表,不读配方表', () => {
  it('⭐⭐ 读 x_task(listEnabledTasks),**不再**读 search_recipes', () => {
    expect(CODE).toContain('listEnabledTasks');
    expect(CODE, '还在读配方表 —— 任务模型没真正接上').not.toContain('listEnabledRecipes');
    expect(CODE, '直接拼 search_recipes 的 SQL').not.toContain('search_recipes');
  });

  it('⭐ 跑完写回任务表的 last_run_at,不是配方表', () => {
    expect(CODE).toContain('updateTaskLastRunAt');
    expect(CODE, '还在更新配方表 —— 下一轮到期判定会看错表').not.toMatch(/\bupdateLastRunAt\(/);
  });

  it('⭐⭐ 策略注册表**必须被初始化** —— 否则 get() 必抛,所有任务跑不起来', () => {
    // 2026-09-14 实测:registerInitialStrategies 曾全仓零调用,
    // 注册表建好了但是空的(「建好了没人用」的又一例)
    expect(CODE).toContain('registerInitialStrategies');
    const startBody = CODE.slice(CODE.indexOf('export function startScheduler'));
    expect(startBody, '注册要在 startScheduler 里,且先于任务轮询').toContain('registerInitialStrategies');
  });

  it('⭐ 策略取不到 → 记 failed 并跳过,不静默继续', () => {
    expect(CODE).toMatch(/collectStrategies\.get\(/);
    expect(CODE).toMatch(/setTaskRunState\([\s\S]{0,60}'failed'/);
  });
});

describe('⭐⭐ 撞车不能同时执行:webview 租约', () => {
  it('⭐⭐ 执行前取租约', () => {
    expect(CODE).toMatch(/pageRegistry\.lease\(/);
    // purpose 要能看出是谁占着 —— 排查「谁占着」时唯一线索
    expect(CODE).toMatch(/lease\([\s\S]{0,40}`task:/);
  });

  it('⭐⭐ 取不到租约就**跳过本轮**,不硬上', () => {
    const i = CODE.indexOf('pageRegistry.lease(');
    const after = CODE.slice(i, i + 500);
    expect(after, '取不到租约还继续执行 = 互斥形同虚设').toMatch(/status !== 'ok'[\s\S]{0,200}continue;/);
  });

  it('⭐⭐ 租约**必须在 finally 释放** —— 一次异常就永久占着', () => {
    const i = CODE.indexOf('pageRegistry.lease(');
    const after = CODE.slice(i);
    expect(after).toMatch(/finally\s*\{[\s\S]{0,300}pageRegistry\.release\(/);
  });

  it('⭐ 身份复用 xPageId,不另建一份(两份身份来源是本仓踩过的坑)', () => {
    expect(CODE).toContain('xPageId');
    expect(CODE, '自己 register 页面 = 第二份身份来源').not.toMatch(/pageRegistry\.register\(/);
  });
});

describe('⭐⭐ 无人值守:不依赖「有人点过开始扫描」', () => {
  /**
   * ⚠️⚠️ 2026-09-14 实测的既有缺陷:`activeXWcMap` 的**唯一**填充点是
   * `X_RUN_RECIPE` handler(人点「开始扫描」)。于是 app 重启后没点过扫描,
   * 定时采集每轮都在 `size === 0` 处**静默早退** —— 配方时代就是这样,
   * 只是手点扫描顺带登记了 wc,看起来才像在自动跑。
   */
  it('⭐⭐ 登记表为空时回落到无人值守扫描', () => {
    expect(CODE).toContain('resolveSchedulerTargets');
    expect(CODE, '没有回落 —— 没人点过扫描就永远不跑').toContain('resolveAnyXWebContents');
  });

  it('⭐⭐ 两个轮询都走回落,不是只改了一个', () => {
    const tasks = CODE.slice(CODE.indexOf('async function runEnabledTasks('));
    const watch = CODE.slice(CODE.indexOf('async function runWatchlist('));
    expect(CODE.indexOf('async function runEnabledTasks('), '锚点过时').toBeGreaterThan(0);
    expect(CODE.indexOf('async function runWatchlist('), '锚点过时').toBeGreaterThan(0);
    expect(tasks.slice(0, 600)).toContain('resolveSchedulerTargets');
    expect(watch.slice(0, 600), '盯人采集还在直接读登记表').toContain('resolveSchedulerTargets');
  });

  it('⭐⭐ 循环**不得**重新读 activeXWcMap 把 targets 覆盖掉', () => {
    /**
     * ⚠️ 我第一版就犯了这个错:函数开头算好 targets 做回落,
     * 循环里却写 `const targets = [...activeXWcMap.entries()]` **同名覆盖**,
     * 回落形同虚设。⚠️ tsc 看不出来(同名覆盖是合法的),只能靠这条钉。
     */
    /**
     * ⚠️⚠️ **2026-09-14 二修**:初版只扫 `runEnabledTasks → runWatchlist` 区间。
     * 后来执行逻辑搬进了 `runTasksForWs`,而它**排在 runEnabledTasks 之前**,
     * 于是不在区间内 —— 注入「runTasksForWs 里重读 activeXWcMap」**照样绿**,
     * 守卫已空转。实测证实过。
     *
     * ⭐ 改成扫**两个执行函数的并集**:从 runTasksForWs 起到 runWatchlist 止,
     * 覆盖中间所有执行相关代码,不论谁排在谁前面。
     */
    const from = CODE.indexOf('async function runTasksForWs(');
    const to = CODE.indexOf('async function runWatchlist(');
    expect(from, '锚点过时:找不到 runTasksForWs').toBeGreaterThan(0);
    expect(to, '锚点过时:找不到 runWatchlist').toBeGreaterThan(from);

    const body = CODE.slice(from, to);
    expect(
      body,
      '执行路径里又直接读了 activeXWcMap —— 会把无人值守回落覆盖掉',
    ).not.toContain('activeXWcMap');
  });

  it('⭐ 反推不出 wsId 就**不猜**(猜错会把任务跑到别的 ws 上且不报错)', () => {
    const fn = CODE.slice(CODE.indexOf('function resolveSchedulerTargets'));
    expect(fn).toContain('wsIdOf');
    expect(fn, '反推失败时还继续 —— 多 ws 下会跑错 ws').toMatch(/if \(!wsId\)[\s\S]{0,200}return \[\]/);
  });

  it('⭐ 反推规则复用 wsIdOf,不另写一份正则', () => {
    expect(
      CODE,
      '自己写 persist:webview- 正则 = 第二份实现,改一处漏一处',
    ).not.toMatch(/persist:webview-\(/);
  });
});

describe('⭐⭐ 任务归属于 ws:配给谁就只在谁那儿跑', () => {
  /**
   * 用户 2026-09-14 拍板:
   * > 「应该是在哪个窗口配置,就是打开哪个窗口才执行吧?
   * >   任何的配置只是对自己的窗口负责。」
   *
   * ⚠️ 旧模型(wsId 留空 = 所有 ws 都跑)实测三个洞:
   * 同一批推抓两遍 · 翻译调两次(刚被 429) · lastResult 被后完成的 ws 覆盖。
   * ⚠️ 租约**挡不住**:两个 ws 是两个 pageId,各拿各的。
   */
  const REPO = read('src/platform/main/db/x-task-repo.ts');
  const TYPES_TASK = read('src/shared/types/x-task.ts');

  it('⭐⭐ 调度器按 ws 查任务,不是拿全部再过滤', () => {
    expect(CODE, 'listEnabledTasks 必须收 wsId').toMatch(/listEnabledTasks\(wsId\)/);
  });

  it('⭐⭐ 方向是「每个 ws 问自己有哪些任务」,不是「每个任务问该在哪些 ws 跑」', () => {
    // 旧代码的特征:在 task 循环内部再按 ws 过滤 targets
    expect(CODE, '又出现了「一个任务对多个 ws」的过滤 —— 洞会复活')
      .not.toMatch(/targets\.filter\(\(\[wsId\]\) => wsId === task\.wsId\)/);
  });

  it('⭐⭐ repo 不提供「取全部 ws 的任务」——显示了就可能被点执行', () => {
    /**
     * ⚠️⚠️ **2026-09-14 修假绿**:初版写 `expect(REPO).toMatch(/WHERE ws_id = \$wsId/)`
     * —— 扫的是**整份文件**。而 `listAllTasks` 里也有同一句,
     * 于是把 `listEnabledTasks` 的过滤删掉,这条**照样绿**(注入 F 实测)。
     * ⭐ 必须**逐个函数体**查:全文匹配对「哪一个丢了」零区分力。
     */
    expect(REPO).toMatch(/listAllTasks\(wsId: string\)/);
    expect(REPO).toMatch(/listEnabledTasks\(wsId: string\)/);

    const bodyOf = (name: string): string => {
      const at = REPO.indexOf(`export async function ${name}(`);
      expect(at, `找不到 ${name} —— 锚点过时,本条会空转`).toBeGreaterThan(0);
      const rest = REPO.slice(at);
      const end = rest.indexOf('\n}');
      expect(end, `截不出 ${name} 函数体`).toBeGreaterThan(0);
      return rest.slice(0, end);
    };

    // 两个都要各自按 ws 过滤 —— 少一个就会漏出别的 ws 的任务
    for (const fn of ['listAllTasks', 'listEnabledTasks']) {
      expect(bodyOf(fn), `${fn} 的 SELECT 没按 ws 过滤`).toMatch(/WHERE[\s\S]*ws_id = \$wsId/);
    }
  });

  it('⭐⭐ wsId 必填(类型层),不是可选', () => {
    expect(TYPES_TASK, 'wsId 还是可选 —— 留空就会退回「所有 ws 都跑」')
      .not.toMatch(/wsId\?:\s*string/);
    expect(TYPES_TASK).toMatch(/wsId:\s*string;/);
  });

  it('⭐⭐ 读到没归属的任务要 **抛**,不回落成空串', () => {
    // 没归属 = 调度器按 ws 查时永远查不到 = 「列表里有它就是不跑」,毫无线索
    const fn = REPO.slice(REPO.indexOf('function rowToTask'), REPO.indexOf('export async function listAllTasks'));
    expect(fn.length, '截不出 rowToTask').toBeGreaterThan(0);
    expect(fn, 'ws_id 缺失时静默回落').toMatch(/throw new Error/);
    expect(fn).not.toMatch(/ws_id\s*\?\?\s*''/);
  });

  it('⭐ migration 1.1.9 把历史空归属补成 ws-2,且补不干净就 fail loud', () => {
    const mig = MIGRATION.slice(MIGRATION.indexOf('x_migration_1_1_9'));
    expect(MIGRATION).toMatch(/UPDATE x_task SET ws_id = 'ws-2' WHERE ws_id = NONE/);
    expect(mig, '补完不校验 —— 漏网的任务永远不会被执行').toMatch(/throw new Error/);
  });
});

describe('⭐ 运行态要留痕', () => {
  it('⭐⭐ 失败必须记 lastError —— 「跑了没成功」与「没跑」界面上长得一样', () => {
    expect(CODE).toMatch(/setTaskRunState\([\s\S]{0,80}'failed'[\s\S]{0,80}error:/);
  });

  it('⭐ 成功记 lastResult(上次采了多少)', () => {
    expect(CODE).toMatch(/setTaskRunState\([\s\S]{0,80}'idle'[\s\S]{0,200}result:/);
  });

  it('⭐⭐ 启动时复位卡住的任务(执行不跨进程存活)', () => {
    expect(CODE).toContain('recoverStuckTasks');
  });
});

describe('⭐⭐ 迁移:params 的 key 必须与 paramsSchema 逐字对应', () => {
  /**
   * ⚠️ 拼错一个 key **不会报错**,只会让那个参数静默失效
   * (如 keywords 丢了就搜空串)。所以三处必须对齐:
   *   ① migration 1.1.8 装配的 key
   *   ② keywordStrategy.paramsSchema 声明的 key
   *   ③ 调度器 taskToRecipe 读的 key
   */
  const KEYS = ['keywords', 'fromAccounts', 'helpSignals', 'lang', 'minLikes', 'minRetweets', 'sinceHours', 'resultType'];

  it('⭐⭐ migration 装配的 key 都在 paramsSchema 里声明过', () => {
    const mig = MIGRATION.slice(MIGRATION.indexOf('x_migration_1_1_8'));
    for (const k of KEYS) {
      if (!mig.includes(`params.${k}`)) continue;   // 该 key 没迁就跳过
      expect(KEYWORD, `migration 装了 params.${k},但 keywordStrategy 没声明这个 key`)
        .toMatch(new RegExp(`key:\\s*'${k}'`));
    }
  });

  it('⭐⭐ 调度器读的 key 也都在 paramsSchema 里', () => {
    const fn = CODE.slice(CODE.indexOf('function taskToRecipe'), CODE.indexOf('async function runEnabledTasks'));
    expect(fn.length, '找不到 taskToRecipe').toBeGreaterThan(0);
    for (const k of KEYS) {
      if (!fn.includes(`p.${k}`)) continue;
      expect(KEYWORD, `taskToRecipe 读 p.${k},但 keywordStrategy 没声明`)
        .toMatch(new RegExp(`key:\\s*'${k}'`));
    }
  });

  it('⭐ task_id 沿用 recipe_id(11850 行历史外键靠它)', () => {
    const mig = MIGRATION.slice(MIGRATION.indexOf('x_migration_1_1_8'));
    expect(mig, 'task_id 不是从 recipe_id 来的 —— 历史数据认不回来')
      .toMatch(/recipe_id/);
    expect(mig).toMatch(/task_id = \$id/);
  });

  it('⭐⭐ params 必须是 object FLEXIBLE(少了 FLEXIBLE 子字段静默丢弃)', () => {
    expect(MIGRATION).toMatch(/params\s+ON x_task TYPE object FLEXIBLE/);
  });
});
