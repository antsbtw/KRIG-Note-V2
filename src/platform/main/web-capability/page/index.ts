/**
 * `web.page` —— Web 能力层的「控制」能力(页面对象化 + 身份 + 查找 + 状态)。
 *
 * 步 1 交付:纯逻辑核心,零 Electron 依赖,可完全单测。
 * **本步不接任何消费者** —— 没人调用它,所以 app 行为与开工前完全一致。
 */
export * from './types';
export * from './web-page';
export { PageRegistry } from './page-registry';
