import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { useState } from 'react';
import { AccountMenuButtonMock } from '@seams/wallet/react/profile';
import '@seams/wallet/react/styles';

const root = document.getElementById('root');
if (!root) throw new Error('Account menu preview requires a root element.');
const params = new URLSearchParams(location.search);
function ModalPreview() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={setOpen.bind(null, true)}>
        App wallet settings
      </button>
      <AccountMenuButtonMock
        presentation="modal"
        isMenuOpen={open}
        onMenuOpenChange={setOpen}
        theme={params.get('theme') === 'dark' ? 'dark' : 'light'}
      />
    </>
  );
}
const menu = (
  <AccountMenuButtonMock
    theme={params.get('theme') === 'dark' ? 'dark' : 'light'}
    style={{ width: 420, maxWidth: '100%' }}
  />
);
const preview = params.get('presentation') === 'modal' ? <ModalPreview /> : menu;
createRoot(root).render(params.has('portal') ? createPortal(preview, document.body) : preview);
