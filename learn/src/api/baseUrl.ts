// Базова адреса API: VITE_API_URL (типово nginx на :8080), запасний варіант :3000 (API без Docker).
// Користувач може змінити її в шапці; значення зберігається в localStorage.
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'devhub.learn.apiBaseUrl';
export const DEFAULT_BASE_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8080';
export const FALLBACK_BASE_URL = 'http://localhost:3000';

export type ApiStatus = 'unknown' | 'checking' | 'ok' | 'down';

interface BaseUrlState {
  url: string;
  status: ApiStatus;
  instance: string | null;
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let state: BaseUrlState = { url: readStored() ?? DEFAULT_BASE_URL, status: 'unknown', instance: null };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getBaseUrl(): string {
  return state.url;
}

export function setBaseUrl(url: string): void {
  const clean = url.trim().replace(/\/+$/, '');
  state = { ...state, url: clean, status: 'unknown', instance: null };
  try {
    localStorage.setItem(STORAGE_KEY, clean);
  } catch {
    // localStorage може бути недоступний (приватний режим); тоді просто тримаємо в пам'яті
  }
  emit();
  void probe();
}

async function ping(url: string): Promise<{ ok: boolean; instance: string | null }> {
  try {
    const res = await fetch(`${url}/health`);
    const body = (await res.json()) as { instance?: string };
    return { ok: res.ok, instance: body.instance ?? null };
  } catch {
    return { ok: false, instance: null };
  }
}

let probePromise: Promise<void> | null = null;

// Перевіряє поточну адресу; якщо це типова адреса і вона не відповідає, пробує :3000.
export function probe(): Promise<void> {
  probePromise = runProbe();
  return probePromise;
}

// apiCall чекає на першу перевірку, щоб перший запит сторінки не пішов на адресу, яка ще не перевірена.
export function ensureProbed(): Promise<void> {
  if (!probePromise) probePromise = runProbe();
  return probePromise;
}

async function runProbe(): Promise<void> {
  state = { ...state, status: 'checking' };
  emit();
  const first = await ping(state.url);
  if (first.ok) {
    state = { ...state, status: 'ok', instance: first.instance };
    emit();
    return;
  }
  if (state.url === DEFAULT_BASE_URL && DEFAULT_BASE_URL !== FALLBACK_BASE_URL) {
    const second = await ping(FALLBACK_BASE_URL);
    if (second.ok) {
      state = { url: FALLBACK_BASE_URL, status: 'ok', instance: second.instance };
      emit();
      return;
    }
  }
  state = { ...state, status: 'down', instance: null };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBaseUrl(): BaseUrlState {
  return useSyncExternalStore(subscribe, () => state);
}
