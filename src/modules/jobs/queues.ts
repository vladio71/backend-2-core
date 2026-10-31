// Що це: типи даних job-ів і канал подій. Одне місце, щоб API і воркер не розійшлися.
// Імена черг живуть у src/common/queues.ts (їх читає ще й metrics), тут лише реекспорт для зручності.
export { REPORTS_QUEUE, EVENTS_QUEUE } from '../../common/queues';

// Канал Redis pub/sub, у який воркер публікує зміни статусу звіту. API підписаний і роздає далі (SSE, WebSocket).
export const REPORT_EVENTS_CHANNEL = 'devhub:report-events';

export interface ReportJobData {
  reportId: string;
  userId: string;
  failRate: number;
  requestId: string;
  // W3C Trace Context запиту, який створив job: воркер продовжує той самий трейс (див. docs/tracing.md).
  // Порожні, коли трейсинг вимкнено.
  traceparent?: string;
  tracestate?: string;
}

export interface EventJobData {
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  requestId: string;
}

export interface ReportEvent {
  reportId: string;
  userId: string;
  status: 'queued' | 'active' | 'completed' | 'failed';
  progress: number;
  attempt: number;
  result?: Record<string, unknown>;
  error?: string;
  at: string;
}
