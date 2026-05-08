/**
 * L5 自我诊断
 *
 * 见 views/note/DESIGN.md v0.2.2 § 11.7。
 *
 * Wave 5 改造:capability 字段访问改走 getCapabilityApi(诊断路径软取,
 * capability 没注册时退化为 0 不破坏诊断输出 — 业务规范见 capability-registry README)。
 */

import { getCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { SelectionDiagnosticApi } from '@capabilities/selection/types';
import type { ClipboardDiagnosticApi } from '@capabilities/clipboard/types';
import type { UndoRedoDiagnosticApi } from '@capabilities/undo-redo/types';
import type { DndDiagnosticApi } from '@capabilities/drag-and-drop/types';
import type { InsertionDiagnosticApi } from '@capabilities/insertion/types';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import { noteStore } from './note/note-store';

export function reportL5Alive(): void {
  const selection = getCapabilityApi<SelectionDiagnosticApi>('selection');
  const clipboard = getCapabilityApi<ClipboardDiagnosticApi>('clipboard');
  const undoRedo = getCapabilityApi<UndoRedoDiagnosticApi>('undo-redo');
  const dnd = getCapabilityApi<DndDiagnosticApi>('drag-and-drop');
  const insertion = getCapabilityApi<InsertionDiagnosticApi>('insertion');
  // text-editing 诊断:driver instance 计数(W5 C4 改走 capability,driver 不可见)
  const textEditing = getCapabilityApi<TextEditingApi>('text-editing');

  window.electronAPI?.reportAlive({
    layer: 'L5',
    details: {
      'global-notes': noteStore.count,
      'driver-instances': textEditing?.instanceRegistry.count ?? 0,
      'selection-sources': selection?.sourceCount ?? 0,
      'clipboard-serializers': clipboard?.serializerCount ?? 0,
      'undo-scopes': undoRedo?.scopeCount ?? 0,
      'dnd-targets': dnd?.dropTargetCount ?? 0,
      'insertion-safeguards': insertion?.safeguardCount ?? 0,
    },
  });
}
