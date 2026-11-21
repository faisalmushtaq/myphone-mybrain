import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Draws a game straight onto the page's body, above everything, so nothing it
 * would otherwise sit inside (a screen's entrance animation, the site's
 * header) can shift or cover it. The wrappers keep the app's styles.
 */
export function FullScreen({ children }: { children: ReactNode }) {
  return createPortal(
    <div className="mpmb-app">
      <div className="mpmb-ny">{children}</div>
    </div>,
    document.body,
  );
}
