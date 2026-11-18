import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AuthGate from "./AuthGate";
import "./styles.css";
import { applyTheme } from "./theme";

applyTheme(); // before first paint, so there is no flash of the wrong theme

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate />
  </StrictMode>,
);
