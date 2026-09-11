import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SeamsAuthMenu } from '@seams/wallet/react/seams-auth-menu';
import '@seams/wallet/react/styles';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <main>
      <h1>Wallet authentication</h1>
      <SeamsAuthMenu />
    </main>
  </StrictMode>,
);
