import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { loadConfig } from "./config";
import { AuthProvider } from "./auth";
import App from "./App";
import "./styles.css";
import "./signup.css";
import "./scan.css";
import "./chat.css";

loadConfig()
  .then(() => createRoot(document.getElementById("root")!).render(
    <React.StrictMode><HashRouter><AuthProvider><App /></AuthProvider></HashRouter></React.StrictMode>))
  .catch((e) => { document.getElementById("root")!.innerHTML = `<pre style="padding:24px">Could not load /config.json: ${String(e)}</pre>`; });
