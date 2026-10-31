// Схема проєкту: docs/architecture.excalidraw, показана через Excalidraw у режимі перегляду.
// Файл копіюється у public/ скриптом prebuild (package.json), тому джерело одне: docs/.
import { lazy, Suspense, useEffect, useState } from 'react';
import { PageTitle } from '../components/common';

const SchemeCanvas = lazy(() => import('../components/SchemeCanvas'));

interface SceneFile {
  elements: Record<string, unknown>[];
  appState?: { viewBackgroundColor?: string };
}

type SceneState = { status: 'loading' } | { status: 'ready'; scene: SceneFile } | { status: 'error'; message: string };

export function SchemePage() {
  const [state, setState] = useState<SceneState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch('/architecture.excalidraw')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const scene = (await res.json()) as SceneFile;
        if (!Array.isArray(scene.elements)) throw new Error('у файлі немає elements');
        if (!cancelled) setState({ status: 'ready', scene });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageTitle title="Схема проєкту" sub="Один малюнок перед усіма темами. Колесо: зум, перетягування: пан. Кожен блок має свою сторінку в меню зліва." />

      <div className="scheme-canvas scheme-canvas-full" data-testid="scheme-canvas">
        {state.status === 'loading' && <div className="muted small scheme-placeholder">завантажую схему...</div>}
        {state.status === 'error' && (
          <div className="note err scheme-placeholder" data-testid="scheme-error">
            Не вдалося завантажити /architecture.excalidraw: {state.message}. Запусти <code>npm run build</code> або <code>npm run dev</code> ще раз: скрипт
            prebuild копіює файл з <code>docs/</code> у <code>public/</code>.
          </div>
        )}
        {state.status === 'ready' && (
          <Suspense fallback={<div className="muted small scheme-placeholder">завантажую Excalidraw...</div>}>
            <SchemeCanvas elements={state.scene.elements} viewBackgroundColor={state.scene.appState?.viewBackgroundColor} />
          </Suspense>
        )}
      </div>

      <details className="scheme-details">
        <summary>Як читати схему</summary>
        <p>
          Браузер ходить у nginx, nginx по черзі віддає запити двом API, API пишуть у PostgreSQL і Redis, довгі задачі кладуть у чергу, а окремий воркер їх виконує.
          Порядок тем у меню іде від того, без чого запит не обробиться, до того, що потрібно під навантаженням.
        </p>
        <p className="muted small">
          Файл лежить у <code>docs/architecture.excalidraw</code>, редагувати можна на{' '}
          <a href="https://excalidraw.com" target="_blank" rel="noreferrer">
            excalidraw.com
          </a>
          .
        </p>
      </details>
    </>
  );
}
