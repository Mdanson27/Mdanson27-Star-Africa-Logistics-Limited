import { ApiError, apiRequest } from "@/lib/api";

const request = apiRequest;

function queryString(params?: Record<string, string | number | boolean | null | undefined>) {
  if (!params) return "";
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    search.set(key, String(value));
  });
  const value = search.toString();
  return value ? `?${value}` : "";
}

export interface Project {
  id: string;
  name: string;
  client_id: string | null;
  client_name: string;
  description: string | null;
  status: string;
  value_ugx: number;
  amount_paid_ugx: number;
  start_date: string | null;
  due_date: string | null;
  progress: number;
  project_manager_email: string | null;
  team_emails: string[];
  tags: string[];
  current_milestone: string | null;
  created_by_email: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface AssignableUser {
  id: string;
  email: string;
  full_name: string;
}

export interface ProjectDashboardSummary {
  total_projects: number;
  active_projects: number;
  planning_projects: number;
  overdue_projects: number;
  completed_projects: number;
  total_project_value_ugx: number;
  amount_received_ugx: number;
  outstanding_ugx: number;
  tasks_due: number;
  projects_needing_attention: number;
}

export interface ProjectFilters {
  q?: string;
  include_archived?: boolean;
  status?: string;
  client?: string;
  manager?: string;
  start_from?: string;
  start_to?: string;
  deadline_from?: string;
  deadline_to?: string;
  progress_min?: number;
  progress_max?: number;
  value_min?: number;
  value_max?: number;
  tag?: string;
}

export interface ProjectTask {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  assignee_email: string | null;
  status: string;
  priority: string;
  start_date: string | null;
  due_date: string | null;
  related_document_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskDashboardSummary {
  due_today: number;
  overdue: number;
  high_priority: number;
  assigned_to_me: number;
  recently_completed: number;
}

export interface TaskFilters {
  project_id?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  mine?: boolean;
  q?: string;
  start_from?: string;
  start_to?: string;
  due_from?: string;
  due_to?: string;
  include_archived_projects?: boolean;
}

export interface ProjectPayment {
  id: string;
  invoice_id: string | null;
  amount_ugx: number;
  payment_date: string;
  method: string;
  reference: string | null;
  notes: string | null;
}

export interface ProjectFinance {
  project_value_ugx: number;
  amount_paid_ugx: number;
  project_outstanding_ugx: number;
  quotation_total_ugx: number;
  invoice_total_ugx: number;
  invoice_paid_ugx: number;
  invoice_outstanding_ugx: number;
  payment_total_ugx: number;
  purchase_orders_ugx: number;
  expenses_ugx: number;
  quotations: Array<{
    id: string;
    quotation_number: string;
    amount_ugx: number;
    status: string;
    issue_date: string;
  }>;
  invoices: Array<{
    id: string;
    invoice_number: string;
    amount_ugx: number;
    paid_amount_ugx: number;
    status: string;
    issue_date: string;
    due_date: string | null;
  }>;
  payments: ProjectPayment[];
  purchase_orders: Array<{
    id: string;
    po_number: string;
    supplier_name: string;
    amount_ugx: number;
    status: string;
    order_date: string;
  }>;
  expenses: Array<{
    id: string;
    description: string;
    category: string;
    amount_ugx: number;
    expense_date: string;
    reference: string | null;
  }>;
}

export interface ProjectActivity {
  id: string;
  table_name: string;
  operation: string;
  record_id: string;
  title: string;
  summary: string;
  changed_by: string | null;
  created_at: string;
}

export interface DocumentRecord {
  id: string;
  project_id: string | null;
  title: string;
  original_filename: string;
  category: string;
  content_type: string;
  size_bytes: number;
  storage_key: string;
  uploaded_by_email: string;
  ocr_status: string;
  review_status: string;
  related_record_type: string | null;
  related_record_id: string | null;
  ocr_text: string | null;
  extracted_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProjectWorkspace {
  project: Project;
  tasks: ProjectTask[];
  documents: DocumentRecord[];
  finance: ProjectFinance;
  activity: ProjectActivity[];
}

export interface WorkspaceSummary {
  active_projects: number;
  due_tasks: number;
  pending_tasks: number;
  documents: number;
  outstanding_ugx: number;
}

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
}

export interface InvoiceRecord {
  id: string;
  invoice_number: string;
  client_id: string | null;
  project_id: string | null;
  client_name: string;
  amount_ugx: number;
  paid_amount_ugx: number;
  status: string;
  issue_date: string;
  due_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentRecord {
  id: string;
  project_id: string | null;
  invoice_id: string | null;
  amount_ugx: number;
  payment_date: string;
  method: string;
  reference: string | null;
  notes: string | null;
  recorded_by_email: string;
  created_at: string;
  updated_at: string;
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
}

export interface ExpenseRecord {
  id: string;
  project_id: string | null;
  supplier_id: string | null;
  category: string;
  description: string;
  amount_ugx: number;
  expense_date: string;
  reference: string | null;
  created_at: string;
  updated_at: string;
}

export interface BusinessSummary {
  clients: number;
  suppliers: number;
  quotations_open: number;
  invoice_outstanding_ugx: number;
  expenses_ugx: number;
}

export interface NamedCount { name: string; count: number; }
export interface NamedValue { name: string; value: number; }
export interface MonthlyFinancePoint {
  month: string;
  invoiced_ugx: number;
  received_ugx: number;
  expenses_ugx: number;
  net_cash_ugx: number;
}
export interface ProjectPerformanceItem {
  project_id: string;
  project_name: string;
  client_name: string;
  status: string;
  progress: number;
  value_ugx: number;
  received_ugx: number;
  expenses_ugx: number;
  margin_ugx: number;
}
export interface DashboardAnalytics {
  active_projects: number;
  open_tasks: number;
  overdue_tasks: number;
  task_completion_rate: number;
  receivables_ugx: number;
  receipts_month_ugx: number;
  expenses_month_ugx: number;
  net_cash_month_ugx: number;
  project_status: NamedCount[];
  task_status: NamedCount[];
  invoice_status: NamedCount[];
  quotation_status: NamedCount[];
  expense_categories: NamedValue[];
  monthly_finance: MonthlyFinancePoint[];
  top_projects: ProjectPerformanceItem[];
  document_categories: NamedCount[];
}
export interface TrialBalanceRow {
  account_code: string;
  account_name: string;
  account_type: string;
  debit_ugx: number;
  credit_ugx: number;
  balance_ugx: number;
}
export interface TrialBalanceReport {
  as_of: string;
  rows: TrialBalanceRow[];
  total_debits_ugx: number;
  total_credits_ugx: number;
  difference_ugx: number;
  balanced: boolean;
}
export interface StatementLine { code: string; name: string; amount_ugx: number; }
export interface ProfitLossReport {
  from_date: string;
  to_date: string;
  revenue: StatementLine[];
  expenses: StatementLine[];
  total_revenue_ugx: number;
  total_expenses_ugx: number;
  net_profit_ugx: number;
  margin_percent: number;
}
export interface BalanceSheetReport {
  as_of: string;
  assets: StatementLine[];
  liabilities: StatementLine[];
  equity: StatementLine[];
  total_assets_ugx: number;
  total_liabilities_ugx: number;
  total_equity_ugx: number;
  difference_ugx: number;
  balanced: boolean;
}
export interface CashFlowPoint { month: string; inflows_ugx: number; outflows_ugx: number; net_ugx: number; }
export interface CashFlowReport {
  from_date: string;
  to_date: string;
  inflows_ugx: number;
  outflows_ugx: number;
  net_cash_flow_ugx: number;
  monthly: CashFlowPoint[];
}
export interface ReceivableAgingInvoice {
  invoice_number: string;
  client_name: string;
  due_date: string | null;
  outstanding_ugx: number;
  days_overdue: number;
  bucket: string;
}
export interface ReportingAccount { code:string; name:string; account_type:string; normal_balance:string; system_key:string|null; is_active:boolean; }
export interface JournalLineInput { account_code:string; debit_ugx?:number; credit_ugx?:number; description?:string|null; }
export interface JournalEntryRecord { id:string; entry_date:string; reference:string|null; description:string; source_type:string|null; posted_by_email:string; lines:Array<{account_code:string;account_name:string;debit_ugx:number;credit_ugx:number;description:string|null}>; }

export interface ReceivableAgingReport {
  as_of: string;
  current_ugx: number;
  days_1_30_ugx: number;
  days_31_60_ugx: number;
  days_61_90_ugx: number;
  days_90_plus_ugx: number;
  total_ugx: number;
  invoices: ReceivableAgingInvoice[];
}

export const workspaceApi = {
  summary: () => request<WorkspaceSummary>("/workspace/summary"),

  projectDashboard: () => request<ProjectDashboardSummary>("/projects/dashboard"),
  assignableUsers: () => request<AssignableUser[]>("/users/assignable"),
  projects: (filters?: ProjectFilters) =>
    request<Project[]>(`/projects${queryString(filters as Record<string, string | number | boolean | null | undefined>)}`),
  project: (id: string) => request<Project>(`/projects/${id}`),
  projectWorkspace: (id: string) =>
    request<ProjectWorkspace>(`/projects/${id}/workspace`),
  createProject: (body: Record<string, unknown>) =>
    request<Project>("/projects", { method: "POST", body: JSON.stringify(body) }),
  updateProject: (id: string, body: Record<string, unknown>) =>
    request<Project>(`/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  archiveProject: (id: string) =>
    request<{ message: string }>(`/projects/${id}`, { method: "DELETE" }),
  restoreProject: (id: string) =>
    request<Project>(`/projects/${id}/restore`, { method: "POST" }),
  duplicateProject: (id: string) =>
    request<Project>(`/projects/${id}/duplicate`, { method: "POST" }),

  taskDashboard: () => request<TaskDashboardSummary>("/tasks/dashboard"),
  tasks: (filters?: TaskFilters | string) => {
    const resolved = typeof filters === "string" ? { project_id: filters } : filters;
    return request<ProjectTask[]>(
      `/tasks${queryString(resolved as Record<string, string | number | boolean | null | undefined>)}`,
    );
  },
  createTask: (body: Record<string, unknown>) =>
    request<ProjectTask>("/tasks", { method: "POST", body: JSON.stringify(body) }),
  updateTask: (id: string, body: Record<string, unknown>) =>
    request<ProjectTask>(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteTask: (id: string) =>
    request<{ message: string }>(`/tasks/${id}`, { method: "DELETE" }),

  documents: (projectId?: string) =>
    request<DocumentRecord[]>(
      projectId
        ? `/documents?project_id=${encodeURIComponent(projectId)}`
        : "/documents",
    ),
  createUploadUrl: (body: {
    filename: string;
    content_type: string;
    project_id?: string | null;
  }) =>
    request<{ upload_url: string; storage_key: string; method: string }>(
      "/documents/presign",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),
  createDocument: (body: Record<string, unknown>) =>
    request<DocumentRecord>("/documents", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateDocument: (id: string, body: Record<string, unknown>) =>
    request<DocumentRecord>(`/documents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  downloadDocument: (id: string) =>
    request<{ url: string }>(`/documents/${id}/download`),

  businessSummary: () => request<BusinessSummary>("/business/summary"),
  clients: () => request<ClientRecord[]>("/business/clients"),
  createClient: (body: Record<string, unknown>) =>
    request<ClientRecord>("/business/clients", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  suppliers: () => request<SupplierRecord[]>("/business/suppliers"),
  createSupplier: (body: Record<string, unknown>) =>
    request<SupplierRecord>("/business/suppliers", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  quotations: () => request<QuotationRecord[]>("/business/quotations"),
  createQuotation: (body: Record<string, unknown>) =>
    request<QuotationRecord>("/business/quotations", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  invoices: () => request<InvoiceRecord[]>("/business/invoices"),
  createInvoice: (body: Record<string, unknown>) =>
    request<InvoiceRecord>("/business/invoices", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  payments: (projectId?: string) =>
    request<PaymentRecord[]>(
      projectId
        ? `/business/payments?project_id=${encodeURIComponent(projectId)}`
        : "/business/payments",
    ),
  createPayment: (body: Record<string, unknown>) =>
    request<PaymentRecord>("/business/payments", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  purchaseOrders: () => request<PurchaseOrderRecord[]>("/business/purchase-orders"),
  createPurchaseOrder: (body: Record<string, unknown>) =>
    request<PurchaseOrderRecord>("/business/purchase-orders", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  expenses: () => request<ExpenseRecord[]>("/business/expenses"),
  createExpense: (body: Record<string, unknown>) =>
    request<ExpenseRecord>("/business/expenses", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  reportingDashboard: (months = 6) =>
    request<DashboardAnalytics>(`/reports/dashboard?months=${months}`),
  reportingAccounts: () => request<ReportingAccount[]>("/reports/accounts"),
  createJournalEntry: (body:{entry_date:string;reference?:string|null;description:string;lines:JournalLineInput[]}) =>
    request<JournalEntryRecord>("/reports/journal-entries",{method:"POST",body:JSON.stringify(body)}),
  trialBalance: (asOf?: string) =>
    request<TrialBalanceReport>(`/reports/trial-balance${queryString({ as_of: asOf })}`),
  profitLoss: (fromDate?: string, toDate?: string) =>
    request<ProfitLossReport>(`/reports/profit-loss${queryString({ from_date: fromDate, to_date: toDate })}`),
  balanceSheet: (asOf?: string) =>
    request<BalanceSheetReport>(`/reports/balance-sheet${queryString({ as_of: asOf })}`),
  cashFlow: (fromDate?: string, toDate?: string) =>
    request<CashFlowReport>(`/reports/cash-flow${queryString({ from_date: fromDate, to_date: toDate })}`),
  receivablesAging: (asOf?: string) =>
    request<ReceivableAgingReport>(`/reports/receivables-aging${queryString({ as_of: asOf })}`),
};

export async function uploadToPresignedUrl(url: string, file: File): Promise<void> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!response.ok) {
    throw new ApiError(
      "The document could not be uploaded. Please try again.",
      response.status,
    );
  }
}
