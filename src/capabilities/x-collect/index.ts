/**
 * ⭐⭐ X 采集策略能力(`agent/Module5-02-x-pipeline.md` §1.3 / §1.4)
 *
 * Module5 五步里的**第 1 步**(制定搜索策略)的地基。
 *
 * ── 加一种新策略要做什么 ──
 *
 * ```
 * ① 新建 strategies/<名字>.ts,实现 CollectStrategy(填三个答案)
 * ② 在下面 INITIAL_STRATEGIES 里加一行
 *
 * 改动现有文件数 = 0(除了这张清单本身)
 * 改动 UI       = 0(表单由 paramsSchema 自动生成)
 * ```
 *
 * ⭐ **UI 零改动是最关键的一条** —— 界面不认识任何具体策略,
 * 它只读 `paramsSchema` 渲染表单。这是用户那句
 * 「每一个 button 都是黑盒子,不可配置不可编排业务」的正面解答。
 */

import { CollectStrategyRegistry, collectStrategies } from './registry';
import { keywordStrategy } from './strategies/keyword';
import { authorWatchStrategy } from './strategies/author-watch';

export { CollectStrategyRegistry, collectStrategies } from './registry';
export { keywordStrategy } from './strategies/keyword';
export { authorWatchStrategy } from './strategies/author-watch';

export type {
  CollectStrategy,
  CollectParams,
  CollectTarget,
  CollectArrival,
  CollectStop,
  ParamSpec,
  ParamKind,
  ParamValidation,
} from '@shared/types/x-collect-strategy';

/**
 * 注册表的初始成员(§1.4)。
 *
 * ⚠️ `keyword` 打头是因为它是唯一在定时跑的;
 * ⭐ `author-watch` 是**第二个**,它的存在本身就是「可插拔」的证明 ——
 *    §8:「只有第二个接进来时零改动,『可插拔』才算被证明。」
 *
 * ⏳ 还没进来的两种(`browse` / `tweet-watch`)底座都在,
 *    等接线时按同样方式加 —— 不改本文件以外的任何东西。
 */
export const INITIAL_STRATEGIES = [
  keywordStrategy,
  authorWatchStrategy,
] as const;

/**
 * 把初始成员装进某个注册表。
 *
 * ⚠️ 幂等**不是**它的语义 —— 重复调会撞 `register()` 的 id 重复检查并抛。
 * 那是有意的:重复初始化通常意味着有人建了两套注册表,
 * 而「A 注册的策略 B 找不到」正是单例要防的病。
 */
export function registerInitialStrategies(
  registry: CollectStrategyRegistry = collectStrategies,
): void {
  for (const s of INITIAL_STRATEGIES) registry.register(s);
}
