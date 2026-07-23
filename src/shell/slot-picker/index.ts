import { popupRegistry } from '@slot/interaction-registries/popup-registry/popup-registry';
import { SlotPickerPopup } from './SlotPickerPopup';

export const SLOT_PICKER_POPUP_ID = 'slot-picker.open-right-slot';

popupRegistry.register({
  id: SLOT_PICKER_POPUP_ID,
  Component: SlotPickerPopup,
  estimatedSize: { width: 260, height: 280 },
});

export { slotPickerContext } from './slot-picker-context';
