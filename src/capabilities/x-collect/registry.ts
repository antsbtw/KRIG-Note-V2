/**
 * ⭐⭐ 采集策略注册表(`agent/Module5-02-x-pipeline.md` §1.3)
 *
 * 纯逻辑:零 Electron、零 fs、零 DB —— 可完全单测。
 *
 * ⭐ **注册表不认识任何具体策略**。它只知道「有一批实现了 `CollectStrategy` 的东西」,
 * 于是加一种策略 = 新建文件 + 一行 `register()`,**本文件一个字都不用改**。
 *
 * ⚠️ 全仓禁止 `switch (strategy.id)` 这类分支 —— 那等于把注册制退回枚举。
 * 有守卫扫死(`tests/x/collect-strategy-registry.test.ts`)。
 */

import type {
  CollectParams,
  CollectStrategy,
  ParamSpec,
  ParamValidation,
} from '@shared/types/x-collect-strategy';

export class CollectStrategyRegistry {
  private readonly strategies = new Map<string, CollectStrategy>();

  /**
   * 注册一种策略。
   *
   * ⚠️ **id 重复直接抛**,不覆盖也不忽略:
   *  - 覆盖 → 后注册的悄悄顶掉先注册的,而两者行为可能完全不同
   *  - 忽略 → 你以为注册上了,实际用的是别人那份
   * 两种都是「看着成功实际没做」,本仓最常踩的形态。
   */
  register(strategy: CollectStrategy): void {
    if (!strategy.id.trim()) {
      throw new Error('[x-collect] 策略 id 不能为空');
    }
    const existing = this.strategies.get(strategy.id);
    if (existing) {
      throw new Error(
        `[x-collect] 策略 id 重复: "${strategy.id}"` +
          `(已注册: ${existing.name},又要注册: ${strategy.name})—— ` +
          '绝不覆盖:顶掉的那份行为可能完全不同,而现场看不出来。',
      );
    }
    this.strategies.set(strategy.id, strategy);
  }

  /**
   * 取一种策略。
   *
   * ⚠️ 取不到 **throw**,不返回 null/undefined ——
   * 返回空值会让「策略名打错」表现为「采集什么也没干」,
   * 而那和「采到了但都是旧的」在日志上长得一模一样。
   */
  get(id: string): CollectStrategy {
    const s = this.strategies.get(id);
    if (!s) {
      const known = [...this.strategies.keys()].join(', ') || '(空)';
      throw new Error(`[x-collect] 没有注册过策略 "${id}";已注册的有: ${known}`);
    }
    return s;
  }

  has(id: string): boolean {
    return this.strategies.has(id);
  }

  /**
   * 列出全部策略 —— UI 的下拉菜单与配置表单都由它驱动。
   *
   * ⚠️ **按注册顺序返回,不排序、不择优** ——
   * 与 `web.page` 的 `find` 同源:底座不替调用方挑。
   */
  list(): readonly CollectStrategy[] {
    return [...this.strategies.values()];
  }

  /**
   * ⭐ 按 `paramsSchema` 校验参数,并补上默认值。
   *
   * ⚠️ **必填缺失 → 明确失败**,绝不静默套默认值继续:
   * 那会让「配置填了一半」表现为「跑了但结果不对」,
   * 而这类错最难查 —— 它不报任何异常。
   *
   * ⚠️ 本方法**不认识任何具体策略**,只认 schema。
   */
  validate(id: string, raw: CollectParams): ParamValidation {
    const spec = this.get(id).paramsSchema;
    const problems: string[] = [];
    const out: Record<string, unknown> = {};

    for (const p of spec) {
      const given = raw[p.key];
      const missing = given === undefined || given === null || given === '';

      if (missing) {
        if (p.required) {
          problems.push(`缺必填参数 "${p.key}"(${p.label})`);
          continue;
        }
        if (p.defaultValue !== undefined) out[p.key] = p.defaultValue;
        continue;
      }

      const bad = checkKind(p, given);
      if (bad) problems.push(bad);
      else out[p.key] = given;
    }

    // ⚠️ 多余的 key 只警告不拒绝:配方改版时旧参数还留在库里是常态,
    //    为此整批拒绝会让历史配方全部跑不动。但**不静默带过** —— 记进 problems 太重,
    //    故这里的选择是:**丢弃并不报错**,由调用方从 `params` 的差集看出来。
    //    (真要严格,是另一个裁定,别在这里偷偷加。)

    if (problems.length > 0) return { ok: false, problems };
    return { ok: true, params: out };
  }
}

/** 逐类型校验。返回 null 表示通过,否则返回人能读懂的原因 */
function checkKind(p: ParamSpec, v: unknown): string | null {
  switch (p.kind) {
    case 'string':
      return typeof v === 'string' ? null : `参数 "${p.key}" 应为文本,实得 ${typeof v}`;
    case 'number': {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return `参数 "${p.key}" 应为数字,实得 ${typeof v}`;
      }
      if (p.min !== undefined && v < p.min) return `参数 "${p.key}" 不得小于 ${p.min},实得 ${v}`;
      if (p.max !== undefined && v > p.max) return `参数 "${p.key}" 不得大于 ${p.max},实得 ${v}`;
      return null;
    }
    case 'boolean':
      return typeof v === 'boolean' ? null : `参数 "${p.key}" 应为真/假,实得 ${typeof v}`;
    case 'stringList':
      return Array.isArray(v) && v.every((x) => typeof x === 'string')
        ? null
        : `参数 "${p.key}" 应为文本数组`;
    case 'enum': {
      const allowed = (p.options ?? []).map((o) => o.value);
      return allowed.includes(v as string)
        ? null
        : `参数 "${p.key}" 只能是 ${allowed.join(' / ')},实得 ${String(v)}`;
    }
  }
}

/**
 * 全局注册表单例 —— 生产运行时只要一套
 * (同 `web-capability/wiring/runtime.ts` 的理由:各处各建一份会导致
 *  「A 注册的策略 B 找不到」)。
 *
 * ⚠️ 测试里请 `new CollectStrategyRegistry()` 自己建,别用这个单例 ——
 * 跨用例共享状态会让「注册重复」这类断言互相干扰。
 */
export const collectStrategies = new CollectStrategyRegistry();
