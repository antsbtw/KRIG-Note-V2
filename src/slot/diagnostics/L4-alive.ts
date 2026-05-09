/**
 * L4 自我诊断
 */

import { commandRegistry } from '../command-registry/command-registry';
import { capabilityRegistry } from '../capability-registry/capability-registry';
import { viewTypeRegistry } from '../view-type-registry/view-type-registry';
import { contextMenuRegistry } from '../interaction-registries/context-menu-registry/context-menu-registry';
import { slashRegistry } from '../interaction-registries/slash-registry/slash-registry';
import { handleRegistry } from '../interaction-registries/handle-registry/handle-registry';
import { floatingToolbarRegistry } from '../interaction-registries/floating-toolbar-registry/floating-toolbar-registry';
import { overlayRegistry } from '../interaction-registries/overlay-registry/overlay-registry';
import { popupRegistry } from '../interaction-registries/popup-registry/popup-registry';
import { helpPanelRegistry } from '../interaction-registries/help-panel-registry/help-panel-registry';
import { navSideRegistry } from '../nav-side-registry/nav-side-registry';
import { toolbarRegistry } from '../toolbar-registry/toolbar-registry';
import { keymapRegistry } from '../keymap-registry/keymap-registry';

export function reportL4Alive(): void {
  window.electronAPI?.reportAlive({
    layer: 'L4',
    details: {
      commands: commandRegistry.count,
      capabilities: capabilityRegistry.count,
      views: viewTypeRegistry.count,
      contextMenu: contextMenuRegistry.count,
      slash: slashRegistry.count,
      handle: handleRegistry.count,
      floatingToolbar: floatingToolbarRegistry.count,
      overlay: overlayRegistry.count,
      popup: popupRegistry.count,
      helpPanel: helpPanelRegistry.count,
      navSide: navSideRegistry.count,
      toolbar: toolbarRegistry.count,
      keymap: keymapRegistry.count,
    },
  });
}
