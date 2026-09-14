/**
 * `web.input` 的 Electron 接线 —— 唯一碰 clipboard / CDP 喂文件的地方
 *
 * ⭐ 能力层(`input/`)是纯逻辑:它只知道「有个能求值脚本的宿主」,
 * 不知道 Electron 存在。真正的 `executeJavaScript` / `clipboard` / `debugger`
 * 收口在这一个文件里,于是「往页面里塞了什么」**有且只有一个地方**可查、可守。
 *
 * ⚠️ **本步不接任何消费者**(AI / X 都不接)—— 按 `09-history.md` §1.1「只加不改」。
 * 这个类建好但没人 new 它,行为与开工前完全一致。
 *
 * ── 与 `web-service-base/webview-file-input.ts` 的关系 ──
 * CDP 喂文件那套(`DOM.getDocument` → `DOM.querySelector` → `DOM.setFileInputFiles`)
 * 是**搬移**过来的,连「已被别处 attach 就复用且末尾不 detach」这条都照搬 ——
 * 那是 `project-ws-instance-isolation-invariant` 踩出来的:一个 wc 只允许一个
 * debugger client,抢别人的会掐掉 AI 的 SSE 拦截器。
 * ⚠️ 旧文件**一个字没改**,三家消费者照常跑。
 */

import { clipboard, type WebContents } from 'electron';
import type { PageId } from '../page/types';
import type { InputHost } from '../input';

const IS_MAC = process.platform === 'darwin';
const PASTE_MODIFIER: Array<'control' | 'meta'> = IS_MAC ? ['meta'] : ['control'];

/** 剪贴板还原延迟 —— 确保 OS Cmd+V 已被消费(搬自现有实现) */
const CLIPBOARD_RESTORE_MS = 500;

/** 由接线层提供:pageId → 真实 webContents。拿不到返回 null,**不抛** */
export type WebContentsLookup = (pageId: PageId) => WebContents | null;

export class ElectronInputHost implements InputHost {
  constructor(private readonly lookup: WebContentsLookup) {}

  private require(pageId: PageId): WebContents {
    const wc = this.lookup(pageId);
    if (!wc) {
      // fail loud:找不到页面就抛,让引擎翻成 Failed。
      // 返回一个假对象会让「页面早关了」表现为「操作成功但什么也没发生」。
      throw new Error(`[web.input] 页面 ${pageId} 没有对应的渲染目标(已关闭?)`);
    }
    return wc;
  }

  async evaluate(pageId: PageId, script: string): Promise<unknown> {
    // ⚠️ 不 catch —— 失败必须抛给引擎,由它翻成三态 Failed。
    // 这里吞掉异常就是历史上「日志说注入成功,右栏框是空的」那个形态。
    return this.require(pageId).executeJavaScript(script);
  }

  /**
   * OS 级 Cmd+V 兜底(搬自 `pasteTextToWebview` 步骤 6)。
   *
   * ⚠️ 备份 + 还原用户剪贴板 —— 不还原会污染用户剪贴板,那是用户能直接感知的伤害。
   */
  async osPaste(pageId: PageId, text: string): Promise<void> {
    const wc = this.require(pageId);
    const original = clipboard.readText();
    clipboard.writeText(text);
    try {
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: PASTE_MODIFIER });
      wc.sendInputEvent({ type: 'char', keyCode: 'V', modifiers: PASTE_MODIFIER });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: PASTE_MODIFIER });
    } finally {
      setTimeout(() => {
        try {
          clipboard.writeText(original);
        } catch {
          /* 还原失败不该掩盖粘贴本身的结果 —— 但也不静默:剪贴板 API 挂了是环境问题 */
          console.warn('[web.input] 剪贴板还原失败');
        }
      }, CLIPBOARD_RESTORE_MS);
    }
  }

  /**
   * 把磁盘文件喂进 `<input type=file>`(搬自 `feedToInputInternal`)。
   *
   * 为什么必须走 CDP:`<input type=file>.files` 是**只读**的,guest 页面 JS 无法凭
   * 磁盘路径构造 File(渲染进程无 Node fs)。`DOM.setFileInputFiles` 直接设磁盘绝对路径,
   * 由 Chromium 派发 change/input 事件,站点的上传 handler 会像用户选了文件一样接住。
   */
  async setFileInputFiles(
    pageId: PageId,
    selector: string,
    files: readonly string[],
  ): Promise<void> {
    const wc = this.require(pageId);

    // ⚠️ 一个 wc 只允许一个 debugger client。已被别处(AI SSE 拦截器)attach 就**复用**,
    //    且末尾**不 detach** —— 抢别人的会把 AI 的载荷通道掐掉。
    let weAttached = false;
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach('1.3');
      weAttached = true;
    }

    try {
      const { root } = await wc.debugger.sendCommand('DOM.getDocument', { depth: -1 });
      const rootNodeId = root?.nodeId;
      if (typeof rootNodeId !== 'number') {
        throw new Error('CDP DOM.getDocument 未返回根节点');
      }

      let nodeId: number | null = null;
      const candidates = selector.split(',').map((s) => s.trim()).filter(Boolean);
      for (const sel of candidates) {
        const res = await wc.debugger.sendCommand('DOM.querySelector', {
          nodeId: rootNodeId,
          selector: sel,
        });
        if (res?.nodeId) {
          nodeId = res.nodeId as number;
          break;
        }
      }
      if (nodeId == null) {
        throw new Error(`CDP 未能定位文件 input 节点(selector: ${selector})`);
      }

      await wc.debugger.sendCommand('DOM.setFileInputFiles', { files: [...files], nodeId });
    } finally {
      // 只 detach 我们自己 attach 的;复用别人的 client 不 detach
      if (weAttached) {
        try {
          wc.debugger.detach();
        } catch {
          /* 已被外部 detach / 页面销毁 —— 这里再抛会掩盖上面真正的结果 */
        }
      }
    }
  }
}

export { PASTE_MODIFIER };
