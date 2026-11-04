import { useEffect, useState } from 'react';
import { RouterProvider, useRouter } from './store/router';
import { ProjectProvider } from './store/projects';
import HomePage from './pages/HomePage';
import CreatePage from './pages/CreatePage';
import WorkspacePage from './pages/WorkspacePage';
import ResearchPage from './pages/ResearchPage';
import ImportModal from './components/ImportModal';
import ModelSettingsModal from './components/ModelSettingsModal';
import { desktop } from './lib/desktop';
import './styles/tokens.css';
import './styles/app.css';

function Screen() {
  const { route, push } = useRouter();
  const [importOpen, setImportOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [researchTab, setResearchTab] = useState<'research' | 'verify'>('research');

  // 原生菜单 / 应用菜单 → 界面动作
  useEffect(() => {
    if (!desktop) return;
    return desktop.onMenu(({ action, payload }) => {
      if (action === 'create') push({ name: 'create' });
      else if (action === 'home') push({ name: 'home' });
      else if (action === 'import') {
        push({ name: 'home' });
        setImportOpen(true);
      } else if (action === 'view') {
        window.dispatchEvent(new CustomEvent('ksb:view', { detail: payload }));
      } else if (action === 'model') {
        setModelOpen(true);
      } else if (action === 'research') {
        setResearchTab('research');
        push({ name: 'research' });
      } else if (action === 'verify') {
        setResearchTab('verify');
        push({ name: 'research' });
      }
    });
  }, [push]);

  return (
    <>
      {route.name === 'create' ? (
        <CreatePage />
      ) : route.name === 'research' ? (
        <ResearchPage tab={researchTab} />
      ) : route.name === 'workspace' ? (
        <WorkspacePage projectId={route.projectId} />
      ) : (
        <HomePage onOpenModelSettings={() => setModelOpen(true)} />
      )}

      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}
      {modelOpen && <ModelSettingsModal onClose={() => setModelOpen(false)} />}
    </>
  );
}

export default function App() {
  return (
    <ProjectProvider>
      <RouterProvider>
        <Screen />
      </RouterProvider>
    </ProjectProvider>
  );
}
