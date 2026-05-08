/**
 * capabilityRegistry api 取值 helpers(Wave 5)
 *
 * view 通过 string id 间接拿 capability 对外 API,而不是直 import capability 模块。
 * 用法约定(硬约束 H1,详见 Wave5 设计 § 3.3 / § 0.1):
 *
 * | 路径性质 | helper | 缺失行为 |
 * |---|---|---|
 * | 业务路径(命令 / view render / 编辑器命令)| requireCapabilityApi | throw |
 * | 诊断路径(L5-alive 等)| getCapabilityApi | 返回 undefined |
 * | 跨可选 capability(未来增强)| getCapabilityApi | 软取退化 |
 *
 * code review 拒绝在业务路径用 `getCapabilityApi(...)?.foo()` 形式 —
 * `?.` short-circuit 会让漏改 method 静默 noop,极难 debug。
 */

import { capabilityRegistry } from './capability-registry';

/**
 * 软取 — capability 没注册或没设 api 时返回 undefined。
 * 仅用于诊断 / 可选场景。
 */
export function getCapabilityApi<T>(id: string): T | undefined {
  return capabilityRegistry.get(id)?.api as T | undefined;
}

/**
 * 硬取 — capability 没注册或没设 api 时立即抛错。
 * 业务路径必须用此版本(见上文用法约定)。
 *
 * 抛错原因:
 * - capability 没注册到 registry(可能模块没被 import)
 * - capability 注册时没填 api 字段(违反 Wave 5 设计 § 4)
 *
 * @throws {Error} 当 api 不存在
 */
export function requireCapabilityApi<T>(id: string): T {
  const api = capabilityRegistry.get(id)?.api as T | undefined;
  if (api === undefined) {
    throw new Error(
      `[capabilityRegistry] capability '${id}' has no api;` +
        ` view 须在 install 列表声明该 capability,且 capability 须 register({ id, api: ... })`,
    );
  }
  return api;
}
