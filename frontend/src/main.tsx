import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";
import { initializeWorkspace } from "./stores/workspaceStore";
import "./styles/globals.css";

type BootErrorBoundaryState = {
  error: Error | null;
  componentStack: string;
};

class BootErrorBoundary extends React.Component<
  React.PropsWithChildren,
  BootErrorBoundaryState
> {
  state: BootErrorBoundaryState = { error: null, componentStack: "" };

  static getDerivedStateFromError(error: Error): BootErrorBoundaryState {
    return { error, componentStack: "" };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Arlecchino render failed:", error);
    this.setState({ componentStack: errorInfo.componentStack ?? "" });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-boot-error" role="alert">
          <div className="app-boot-error__title">Arlecchino failed to start</div>
          <div className="app-boot-error__message">
            {this.state.error.message}
          </div>
          {this.state.componentStack ? (
            <pre className="app-boot-error__stack">
              {this.state.componentStack}
            </pre>
          ) : null}
        </div>
      );
    }

    return this.props.children;
  }
}

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root element was not found.");
}

const root = createRoot(container);

root.render(
  <React.StrictMode>
    <BootErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </BootErrorBoundary>
  </React.StrictMode>,
);

void initializeWorkspace().catch((error) => {
  console.error("Arlecchino workspace initialization failed:", error);
  activateWorkspaceReadyFallback();
});

function activateWorkspaceReadyFallback() {
  import("./stores/workspaceStore")
    .then(({ useWorkspaceStore }) => {
      useWorkspaceStore.getState().setReady(true);
    })
    .catch((error) => {
      console.error("Arlecchino workspace fallback failed:", error);
    });
}
