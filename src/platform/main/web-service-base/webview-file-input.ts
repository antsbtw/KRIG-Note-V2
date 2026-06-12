/**
 * 服务无关的「把真实磁盘文件喂给网页 <input type=file>」原语(X 集成 阶段 2.5-b,路线 B)
 *
 * 背景(路线 B,roadmap §2.A 拍板):媒体上传**绝不碰官方 API**。做法是把 note 里的图
 * **喂给 X 网页自己的文件上传控件**(<input type=file>),让 X 前端自己跑 INIT/APPEND/
 * FINALIZE。我们只负责「把真实文件塞进 input」,上传与发布仍由 X / 用户完成。
 *
 * ── 为什么用 CDP DOM.setFileInputFiles(而非 guest 内合成 DataTransfer)──
 * <input type=file>.files 是**只读**的,guest 页面 JS 无法凭磁盘路径构造 File(渲染进程
 * 无 Node fs / File 构造不接受路径)。Electron 主进程的 CDP(webContents.debugger)有
 * `DOM.setFileInputFiles`——直接拿磁盘绝对路径设进真实 file input,并由 Chromium 派发
 * change/input 事件,X 的上传 handler 会像用户选了文件一样接住。这是 Electron 喂文件的
 * 标准、最可靠做法,且与本仓 ai/interceptor.ts 的 CDP 用法同脉络。
 *
 * ── fail loud(铁律 4 / roadmap §2.C)──
 * 任一步不可靠(input 没找到 / CDP 失败 / 喂完 X 没出现已上传缩略图)→ 返回 { ok:false,
 * error },调用方据此退「文字已填入 + 提示用户手动拖图」,**绝不静默假装成功**。
 *
 * ⚠️ 写方向红线:本原语只「喂文件进 input」,绝不触碰任何发布按钮。
 */

import type { WebContents } from 'electron';

export interface FeedFilesResult {
  /** 文件是否成功喂进 input 且 X 接住(出现已上传缩略图)*/
  ok: boolean;
  /** 失败原因(调用方 fail loud 降级 + toast 用)*/
  error?: string;
  /** 实际喂进的文件数(成功时附带)*/
  fedCount?: number;
}

/** 在 guest 内按 selector(逗号分隔多候选)定位元素是否存在 */
function buildSelectorExistsScript(selector: string): string {
  return `
    (function() {
      var sel = ${JSON.stringify(selector)};
      var parts = sel.split(',').map(function(s){return s.trim();}).filter(Boolean);
      for (var i=0;i<parts.length;i++){ if (document.querySelector(parts[i])) return true; }
      return false;
    })();
  `;
}

/** poll 等 guest 内某 selector 出现(喂文件后等 X 渲染已上传缩略图)*/
async function waitForSelectorInGuest(
  wc: WebContents,
  selector: string,
  timeoutMs: number,
): Promise<boolean> {
  if (!selector) return false;
  const script = buildSelectorExistsScript(selector);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await wc.executeJavaScript(script)) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/**
 * 把若干真实磁盘文件喂给 webContents 内的 <input type=file>(路线 B 喂文件核心)。
 *
 * 流程:
 *   1. 确认 fileInputSelector 在 guest 里能定位到(找不到 → fail loud)。
 *   2. CDP attach(若已被本进程别处 attach,则复用,末尾不 detach,避免踩 SSE 拦截器)。
 *   3. DOM.getDocument → DOM.querySelector 拿 file input 的 nodeId。
 *   4. DOM.setFileInputFiles(nodeId, files=磁盘绝对路径数组)—— Chromium 派发 change 事件。
 *   5. poll 等 uploadedThumbSelector 出现(X 真接住文件的证明);没出现 → fail loud。
 *
 * @param wc 目标 X guest webContents(按 ws 定向,调用方用 requireXWebContents 取)
 * @param fileInputSelector 文件 input 的 CSS selector(profile.selectors.fileInput,多候选)
 * @param filePaths 真实磁盘绝对路径数组(media:// 经 resolveMediaPath 解析得到)
 * @param uploadedThumbSelector 喂完后用于校验「X 接住了」的已上传缩略图 selector(可空)
 */
export async function feedFilesToInput(
  wc: WebContents,
  fileInputSelector: string,
  filePaths: string[],
  uploadedThumbSelector?: string,
): Promise<FeedFilesResult> {
  if (!fileInputSelector) {
    return { ok: false, error: 'fileInput selector 未配置(需 spike 后填入 profile)' };
  }
  if (!filePaths.length) {
    return { ok: false, error: '没有可喂的媒体文件' };
  }

  // 1. 先确认 file input 在场(X compose / reply 框已渲染出上传控件)
  const inputPresent = await wc
    .executeJavaScript(buildSelectorExistsScript(fileInputSelector))
    .catch(() => false);
  if (!inputPresent) {
    return {
      ok: false,
      error: '未能定位 X 文件上传控件(可能 X 改版 / fileInput selector 失效)',
    };
  }

  // 2. CDP attach。可能本进程别处(AI SSE 拦截器)已 attach 同一 wc —— 一个 wc 只允许一个
  //    debugger client,故先看 isAttached,已 attach 就复用且**末尾不 detach**(不抢别人的)。
  let weAttached = false;
  if (!wc.debugger.isAttached()) {
    try {
      wc.debugger.attach('1.3');
      weAttached = true;
    } catch (err) {
      return { ok: false, error: `CDP attach 失败(无法喂文件):${String(err)}` };
    }
  }

  try {
    // 3. 定位 file input 的 nodeId。多候选 selector 顺序尝试(容错 X 改版)。
    const { root } = await wc.debugger.sendCommand('DOM.getDocument', { depth: -1 });
    const rootNodeId = root?.nodeId;
    if (typeof rootNodeId !== 'number') {
      return { ok: false, error: 'CDP DOM.getDocument 未返回根节点' };
    }

    let nodeId: number | null = null;
    const candidates = fileInputSelector
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const sel of candidates) {
      try {
        const res = await wc.debugger.sendCommand('DOM.querySelector', {
          nodeId: rootNodeId,
          selector: sel,
        });
        if (res?.nodeId) {
          nodeId = res.nodeId as number;
          break;
        }
      } catch {
        /* 试下一个候选 */
      }
    }
    if (nodeId == null) {
      return {
        ok: false,
        error: '未能通过 CDP 定位文件 input 节点(fileInput selector 失效?)',
      };
    }

    // 4. 喂文件:DOM.setFileInputFiles 直接设磁盘绝对路径,Chromium 派发 change/input 事件。
    try {
      await wc.debugger.sendCommand('DOM.setFileInputFiles', {
        files: filePaths,
        nodeId,
      });
    } catch (err) {
      return { ok: false, error: `喂文件进 input 失败(CDP setFileInputFiles):${String(err)}` };
    }

    // 5. 校验 X 真接住:poll 等已上传缩略图出现。X 要时间读文件 + 生成预览,给 10s。
    //    没配 uploadedThumbSelector(spike 未填)→ 退一步只确认无异常,但仍标注 thumb 未校验。
    if (uploadedThumbSelector) {
      const landed = await waitForSelectorInGuest(wc, uploadedThumbSelector, 10000);
      if (!landed) {
        return {
          ok: false,
          error: '喂文件后 X 未出现已上传缩略图(X 没接住 / uploadedMediaThumb selector 失效)',
        };
      }
    } else {
      console.warn(
        '[webview-file-input] uploadedMediaThumb selector 未配置,无法校验 X 是否接住文件(spike 待补)',
      );
    }

    console.log(`[webview-file-input] fed ${filePaths.length} file(s) to X upload input`);
    return { ok: true, fedCount: filePaths.length };
  } finally {
    // 只 detach 我们自己 attach 的;复用别人的 client 不 detach。
    if (weAttached) {
      try {
        wc.debugger.detach();
      } catch {
        /* ignore */
      }
    }
  }
}
