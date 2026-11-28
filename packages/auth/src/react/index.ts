import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthSessionSummary, SeamsAuth } from '../client/index';

// React bindings for Seams Auth: a provider for the object of `createSeamsAuth`, and one hook
// with the signed-in user.

export type SeamsAuthState = {
  readonly auth: SeamsAuth;
  /** `loading` until the first read of the session ends. */
  readonly status: 'loading' | 'signed_in' | 'signed_out';
  readonly session: AuthSessionSummary | null;
  /** Opens the auth menu. It gives the login token, or null when the user closed the menu. */
  signIn(): Promise<string | null>;
  signOut(): Promise<void>;
};

const AuthContext = createContext<SeamsAuthState | null>(null);

export function SeamsAuthProvider(props: {
  readonly auth: SeamsAuth;
  readonly children?: ReactNode;
}): ReactNode {
  const { auth } = props;
  const [session, setSession] = useState<AuthSessionSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setSession(await auth.session());
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    void refresh();
    return auth.onSessionChange(() => void refresh());
  }, [auth, refresh]);

  const state = useMemo<SeamsAuthState>(
    () => ({
      auth,
      status: loading ? 'loading' : session ? 'signed_in' : 'signed_out',
      session,
      async signIn() {
        const token = await auth.signIn();
        await refresh();
        return token;
      },
      async signOut() {
        await auth.signOut();
        await refresh();
      },
    }),
    [auth, loading, session, refresh],
  );
  return createElement(AuthContext.Provider, { value: state }, props.children);
}

export function useSeamsAuth(): SeamsAuthState {
  const state = useContext(AuthContext);
  if (!state) throw new Error('useSeamsAuth needs a SeamsAuthProvider above it');
  return state;
}
