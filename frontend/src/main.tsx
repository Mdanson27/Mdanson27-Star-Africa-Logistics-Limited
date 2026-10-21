import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { configureApiBaseUrl } from "@/lib/api";
import { loadRuntimeApiUrl } from "@/lib/runtimeConfig";
import "./index.css";

async function bootstrap() {
  const runtimeApiUrl = await loadRuntimeApiUrl();
  configureApiBaseUrl(runtimeApiUrl);

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
