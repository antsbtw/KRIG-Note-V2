/**
 * learning IPC handlers(L5-B3.20a)
 *
 * 8 个 channel:
 *   7 invoke(vocab CRUD + has + dictionary lookup + translate + tts)
 *   1 推送(LEARNING_VOCAB_CHANGED — vocab 变化广播全量 list)
 *
 * 跟 platform/main/{ytdlp,media,tweet-fetcher,...}/ 同风格(平铺,集中导出
 * register* 函数,无 index.ts 聚合)。注册入口:`platform/main/ipc/ipc-bus.ts.initIpcBus()`。
 *
 * 安全:
 * - vocab.add 校验 word/definition 必须 string 非空
 * - 所有 IPC 入参严格 typeof 校验,非法输入直接返 null / undefined
 * - vocab broadcast 遍历所有 BrowserWindow(防御性,未来多窗口可用 — 决策 Q2 = A)
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { vocabStore } from './vocab-store';
import { lookupWord } from './dictionary-service';
import { googleTranslate, googleTTS } from './providers/google-translate';

/** 把全量 vocab list 广播给所有 renderer(主窗口 + 未来多窗口)*/
function broadcastVocabChanged(): void {
  vocabStore
    .list()
    .then((entries) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.LEARNING_VOCAB_CHANGED, entries);
        }
      }
    })
    .catch((err) => console.warn('[learning] broadcast failed:', err));
}

export function registerLearningHandlers(): void {
  // ── vocab CRUD ──

  ipcMain.handle(
    IPC_CHANNELS.LEARNING_VOCAB_ADD,
    async (_e, word: unknown, def: unknown, ctx: unknown, phon: unknown) => {
      if (typeof word !== 'string' || typeof def !== 'string') return null;
      const entry = await vocabStore.add(
        word,
        def,
        typeof ctx === 'string' ? ctx : undefined,
        typeof phon === 'string' ? phon : undefined,
      );
      if (entry) broadcastVocabChanged();
      return entry;
    },
  );

  ipcMain.handle(IPC_CHANNELS.LEARNING_VOCAB_REMOVE, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) return;
    await vocabStore.remove(id);
    broadcastVocabChanged();
  });

  ipcMain.handle(IPC_CHANNELS.LEARNING_VOCAB_LIST, async () => {
    return vocabStore.list();
  });

  ipcMain.handle(IPC_CHANNELS.LEARNING_VOCAB_HAS, async (_e, word: unknown) => {
    if (typeof word !== 'string' || !word) return false;
    return vocabStore.has(word);
  });

  // ── dictionary ──

  ipcMain.handle(IPC_CHANNELS.LEARNING_LOOKUP, async (_e, word: unknown) => {
    if (typeof word !== 'string' || !word) return null;
    return lookupWord(word);
  });

  // ── translate / tts ──

  ipcMain.handle(
    IPC_CHANNELS.LEARNING_TRANSLATE,
    async (_e, text: unknown, targetLang: unknown) => {
      if (typeof text !== 'string' || !text) return null;
      const tl = typeof targetLang === 'string' && targetLang ? targetLang : 'zh-CN';
      return googleTranslate(text, tl);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.LEARNING_TTS,
    async (_e, text: unknown, lang: unknown) => {
      if (typeof text !== 'string' || typeof lang !== 'string' || !text) return null;
      const buf = await googleTTS(text, lang);
      if (!buf) return null;
      // Buffer 转 ArrayBuffer 给 renderer(IPC 序列化兼容,renderer 直 Blob)
      // 决策 Q3 = A:ArrayBuffer 二进制原生,小开销
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  );
}
