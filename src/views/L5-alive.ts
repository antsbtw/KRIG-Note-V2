/**
 * L5 自我诊断
 *
 * 见 views/note/DESIGN.md v0.2.2 § 11.7。
 */

import { selection } from '@capabilities/selection';
import { clipboard } from '@capabilities/clipboard';
import { undoRedo } from '@capabilities/undo-redo';
import { dnd } from '@capabilities/drag-and-drop';
import { insertion } from '@capabilities/insertion';
import { instanceRegistry } from '@drivers/text-editing-driver/instance-registry';
import { noteStore } from './note/note-store';

export function reportL5Alive(): void {
  window.electronAPI?.reportAlive({
    layer: 'L5',
    details: {
      'global-notes': noteStore.count,
      'driver-instances': instanceRegistry.count,
      'selection-sources': selection.sourceCount,
      'clipboard-serializers': clipboard.serializerCount,
      'undo-scopes': undoRedo.scopeCount,
      'dnd-targets': dnd.dropTargetCount,
      'insertion-safeguards': insertion.safeguardCount,
    },
  });
}
