// Каркас: шапка (адреса API, хто залогінений), лівий список тем, контент справа.
import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { probe, setBaseUrl, useBaseUrl } from '../api/baseUrl';
import { clearAuth, useAuth } from '../api/auth';
import { PAGES } from '../pages';
import { PageNav } from './PageNav';

export function Layout() {
  const base = useBaseUrl();
  const auth = useAuth();
  const [draft, setDraft] = useState(base.url);

  useEffect(() => {
    void probe();
  }, []);

  useEffect(() => {
    setDraft(base.url);
  }, [base.url]);

  const statusText: Record<string, string> = {
    unknown: 'не перевірено',
    checking: 'перевіряю',
    ok: `доступний${base.instance ? ` (${base.instance})` : ''}`,
    down: 'недоступний',
  };

  return (
    <div className="app">
      <header className="header">
        <NavLink to="/" className="brand">
          devhub / learn
        </NavLink>
        <span className="muted small">навчальний фронтенд до бекенду</span>
        <span className="spacer" />
        <form
          className="base-url"
          onSubmit={(e) => {
            e.preventDefault();
            setBaseUrl(draft);
          }}
        >
          <span className="muted small">API</span>
          <input className="mono" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Базова адреса API" />
          <button type="submit">Застосувати</button>
          <span className={`status-dot ${base.status}`} title={statusText[base.status]} />
          <span className="muted small" data-testid="api-status">
            {statusText[base.status]}
          </span>
        </form>
        <span className="muted small" data-testid="auth-status">
          {auth.user ? (
            <>
              {auth.user.email} ({auth.user.role}){' '}
              <button type="button" onClick={clearAuth} style={{ padding: '2px 8px', fontSize: 12 }}>
                вийти
              </button>
            </>
          ) : (
            'не залогінений'
          )}
        </span>
      </header>
      <nav className="sidebar">
        {PAGES.map((page, index) => (
          <NavLink key={page.path} to={page.path} end>
            <span className="num">{String(index + 1).padStart(2, '0')}</span>
            <span>{page.title}</span>
          </NavLink>
        ))}
      </nav>
      <main className="content">
        <Outlet />
        <PageNav />
      </main>
    </div>
  );
}
