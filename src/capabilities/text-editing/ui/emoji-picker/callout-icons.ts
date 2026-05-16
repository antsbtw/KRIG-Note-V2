/**
 * Callouts 精选 lucide icon 集 — 对齐 v1 Callouts emoji 一对一(24 个)
 *
 * D023 §4.5 字面清单(grep node_modules/lucide-react/dist/lucide-react.d.ts 字面 24/24 命中):
 *
 * v1 emoji → lucide icon 字面映射依据见 D023 §2.5.3 一次性命中表。
 *
 * 字段:
 * - name: lucide-react 字面 export name(如 'Lightbulb'),给 setCalloutIcon 写入 attrs.iconName
 * - label: UI tooltip + 搜索匹配字面标签
 * - keywords: 搜索字面关键词数组(含 v1 emoji 名,便于用户从 emoji 直觉搜)
 */

export interface CalloutIcon {
  name: string;
  label: string;
  keywords: ReadonlyArray<string>;
}

export const CALLOUT_ICON_PICKS: ReadonlyArray<CalloutIcon> = [
  { name: 'Lightbulb',     label: 'Light bulb',     keywords: ['bulb', 'idea', 'tip', '💡'] },
  { name: 'ArrowRight',    label: 'Arrow right',    keywords: ['point right', 'next', '➡️', '👉'] },
  { name: 'ChevronUp',     label: 'Chevron up',     keywords: ['point up', '☝️'] },
  { name: 'ThumbsUp',      label: 'Thumbs up',      keywords: ['ok', 'good', '👌', '👍'] },
  { name: 'Key',           label: 'Key',            keywords: ['important', '🔑'] },
  { name: 'Construction',  label: 'Construction',   keywords: ['wip', 'progress', '🚧'] },
  { name: 'AlertTriangle', label: 'Warning',        keywords: ['caution', 'warn', '⚠️'] },
  { name: 'Flame',         label: 'Fire',           keywords: ['hot', '🔥'] },
  { name: 'Pin',           label: 'Pin',            keywords: ['pushpin', 'sticky', '📌'] },
  { name: 'Scissors',      label: 'Scissors',       keywords: ['cut', '✂️'] },
  { name: 'HelpCircle',    label: 'Question',       keywords: ['doubt', 'help', '❓'] },
  { name: 'Ban',           label: 'No entry sign',  keywords: ['forbidden', '🚫'] },
  { name: 'Octagon',       label: 'Stop',           keywords: ['no entry', '⛔'] },
  { name: 'AlarmClock',    label: 'Alarm clock',    keywords: ['time', 'reminder', '⏰'] },
  { name: 'Phone',         label: 'Phone',          keywords: ['telephone', 'call', '☎️'] },
  { name: 'Siren',         label: 'Siren',          keywords: ['emergency', 'alert', '🚨'] },
  { name: 'Recycle',       label: 'Recycle',        keywords: ['reuse', '♻️'] },
  { name: 'CheckCircle',   label: 'Check',          keywords: ['done', 'ok', 'success', '✅'] },
  { name: 'Lock',          label: 'Lock',           keywords: ['secure', 'private', '🔒'] },
  { name: 'Paperclip',     label: 'Paperclip',      keywords: ['attach', '📎'] },
  { name: 'BookOpen',      label: 'Book',           keywords: ['read', 'docs', '📖'] },
  { name: 'MessageCircle', label: 'Speech',         keywords: ['speak', 'comment', '🗣️'] },
  { name: 'Megaphone',     label: 'Megaphone',      keywords: ['announce', 'broadcast', '📣'] },
  { name: 'Wrench',        label: 'Wrench',         keywords: ['tools', 'fix', '🛠️'] },
];
