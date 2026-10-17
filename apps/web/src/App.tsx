import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { ExplainProvider } from './components/Explain';
import { Layout } from './components/Layout';
import { ActiveEstimateProvider, StoreProvider, useStore } from './lib/store';
import { About } from './pages/About';
import { EstimatePage } from './pages/Estimate';
import { Intake } from './pages/Intake';
import { ScopePage } from './pages/Scope';
import { TeamPage } from './pages/Team';
import { Spinner } from './components/ui';

// The chart library is only needed on Learning, so it loads on first visit.
const Learning = lazy(() => import('./pages/Learning').then((m) => ({ default: m.Learning })));

/** Pages that show one brief take it from the URL, so deep links work. */
function WithBrief({ children }: { children: ReactNode }) {
  const { briefId } = useParams();
  const { workspaces, activeId, setActive } = useStore();
  const known = briefId && workspaces[briefId];
  useEffect(() => {
    if (known && briefId !== activeId) setActive(briefId);
  }, [known, briefId, activeId, setActive]);
  if (!known) return <Navigate to="/" replace />;
  if (briefId !== activeId) return null;
  return <>{children}</>;
}

export function App() {
  return (
    <HashRouter>
      <StoreProvider>
        <ActiveEstimateProvider>
          <ExplainProvider>
            <Layout>
              <Routes>
                <Route path="/" element={<Intake />} />
                <Route path="/scope/:briefId" element={<WithBrief><ScopePage /></WithBrief>} />
                <Route path="/estimate/:briefId" element={<WithBrief><EstimatePage /></WithBrief>} />
                <Route path="/team/:briefId" element={<WithBrief><TeamPage /></WithBrief>} />
                <Route path="/learning" element={<Suspense fallback={<Spinner label="Loading history" />}><Learning /></Suspense>} />
                <Route path="/about" element={<About />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </ExplainProvider>
        </ActiveEstimateProvider>
      </StoreProvider>
    </HashRouter>
  );
}
