/**
 * Demo Installer — Phase 1 临时演示触发器(Phase 2 接 mermaid 后删除整个 __demo__/ 目录)
 *
 * 一站式注册:
 * 1. DemoFullscreenPanel React 组件(撑满,中央文字 + close 按钮)
 * 2. note-view.slash 项 `/demo-fullscreen`
 * 3. 命令 handler `note-view.demo-fullscreen-open`
 * 4. fullscreenOverlayRegistry 注册 `_demo.fullscreen.panel`
 *
 * Phase 1 验证目的:
 * - 全屏覆盖 viewport(含 WorkspaceBar 区域 — 用户看不到顶部 tab bar)
 * - Esc 关闭 ✓
 * - close 按钮关闭 ✓
 * - 关闭后 workspace 状态原样保留 ✓
 *
 * 启动方式:src/platform/renderer/index.tsx 显式 import 本文件触发副作用。
 * Phase 2 接入 mermaid 时,删除 __demo__/ 目录 + 删除 renderer/index.tsx 内
 * 对应 import 行 — 一并清空。
 */

import { fullscreenOverlayRegistry }
  from '@slot/interaction-registries/fullscreen-overlay-registry/registry';
import type { FullscreenOverlayCloseProps }
  from '@slot/interaction-registries/fullscreen-overlay-registry/types';
import { fullscreenOverlayController }
  from '@slot/triggers/fullscreen-overlay-controller';
import { slashRegistry }
  from '@slot/interaction-registries/slash-registry/slash-registry';
import { commandRegistry } from '@slot/command-registry/command-registry';

const OVERLAY_ID = '_demo.fullscreen.panel';
const COMMAND_ID = '_demo.fullscreen-open';
const SLASH_ITEM_ID = 'note-view.slash._demo-fullscreen';

/** Demo Panel:撑满 + 居中文字 + close 按钮 */
function DemoFullscreenPanel({ onClose }: FullscreenOverlayCloseProps) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        color: '#d4d4d4',
      }}
    >
      <h1 style={{ fontSize: 32, margin: 0 }}>Demo Fullscreen Overlay</h1>
      <p style={{ fontSize: 14, color: '#888', maxWidth: 480, textAlign: 'center', margin: 0 }}>
        Phase 1 演示:本面板撑满 viewport,WorkspaceBar / NavSide / view 全部隐藏。
        Esc 或下方按钮关闭后,工作空间状态原样保留。
      </p>
      <button
        type="button"
        onClick={onClose}
        style={{
          padding: '8px 24px',
          fontSize: 14,
          background: '#2a2a2a',
          color: '#ccc',
          border: '1px solid #444',
          borderRadius: 6,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Close (or press Esc)
      </button>
    </div>
  );
}

export function installFullscreenOverlayDemo(): void {
  fullscreenOverlayRegistry.register({
    id: OVERLAY_ID,
    Component: DemoFullscreenPanel,
  });

  commandRegistry.register(COMMAND_ID, () => {
    fullscreenOverlayController.show(OVERLAY_ID);
  });

  slashRegistry.register([
    {
      id: SLASH_ITEM_ID,
      label: 'Demo Fullscreen Overlay',
      command: COMMAND_ID,
      keywords: ['demo', 'fullscreen', 'overlay', 'test'],
      view: 'note-view',
      order: 999,
    },
  ]);
}

// 副作用:模块加载即注册(renderer/index.tsx import 即触发)
installFullscreenOverlayDemo();
