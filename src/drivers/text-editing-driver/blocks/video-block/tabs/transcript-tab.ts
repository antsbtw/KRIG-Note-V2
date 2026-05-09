/**
 * transcript-tab — videoBlock 'transcript' Tab(L5-B3.19.a 基础版)
 *
 * 本段:textarea 显示 / 编辑字幕原文(`[MM:SS] text` 格式)。
 * 📝 import 按钮(YouTube transcript)留 B3.19.b 段补。
 *
 * P1 修正后:textarea 即真相源,内容由 node-view 把 attrs.transcriptText 灌入;
 * 用户编辑 → input → node-view 节流 500ms 写 attrs.transcriptText + 内存重 parse cues。
 */

export interface TranscriptTab {
  el: HTMLElement;
  /** 由 node-view 调:把外部数据(attrs.transcriptText)填入 textarea */
  setText(text: string): void;
  /** 由 node-view 调:取当前 textarea 内容 */
  getText(): string;
  /** textarea input 事件 — 节流逻辑由 node-view 处理 */
  onInput(cb: (text: string) => void): () => void;
  /** 给 b 段补 import 按钮挂点 */
  toolbarMount: HTMLElement;
  destroy(): void;
}

export function createTranscriptTab(initialText: string | null): TranscriptTab {
  const el = document.createElement('div');
  el.className = 'krig-video-block__transcript-tab';
  el.contentEditable = 'false';

  // toolbar 区(import 按钮等,留 b 段挂)
  const toolbarMount = document.createElement('div');
  toolbarMount.className = 'krig-video-block__transcript-toolbar';
  el.appendChild(toolbarMount);

  // textarea
  const textarea = document.createElement('textarea');
  textarea.className = 'krig-video-block__transcript-area';
  textarea.placeholder =
    'Paste subtitle in [MM:SS] text or [HH:MM:SS] text format, one cue per line.\n' +
    '(B3.19.b will add 📝 to import YouTube transcript automatically.)';
  textarea.value = initialText || '';
  el.appendChild(textarea);

  const listeners = new Set<(text: string) => void>();
  const inputHandler = () => {
    listeners.forEach((cb) => cb(textarea.value));
  };
  textarea.addEventListener('input', inputHandler);

  return {
    el,
    setText(text) {
      if (textarea.value !== text) textarea.value = text;
    },
    getText() {
      return textarea.value;
    },
    onInput(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    toolbarMount,
    destroy() {
      textarea.removeEventListener('input', inputHandler);
      listeners.clear();
      el.remove();
    },
  };
}
