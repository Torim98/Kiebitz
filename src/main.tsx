import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LocaleProvider } from "./lib/i18n";
import { initAppearance } from "./lib/theme";
import "./index.css";

// Vor dem ersten Bild: Das Startskript in index.html hat den letzten Stand
// bereits gesetzt, hier übernimmt die Steuerung (Einstellungen, Systemvorgabe,
// Uhrzeit, Plus-Status).
initAppearance();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocaleProvider>
      {/* Angedeutetes Schachbrett hinter der ganzen App · siehe index.css.
          Es steht neben der App, nicht in ihr, damit beide Shells (Desktop
          und Mobile) denselben Hintergrund haben. */}
      <div className="chess-backdrop" aria-hidden="true" />
      <App />
    </LocaleProvider>
  </React.StrictMode>
);
