/**
 * 共享色板(L5-G5 / G5.3)— Fill / Line section 共用
 *
 * 直迁 V1/Freeform 风格色板视觉(design §3.2:两排 6 色 + 深浅扩展)。
 * 14 色覆盖常用形状填充 / 描边色;No Fill + 自定义取色另由 section 提供。
 */

export interface Swatch {
  name: string;
  color: string;
}

/** 14 色板(design §3.2 Fill 面板两排 + 扩展) */
export const PALETTE_14: ReadonlyArray<Swatch> = [
  { name: '白', color: '#ffffff' },
  { name: '浅灰', color: '#c8c8c8' },
  { name: '灰', color: '#888888' },
  { name: '黑', color: '#1a1a1a' },
  { name: '青', color: '#7ee5c8' },
  { name: '粉', color: '#e85a9a' },
  { name: '紫', color: '#7c4dff' },
  { name: '红', color: '#e74c3c' },
  { name: '橙', color: '#f29900' },
  { name: '黄', color: '#d4b85a' },
  { name: '绿', color: '#7cc26b' },
  { name: '蓝', color: '#5cb8e8' },
  { name: '深蓝', color: '#3a6ea5' },
  { name: '棕', color: '#8d6e63' },
];

/** 把 hex 归一成 <input type="color"> 接受的 #rrggbb(去 alpha / 空兜底黑) */
export function normalizeHex(value: string | undefined): string {
  if (!value) return '#000000';
  const m = /^#?([0-9a-fA-F]{6})/.exec(value);
  return m ? `#${m[1]}` : '#000000';
}
