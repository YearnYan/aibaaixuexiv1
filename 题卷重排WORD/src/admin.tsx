import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./admin.css";
import AiConfigPage from "./AiConfigPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AiConfigPage />
  </StrictMode>,
);
