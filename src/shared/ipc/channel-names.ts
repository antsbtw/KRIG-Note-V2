/**
 * IPC channel 名常量
 *
 * 跨进程共享类型(纯类型,0 npm 业务包 import)。
 *
 * 命名约定:
 * - 健康检查:`health.<层名>`(如 `health.L0` / `health.L1` / `health.platform`)
 * - 业务通信:`<层名>.<动作>`(如 `workspace.activate` / `view.create`)
 */

export const IPC_CHANNELS = {
  // 健康检查(各层暴露自己的 alive 状态)
  HEALTH_L0: 'health.L0',
  HEALTH_L1: 'health.L1',
  HEALTH_L2: 'health.L2',
  HEALTH_L3: 'health.L3',
  HEALTH_L3_5: 'health.L3.5',
  HEALTH_L4: 'health.L4',
  HEALTH_L5: 'health.L5',
  HEALTH_PLATFORM: 'health.platform',
  HEALTH_RENDERER: 'health.renderer',

  // 诊断上报(renderer → main,L2 阶段引入)
  DIAGNOSTICS_REPORT_ALIVE: 'diagnostics.report-alive',

  // 窗口状态变化(main → renderer,L2 阶段引入)
  WINDOW_FULLSCREEN_CHANGED: 'window.fullscreen-changed',

  // L5-B3.4:外部链接 / 文件打开(给 link-click plugin 用)
  SHELL_OPEN_EXTERNAL: 'shell.open-external',
  SHELL_OPEN_PATH: 'shell.open-path',

  // L5-B4.2:Google Translate element.js fetch(避 CSP block,main 进程取后注入)
  WEB_TRANSLATE_FETCH_ELEMENT_JS: 'web-translate.fetch-element-js',
} as const;

export type IpcChannelName = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
