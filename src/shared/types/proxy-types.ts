/**
 * per-ws 代理:全局代理节点类型(per-ws 代理工程 · 阶段2)
 *
 * 跨层共享类型(纯类型,0 业务依赖):
 * - main 进程节点表 store(proxy-node-store.ts)定义/持久化 ProxyNode
 * - renderer 侧 d.ts(electron-api.d.ts)声明 IPC 返回类型
 *
 * 提到 shared 层避免 d.ts import main 代码(跨层依赖)。
 */

/** 代理节点类型(无认证):socks5 / http / 直连 */
export type ProxyNodeType = 'socks5' | 'http' | 'direct';

/** 全局代理节点(跨所有 ws 共用;每 ws 选一个 proxyId)*/
export interface ProxyNode {
  id: string;
  /** 用户可见名(阶段3 UI 用;阶段2 可不展示)*/
  name: string;
  /** 'socks5' | 'http' | 'direct' */
  type: ProxyNodeType;
  /** host:port(无认证);形如 '192.168.1.162:1080';direct 类型此字段为 '' */
  host: string;
  createdAt: number;
}
