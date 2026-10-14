import React from 'react';
import { createRoot } from 'react-dom/client';
import { AccountMenuButtonMock } from '@seams/wallet/react/profile';
import '@seams/wallet/react/styles';

const root = document.getElementById('root');
if (!root) throw new Error('Account menu preview requires a root element.');
const backdrop =
  new URLSearchParams(location.search).get('backdrop') === 'none' ? 'none' : 'dimmed';
createRoot(root).render(
  <AccountMenuButtonMock backdrop={backdrop} style={{ width: 380, maxWidth: '100%' }} />,
);
