import '@fontsource-variable/geist/wght.css';
import '@fontsource-variable/geist-mono/wght.css';
// Bundled, not fetched from Google Fonts: works offline and leaks nothing.
import '@fontsource/instrument-serif/latin-400.css';
import './styles.css';

import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';

const isOverlay = window.location.hash === '#overlay';
document.documentElement.classList.toggle('overlay-route', isOverlay);
if (!isOverlay && window.yap.initialTheme !== 'system') {
  document.documentElement.dataset.theme = window.yap.initialTheme;
}

/* Two entry points in one page: the overlay window only loads the recorder
   and its pill, not the settings app. */
async function mount(): Promise<void> {
  const Root: ComponentType = isOverlay
    ? (await import('./overlay/Overlay')).Overlay
    : (await import('./App')).App;

  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}

void mount();
