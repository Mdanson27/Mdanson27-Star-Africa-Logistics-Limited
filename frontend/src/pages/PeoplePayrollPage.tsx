import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, CheckCircle2, Download, FileSpreadsheet, Plus, ReceiptText, UsersRound, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SectionNav } from "@/components/common/SectionNav";
import { StaffDirectory } from "@/features/people/StaffDirectory";
import { useCustomToast } from "@/hooks/useCustomToast";
import { getErrorMessage } from "@/lib/api";
import { peopleApi, type EmployeeRecord, type PayrollPaymentRecord, type PayrollRunRecord, type PeopleDashboard } from "@/lib/peopleApi";

type Section = "overview" | "employees" | "payroll" | "reports";
const money = (value: number) => new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 }).format(value || 0);
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };
const today = () => new Date().toISOString().slice(0, 10);

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const content = [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\r\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export const PeoplePayrollPage: React.FC = () => {
  const { showSuccessToast, showErrorToast } = useCustomToast();
  const [section, setSection] = useState<Section>("overview");
  const [dashboard, setDashboard] = useState<PeopleDashboard | null>(null);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [runs, setRuns] = useState<PayrollRunRecord[]>([]);
  const [payments, setPayments] = useState<PayrollPaymentRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [paymentModal, setPaymentModal] = useState<PayrollPaymentRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [runForm, setRunForm] = useState({ period_start: monthStart(), period_end: today(), pay_date: today(), notes: "" });
  const [paymentForm, setPaymentForm] = useState({ allowances_ugx: "", deductions_ugx: "", payment_status: "pending", payment_method: "bank", payment_reference: "", notes: "" });

  const load = useCallback(async () => {
    try {
      const [summary, staff, nextRuns, nextPayments] = await Promise.all([
        peopleApi.dashboard(), peopleApi.employees(true), peopleApi.payrollRuns(), peopleApi.payrollPayments(),
      ]);
      setDashboard(summary);
      setEmployees(staff);
      setRuns(nextRuns);
      setPayments(nextPayments);
      setSelectedRunId((current) => current || nextRuns[0]?.id || "");
    } catch (error) {
      showErrorToast(getErrorMessage(error, "People & Payroll could not be loaded."), "Payroll unavailable");
    }
  }, [showErrorToast]);

  useEffect(() => { void load(); }, [load]);

  const runPayments = useMemo(() => payments.filter((payment) => payment.payroll_run_id === selectedRunId), [payments, selectedRunId]);
  const employeePayments = useMemo(() => payments.filter((payment) => !selectedEmployeeId || payment.employee_id === selectedEmployeeId), [payments, selectedEmployeeId]);
  const selectedRun = runs.find((run) => run.id === selectedRunId) || null;

  const createRun = async (event: React.FormEvent) => {
    event.preventDefault();
    if (runForm.period_start > runForm.period_end) {
      showErrorToast("Payroll period start cannot be after period end.", "Check payroll period");
      return;
    }
    setBusy(true);
    try {
      const created = await peopleApi.createPayrollRun({ ...runForm, notes: runForm.notes.trim() || null });
      setRunModalOpen(false);
      await load();
      setSelectedRunId(created.id);
      setSection("payroll");
      showSuccessToast("Payroll run created from all active employee salaries.", "Payroll created");
    } catch (error) {
      showErrorToast(getErrorMessage(error, "Payroll run could not be created."), "Payroll not created");
    } finally { setBusy(false); }
  };

  const openPayment = (payment: PayrollPaymentRecord) => {
    setPaymentModal(payment);
    setPaymentForm({
      allowances_ugx: String(payment.allowances_ugx || ""),
      deductions_ugx: String(payment.deductions_ugx || ""),
      payment_status: payment.payment_status,
      payment_method: payment.payment_method,
      payment_reference: payment.payment_reference || "",
      notes: payment.notes || "",
    });
  };

  const savePayment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!paymentModal) return;
    setBusy(true);
    try {
      await peopleApi.updatePayrollPayment(paymentModal.id, {
        allowances_ugx: Number(paymentForm.allowances_ugx || 0),
        deductions_ugx: Number(paymentForm.deductions_ugx || 0),
        payment_status: paymentForm.payment_status,
        payment_method: paymentForm.payment_method,
        payment_reference: paymentForm.payment_reference.trim() || null,
        notes: paymentForm.notes.trim() || null,
      });
      setPaymentModal(null);
      await load();
      showSuccessToast("Employee payroll line updated.", "Payroll updated");
    } catch (error) {
      showErrorToast(getErrorMessage(error, "Payroll payment could not be updated."));
    } finally { setBusy(false); }
  };

  const changeRunStatus = async (status: "finalized" | "paid") => {
    if (!selectedRun) return;
    if (status === "paid" && !window.confirm("Mark the entire payroll run as paid? This will mark every employee line as paid.")) return;
    setBusy(true);
    try {
      await peopleApi.updatePayrollRun(selectedRun.id, { status });
      await load();
      showSuccessToast(status === "paid" ? "Payroll run marked paid." : "Payroll run finalized.");
    } catch (error) {
      showErrorToast(getErrorMessage(error, "Payroll status could not be changed."));
    } finally { setBusy(false); }
  };

  const exportRows = (rows: PayrollPaymentRecord[], filename: string) => {
    downloadCsv(filename,
      ["Employee No", "Employee", "Email", "Period Start", "Period End", "Pay Date", "Basic Pay UGX", "Allowances UGX", "Deductions UGX", "Gross Pay UGX", "Net Pay UGX", "Status", "Method", "Reference", "Paid At"],
      rows.map((row) => [row.employee_no, row.employee_name, row.employee_email, row.period_start, row.period_end, row.pay_date, row.basic_pay_ugx, row.allowances_ugx, row.deductions_ugx, row.gross_pay_ugx, row.net_pay_ugx, row.payment_status, row.payment_method, row.payment_reference || "", row.paid_at || ""]),
    );
  };

  const sections = [
    { id: "overview" as const, label: "Overview" },
    { id: "employees" as const, label: "Employees", count: employees.filter((employee) => employee.is_active).length },
    { id: "payroll" as const, label: "Payroll", count: runs.length },
    { id: "reports" as const, label: "Payment Reports" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">People & Payroll</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage employees, payroll preparation, salary payments and employee payment history.</p>
        </div>
        <Button onClick={() => setRunModalOpen(true)} disabled={employees.filter((employee) => employee.is_active).length === 0}><Plus className="mr-2 h-4 w-4" /> New Payroll Run</Button>
      </div>

      <SectionNav items={sections} active={section} onChange={setSection} ariaLabel="People and payroll sections" />

      {section === "overview" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Active employees", value: dashboard?.active_employees ?? 0, icon: UsersRound },
              { label: "Monthly base payroll", value: money(dashboard?.monthly_payroll_ugx ?? 0), icon: WalletCards },
              { label: "Pending payments", value: dashboard?.pending_payments ?? 0, icon: ReceiptText },
              { label: "Paid this month", value: money(dashboard?.paid_this_month_ugx ?? 0), icon: Banknote },
            ].map(({ label, value, icon: Icon }) => (
              <Card key={label} className="p-4"><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{label}</span><Icon className="h-4 w-4 text-muted-foreground" /></div><p className="mt-2 text-2xl font-semibold">{value}</p></Card>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="p-5">
              <h2 className="font-semibold">Recent payroll runs</h2>
              <div className="mt-4 space-y-3">
                {runs.slice(0, 5).map((run) => <button key={run.id} onClick={() => { setSelectedRunId(run.id); setSection("payroll"); }} className="flex w-full items-center justify-between rounded-lg border border-border p-3 text-left hover:bg-muted/20"><div><p className="text-sm font-medium">{run.period_start} → {run.period_end}</p><p className="text-xs text-muted-foreground">{run.employee_count} employees · Pay date {run.pay_date}</p></div><div className="text-right"><p className="font-semibold">{money(run.net_total_ugx)}</p><p className="text-xs capitalize text-muted-foreground">{run.status}</p></div></button>)}
                {runs.length === 0 && <p className="text-sm text-muted-foreground">No payroll runs recorded yet.</p>}
              </div>
            </Card>
            <Card className="p-5">
              <h2 className="font-semibold">Payroll control</h2>
              <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                <p>1. Add every employee with their base salary and preferred payment method.</p>
                <p>2. Create a payroll run for a pay period. Active employees are added automatically.</p>
                <p>3. Review each employee, add allowances/deductions and record the payment reference.</p>
                <p>4. Finalize the run, mark it paid and export employee or company payment reports.</p>
              </div>
            </Card>
          </div>
        </>
      )}

      {section === "employees" && <StaffDirectory onChanged={setEmployees} />}

      {section === "payroll" && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="w-full max-w-xl"><label className="mb-1.5 block text-xs font-medium">Payroll run</label><select className={selectClass} value={selectedRunId} onChange={(event) => setSelectedRunId(event.target.value)}><option value="">Select payroll run</option>{runs.map((run) => <option key={run.id} value={run.id}>{run.period_start} to {run.period_end} — {money(run.net_total_ugx)} — {run.status}</option>)}</select></div>
            {selectedRun && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => exportRows(runPayments, `payroll-${selectedRun.period_start}-to-${selectedRun.period_end}.csv`)}><Download className="mr-2 h-4 w-4" /> Export sheet</Button>{selectedRun.status === "draft" && <Button variant="outline" onClick={() => void changeRunStatus("finalized")} disabled={busy}>Finalize</Button>}{selectedRun.status !== "paid" && <Button onClick={() => void changeRunStatus("paid")} disabled={busy}><CheckCircle2 className="mr-2 h-4 w-4" /> Mark run paid</Button>}</div>}
          </div>
          {selectedRun ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Card className="p-4"><p className="text-xs text-muted-foreground">Employees</p><p className="mt-2 text-xl font-semibold">{selectedRun.employee_count}</p></Card>
                <Card className="p-4"><p className="text-xs text-muted-foreground">Gross payroll</p><p className="mt-2 text-xl font-semibold">{money(selectedRun.gross_total_ugx)}</p></Card>
                <Card className="p-4"><p className="text-xs text-muted-foreground">Deductions</p><p className="mt-2 text-xl font-semibold">{money(selectedRun.deductions_total_ugx)}</p></Card>
                <Card className="p-4"><p className="text-xs text-muted-foreground">Net payroll</p><p className="mt-2 text-xl font-semibold">{money(selectedRun.net_total_ugx)}</p></Card>
              </div>
              <Card className="overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-4 py-3">Employee</th><th className="px-4 py-3">Basic</th><th className="px-4 py-3">Allowances</th><th className="px-4 py-3">Deductions</th><th className="px-4 py-3">Net pay</th><th className="px-4 py-3">Payment</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-border">{runPayments.map((payment) => <tr key={payment.id}><td className="px-4 py-3"><p className="font-medium">{payment.employee_name}</p><p className="text-xs text-muted-foreground">{payment.employee_no} · {payment.employee_email}</p></td><td className="px-4 py-3">{money(payment.basic_pay_ugx)}</td><td className="px-4 py-3">{money(payment.allowances_ugx)}</td><td className="px-4 py-3">{money(payment.deductions_ugx)}</td><td className="px-4 py-3 font-semibold">{money(payment.net_pay_ugx)}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs ${payment.payment_status === "paid" ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"}`}>{payment.payment_status}</span></td><td className="px-4 py-3 text-xs">{payment.payment_reference || "—"}</td><td className="px-4 py-3 text-right"><Button size="sm" variant="outline" onClick={() => openPayment(payment)}>Review / pay</Button></td></tr>)}</tbody></table></div></Card>
            </>
          ) : <Card className="p-8 text-center text-sm text-muted-foreground">Create or select a payroll run.</Card>}
        </div>
      )}

      {section === "reports" && (
        <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <Card className="p-5 space-y-4">
            <div><h2 className="font-semibold">Employee payment report</h2><p className="mt-1 text-xs text-muted-foreground">Select one employee to export their complete payment history.</p></div>
            <select className={selectClass} value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)}><option value="">All employees</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} — {employee.employee_no}</option>)}</select>
            <Button className="w-full" onClick={() => exportRows(employeePayments, selectedEmployeeId ? `employee-payment-report-${employees.find((employee) => employee.id === selectedEmployeeId)?.employee_no || "staff"}.csv` : "full-payroll-payment-history.csv")} disabled={employeePayments.length === 0}><FileSpreadsheet className="mr-2 h-4 w-4" /> {selectedEmployeeId ? "Download employee report" : "Download full payment sheet"}</Button>
            <Button className="w-full" variant="outline" onClick={() => exportRows(payments, "star-africa-full-payroll-sheet.csv")} disabled={payments.length === 0}><Download className="mr-2 h-4 w-4" /> Export all payroll records</Button>
          </Card>
          <Card className="overflow-hidden p-0"><div className="border-b border-border p-4"><h2 className="font-semibold">Payment history</h2><p className="text-xs text-muted-foreground">{employeePayments.length} payment record(s)</p></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-4 py-3">Employee</th><th className="px-4 py-3">Period</th><th className="px-4 py-3">Pay date</th><th className="px-4 py-3">Net pay</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Reference</th></tr></thead><tbody className="divide-y divide-border">{employeePayments.map((payment) => <tr key={payment.id}><td className="px-4 py-3"><p className="font-medium">{payment.employee_name}</p><p className="text-xs text-muted-foreground">{payment.employee_no}</p></td><td className="px-4 py-3 text-xs">{payment.period_start} → {payment.period_end}</td><td className="px-4 py-3">{payment.pay_date}</td><td className="px-4 py-3 font-semibold">{money(payment.net_pay_ugx)}</td><td className="px-4 py-3 capitalize">{payment.payment_status}</td><td className="px-4 py-3 text-xs">{payment.payment_reference || "—"}</td></tr>)}</tbody></table></div></Card>
        </div>
      )}

      <Modal isOpen={runModalOpen} onClose={() => !busy && setRunModalOpen(false)} title="Create payroll run" description="Creates a draft payroll sheet from every active employee's current base salary." className="max-w-xl">
        <form onSubmit={createRun} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Input label="Period start" type="date" value={runForm.period_start} onChange={(event) => setRunForm((current) => ({ ...current, period_start: event.target.value }))} required /><Input label="Period end" type="date" value={runForm.period_end} onChange={(event) => setRunForm((current) => ({ ...current, period_end: event.target.value }))} required /><Input label="Pay date" type="date" value={runForm.pay_date} onChange={(event) => setRunForm((current) => ({ ...current, pay_date: event.target.value }))} required /></div><Input label="Notes" value={runForm.notes} onChange={(event) => setRunForm((current) => ({ ...current, notes: event.target.value }))} placeholder="October 2026 monthly payroll" /><div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="outline" onClick={() => setRunModalOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create payroll"}</Button></div></form>
      </Modal>

      <Modal isOpen={Boolean(paymentModal)} onClose={() => !busy && setPaymentModal(null)} title={paymentModal ? `Payroll — ${paymentModal.employee_name}` : "Payroll payment"} description="Adjust allowances/deductions and record the employee's payment details." className="max-w-xl">
        {paymentModal && <form onSubmit={savePayment} className="space-y-4"><div className="rounded-lg border border-border bg-muted/20 p-3 text-sm"><div className="flex justify-between"><span>Basic salary</span><strong>{money(paymentModal.basic_pay_ugx)}</strong></div></div><div className="grid gap-4 sm:grid-cols-2"><Input label="Allowances (UGX)" type="number" min="0" value={paymentForm.allowances_ugx} onChange={(event) => setPaymentForm((current) => ({ ...current, allowances_ugx: event.target.value }))} /><Input label="Deductions (UGX)" type="number" min="0" value={paymentForm.deductions_ugx} onChange={(event) => setPaymentForm((current) => ({ ...current, deductions_ugx: event.target.value }))} /><div><label className="mb-1.5 block text-xs font-medium">Payment status</label><select className={selectClass} value={paymentForm.payment_status} onChange={(event) => setPaymentForm((current) => ({ ...current, payment_status: event.target.value }))}><option value="pending">Pending</option><option value="paid">Paid</option></select></div><div><label className="mb-1.5 block text-xs font-medium">Payment method</label><select className={selectClass} value={paymentForm.payment_method} onChange={(event) => setPaymentForm((current) => ({ ...current, payment_method: event.target.value }))}><option value="bank">Bank transfer</option><option value="mobile_money">Mobile money</option><option value="cash">Cash</option><option value="other">Other</option></select></div></div><Input label="Payment reference" value={paymentForm.payment_reference} onChange={(event) => setPaymentForm((current) => ({ ...current, payment_reference: event.target.value }))} placeholder="Bank ref / transaction ID" /><Input label="Notes" value={paymentForm.notes} onChange={(event) => setPaymentForm((current) => ({ ...current, notes: event.target.value }))} /><div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="outline" onClick={() => setPaymentModal(null)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save payroll line"}</Button></div></form>}
      </Modal>
    </div>
  );
};

export default PeoplePayrollPage;
