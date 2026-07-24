import { registerView } from '@slot/view-type-registry/register-view';
import { XInboxView } from './XInboxView';

registerView({
  id: 'x-inbox-view',
  install: ['x-extraction'],
  component: XInboxView,
});
