/**
 * ContentSender — 把 prompt "真粘贴+真发送" 到 AI 网页输入框
 *
 * V1 走 ClipboardEvent JS 派发 — 在 Claude 这种 React + ProseMirror 输入框上失效:
 * - JS dispatch 的 ClipboardEvent 会触发 PM 的 paste handler 写 ContentEditable DOM,
 *   但 React 的 controlled state 不更新 → 发送按钮永远 disabled
 * - 实测 Claude.ai 上 paste"成功"日志却看不到内容显现
 *
 * V2 改方案:走真 OS 级 paste — clipboard.writeText + webContents.sendInputEvent
 * Cmd+V(macOS) / Ctrl+V(Win/Linux) 模拟真键盘。Chromium 处理真粘贴时:
 * - 触发 native paste event(React 监听到 input change)
 * - 输入框真的填上字符,按钮真的从 disabled 变 enabled
 * - 跟用户手动 Cmd+V 完全等价(因为就是 OS 级 input event)
 *
 * 副作用:会污染用户剪贴板 — 用 save/restore 模式:发送前备份原 clipboard,完成后还原。
 *
 * 发送:也走 OS 级 — focus 输入框 + sendInputEvent Enter(Gemini Ctrl+Enter)。
 * fallback:Step 1 OS Enter / Step 2 querySelector click button / Step 3 JS dispatch Enter。
 *
 * 铁律 1(底座复用):focus + OS 级 Cmd+V 真粘贴 这套**服务无关**逻辑已下沉到
 * web-service-base/webview-input(focusInputBox / pasteTextToWebview),AI 与 X 共用。
 * 本文件 focusInput / pasteTextToAI 退化为传 AI profile selector 的薄包装;
 * clickSendButton 是 AI 问答专属的「自动发送」语义(X 写方向绝不自动点发布),保留在此。
 */

import {
  focusInputBox,
  pasteTextToWebview,
} from '../web-service-base';
import { getAIServiceProfile, type AIServiceId } from '@shared/types/ai-service-types';

/**
 * focus AI 输入框 — 薄包装:取 AI profile 的 inputBox selector,委托公共 focusInputBox。
 */
async function focusInput(
  webContents: Electron.WebContents,
  serviceId: AIServiceId,
): Promise<boolean> {
  const profile = getAIServiceProfile(serviceId);
  return focusInputBox(webContents, profile.selectors.inputBox);
}

/**
 * Paste text into the AI service input box —— 薄包装:取 AI profile 的 inputBox selector,
 * 委托公共 pasteTextToWebview(focus + 备份剪贴板 + OS Cmd+V + 验证落地 + 兜底 + 还原)。
 *
 * 行为与抽取前一致(原内联逻辑一字未改,只把 selector 提成入参下沉到公共原语)。
 */
export async function pasteTextToAI(
  webContents: Electron.WebContents,
  serviceId: AIServiceId,
  text: string,
): Promise<boolean> {
  const profile = getAIServiceProfile(serviceId);
  return pasteTextToWebview(webContents, profile.selectors.inputBox, text);
}

/**
 * 点发送 — 优先 OS 级 Enter,fallback querySelector click,再 fallback JS dispatch。
 *
 * Gemini 用 Ctrl+Enter(profile.input.submitKey),Claude/ChatGPT 用 Enter。
 */
export async function clickSendButton(
  webContents: Electron.WebContents,
  serviceId: AIServiceId,
): Promise<boolean> {
  const profile = getAIServiceProfile(serviceId);
  const useCtrlEnter = profile.input.submitKey === 'Ctrl+Enter';
  const modifiers: Array<'control'> = useCtrlEnter ? ['control'] : [];

  // 先确保输入框焦点在(刚 paste 后焦点应该还在,但保险起见再 focus)
  await focusInput(webContents, serviceId);
  await new Promise((resolve) => setTimeout(resolve, 50));

  // ── Step 1: OS 级 Enter(input 已 focus → Chromium 派发到 native handler)──
  try {
    webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return', modifiers });
    webContents.sendInputEvent({ type: 'char', keyCode: 'Return', modifiers });
    webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return', modifiers });
    // 等 200ms 让 React 反应,然后探测输入框是否被清空(成功提交的标志)
    await new Promise((resolve) => setTimeout(resolve, 250));
    const cleared = await checkInputCleared(webContents, serviceId);
    if (cleared) {
      console.log(`[ContentSender] Sent for ${profile.name} via OS ${useCtrlEnter ? 'Ctrl+' : ''}Enter`);
      return true;
    }
  } catch (err) {
    console.warn(`[ContentSender] OS Enter failed for ${profile.name}:`, err);
  }

  // ── Step 2: querySelector click send button ──
  const script = `
    (function() {
      var sendSel = ${JSON.stringify(profile.selectors.sendButton)};
      var inputSel = ${JSON.stringify(profile.selectors.inputBox)};
      var sendSelectors = sendSel.split(',').map(function(s) { return s.trim(); });
      var inputSelectors = inputSel.split(',').map(function(s) { return s.trim(); });

      // 找 send button + click(过滤 disabled)
      for (var i = 0; i < sendSelectors.length; i++) {
        var el = document.querySelector(sendSelectors[i]);
        if (el && !el.disabled && el.getAttribute('aria-disabled') !== 'true') {
          el.click();
          return { success: true, via: 'click', sel: el.tagName + (el.getAttribute('aria-label') ? '[' + el.getAttribute('aria-label') + ']' : '') };
        }
      }

      // 找不到 send button → 输入框上 JS dispatch Enter
      var input = null;
      for (var j = 0; j < inputSelectors.length; j++) {
        input = document.querySelector(inputSelectors[j]);
        if (input) break;
      }
      if (input) {
        try { input.focus(); } catch(e) {}
        var opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
        input.dispatchEvent(new KeyboardEvent('keydown', opts));
        input.dispatchEvent(new KeyboardEvent('keypress', opts));
        input.dispatchEvent(new KeyboardEvent('keyup', opts));
        return { success: true, via: 'js-dispatch-enter' };
      }
      return { success: false, error: 'No send button + no input found' };
    })();
  `;

  try {
    const result = await webContents.executeJavaScript(script);
    if (result?.success) {
      console.log(
        `[ContentSender] Sent for ${profile.name} via ${result.via}${result.sel ? ` (${result.sel})` : ''}`,
      );
      return true;
    }
    console.error(`[ContentSender] All send paths failed for ${profile.name}: ${result?.error}`);
    return false;
  } catch (err) {
    console.error(`[ContentSender] Failed to send for ${profile.name}:`, err);
    return false;
  }
}

/**
 * 检验输入框是否被清空(发送成功后 AI 网页通常清空输入框)。
 */
async function checkInputCleared(
  webContents: Electron.WebContents,
  serviceId: AIServiceId,
): Promise<boolean> {
  const profile = getAIServiceProfile(serviceId);
  const script = `
    (function() {
      var sel = ${JSON.stringify(profile.selectors.inputBox)};
      var selectors = sel.split(',').map(function(s) { return s.trim(); });
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el) {
          var content = (el.value !== undefined ? el.value : el.textContent) || '';
          return content.trim().length === 0;
        }
      }
      return false;
    })();
  `;
  try {
    return Boolean(await webContents.executeJavaScript(script));
  } catch {
    return false;
  }
}
