// Що це: імена черг і типи даних job-ів. Одне місце, щоб API і воркер не розійшлися.
export const REPORTS_QUEUE = 'reports';
export const EVENTS_QUEUE = 'events';

// Канал Redis pub/sub, у який воркер публікує зміни статусу звіту. API підписаний і роздає далі (SSE, WebSocket).
export const REPORT_EVENTS_CHANNEL = 'devhub:report-events';

export interface ReportJobData {
  reportId: string;
  userId: string;
  failRate: number;
  requestId: string;
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
