import React, { useCallback, useMemo, useState } from "react";
import {
  Banknote,
  Building2,
  ArrowRight,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Landmark,
  Plus,
  ReceiptText,
  ShoppingCart,
  Trash2,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SyncStatus } from "@/components/common/SyncStatus";
import { BusinessDocumentsArchive } from "@/components/business/BusinessDocumentsArchive";
import { SectionNav } from "@/components/common/SectionNav";
import { useCustomToast } from "@/hooks/useCustomToast";
import { useAuth } from "@/hooks/useAuth";
import { useBackgroundRefresh } from "@/hooks/useBackgroundRefresh";
import { readSectionCache, writeSectionCache } from "@/lib/sectionCache";
import { confirmDiscardChanges, useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { getErrorMessage } from "@/lib/api";
import {
  businessApi,
  type BusinessDocumentArchiveRecord,
  type BusinessSummary,
  type ClientRecord,
  type ClientStatementSummary,
  type ClientWorkspace,
  type DocumentOption,
  type ExpenseRecord,
  type InvoiceRecord,
  type ProjectOption,
  type PurchaseOrderRecord,
  type QuotationRecord,
  type ReceiptRecord,
  type StatementEntry,
  type SupplierRecord,
  type SupplierStatementSummary,
  type SupplierWorkspace,
} from "@/lib/businessApi";

type BusinessView =
  | "overview"
  | "clients"
  | "suppliers"
  | "quotations"
  | "invoices"
  | "receipts"
  | "purchase_orders"
  | "expenses"
  | "statements"
  | "business_documents";

type CreateKind =
  | "client"
  | "supplier"
  | "quotation"
  | "invoice"
  | "payment"
  | "purchase_order"
  | "expense";

type DraftLineItem = {
  description: string;
  quantity: string;
  unit_price_ugx: string;
};

type BusinessSnapshot = {
  summary: BusinessSummary | null;
  clients: ClientRecord[];
  suppliers: SupplierRecord[];
  quotes: QuotationRecord[];
  invoices: InvoiceRecord[];
  receipts: ReceiptRecord[];
  purchaseOrders: PurchaseOrderRecord[];
  expenses: ExpenseRecord[];
  projects: ProjectOption[];
  documents: DocumentOption[];
  businessDocuments: BusinessDocumentArchiveRecord[];
  clientStatements: ClientStatementSummary[];
  supplierStatements: SupplierStatementSummary[];
};

const blankLineItem = (): DraftLineItem => ({ description: "", quantity: "1", unit_price_ugx: "" });

const money = (value: number) =>
  new Intl.NumberFormat("en-UG", {
    style: "currency",
    currency: "UGX",
    maximumFractionDigits: 0,
  }).format(value || 0);

const today = () => new Date().toISOString().slice(0, 10);
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-1 focus:ring-primary";

const labelStatus = (value: string) =>
  value === "accepted"
    ? "Approved"
    : value
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());

const invoiceStatuses = (current: string) =>
  current === "draft" ? ["draft", "sent"] :
  current === "sent" ? ["sent", "overdue"] :
  current === "partially_paid" ? ["partially_paid", "overdue"] : [current];

const purchaseOrderStatuses = (current: string) =>
  current === "draft" ? ["draft", "issued"] :
  current === "issued" ? ["issued", "received"] :
  current === "received" ? ["received", "closed"] : [current];

const StatusPill: React.FC<{ value: string }> = ({ value }) => (
  <span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-foreground">
    {labelStatus(value)}
  </span>
);

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
  <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
    {text}
  </div>
);

const Field: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}> = ({ label, value, onChange, type = "text", placeholder, required }) => (
  <label className="space-y-1.5 text-xs font-medium text-foreground">
    <span>{label}</span>
    <Input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      required={required}
    />
  </label>
);

const SelectField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  required?: boolean;
}> = ({ label, value, onChange, children, required }) => (
  <label className="space-y-1.5 text-xs font-medium text-foreground">
    <span>{label}</span>
    <select
      className={selectClass}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required={required}
    >
      {children}
    </select>
  </label>
);

const MetricCard: React.FC<{
  label: string;
  value: string | number;
  helper?: string;
  icon: React.ReactNode;
}> = ({ label, value, helper, icon }) => (
  <Card className="p-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">{value}</p>
        {helper && <p className="mt-1 text-[11px] text-muted-foreground">{helper}</p>}
      </div>
      <div className="rounded-lg bg-primary/10 p-2 text-primary">{icon}</div>
    </div>
  </Card>
);

export const BusinessPage: React.FC = () => {
  const { showSuccessToast, showErrorToast } = useCustomToast();
  const { user } = useAuth();
  const [initialCache] = useState(() => readSectionCache<BusinessSnapshot>(user?.id, "business"));
  const [tab, setTab] = useState<BusinessView>("overview");
  const [summary, setSummary] = useState<BusinessSummary | null>(initialCache?.data.summary ?? null);
  const [clients, setClients] = useState<ClientRecord[]>(initialCache?.data.clients ?? []);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>(initialCache?.data.suppliers ?? []);
  const [quotes, setQuotes] = useState<QuotationRecord[]>(initialCache?.data.quotes ?? []);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>(initialCache?.data.invoices ?? []);
  const [receipts, setReceipts] = useState<ReceiptRecord[]>(initialCache?.data.receipts ?? []);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderRecord[]>(initialCache?.data.purchaseOrders ?? []);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>(initialCache?.data.expenses ?? []);
  const [projects, setProjects] = useState<ProjectOption[]>(initialCache?.data.projects ?? []);
  const [documents, setDocuments] = useState<DocumentOption[]>(initialCache?.data.documents ?? []);
  const [businessDocuments, setBusinessDocuments] = useState<BusinessDocumentArchiveRecord[]>(initialCache?.data.businessDocuments ?? []);
  const [preview, setPreview] = useState<{ url: string; title: string; filename: string } | null>(null);
  const [finalizingPreviewId, setFinalizingPreviewId] = useState<string | null>(null);
  const [quotationActionId, setQuotationActionId] = useState<string | null>(null);
  const [clientStatements, setClientStatements] = useState<ClientStatementSummary[]>(initialCache?.data.clientStatements ?? []);
  const [supplierStatements, setSupplierStatements] = useState<SupplierStatementSummary[]>(initialCache?.data.supplierStatements ?? []);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(initialCache?.savedAt ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [lineItems, setLineItems] = useState<DraftLineItem[]>([]);
  const [saving, setSaving] = useState(false);

  const [clientWorkspace, setClientWorkspace] = useState<ClientWorkspace | null>(null);
  const [supplierWorkspace, setSupplierWorkspace] = useState<SupplierWorkspace | null>(null);
  const [statementTitle, setStatementTitle] = useState("");
  const [statementRows, setStatementRows] = useState<StatementEntry[] | null>(null);

  const formDirty = Boolean(createKind) && (
    Object.values(form).some((value) => value.trim()) ||
    lineItems.some((item) => item.description.trim() || item.unit_price_ugx.trim())
  );
  useUnsavedChanges(Boolean(formDirty));

  const load = useCallback(async (_showLoading = true) => {
    setIsRefreshing(true);
    setLoadError(null);
    try {
      const [
        nextSummary,
        nextClients,
        nextSuppliers,
        nextQuotes,
        nextInvoices,
        nextReceipts,
        nextPurchaseOrders,
        nextExpenses,
        nextProjects,
        nextDocuments,
        nextBusinessDocuments,
        nextClientStatements,
        nextSupplierStatements,
      ] = await Promise.all([
        businessApi.summary(),
        businessApi.clients(),
        businessApi.suppliers(),
        businessApi.quotations(),
        businessApi.invoices(),
        businessApi.receipts(),
        businessApi.purchaseOrders(),
        businessApi.expenses(),
        businessApi.projects(),
        businessApi.documents(),
        businessApi.businessDocuments(),
        businessApi.clientStatementSummaries(),
        businessApi.supplierStatementSummaries(),
      ]);
      setSummary(nextSummary);
      setClients(nextClients);
      setSuppliers(nextSuppliers);
      setQuotes(nextQuotes);
      setInvoices(nextInvoices);
      setReceipts(nextReceipts);
      setPurchaseOrders(nextPurchaseOrders);
      setExpenses(nextExpenses);
      setProjects(nextProjects);
      setDocuments(nextDocuments);
      setBusinessDocuments(nextBusinessDocuments);
      setClientStatements(nextClientStatements);
      setSupplierStatements(nextSupplierStatements);
      const snapshot: BusinessSnapshot = {
        summary: nextSummary,
        clients: nextClients,
        suppliers: nextSuppliers,
        quotes: nextQuotes,
        invoices: nextInvoices,
        receipts: nextReceipts,
        purchaseOrders: nextPurchaseOrders,
        expenses: nextExpenses,
        projects: nextProjects,
        documents: nextDocuments,
        businessDocuments: nextBusinessDocuments,
        clientStatements: nextClientStatements,
        supplierStatements: nextSupplierStatements,
      };
      setLastSyncedAt(writeSectionCache(user?.id, "business", snapshot));
    } catch (error) {
      setLoadError(getErrorMessage(error, "Business records could not be refreshed."));
    } finally {
      setIsRefreshing(false);
    }
  }, [user?.id]);

  useBackgroundRefresh(load);

  const filteredProjects = useMemo(() => {
    if (!form.client_id) return projects;
    const client = clients.find((item) => item.id === form.client_id);
    return projects.filter(
      (project) =>
        project.client_id === form.client_id ||
        (client && project.client_name.trim().toLowerCase() === client.name.trim().toLowerCase()),
    );
  }, [clients, form.client_id, projects]);

  const set = (key: string, value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const openCreate = (kind: CreateKind, defaults: Record<string, string> = {}) => {
    const dates: Record<string, string> = {};
    if (kind === "quotation" || kind === "invoice") dates.issue_date = today();
    if (kind === "payment") dates.payment_date = today();
    if (kind === "purchase_order") dates.order_date = today();
    if (kind === "expense") dates.expense_date = today();
    setForm({ ...dates, ...defaults });
    setLineItems(["quotation", "invoice", "purchase_order"].includes(kind) ? [blankLineItem()] : []);
    setCreateKind(kind);
  };

  const closeCreate = () => {
    if (saving) return;
    if (!confirmDiscardChanges(Boolean(formDirty), "Discard this unsaved business record?")) return;
    setCreateKind(null);
    setForm({});
    setLineItems([]);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!createKind) return;
    const commercialItems = lineItems
      .filter((item) => item.description.trim())
      .map((item) => ({
        description: item.description.trim(),
        quantity: Number(item.quantity || 0),
        unit_price_ugx: Number(item.unit_price_ugx || 0),
      }));
    setSaving(true);
    try {
      if (createKind === "client") {
        await businessApi.createClient({
          name: form.name,
          contact_person: form.contact_person || null,
          phone: form.phone || null,
          email: form.email || null,
          address: form.address || null,
          notes: form.notes || null,
        });
      } else if (createKind === "supplier") {
        await businessApi.createSupplier({
          name: form.name,
          contact_person: form.contact_person || null,
          phone: form.phone || null,
          email: form.email || null,
          address: form.address || null,
          notes: form.notes || null,
        });
      } else if (createKind === "quotation") {
        const client = clients.find((item) => item.id === form.client_id);
        await businessApi.createQuotation({
          quotation_number: "AUTO",
          client_id: form.client_id,
          client_name: client?.name || "",
          project_id: form.project_id || null,
          amount_ugx: 0,
          items: commercialItems,
          status: "draft",
          issue_date: form.issue_date,
          valid_until: form.valid_until || null,
          notes: form.notes || null,
        });
      } else if (createKind === "invoice") {
        const client = clients.find((item) => item.id === form.client_id);
        await businessApi.createInvoice({
          invoice_number: "AUTO",
          client_id: form.client_id,
          client_name: client?.name || "",
          project_id: form.project_id || null,
          amount_ugx: 0,
          items: commercialItems,
          status: "draft",
          issue_date: form.issue_date,
          due_date: form.due_date || null,
          notes: form.notes || null,
        });
      } else if (createKind === "payment") {
        await businessApi.createPayment({
          invoice_id: form.invoice_id,
          amount_ugx: Number(form.amount_ugx || 0),
          payment_date: form.payment_date,
          method: form.method || "bank",
          reference: form.reference || null,
          notes: form.notes || null,
        });
      } else if (createKind === "purchase_order") {
        const supplier = suppliers.find((item) => item.id === form.supplier_id);
        await businessApi.createPurchaseOrder({
          po_number: "AUTO",
          supplier_id: form.supplier_id,
          supplier_name: supplier?.name || "",
          project_id: form.project_id || null,
          amount_ugx: 0,
          items: commercialItems,
          status: "draft",
          order_date: form.order_date,
          expected_date: form.expected_date || null,
          notes: form.notes || null,
        });
      } else if (createKind === "expense") {
        await businessApi.createExpense({
          description: form.description,
          amount_ugx: Number(form.amount_ugx || 0),
          expense_date: form.expense_date,
          category: form.category || "general",
          project_id: form.project_id || null,
          supplier_id: form.supplier_id || null,
          supporting_document_id: form.supporting_document_id || null,
          reference: form.reference || null,
        });
      }
      showSuccessToast("Business record saved.");
      setCreateKind(null);
      setForm({});
      setLineItems([]);
      await load(false);
    } catch (error) {
      showErrorToast(getErrorMessage(error, "The business record could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (
    kind: "quotation" | "invoice" | "purchase_order",
    id: string,
    status: string,
  ) => {
    try {
      if (kind === "quotation") await businessApi.updateQuotation(id, { status });
      if (kind === "invoice") await businessApi.updateInvoice(id, { status });
      if (kind === "purchase_order") await businessApi.updatePurchaseOrder(id, { status });
      showSuccessToast("Status updated.");
      await load(false);
    } catch (error) {
      showErrorToast(getErrorMessage(error, "The status could not be updated."));
    }
  };

  const closePreview = () => {
    setPreview((current) => {
      if (current?.url.startsWith("blob:")) URL.revokeObjectURL(current.url);
      return null;
    });
  };

  const previewDocument = async (
    recordId: string,
    pdfLoader: () => Promise<string>,
    archiveLoader: () => Promise<{ document_id?: string | null }>,
    title: string,
    filename: string,
    onArchived?: () => void,
  ) => {
    try {
      const url = await pdfLoader();
      setPreview((current) => {
        if (current?.url.startsWith("blob:")) URL.revokeObjectURL(current.url);
        return { url, title, filename };
      });
      setFinalizingPreviewId(recordId);

      void archiveLoader()
        .then((saved) => {
          if (!saved.document_id) {
            throw new Error("The PDF opened, but its reviewed archive copy could not be saved.");
          }
          onArchived?.();
          showSuccessToast("Preview ready. The reviewed PDF version has been saved.");
        })
        .catch((error) => {
          showErrorToast(
            getErrorMessage(
              error,
              "The PDF opened, but Star Africa Logistics could not save its reviewed copy. Preview it again before sending or issuing.",
            ),
          );
        })
        .finally(() => {
          setFinalizingPreviewId((current) => current === recordId ? null : current);
        });
    } catch (error) {
      showErrorToast(getErrorMessage(error, "The PDF preview could not be opened."));
    }
  };

  const generateStatementPreview = async (
    loader: () => Promise<{ download_url: string | null; filename: string; document_id: string | null }>,
    title: string,
  ) => {
    try {
      const generated = await loader();
      if (!generated.document_id) throw new Error("The statement could not be saved to the document archive.");
      const viewed = await businessApi.viewBusinessDocument(generated.document_id);
      if (!viewed.download_url) throw new Error("The saved statement PDF is unavailable.");
      setPreview({ url: viewed.download_url, title, filename: generated.filename });
      await load(false);
    } catch (error) {
      showErrorToast(getErrorMessage(error, "The statement preview could not be opened."));
    }
  };

  const approveQuotation = async (quotation: QuotationRecord) => {
    setQuotationActionId(quotation.id);
    try {
      await businessApi.updateQuotation(quotation.id, { status: "accepted" });
      showSuccessToast(`${quotation.quotation_number} approved.`);
      await load(false);
    } catch (error) {
      showErrorToast(getErrorMessage(error, "The quotation could not be approved."));
    } finally {
      setQuotationActionId(null);
    }
  };

  const convertQuotation = async (quotation: QuotationRecord) => {
    setQuotationActionId(quotation.id);
    try {
      await businessApi.convertQuotation(quotation.id, { issue_date: today(), due_date: null });
      showSuccessToast(
        quotation.status === "accepted"
          ? `${quotation.quotation_number} converted to a draft invoice.`
          : `${quotation.quotation_number} approved and converted to a draft invoice.`,
      );
      await load(false);
    } catch (error) {
      showErrorToast(getErrorMessage(error, "The quotation could not be converted."));
    } finally {
      setQuotationActionId(null);
    }
  };

  const openClientWorkspace = async (client: ClientRecord) => {
    const cacheKey = `business-client:${client.id}`;
    const cached = readSectionCache<ClientWorkspace>(user?.id, cacheKey);
    if (cached) setClientWorkspace(cached.data);
    setSupplierWorkspace(null);
    try {
      const nextWorkspace = await businessApi.clientWorkspace(client.id);
      setClientWorkspace(nextWorkspace);
      writeSectionCache(user?.id, cacheKey, nextWorkspace);
    } catch (error) {
      if (!cached) setClientWorkspace(null);
      showErrorToast(getErrorMessage(error, "The client workspace could not be refreshed."));
    }
  };

  const openSupplierWorkspace = async (supplier: SupplierRecord) => {
    const cacheKey = `business-supplier:${supplier.id}`;
    const cached = readSectionCache<SupplierWorkspace>(user?.id, cacheKey);
    if (cached) setSupplierWorkspace(cached.data);
    setClientWorkspace(null);
    try {
      const nextWorkspace = await businessApi.supplierWorkspace(supplier.id);
      setSupplierWorkspace(nextWorkspace);
      writeSectionCache(user?.id, cacheKey, nextWorkspace);
    } catch (error) {
      if (!cached) setSupplierWorkspace(null);
      showErrorToast(getErrorMessage(error, "The supplier workspace could not be refreshed."));
    }
  };

  const openStatement = async (item: ClientStatementSummary) => {
    const cacheKey = `client-statement:${item.client_id}`;
    const cached = readSectionCache<StatementEntry[]>(user?.id, cacheKey);
    setStatementTitle(`${item.client_name} statement`);
    setStatementRows(cached?.data ?? null);
    try {
      const nextRows = await businessApi.clientStatement(item.client_id);
      setStatementRows(nextRows);
      writeSectionCache(user?.id, cacheKey, nextRows);
    } catch (error) {
      if (!cached) setStatementTitle("");
      showErrorToast(getErrorMessage(error, "The statement could not be refreshed."));
    }
  };

  const navItems = [
    { id: "overview" as const, label: "Dashboard" },
    { id: "clients" as const, label: "Clients", count: clients.length },
    { id: "suppliers" as const, label: "Suppliers", count: suppliers.length },
    { id: "quotations" as const, label: "Quotations", count: quotes.length },
    { id: "invoices" as const, label: "Invoices", count: invoices.length },
    { id: "receipts" as const, label: "Receipts", count: receipts.length },
    { id: "purchase_orders" as const, label: "Purchase Orders", count: purchaseOrders.length },
    { id: "expenses" as const, label: "Expenses", count: expenses.length },
    { id: "statements" as const, label: "Statements" },
    { id: "business_documents" as const, label: "Business Documents", count: businessDocuments.length },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">Commercial operations</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Business</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Clients, suppliers, commercial records, receipts, balances and statements in one connected workspace.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SyncStatus isRefreshing={isRefreshing} error={loadError} lastSyncedAt={lastSyncedAt} />
          <Button onClick={() => openCreate(tab === "suppliers" ? "supplier" : "client")} className="sm:hidden">
            <Plus className="mr-2 h-4 w-4" /> Add record
          </Button>
        </div>
      </div>

      <SectionNav items={navItems} active={tab} onChange={setTab} ariaLabel="Business sections" />

      {tab === "overview" && summary && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Total clients" value={summary.total_clients} helper={`${summary.active_clients} active`} icon={<UsersRound className="h-5 w-5" />} />
            <MetricCard label="Total suppliers" value={summary.total_suppliers} helper={`${summary.active_suppliers} active`} icon={<Building2 className="h-5 w-5" />} />
            <MetricCard label="Open quotations" value={summary.quotations_open} icon={<FileText className="h-5 w-5" />} />
            <MetricCard label="Outstanding invoices" value={summary.outstanding_invoices} icon={<WalletCards className="h-5 w-5" />} />
            <MetricCard label="Receivables" value={money(summary.receivables_ugx)} icon={<Landmark className="h-5 w-5" />} />
            <MetricCard label="Open purchase orders" value={summary.purchase_orders_open} icon={<ShoppingCart className="h-5 w-5" />} />
            <MetricCard label="Expenses this month" value={money(summary.expenses_month_ugx)} icon={<Banknote className="h-5 w-5" />} />
            <MetricCard label="Receipts this month" value={money(summary.receipts_month_ugx)} icon={<ReceiptText className="h-5 w-5" />} />
          </div>
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-foreground">Commercial flow</h2>
            <p className="mt-1 text-xs text-muted-foreground">Business records now stay connected to their client, supplier, project and supporting documents.</p>
            <div className="mt-4 grid gap-2 text-xs sm:grid-cols-4">
              {[
                "Client â†’ Project â†’ Quotation",
                "Quotation â†’ Invoice",
                "Invoice â†’ Payment â†’ Receipt",
                "Supplier â†’ Purchase Order â†’ Expense",
              ].map((item) => (
                <div key={item} className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-foreground">{item}</div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "clients" && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div><h2 className="text-base font-semibold">Clients</h2><p className="text-xs text-muted-foreground">Open a client to see their complete commercial workspace.</p></div>
            <Button onClick={() => openCreate("client")}><Plus className="mr-2 h-4 w-4" /> New client</Button>
          </div>
          {clients.length === 0 ? <EmptyState text="No clients yet." /> : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {clients.map((client) => (
                <button key={client.id} type="button" onClick={() => void openClientWorkspace(client)} className="text-left">
                  <Card className="h-full p-4 transition hover:border-primary/50 hover:shadow-sm">
                    <div className="flex items-start justify-between gap-3"><div><p className="font-medium text-foreground">{client.name}</p><p className="mt-1 text-xs text-muted-foreground">{client.contact_person || "No contact person"}</p></div><StatusPill value={client.is_active ? "active" : "inactive"} /></div>
                    <p className="mt-3 text-xs text-muted-foreground">{client.email || client.phone || "No contact details"}</p>
                  </Card>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "suppliers" && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div><h2 className="text-base font-semibold">Suppliers</h2><p className="text-xs text-muted-foreground">Purchase orders, supplied projects, expenses and documents.</p></div>
            <Button onClick={() => openCreate("supplier")}><Plus className="mr-2 h-4 w-4" /> New supplier</Button>
          </div>
          {suppliers.length === 0 ? <EmptyState text="No suppliers yet." /> : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {suppliers.map((supplier) => (
                <button key={supplier.id} type="button" onClick={() => void openSupplierWorkspace(supplier)} className="text-left">
                  <Card className="h-full p-4 transition hover:border-primary/50 hover:shadow-sm">
                    <div className="flex items-start justify-between gap-3"><div><p className="font-medium text-foreground">{supplier.name}</p><p className="mt-1 text-xs text-muted-foreground">{supplier.contact_person || "No contact person"}</p></div><StatusPill value={supplier.is_active ? "active" : "inactive"} /></div>
                    <p className="mt-3 text-xs text-muted-foreground">{supplier.email || supplier.phone || "No contact details"}</p>
                  </Card>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "quotations" && (
        <RecordSection title="Quotations" subtitle="Create itemized quotations, preview the exact saved PDF, then move them through approval and convert accepted quotations into invoices." onAdd={() => openCreate("quotation")} addLabel="New quotation">
          {quotes.length === 0 ? <EmptyState text="No quotations yet." /> : (
            <RecordsTable headers={["Quotation", "Client", "Amount", "Issued", "Status", "Document", "Workflow"]}>
              {quotes.map((item) => {
                const converted = invoices.some((invoice) => invoice.source_quotation_id === item.id);
                return <tr key={item.id} className="border-t border-border">
                  <Cell strong>{item.quotation_number}</Cell><Cell>{item.client_name}</Cell><Cell>{money(item.amount_ugx)}</Cell><Cell>{item.issue_date}</Cell>
                  <Cell><StatusPill value={item.status} /></Cell>
                  <Cell><Button variant="outline" size="sm" disabled={finalizingPreviewId === item.id || quotationActionId === item.id} onClick={() => void previewDocument(item.id, () => businessApi.quotationPdf(item.id), () => businessApi.previewQuotation(item.id), `${item.quotation_number} preview`, `${item.quotation_number}.pdf`, () => setQuotes((current) => current.map((quote) => quote.id === item.id ? { ...quote, has_current_preview: true } : quote)))}><Eye className="mr-1.5 h-3.5 w-3.5" />{item.has_current_preview ? "Preview again" : "Preview"}</Button></Cell>
                  <Cell>
                    {converted ? (
                      <span className="text-xs font-medium text-muted-foreground">Invoiced</span>
                    ) : item.status === "accepted" ? (
                      <Button size="sm" disabled={quotationActionId === item.id} onClick={() => void convertQuotation(item)}><ArrowRight className="mr-1.5 h-3.5 w-3.5" />Convert to invoice</Button>
                    ) : item.has_current_preview && (item.status === "draft" || item.status === "sent") ? (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" disabled={quotationActionId === item.id || finalizingPreviewId === item.id} onClick={() => void approveQuotation(item)}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Approve</Button>
                        <Button size="sm" disabled={quotationActionId === item.id || finalizingPreviewId === item.id} onClick={() => void convertQuotation(item)}><ArrowRight className="mr-1.5 h-3.5 w-3.5" />Convert to invoice</Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">{item.status === "rejected" || item.status === "expired" ? labelStatus(item.status) : "Preview first"}</span>
                    )}
                  </Cell>
                </tr>;
              })}
            </RecordsTable>
          )}
        </RecordSection>
      )}

      {tab === "invoices" && (
        <RecordSection title="Invoices" subtitle="Preview the exact saved PDF before sending. Invoice balances and payment states are calculated from confirmed receipts." onAdd={() => openCreate("invoice")} addLabel="New invoice">
          {invoices.length === 0 ? <EmptyState text="No invoices yet." /> : (
            <RecordsTable headers={["Invoice", "Client", "Total", "Paid", "Outstanding", "Status", "Document", "Payment"]}>
              {invoices.map((item) => <tr key={item.id} className="border-t border-border">
                <Cell strong>{item.invoice_number}</Cell><Cell>{item.client_name}</Cell><Cell>{money(item.amount_ugx)}</Cell><Cell>{money(item.paid_amount_ugx)}</Cell><Cell>{money(item.outstanding_amount_ugx)}</Cell>
                <Cell><select className={`${selectClass} h-8 min-w-36`} value={item.status} disabled={finalizingPreviewId === item.id || item.status === "paid" || item.status === "overdue" || item.status === "partially_paid"} onChange={(e) => void updateStatus("invoice", item.id, e.target.value)}>{invoiceStatuses(item.status).map((status) => <option key={status} value={status}>{labelStatus(status)}</option>)}</select></Cell>
                <Cell><Button variant="outline" size="sm" disabled={finalizingPreviewId === item.id} onClick={() => void previewDocument(item.id, () => businessApi.invoicePdf(item.id), () => businessApi.previewInvoice(item.id), `${item.invoice_number} preview`, `${item.invoice_number}.pdf`)}><Eye className="mr-1.5 h-3.5 w-3.5" />Preview</Button></Cell>
                <Cell>{item.outstanding_amount_ugx > 0 && <Button variant="outline" size="sm" onClick={() => openCreate("payment", { invoice_id: item.id, amount_ugx: String(item.outstanding_amount_ugx) })}>Record payment</Button>}</Cell>
              </tr>)}
            </RecordsTable>
          )}
        </RecordSection>
      )}

      {tab === "receipts" && (
        <RecordSection title="Receipts" subtitle="Every confirmed payment receives a backend-controlled receipt number and a branded Star Africa Logistics PDF.">
          {receipts.length === 0 ? <EmptyState text="No receipts yet. Record a payment against an invoice to create one." /> : (
            <RecordsTable headers={["Receipt", "Client", "Invoice", "Amount", "Date", "Method", "Reference", "Document"]}>
              {receipts.map((item) => <tr key={item.id} className="border-t border-border"><Cell strong>{item.receipt_reference}</Cell><Cell>{item.client_name || "?"}</Cell><Cell>{item.invoice_number || "?"}</Cell><Cell>{money(item.amount_ugx)}</Cell><Cell>{item.payment_date}</Cell><Cell>{labelStatus(item.method)}</Cell><Cell>{item.reference || "?"}</Cell><Cell><Button variant="outline" size="sm" disabled={finalizingPreviewId === item.id} onClick={() => void previewDocument(item.id, () => businessApi.receiptPdf(item.id), () => businessApi.previewReceipt(item.id), `${item.receipt_reference} preview`, `${item.receipt_reference}.pdf`)}><Eye className="mr-1.5 h-3.5 w-3.5" />Preview</Button></Cell></tr>)}
            </RecordsTable>
          )}
        </RecordSection>
      )}

      {tab === "purchase_orders" && (
        <RecordSection title="Purchase Orders" subtitle="Itemized purchase orders must be previewed before Issue, then follow Draft → Issued → Received → Closed." onAdd={() => openCreate("purchase_order")} addLabel="New purchase order">
          {purchaseOrders.length === 0 ? <EmptyState text="No purchase orders yet." /> : (
            <RecordsTable headers={["PO", "Supplier", "Amount", "Order date", "Status", "Document"]}>
              {purchaseOrders.map((item) => <tr key={item.id} className="border-t border-border"><Cell strong>{item.po_number}</Cell><Cell>{item.supplier_name}</Cell><Cell>{money(item.amount_ugx)}</Cell><Cell>{item.order_date}</Cell><Cell><select className={`${selectClass} h-8 min-w-28`} value={item.status} disabled={finalizingPreviewId === item.id} onChange={(e) => void updateStatus("purchase_order", item.id, e.target.value)}>{purchaseOrderStatuses(item.status).map((status) => <option key={status} value={status}>{labelStatus(status)}</option>)}</select></Cell><Cell><Button variant="outline" size="sm" disabled={finalizingPreviewId === item.id} onClick={() => void previewDocument(item.id, () => businessApi.purchaseOrderPdf(item.id), () => businessApi.previewPurchaseOrder(item.id), `${item.po_number} preview`, `${item.po_number}.pdf`)}><Eye className="mr-1.5 h-3.5 w-3.5" />Preview</Button></Cell></tr>)}
            </RecordsTable>
          )}
        </RecordSection>
      )}

      {tab === "expenses" && (
        <RecordSection title="Expenses" subtitle="Expenses can link to a project, supplier and supporting document." onAdd={() => openCreate("expense")} addLabel="New expense">
          {expenses.length === 0 ? <EmptyState text="No expenses yet." /> : (
            <RecordsTable headers={["Description", "Category", "Amount", "Date", "Reference", "Document"]}>
              {expenses.map((item) => <tr key={item.id} className="border-t border-border"><Cell strong>{item.description}</Cell><Cell>{labelStatus(item.category)}</Cell><Cell>{money(item.amount_ugx)}</Cell><Cell>{item.expense_date}</Cell><Cell>{item.reference || "â€”"}</Cell><Cell>{item.supporting_document_id ? "Linked" : "â€”"}</Cell></tr>)}
            </RecordsTable>
          )}
        </RecordSection>
      )}

      {tab === "statements" && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="p-5">
            <h2 className="text-base font-semibold">Client statements</h2>
            <p className="mt-1 text-xs text-muted-foreground">Invoices, receipts and the live outstanding balance.</p>
            <div className="mt-4 space-y-2">
              {clientStatements.length === 0 ? <EmptyState text="No client statement activity yet." /> : clientStatements.map((item) => (
                <div key={item.client_id} className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <button type="button" onClick={() => void openStatement(item)} className="flex flex-1 items-center justify-between gap-3 text-left">
                    <div><p className="text-sm font-medium">{item.client_name}</p><p className="text-xs text-muted-foreground">Invoiced {money(item.invoiced_ugx)} · Paid {money(item.paid_ugx)}</p></div>
                    <div className="text-right"><p className="text-xs text-muted-foreground">Outstanding</p><p className="text-sm font-semibold">{money(item.outstanding_ugx)}</p></div>
                  </button>
                  <Button variant="outline" size="sm" onClick={() => void generateStatementPreview(() => businessApi.clientStatementDocument(item.client_id), `${item.client_name} statement`)}><Eye className="mr-1.5 h-3.5 w-3.5" />Preview PDF</Button>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="text-base font-semibold">Supplier summaries</h2>
            <p className="mt-1 text-xs text-muted-foreground">Purchase orders and recorded supplier expenses.</p>
            <div className="mt-4 space-y-2">
              {supplierStatements.length === 0 ? <EmptyState text="No supplier statement activity yet." /> : supplierStatements.map((item) => (
                <div key={item.supplier_id} className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="text-sm font-medium">{item.supplier_name}</p><p className="text-xs text-muted-foreground">Purchase orders {money(item.purchase_orders_ugx)} · Expenses {money(item.expenses_ugx)}</p></div>
                  <Button variant="outline" size="sm" onClick={() => void generateStatementPreview(() => businessApi.supplierStatementDocument(item.supplier_id), `${item.supplier_name} purchase summary`)}><Eye className="mr-1.5 h-3.5 w-3.5" />Preview PDF</Button>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "business_documents" && (
        <BusinessDocumentsArchive
          documents={businessDocuments}
          clients={clients}
          suppliers={suppliers}
          projects={projects}
          onReload={() => load(false)}
          onPreview={(url, title, filename) => setPreview({ url, title, filename })}
        />
      )}

      <Modal
        isOpen={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.title || "Document Preview"}
        description="Review the actual saved PDF carefully before Send, Issue, Email or Share."
        className="max-w-6xl"
      >
        {preview && (
          <div className="space-y-3">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
              Check the logo, party details, document number, dates, line items, totals, terms and status. The PDF opens immediately; Star Africa Logistics saves the reviewed archive version in the background.
            </div>
            <iframe title={preview.title} src={preview.url} className="h-[72vh] w-full rounded-lg border border-border bg-white" />
            <div className="flex justify-end"><Button type="button" variant="outline" onClick={closePreview}>Preview complete</Button></div>
          </div>
        )}
      </Modal>

      <Modal isOpen={Boolean(createKind)} onClose={closeCreate} title={createKind ? `New ${labelStatus(createKind)}` : "New record"} description="Business records remain connected to the correct parties and projects.">
        <form className="space-y-4" onSubmit={save}>
          {(createKind === "client" || createKind === "supplier") && <>
            <Field label="Name" value={form.name || ""} onChange={(v) => set("name", v)} required />
            <Field label="Contact person" value={form.contact_person || ""} onChange={(v) => set("contact_person", v)} />
            <div className="grid gap-3 sm:grid-cols-2"><Field label="Phone" value={form.phone || ""} onChange={(v) => set("phone", v)} /><Field label="Email" type="email" value={form.email || ""} onChange={(v) => set("email", v)} /></div>
            <Field label="Address" value={form.address || ""} onChange={(v) => set("address", v)} />
            <Field label="Notes" value={form.notes || ""} onChange={(v) => set("notes", v)} />
          </>}

          {(createKind === "quotation" || createKind === "invoice") && <>
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              {createKind === "quotation" ? "Quotation" : "Invoice"} number is assigned automatically by Star Africa Logistics when you save.
            </div>
            <SelectField label="Client" value={form.client_id || ""} onChange={(v) => { set("client_id", v); set("project_id", ""); }} required><option value="">Select client</option>{clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectField>
            <SelectField label="Project" value={form.project_id || ""} onChange={(v) => set("project_id", v)}><option value="">No project</option>{filteredProjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectField>
            <LineItemsEditor rows={lineItems} onChange={setLineItems} />
            <div className="grid gap-3 sm:grid-cols-2"><Field label="Issue date" type="date" value={form.issue_date || ""} onChange={(v) => set("issue_date", v)} required /><Field label={createKind === "quotation" ? "Valid until" : "Due date"} type="date" value={form[createKind === "quotation" ? "valid_until" : "due_date"] || ""} onChange={(v) => set(createKind === "quotation" ? "valid_until" : "due_date", v)} /></div>
            <Field label="Notes / terms" value={form.notes || ""} onChange={(v) => set("notes", v)} />
          </>}

          {createKind === "payment" && <>
            <SelectField label="Invoice" value={form.invoice_id || ""} onChange={(v) => set("invoice_id", v)} required><option value="">Select invoice</option>{invoices.filter((item) => item.outstanding_amount_ugx > 0).map((item) => <option key={item.id} value={item.id}>{item.invoice_number} Â· {item.client_name} Â· {money(item.outstanding_amount_ugx)}</option>)}</SelectField>
            <Field label="Amount received (UGX)" type="number" value={form.amount_ugx || ""} onChange={(v) => set("amount_ugx", v)} required />
            <Field label="Payment date" type="date" value={form.payment_date || ""} onChange={(v) => set("payment_date", v)} required />
            <SelectField label="Payment method" value={form.method || "bank"} onChange={(v) => set("method", v)}><option value="bank">Bank</option><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="cheque">Cheque</option><option value="other">Other</option></SelectField>
            <Field label="Reference" value={form.reference || ""} onChange={(v) => set("reference", v)} />
            <Field label="Notes" value={form.notes || ""} onChange={(v) => set("notes", v)} />
          </>}

          {createKind === "purchase_order" && <>
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              Purchase order number is assigned automatically by Star Africa Logistics when you save.
            </div>
            <SelectField label="Supplier" value={form.supplier_id || ""} onChange={(v) => set("supplier_id", v)} required><option value="">Select supplier</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectField>
            <SelectField label="Project" value={form.project_id || ""} onChange={(v) => set("project_id", v)}><option value="">No project</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectField>
            <LineItemsEditor rows={lineItems} onChange={setLineItems} />
            <div className="grid gap-3 sm:grid-cols-2"><Field label="Order date" type="date" value={form.order_date || ""} onChange={(v) => set("order_date", v)} required /><Field label="Expected date" type="date" value={form.expected_date || ""} onChange={(v) => set("expected_date", v)} /></div>
            <Field label="Notes / delivery instructions" value={form.notes || ""} onChange={(v) => set("notes", v)} />
          </>}

          {createKind === "expense" && <>
            <Field label="Description" value={form.description || ""} onChange={(v) => set("description", v)} required />
            <div className="grid gap-3 sm:grid-cols-2"><Field label="Category" value={form.category || ""} onChange={(v) => set("category", v)} placeholder="e.g. transport" /><Field label="Amount (UGX)" type="number" value={form.amount_ugx || ""} onChange={(v) => set("amount_ugx", v)} required /></div>
            <Field label="Expense date" type="date" value={form.expense_date || ""} onChange={(v) => set("expense_date", v)} required />
            <SelectField label="Project" value={form.project_id || ""} onChange={(v) => set("project_id", v)}><option value="">No project</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectField>
            <SelectField label="Supplier" value={form.supplier_id || ""} onChange={(v) => set("supplier_id", v)}><option value="">No supplier</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectField>
            <SelectField label="Supporting document" value={form.supporting_document_id || ""} onChange={(v) => set("supporting_document_id", v)}><option value="">No supporting document</option>{documents.filter((item) => !form.project_id || !item.project_id || item.project_id === form.project_id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</SelectField>
            <Field label="Reference" value={form.reference || ""} onChange={(v) => set("reference", v)} />
          </>}

          <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="outline" onClick={closeCreate}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</Button></div>
        </form>
      </Modal>

      <Modal isOpen={Boolean(clientWorkspace)} onClose={() => setClientWorkspace(null)} title={clientWorkspace?.client.name || "Client workspace"} description="Profile, projects, quotations, invoices, receipts, documents and activity." className="max-w-5xl">
        {clientWorkspace && <ClientWorkspaceView workspace={clientWorkspace} />}
      </Modal>

      <Modal isOpen={Boolean(supplierWorkspace)} onClose={() => setSupplierWorkspace(null)} title={supplierWorkspace?.supplier.name || "Supplier workspace"} description="Purchase orders, expenses, supplied projects, documents and activity." className="max-w-5xl">
        {supplierWorkspace && <SupplierWorkspaceView workspace={supplierWorkspace} />}
      </Modal>

      <Modal isOpen={Boolean(statementTitle && statementRows !== null)} onClose={() => { setStatementTitle(""); setStatementRows(null); }} title={statementTitle || "Client statement"} description="Running invoice and payment balance." className="max-w-4xl">
        {statementRows?.length === 0 ? <EmptyState text="No statement entries yet." /> : statementRows && <RecordsTable headers={["Date", "Type", "Reference", "Debit", "Credit", "Balance"]}>{statementRows.map((item) => <tr key={`${item.kind}-${item.record_id}`} className="border-t border-border"><Cell>{item.entry_date}</Cell><Cell><StatusPill value={item.kind} /></Cell><Cell strong>{item.reference}</Cell><Cell>{item.debit_ugx ? money(item.debit_ugx) : "—"}</Cell><Cell>{item.credit_ugx ? money(item.credit_ugx) : "—"}</Cell><Cell>{money(item.running_balance_ugx)}</Cell></tr>)}</RecordsTable>}
      </Modal>
    </div>
  );
};

const LineItemsEditor: React.FC<{ rows: DraftLineItem[]; onChange: (rows: DraftLineItem[]) => void }> = ({ rows, onChange }) => {
  const total = rows.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price_ugx || 0), 0);
  const update = (index: number, field: keyof DraftLineItem, value: string) =>
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-foreground">Line items</p><p className="text-[11px] text-muted-foreground">The document total is calculated from these items.</p></div><Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, blankLineItem()])}><Plus className="mr-1 h-3.5 w-3.5" />Add item</Button></div>
      {rows.map((item, index) => (
        <div key={index} className="grid gap-2 rounded-lg bg-muted/30 p-2 sm:grid-cols-[1fr_90px_130px_36px]">
          <Input value={item.description} onChange={(event) => update(index, "description", event.target.value)} placeholder="Description of goods or service" required />
          <Input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => update(index, "quantity", event.target.value)} placeholder="Qty" required />
          <Input type="number" min="0" step="1" value={item.unit_price_ugx} onChange={(event) => update(index, "unit_price_ugx", event.target.value)} placeholder="Unit price" required />
          <Button type="button" variant="ghost" size="sm" disabled={rows.length === 1} onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))} aria-label="Remove line item"><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      <div className="flex justify-end border-t border-border pt-2 text-sm font-semibold text-foreground">Total: {money(total)}</div>
    </div>
  );
};

const RecordSection: React.FC<{ title: string; subtitle: string; children: React.ReactNode; onAdd?: () => void; addLabel?: string }> = ({ title, subtitle, children, onAdd, addLabel }) => (
  <section className="space-y-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-base font-semibold">{title}</h2><p className="text-xs text-muted-foreground">{subtitle}</p></div>{onAdd && <Button onClick={onAdd}><Plus className="mr-2 h-4 w-4" />{addLabel}</Button>}</div>{children}</section>
);

const RecordsTable: React.FC<{ headers: string[]; children: React.ReactNode }> = ({ headers, children }) => (
  <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="bg-muted/50 text-muted-foreground"><tr>{headers.map((header, index) => <th key={`${header}-${index}`} className="px-4 py-3 font-medium">{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div></Card>
);

const Cell: React.FC<{ children: React.ReactNode; strong?: boolean }> = ({ children, strong }) => <td className={`px-4 py-3 ${strong ? "font-medium text-foreground" : "text-muted-foreground"}`}>{children}</td>;

const ClientWorkspaceView: React.FC<{ workspace: ClientWorkspace }> = ({ workspace }) => (
  <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-3"><MetricCard label="Projects" value={workspace.projects.length} icon={<Building2 className="h-5 w-5" />} /><MetricCard label="Invoices" value={workspace.invoices.length} icon={<WalletCards className="h-5 w-5" />} /><MetricCard label="Outstanding balance" value={money(workspace.outstanding_balance_ugx)} icon={<Landmark className="h-5 w-5" />} /></div>
    <div className="grid gap-4 lg:grid-cols-2"><WorkspaceBox title="Profile"><p>{workspace.client.contact_person || "No contact person"}</p><p>{workspace.client.email || "No email"}</p><p>{workspace.client.phone || "No phone"}</p><p>{workspace.client.address || "No address"}</p></WorkspaceBox><WorkspaceBox title="Projects">{workspace.projects.length ? workspace.projects.map((item) => <WorkspaceRow key={item.id} primary={item.name} secondary={`${labelStatus(item.status)} Â· ${item.progress}% complete`} />) : <p>No projects linked.</p>}</WorkspaceBox></div>
    <div className="grid gap-4 lg:grid-cols-2"><WorkspaceBox title="Quotations">{workspace.quotations.length ? workspace.quotations.map((item) => <WorkspaceRow key={item.id} primary={item.quotation_number} secondary={`${money(item.amount_ugx)} Â· ${labelStatus(item.status)}`} />) : <p>No quotations.</p>}</WorkspaceBox><WorkspaceBox title="Invoices">{workspace.invoices.length ? workspace.invoices.map((item) => <WorkspaceRow key={item.id} primary={item.invoice_number} secondary={`${money(item.outstanding_amount_ugx)} outstanding Â· ${labelStatus(item.status)}`} />) : <p>No invoices.</p>}</WorkspaceBox></div>
    <div className="grid gap-4 lg:grid-cols-2"><WorkspaceBox title="Receipts">{workspace.receipts.length ? workspace.receipts.map((item) => <WorkspaceRow key={item.id} primary={item.receipt_reference} secondary={`${money(item.amount_ugx)} Â· ${item.payment_date}`} />) : <p>No receipts.</p>}</WorkspaceBox><WorkspaceBox title="Documents">{workspace.documents.length ? workspace.documents.map((item) => <WorkspaceRow key={item.id} primary={item.title} secondary={labelStatus(item.category)} />) : <p>No documents.</p>}</WorkspaceBox></div>
    <WorkspaceBox title="Activity">{workspace.activity.length ? workspace.activity.slice(0, 12).map((item) => <WorkspaceRow key={`${item.kind}-${item.record_id}-${item.occurred_at}`} primary={item.label} secondary={`${labelStatus(item.kind)} Â· ${item.detail || "Updated"}`} />) : <p>No activity yet.</p>}</WorkspaceBox>
  </div>
);

const SupplierWorkspaceView: React.FC<{ workspace: SupplierWorkspace }> = ({ workspace }) => (
  <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-3"><MetricCard label="Projects supplied" value={workspace.projects.length} icon={<Building2 className="h-5 w-5" />} /><MetricCard label="Purchase orders" value={money(workspace.purchase_orders_total_ugx)} icon={<ShoppingCart className="h-5 w-5" />} /><MetricCard label="Expenses" value={money(workspace.expenses_total_ugx)} icon={<Banknote className="h-5 w-5" />} /></div>
    <div className="grid gap-4 lg:grid-cols-2"><WorkspaceBox title="Profile"><p>{workspace.supplier.contact_person || "No contact person"}</p><p>{workspace.supplier.email || "No email"}</p><p>{workspace.supplier.phone || "No phone"}</p><p>{workspace.supplier.address || "No address"}</p></WorkspaceBox><WorkspaceBox title="Projects supplied">{workspace.projects.length ? workspace.projects.map((item) => <WorkspaceRow key={item.id} primary={item.name} secondary={labelStatus(item.status)} />) : <p>No linked projects.</p>}</WorkspaceBox></div>
    <div className="grid gap-4 lg:grid-cols-2"><WorkspaceBox title="Purchase Orders">{workspace.purchase_orders.length ? workspace.purchase_orders.map((item) => <WorkspaceRow key={item.id} primary={item.po_number} secondary={`${money(item.amount_ugx)} Â· ${labelStatus(item.status)}`} />) : <p>No purchase orders.</p>}</WorkspaceBox><WorkspaceBox title="Expenses">{workspace.expenses.length ? workspace.expenses.map((item) => <WorkspaceRow key={item.id} primary={item.description} secondary={`${money(item.amount_ugx)} Â· ${labelStatus(item.category)}`} />) : <p>No expenses.</p>}</WorkspaceBox></div>
    <div className="grid gap-4 lg:grid-cols-2"><WorkspaceBox title="Documents">{workspace.documents.length ? workspace.documents.map((item) => <WorkspaceRow key={item.id} primary={item.title} secondary={labelStatus(item.category)} />) : <p>No documents.</p>}</WorkspaceBox><WorkspaceBox title="Activity">{workspace.activity.length ? workspace.activity.slice(0, 12).map((item) => <WorkspaceRow key={`${item.kind}-${item.record_id}-${item.occurred_at}`} primary={item.label} secondary={`${labelStatus(item.kind)} Â· ${item.detail || "Updated"}`} />) : <p>No activity yet.</p>}</WorkspaceBox></div>
  </div>
);

const WorkspaceBox: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => <div className="rounded-xl border border-border p-4 text-xs text-muted-foreground"><h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3><div className="space-y-2">{children}</div></div>;
const WorkspaceRow: React.FC<{ primary: string; secondary: string }> = ({ primary, secondary }) => <div className="rounded-lg bg-muted/40 px-3 py-2"><p className="font-medium text-foreground">{primary}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{secondary}</p></div>;

export default BusinessPage;
