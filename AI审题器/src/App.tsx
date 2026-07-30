import { AnalyzerPage } from "./pages/AnalyzerPage";
import { ConfigPage } from "./pages/ConfigPage";

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return path === "/config" ? <ConfigPage /> : <AnalyzerPage />;
}
