type CachedDoc = {
  signedUrl: string;
  title: string;
  fetchedAt: number;
};

const TTL_MS = 8 * 60 * 1000;
const cache = new Map<string, CachedDoc>();

export function getCachedDocumentMeta(documentId: string): CachedDoc | null {
  const hit = cache.get(documentId);
  if (!hit) return null;
  if (Date.now() - hit.fetchedAt > TTL_MS) {
    cache.delete(documentId);
    return null;
  }
  return hit;
}

export function setCachedDocumentMeta(
  documentId: string,
  meta: Omit<CachedDoc, "fetchedAt">,
) {
  cache.set(documentId, { ...meta, fetchedAt: Date.now() });
}

export function prefetchDocumentMeta(documentId: string) {
  if (getCachedDocumentMeta(documentId)) return;
  void fetch(`/api/documents/${documentId}`)
    .then((res) => res.json())
    .then((json) => {
      if (json?.signedUrl) {
        setCachedDocumentMeta(documentId, {
          signedUrl: json.signedUrl,
          title: json.document?.title ?? "",
        });
      }
    })
    .catch(() => {
      /* ignore prefetch errors */
    });
}
