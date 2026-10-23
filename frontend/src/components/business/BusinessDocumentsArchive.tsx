import { useMemo, useState } from "react";
import {
  Download,
  Eye,
  History,
  Mail,
  Printer,
  RefreshCw,
  Search,
  Share2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useCustomToast } from "@/hooks/useCustomToast";
import { getErrorMessage } from "@/lib/api";
import {
  businessApi,
  type BusinessDocumentArchiveRecord,
  type BusinessDocumentEventRecord,
  type ClientRecord,
  type ProjectOption,
  type SupplierRecord,
} from "@/lib/businessApi";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-1 focus:ring-primary";

const labelStatus = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const dateTime = (value: string) => new Date(value).toLocaleString("en-UG", {
  dateStyle: "medium",
  timeStyle: "short",
});

type Props = {
  documents: BusinessDocumentArchiveRecord[];
  clients: ClientRecord[];
  suppliers: SupplierRecord[];
  projects: ProjectOption[];
  onReload: () => Promise<void>;
  onPreview: (url: string, title: string, filename: string) => void;
};

export const BusinessDocumentsArchive: React.FC<Props> = ({
  documents,
  clients,
  suppliers,
  projects,
  onReload,
  onPreview,
}) => {
  const { showSuccessToast, showErrorToast } = useCustomToast();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [clientId, setClientId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [historyDocument, setHistoryDocument] = useState<BusinessDocumentArchiveRecord | null>(null);
  const [history, setHistory] = useState<BusinessDocumentEventRecord[] | null>(null);
  const [emailDocument, setEmailDocument] = useState<BusinessDocumentArchiveRecord | null>(null);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");

  const types = useMemo(
    () => Array.from(new Set(documents.map((item) => item.document_type).filter(Boolean) as string[])).sort(),
    [documents],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return documents.filter((item) => {
      const client = clients.find((row) => row.id === item.client_id)?.name || "";
      const supplier = suppliers.find((row) => row.id === item.supplier_id)?.name || "";
      const project = projects.find((row) => row.id === item.project_id)?.name || "";
      const haystack = [item.title, item.filename, item.document_number || "", client, supplier, project]
        .join(" ")
        .toLowerCase();
      return (
        (!term || haystack.includes(term)) &&
        (!type || item.document_type === type) &&
        (!clientId || item.client_id === clientId) &&
        (!supplierId || item.supplier_id === supplierId) &&
        (!projectId || item.project_id === projectId)
      );
    });
  }, [documents, clients, suppliers, projects, query, type, clientId, supplierId, projectId]);

  const partyLabel = (item: BusinessDocumentArchiveRecord) => {
    if (item.client_id) return clients.find((row) => row.id === item.client_id)?.name || "Linked client";
    if (item.supplier_id) return suppliers.find((row) => row.id === item.supplier_id)?.name || "Linked supplier";
    return "—";
  };

  const projectLabel = (item: BusinessDocumentArchiveRecord) =>
    item.project_id ? projects.find((row) => row.id === item.project_id)?.name || "Linked project" : "—";

  const runLinkAction = async (
    item: BusinessDocumentArchiveRecord,
    action: "view" | "download" | "print" | "share",
  ) => {
    setBusyId(item.id);
    try {
      const result =
        action === "view" ? await businessApi.viewBusinessDocument(item.id) :
        action === "download" ? await businessApi.downloadBusinessDocument(item.id) :
        action === "print" ? await businessApi.printBusinessDocument(item.id) :
        await businessApi.shareBusinessDocument(item.id);
      if (!result.download_url) throw new Error("The saved PDF is not available from document storage.");
      if (action === "share") {
        if (!/^https?:\/\//i.test(result.download_url)) {
          throw new Error("Public share links require Neon Object Storage. The document is safely stored locally and remains available for preview, download and print.");
        }
        await navigator.clipboard.writeText(result.download_url);
        showSuccessToast("Share link copied. It expires automatically.");
      } else {
        const resolvedUrl = await businessApi.resolveDocumentUrl(result.download_url);
        if (action === "view") {
          onPreview(resolvedUrl, `${item.title} · V${item.version}`, item.filename);
        } else {
          window.open(resolvedUrl, "_blank", "noopener,noreferrer");
          if (resolvedUrl.startsWith("blob:")) window.setTimeout(() => URL.revokeObjectURL(resolvedUrl), 60_000);
          if (action === "print") showSuccessToast("The saved PDF opened for printing.");
        }
      }
    } catch (error) {
      showErrorToast(getErrorMessage(error, `The document could not be ${action === "view" ? "opened" : action + "ed"}.`));
    } finally {
      setBusyId(null);
    }
  };

  const openHistory = async (item: BusinessDocumentArchiveRecord) => {
    setHistoryDocument(item);
    setHistory(null);
    try {
      setHistory(await businessApi.documentHistory(item.id));
    } catch (error) {
      showErrorToast(getErrorMessage(error, "Document history could not be loaded."));
      setHistoryDocument(null);
    }
  };

  const regenerate = async (item: BusinessDocumentArchiveRecord) => {
    if (!window.confirm(`Create a new archived version of ${item.document_number || item.title}?`)) return;
    setBusyId(item.id);
    try {
      const result = await businessApi.regenerateBusinessDocument(item.id);
      showSuccessToast(result.message || "A new document version was generated.");
      await onReload();
      if (result.download_url) {
        const resolvedUrl = await businessApi.resolveDocumentUrl(result.download_url);
        onPreview(resolvedUrl, `${result.document.title} · V${result.document.version}`, result.document.filename);
      }
    } catch (error) {
      showErrorToast(getErrorMessage(error, "A new document version could not be generated."));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: BusinessDocumentArchiveRecord) => {
    if (!window.confirm(`Remove ${item.document_number || item.title} from active use? It will remain recoverable for audit.`)) return;
    setBusyId(item.id);
    try {
      const result = await businessApi.deleteBusinessDocument(item.id);
      showSuccessToast(result.message || "Document removed from active use.");
      await onReload();
    } catch (error) {
      showErrorToast(getErrorMessage(error, "The document could not be removed."));
    } finally {
      setBusyId(null);
    }
  };

  const openEmail = (item: BusinessDocumentArchiveRecord) => {
    const clientEmail = clients.find((row) => row.id === item.client_id)?.email || "";
    const supplierEmail = suppliers.find((row) => row.id === item.supplier_id)?.email || "";
    setEmailDocument(item);
    setEmailTo(clientEmail || supplierEmail);
    setEmailSubject(`${item.document_number || item.title} - Star Africa Logistics Ltd`);
    setEmailMessage("Please find the requested Star Africa Logistics document attached.");
  };

  const sendEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!emailDocument) return;
    setBusyId(emailDocument.id);
    try {
      const result = await businessApi.emailBusinessDocument(emailDocument.id, {
        to_address: emailTo,
        subject: emailSubject || null,
        message: emailMessage || null,
      });
      showSuccessToast(result.message || "Document email sent.");
      setEmailDocument(null);
      await onReload();
    } catch (error) {
      showErrorToast(getErrorMessage(error, "The document email could not be sent."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">Business Documents</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Permanent saved PDFs, immutable versions, linked records and document history. View/Preview the exact current version before sending or sharing it.
        </p>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="relative xl:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search number, title, party..." />
          </label>
          <select className={selectClass} value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">All document types</option>
            {types.map((value) => <option key={value} value={value}>{labelStatus(value)}</option>)}
          </select>
          <select className={selectClass} value={clientId} onChange={(event) => setClientId(event.target.value)}>
            <option value="">All clients</option>
            {clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select className={selectClass} value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
            <option value="">All suppliers</option>
            {suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select className={selectClass} value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">All projects</option>
            {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
          No saved business documents match these filters.
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((item) => (
            <Card key={item.id} className="p-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">{item.document_number || item.title}</p>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">V{item.version}</span>
                    {item.is_current && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">Current</span>}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{labelStatus(item.document_type || "document")}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{item.title}</p>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{partyLabel(item)}</span>
                    <span>{projectLabel(item)}</span>
                    <span>{dateTime(item.created_at)}</span>
                    <span>Created by {item.uploaded_by_email}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={busyId === item.id} onClick={() => void runLinkAction(item, "view")}><Eye className="mr-1.5 h-3.5 w-3.5" />View</Button>
                  <Button variant="outline" size="sm" disabled={busyId === item.id} onClick={() => void runLinkAction(item, "download")}><Download className="mr-1.5 h-3.5 w-3.5" />Download</Button>
                  <Button variant="outline" size="sm" disabled={busyId === item.id} onClick={() => void runLinkAction(item, "print")}><Printer className="mr-1.5 h-3.5 w-3.5" />Print</Button>
                  <Button variant="outline" size="sm" disabled={busyId === item.id} onClick={() => openEmail(item)}><Mail className="mr-1.5 h-3.5 w-3.5" />Email</Button>
                  <Button variant="outline" size="sm" disabled={busyId === item.id} onClick={() => void runLinkAction(item, "share")}><Share2 className="mr-1.5 h-3.5 w-3.5" />Share</Button>
                  {item.is_current && <Button variant="outline" size="sm" disabled={busyId === item.id} onClick={() => void regenerate(item)}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Regenerate</Button>}
                  <Button variant="ghost" size="sm" onClick={() => void openHistory(item)}><History className="mr-1.5 h-3.5 w-3.5" />History</Button>
                  <Button variant="ghost" size="sm" disabled={busyId === item.id} onClick={() => void remove(item)}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        isOpen={Boolean(historyDocument)}
        onClose={() => { setHistoryDocument(null); setHistory(null); }}
        title={historyDocument ? `${historyDocument.document_number || historyDocument.title} history` : "Document history"}
        description="Every meaningful action against this exact saved version."
        className="max-w-3xl"
      >
        {history === null ? <p className="py-8 text-center text-sm text-muted-foreground">Loading history...</p> : history.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No history recorded yet.</p> : (
          <div className="space-y-2">
            {history.map((event) => (
              <div key={event.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">{labelStatus(event.action)}</p>
                  <p className="text-[11px] text-muted-foreground">{dateTime(event.occurred_at)}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{event.actor_email}</p>
                {Object.keys(event.details || {}).length > 0 && <p className="mt-2 break-words text-[11px] text-muted-foreground">{JSON.stringify(event.details)}</p>}
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(emailDocument)}
        onClose={() => setEmailDocument(null)}
        title="Email saved PDF"
        description="Star Africa Logistics will attach this exact archived PDF version — it is not regenerated for email."
        className="max-w-xl"
      >
        <form className="space-y-4" onSubmit={sendEmail}>
          <label className="space-y-1.5 text-xs font-medium text-foreground"><span>Recipient email</span><Input type="email" required value={emailTo} onChange={(event) => setEmailTo(event.target.value)} /></label>
          <label className="space-y-1.5 text-xs font-medium text-foreground"><span>Subject</span><Input value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} /></label>
          <label className="space-y-1.5 text-xs font-medium text-foreground"><span>Message</span><textarea className={`${selectClass} min-h-28 py-2`} value={emailMessage} onChange={(event) => setEmailMessage(event.target.value)} /></label>
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
            Before first external delivery, use <strong>View</strong> to preview the exact saved version.
          </div>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setEmailDocument(null)}>Cancel</Button><Button type="submit" disabled={busyId === emailDocument?.id}>Send saved PDF</Button></div>
        </form>
      </Modal>
    </section>
  );
};