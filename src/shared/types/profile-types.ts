/**
 * Window Profile 类型定义
 *
 * Profile = 持久化的工作环境快照（网络身份 + 浏览器身份）。
 * 用户通过 "New Window with Profile" 一键恢复某个配置好的工作环境。
 *
 * 核心设计：
 * - 每个 Profile 拥有独立 Electron session partition（persist:profile-${id}）
 * - cookie / localStorage / cache / 登录态 全部隔离
 * - 可绑定代理节点（复用现有 ProxyNode 体系）
 * - 可指定 User-Agent（web 指纹隔离）
 */

/** Profile 颜色标识（UI 区分色） */
export type ProfileColor =
  | 'green'
  | 'blue'
  | 'purple'
  | 'red'
  | 'orange'
  | 'gray';

/** Window Profile（持久化工作环境） */
export interface Profile {
  /** 唯一标识（ULID） */
  id: string;
  /** 用户命名，如 "公司研究"、"个人 X"、"项目 A" */
  name: string;
  /** UI 区分色 */
  color: ProfileColor;
  /**
   * 绑定的代理节点 id（复用 ProxyNode 体系）。
   * undefined = 直连（不走代理）。
   */
  proxyId?: string;
  /**
   * 自定义 User-Agent。
   * undefined = Electron 默认 UA。
   */
  userAgent?: string;
  /** 创建时间戳（ms） */
  createdAt: number;
}

/**
 * Profile session partition key 派生规则（纯函数，主/renderer 进程共用）。
 *
 * 注意：Electron session partition 以 "persist:" 前缀区分持久化 vs 内存。
 * Profile 始终持久化（Profile 的设计目标就是持久化工作环境）。
 */
export function profilePartitionKey(profileId: string): string {
  return `persist:profile-${profileId}`;
}
