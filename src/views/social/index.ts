import { registerView } from '@slot/view-type-registry/register-view';
import { SocialView } from './SocialView';

registerView({
  id: 'social-view',
  install: ['x-extraction'],
  component: SocialView,
  navSideTab: { label: 'Social', icon: '💬', order: 6, navSideOnSwitch: 'collapse' },
});
