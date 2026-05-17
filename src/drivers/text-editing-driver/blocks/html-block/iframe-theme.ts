/**
 * iframe srcdoc 注入的主题 CSS 变量
 *
 * AI 工具(如 Claude artifact)生成的 HTML 常用 CSS 变量(`var(--color-text-primary)`
 * 等)引用页面主题色。iframe 是独立文档,默认无这些变量定义,直接渲染会丢色。
 * 把变量注入 srcdoc 的 <style>:root{...}</style>,使 var() 引用解析到暗色调
 * 默认值,还原 AI 生成 artifact 在源页面里的视觉效果。
 *
 * V1 → V2 直迁:src/plugins/note/blocks/claude-theme.ts(仅保留 iframe srcdoc
 * 路径用的 styleTag 函数 — V2 html-block 不需要 inline style 变体)。
 */

const THEME_VARS: Record<string, string> = {
  '--color-text-primary': '#e8e8e8',
  '--color-text-secondary': '#a3a3a3',
  '--color-text-tertiary': '#737373',
  '--text-color-primary': '#e8e8e8',
  '--text-color-secondary': '#a3a3a3',
  '--text-color-tertiary': '#737373',
  '--fg-color': '#e8e8e8',

  '--color-bg-primary': '#1e1e1e',
  '--color-bg-secondary': '#2a2a2a',
  '--color-bg-tertiary': '#3a3a3a',
  '--color-background-primary': '#1e1e1e',
  '--color-background-secondary': '#2a2a2a',
  '--color-background-tertiary': '#3a3a3a',
  '--bg-color': '#1e1e1e',

  '--color-border-primary': '#5a5a5a',
  '--color-border-secondary': '#4a4a4a',
  '--color-border-tertiary': '#3a3a3a',

  '--color-text-info': '#78c8f0',
  '--color-background-info': 'rgba(120, 200, 240, 0.12)',
  '--color-border-info': 'rgba(120, 200, 240, 0.25)',

  '--color-text-warning': '#e8a820',
  '--color-background-warning': 'rgba(232, 168, 32, 0.12)',
  '--color-border-warning': 'rgba(232, 168, 32, 0.25)',

  '--color-text-success': '#4ade80',
  '--color-background-success': 'rgba(74, 222, 128, 0.12)',
  '--color-border-success': 'rgba(74, 222, 128, 0.25)',

  '--color-text-danger': '#f87171',
  '--color-background-danger': 'rgba(248, 113, 113, 0.12)',
  '--color-border-danger': 'rgba(248, 113, 113, 0.25)',

  '--border-radius-sm': '4px',
  '--border-radius-md': '8px',
  '--border-radius-lg': '12px',
  '--border-radius-xl': '16px',
};

export function iframeThemeStyleTag(): string {
  const vars = Object.entries(THEME_VARS)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  return `<style>
:root {
${vars}
}
body {
  background: var(--color-background-primary, #1e1e1e);
  color: var(--color-text-primary, #e8e8e8);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}
/* 隐藏滚动条:用户拖小 iframe 时,超出内容自然被 iframe 自身 overflow:hidden
   裁切,无需暴露原生滚动条(视觉干净)。Chromium / WebKit / Firefox 三家兼容。*/
html, body {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
html::-webkit-scrollbar,
body::-webkit-scrollbar {
  display: none;
}
</style>`;
}
