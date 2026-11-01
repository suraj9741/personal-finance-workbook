import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./theme/tokens.css";
import "./styles.css";
import { onOtherTabChange } from "./sync";
import { applyTheme, readTheme } from "./theme/theme";

// index.html set data-theme before paint; this also points the browser bar colour at it.
applyTheme(readTheme());

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});

// Another tab saved something: refetch what this tab shows (the rest refetches when opened).
onOtherTabChange(() => void queryClient.invalidateQueries());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
