/** Bytes of prepared archives and screenshots, kept in memory only (never persisted). */
const files = new Map<string, Blob>();
export const labFileStore = {
  put: (id: string, blob: Blob) => files.set(id, blob),
  get: (id: string) => files.get(id) ?? null,
  remove: (id: string) => files.delete(id),
  clear: () => files.clear(),
};
