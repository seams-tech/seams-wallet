import { WalletSettingsPage } from '@seams/wallet/react';
import { WalletConsoleLite } from './WalletConsoleLite';
import { TransactionPreviews } from './TransactionPreviews';
import './console-shell.css';

const pages = [
  { path: '/', title: 'Overview' },
  { path: '/wallet', title: 'Wallet' },
  { path: '/transaction-previews', title: 'Transaction previews' },
  { path: '/recovery', title: 'Server share recovery' },
  { path: '/wallet-settings', title: 'Wallet settings' },
];

function Overview() {
  return (
    <>
      <header className="console-page-heading">
        <h1>Explore your Wallet integration</h1>
        <p>Preview the experience or connect a wallet to try the live flows.</p>
      </header>
      <div className="console-destinations">
        <a
          className="console-destination console-destination--featured"
          href="/transaction-previews"
        >
          <h2>Transaction previews</h2>
          <p>
            Try transfers and contract calls. Switch between modal and drawer reviews, passkeys and
            email codes.
          </p>
          <span className="console-destination-action">
            Explore previews <span aria-hidden="true">↗</span>
          </span>
        </a>
        <a className="console-destination" href="/wallet">
          <h2>Wallet playground</h2>
          <p>Create or unlock a wallet, inspect your session, and try signing with the real SDK.</p>
          <span className="console-destination-action">
            Open wallet <span aria-hidden="true">↗</span>
          </span>
        </a>
        <a className="console-destination" href="/recovery">
          <h2>Server share recovery</h2>
          <p>Walk through recovery operations for your local project environment.</p>
          <span className="console-destination-action">
            Open recovery <span aria-hidden="true">↗</span>
          </span>
        </a>
        <a className="console-destination" href="/wallet-settings">
          <h2>Wallet settings</h2>
          <p>Review wallet settings and manage authentication from one place.</p>
          <span className="console-destination-action">
            Open settings <span aria-hidden="true">↗</span>
          </span>
        </a>
      </div>
      <p className="console-footnote">
        Previews use simulated data. Wallet and recovery tools connect to your configured local
        project.
      </p>
    </>
  );
}

function PageContent({ path }: { path: string }) {
  switch (path) {
    case '/':
      return <Overview />;
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
          <a href="/">Return to overview</a>
        </div>
      );
  }
}

export function ConsoleApp() {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
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
