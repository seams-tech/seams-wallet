import { Component } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountMenuButtonMock } from '@seams/wallet/react/profile';
import '@seams/wallet/react/styles';
import './settingsDrawer.css';

type PreviewState = {
  theme: 'light' | 'dark';
  open: boolean;
};

function initialState(): PreviewState {
  const query = new URLSearchParams(location.search);
  return {
    theme: query.get('theme') === 'dark' ? 'dark' : 'light',
    open: query.get('open') !== '0',
  };
}

class SettingsDrawerPreview extends Component<Record<string, never>, PreviewState> {
  state = initialState();

  componentDidMount(): void {
    this.syncDocument();
  }

  componentDidUpdate(): void {
    this.syncDocument();
  }

  private syncDocument(): void {
    document.body.dataset.previewTheme = this.state.theme;
  }

  private open = (): void => {
    this.setState({ open: true });
  };

  private onOpenChange = (open: boolean): void => {
    this.setState({ open });
  };

  private setTheme(theme: PreviewState['theme']): void {
    this.setState({ theme });
  }

  render() {
    return (
      <>
        <header className="drawer-demo-header">
          <a className="drawer-demo-brand" href="./settings-drawer.html">
            seams<span>Wallet</span>
          </a>
          <div className="drawer-demo-controls">
            <div className="drawer-demo-themes" aria-label="Preview theme">
              <button
                type="button"
                aria-pressed={this.state.theme === 'light'}
                onClick={this.setTheme.bind(this, 'light')}
              >
                Light
              </button>
              <button
                type="button"
                aria-pressed={this.state.theme === 'dark'}
                onClick={this.setTheme.bind(this, 'dark')}
              >
                Dark
              </button>
            </div>
            <button className="drawer-demo-settings" type="button" onClick={this.open}>
              <span className="drawer-demo-avatar" aria-hidden="true">
                A
              </span>
              Wallet settings
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <path d="m9 5 7 7-7 7" />
              </svg>
            </button>
          </div>
        </header>

        <main className="drawer-demo-main">
          <div className="drawer-demo-intro">
            <span className="drawer-demo-eyebrow">Interactive preview</span>
            <h1>
              Your wallet.
              <br />A little more room.
            </h1>
            <p>
              Settings open alongside your app. Your accounts, security, and preferences stay
              together.
            </p>
            <button className="drawer-demo-open" type="button" onClick={this.open}>
              Open settings <span aria-hidden="true">↗</span>
            </button>
          </div>

          <section className="drawer-demo-wallet" aria-label="Sample wallet">
            <div className="drawer-demo-wallet-heading">
              <div>
                <span className="drawer-demo-eyebrow">Sample wallet</span>
                <h2>alex.near</h2>
              </div>
              <span className="drawer-demo-connected">
                <i /> Connected
              </span>
            </div>
            <div className="drawer-demo-summary">
              <div>
                <span>Accounts</span>
                <strong>2</strong>
                <small>NEAR · Base</small>
              </div>
              <div>
                <span>Devices</span>
                <strong>3</strong>
                <small>One wallet, everywhere</small>
              </div>
            </div>
            <div className="drawer-demo-activity">
              <h3>Recent activity</h3>
              <div>
                <span className="drawer-demo-activity-icon">↗</span>
                <span>
                  <strong>Message signed</strong>
                  <small>NEAR · Today, 10:24</small>
                </span>
                <span>Complete</span>
              </div>
              <div>
                <span className="drawer-demo-activity-icon">✓</span>
                <span>
                  <strong>Passkey added</strong>
                  <small>MacBook Pro · Yesterday</small>
                </span>
                <span>Complete</span>
              </div>
            </div>
          </section>
          <p className="drawer-demo-caption">
            Drawer concept · Desktop side panel / mobile bottom sheet
          </p>
        </main>

        <AccountMenuButtonMock
          presentation="drawer"
          isMenuOpen={this.state.open}
          onMenuOpenChange={this.onOpenChange}
          theme={this.state.theme}
          walletId="alex.near"
        />
      </>
    );
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Settings drawer preview requires a root element');
const preview = createRoot(root);
preview.render(<SettingsDrawerPreview />);

function disposePreview(): void {
  preview.unmount();
}

import.meta.hot?.dispose(disposePreview);
