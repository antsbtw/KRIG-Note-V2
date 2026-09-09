/**
 * 预注册脚本表 —— ⭐ `web.dom` 的核心防线(`06` §3.3)
 *
 * ── 要治的病 ──
 *
 * `project-x-inject-template-escape`(2026-09-07,采集停摆一整天):
 * 模板字面量里写 `/^\/([A-Za-z0-9_]{1,15})$/`,求值时 `\/` 被吃掉,
 * 浏览器实际收到 `/^/(...)$/` —— 正则在 `/^/` 就结束,后面是语法错误,
 * **整段脚本解析失败**,`executeJavaScript` 每次都抛,采集恒 0。
 *
 * ⚠️ 这类 bug 的特征:**tsc 通过、单测通过、看源码也没问题** ——
 * 因为源码里那个正则是对的,错的是**求值之后**的样子。
 *
 * ── 两道防线 ──
 *
 * 1. **类型层面**:`run` 只收 `ScriptId`,收不了脚本字符串 → 调用方拼不出坏脚本
 * 2. **求值守卫**:注册进来的每个脚本都要过「真 eval 再 parse」
 *    (`07` §2.3 #1 要求覆盖**全部**脚本,不是只覆盖出过事的那一处)
 *
 * ⚠️ 参数一律 `JSON.stringify` 后作为**绑定值**,绝不拼进脚本文本。
 * 实测现有 `inject-scripts/` 三个带参脚本本来就是这么写的,
 * 本层把这个**靠自觉的约定变成可强制的契约**。
 */

import type { RegisteredScript, ScriptId, ScriptParams } from './types';
import { type Result, failed, ok } from '../result';

export class ScriptRegistry {
  private readonly scripts = new Map<string, RegisteredScript>();

  /**
   * 注册一个脚本。
   *
   * ⚠️ 重复 id 直接抛 —— 静默覆盖会让「我注册的脚本怎么变了」无从排查。
   */
  register(script: RegisteredScript): void {
    if (this.scripts.has(script.id)) {
      throw new Error(`[web.dom] 脚本 id 重复注册: ${script.id}`);
    }
    if (!script.purpose.trim()) {
      throw new Error(`[web.dom] 脚本 ${script.id} 必须写明用途(purpose)`);
    }
    this.scripts.set(script.id, script);
  }

  has(id: ScriptId): boolean {
    return this.scripts.has(id);
  }

  /** 全部已注册脚本 —— ⭐ 求值守卫靠它做到「覆盖全部」而不是「覆盖记得的那几个」 */
  list(): RegisteredScript[] {
    return Array.from(this.scripts.values());
  }

  /**
   * 取出脚本文本。
   *
   * ⚠️ 未注册的 id 返回 `Failed`,**不返回空串** ——
   * 空串会被 `executeJavaScript` 当成合法脚本执行(返回 undefined),
   * 于是「脚本没注册」表现为「执行了但没效果」,又是一次静默失聪。
   */
  build(id: ScriptId, params: ScriptParams = {}): Result<string> {
    const script = this.scripts.get(id);
    if (!script) {
      return failed(`未注册的脚本 id: ${id}(可用: ${this.list().map((s) => s.id).join(', ')})`, false);
    }
    try {
      const text = script.build(params);
      if (!text.trim()) {
        return failed(`脚本 ${id} 构建出空文本`, false);
      }
      return ok(text);
    } catch (err) {
      // 构建期抛错也要如实说,不静默吞
      return failed(`脚本 ${id} 构建失败: ${err instanceof Error ? err.message : String(err)}`, false);
    }
  }
}
