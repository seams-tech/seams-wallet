// The login session of this browser for one project environment. The secret stays in the
// storage of the account origin. The app page never gets it.

export type StoredSession = { readonly sessionToken: string; readonly accountId: string };

export type SessionStore = {
  read(): StoredSession | null;
  write(session: StoredSession): void;
  clear(): void;
};

export function createSessionStore(environmentId: string): SessionStore {
  const key = `seams-auth:v1:session:${environmentId}`;
  return {
    read() {
      try {
        const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
        if (typeof parsed !== 'object' || parsed === null) return null;
        const { sessionToken, accountId } = parsed as Record<string, unknown>;
        return typeof sessionToken === 'string' && typeof accountId === 'string'
          ? { sessionToken, accountId }
          : null;
      } catch {
        return null;
      }
    },
    write(session) {
      try {
        localStorage.setItem(key, JSON.stringify(session));
      } catch {
        // A browser with no storage keeps the session for this page only.
      }
    },
    clear() {
      try {
        localStorage.removeItem(key);
      } catch {
        // Nothing is stored.
      }
    },
  };
}
