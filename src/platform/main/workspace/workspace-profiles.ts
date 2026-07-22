/**
 * Workspace Profiles — 预配置 workspace 模板
 *
 * Profile = 创建 workspace 时的初始配置（label + slotBinding）。
 * 未来可扩展：proxy 出口、独立 cookie partition、默认 pluginStates 等。
 *
 * 当前内置 profile：
 *   - note : 笔记模式，left=note-view
 *   - web  : 浏览器模式，left=web-view（多用户/多网络环境隔离的核心场景）
 *   - ai   : AI 模式，left=ai-view
 */

import type { SlotBinding } from '@workspace/workspace-state/workspace-state';

export interface WorkspaceProfile {
  id: string;
  label: string;
  slotBinding: SlotBinding;
}

export const WORKSPACE_PROFILES: WorkspaceProfile[] = [
  {
    id: 'note',
    label: 'Note',
    slotBinding: { left: 'note-view', right: null },
  },
  {
    id: 'web',
    label: 'Web',
    slotBinding: { left: 'web-view', right: null },
  },
  {
    id: 'ai',
    label: 'AI',
    slotBinding: { left: 'ai-view', right: null },
  },
];

export function getProfile(profileId: string): WorkspaceProfile | undefined {
  return WORKSPACE_PROFILES.find((p) => p.id === profileId);
}
