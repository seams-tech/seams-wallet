import { lazy, Suspense, useState } from 'react';

async function loadAccountMenu() {
  const { AccountMenuButton } = await import('@seams/wallet/react');
  return { default: AccountMenuButton };
}

const LazyAccountMenu = lazy(loadAccountMenu);

export function AccountMenu() {
  const [visible, setVisible] = useState(false);
  return (
    <section data-testid="intended-account-menu">
      <button onClick={setVisible.bind(null, true)}>Show account menu</button>
      {visible && (
        <Suspense fallback={<span>Loading account menu…</span>}>
          <LazyAccountMenu nearAccountId={null} />
        </Suspense>
      )}
    </section>
  );
}
