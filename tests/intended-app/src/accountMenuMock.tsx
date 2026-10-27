import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { AccountMenuButtonMock } from '@seams/wallet/react/profile';
import '@seams/wallet/react/styles';

const root = document.getElementById('root');
if (!root) throw new Error('Account menu preview requires a root element.');
const params = new URLSearchParams(location.search);
const menu = (
  <AccountMenuButtonMock
    theme={params.get('theme') === 'dark' ? 'dark' : 'light'}
    style={{ width: 420, maxWidth: '100%' }}
  />
);
createRoot(root).render(params.has('portal') ? createPortal(menu, document.body) : menu);
