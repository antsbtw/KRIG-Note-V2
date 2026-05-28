import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// V2 主进程构建配置
//
// External 策略:含原生 .node binary 的包必须 external,
// 否则 Vite/Rollup 把 binary 当 JS 解析报 "Unexpected character '\xef\xbf\xbd'"
// (binary 头字节 UTF-8 decode 出来就是 replacement char)。
// @napi-rs/canvas 装平台 binary 子包(canvas-darwin-arm64 等),emf-converter
// 依赖 napi-rs/canvas → 一并 external。
//
// 跟 ffmpeg-static 同处理逻辑(也是 native binary,V2 走 app.getAppPath 显式定位)。
const NATIVE_EXTERNALS = [
  '@napi-rs/canvas',
  /^@napi-rs\/canvas-/,        // platform 子包
  'emf-converter',             // 间接靠 napi-rs canvas 跑(本身纯 TS,external 也无副作用)
];

export default defineConfig({
  resolve: {
    alias: {
      '@views':        fileURLToPath(new URL('./src/views', import.meta.url)),
      '@capabilities': fileURLToPath(new URL('./src/capabilities', import.meta.url)),
      '@semantic':     fileURLToPath(new URL('./src/semantic', import.meta.url)),
      '@storage':      fileURLToPath(new URL('./src/storage', import.meta.url)),
      '@platform':     fileURLToPath(new URL('./src/platform', import.meta.url)),
      '@shell':        fileURLToPath(new URL('./src/shell', import.meta.url)),
      '@workspace':    fileURLToPath(new URL('./src/workspace', import.meta.url)),
      '@slot':         fileURLToPath(new URL('./src/slot', import.meta.url)),
      '@shared':       fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      external: NATIVE_EXTERNALS,
    },
  },
});
