/**
 * 资源 / 样式文件类型声明 + Vite 客户端类型
 *
 * 让 TypeScript 接受 CSS / 图片 等 side-effect import。
 * Vite 在构建时处理这些资源,但 tsc / IDE 类型检查需要类型声明。
 *
 * vite/client 引用让 import.meta.env.DEV 等 Vite 注入的全局有类型。
 */

/// <reference types="vite/client" />

declare module '*.css';
declare module '*.scss';
declare module '*.svg' {
  const content: string;
  export default content;
}
declare module '*.png' {
  const content: string;
  export default content;
}
declare module '*.jpg' {
  const content: string;
  export default content;
}
declare module '*.jpeg' {
  const content: string;
  export default content;
}
