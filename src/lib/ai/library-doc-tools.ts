import { editorPathForMime } from "@/lib/documents";

export type LibraryToolResult = {
  ok: boolean;
  result: string;
  mutated: boolean;
  navigateTo?: string;
};

function editorPath(doc: { id: string; mimeType?: string }) {
  return editorPathForMime(doc.id, doc.mimeType);
}

export async function applyLibraryTool(
  name: string,
  args: Record<string, unknown>,
  opts: { currentDocumentId?: string },
): Promise<LibraryToolResult> {
  switch (name) {
    case "list_documents": {
      const res = await fetch("/api/documents");
      const json = (await res.json()) as {
        error?: string;
        documents?: Array<{
          id: string;
          title: string;
          mimeType?: string;
          updatedAt?: string;
          byteSize?: number;
        }>;
      };
      if (!res.ok) {
        return {
          ok: false,
          mutated: false,
          result: json.error || "list_documents failed",
        };
      }
      const docs = (json.documents || []).slice(0, 40).map((d) => ({
        id: d.id,
        title: d.title,
        mimeType: d.mimeType,
        updatedAt: d.updatedAt,
        path: editorPath(d),
      }));
      return {
        ok: true,
        mutated: false,
        result: JSON.stringify({ count: docs.length, documents: docs }),
      };
    }
    case "create_document": {
      const title =
        typeof args.title === "string" && args.title.trim()
          ? args.title.trim().slice(0, 200)
          : undefined;
      const type =
        args.type === "pdf" ? "pdf" : args.type === "xlsx" ? "xlsx" : "docx";
      const open = args.open !== false;
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", type, title }),
      });
      const json = (await res.json()) as {
        error?: string;
        document?: { id: string; title: string; mimeType?: string };
      };
      if (!res.ok || !json.document) {
        return {
          ok: false,
          mutated: false,
          result: json.error || "create_document failed",
        };
      }
      const path = editorPath(json.document);
      return {
        ok: true,
        mutated: true,
        navigateTo: open ? path : undefined,
        result: JSON.stringify({
          id: json.document.id,
          title: json.document.title,
          mimeType: json.document.mimeType,
          path,
          opened: open,
        }),
      };
    }
    case "rename_document": {
      const id =
        typeof args.documentId === "string" && args.documentId.trim()
          ? args.documentId.trim()
          : opts.currentDocumentId;
      const title =
        typeof args.title === "string" ? args.title.trim().slice(0, 200) : "";
      if (!id || !title) {
        return {
          ok: false,
          mutated: false,
          result: "documentId and title required",
        };
      }
      const res = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const json = (await res.json()) as { error?: string; title?: string };
      if (!res.ok) {
        return {
          ok: false,
          mutated: false,
          result: json.error || "rename_document failed",
        };
      }
      return {
        ok: true,
        mutated: true,
        result: JSON.stringify({ id, title: json.title || title }),
      };
    }
    case "delete_document": {
      if (args.confirm !== true) {
        return {
          ok: false,
          mutated: false,
          result: "delete_document requires confirm=true",
        };
      }
      const id =
        typeof args.documentId === "string" && args.documentId.trim()
          ? args.documentId.trim()
          : opts.currentDocumentId;
      if (!id) {
        return { ok: false, mutated: false, result: "documentId required" };
      }
      const res = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        return {
          ok: false,
          mutated: false,
          result: json.error || "delete_document failed",
        };
      }
      const leavingCurrent = id === opts.currentDocumentId;
      return {
        ok: true,
        mutated: true,
        navigateTo: leavingCurrent ? "/documents" : undefined,
        result: JSON.stringify({ deleted: id, leftEditor: leavingCurrent }),
      };
    }
    default:
      return { ok: false, mutated: false, result: "unsupported library tool" };
  }
}
