/** 相对时间：ts(ms) → '刚刚' / 'N 分钟前' 等 */
export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? '昨天' : `${days}天前`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}周前`;
  return new Date(ts).toLocaleDateString();
}
