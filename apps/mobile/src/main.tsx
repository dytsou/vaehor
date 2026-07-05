import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "1.5rem" }}>
      <h1>Zee Index</h1>
      <p>Native shell placeholder — server setup ships in U2.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
