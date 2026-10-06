import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// V2 renderer 构建配置(单一 main_window renderer)
//
// 坑:root 指向 src/platform/renderer 后,forge 传入的相对 outDir
// '.vite/renderer/main_window' 会被 vite 从 root 解析,产物错落到
// src/platform/renderer/.vite/renderer/main_window/,而 forge 打包只从项目根的
// .vite/renderer/ 拷进 asar → 拷到空 → 打包版白屏。
// 用绝对路径把 outDir 钉回项目根,抵消 root 的相对解析。
/**
 * ⭐⭐⭐ **构建戳** —— 2026-10-06,为了回答「跑着的 app 里有没有我刚才那个修改」。
 *
 * ⚠️⚠️ 真机踩到:我改完代码让用户「再采一次」,用户采了、数据纹丝不动,
 * 两个人一起对着同一份输出纳闷 —— 真因是 **app 还跑着旧构建**
 * (构建 07:16,修复提交 07:18,差 2.5 分钟)。
 * ⭐ 面板把这个戳印出来,「是不是旧构建」就从**猜**变成**看一眼**。
 * ⚠️ `electron-forge start` 只在**启动时**构建,改完必须重启 app。
 */
const BUILD_STAMP = new Date().toISOString();

export default defineConfig({
  define: { __BUILD_STAMP__: JSON.stringify(BUILD_STAMP) },
  root: 'src/platform/renderer',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('.vite/renderer/main_window', import.meta.url)),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@views':        fileURLToPath(new URL('./src/views', import.meta.url)),
      '@capabilities': fileURLToPath(new URL('./src/capabilities', import.meta.url)),
      '@drivers':      fileURLToPath(new URL('./src/drivers', import.meta.url)),
      '@semantic':     fileURLToPath(new URL('./src/semantic', import.meta.url)),
      '@storage':      fileURLToPath(new URL('./src/storage', import.meta.url)),
      '@platform':     fileURLToPath(new URL('./src/platform', import.meta.url)),
      '@shell':        fileURLToPath(new URL('./src/shell', import.meta.url)),
      '@workspace':    fileURLToPath(new URL('./src/workspace', import.meta.url)),
      '@slot':         fileURLToPath(new URL('./src/slot', import.meta.url)),
      '@shared':       fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@modules':     fileURLToPath(new URL('./src/modules', import.meta.url)),
    },
  },
});
