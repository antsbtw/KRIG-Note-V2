/**
 * 资源 / 样式文件类型声明
 *
 * 让 TypeScript 接受 CSS / 图片 等 side-effect import。
 * Vite 在构建时处理这些资源,但 tsc / IDE 类型检查需要类型声明。
 */

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
