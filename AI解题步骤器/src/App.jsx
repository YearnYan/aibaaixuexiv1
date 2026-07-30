import ConfigPage from './pages/ConfigPage.jsx';
import SolutionPage from './pages/SolutionPage.jsx';

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return path === '/config' ? <ConfigPage /> : <SolutionPage />;
}
