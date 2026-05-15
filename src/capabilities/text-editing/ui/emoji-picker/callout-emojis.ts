/**
 * Callouts 精选 emoji 集 — 对齐 Notion callout picker 顶部"标注"分类(24 个)
 *
 * emoji-mart `custom` prop 字面格式:
 * - id/name = 分类层级
 * - emojis[].id 必须唯一(用 emoji 名做 slug,带 callouts_ 前缀避免与系统 emoji ID 撞)
 * - emojis[].skins[].native = 实际 emoji 字符(emoji-mart 5.x 源码 line 2333 字面支持)
 *
 * 用 `custom` 而非 `categories` 的原因:`categories` 只能从 9 个内置分类挑选/排序,
 * 不能定义"指定 emoji 子集"。`custom` 才能精选 emoji 入新分类。
 */

interface CalloutEmoji {
  id: string;
  name: string;
  native: string;
}

const CALLOUT_PICKS: ReadonlyArray<CalloutEmoji> = [
  { id: 'bulb', name: 'Light bulb', native: '💡' },
  { id: 'point_right', name: 'Pointing right', native: '👉' },
  { id: 'point_up', name: 'Pointing up', native: '☝️' },
  { id: 'ok_hand', name: 'OK hand', native: '👌' },
  { id: 'key', name: 'Key', native: '🔑' },
  { id: 'construction', name: 'Construction', native: '🚧' },
  { id: 'warning', name: 'Warning', native: '⚠️' },
  { id: 'fire', name: 'Fire', native: '🔥' },
  { id: 'pushpin', name: 'Push pin', native: '📌' },
  { id: 'scissors', name: 'Scissors', native: '✂️' },
  { id: 'question', name: 'Question mark', native: '❓' },
  { id: 'no_entry_sign', name: 'No entry sign', native: '🚫' },
  { id: 'no_entry', name: 'No entry', native: '⛔' },
  { id: 'alarm_clock', name: 'Alarm clock', native: '⏰' },
  { id: 'telephone', name: 'Telephone', native: '☎️' },
  { id: 'rotating_light', name: 'Rotating light', native: '🚨' },
  { id: 'recycle', name: 'Recycle', native: '♻️' },
  { id: 'white_check_mark', name: 'Check mark', native: '✅' },
  { id: 'lock', name: 'Lock', native: '🔒' },
  { id: 'paperclip', name: 'Paperclip', native: '📎' },
  { id: 'book', name: 'Book', native: '📖' },
  { id: 'speaking_head', name: 'Speaking head', native: '🗣️' },
  { id: 'arrow_right', name: 'Arrow right', native: '➡️' },
  { id: 'mega', name: 'Megaphone', native: '📣' },
  { id: 'hammer_and_wrench', name: 'Hammer and wrench', native: '🛠️' },
  { id: 'gear', name: 'Gear', native: '⚙️' },
];

/**
 * 转成 emoji-mart `custom` prop 期望格式(单一分类 "Callouts")。
 * id 加 callouts_ 前缀:emoji-mart 字面要求 custom emoji ID 跨分类唯一,
 * 防与系统 emoji ID (例 'bulb' 系统也有)冲突。
 */
export const CALLOUT_CUSTOM_CATEGORY = [
  {
    id: 'callouts',
    name: 'Callouts',
    emojis: CALLOUT_PICKS.map((e) => ({
      id: `callouts_${e.id}`,
      name: e.name,
      keywords: [e.id, 'callout'],
      skins: [{ native: e.native }],
    })),
  },
];
