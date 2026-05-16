/**
 * Callouts 精选 lucide icon 集 — Notion/Linear 风格高频子集
 *
 * v1 24 + Step 5.6 字面追加 25 = 49 个置顶 icon(D023 Step 5.6 字面路径 B 扩展)。
 *
 * 字面 grep node_modules/lucide-react/dist/lucide-react.d.ts 字面全数命中。
 *
 * v1 emoji → lucide icon 字面映射依据见 D023 §2.5.3 一次性命中表。
 *
 * 字段:
 * - name: lucide-react 字面 export name(如 'Lightbulb'),给 setCalloutIcon 写入 attrs.iconName
 * - label: UI tooltip + 搜索匹配字面标签
 * - keywords: 搜索字面关键词数组(含 v1 emoji 名,便于用户从 emoji 直觉搜)
 *
 * 字面追加新 icon 流程:
 *   1. 字面 grep lucide-react/dist/lucide-react.d.ts 确认 icon 名存在
 *   2. 字面追加一行 { name, label, keywords }
 *   3. 字面无需改 schema / API / NodeView(全数据驱动)
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

  // ── D023 Step 5.6 字面路径 B 扩展(Notion/Linear 高频子集,字面 grep 全数命中)──

  // 收藏/标记
  { name: 'Heart',         label: 'Heart',          keywords: ['love', 'favorite', 'like', '❤️'] },
  { name: 'Bookmark',      label: 'Bookmark',       keywords: ['save', 'mark', '🔖'] },
  { name: 'Star',          label: 'Star',           keywords: ['favorite', 'rating', '⭐'] },
  { name: 'Tag',           label: 'Tag',            keywords: ['label', 'category', '🏷️'] },

  // 奖励/成就
  { name: 'Trophy',        label: 'Trophy',         keywords: ['award', 'win', '🏆'] },
  { name: 'Award',         label: 'Award',          keywords: ['medal', 'badge', '🎖️'] },
  { name: 'Crown',         label: 'Crown',          keywords: ['royal', 'premium', '👑'] },
  { name: 'Rocket',        label: 'Rocket',         keywords: ['launch', 'fast', 'startup', '🚀'] },

  // 能量/特效
  { name: 'Zap',           label: 'Lightning',      keywords: ['energy', 'fast', 'bolt', '⚡'] },
  { name: 'Sparkles',      label: 'Sparkles',       keywords: ['magic', 'shine', 'new', '✨'] },

  // 提醒/时间
  { name: 'Bell',          label: 'Bell',           keywords: ['notify', 'alert', 'reminder', '🔔'] },
  { name: 'BellRing',      label: 'Bell ringing',   keywords: ['notify', 'urgent', '🔔'] },
  { name: 'Calendar',      label: 'Calendar',       keywords: ['date', 'schedule', '📅'] },
  { name: 'Timer',         label: 'Timer',          keywords: ['countdown', 'duration', '⏱️'] },

  // 通讯
  { name: 'Mail',          label: 'Mail',           keywords: ['email', 'message', '✉️'] },
  { name: 'Send',          label: 'Send',           keywords: ['submit', 'arrow up', '📤'] },
  { name: 'Inbox',         label: 'Inbox',          keywords: ['received', 'tray', '📥'] },

  // 文件/数据
  { name: 'Folder',        label: 'Folder',         keywords: ['directory', '📁'] },
  { name: 'FileText',      label: 'Document',       keywords: ['file', 'doc', '📄'] },
  { name: 'Database',      label: 'Database',       keywords: ['storage', 'data', '🗄️'] },

  // 工具/开发
  { name: 'Code',          label: 'Code',           keywords: ['programming', 'dev', '💻'] },
  { name: 'Terminal',      label: 'Terminal',       keywords: ['cli', 'shell', 'console'] },
  { name: 'Bug',           label: 'Bug',            keywords: ['issue', 'error', '🐛'] },
  { name: 'GitBranch',     label: 'Branch',         keywords: ['git', 'fork', 'version'] },

  // 媒体
  { name: 'Music',         label: 'Music',          keywords: ['audio', 'sound', '🎵'] },
  { name: 'Camera',        label: 'Camera',         keywords: ['photo', 'picture', '📷'] },
  { name: 'Image',         label: 'Image',          keywords: ['picture', 'photo', '🖼️'] },

  // 用户/社交
  { name: 'User',          label: 'User',           keywords: ['person', 'profile', '👤'] },
  { name: 'Users',         label: 'Users',          keywords: ['group', 'team', 'people', '👥'] },
  { name: 'Smile',         label: 'Smile',          keywords: ['happy', 'face', '😊'] },

  // 环境/天气
  { name: 'Sun',           label: 'Sun',            keywords: ['day', 'bright', '☀️'] },
  { name: 'Moon',          label: 'Moon',           keywords: ['night', 'dark', '🌙'] },
  { name: 'Cloud',         label: 'Cloud',          keywords: ['weather', 'sky', '☁️'] },
  { name: 'Globe',         label: 'Globe',          keywords: ['world', 'web', 'internet', '🌐'] },

  // 商业/探索
  { name: 'ShoppingCart',  label: 'Shopping cart',  keywords: ['buy', 'store', '🛒'] },
  { name: 'MapPin',        label: 'Location',       keywords: ['place', 'pin', 'address', '📍'] },
  { name: 'Eye',           label: 'Eye',            keywords: ['view', 'see', 'watch', '👁️'] },
  { name: 'Search',        label: 'Search',         keywords: ['find', 'magnify', '🔍'] },
  { name: 'Target',        label: 'Target',         keywords: ['goal', 'aim', 'bullseye', '🎯'] },

  // 数据/可视
  { name: 'Activity',      label: 'Activity',       keywords: ['pulse', 'chart', 'live'] },
  { name: 'TrendingUp',    label: 'Trending up',    keywords: ['growth', 'chart', '📈'] },
  { name: 'Filter',        label: 'Filter',         keywords: ['sort', 'narrow'] },
  { name: 'Layers',        label: 'Layers',         keywords: ['stack', 'levels'] },

  // 食物
  { name: 'Coffee',        label: 'Coffee',         keywords: ['drink', 'break', '☕'] },
];
