import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {
    // asar 启用,但 ffmpeg-static binary 必须 unpack 才能 spawn
    // (Electron asar 内的二进制无法直接执行)。
    asar: {
      unpack: '**/node_modules/ffmpeg-static/**',
    },
    // 网页剪藏:defuddle 的 UMD bundle(index.full.js)在 main 进程 readFileSync
    // 注入。Vite-forge 打包不拷 node_modules,asar.unpack glob 对它无效(node_modules
    // 根本没进包),故把单个 bundle 文件作为 extraResource 拷进 Contents/Resources/。
    // defuddle-bundle.ts 运行时优先探 process.resourcesPath,dev 回退 node_modules。
    // surreal.exe(SurrealDB 引擎)是 sidecar 二进制,client.ts 以
    // process.resourcesPath/surreal(.exe) 为第一查找候选。Windows 打包必须把它
    // 拷进 Contents/Resources/,否则数据层起不来 → 建 note/目录全失败。
    // ⚠️ 仅在 Windows 宿主/交叉打 win 时才有对应二进制;这里按平台条件注入。
    extraResource: [
      'node_modules/defuddle/dist/index.full.js',
      ...(process.env.KRIG_TARGET_PLATFORM === 'win32' || process.platform === 'win32'
        ? ['build/surreal/win32-x64/surreal.exe']
        : []),
    ],
    name: 'KRIG Note',
    executableName: 'KRIG Note',
    icon: 'build/icon',  // forge 自动加平台后缀:macOS=.icns / Windows=.ico / Linux=.png
  },
  makers: [
    // Squirrel(.exe 安装器)只能在 Windows 宿主上打(否则需 Wine+Mono)。
    // 在 macOS 上交叉打 Windows 时跳过它,只走 ZIP 绿色版。
    ...(process.platform === 'win32' ? [new MakerSquirrel({})] : []),
    new MakerZIP({}, ['darwin', 'win32']),
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
