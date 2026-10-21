import type { AppearanceConfigInput } from '@/core/types/seams';
import { normalizeWalletLocale, type WalletLocale } from '@/core/ui/locale';
import { walletText } from '@/core/ui/messages';
import { WalletText } from '@/react/context/WalletLocale';

const locale: WalletLocale = normalizeWalletLocale('ja-JP');
const appearance: AppearanceConfigInput = { locale };
walletText(locale, 'Create wallet with passkey');
WalletText({ message: 'Recovery codes' });
void appearance;

// @ts-expect-error Unsupported languages must pass through the boundary normalizer.
const unsupported: AppearanceConfigInput = { locale: 'fr' };
void unsupported;

// @ts-expect-error Every SDK message needs an entry with a Japanese translation.
walletText('ja', 'A message without a Japanese translation');

// @ts-expect-error Choose a catalogue message or application copy for one text node.
WalletText({ message: 'Accounts', copy: 'My accounts' });
