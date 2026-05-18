/**
 * ContentSender — paste text/images into AI service input box.
 *
 * V1 源:src/plugins/web-bridge/capabilities/writer.ts(字面搬,改 import alias)
 */

import { getAIServiceProfile, type AIServiceId } from '@shared/types/ai-service-types';

/**
 * Paste text into the AI service input box via executeJavaScript.
 * Uses ClipboardEvent simulation for contentEditable (ChatGPT/Claude)
 * and value assignment for textarea (Gemini).
 */
export async function pasteTextToAI(
  webContents: Electron.WebContents,
  serviceId: AIServiceId,
  text: string,
): Promise<boolean> {
  const profile = getAIServiceProfile(serviceId);
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');

  const script = `
    (function() {
      var selector = ${JSON.stringify(profile.selectors.inputBox)};
      var selectors = selector.split(',').map(function(s) { return s.trim(); });
      var el = null;
      for (var i = 0; i < selectors.length; i++) {
        el = document.querySelector(selectors[i]);
        if (el) break;
      }
      if (!el) return { success: false, error: 'Input element not found' };

      var text = \`${escaped}\`;

      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        el.focus();
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el.contentEditable === 'true') {
        el.focus();
        var dt = new DataTransfer();
        dt.setData('text/plain', text);
        var pasteEvent = new ClipboardEvent('paste', {
          bubbles: true, cancelable: true, clipboardData: dt,
        });
        el.dispatchEvent(pasteEvent);

        // Fallback: if paste didn't populate, set innerHTML directly
        setTimeout(function() {
          if (el.textContent.trim().length === 0) {
            el.innerHTML = '<p>' + text.replace(/\\n/g, '</p><p>') + '</p>';
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, 200);
      }

      return { success: true };
    })();
  `;

  try {
    const result = await webContents.executeJavaScript(script);
    if (result?.success) {
      console.log(`[ContentSender] Pasted text into ${profile.name} input`);
      return true;
    }
    console.warn(`[ContentSender] ${profile.name} input not found`);
    return false;
  } catch (error) {
    console.error(`[ContentSender] Failed to paste into ${profile.name}:`, error);
    return false;
  }
}

/**
 * Click the send button to submit the prompt.
 */
export async function clickSendButton(
  webContents: Electron.WebContents,
  serviceId: AIServiceId,
): Promise<boolean> {
  const profile = getAIServiceProfile(serviceId);

  const script = `
    (function() {
      var selector = ${JSON.stringify(profile.selectors.sendButton)};
      var selectors = selector.split(',').map(function(s) { return s.trim(); });
      var btn = null;
      for (var i = 0; i < selectors.length; i++) {
        btn = document.querySelector(selectors[i]);
        if (btn) break;
      }
      if (!btn) return { success: false, error: 'Send button not found' };
      btn.click();
      return { success: true };
    })();
  `;

  try {
    const result = await webContents.executeJavaScript(script);
    if (result?.success) {
      console.log(`[ContentSender] Clicked send button for ${profile.name}`);
      return true;
    }
    // Fallback: press Enter
    console.log(`[ContentSender] Send button not found, pressing Enter`);
    webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    return true;
  } catch (error) {
    console.error(`[ContentSender] Failed to click send for ${profile.name}:`, error);
    return false;
  }
}
