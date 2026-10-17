import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ExplainProvider } from './components/Explain';
import { Shell } from './components/Shell';
import { About } from './screens/About';
import { ConversationScreen } from './screens/ConversationScreen';
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
              <Route path="/" element={<NewEstimate />} />
              <Route path="/estimate/:id" element={<ConversationScreen />} />
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
