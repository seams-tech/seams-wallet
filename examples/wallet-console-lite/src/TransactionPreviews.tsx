import { useRef, useState, type RefObject } from 'react';
import './transaction-previews.css';

function togglePreviewTheme(frame: RefObject<HTMLIFrameElement | null>) {
  frame.current?.contentDocument?.querySelector<HTMLButtonElement>('#theme')?.click();
}

export function TransactionPreviews() {
  const [variant, setVariant] = useState<'modal' | 'drawer'>('modal');
  const [authentication, setAuthentication] = useState<'passkey' | 'email'>('passkey');
  const frame = useRef<HTMLIFrameElement>(null);
  return (
    <section className="transaction-previews-page" aria-labelledby="transaction-previews-title">
      <header className="console-page-heading">
        <p className="eyebrow">No wallet required</p>
        <h1 id="transaction-previews-title">Transaction previews</h1>
        <p>Explore ETH transfers, EVM calls, and NEAR calls with simulated data. No signing or network transactions.</p>
      </header>
      <div className="transaction-preview-settings">
        <div className="transaction-preview-toggle" role="group" aria-label="Review presentation">
          <label>
            <input type="radio" name="review-presentation" checked={variant === 'modal'} onChange={setVariant.bind(null, 'modal')} />
            <span>Modal review</span>
          </label>
          <label>
            <input type="radio" name="review-presentation" checked={variant === 'drawer'} onChange={setVariant.bind(null, 'drawer')} />
            <span>Drawer review</span>
          </label>
        </div>
        <div className="transaction-preview-settings-row">
          <div className="transaction-preview-toggle" role="group" aria-label="Authentication">
            <label>
              <input type="radio" name="preview-authentication" checked={authentication === 'passkey'} onChange={setAuthentication.bind(null, 'passkey')} />
              <span>Passkey</span>
            </label>
            <label>
              <input type="radio" name="preview-authentication" checked={authentication === 'email'} onChange={setAuthentication.bind(null, 'email')} />
              <span>Email OTP</span>
            </label>
          </div>
          <button type="button" onClick={togglePreviewTheme.bind(null, frame)}>Toggle theme</button>
        </div>
      </div>
      <iframe
        ref={frame}
        height={850}
        title="Interactive transaction review and receipt examples"
        src={`/transaction-preview.html?variant=${variant}&auth=${authentication}`}
        className="transaction-preview-frame"
      />
    </section>
  );
}
