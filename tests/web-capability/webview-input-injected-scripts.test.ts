/**
 * 守卫:pasteImageToWebview / describeEditableCandidates 注入 guest 的脚本必须是合法 JS,
 * 且正则转义没被模板字面量吃掉。
 *
 * 为什么要有:2026-10-17 describeComposerArea 里 `split(/\s+/)` 写进模板字面量后变成
 * `split(/s+/)` —— 不报错、tsc 全绿,只是按字母 s 切 class(日志里 `ab.olute`)。
 * 源码扫描看不出,只有拿到「模板求值后真正注入的字符串」再解析/执行才看得见。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  clipboard: { readText: () => '', writeText: () => {}, writeImage: () => {} },
  nativeImage: { createFromDataURL: () => ({}) },
}));

import {
  pasteImageToWebview,
  describeEditableCandidates,
} from '../../src/platform/main/web-service-base/webview-input';

/** 假 webContents:记下每段注入脚本;按脚本内容给最小返回让流程走完所有分支 */
function fakeWebContents() {
  const scripts: string[] = [];
  const wc = {
    executeJavaScript: async (script: string) => {
      scripts.push(script);
      if (script.includes('composerImg')) {
        return { localImg: 0, attachment: 0, preview: 0, composerImg: 0 };
      }
      if (script.includes('input[type="file"]')) return 'no-file-input';
      if (script.includes('rootTag=')) return 'rootTag=div';
      if (script.includes('readyState')) return 'url=x';
      if (script.includes('ClipboardEvent')) return 'dispatched';
      return true; // focusInputBox
    },
    sendInputEvent: () => {},
  };
  return { wc: wc as unknown as Electron.WebContents, scripts };
}

describe('webview-input 注入脚本', () => {
  it('粘图全流程(合成 paste → file input → OS Cmd+V → composer dump)每段脚本都能解析', async () => {
    vi.useFakeTimers();
    const { wc, scripts } = fakeWebContents();
    const p = pasteImageToWebview(wc, 'div.ProseMirror', 'data:image/jpeg;base64,QUJD');
    await vi.runAllTimersAsync();
    const r = await p;
    vi.useRealTimers();

    expect(r.landed).toBe(false); // 假 wc 信号恒不变 → 走到最后一级
    // 至少覆盖:focus / 基线 / 合成 paste / file input / composer dump
    expect(scripts.some((s) => s.includes('ClipboardEvent'))).toBe(true);
    expect(scripts.some((s) => s.includes('input[type="file"]'))).toBe(true);
    expect(scripts.some((s) => s.includes('rootTag='))).toBe(true);
    for (const s of scripts) {
      expect(() => new Function(s)).not.toThrow();
    }
  });

  it('切 class 的正则在注入后仍是 \\s+(没被吃成 s+)', async () => {
    vi.useFakeTimers();
    const { wc, scripts } = fakeWebContents();
    const p = pasteImageToWebview(wc, 'div.ProseMirror', 'data:image/jpeg;base64,QUJD');
    await vi.runAllTimersAsync();
    await p;
    vi.useRealTimers();
    await describeEditableCandidates(wc);

    const withSplit = scripts.filter((s) => s.includes('.split(/'));
    expect(withSplit.length).toBeGreaterThanOrEqual(2); // composer dump + 可编辑元素清单
    for (const s of withSplit) {
      expect(s).toContain('split(/\\s+/)');
      expect(s).not.toMatch(/split\(\/s\+\/\)/);
      // 真执行那段切分:'ab  absolute' 必须切成两段而非按 s 切
      const re = /split\((\/[^/]+\/)\)/.exec(s)![1];
      // eslint-disable-next-line no-eval
      expect('ab  absolute'.split(eval(re))).toEqual(['ab', 'absolute']);
    }
  });
});
