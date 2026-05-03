/**
 * V2 Renderer 进程入口
 *
 * L0 阶段:仅 mount 一个临时占位组件 "L0+L1 alive",
 * 让用户能看到 V2 启动成功。
 *
 * L2 阶段后:此 entry 应渲染 ShellLayout(三栏布局)。
 */

import { createRoot } from 'react-dom/client';
import { reportRendererAlive } from './diagnostics/renderer-alive';

function L0PlaceholderApp() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      backgroundColor: '#1e1e1e',
      color: '#e0e0e0',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      gap: 16,
    }}>
      <h1 style={{ fontSize: 32, margin: 0 }}>KRIG Note V2</h1>
      <div style={{ fontSize: 18, color: '#7ab07a' }}>L0 + L1 alive</div>
      <div style={{ fontSize: 12, color: '#888', marginTop: 24 }}>
        平台层(L0)+ 窗口层(L1)启动成功
        <br />
        L2~L5 待实施
        <br />
        <br />
        DevTools 测试健康检查:
        <br />
        <code style={{ color: '#aaa' }}>await window.electronAPI?.health?.('L0')</code>
        <br />
        (preload 暂未引入,L0 阶段健康检查仅主进程 console 可见)
      </div>
    </div>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(<L0PlaceholderApp />);
  reportRendererAlive();
}
