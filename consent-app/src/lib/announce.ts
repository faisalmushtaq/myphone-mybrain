/**
 * Screen-reader announcements go through one permanent polite live region
 * (rendered by App). Writing to a region that already exists is announced
 * reliably; regions that appear with content often are not.
 */
let timer: number | null = null;

export function announce(message: string): void {
  const region = document.getElementById('mpmb-live');
  if (!region) return;
  // Clear first so that repeating the same message is announced again.
  region.textContent = '';
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    region.textContent = message;
  }, 60);
}
