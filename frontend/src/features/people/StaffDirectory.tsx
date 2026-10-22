import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, Pencil, Plus, Search, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useCustomToast } from "@/hooks/useCustomToast";
import { getErrorMessage } from "@/lib/api";
import { peopleApi, type EmployeeRecord } from "@/lib/peopleApi";

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
const textareaClass = "min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";

const emptyForm = {
  employee_no: "",
  full_name: "",
  email: "",
  phone: "",
  job_title: "",
  department: "Operations",
  employment_type: "full_time",
  hire_date: "",
  base_salary_ugx: "",
  payment_method: "bank",
  bank_name: "",
  bank_account_name: "",
  bank_account_number: "",
  mobile_money_number: "",
  tin: "",
  nssf_number: "",
  notes: "",
  is_active: true,
};

type StaffForm = typeof emptyForm;

interface StaffDirectoryProps {
  compact?: boolean;
  onChanged?: (employees: EmployeeRecord[]) => void;
}

const money = (value: number) => new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 }).format(value || 0);

export const StaffDirectory: React.FC<StaffDirectoryProps> = ({ compact = false, onChanged }) => {
  const { showSuccessToast, showErrorToast } = useCustomToast();
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeRecord | null>(null);
  const [form, setForm] = useState<StaffForm>(emptyForm);

  const load = useCallback(async () => {
    try {
      const rows = await peopleApi.employees(true);
      setEmployees(rows);
      onChanged?.(rows);
    } catch (error) {
      showErrorToast(getErrorMessage(error, "Staff directory could not be loaded."), "Staff unavailable");
    } finally {
      setLoading(false);
    }
  }, [onChanged, showErrorToast]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return employees;
    return employees.filter((employee) =>
      [employee.employee_no, employee.full_name, employee.email, employee.job_title, employee.department]
        .some((value) => String(value || "").toLowerCase().includes(term)),
    );
  }, [employees, search]);

  const openCreate = () => {
    const nextNo = `SAL-${String(employees.length + 1).padStart(3, "0")}`;
    setEditing(null);
    setForm({ ...emptyForm, employee_no: nextNo });
    setModalOpen(true);
  };

  const openEdit = (employee: EmployeeRecord) => {
    setEditing(employee);
    setForm({
      employee_no: employee.employee_no,
      full_name: employee.full_name,
      email: employee.email,
      phone: employee.phone || "",
      job_title: employee.job_title,
      department: employee.department,
      employment_type: employee.employment_type,
      hire_date: employee.hire_date || "",
      base_salary_ugx: String(employee.base_salary_ugx || ""),
      payment_method: employee.payment_method,
      bank_name: employee.bank_name || "",
      bank_account_name: employee.bank_account_name || "",
      bank_account_number: employee.bank_account_number || "",
      mobile_money_number: employee.mobile_money_number || "",
      tin: employee.tin || "",
      nssf_number: employee.nssf_number || "",
      notes: employee.notes || "",
      is_active: employee.is_active,
    });
    setModalOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.employee_no.trim() || !form.full_name.trim() || !form.email.trim()) {
      showErrorToast("Employee number, full name and email are required.", "Check staff details");
      return;
    }
    const salary = Number(form.base_salary_ugx || 0);
    if (!Number.isFinite(salary) || salary < 0) {
      showErrorToast("Base salary must be zero or a positive amount.", "Check salary");
      return;
    }
    setSaving(true);
    try {
      const body = {
        employee_no: form.employee_no.trim(),
        full_name: form.full_name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || null,
        job_title: form.job_title.trim() || "Staff",
        department: form.department.trim() || "Operations",
        employment_type: form.employment_type,
        hire_date: form.hire_date || null,
        base_salary_ugx: salary,
        payment_method: form.payment_method,
        bank_name: form.bank_name.trim() || null,
        bank_account_name: form.bank_account_name.trim() || null,
        bank_account_number: form.bank_account_number.trim() || null,
        mobile_money_number: form.mobile_money_number.trim() || null,
        tin: form.tin.trim() || null,
        nssf_number: form.nssf_number.trim() || null,
        notes: form.notes.trim() || null,
        is_active: form.is_active,
      };
      if (editing) await peopleApi.updateEmployee(editing.id, body);
      else await peopleApi.createEmployee(body);
      setModalOpen(false);
      await load();
      showSuccessToast(editing ? "Staff details updated." : "Staff member added to Star Africa Logistics.", editing ? "Staff updated" : "Staff added");
    } catch (error) {
      showErrorToast(getErrorMessage(error, "Staff details could not be saved."), "Staff not saved");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (employee: EmployeeRecord) => {
    try {
      await peopleApi.updateEmployee(employee.id, { is_active: !employee.is_active });
      await load();
      showSuccessToast(employee.is_active ? "Staff member deactivated." : "Staff member reactivated.");
    } catch (error) {
      showErrorToast(getErrorMessage(error, "Staff status could not be changed."));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Staff directory</h3>
          <p className="text-xs text-muted-foreground">Active staff appear automatically in project and task assignment lists.</p>
        </div>
        <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" /> Add staff member</Button>
      </div>

      <div className="max-w-md">
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, role or employee number" icon={<Search />} />
      </div>

      <Card className="overflow-hidden p-0">
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading staff directory…</p>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <BriefcaseBusiness className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">No staff members yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Add the first employee to enable task assignment and payroll.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Job / Department</th>
                  {!compact && <th className="px-4 py-3">Salary</th>}
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((employee) => (
                  <tr key={employee.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <p className="font-medium">{employee.full_name}</p>
                      <p className="text-xs text-muted-foreground">{employee.employee_no} · {employee.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p>{employee.job_title}</p>
                      <p className="text-xs text-muted-foreground">{employee.department}</p>
                    </td>
                    {!compact && <td className="px-4 py-3 font-medium">{money(employee.base_salary_ugx)}</td>}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${employee.is_active ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"}`}>
                        {employee.is_active ? <UserCheck className="h-3 w-3" /> : <UserX className="h-3 w-3" />}
                        {employee.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => openEdit(employee)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="sm" variant="outline" onClick={() => void toggleActive(employee)}>{employee.is_active ? "Deactivate" : "Activate"}</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal isOpen={modalOpen} onClose={() => !saving && setModalOpen(false)} title={editing ? "Edit staff member" : "Add staff member"} description="Create the employee record used for assignments, payroll and staff reporting." className="max-w-3xl">
        <form onSubmit={save} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Input label="Employee number" value={form.employee_no} onChange={(event) => setForm((current) => ({ ...current, employee_no: event.target.value }))} required />
            <Input label="Full name" value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))} required />
            <Input label="Email" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required />
            <Input label="Phone" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
            <Input label="Job title" value={form.job_title} onChange={(event) => setForm((current) => ({ ...current, job_title: event.target.value }))} />
            <Input label="Department" value={form.department} onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))} />
            <div>
              <label className="mb-1.5 block text-xs font-medium">Employment type</label>
              <select className={selectClass} value={form.employment_type} onChange={(event) => setForm((current) => ({ ...current, employment_type: event.target.value }))}>
                <option value="full_time">Full time</option><option value="part_time">Part time</option><option value="contract">Contract</option><option value="casual">Casual</option>
              </select>
            </div>
            <Input label="Hire date" type="date" value={form.hire_date} onChange={(event) => setForm((current) => ({ ...current, hire_date: event.target.value }))} />
            <Input label="Base monthly salary (UGX)" type="number" min="0" value={form.base_salary_ugx} onChange={(event) => setForm((current) => ({ ...current, base_salary_ugx: event.target.value }))} />
            <div>
              <label className="mb-1.5 block text-xs font-medium">Payment method</label>
              <select className={selectClass} value={form.payment_method} onChange={(event) => setForm((current) => ({ ...current, payment_method: event.target.value }))}>
                <option value="bank">Bank transfer</option><option value="mobile_money">Mobile money</option><option value="cash">Cash</option><option value="other">Other</option>
              </select>
            </div>
          </div>

          <div className="rounded-lg border border-border p-4">
            <p className="mb-3 text-sm font-semibold">Payment & statutory details</p>
            <div className="grid gap-4 md:grid-cols-2">
              <Input label="Bank name" value={form.bank_name} onChange={(event) => setForm((current) => ({ ...current, bank_name: event.target.value }))} />
              <Input label="Account name" value={form.bank_account_name} onChange={(event) => setForm((current) => ({ ...current, bank_account_name: event.target.value }))} />
              <Input label="Account number" value={form.bank_account_number} onChange={(event) => setForm((current) => ({ ...current, bank_account_number: event.target.value }))} />
              <Input label="Mobile money number" value={form.mobile_money_number} onChange={(event) => setForm((current) => ({ ...current, mobile_money_number: event.target.value }))} />
              <Input label="TIN" value={form.tin} onChange={(event) => setForm((current) => ({ ...current, tin: event.target.value }))} />
              <Input label="NSSF number" value={form.nssf_number} onChange={(event) => setForm((current) => ({ ...current, nssf_number: event.target.value }))} />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium">Notes</label>
            <textarea className={textareaClass} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))} /> Active employee</label>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Add staff member"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default StaffDirectory;
