import React, { useCallback, useMemo, useRef, useState } from "react";
import { Camera, Download, FileText, ScanLine, Search, UploadCloud } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SyncStatus } from "@/components/common/SyncStatus";
import { SectionNav } from "@/components/common/SectionNav";
import { useCustomToast } from "@/hooks/useCustomToast";
import { useAuth } from "@/hooks/useAuth";
import { useBackgroundRefresh } from "@/hooks/useBackgroundRefresh";
import { readSectionCache, writeSectionCache } from "@/lib/sectionCache";
import { getErrorMessage } from "@/lib/api";
import {
  workspaceApi,
  uploadToPresignedUrl,
  type DocumentRecord,
  type Project,
} from "@/lib/workspaceApi";

const categories = [
  "contract",
  "proposal",
  "invoice",
  "receipt",
  "purchase_order",
  "delivery_note",
  "technical",
  "other",
];

function extractFields(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  const invoice = text.match(
    /(?:invoice|receipt|po|purchase order)\s*(?:no\.?|#|number)?\s*[:#-]?\s*([A-Z0-9-]{3,})/i,
  );
  const amount = text.match(
    /(?:total|amount due|grand total)\s*[:\-]?\s*(?:UGX|USh|Shs)?\s*([0-9,\.]+)/i,
  );
  const dateMatch = text.match(
    /\b(?:0?[1-9]|[12][0-9]|3[01])[\/\-.](?:0?[1-9]|1[0-2])[\/\-.](?:20)?[0-9]{2}\b/,
  );
  if (invoice) result.document_number = invoice[1];
  if (amount) result.amount = amount[1].replaceAll(",", "");
  if (dateMatch) result.date = dateMatch[0];
  return result;
}

const niceCategory = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());

type DocumentsView =
  | "overview"
  | "all"
  | "ocr_inbox"
  | "needs_review"
  | "unclassified"
  | "project_documents"
  | "business_documents"
  | "archived";

type DocumentsSnapshot = { documents: DocumentRecord[]; projects: Project[] };

export const DocumentsPage: React.FC = () => {
  const { showSuccessToast, showErrorToast } = useCustomToast();
  const { user } = useAuth();
  const [initialCache] = useState(() => readSectionCache<DocumentsSnapshot>(user?.id, "documents"));
  const [documents, setDocuments] = useState<DocumentRecord[]>(initialCache?.data.documents ?? []);
  const [projects, setProjects] = useState<Project[]>(initialCache?.data.projects ?? []);
  const [view, setView] = useState<DocumentsView>("overview");
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState("");
  const [category, setCategory] = useState("other");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(initialCache?.savedAt ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async (_showLoading = true) => {
    setIsRefreshing(true);
    setLoadError(null);
    try {
      const [docs, nextProjects] = await Promise.all([
        workspaceApi.documents(),
        workspaceApi.projects(),
      ]);
      const snapshot: DocumentsSnapshot = { documents: docs, projects: nextProjects };
      setDocuments(snapshot.documents);
      setProjects(snapshot.projects);
      setLastSyncedAt(writeSectionCache(user?.id, "documents", snapshot));
    } catch (error) {
      setLoadError(getErrorMessage(error, "Documents could not be refreshed."));
    } finally {
      setIsRefreshing(false);
    }
  }, [user?.id]);

  useBackgroundRefresh(load);

  const filtered = useMemo(() => {
    const normalized = query.toLowerCase().trim();
    return documents.filter((document) => {
      const matchesSearch =
        !normalized ||
        [
          document.title,
          document.original_filename,
          document.category,
          document.ocr_text || "",
        ].some((value) => value.toLowerCase().includes(normalized));

      if (!matchesSearch) return false;
      if (view === "all" || view === "overview") return true;
      if (view === "ocr_inbox") return document.ocr_status === "processing";
      if (view === "needs_review") {
        return document.ocr_status === "completed" && Object.keys(document.extracted_fields || {}).length > 0;
      }
      if (view === "unclassified") return document.category === "other";
      if (view === "project_documents") return Boolean(document.project_id);
      if (view === "business_documents") return !document.project_id;
      if (view === "archived") return false;
      return true;
    });
  }, [documents, query, view]);

  const displayedDocuments = useMemo(() => {
    if (view !== "overview" || query.trim()) return filtered;
    return [...filtered]
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 5);
  }, [filtered, query, view]);

  const documentViews = [
    { id: "overview" as const, label: "Overview" },
    { id: "all" as const, label: "All Documents", count: documents.length },
    { id: "ocr_inbox" as const, label: "OCR Inbox", count: documents.filter((document) => document.ocr_status === "processing").length },
    { id: "needs_review" as const, label: "Needs Review", count: documents.filter((document) => document.ocr_status === "completed" && Object.keys(document.extracted_fields || {}).length > 0).length },
    { id: "unclassified" as const, label: "Unclassified", count: documents.filter((document) => document.category === "other").length },
    { id: "project_documents" as const, label: "Project Documents", count: documents.filter((document) => Boolean(document.project_id)).length },
    { id: "business_documents" as const, label: "Business Documents", count: documents.filter((document) => !document.project_id).length },
    { id: "archived" as const, label: "Archived", count: 0 },
  ];

  const processFile = async (file: File, scan: boolean) => {
    if (busy) return;

    setBusy(true);
    setProgress(scan ? "Reading document..." : "Preparing upload...");

    try {
      let ocrText = "";
      let ocrStatus = "not_requested";
      let extractedFields: Record<string, string> = {};

      if (scan && file.type.startsWith("image/")) {
        ocrStatus = "processing";
        const tesseractUrl =
          "https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.esm.min.js";
        const { recognize } = await import(/* @vite-ignore */ tesseractUrl);
        const result = await recognize(file, "eng", {
          logger: (message: { progress?: number }) => {
            if (typeof message.progress === "number") {
              setProgress(`Reading document... ${Math.round(message.progress * 100)}%`);
            }
          },
        });
        ocrText = result.data.text.trim();
        extractedFields = extractFields(ocrText);
        ocrStatus = "completed";
      }

      setProgress("Uploading securely...");
      const signed = await workspaceApi.createUploadUrl({
        filename: file.name,
        content_type: file.type || "application/octet-stream",
        project_id: projectId || null,
      });
      await uploadToPresignedUrl(signed.upload_url, file);

      setProgress("Saving document...");
      await workspaceApi.createDocument({
        title: file.name.replace(/\.[^.]+$/, ""),
        original_filename: file.name,
        category,
        content_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        storage_key: signed.storage_key,
        project_id: projectId || null,
        ocr_status: ocrStatus,
        ocr_text: ocrText || null,
        extracted_fields: extractedFields,
      });

      await load(false);
      setProgress("Saved");
      showSuccessToast(`${file.name} was saved to Documents.`, "Document saved");
      window.setTimeout(() => setProgress(""), 1200);
    } catch (error) {
      setProgress("");
      showErrorToast(
        getErrorMessage(error, "The document could not be saved."),
        "Document not saved",
      );
    } finally {
      setBusy(false);
    }
  };

  const download = async (document: DocumentRecord) => {
    try {
      const { url } = await workspaceApi.downloadDocument(document.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      showErrorToast(
        getErrorMessage(error, "The document could not be opened."),
        "Open failed",
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Documents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload, scan, search and keep every business document in one place.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SyncStatus isRefreshing={isRefreshing} error={loadError} lastSyncedAt={lastSyncedAt} />
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
          >
            <UploadCloud className="h-4 w-4" /> Upload file
          </Button>
          <Button
            className="gap-2"
            onClick={() => cameraInput.current?.click()}
            disabled={busy}
          >
            <ScanLine className="h-4 w-4" /> Scan document
          </Button>
        </div>
      </div>

      <SectionNav
        items={documentViews}
        active={view}
        onChange={setView}
        ariaLabel="Document sections"
      />

      {view === "overview" && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card><p className="text-xs text-muted-foreground">Total documents</p><p className="mt-2 text-2xl font-bold">{documents.length}</p></Card>
          <Card><p className="text-xs text-muted-foreground">OCR inbox</p><p className="mt-2 text-2xl font-bold">{documentViews.find((item) => item.id === "ocr_inbox")?.count ?? 0}</p></Card>
          <Card><p className="text-xs text-muted-foreground">Needs review</p><p className="mt-2 text-2xl font-bold">{documentViews.find((item) => item.id === "needs_review")?.count ?? 0}</p></Card>
          <Card><p className="text-xs text-muted-foreground">Unclassified</p><p className="mt-2 text-2xl font-bold">{documentViews.find((item) => item.id === "unclassified")?.count ?? 0}</p></Card>
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        className="hidden"
        accept=".pdf,image/*,.doc,.docx,.xls,.xlsx"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void processFile(file, false);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={cameraInput}
        type="file"
        className="hidden"
        accept="image/*"
        capture="environment"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void processFile(file, true);
          event.currentTarget.value = "";
        }}
      />

      <Card>
        <div className="grid gap-3 md:grid-cols-[1fr_220px_190px]">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search names, OCR text, invoice numbers..."
              className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="">General documents</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
          >
            {categories.map((item) => (
              <option key={item} value={item}>
                {niceCategory(item)}
              </option>
            ))}
          </select>
        </div>

        {progress && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
            <Camera className="h-4 w-4" /> {progress}
          </div>
        )}
      </Card>

      {displayedDocuments.length === 0 ? (
        <Card className="py-14 text-center">
          <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 font-medium">
            {view === "archived" ? "No archived documents" : "No documents in this section"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {view === "archived"
              ? "The archive area is now separated and ready for the Documents 2.0 archiving workflow."
              : "Upload a file, scan a document, or choose another document section."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {displayedDocuments.map((document) => {
            const project = projects.find((item) => item.id === document.project_id);
            return (
              <Card
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-4 p-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{document.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {niceCategory(document.category)}{" "}
                      {project ? `- ${project.name}` : "- General"} -{" "}
                      {Math.max(1, Math.round(document.size_bytes / 1024))} KB
                    </p>
                    {document.ocr_status === "completed" && (
                      <p className="mt-1 text-[10px] text-emerald-500">
                        OCR indexed and searchable
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  onClick={() => void download(document)}
                >
                  <Download className="h-3.5 w-3.5" /> Open
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DocumentsPage;
