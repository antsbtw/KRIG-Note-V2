/**
 * `web.dom` 的 Electron 接线 —— 唯一执行 `executeJavaScript` 的地方
 *
 * ⭐ 业务方**只给脚本 id + 参数**,拿不到也传不进脚本字符串。
 * 真正的 `executeJavaScript` 调用收口在这一个文件里,
 * 于是「注入了什么」这件事**有且只有一个地方**可查、可守。
 *
 * ⚠️ 解析/执行失败**不静默丢**:一律回三态的 `Failed`,并记 degradation。
 * 那次转义事故之所以烧了一整天,一半原因是 catch 里写着
 * 「注入失败(多半撞上导航)」—— **一句猜测被当成了结论**。
 * 所以这里的失败信息只写**事实**(哪个脚本、什么错),不写猜测。
 */

import type { PageId } from '../page/types';
import type { ScriptId, ScriptParams } from '../dom/types';
import type { ScriptRegistry } from '../dom/script-registry';
import type { TraceRecorder } from '../trace';
import { type Result, failed, ok } from '../result';

/** 能跑脚本的宿主(真实实现是 WebContents;测试可给假的)*/
export interface ScriptHost {
  executeJavaScript(code: string): Promise<unknown>;
}

export class ElectronDomRunner {
  constructor(
    private readonly registry: ScriptRegistry,
    private readonly recorder?: TraceRecorder,
  ) {}

  /**
   * 跑一个预注册脚本。
   *
   * @param host 由接线层给出的宿主(`web.dom` 本身不认识 WebContents)
   */
  async run(
    host: ScriptHost,
    pageId: PageId,
    scriptId: ScriptId,
    params: ScriptParams = {},
  ): Promise<Result<unknown>> {
    const built = this.registry.build(scriptId, params);
    if (built.status === 'failed') {
      // 构建期失败(未注册 / 缺参数)——**不静默**,留痕后如实上报
      this.recorder?.degradation({
        layer: 'web.dom',
        operation: `build:${scriptId}`,
        category: 'contract-violation',
        reason: built.reason,
        inputRef: String(pageId),
      });
      return built;
    }
    if (built.status === 'degraded') {
      // 构建表当前不产 Degraded;真出现说明契约变了,**明确拒绝而不是当成功用**
      return failed(`脚本 ${scriptId} 构建结果为 Degraded,缺: ${built.missing.join(', ')}`, false);
    }

    try {
      const value = await host.executeJavaScript(built.value);
      return ok(value);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // ⚠️ 只记事实,不写「多半是…」这类猜测(那次事故的日志就是这么误导人的)。
      // 脚本求值层面的错会被 dom-script-eval 守卫在 CI 拦住;
      // 能走到这里的多是运行期错误(页面状态 / 权限 / 导航),但**具体是哪种不猜**。
      this.recorder?.degradation({
        layer: 'web.dom',
        operation: `run:${scriptId}`,
        category: 'resource-failure',
        reason: `executeJavaScript 抛错: ${message}`,
        inputRef: String(pageId),
      });
      return failed(`脚本 ${scriptId} 执行失败: ${message}`, true);
    }
  }
}
