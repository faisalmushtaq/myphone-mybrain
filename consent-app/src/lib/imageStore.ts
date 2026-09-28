/**
 * In-memory store for image bytes.
 *
 * Image content is deliberately kept out of React state and out of any
 * browser storage: it exists only in this Map for the life of the page, and
 * is uploaded through the API layer. Object URLs are revoked when an image is
 * removed so the memory can be reclaimed.
 */
interface StoredImage {
  blob: Blob;
  url: string;
}

const images = new Map<string, StoredImage>();

export const imageStore = {
  put(id: string, blob: Blob): string {
    const existing = images.get(id);
    if (existing) URL.revokeObjectURL(existing.url);
    const url = URL.createObjectURL(blob);
    images.set(id, { blob, url });
    return url;
  },
  get(id: string): StoredImage | undefined {
    return images.get(id);
  },
  remove(id: string): void {
    const existing = images.get(id);
    if (existing) URL.revokeObjectURL(existing.url);
    images.delete(id);
  },
  clear(): void {
    for (const id of Array.from(images.keys())) imageStore.remove(id);
  },
};
