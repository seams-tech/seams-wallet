import { Component, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const modulePath = '/_test-sdk/esm/react/components/AccountMenuButton/index.js';
const { AccountMenuButtonMock } = (await import(
  modulePath
)) as typeof import('../../../packages/wallet/src/react/components/AccountMenuButton');
const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet';
stylesheet.href = '/_test-sdk/esm/react/styles/styles.css';
document.head.append(stylesheet);

type ExampleProps = { presentation: 'dropdown' | 'modal'; theme: 'light' | 'dark' };
type ExampleState = { open: boolean; changes: boolean[] };

class SettingsExample extends Component<ExampleProps, ExampleState> {
  state: ExampleState = { open: false, changes: [] };

  componentDidMount(): void {
    Reflect.set(window, 'setSettingsOpen', this.setOpen);
  }
  componentWillUnmount(): void {
    Reflect.deleteProperty(window, 'setSettingsOpen');
  }
  private setOpen = (open: boolean): void => {
    if (open) Reflect.set(window, 'settingsPreviousFocus', document.activeElement);
    this.setState({ open });
  };
  private open = (): void => {
    this.setOpen(true);
  };
  private onOpenChange = (open: boolean): void => {
    this.setState({ open, changes: [...this.state.changes, open] });
  };

  render() {
    return (
      <main style={{ minHeight: 1800, padding: 24 }}>
        <button type="button" onClick={this.open}>
          App wallet settings
        </button>
        <output data-testid="open-changes">{JSON.stringify(this.state.changes)}</output>
        {this.props.presentation === 'modal' ? (
          <AccountMenuButtonMock
            presentation="modal"
            isMenuOpen={this.state.open}
            onMenuOpenChange={this.onOpenChange}
            theme={this.props.theme}
          />
        ) : (
          <AccountMenuButtonMock defaultOpen={false} theme={this.props.theme} />
        )}
        <button type="button">Background action</button>
      </main>
    );
  }
}

const params = new URLSearchParams(location.search);
const root = document.createElement('div');
document.body.append(root);
createRoot(root).render(
  <StrictMode>
    <SettingsExample
      presentation={params.get('presentation') === 'dropdown' ? 'dropdown' : 'modal'}
      theme={params.get('theme') === 'dark' ? 'dark' : 'light'}
    />
  </StrictMode>,
);
