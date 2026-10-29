// Що це: AsyncLocalStorage, у якому живе requestId поточного запиту (або job-у у воркері).
// Чому: щоб логер друкував requestId на кожному рядку без передачі його через усі аргументи.
// Хто викликає: RequestIdMiddleware (HTTP) і процесори воркера (runWithRequestId).
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
