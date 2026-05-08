/**
 * 已知 driver id 白名单(Wave 1)
 *
 * V2 当前把 driver(text-editing-driver / graph-editing-driver / ...)单独拎出
 * charter § 1.3 的能力归属,view 在 install 列表里直接声明 driver id。
 *
 * 这与 charter v0.4 § 1.2 "install 项必须是 capability id" 严格不一致,
 * 但属于全局架构债,留待 Wave 2+ 处理(driver → capability 归属重整理)。
 *
 * 短期内此白名单让 install 校验对 driver id 静默通过,避免每次启动 warn 噪音。
 */

export const KNOWN_DRIVER_IDS: ReadonlySet<string> = new Set<string>([
  'text-editing-driver',
  // 后续 driver 按需补:graph-editing-driver / ebook-rendering-driver / web-rendering-driver
]);
