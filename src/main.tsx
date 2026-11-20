import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  return (
    <main className="welcome">
      <div className="brand-mark" aria-hidden="true">r</div>
      <p className="eyebrow">DAILY PLANNER</p>
      <h1>rakuCalendar</h1>
      <p className="welcome-copy">1日の予定を、時間の流れに沿って。</p>
      <div className="status-card">
        <span className="status-dot" aria-hidden="true" />
        <span>開発準備中</span>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
