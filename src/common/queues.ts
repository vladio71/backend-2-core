// Що це: імена черг BullMQ. Спільна константа, бо їх читають два модулі: jobs (кладе і обробляє job-и)
// і metrics (показує лічильники черг). Якби імена жили у jobs, metrics мусив би імпортувати jobs,
// а jobs уже інжектить MetricsService: вийшов би цикл між модулями.
export const REPORTS_QUEUE = 'reports';
export const EVENTS_QUEUE = 'events';
