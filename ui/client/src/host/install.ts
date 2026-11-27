import { installHostGate } from './gate';
import { hostRoutes } from './routes';

installHostGate(hostRoutes);

/** C3: Clean up any previously registered donor service worker on this origin. */
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => Promise.all(registrations.map((item) => item.unregister())))
    .catch(() => undefined);
}
