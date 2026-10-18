import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ExplainProvider } from './components/Explain';
import { Shell } from './components/Shell';
import { About } from './screens/About';
import { EstimateScreen } from './screens/EstimateScreen';
import { Home } from './screens/Home';
import { NewEstimate } from './screens/NewEstimate';
import { ProjectScreen } from './screens/ProjectScreen';
import { ConversationsProvider } from './state/conversations';

export function App() {
  return (
    <HashRouter>
      <ConversationsProvider>
        <ExplainProvider>
          <Shell>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/estimates" element={<Home />} />
              <Route path="/new" element={<NewEstimate />} />
              <Route path="/estimate/:id" element={<EstimateScreen />} />
              <Route path="/project/:id" element={<ProjectScreen />} />
              <Route path="/about" element={<About />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Shell>
        </ExplainProvider>
      </ConversationsProvider>
    </HashRouter>
  );
}
