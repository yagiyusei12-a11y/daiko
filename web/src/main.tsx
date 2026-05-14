import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth";
import App from "./App";
import "./index.css";

// #region agent log
const __agentLog = (hypothesisId: string, location: string, message: string, data: Record<string, unknown>) => {
  fetch("http://127.0.0.1:7838/ingest/f37b4987-1b77-43d9-b411-9367fa4c8525", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "57fb34" },
    body: JSON.stringify({
      sessionId: "57fb34",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
      runId: "post-fix-verify",
    }),
  }).catch(() => {});
};
// #endregion

window.addEventListener(
  "error",
  (ev) => {
    // #region agent log
    __agentLog("H1", "main.tsx:window.error", "uncaught", {
      message: ev.message,
      filename: ev.filename,
      lineno: ev.lineno,
      colno: ev.colno,
    });
    // #endregion
  },
  true,
);
window.addEventListener("unhandledrejection", (ev) => {
  // #region agent log
  __agentLog("H4", "main.tsx:unhandledrejection", "unhandled", {
    reason: ev.reason instanceof Error ? ev.reason.message : String(ev.reason),
  });
  // #endregion
});

const rootEl = document.getElementById("root");
// #region agent log
__agentLog("H2", "main.tsx:root", "bootstrap", { hasRoot: Boolean(rootEl) });
// #endregion

if (!rootEl) {
  // #region agent log
  __agentLog("H2", "main.tsx:root", "missing #root", {});
  // #endregion
} else {
  try {
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <BrowserRouter basename="/app">
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </React.StrictMode>,
    );
    // #region agent log
    __agentLog("H1", "main.tsx:render", "createRoot.render returned", {});
    // #endregion
  } catch (e) {
    // #region agent log
    __agentLog("H1", "main.tsx:catch", "sync render error", {
      name: e instanceof Error ? e.name : "unknown",
      message: e instanceof Error ? e.message : String(e),
    });
    // #endregion
    throw e;
  }
}
