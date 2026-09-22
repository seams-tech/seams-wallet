import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@seams/wallet/react/styles';
import { ConsoleApp } from './ConsoleApp';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <ConsoleApp />
  </StrictMode>,
);
