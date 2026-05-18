/**
 * FullscreenErrorBoundary — 防止全屏组件崩溃导致整个 block 消失
 *
 * 1:1 迁自 V1 `src/plugins/note/blocks/math-visual/components/FullscreenErrorBoundary.tsx`。
 * V2 全屏 Panel(L2 overlay)崩溃会让 L2 Binding throw,卡住整个工作区;本 boundary
 * 兜底:崩溃时显示错误信息 + "关闭" 按钮(触发 onClose → controller.hide())。
 */

import React from 'react';

export class FullscreenErrorBoundary extends React.Component<
  { children: React.ReactNode; onClose: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    console.error('[MathVisualFullscreen] 全屏组件渲染错误:', error);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999, background: '#181818',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          color: '#e0e0e0', gap: 16,
        }}>
          <div style={{ color: '#ef4444', fontSize: 16 }}>全屏模式加载失败</div>
          <div style={{ color: '#888', fontSize: 13, maxWidth: 400, textAlign: 'center' }}>
            {this.state.error.message}
          </div>
          <button
            onClick={() => { this.setState({ error: null }); this.props.onClose(); }}
            style={{
              padding: '8px 24px', background: '#333', border: '1px solid #555',
              color: '#e0e0e0', borderRadius: 6, cursor: 'pointer', fontSize: 13,
            }}
          >
            关闭
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
