import { createSeamsAuth, emailCode, passkey, voiceId } from '@seams/auth/client';

// A login-only app. It installs only `@seams/auth`: no wallet package, no worker and no WASM.
// The page gets a login token and sends it to its own backend.

type Config = { accountOrigin: string; publishableKey: string; environmentId: string };

const config = (await (await fetch('/api/config')).json()) as Config;
const auth = createSeamsAuth({ ...config, methods: [passkey(), emailCode(), voiceId()] });

function element<Kind extends HTMLElement>(id: string): Kind {
  return document.getElementById(id) as Kind;
}
const status = element<HTMLParagraphElement>('status');
const signIn = element<HTMLButtonElement>('sign-in');
const signOut = element<HTMLButtonElement>('sign-out');
const me = element<HTMLPreElement>('me');

/** Shows the user as the app's backend sees it, after it checked the login token. */
async function show(token: string | null): Promise<void> {
  signIn.hidden = token !== null;
  signOut.hidden = token === null;
  me.hidden = token === null;
  if (!token) {
    status.textContent = 'You are signed out.';
    return;
  }
  const answer = await fetch('/api/me', { headers: { authorization: `Bearer ${token}` } });
  status.textContent = answer.ok ? 'You are signed in.' : 'The backend refused the login token.';
  me.textContent = JSON.stringify(await answer.json(), null, 2);
}

signIn.addEventListener('click', async () => show(await auth.signIn()));
signOut.addEventListener('click', async () => {
  await auth.signOut();
  await show(null);
});
await show(await auth.token());
