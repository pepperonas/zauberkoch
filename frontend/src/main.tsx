import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import { router } from './App';
import { SnackbarProvider } from './components/ui/Snackbar';
import { isNativeShell } from './native/nativeRules';
import { AppProvider } from './state/app';
import './styles/tokens.css';
import './styles/base.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

// react-router owns scroll restoration (via <ScrollRestoration/> in the shell),
// coordinated with its view transitions — stop the browser from racing it.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

// The Android shell, and only there. The chunk holding the Capacitor plugins
// is never requested in a browser, so the web bundle is unchanged.
if (isNativeShell()) {
  void import('./native').then((m) => m.init()).catch(() => {
    /* shell extras unavailable — the app still works, login just stays on the
       web path (where Google will refuse, visibly, rather than silently) */
  });
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}

// AppProvider / SnackbarProvider use no router hooks, so they wrap the router;
// their context stays available to every route element.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppProvider>
        <SnackbarProvider>
          <RouterProvider router={router} />
        </SnackbarProvider>
      </AppProvider>
    </QueryClientProvider>
  </StrictMode>,
);
