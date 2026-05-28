import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {
    // asar 启用,但 ffmpeg-static binary 必须 unpack 才能 spawn
    // (Electron asar 内的二进制无法直接执行)
    asar: {
      unpack: '**/node_modules/ffmpeg-static/**',
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
