// Токени: у пам'яті + localStorage, щоб переживали перезавантаження сторінки.
// Access JWT (15 хв) кладемо в Authorization: Bearer. Refresh тримаємо тільки для POST /auth/refresh.
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'devhub.learn.tokens';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthState {
  user: AuthUser | null;
  tokens: Tokens | null;
}

export interface JwtDecoded {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  exp: number | null;
}

function readStored(): AuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { user: null, tokens: null };
    return JSON.parse(raw) as AuthState;
  } catch {
    return { user: null, tokens: null };
  }
}

let state: AuthState = readStored();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    if (state.tokens) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // без localStorage токени живуть тільки до перезавантаження
  }
  for (const listener of listeners) listener();
}

export function setAuth(user: AuthUser | null, tokens: Tokens | null): void {
  state = { user: user ?? state.user, tokens };
  if (!tokens) state = { user: null, tokens: null };
  persist();
}

export function clearAuth(): void {
  state = { user: null, tokens: null };
  persist();
}

export function getAccessToken(): string | null {
  return state.tokens?.accessToken ?? null;
}

export function getAuthState(): AuthState {
  return state;
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

function decodeBase64Url(part: string): string {
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function decodeJwt(token: string): JwtDecoded | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(decodeBase64Url(parts[0])) as Record<string, unknown>;
    const payload = JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
    const exp = typeof payload.exp === 'number' ? payload.exp : null;
    return { header, payload, signature: parts[2], exp };
  } catch {
    return null;
  }
}

// Курсор пагінації і JWT кодуються однаково (base64url JSON); функція спільна.
export function decodeBase64UrlJson(value: string): unknown {
  try {
    return JSON.parse(decodeBase64Url(value));
  } catch {
    return null;
  }
}
