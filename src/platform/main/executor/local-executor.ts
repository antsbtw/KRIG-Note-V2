/**
 * ⭐ 本地模型执行者 —— 对象是文本,靠 Ollama(Gemma)
 *
 * ── 它**包**现成的 `callOllama`,不重写 ──
 *
 * `callOllama` 已经把 HTTP / 超时 / abort 收口了,全仓 5 处在用。
 * 这里只做一件事:**把「抛异常」翻译成三态**,并带上留痕需要的事实
 * (谁执行的、用了哪个模型、花了多久)。
 *
 * ⚠️ 本文件**不碰数据库、不碰页面、不认识推文**。
 * 「判什么」由 `task.instruction` 给,「拿什么判」由 `material` 给 ——
 * 于是「VPN 求助该不该回」与「蓝V该不该点赞」走的是同一个执行者。
 *
 * ── `retryable` 怎么定(直接影响编排会不会空转)──
 *
 * 可重试:超时 / 连不上 —— Ollama 可能正在启动或正忙,过会儿就好。
 * 不可重试:HTTP 4xx(模型名写错、请求不合法)、返回里没有 content
 *           —— 重试一百次还是一样,只会让编排层空转。
 */

import { callOllama, type OllamaMessage } from '../local-llm/ollama-client';
import { ok, failed, degraded, type Result } from '../web-capability/result';
import {
  executorName,
  type ExecuteMaterial,
  type ExecuteOutcome,
  type ExecuteTask,
  type Executor,
  type ExecutorName,
} from './executor-types';

export interface LocalExecutorOptions {
  /** 模型标识,如 `gemma3:27b`。**必填** —— 默认值会让「跑的是哪个模型」说不清 */
  readonly model: string;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly temperature?: number;
  /** 执行者名字;不给就用 `local:<model>` */
  readonly name?: string;
}

/**
 * 把 `callOllama` 抛出的异常判成「值不值得重试」。
 *
 * ⚠️ 按**消息文本**分类而不是错误类型 —— `callOllama` 抛的都是裸 `Error`。
 * 这不优雅,但比新造一套错误类型再去改 5 个现有调用点**风险小得多**;
 * 真要收口,应当是 `callOllama` 自己带上错误种类,那是另一件事。
 */
function classify(err: unknown): { reason: string; retryable: boolean } {
  const msg = err instanceof Error ? err.message : String(err);

  // AbortController 超时 —— fetch 抛 AbortError
  if (/abort/i.test(msg)) {
    return { reason: `模型调用超时:${msg}`, retryable: true };
  }
  // 连不上(Ollama 没起 / 端口不对)
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|network/i.test(msg)) {
    return { reason: `连不上模型服务:${msg}`, retryable: true };
  }
  // HTTP 4xx —— 模型名写错、请求不合法。重试没有意义
  if (/HTTP 4\d\d/.test(msg)) {
    return { reason: `模型服务拒绝请求(重试无意义):${msg}`, retryable: false };
  }
  // HTTP 5xx —— 服务端临时故障,可以重试
  if (/HTTP 5\d\d/.test(msg)) {
    return { reason: `模型服务出错:${msg}`, retryable: true };
  }
  // 返回里没有 content —— 形状不对,重试还是一样
  if (/missing choices/i.test(msg)) {
    return { reason: `模型返回缺少正文(形状不对,重试无意义):${msg}`, retryable: false };
  }
  // 兜不住的:保守判可重试,但把原文带出去
  // ⚠️ 这里不静默归类 —— 原文必须原样出现在 reason 里,否则排查时只剩一句废话
  return { reason: `模型调用失败:${msg}`, retryable: true };
}

/**
 * 把**卷宗**拼成用户消息:主体 + 各附件分节 + 明确列出缺了什么。
 *
 * ⭐ 三件事分开写,不揉成一段:
 *  ① 主体单独起头 —— 判的就是它
 *  ② 每个附件带**名字**当小标题 —— 模型要能引用「推主概况里说……」
 *    而不是把附件内容当成主体的一部分读
 *  ③ ⭐⭐ **缺了什么要明说** —— 不说的话,模型会默认「没提到=没有」,
 *    于是「查过了,这人没被回过」与「压根没查」变成同一句话。
 *    对模型和对人一样:空值有两种成因,不区分就会得出反向结论。
 */
function buildUserContent(material: ExecuteMaterial): string {
  const parts = [material.content];

  const att = material.attachments ?? {};
  for (const [name, value] of Object.entries(att)) {
    const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    parts.push(`[${name}]\n${body}`);
  }

  const missing = material.missing ?? [];
  if (missing.length > 0) {
    parts.push(
      `[以下资料**没能取到**,判断时请把这部分当成「不知道」,不要当成「没有」]\n`
      + missing.map((m) => `- ${m}`).join('\n'),
    );
  }

  return parts.join('\n\n');
}

export class LocalExecutor implements Executor {
  readonly name: ExecutorName;

  constructor(private readonly opts: LocalExecutorOptions) {
    if (!opts.model.trim()) {
      // fail loud:没有模型名,留痕里「哪个模型判的」就永远是空
      throw new Error('[LocalExecutor] model 必填 —— 不给默认值,否则说不清跑的是哪个模型');
    }
    this.name = executorName(opts.name ?? `local:${opts.model}`);
  }

  async execute(
    task: ExecuteTask,
    material: ExecuteMaterial,
  ): Promise<Result<ExecuteOutcome>> {
    if (!task.instruction.trim()) {
      return failed('[LocalExecutor] 任务没有 instruction —— 没告诉它判什么', false);
    }
    if (!material.content.trim()) {
      return failed('[LocalExecutor] 素材为空 —— 没有东西可判', false);
    }

    const messages: OllamaMessage[] = [
      { role: 'system', content: task.instruction },
      { role: 'user', content: buildUserContent(material) },
    ];

    const t0 = Date.now();
    let content: string;
    try {
      const res = await callOllama({
        model: this.opts.model,
        messages,
        endpoint: this.opts.endpoint,
        timeoutMs: this.opts.timeoutMs,
        temperature: this.opts.temperature,
        responseFormat: task.structured ? 'json_object' : 'text',
      });
      content = res.content;
    } catch (err) {
      const { reason, retryable } = classify(err);
      return failed(reason, retryable);
    }
    const elapsedMs = Date.now() - t0;

    /**
     * ⚠️ 空串是**没执行成**,不是「结论为空」。
     * 记忆 `project-x-reply-latency` 记过:num_predict 调档会让模型直接返空串,
     * 而当时那被当成了正常返回 —— 静默坍缩的典型。
     */
    if (!content.trim()) {
      return failed(`模型返回空串(${elapsedMs}ms)—— 没执行成,不是「结论为空」`, true);
    }

    let parsed: unknown;
    if (task.structured) {
      try {
        parsed = JSON.parse(content);
      } catch {
        /**
         * ⭐ 解析不了 = 没执行成 → `Failed`,**不是** `Degraded`。
         * 要的是结构化结论却拿到一坨文本,编排层没法用;
         * 给 `Degraded` 会让调用方以为「凑合能用」。
         */
        return failed(
          `要求结构化输出,但返回不是合法 JSON(${elapsedMs}ms):${content.slice(0, 200)}`,
          true,
        );
      }
    }

    const outcome = {
      kind: 'judge' as const,
      content,
      parsed,
      by: this.name,
      elapsedMs,
      model: this.opts.model,
    };

    /**
     * ⭐⭐ 缺附件 → `Degraded`:**判了,但没看全**。
     *
     * 为什么不当 Ok:调用方会以为这是有依据的判断,而它可能只看了单条推。
     * 为什么不当 Failed:明明判出来了,丢掉它等于今天什么都判不了
     * (本仓三项附件基本都没数据)。
     * 这正是三态里 Degraded 存在的理由 —— 第四态「空值假装成功」才是要杜绝的。
     */
    const missing = material.missing ?? [];
    if (missing.length > 0) return degraded(outcome, missing);

    /**
     * ⭐⭐ 到这里一律 `Ok` —— **包括模型给出否定结论**。
     * 「模型说不该回」是执行成功;只有没执行成才是 Failed。
     */
    return ok(outcome);
  }
}
