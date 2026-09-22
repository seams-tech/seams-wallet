import { WalletSettingsPage } from '@seams/wallet/react';
import { WalletConsoleLite } from './WalletConsoleLite';
import { TransactionPreviews } from './TransactionPreviews';
import './console-shell.css';

const pages = [
  { path: '/wallet', title: 'Wallet' },
  { path: '/transaction-previews', title: 'Transaction previews' },
  { path: '/recovery', title: 'Server share recovery' },
  { path: '/wallet-settings', title: 'Wallet settings' },
];

function PageContent({ path }: { path: string }) {
  switch (path) {
    case '/transaction-previews':
      return <TransactionPreviews />;
    case '/wallet':
      return <WalletConsoleLite page="wallet" />;
    case '/recovery':
      return <WalletConsoleLite page="recovery" />;
    case '/wallet-settings':
      return (
        <WalletConsoleLite page="wallet">
          <WalletSettingsPage />
        </WalletConsoleLite>
      );
    default:
      return (
        <div className="console-page-heading">
          <h1>Page not found</h1>
          <a href="/wallet">Return to wallet</a>
        </div>
      );
  }
}

export function ConsoleApp() {
  const path = window.location.pathname.replace(/\/$/, '') || '/wallet';
  const current = pages.find((page) => page.path === path);
  document.title = `${current?.title ?? 'Page not found'} · Seams Wallet`;
  return (
    <div className="console-app">
      <a className="console-skip" href="#console-content">
        Skip to content
      </a>
      <header className="console-navbar">
        <a className="console-brand" href="/">
          seams<span>Wallet playground</span>
        </a>
        <span className="console-environment">Local development</span>
      </header>
      <aside className="console-sidebar">
        <nav aria-label="Main navigation">
          {pages.map((page) => (
            <a
              key={page.path}
              href={page.path}
              aria-current={page.path === path ? 'page' : undefined}
            >
              {page.title}
            </a>
          ))}
        </nav>
        <p className="console-sidebar-note">Build and test your Wallet experience.</p>
      </aside>
      <main className="console-content" id="console-content" tabIndex={-1}>
        <div className="console-breadcrumb">
          Wallet playground <span aria-hidden="true">/</span>{' '}
          <strong>{current?.title ?? 'Page not found'}</strong>
        </div>
        <PageContent path={path} />
      </main>
    </div>
  );
}
