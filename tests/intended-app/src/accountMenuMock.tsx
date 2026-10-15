import { createRoot } from 'react-dom/client';
import { AccountMenuButtonMock } from '@seams/wallet/react/profile';
import '@seams/wallet/react/styles';

const root = document.getElementById('root');
if (!root) throw new Error('Account menu preview requires a root element.');
createRoot(root).render(<AccountMenuButtonMock style={{ width: 420, maxWidth: '100%' }} />);
