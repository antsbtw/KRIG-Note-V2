/**
 * ⭐⭐⭐ **编排执行器** —— 按编排档把已有能力串起来跑,每步落一条执行记录。
 *
 * ── 用户 2026-09-23 拍板 ──
 * > 「下一步做一个任务编排试试,这样逐步的拆解抽象。
 * >   否则还是找不到该抽象到哪个颗粒度比较好。」
 *
 * ── 这个文件**不做**什么(很重要) ──
 *
 * ⚠️ **不重新实现任何能力**。四步全是现成函数:
 *   goto → XPageResolver + goToUrl / collect → autoCollect
 *   judge → runJudgeBatch    / planReply → planReplies
 * 编排层只负责「按顺序调、把结果记下来」。
 * ⭐ 一旦编排层自己解释起参数或重写逻辑,就成了第二份实现 —— 两份必漂。
 *
 * ⚠️ **不做分支/循环/条件跳转**(Module5 设计 2026-04 就定过)。
 * 编排档是「可重组的步骤序列」,不是一门小语言:
 * 有了分支,「这次为什么走了那条路」又变成要人去猜的事。
 *
 * ── 失败语义 ──
 * ⭐ **一步失败就停,后面的标 skipped**(不是继续往下跑)。
 * 理由:四步是**有依赖**的 —— 没采到数据,判断就没有输入;
 * 硬往下跑会得到一串「成功但产出 0」,而真因埋在第一步。
 * ⚠️ 但**已经跑完的步骤不回滚**:采到的数据是增量的,回滚反而丢数据。
 */

import { newRunId, deriveStep, type ExecContext } from './exec-context';
import { startRun, recordStep, endRun } from './flow-run-repo';
import type {
  FlowRecipe, FlowStep, FlowStepOutcome, FlowStepKind,
} from '@shared/types/flow-recipe-types';
import type { StepType } from './exec-context';

/**
 * 能力适配器 —— 由调用方注入。
 *
 * ⚠️ **不在这里直接 import 那四个能力**:
 * flow 是通用层,直接依赖 X 的模块会让它变成「X 专用编排器」,
 * 而下一个业务(邮件?)就得再抄一份。
 * ⭐ 注入进来,编排层只认这四个签名。
 */
export interface FlowCapabilities {
  goto(params: Record<string, unknown>, wsId?: string): Promise<FlowStepOutcome>;
  collect(params: Record<string, unknown>, wsId?: string): Promise<FlowStepOutcome>;
  judge(params: Record<string, unknown>, wsId?: string): Promise<FlowStepOutcome>;
  /** ⭐ 备料:bio + 上文(先查库,缺了才去 X 取) */
  prefetch(params: Record<string, unknown>, wsId?: string): Promise<FlowStepOutcome>;
  /** ⭐ 送 Claude 取回复建议 —— ⚠️ 只取建议,不发 */
  askAdvice(params: Record<string, unknown>, wsId?: string): Promise<FlowStepOutcome>;
  planReply(params: Record<string, unknown>, wsId?: string): Promise<FlowStepOutcome>;
}

export interface FlowRunResult {
  runId: string;
  flowName: string;
  /** 每一步的结果 —— ⚠️ 跳过的也在里面,否则「没跑」与「没这一步」分不开 */
  steps: Array<{
    id: string; kind: string; label: string;
    status: 'ok' | 'failed' | 'skipped';
    produced: number; error?: string; note?: string; elapsedMs: number;
  }>;
  ok: boolean;
  /** 哪一步断的 —— 空 = 全跑完了 */
  failedAt?: string;
  elapsedMs: number;
}

/** ⭐ 停止标志由调用方给 —— 与采集的暂停键同一套语义(协作式,到检查点才停) */
export type AbortCheck = () => boolean;

/**
 * ⭐⭐ **每一步的实时状态** —— 用户 2026-09-24 那句「没有任何反应」的解药。
 *
 * ── 为什么非有不可(实测数据)──
 * 四步耗时 **0.1s / 30.8s / 330.8s / 0.5s** —— 差 3000 倍。
 * 而 `runFlow` 是**一个 invoke 等到底**:判断那步 5.5 分钟里
 * renderer **什么都收不到**,人只能看着它转,以为死了。
 *
 * ⚠️ 光加 UI 解决不了 —— 数据根本没送出去。
 */
export interface FlowProgress {
  runId: string;
  /** ⚠️⚠️ **必须带 wsId,接收方必须核对** —— 广播是发给所有 renderer 的,
   *  不核对就会「A 窗口的进度显示在 B 窗口」(记忆:宿主广播×多ws扇出) */
  wsId?: string;
  flowName: string;
  seq: number;
  stepId: string;
  label: string;
  /** running = 刚开始这一步(此时还没有结果) */
  status: 'running' | 'ok' | 'failed' | 'skipped';
  /** 总共几步 —— 面板要显示「3/4」 */
  total: number;
  produced?: number;
  note?: string;
  error?: string;
  elapsedMs?: number;
}

export type ProgressSink = (p: FlowProgress) => void;

/**
 * 跑一份编排档。
 *
 * @param recipe 编排档(步骤序列)
 * @param caps   能力适配器
 * @param opts.isAborted 人按了停就在下一步之前退出
 */
export async function runFlow(
  recipe: FlowRecipe,
  caps: FlowCapabilities,
  opts: {
    wsId?: string; trigger?: 'manual' | 'schedule'; isAborted?: AbortCheck;
    /** ⭐ 每步开始/结束各回调一次 —— ⚠️ 回调抛错**不许拦执行**(降级要局部) */
    onProgress?: ProgressSink;
  } = {},
): Promise<FlowRunResult> {
  const t0 = Date.now();
  const runId = newRunId();
  const wsId = opts.wsId ?? recipe.wsId;

  const ctx: ExecContext = {
    runId,
    flowName: recipe.name,
    /** ⚠️ TriggerKind 是 human|schedule|chain —— 没有 'manual' 这个值 */
    trigger: opts.trigger === 'schedule' ? 'schedule' : 'human',
    triggerRef: recipe.recipeId,
    wsId,
  };

  /**
   * ⚠️ 起头就写 `flow_run` —— 不能等跑完再写:
   * 跑到一半 app 崩了的话,那次运行就**完全没有痕迹**,
   * 而「崩了」与「没跑过」在记录里长得一样。
   */
  await startRun(ctx).catch((e) => {
    console.warn('[flow-runner] startRun 失败(不拦执行):', e);
  });

  const steps: FlowRunResult['steps'] = [];
  let failedAt: string | undefined;
  /**
   * ⭐ 哪一步说了「没有候选」—— 后续步骤据此跳过。
   * ⚠️ 记的是**步骤 id 不是布尔值**:跳过的理由里要说清楚是**谁**没产出,
   * 否则面板上只会写「没有候选」,而人要的是「哪一步没产出」。
   */
  let noCandidatesFrom: string | undefined;
  let seq = 0;
  const total = recipe.steps.length;
  /**
   * ⚠️ 进度**发不出去不能拦执行** —— 与留痕同一纪律:降级要局部。
   * 采集跑成了就是跑成了,不能因为面板没收到而翻案。
   */
  const emit = (p: Omit<FlowProgress, 'runId' | 'wsId' | 'flowName' | 'total'>): void => {
    try {
      opts.onProgress?.({ runId, wsId, flowName: recipe.name, total, ...p });
    } catch (e) {
      console.warn('[flow-runner] 进度广播失败(不拦执行):', e);
    }
  };

  for (const step of recipe.steps) {
    seq += 1;
    const label = step.label || step.kind;
    /** ⚠️ deriveStep 收的是一个对象,不是位置参数 */
    const stepCtx = deriveStep(ctx, {
      seq, stepId: step.id, stepType: kindToStepType(step.kind), capability: step.kind,
    });

    /**
     * ⭐ 三种「不跑」的理由要**分开记**,不能都叫 skipped 了事:
     *  · 前面断了      → 后续步骤没有输入,跑了也没意义
     *  · 人按了停      → 与「失败」完全不同
     *  · 档里关掉了    → 是配置,不是故障
     * ⚠️ 合成一种的话,回看时「这一步为什么没跑」又要靠猜。
     */
    const skipReason = failedAt
      ? `前一步「${failedAt}」失败,本步没有输入`
      : opts.isAborted?.()
        ? '人工停止'
        : step.enabled === false
          ? '编排档里关掉了这一步'
          /**
           * ⭐⭐ **上一步没产出候选** —— 用户 2026-09-26:
           * 「既然值得回复是零条,为什么第四步还需要跑呢?」
           *
           * ⚠️ 措辞必须与上面三种**分得开**:这**不是故障、不是人停、不是配置**,
           * 是「没东西可做」。四种合成一个 skipped 的话,
           * 回看时「这一步为什么没跑」又要靠猜。
           */
          /**
           * ⚠️⚠️ **自己去库里取输入的步骤不受这条闸门约束**(2026-09-26 真机修)。
           *
           * 实跑撞到:判断判了 10 条、0 条值得回 → 备料整步被跳过,
           * 而备料 `queryInbox` 自己去库里取,当时库里有 **1075 条**
           * worth 候选等着补 bio/上文,被一起放弃了。
           * ⭐ 「没有新候选」该挡的是**拟回复**,不该挡**备料**。
           */
          : (noCandidatesFrom && !step.readsFromStore)
            ? `上一步「${noCandidatesFrom}」没有产出候选,本步无事可做`
            : undefined;

    if (skipReason) {
      emit({ seq, stepId: step.id, label, status: 'skipped', note: skipReason, elapsedMs: 0 });
      steps.push({ id: step.id, kind: step.kind, label, status: 'skipped', produced: 0, note: skipReason, elapsedMs: 0 });
      await recordStep(stepCtx, {
        status: 'skipped', input: step.params, reasoning: skipReason, durationMs: 0,
      }).catch(() => { /* 留痕失败不拦执行 */ });
      continue;
    }

    const fn = caps[step.kind as keyof FlowCapabilities];
    if (typeof fn !== 'function') {
      /** ⚠️ fail loud:编排档写了一个不存在的 kind,必须当场说清楚 */
      const err = `编排档里的步骤类型「${step.kind}」没有对应能力`;
      failedAt = step.id;
      steps.push({ id: step.id, kind: step.kind, label, status: 'failed', produced: 0, error: err, elapsedMs: 0 });
      await recordStep(stepCtx, { status: 'failed', input: step.params, reasoning: err, durationMs: 0 }).catch(() => {});
      continue;
    }

    /** ⭐ 开始就发一次 —— 这是「判断那步跑 5 分钟」时唯一的反馈 */
    emit({ seq, stepId: step.id, label, status: 'running' });
    const s0 = Date.now();
    let out: FlowStepOutcome;
    try {
      /**
       * ⭐ 档级共享参数 + 步骤参数 —— **步骤自己写的优先**。
       * ⚠️ 2026-09-24 实测:搜索词原来在档里写两遍,改一个忘另一个
       * 就会「导航到 A 页、采集却采 B 页」,而且不报错。
       */
      /**
       * ⭐⭐ **runId 注入每步参数** —— 2026-09-24 实测:草稿落库了但 `run_id` 是 None。
       *
       * ⚠️ 真因:`planReplyBatch` 能收 runId,而**适配器拿不到**(签名里没有)——
       * 典型的「类型有、字段有、消费端零传递」死字段。
       * 后果:库里的草稿说不清「这批是哪一跑的产物」,
       * 而那正是回头对账「哪次编排产出质量好」的唯一线索。
       *
       * ⭐ 在这里注入而不改签名:与 handler 注入 wcId 同一套做法 ——
       * 运行时的东西由执行层给,能力层只管用。
       * ⚠️ 顺序 `{ runId, ...params }`:编排档里显式写了的优先(与 wcId 一致)。
       */
      out = await fn(
        { __runId: runId, ...(recipe.shared ?? {}), ...(step.params ?? {}) },
        wsId,
      );
    } catch (e) {
      /** ⚠️ 能力抛异常也要落记录 —— 否则这一步在 flow_step_run 里根本不存在 */
      out = { ok: false, produced: 0, error: String(e).slice(0, 300), elapsedMs: Date.now() - s0 };
    }

    if (!out.ok) failedAt = step.id;
    /**
     * ⭐⭐ **没产出候选就让后面停** —— 刹车与油门要接线(本仓已有同族教训:
     * drain 连失败就停而 timer 无条件重启,两边互不知道 → 永远空转)。
     *
     * ⚠️ 判据是 `=== false` **不是 falsy**:`undefined` 表示
     * 「这个能力没表态」,老能力不写它就维持原状照跑,
     * 不能因为加了字段而被误刹。
     */
    if (out.ok && out.hasCandidates === false && !noCandidatesFrom) {
      noCandidatesFrom = step.id;
    }
    emit({
      seq, stepId: step.id, label,
      status: out.ok ? 'ok' : 'failed',
      produced: out.produced, note: out.note, error: out.error, elapsedMs: out.elapsedMs,
    });
    steps.push({
      id: step.id, kind: step.kind, label,
      status: out.ok ? 'ok' : 'failed',
      produced: out.produced, error: out.error, note: out.note, elapsedMs: out.elapsedMs,
    });
    await recordStep(stepCtx, {
      status: out.ok ? 'ok' : 'failed',
      input: step.params,
      /**
       * ⭐ 产出数进 output —— 「跑了但产出 0」日后回看要查得到。
       *
       * ⭐⭐ **观察点由 runner 统一落库**(用户 2026-09-26 定的
       * 「每一个环节都应该有观察点」)——
       * ⚠️ **不靠各步自觉写**:靠自觉的话新加的步骤天然在视野外
       * (同 feedback-guard-hardcoded-list-never-grows 的形态)。
       * ⚠️ **成功路径也要记**:判断对了也要知道凭什么对,否则没法回归分析。
       */
      output: {
        produced: out.produced,
        note: out.note,
        hasCandidates: out.hasCandidates,
        evidence: out.evidence,
      },
      reasoning: out.error,
      durationMs: out.elapsedMs,
    }).catch(() => {});
  }

  const elapsedMs = Date.now() - t0;
  const ok = !failedAt;
  /** ⚠️ endRun 收的是 runId 不是 ctx */
  await endRun(runId, ok ? 'ok' : 'failed', failedAt ? `断在步骤「${failedAt}」` : undefined)
    .catch(() => {});

  return { runId, flowName: recipe.name, steps, ok, failedAt, elapsedMs };
}

/**
 * 步骤类型 → `flow_step_run.step_type`。
 *
 * ⚠️ 与能力层的 `STEP_TYPE_OF` **同一套词**(act/fetch/judge)——
 * 另起一套会让两边的审计数据对不上,而那种错在数据里看不出来。
 */
const STEP_TYPE_BY_KIND: Readonly<Record<FlowStepKind, StepType>> = {
  goto: 'act',
  collect: 'fetch',
  prefetch: 'fetch',
  /** ⚠️ 问模型要结论 —— 与 judge 同类(不是 fetch:它产出的是判断不是事实) */
  askAdvice: 'judge',
  judge: 'judge',
  planReply: 'judge',
};

function kindToStepType(kind: string): StepType {
  /**
   * ⚠️⚠️ **不许兜底** —— 2026-09-26 改。
   *
   * 原来末尾是 `return 'fetch'`,于是**新增的步骤会默认变成 fetch**,
   * 混进取数那一类里,按 step_type 统计时看不出来。
   * ⭐ 同一个毛病现在就有一例:`planReply` 的 step_type 是 `judge`,
   * 与真正的判断步归成一类(16+2=18 ＝ 9 judge + 9 planReply)——
   * 我据此误判过「planReply 一条记录都没有」。
   *
   * ⚠️ 这与 feedback-guard-hardcoded-list-never-grows 同形:
   * **兜底 = 新增项天然在视野外**。改成登记表 + fail loud:
   * 加了 kind 却忘了登记,**当场就知道**,不会静默归错类。
   *
   * ⚠️ 但这里**不抛异常**:本函数在 try 之外被调用(派生 stepCtx 时),
   * 抛出会让**整条 run 崩掉且不留任何记录**。
   * 而「kind 不认识」下面那道闸(`没有对应能力`)已经会 fail loud 并落库 ——
   * 这里只要**别静默归错类**就够了,用 'unknown' 让它在统计里显形。
   */
  const t = STEP_TYPE_BY_KIND[kind as FlowStepKind];
  if (!t) {
    console.error(
      `[flow-runner] 步骤类型「${kind}」没在 STEP_TYPE_BY_KIND 登记 ——`
      + ' 新增能力要同时登记它的 StepType(别让它静默变成 fetch)',
    );
    return 'unknown';
  }
  return t;
}
