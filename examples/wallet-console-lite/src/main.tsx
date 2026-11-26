import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@seams/mpc-wallet/styles.css';
import { ConsoleApp } from './ConsoleApp';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <ConsoleApp />
  </StrictMode>,
);
