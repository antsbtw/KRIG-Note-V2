/**
 * ThoughtCardEditor — text-editing.Host 薄包装(Phase 5.2 升级自 textarea)
 *
 * v0.5 §5.7 字面文件契约:
 *   - config:{ instanceId: 'thought::<id>', undoScope: 'thought-view.pm',
 *             viewId: 'thought-view', plugins: { titleGuard: false } }
 *   - debounce 1s 落库
 *
 * 数据兼容:与 Phase 2-4 textarea 落地的 PM 单段 doc 100% 结构兼容(都是 doc>paragraph),
 * 升级时无数据迁移。
 *
 * 卡片切换时 React key={thought.id} 在父级强制重建 Host instance,避免 stale state。
 */

import { useEffect, useMemo, useRef } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  TextEditingApi,
  DriverSerialized,
} from '@capabilities/text-editing/types';
import type { ThoughtCapabilityApi, ThoughtInfo } from '@capabilities/thought/types';

interface ThoughtCardEditorProps {
  thought: ThoughtInfo;
  readOnly?: boolean;
}

const DEBOUNCE_MS = 1000;

export function ThoughtCardEditor({ thought, readOnly }: ThoughtCardEditorProps) {
  const textEditing = useMemo(
    () => requireCapabilityApi<TextEditingApi>('text-editing'),
    [],
  );
  const thoughtApi = useMemo(
    () => requireCapabilityApi<ThoughtCapabilityApi>('thought'),
    [],
  );

  const saveTimer = useRef<number | null>(null);
  // last-saved doc JSON 比对(避 onChange 反射性触发 update 死循环)
  const lastSavedRef = useRef<string>(JSON.stringify(thought.doc));

  // 切换 thought 时同步 ref(本组件 key={thought.id} 时实际由 remount 处理,
  // 这里兜底 strict mode + 同 id 但 doc 字段被外部 update 的场景)
  useEffect(() => {
    lastSavedRef.current = JSON.stringify(thought.doc);
  }, [thought.id, thought.doc]);

  // 组件 unmount 时强制 flush 任何待落库的草稿(避免用户切卡片丢字)
  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, []);

  const handleChange = (newDoc: DriverSerialized): void => {
    const serialized = JSON.stringify(newDoc);
    if (serialized === lastSavedRef.current) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      lastSavedRef.current = serialized;
      void thoughtApi.updateThought(thought.id, { doc: newDoc });
    }, DEBOUNCE_MS);
  };

  const Host = textEditing.Host;
  return (
    <Host
      config={{
        instanceId: `thought::${thought.id}`,
        undoScope: 'thought-view.pm',
        viewId: 'thought-view',
        plugins: {
          titleGuard: false,
          blockHandle: false,    // 卡片内无需 block handle ⋮⋮
          noteLinkCommand: false, // 卡片不接 [[ note link 搜索
          vocabHighlight: false,  // 卡片不接词汇高亮
        },
      }}
      doc={thought.doc}
      onChange={handleChange}
      readOnly={readOnly}
      className="krig-thought-card-editor-host"
    />
  );
}
