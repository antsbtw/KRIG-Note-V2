import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {
    // asar 启用,但原生二进制必须 unpack:
    // - ffmpeg-static:spawn 子进程(asar 内的可执行文件 spawn 不了)
    // - @napi-rs/canvas + 平台子包(canvas-darwin-arm64 等):.node binary
    //   必须 dlopen 加载,asar 内 require('.node') Electron 也不支持
    //   (用于 EMF/WMF → PNG 转换 — word-import/emf-decoder)
    asar: {
      unpack: '**/{ffmpeg-static,@napi-rs}/**',
    },
    name: 'KRIG Note',
    executableName: 'KRIG Note',
    icon: 'build/icon',  // forge 自动加平台后缀:macOS=.icns / Windows=.ico / Linux=.png
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/platform/main/index.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/platform/main/preload/main-window-preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
  ],
};

export default config;
