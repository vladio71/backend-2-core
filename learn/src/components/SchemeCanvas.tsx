// Excalidraw тільки для перегляду: зум і панорамування працюють, редагування ні. Тема за prefers-color-scheme.
// Підвантажується через React.lazy (див. SchemePage), бо бібліотека велика і потрібна лише на одній сторінці.
import { Excalidraw, restoreElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { useEffect, useMemo, useState } from 'react';

type SceneTheme = 'light' | 'dark';
// Що приймає restoreElements: сцена приходить з JSON-файлу, її форму перевіряє бібліотека, а не TypeScript.
type ImportedElements = Parameters<typeof restoreElements>[0];

interface DrawnBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SchemeCanvasProps {
  elements: readonly Record<string, unknown>[];
  viewBackgroundColor?: string;
}

export default function SchemeCanvas({ elements, viewBackgroundColor }: SchemeCanvasProps) {
  const [theme, setTheme] = useState<SceneTheme>('light');
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (): void => setTheme(query.matches ? 'dark' : 'light');
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  // restoreElements доповнює поля, яких у файлі може не бути (seed, roughness, розміри), щоб сцена точно намалювалась.
  const initialData = useMemo(
    () => ({
      elements: restoreElements(elements as unknown as ImportedElements, null),
      appState: viewBackgroundColor ? { viewBackgroundColor } : {},
    }),
    [elements, viewBackgroundColor],
  );

  // Вписуємо сцену за ШИРИНОЮ в'юпорту і стаємо в її лівий верхній кут: висока схема, вписана за висотою, нечитабельна.
  // Робимо це після першого кадру, бо в момент отримання api Excalidraw ще не виміряв контейнер (width = 0) і сам
  // виставляє початковий зум після монтування, перекриваючи наш.
  useEffect(() => {
    if (!api) return;
    const drawn = (initialData.elements as readonly DrawnBox[]).filter((el) => el.width > 0 || el.height > 0);
    if (drawn.length === 0) return;
    const minX = Math.min(...drawn.map((el) => el.x));
    const minY = Math.min(...drawn.map((el) => el.y));
    const maxX = Math.max(...drawn.map((el) => el.x + el.width));
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const fit = (): void => {
      const { width } = api.getAppState();
      if (!width && attempts < 20) {
        attempts += 1;
        timer = setTimeout(fit, 50);
        return;
      }
      // Зліва більший відступ, бо там кнопка меню Excalidraw, яку zen-режим не ховає.
      const marginLeft = 72;
      const margin = 24;
      const zoom = Math.min(1, Math.max(0.2, (width - marginLeft - margin) / (maxX - minX)));
      api.updateScene({
        appState: { zoom: { value: zoom as never }, scrollX: marginLeft / zoom - minX, scrollY: margin / zoom - minY },
      });
    };
    timer = setTimeout(fit, 0);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [api, initialData]);

  return <Excalidraw viewModeEnabled zenModeEnabled theme={theme} initialData={initialData} excalidrawAPI={(instance) => setApi(instance)} />;
}
