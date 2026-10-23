import { apiRequest, authenticatedFetch, getApiBaseUrl } from "@/lib/api";

const request = apiRequest;

const pdfBlobUrl = async (path: string): Promise<string> => {
  const response = await authenticatedFetch(`${getApiBaseUrl()}/api/v1${path}`, {
    headers: { Accept: "application/pdf" },
  });
  if (!response.ok) throw new Error("The PDF stream is temporarily unavailable.");
  return URL.createObjectURL(await response.blob());
};

const securedDocumentUrl = async (url: string): Promise<string> => {
  if (/^https?:\/\//i.test(url)) return url;
  const target = new URL(url, `${getApiBaseUrl()}/`).toString();
  const response = await authenticatedFetch(target, {
    headers: { Accept: "application/pdf" },
  });
  if (!response.ok) throw new Error("The saved PDF is temporarily unavailable.");
  return URL.createObjectURL(await response.blob());
};

const optionalRead = async <T>(loader: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await loader();
  } catch {
    return fallback;
  }
};

const queryString = (params?: Record<string, string | null | undefined>) => {
  if (!params) return "";
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  const value = search.toString();
  return value ? `?${value}` : "";
};

export interface ClientRecord {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupplierRecord extends ClientRecord {}

export interface CommercialLineItemInput {
  description: string;
  quantity: number;
  unit_price_ugx: number;
}

export interface CommercialLineItemRecord extends CommercialLineItemInput {
  id: string;
  position: number;
  amount_ugx: number;
}

export interface CommercialDocumentRecord {
  document_id: string | null;
  document_number: string;
  filename: string;
  download_url: string | null;
  stored: boolean;
}

export interface BusinessDocumentArchiveRecord {
  id: string;
  document_type: string | null;
  document_number: string | null;
  title: string;
  filename: string;
  version: number;
  is_current: boolean;
  is_deleted: boolean;
  client_id: string | null;
  supplier_id: string | null;
  project_id: string | null;
  related_record_type: string | null;
  related_record_id: string | null;
  uploaded_by_email: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by_email: string | null;
  supersedes_document_id: string | null;
}

export interface BusinessDocumentEventRecord {
  id: string;
  document_id: string;
  action: string;
  actor_email: string;
  details: Record<string, unknown>;
  occurred_at: string;
}

export interface BusinessDocumentActionRecord {
  document: BusinessDocumentArchiveRecord;
  download_url: string | null;
  message: string | null;
}

export interface QuotationRecord {
  id: string;
  quotation_number: string;
  client_id: string | null;
  project_id: string | null;
  client_name: string;
  amount_ugx: number;
  status: string;
  issue_date: string;
  valid_until: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  has_current_preview: boolean;
  items?: CommercialLineItemRecord[];
}

export interface InvoiceRecord {
  id: string;
  invoice_number: string;
  client_id: string | null;
  project_id: string | null;
  client_name: string;
  amount_ugx: number;
  paid_amount_ugx: number;
  outstanding_amount_ugx: number;
  status: string;
  issue_date: string;
  due_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  source_quotation_id?: string | null;
  items?: CommercialLineItemRecord[];
}

export interface ReceiptRecord {
  id: string;
  receipt_reference: string;
  client_id: string | null;
  client_name: string | null;
  project_id: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  amount_ugx: number;
  payment_date: string;
  method: string;
  reference: string | null;
  notes: string | null;
  recorded_by_email: string;
  created_at: string;
}

export interface PurchaseOrderRecord {
  id: string;
  po_number: string;
  supplier_id: string | null;
  project_id: string | null;
  supplier_name: string;
  amount_ugx: number;
  status: string;
  order_date: string;
  expected_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  items?: CommercialLineItemRecord[];
}

export interface ExpenseRecord {
  id: string;
  project_id: string | null;
  supplier_id: string | null;
  supporting_document_id: string | null;
  category: string;
  description: string;
  amount_ugx: number;
  expense_date: string;
  reference: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectOption {
  id: string;
  name: string;
  client_id?: string | null;
  client_name: string;
  status: string;
  value_ugx: number;
  amount_paid_ugx: number;
  progress: number;
  due_date: string | null;
}

export interface DocumentOption {
  id: string;
  project_id: string | null;
  client_id?: string | null;
  supplier_id?: string | null;
  title: string;
  original_filename: string;
  category: string;
  created_at: string;
}

export interface ActivityItem {
  record_id: string;
  kind: string;
  label: string;
  detail: string | null;
  occurred_at: string;
}

export interface ClientWorkspace {
  client: ClientRecord;
  projects: ProjectOption[];
  quotations: QuotationRecord[];
  invoices: InvoiceRecord[];
  receipts: ReceiptRecord[];
  documents: DocumentOption[];
  outstanding_balance_ugx: number;
  activity: ActivityItem[];
}

export interface SupplierWorkspace {
  supplier: SupplierRecord;
  projects: ProjectOption[];
  purchase_orders: PurchaseOrderRecord[];
  expenses: ExpenseRecord[];
  documents: DocumentOption[];
  purchase_orders_total_ugx: number;
  expenses_total_ugx: number;
  activity: ActivityItem[];
}

export interface BusinessSummary {
  total_clients: number;
  active_clients: number;
  total_suppliers: number;
  active_suppliers: number;
  quotations_open: number;
  outstanding_invoices: number;
  receivables_ugx: number;
  purchase_orders_open: number;
  expenses_month_ugx: number;
  receipts_month_ugx: number;
  clients: number;
  suppliers: number;
  invoice_outstanding_ugx: number;
  expenses_ugx: number;
}

export interface ClientStatementSummary {
  client_id: string;
  client_name: string;
  invoiced_ugx: number;
  paid_ugx: number;
  outstanding_ugx: number;
}

export interface SupplierStatementSummary {
  supplier_id: string;
  supplier_name: string;
  purchase_orders_ugx: number;
  expenses_ugx: number;
}

export interface StatementEntry {
  record_id: string;
  kind: string;
  reference: string;
  entry_date: string;
  debit_ugx: number;
  credit_ugx: number;
  running_balance_ugx: number;
  status: string | null;
}

export const businessApi = {
  resolveDocumentUrl: securedDocumentUrl,
  summary: () => request<BusinessSummary>("/business/summary"),
  clients: () => request<ClientRecord[]>("/business/clients"),
  createClient: (body: Record<string, unknown>) =>
    request<ClientRecord>("/business/clients", { method: "POST", body: JSON.stringify(body) }),
  updateClient: (id: string, body: Record<string, unknown>) =>
    request<ClientRecord>(`/business/clients/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  clientWorkspace: (id: string) => request<ClientWorkspace>(`/business/clients/${id}/workspace`),

  suppliers: () => request<SupplierRecord[]>("/business/suppliers"),
  createSupplier: (body: Record<string, unknown>) =>
    request<SupplierRecord>("/business/suppliers", { method: "POST", body: JSON.stringify(body) }),
  updateSupplier: (id: string, body: Record<string, unknown>) =>
    request<SupplierRecord>(`/business/suppliers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  supplierWorkspace: (id: string) => request<SupplierWorkspace>(`/business/suppliers/${id}/workspace`),

  quotations: (filters?: { client_id?: string; project_id?: string }) =>
    request<QuotationRecord[]>(`/business/quotations${queryString(filters)}`),
  createQuotation: (body: Record<string, unknown>) =>
    request<QuotationRecord>("/business/quotations", { method: "POST", body: JSON.stringify(body) }),
  updateQuotation: (id: string, body: Record<string, unknown>) =>
    request<QuotationRecord>(`/business/quotations/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  convertQuotation: (id: string, body: Record<string, unknown>) =>
    request<InvoiceRecord>(`/business/quotations/${id}/convert-to-invoice`, { method: "POST", body: JSON.stringify(body) }),
  quotationDocument: (id: string) =>
    request<CommercialDocumentRecord>(`/business/quotations/${id}/document`, { method: "POST" }),
  previewQuotation: (id: string) =>
    request<CommercialDocumentRecord>(`/business/quotations/${id}/preview`, { method: "POST" }),
  quotationPdf: (id: string) => pdfBlobUrl(`/business/quotations/${id}/pdf`),

  invoices: (filters?: { client_id?: string; project_id?: string }) =>
    request<InvoiceRecord[]>(`/business/invoices${queryString(filters)}`),
  createInvoice: (body: Record<string, unknown>) =>
    request<InvoiceRecord>("/business/invoices", { method: "POST", body: JSON.stringify(body) }),
  updateInvoice: (id: string, body: Record<string, unknown>) =>
    request<InvoiceRecord>(`/business/invoices/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  invoiceDocument: (id: string) =>
    request<CommercialDocumentRecord>(`/business/invoices/${id}/document`, { method: "POST" }),
  previewInvoice: (id: string) =>
    request<CommercialDocumentRecord>(`/business/invoices/${id}/preview`, { method: "POST" }),
  invoicePdf: (id: string) => pdfBlobUrl(`/business/invoices/${id}/pdf`),

  receipts: (filters?: { client_id?: string; project_id?: string }) =>
    request<ReceiptRecord[]>(`/business/receipts${queryString(filters)}`),
  createPayment: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>("/business/payments", { method: "POST", body: JSON.stringify(body) }),
  receiptDocument: (id: string) =>
    request<CommercialDocumentRecord>(`/business/receipts/${id}/document`, { method: "POST" }),
  previewReceipt: (id: string) =>
    request<CommercialDocumentRecord>(`/business/receipts/${id}/preview`, { method: "POST" }),
  receiptPdf: (id: string) => pdfBlobUrl(`/business/receipts/${id}/pdf`),

  purchaseOrders: (filters?: { supplier_id?: string; project_id?: string }) =>
    request<PurchaseOrderRecord[]>(`/business/purchase-orders${queryString(filters)}`),
  createPurchaseOrder: (body: Record<string, unknown>) =>
    request<PurchaseOrderRecord>("/business/purchase-orders", { method: "POST", body: JSON.stringify(body) }),
  updatePurchaseOrder: (id: string, body: Record<string, unknown>) =>
    request<PurchaseOrderRecord>(`/business/purchase-orders/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  purchaseOrderDocument: (id: string) =>
    request<CommercialDocumentRecord>(`/business/purchase-orders/${id}/document`, { method: "POST" }),
  previewPurchaseOrder: (id: string) =>
    request<CommercialDocumentRecord>(`/business/purchase-orders/${id}/preview`, { method: "POST" }),
  purchaseOrderPdf: (id: string) => pdfBlobUrl(`/business/purchase-orders/${id}/pdf`),

  expenses: (filters?: { supplier_id?: string; project_id?: string }) =>
    request<ExpenseRecord[]>(`/business/expenses${queryString(filters)}`),
  createExpense: (body: Record<string, unknown>) =>
    request<ExpenseRecord>("/business/expenses", { method: "POST", body: JSON.stringify(body) }),

  clientStatementSummaries: () =>
    request<ClientStatementSummary[]>("/business/statements/clients"),
  supplierStatementSummaries: () =>
    request<SupplierStatementSummary[]>("/business/statements/suppliers"),
  clientStatement: (id: string) =>
    request<StatementEntry[]>(`/business/clients/${id}/statement`),
  clientStatementDocument: (id: string) =>
    request<CommercialDocumentRecord>(`/business/clients/${id}/statement/document`, { method: "POST" }),
  supplierStatementDocument: (id: string) =>
    request<CommercialDocumentRecord>(`/business/suppliers/${id}/statement/document`, { method: "POST" }),

  businessDocuments: (filters?: {
    document_type?: string; client_id?: string; supplier_id?: string; project_id?: string; q?: string; include_deleted?: string;
  }) => request<BusinessDocumentArchiveRecord[]>(`/business/documents${queryString(filters)}`),
  documentHistory: (id: string) =>
    request<BusinessDocumentEventRecord[]>(`/business/documents/${id}/history`),
  viewBusinessDocument: (id: string) =>
    request<BusinessDocumentActionRecord>(`/business/documents/${id}/view`, { method: "POST" }),
  downloadBusinessDocument: (id: string) =>
    request<BusinessDocumentActionRecord>(`/business/documents/${id}/download`, { method: "POST" }),
  printBusinessDocument: (id: string) =>
    request<BusinessDocumentActionRecord>(`/business/documents/${id}/print`, { method: "POST" }),
  shareBusinessDocument: (id: string) =>
    request<BusinessDocumentActionRecord>(`/business/documents/${id}/share`, { method: "POST" }),
  regenerateBusinessDocument: (id: string) =>
    request<BusinessDocumentActionRecord>(`/business/documents/${id}/regenerate`, { method: "POST" }),
  emailBusinessDocument: (id: string, body: { to_address: string; subject?: string | null; message?: string | null }) =>
    request<BusinessDocumentActionRecord>(`/business/documents/${id}/email`, { method: "POST", body: JSON.stringify(body) }),
  deleteBusinessDocument: (id: string) =>
    request<BusinessDocumentActionRecord>(`/business/documents/${id}`, { method: "DELETE" }),
  restoreBusinessDocument: (id: string) =>
    request<BusinessDocumentActionRecord>(`/business/documents/${id}/restore`, { method: "POST" }),

  // These records enrich Business forms, but they are not allowed to take the
  // entire commercial workspace down if another module is temporarily unavailable.
  projects: () => optionalRead(() => request<ProjectOption[]>("/projects"), []),
  documents: () => optionalRead(() => request<DocumentOption[]>("/documents"), []),
};
