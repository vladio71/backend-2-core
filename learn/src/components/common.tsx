// Дрібні спільні елементи: заголовок сторінки, блок пояснення, картка, нотатка про логін, графік стовпчиками.
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../api/auth';

export function PageTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <h1>{title}</h1>
      <div className="page-sub">{sub}</div>
    </>
  );
}

export function Explain({ children }: { children: ReactNode }) {
  return <section className="explain">{children}</section>;
}

// Рядок "Де в коді" наприкінці пояснення: шляхи і назви класів винесені з речень сюди, щоб текст читався без коду в кожному рядку.
// Елемент "шлях (примітка)": шлях іде у <code>, примітка у дужках звичайним текстом.
export function WhereInCode({ paths }: { paths: string[] }) {
  return (
    <p className="where">
      <span className="where-label">Де в коді:</span>{' '}
      {paths.map((item, index) => {
        const noteStart = item.indexOf(' (');
        const path = noteStart === -1 ? item : item.slice(0, noteStart);
        const note = noteStart === -1 ? '' : item.slice(noteStart);
        return (
          <span key={item}>
            {index > 0 && ', '}
            <code>{path}</code>
            {note}
          </span>
        );
      })}
    </p>
  );
}

// "Спробуй сам": короткий список кроків з підписом замість приглушеного речення.
export function TrySelf({ items }: { items: ReactNode[] }) {
  return (
    <div className="try">
      <span className="try-label">Спробуй сам</span>
      <ul>
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function Card({ title, children, testId }: { title?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="card" data-testid={testId}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

// Показує попередження, якщо для сторінки потрібен JWT, а користувач не залогінений.
export function NeedAuth({ children }: { children?: ReactNode }) {
  const auth = useAuth();
  if (auth.tokens) return null;
  return (
    <div className="note">
      Для цих запитів потрібен Bearer-токен. Залогінься на сторінці <Link to="/start">Старт</Link>. {children}
    </div>
  );
}

export interface BarItem {
  label: string;
  value: number;
  color?: string;
  title?: string;
}

// Простий графік стовпчиками на SVG. Без бібліотек: viewBox, прямокутники, підписи.
export function BarChart({ items, height = 160, valueLabel }: { items: BarItem[]; height?: number; valueLabel?: (v: number) => string }) {
  const width = 640;
  const padLeft = 36;
  const padBottom = 28;
  const padTop = 14;
  const max = Math.max(1, ...items.map((i) => i.value));
  const innerW = width - padLeft - 8;
  const innerH = height - padBottom - padTop;
  const step = innerW / Math.max(1, items.length);
  const barW = Math.max(2, Math.min(28, step * 0.7));
  const fmt = valueLabel ?? ((v: number) => String(v));
  const labelEvery = Math.ceil(items.length / 12);
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img">
      <line className="axis" x1={padLeft} y1={padTop + innerH} x2={width - 8} y2={padTop + innerH} />
      <line className="axis" x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + innerH} />
      <text x={2} y={padTop + 4}>
        {fmt(max)}
      </text>
      <text x={2} y={padTop + innerH}>
        0
      </text>
      {items.map((item, i) => {
        const h = (item.value / max) * innerH;
        const x = padLeft + i * step + (step - barW) / 2;
        return (
          <g key={`${item.label}-${i}`}>
            <title>{item.title ?? `${item.label}: ${fmt(item.value)}`}</title>
            <rect x={x} y={padTop + innerH - h} width={barW} height={h} fill={item.color ?? 'var(--bar-work)'} rx={2} />
            {i % labelEvery === 0 && (
              <text x={x + barW / 2} y={height - 10} textAnchor="middle">
                {item.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export interface LinePoint {
  label: string;
  value: number;
}

export interface LineSeries {
  name: string;
  color: string;
  points: LinePoint[];
}

// Кілька ліній на одному SVG (наприклад, накопичений підсумок по кожному автору). Усі серії мають однакові x (labels).
export function LineChart({ series, height = 170 }: { series: LineSeries[]; height?: number }) {
  const width = 640;
  const padLeft = 36;
  const padRight = 12;
  const padBottom = 28;
  const padTop = 14;
  const labels = series[0]?.points.map((p) => p.label) ?? [];
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value)));
  const innerW = width - padLeft - padRight;
  const innerH = height - padBottom - padTop;
  const stepX = labels.length > 1 ? innerW / (labels.length - 1) : innerW;
  const x = (i: number) => padLeft + i * stepX;
  const y = (v: number) => padTop + innerH - (v / max) * innerH;
  const labelEvery = Math.ceil(labels.length / 10);
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img">
        <line className="axis" x1={padLeft} y1={padTop + innerH} x2={width - padRight} y2={padTop + innerH} />
        <line className="axis" x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + innerH} />
        <text x={2} y={padTop + 4}>
          {max}
        </text>
        <text x={2} y={padTop + innerH}>
          0
        </text>
        {labels.map((label, i) =>
          i % labelEvery === 0 ? (
            <text key={label} x={x(i)} y={height - 10} textAnchor="middle">
              {label}
            </text>
          ) : null,
        )}
        {series.map((s) => (
          <g key={s.name}>
            <title>{s.name}</title>
            <polyline fill="none" stroke={s.color} strokeWidth={2} points={s.points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} />
            {s.points.map((p, i) => (
              <circle key={`${s.name}-${i}`} cx={x(i)} cy={y(p.value)} r={2.5} fill={s.color}>
                <title>{`${s.name}, ${p.label}: ${p.value}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color }} /> {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Progress({ value, status }: { value: number; status: string }) {
  const cls = status === 'completed' ? 'done' : status === 'failed' ? 'failed' : '';
  return (
    <div className={`progress ${cls}`}>
      <span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
