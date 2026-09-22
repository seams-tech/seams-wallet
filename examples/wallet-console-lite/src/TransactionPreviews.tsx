import { useState } from 'react';

export function TransactionPreviews() {
  const [variant, setVariant] = useState<'modal' | 'drawer'>('modal');
  return (
    <section className="panel" aria-labelledby="transaction-previews-title">
      <h2 id="transaction-previews-title">Transaction previews</h2>
      <p>Explore ETH transfers, EVM calls, and NEAR calls with simulated data. No signing or network transactions.</p>
      <div className="actions" role="group" aria-label="Review presentation">
        <button type="button" aria-pressed={variant === 'modal'} onClick={setVariant.bind(null, 'modal')}>Modal review</button>
        <button type="button" aria-pressed={variant === 'drawer'} onClick={setVariant.bind(null, 'drawer')}>Drawer review</button>
      </div>
      <iframe
        title="Interactive transaction review and receipt examples"
        src={`/transaction-preview.html?variant=${variant}`}
        style={{ width: '100%', height: '850px', border: 0, borderRadius: '12px', marginTop: '16px' }}
      />
    </section>
  );
}
