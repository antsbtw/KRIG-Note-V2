/**
 * stress preset — 应力模型(节点距离反映"语义相似度")
 */

import type { LayoutOptions } from '../types';

export const stressPreset: LayoutOptions = {
  algorithm: 'stress',
  spacing: { node: 60 },
};
