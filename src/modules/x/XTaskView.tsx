/**
 * XTaskView —— ⭐⭐ X 的「任务」(2026-10-16),与「运营」同级
 *
 * 用户 10-16:「既然验证过了,操作台是后台,应该把编排好的流程放在主页面了。是否增加一个和运营同级的task(任务),
 * 这个任务就是蓝V互关」「应该按照设计流程,蓝V互关我们要做什么,围绕需要做的事情来展现或构建就好了。」
 * → 左:任务列表;右:选中任务要做的几件事,每件事「做到哪了 + 往下推一步的按钮」,细节点进去再看。
 * ⚠️ 业务功能只进这里 / 运营,不进操作台(操作台是测试后台,将来隐藏)。
 */
import { useCallback, useState, type CSSProperties, type ReactElement } from 'react';
import type { ViewComponentProps } from '@slot/view-type-registry/view-definition';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { XAccountBadge } from './XAccountBadge';
import { BlueMutualTask } from './XTaskBlueMutual';
import { RelationTask } from './XTaskRelation';

/** ⚠️ 任务清单 —— 标签与 id 同在一处 */
type TaskId = 'blue-mutual' | 'relation';
const TASKS: ReadonlyArray<{ id: TaskId; label: string }> = [
  { id: 'blue-mutual', label: '蓝V互关' },
  /** ⭐ 2026-10-20 用户:「在任务中添加一个"关系采集"这样的完整任务吧」 */
  { id: 'relation', label: '关系采集' },
];

export function XTaskView({ workspaceId, slot }: ViewComponentProps): ReactElement {
  const [task, setTask] = useState<TaskId>('blue-mutual');
  /** 号变了重挂任务内容(关系按号算) */
  const [accountKey, setAccountKey] = useState('none');
  const onAccount = useCallback((a: { restId?: string } | null) => setAccountKey(a?.restId ?? 'none'), []);

  const handleClose = useCallback(() => {
    const bus = workspaceManager.getBus(workspaceId);
    if (!bus) return;
    /** ⚠️ 由框架告知的 slot 决定,不读 slotBinding 反推(记忆 project-dont-guess-own-slot) */
    if (slot === 'right') bus.slot.closeRight();
    else bus.slot.closeLeft();
  }, [workspaceId, slot]);

  return (
    <div style={S.root}>
      <div style={S.header}>
        <span style={S.title}>📋 任务</span>
        <XAccountBadge wsId={workspaceId} onAccount={onAccount} />
        <span style={{ flex: 1 }} />
        <button type="button" style={S.iconBtn} onClick={handleClose} title="关闭任务">✕</button>
      </div>
      <div style={S.split}>
        <div style={S.list}>
          {TASKS.map((t) => (
            <button key={t.id} type="button" onClick={() => setTask(t.id)}
              style={{ ...S.item, ...(task === t.id ? S.itemActive : null) }}>
              {task === t.id ? '▶ ' : ''}{t.label}
            </button>
          ))}
          <div style={S.muted}>(以后更多)</div>
        </div>
        <div style={S.body}>
          {task === 'blue-mutual' && <BlueMutualTask key={accountKey} wsId={workspaceId} />}
          {task === 'relation' && <RelationTask key={accountKey} wsId={workspaceId} />}
        </div>
      </div>
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary, #111)', color: 'var(--text-primary, #ddd)' },
  header: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border-color, #333)' },
  title: { fontSize: 14, fontWeight: 600 },
  iconBtn: { background: 'transparent', border: '1px solid var(--border-color, #444)', borderRadius: 4, color: 'var(--text-secondary, #aaa)', cursor: 'pointer', padding: '2px 8px' },
  split: { display: 'flex', flex: 1, minHeight: 0 },
  list: { width: 130, borderRight: '1px solid var(--border-color, #333)', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 },
  item: { textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--text-secondary, #aaa)', cursor: 'pointer', padding: '6px 8px', borderRadius: 4, fontSize: 13 },
  itemActive: { background: 'var(--accent-bg, #2d4a6b)', color: 'var(--text-primary, #ddd)' },
  muted: { fontSize: 11, color: 'var(--text-muted, #777)', padding: '4px 8px' },
  body: { flex: 1, overflow: 'auto', padding: 12 },
};
