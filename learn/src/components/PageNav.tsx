// Низ кожної сторінки: "Попередня / Наступна" за порядком у PAGES. Один компонент, підключений у Layout,
// тому сторінки про нього не знають: змінив порядок у pages/index.ts, змінилась і навігація.
import { Link, useLocation } from 'react-router-dom';
import { PAGES } from '../pages';

export function PageNav() {
  const { pathname } = useLocation();
  const index = PAGES.findIndex((page) => page.path === pathname);
  if (index === -1) return null;
  const prev = index > 0 ? PAGES[index - 1] : null;
  const next = index < PAGES.length - 1 ? PAGES[index + 1] : null;
  return (
    <nav className="page-nav" aria-label="Попередня і наступна тема" data-testid="page-nav">
      {prev ? (
        <Link to={prev.path} className="page-nav-link" data-testid="nav-prev">
          <span className="muted small">Попередня</span>
          <span>
            {String(index).padStart(2, '0')} {prev.title}
          </span>
        </Link>
      ) : (
        <span />
      )}
      <span className="muted small page-nav-pos">
        {index + 1} / {PAGES.length}
      </span>
      {next ? (
        <Link to={next.path} className="page-nav-link page-nav-next" data-testid="nav-next">
          <span className="muted small">Наступна</span>
          <span>
            {String(index + 2).padStart(2, '0')} {next.title}
          </span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
