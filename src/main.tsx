import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App() {
  return <div>Zain HQ</div>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
