import './polyfills/storage';
import './polyfills/regeneratorRuntime';
/* BioHarness: changed from LibreChat v0.8.9. Installed before any donor module can issue a request. */
import './host/install';
import { createRoot } from 'react-dom/client';
import { initializeI18n } from './locales/i18n';
import App from './App';
import '@librechat/client/style.css';
import './style.css';
import './mobile.css';
import { ApiErrorBoundaryProvider } from './hooks/ApiErrorBoundaryContext';
import { clearTTSCache } from './utils/ttscache';

/** Read-aloud audio lives in memory now; drop what earlier versions persisted to disk. */
void clearTTSCache();

const container = document.getElementById('root');
const root = createRoot(container);

async function bootstrap() {
  await initializeI18n();

  root.render(
    <ApiErrorBoundaryProvider>
      <App />
    </ApiErrorBoundaryProvider>,
  );
}

bootstrap().catch((error) => {
  console.error('[i18n] Failed to initialize before render', error);
  root.render(
    <ApiErrorBoundaryProvider>
      <App />
    </ApiErrorBoundaryProvider>,
  );
});
