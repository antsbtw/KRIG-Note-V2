/**
 * ELK 全局单例(lazy init)
 *
 * elkjs 构造一个 ELK 实例会启动 worker / 加载 layout 算法表,代价不低 —
 * 同进程内复用一个单例即可。computeLayout / getElkInstance 都走它。
 *
 * Phase 1B 不主动 init(等首次 computeLayout 调用触发),保证零启动成本。
 */

import ELK from 'elkjs';
import type { ELK as ElkType } from 'elkjs';

let _instance: ElkType | null = null;

export function getElk(): ElkType {
  if (!_instance) {
    _instance = new ELK();
  }
  return _instance;
}
