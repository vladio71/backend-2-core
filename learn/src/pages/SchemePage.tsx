// Схема проєкту: docs/architecture.excalidraw, показана через Excalidraw у режимі перегляду.
// Файл копіюється у public/ скриптом prebuild (package.json), тому джерело одне: docs/.
import { lazy, Suspense, useEffect, useState } from 'react';
import { Card, Explain, PageTitle } from '../components/common';

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
      <PageTitle title="Схема проєкту" sub="З чого складається devhub і як частини зв'язані: один малюнок перед усіма темами" />
      <Explain>
        <p>
          Браузер (цей фронтенд) ходить у nginx, nginx по черзі віддає запити двом інстансам API, API пише у PostgreSQL і Redis, довгі задачі кладе у чергу, а
          окремий процес воркера їх виконує. Кожен блок на схемі має свою сторінку в меню зліва; порядок тем іде від того, без чого запит не обробиться взагалі
          (конфіг, помилки, база), до того, що потрібно під навантаженням (кеш, локи, черга, метрики).
        </p>
        <p className="muted small">Колесо миші або два пальці: зум. Перетягування: панорамування. Редагувати тут не можна.</p>
      </Explain>

      <Card>
        <div className="scheme-canvas" data-testid="scheme-canvas">
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
        <div className="muted small" style={{ marginTop: 10 }}>
          Той самий файл лежить у <code>docs/architecture.excalidraw</code>, відкрити для редагування можна на{' '}
          <a href="https://excalidraw.com" target="_blank" rel="noreferrer">
            excalidraw.com
          </a>
          .
        </div>
      </Card>
    </>
  );
}
