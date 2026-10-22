import { apiRequest } from "@/lib/api";

export interface EmployeeRecord {
  id: string;
  employee_no: string;
  full_name: string;
  email: string;
  phone: string | null;
  job_title: string;
  department: string;
  employment_type: string;
  hire_date: string | null;
  base_salary_ugx: number;
  payment_method: string;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  mobile_money_number: string | null;
  tin: string | null;
  nssf_number: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PayrollRunRecord {
  id: string;
  period_start: string;
  period_end: string;
  pay_date: string;
  status: string;
  notes: string | null;
  created_by_email: string;
  finalized_at: string | null;
  employee_count: number;
  gross_total_ugx: number;
  deductions_total_ugx: number;
  net_total_ugx: number;
  paid_total_ugx: number;
  created_at: string;
}

export interface PayrollPaymentRecord {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  employee_no: string;
  employee_name: string;
  employee_email: string;
  basic_pay_ugx: number;
  allowances_ugx: number;
  deductions_ugx: number;
  gross_pay_ugx: number;
  net_pay_ugx: number;
  payment_status: string;
  payment_method: string;
  payment_reference: string | null;
  paid_at: string | null;
  notes: string | null;
  period_start: string;
  period_end: string;
  pay_date: string;
}

export interface PeopleDashboard {
  active_employees: number;
  monthly_payroll_ugx: number;
  pending_payments: number;
  paid_this_month_ugx: number;
}

function qs(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => value && search.set(key, value));
  const value = search.toString();
  return value ? `?${value}` : "";
}

export const peopleApi = {
  dashboard: () => apiRequest<PeopleDashboard>("/people/dashboard"),
  employees: (includeInactive = true) =>
    apiRequest<EmployeeRecord[]>(`/people/employees?include_inactive=${includeInactive}`),
  createEmployee: (body: Record<string, unknown>) =>
    apiRequest<EmployeeRecord>("/people/employees", { method: "POST", body: JSON.stringify(body) }),
  updateEmployee: (id: string, body: Record<string, unknown>) =>
    apiRequest<EmployeeRecord>(`/people/employees/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  payrollRuns: () => apiRequest<PayrollRunRecord[]>("/people/payroll-runs"),
  createPayrollRun: (body: Record<string, unknown>) =>
    apiRequest<PayrollRunRecord>("/people/payroll-runs", { method: "POST", body: JSON.stringify(body) }),
  updatePayrollRun: (id: string, body: Record<string, unknown>) =>
    apiRequest<PayrollRunRecord>(`/people/payroll-runs/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  payrollPayments: (filters: { employee_id?: string; payroll_run_id?: string; from_date?: string; to_date?: string } = {}) =>
    apiRequest<PayrollPaymentRecord[]>(`/people/payroll-payments${qs(filters)}`),
  updatePayrollPayment: (id: string, body: Record<string, unknown>) =>
    apiRequest<PayrollPaymentRecord>(`/people/payroll-payments/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
};
