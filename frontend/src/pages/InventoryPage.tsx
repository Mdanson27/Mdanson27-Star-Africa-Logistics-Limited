import React, { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  PackageCheck,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Warehouse as WarehouseIcon,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SectionNav } from "@/components/common/SectionNav";
import { SyncStatus } from "@/components/common/SyncStatus";
import { useCustomToast } from "@/hooks/useCustomToast";
import { useBackgroundRefresh } from "@/hooks/useBackgroundRefresh";
import { useAuth } from "@/hooks/useAuth";
import { readSectionCache, writeSectionCache } from "@/lib/sectionCache";
import { getErrorMessage } from "@/lib/api";
import { businessApi, type SupplierRecord } from "@/lib/businessApi";
import { workspaceApi, type Project } from "@/lib/workspaceApi";
import {
  inventoryApi,
  type InventoryCategory,
  type InventoryDashboard,
  type InventoryItem,
  type InventoryUnit,
  type StockBalance,
  type StockRequest,
  type StockTransaction,
  type Warehouse,
  type WarehouseLocation,
} from "@/lib/inventoryApi";

type Section = "overview" | "stock" | "warehouses" | "requests" | "transactions" | "setup";
type Workflow = "opening" | "receive" | "issue" | "return" | "transfer" | "count" | "damage" | "loss" | "writeoff";
type Dialog = "workflow" | "item" | "warehouse" | "location" | "request" | "issue_request" | "category" | "unit" | null;

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
const textareaClass = "min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
const money = (value: number) => new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 }).format(value || 0);
const qty = (value: number) => new Intl.NumberFormat("en-UG", { maximumFractionDigits: 3 }).format(value || 0);
const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());

const emptyItem = { sku: "", name: "", description: "", category_id: "", unit_id: "", supplier_id: "", unit_cost_ugx: "", minimum_stock_level: "" };
const emptyWarehouse = { code: "", name: "", address: "", notes: "" };
const emptyLocation = { warehouse_id: "", parent_location_id: "", code: "", name: "", location_type: "area" };
const emptyRequest = { project_id: "", item_id: "", requested_quantity: "", notes: "" };
const emptyIssue = { warehouse_id: "", location_id: "", quantity: "", reference: "", notes: "" };
const emptyWorkflow = { item_id: "", warehouse_id: "", location_id: "", project_id: "", to_warehouse_id: "", to_location_id: "", to_project_id: "", quantity: "", counted_quantity: "", unit_cost_ugx: "", reference: "", notes: "" };

type WorkflowForm = typeof emptyWorkflow;

interface InventorySnapshot {
  dashboard: InventoryDashboard | null;
  items: InventoryItem[];
  categories: InventoryCategory[];
  units: InventoryUnit[];
  warehouses: Warehouse[];
  locations: WarehouseLocation[];
  balances: StockBalance[];
  movements: StockTransaction[];
  requests: StockRequest[];
  suppliers: SupplierRecord[];
  projects: Project[];
}

const workflowMeta: Record<Workflow, { title: string; description: string; button: string; icon: React.ReactNode }> = {
  opening: { title: "Set opening stock", description: "Record the physical quantity already on hand when an item first enters the system.", button: "Set Opening Stock", icon: <ClipboardCheck className="h-5 w-5" /> },
  receive: { title: "Receive stock", description: "Receive goods into a registered warehouse or storage location.", button: "Receive Stock", icon: <ArrowDownToLine className="h-5 w-5" /> },
  issue: { title: "Issue to project / site", description: "Move company stock into a registered project's custody without treating it as consumed.", button: "Issue to Project", icon: <ArrowUpFromLine className="h-5 w-5" /> },
  return: { title: "Return from project", description: "Move unused project stock back into general company stock.", button: "Return Stock", icon: <RotateCcw className="h-5 w-5" /> },
  transfer: { title: "Transfer stock", description: "Move stock between warehouses or storage locations.", button: "Transfer Stock", icon: <ArrowLeftRight className="h-5 w-5" /> },
  count: { title: "Stock count / adjustment", description: "Enter the physical count. Star Africa posts only the difference as an auditable adjustment.", button: "Post Stock Count", icon: <ClipboardList className="h-5 w-5" /> },
  damage: { title: "Record damaged stock", description: "Remove unusable stock from the selected balance with a reason.", button: "Record Damage", icon: <Wrench className="h-5 w-5" /> },
  loss: { title: "Record lost stock", description: "Record stock that cannot be accounted for.", button: "Record Loss", icon: <AlertTriangle className="h-5 w-5" /> },
  writeoff: { title: "Write off stock", description: "Permanently remove obsolete or unusable inventory while preserving the audit trail.", button: "Write Off Stock", icon: <Trash2 className="h-5 w-5" /> },
};

export const InventoryPage: React.FC = () => {
  const { showSuccessToast, showErrorToast, showWarningToast } = useCustomToast();
  const { user } = useAuth();
  const [initialCache] = useState(() => readSectionCache<InventorySnapshot>(user?.id, "inventory"));
  const [section, setSection] = useState<Section>("overview");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [workflow, setWorkflow] = useState<Workflow>("receive");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!initialCache);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(initialCache?.savedAt ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<InventoryDashboard | null>(initialCache?.data.dashboard ?? null);
  const [items, setItems] = useState<InventoryItem[]>(initialCache?.data.items ?? []);
  const [categories, setCategories] = useState<InventoryCategory[]>(initialCache?.data.categories ?? []);
  const [units, setUnits] = useState<InventoryUnit[]>(initialCache?.data.units ?? []);
  const [warehouses, setWarehouses] = useState<Warehouse[]>(initialCache?.data.warehouses ?? []);
  const [locations, setLocations] = useState<WarehouseLocation[]>(initialCache?.data.locations ?? []);
  const [balances, setBalances] = useState<StockBalance[]>(initialCache?.data.balances ?? []);
  const [movements, setMovements] = useState<StockTransaction[]>(initialCache?.data.movements ?? []);
  const [requests, setRequests] = useState<StockRequest[]>(initialCache?.data.requests ?? []);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>(initialCache?.data.suppliers ?? []);
  const [projects, setProjects] = useState<Project[]>(initialCache?.data.projects ?? []);
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [itemForm, setItemForm] = useState(emptyItem);
  const [warehouseForm, setWarehouseForm] = useState(emptyWarehouse);
  const [locationForm, setLocationForm] = useState(emptyLocation);
  const [workflowForm, setWorkflowForm] = useState<WorkflowForm>(emptyWorkflow);
  const [requestForm, setRequestForm] = useState(emptyRequest);
  const [issueForm, setIssueForm] = useState(emptyIssue);
  const [selectedRequest, setSelectedRequest] = useState<StockRequest | null>(null);
  const [masterForm, setMasterForm] = useState({ code: "", name: "", description: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [summary, itemRows, categoryRows, unitRows, warehouseRows, locationRows, balanceRows, movementRows, requestRows, supplierRows, projectRows] = await Promise.all([
        inventoryApi.dashboard(), inventoryApi.items(), inventoryApi.categories(), inventoryApi.units(), inventoryApi.warehouses(), inventoryApi.locations(),
        inventoryApi.balances(), inventoryApi.movements({ limit: 200 }), inventoryApi.requests(), businessApi.suppliers(), workspaceApi.projects({ include_archived: false }),
      ]);
      setDashboard(summary); setItems(itemRows); setCategories(categoryRows); setUnits(unitRows); setWarehouses(warehouseRows); setLocations(locationRows);
      setBalances(balanceRows); setMovements(movementRows); setRequests(requestRows); setSuppliers(supplierRows); setProjects(projectRows);
      const snapshot: InventorySnapshot = { dashboard: summary, items: itemRows, categories: categoryRows, units: unitRows, warehouses: warehouseRows, locations: locationRows, balances: balanceRows, movements: movementRows, requests: requestRows, suppliers: supplierRows, projects: projectRows };
      setLastSyncedAt(writeSectionCache(user?.id, "inventory", snapshot));
    } catch (error) {
      const message = getErrorMessage(error, "Inventory could not be refreshed.");
      setLoadError(message);
      if (!initialCache) showErrorToast(message, "Inventory unavailable");
    } finally { setLoading(false); }
  }, [initialCache, showErrorToast, user?.id]);

  useBackgroundRefresh(load);

  const companyBalances = useMemo(() => balances.filter((row) => !row.project_id), [balances]);
  const projectBalances = useMemo(() => balances.filter((row) => Boolean(row.project_id)), [balances]);
  const lowItems = useMemo(() => items.filter((item) => item.is_low_stock), [items]);
  const pendingRequests = useMemo(() => requests.filter((row) => ["pending", "approved"].includes(row.status)), [requests]);
  const filteredItems = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter((item) => !term || `${item.sku} ${item.name} ${item.category_name || ""}`.toLowerCase().includes(term));
  }, [items, query]);
  const stockRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return balances.filter((row) => {
      if (scopeFilter === "company" && row.project_id) return false;
      if (scopeFilter === "project" && !row.project_id) return false;
      if (scopeFilter === "low" && !items.find((item) => item.id === row.item_id)?.is_low_stock) return false;
      return !term || `${row.item_sku} ${row.item_name} ${row.warehouse_name} ${row.location_name || ""} ${row.project_name || ""}`.toLowerCase().includes(term);
    });
  }, [balances, items, query, scopeFilter]);

  const sections = [
    { id: "overview" as const, label: "Overview" },
    { id: "stock" as const, label: "Stock", count: balances.length },
    { id: "warehouses" as const, label: "Warehouses & Sites", count: warehouses.length },
    { id: "requests" as const, label: "Requests", count: pendingRequests.length },
    { id: "transactions" as const, label: "Transactions", count: movements.length },
    { id: "setup" as const, label: "Setup" },
  ];

  const closeDialog = () => { if (!busy) setDialog(null); };
  const openWorkflow = (next: Workflow, seed: Partial<WorkflowForm> = {}) => {
    const defaultWarehouse = warehouses.length === 1 ? warehouses[0].id : "";
    setWorkflow(next);
    setWorkflowForm({ ...emptyWorkflow, warehouse_id: defaultWarehouse, to_warehouse_id: defaultWarehouse, ...seed });
    setDialog("workflow");
  };
  const balanceFor = (itemId: string, warehouseId: string, locationId: string, projectId: string) => balances.find((row) => row.item_id === itemId && row.warehouse_id === warehouseId && (row.location_id || "") === locationId && (row.project_id || "") === projectId);
  const currentBalance = balanceFor(workflowForm.item_id, workflowForm.warehouse_id, workflowForm.location_id, workflowForm.project_id);
  const currentQty = currentBalance?.quantity || 0;
  const selectedItem = items.find((row) => row.id === workflowForm.item_id);
  const countDelta = workflow === "count" ? Number(workflowForm.counted_quantity || 0) - currentQty : 0;

  const saveItem = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!itemForm.sku.trim() || !itemForm.name.trim()) { showWarningToast("SKU and item name are required.", "Check item"); return; }
    setBusy(true);
    try {
      await inventoryApi.createItem({ sku: itemForm.sku, name: itemForm.name, description: itemForm.description || null, category_id: itemForm.category_id || null, unit_id: itemForm.unit_id || null, supplier_id: itemForm.supplier_id || null, unit_cost_ugx: Number(itemForm.unit_cost_ugx || 0), minimum_stock_level: Number(itemForm.minimum_stock_level || 0) });
      setItemForm(emptyItem); setDialog(null); await load();
      showSuccessToast("Item created. Use Opening Stock or Receive Stock to record quantity on hand.", "Item saved");
    } catch (error) { showErrorToast(getErrorMessage(error, "Item could not be saved."), "Item not saved"); }
    finally { setBusy(false); }
  };

  const saveWarehouse = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { await inventoryApi.createWarehouse(warehouseForm); setWarehouseForm(emptyWarehouse); setDialog(null); await load(); showSuccessToast("Warehouse created.", "Warehouse saved"); }
    catch (error) { showErrorToast(getErrorMessage(error, "Warehouse could not be saved."), "Warehouse not saved"); }
    finally { setBusy(false); }
  };

  const saveLocation = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { await inventoryApi.createLocation({ ...locationForm, parent_location_id: locationForm.parent_location_id || null }); setLocationForm(emptyLocation); setDialog(null); await load(); showSuccessToast("Storage location created.", "Location saved"); }
    catch (error) { showErrorToast(getErrorMessage(error, "Location could not be saved."), "Location not saved"); }
    finally { setBusy(false); }
  };

  const saveWorkflow = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!workflowForm.item_id) { showWarningToast("Select an inventory item.", "Item required"); return; }
    const workflowItem = items.find((row) => row.id === workflowForm.item_id);
    if (workflow === "opening" && (workflowItem?.total_quantity || 0) > 0) { showWarningToast("Opening Stock is only for an item that has no recorded balance. Use Receive Stock or Stock Count instead.", "Opening stock already exists"); return; }

    let movementType = "stock_in";
    let amount = Number(workflowForm.quantity || 0);
    let fromWarehouse: string | null = null;
    let fromLocation: string | null = null;
    let fromProject: string | null = null;
    let toWarehouse: string | null = null;
    let toLocation: string | null = null;
    let toProject: string | null = null;

    if (workflow === "opening") {
      movementType = "adjustment_in";
      toWarehouse = workflowForm.warehouse_id || null;
      toLocation = workflowForm.location_id || null;
      toProject = workflowForm.project_id || null;
    } else if (workflow === "receive") {
      movementType = "stock_in";
      toWarehouse = workflowForm.warehouse_id || null;
      toLocation = workflowForm.location_id || null;
    } else if (workflow === "issue") {
      movementType = "project_allocation";
      fromWarehouse = workflowForm.warehouse_id || null;
      fromLocation = workflowForm.location_id || null;
      toWarehouse = workflowForm.warehouse_id || null;
      toLocation = workflowForm.location_id || null;
      toProject = workflowForm.to_project_id || null;
      if (!toProject) { showWarningToast("Select the registered project or site receiving this stock.", "Project required"); return; }
    } else if (workflow === "return") {
      movementType = "project_return";
      fromWarehouse = workflowForm.warehouse_id || null;
      fromLocation = workflowForm.location_id || null;
      fromProject = workflowForm.project_id || null;
      toWarehouse = workflowForm.to_warehouse_id || workflowForm.warehouse_id || null;
      toLocation = workflowForm.to_location_id || null;
      if (!fromProject) { showWarningToast("Select the project returning this stock.", "Project required"); return; }
    } else if (workflow === "transfer") {
      movementType = "transfer";
      fromWarehouse = workflowForm.warehouse_id || null;
      fromLocation = workflowForm.location_id || null;
      fromProject = workflowForm.project_id || null;
      toWarehouse = workflowForm.to_warehouse_id || null;
      toLocation = workflowForm.to_location_id || null;
      toProject = workflowForm.to_project_id || null;
      if (!toWarehouse) { showWarningToast("Select the destination warehouse.", "Destination required"); return; }
    } else if (workflow === "count") {
      if (countDelta === 0) { showWarningToast("The physical count matches the system quantity. No adjustment is required.", "No difference"); return; }
      amount = Math.abs(countDelta);
      if (countDelta > 0) {
        movementType = "adjustment_in";
        toWarehouse = workflowForm.warehouse_id || null;
        toLocation = workflowForm.location_id || null;
        toProject = workflowForm.project_id || null;
      } else {
        movementType = "adjustment_out";
        fromWarehouse = workflowForm.warehouse_id || null;
        fromLocation = workflowForm.location_id || null;
        fromProject = workflowForm.project_id || null;
      }
    } else {
      movementType = workflow === "damage" ? "damaged" : workflow === "loss" ? "lost" : "write_off";
      fromWarehouse = workflowForm.warehouse_id || null;
      fromLocation = workflowForm.location_id || null;
      fromProject = workflowForm.project_id || null;
    }

    const needsWarehouse = ["opening", "receive", "issue", "return", "transfer", "count", "damage", "loss", "writeoff"].includes(workflow);
    if (needsWarehouse && !workflowForm.warehouse_id) { showWarningToast("Select the warehouse or stock location involved.", "Warehouse required"); return; }
    if (amount <= 0) { showWarningToast("Enter a quantity greater than zero.", "Quantity required"); return; }
    if (["count", "damage", "loss", "writeoff"].includes(workflow) && !workflowForm.notes.trim()) { showWarningToast("Enter a reason or note for this stock change.", "Reason required"); return; }

    setBusy(true);
    try {
      await inventoryApi.createMovement({
        item_id: workflowForm.item_id,
        movement_type: movementType,
        quantity: amount,
        unit_cost_ugx: workflowForm.unit_cost_ugx ? Number(workflowForm.unit_cost_ugx) : null,
        from_warehouse_id: fromWarehouse,
        from_location_id: fromLocation,
        from_project_id: fromProject,
        to_warehouse_id: toWarehouse,
        to_location_id: toLocation,
        to_project_id: toProject,
        reference: workflowForm.reference || (workflow === "opening" ? "OPENING-STOCK" : null),
        notes: workflowForm.notes || null,
      });
      setWorkflowForm(emptyWorkflow); setDialog(null); await load();
      showSuccessToast(`${workflowMeta[workflow].title} recorded. Stock balances are now updated.`, "Inventory updated");
    } catch (error) { showErrorToast(getErrorMessage(error, "Inventory transaction could not be recorded."), "Transaction failed"); }
    finally { setBusy(false); }
  };

  const saveRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!requestForm.project_id || !requestForm.item_id || Number(requestForm.requested_quantity) <= 0) { showWarningToast("Select a project, item and quantity.", "Check request"); return; }
    setBusy(true);
    try { await inventoryApi.createRequest({ ...requestForm, requested_quantity: Number(requestForm.requested_quantity), notes: requestForm.notes || null }); setRequestForm(emptyRequest); setDialog(null); await load(); showSuccessToast("Stock request submitted.", "Request created"); }
    catch (error) { showErrorToast(getErrorMessage(error, "Stock request could not be created."), "Request failed"); }
    finally { setBusy(false); }
  };

  const saveMaster = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      if (dialog === "category") await inventoryApi.createCategory({ name: masterForm.name, description: masterForm.description || null });
      if (dialog === "unit") await inventoryApi.createUnit({ code: masterForm.code, name: masterForm.name });
      setMasterForm({ code: "", name: "", description: "" }); setDialog(null); await load(); showSuccessToast("Inventory setup saved.", "Saved");
    } catch (error) { showErrorToast(getErrorMessage(error, "Setup data could not be saved."), "Not saved"); }
    finally { setBusy(false); }
  };

  const updateRequest = async (request: StockRequest, status: string) => {
    try { await inventoryApi.updateRequest(request.id, { status, approved_quantity: status === "approved" ? request.requested_quantity : request.approved_quantity }); await load(); showSuccessToast(`Request ${status}.`, "Request updated"); }
    catch (error) { showErrorToast(getErrorMessage(error, "Request could not be updated."), "Request not updated"); }
  };

  const openIssueRequest = (request: StockRequest) => {
    setSelectedRequest(request);
    setIssueForm({ ...emptyIssue, quantity: String(request.approved_quantity || request.requested_quantity) });
    setDialog("issue_request");
  };

  const issueRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedRequest || !issueForm.warehouse_id) { showWarningToast("Select the warehouse issuing this stock.", "Warehouse required"); return; }
    setBusy(true);
    try {
      await inventoryApi.issueRequest(selectedRequest.id, { warehouse_id: issueForm.warehouse_id, location_id: issueForm.location_id || null, quantity: Number(issueForm.quantity || selectedRequest.approved_quantity), reference: issueForm.reference || null, notes: issueForm.notes || null });
      setIssueForm(emptyIssue); setSelectedRequest(null); setDialog(null); await load(); showSuccessToast("Stock issued to the project and recorded in the audit trail.", "Stock issued");
    } catch (error) { showErrorToast(getErrorMessage(error, "Approved stock could not be issued."), "Issue failed"); }
    finally { setBusy(false); }
  };

  const metric = (title: string, value: React.ReactNode, helper: string, icon: React.ReactNode) => (
    <Card><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">{title}</p><p className="mt-2 text-xl font-bold">{value}</p><p className="mt-1 text-[10px] text-muted-foreground">{helper}</p></div><div className="rounded-lg bg-primary/10 p-2 text-primary">{icon}</div></div></Card>
  );

  const actionCard = (type: Workflow) => {
    const meta = workflowMeta[type];
    return <button type="button" onClick={() => openWorkflow(type)} className="w-full rounded-xl border border-border bg-card p-3 text-left transition hover:border-primary/50 hover:bg-primary/[0.03]"><div className="flex items-start gap-3"><div className="rounded-lg bg-primary/10 p-2 text-primary">{meta.icon}</div><div><p className="text-sm font-semibold">{meta.title}</p><p className="mt-1 text-[11px] text-muted-foreground">{meta.description}</p></div></div></button>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold">Inventory & Warehouses</h1><p className="mt-1 text-sm text-muted-foreground">Know what you have, where it is, which project holds it and every movement that changed the balance.</p></div>
        <div className="flex flex-wrap items-center gap-2"><SyncStatus isRefreshing={loading} error={loadError} lastSyncedAt={lastSyncedAt} /><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button><Button onClick={() => openWorkflow("receive")}><ArrowDownToLine className="mr-2 h-4 w-4" />Receive Stock</Button></div>
      </div>

      <SectionNav items={sections} active={section} onChange={setSection} ariaLabel="Inventory sections" />

      {section === "overview" && (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {metric("Stock value", money(dashboard?.inventory_value_ugx || 0), `${qty(dashboard?.total_quantity || 0)} total units on hand`, <Boxes className="h-4 w-4" />)}
            {metric("Company stock", money((dashboard?.inventory_value_ugx || 0) - (dashboard?.project_stock_value_ugx || 0)), `${companyBalances.length} storage balances`, <WarehouseIcon className="h-4 w-4" />)}
            {metric("Project / site stock", money(dashboard?.project_stock_value_ugx || 0), `${projectBalances.length} project balances`, <PackageCheck className="h-4 w-4" />)}
            {metric("Needs attention", lowItems.length, `${pendingRequests.length} pending/approved requests`, <AlertTriangle className="h-4 w-4" />)}
          </div>

          <Card>
            <div className="mb-4"><h3 className="font-semibold">Daily inventory actions</h3><p className="mt-1 text-xs text-muted-foreground">Choose what happened. Star Africa records the correct audited stock transaction automatically.</p></div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{actionCard("opening")}{actionCard("receive")}{actionCard("issue")}{actionCard("return")}{actionCard("transfer")}{actionCard("count")}{actionCard("damage")}{actionCard("loss")}</div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card><div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">Low stock</h3><p className="text-xs text-muted-foreground">Items at or below their minimum level.</p></div><Button size="sm" variant="outline" onClick={() => { setScopeFilter("low"); setSection("stock"); }}>View stock</Button></div><div className="mt-4 space-y-2">{lowItems.slice(0, 6).map((item) => <div key={item.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2"><div><p className="text-sm font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.sku} · Minimum {qty(item.minimum_stock_level)} {item.unit_code || ""}</p></div><div className="text-right"><p className="font-semibold text-amber-500">{qty(item.total_quantity)}</p><p className="text-[10px] text-muted-foreground">on hand</p></div></div>)}{!lowItems.length && <p className="text-sm text-muted-foreground">No low-stock alerts.</p>}</div></Card>
            <Card><div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">Recent inventory activity</h3><p className="text-xs text-muted-foreground">Latest auditable stock changes.</p></div><Button size="sm" variant="outline" onClick={() => setSection("transactions")}>View all</Button></div><div className="mt-4 space-y-2">{movements.slice(0, 6).map((row) => <div key={row.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs"><div><p className="font-medium">{row.item_name}</p><p className="text-muted-foreground">{label(row.movement_type)} · {row.reference || "No reference"}</p></div><span className="font-semibold">{qty(row.quantity)}</span></div>)}{!movements.length && <p className="text-sm text-muted-foreground">No stock transactions recorded yet.</p>}</div></Card>
          </div>
        </div>
      )}

      {section === "stock" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-64 flex-1 max-w-md"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search item, warehouse, project or site" className="pl-9" /></div>
            <select className={`${selectClass} w-auto min-w-44`} value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)}><option value="all">All stock</option><option value="company">Company stock</option><option value="project">Project / site stock</option><option value="low">Low stock</option></select>
            <Button variant="outline" onClick={() => openWorkflow("opening")}><ClipboardCheck className="mr-2 h-4 w-4"/>Opening Stock</Button>
            <Button onClick={() => openWorkflow("receive")}><ArrowDownToLine className="mr-2 h-4 w-4"/>Receive</Button>
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="pb-3">Item</th><th className="pb-3">Where</th><th className="pb-3">Ownership</th><th className="pb-3 text-right">Quantity</th><th className="pb-3 text-right">Unit cost</th><th className="pb-3 text-right">Value</th><th className="pb-3">Actions</th></tr></thead><tbody>{stockRows.map((row) => <tr key={row.id} className="border-t border-border"><td className="py-3"><p className="font-medium">{row.item_name}</p><p className="text-xs text-muted-foreground">{row.item_sku} · {items.find((item) => item.id === row.item_id)?.unit_code || "Unit"}</p></td><td><p>{row.warehouse_name}</p><p className="text-xs text-muted-foreground">{row.location_name || "Warehouse root"}</p></td><td>{row.project_name ? <span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">{row.project_name}</span> : <span className="text-xs text-muted-foreground">General company stock</span>}</td><td className="text-right text-base font-bold">{qty(row.quantity)}</td><td className="text-right">{money(row.unit_cost_ugx)}</td><td className="text-right font-semibold">{money(row.value_ugx)}</td><td><div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" onClick={() => openWorkflow(row.project_id ? "return" : "issue", { item_id: row.item_id, warehouse_id: row.warehouse_id, location_id: row.location_id || "", project_id: row.project_id || "" })}>{row.project_id ? "Return" : "Issue"}</Button><Button size="sm" variant="ghost" onClick={() => openWorkflow("count", { item_id: row.item_id, warehouse_id: row.warehouse_id, location_id: row.location_id || "", project_id: row.project_id || "", counted_quantity: String(row.quantity) })}>Count</Button></div></td></tr>)}{!stockRows.length && <tr><td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">No stock balances match this view. Use Opening Stock or Receive Stock to record quantity on hand.</td></tr>}</tbody></table>
          </Card>
          <Card><h3 className="font-semibold">Items without stock</h3><p className="mt-1 text-xs text-muted-foreground">Catalogue items that still have no recorded quantity.</p><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{filteredItems.filter((item) => item.total_quantity === 0).map((item) => <div key={item.id} className="flex items-center justify-between rounded-lg border border-border p-3"><div><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.sku} · {item.unit_code || "No unit"}</p></div><Button size="sm" onClick={() => openWorkflow("opening", { item_id: item.id, unit_cost_ugx: item.unit_cost_ugx ? String(item.unit_cost_ugx) : "" })}>Set Stock</Button></div>)}{!filteredItems.some((item) => item.total_quantity === 0) && <p className="text-sm text-muted-foreground">Every active item has a recorded stock balance.</p>}</div></Card>
        </div>
      )}

      {section === "warehouses" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2"><Button onClick={() => setDialog("warehouse")}><Plus className="mr-2 h-4 w-4" />New Warehouse</Button><Button variant="outline" onClick={() => setDialog("location")}>Add Room / Area / Shelf / Bin</Button></div>
          <div className="grid gap-4 lg:grid-cols-2">{warehouses.map((warehouse) => { const warehouseBalances = balances.filter((row) => row.warehouse_id === warehouse.id); const warehouseValue = warehouseBalances.reduce((sum, row) => sum + row.value_ugx, 0); return <Card key={warehouse.id}><div className="flex items-start justify-between"><div><p className="font-semibold">{warehouse.name}</p><p className="text-xs text-muted-foreground">{warehouse.code} · {warehouse.address || "No address"}</p></div><WarehouseIcon className="h-5 w-5 text-primary" /></div><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Stock value</p><p className="mt-1 font-bold">{money(warehouseValue)}</p></div><div className="rounded-lg bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Stock lines</p><p className="mt-1 font-bold">{warehouseBalances.length}</p></div></div><div className="mt-4 space-y-2">{locations.filter((location) => location.warehouse_id === warehouse.id).map((location) => <div key={location.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs"><span>{location.name} <span className="text-muted-foreground">({location.code})</span></span><span className="capitalize text-muted-foreground">{location.location_type}</span></div>)}{!locations.some((location) => location.warehouse_id === warehouse.id) && <p className="text-xs text-muted-foreground">No rooms, areas, shelves or bins added yet.</p>}</div></Card>; })}{!warehouses.length && <Card><p className="text-sm text-muted-foreground">Create the first warehouse before recording stock.</p></Card>}</div>
          <Card><h3 className="font-semibold">Registered projects / sites</h3><p className="mt-1 text-xs text-muted-foreground">Stock can be issued directly to any active registered project.</p><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{projects.map((project) => <div key={project.id} className="rounded-lg border border-border p-3"><p className="font-medium">{project.name}</p><p className="text-xs text-muted-foreground">{project.client_name} · {label(project.status)}</p><p className="mt-2 text-xs"><b>{qty(projectBalances.filter((row) => row.project_id === project.id).reduce((sum, row) => sum + row.quantity, 0))}</b> units currently allocated</p></div>)}</div></Card>
        </div>
      )}

      {section === "requests" && (
        <Card className="overflow-x-auto"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-semibold">Project stock requests</h3><p className="text-xs text-muted-foreground">Project asks → approval → stores issue → project allocation.</p></div><Button size="sm" onClick={() => setDialog("request")}><Plus className="mr-2 h-4 w-4" />New Request</Button></div><table className="w-full min-w-[760px] text-left text-xs"><thead className="text-muted-foreground"><tr><th className="pb-2">Project</th><th>Item</th><th className="text-right">Requested</th><th className="text-right">Approved</th><th>Status</th><th>Action</th></tr></thead><tbody>{requests.map((row) => <tr key={row.id} className="border-t border-border"><td className="py-3 font-medium">{row.project_name}</td><td>{row.item_name}</td><td className="text-right">{qty(row.requested_quantity)}</td><td className="text-right">{qty(row.approved_quantity)}</td><td><span className="capitalize">{row.status}</span></td><td>{row.status === "pending" && <div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => void updateRequest(row, "approved")}>Approve</Button><Button size="sm" variant="ghost" onClick={() => void updateRequest(row, "rejected")}>Reject</Button></div>}{row.status === "approved" && <Button size="sm" onClick={() => openIssueRequest(row)}>Issue Stock</Button>}{row.status === "issued" && <span className="text-emerald-500">Allocated</span>}</td></tr>)}{!requests.length && <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No stock requests yet.</td></tr>}</tbody></table></Card>
      )}

      {section === "transactions" && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">{actionCard("receive")}{actionCard("issue")}{actionCard("transfer")}{actionCard("count")}{actionCard("writeoff")}</div>
          <Card className="overflow-x-auto"><div className="mb-4"><h3 className="font-semibold">Permanent transaction history</h3><p className="text-xs text-muted-foreground">Every quantity change is recorded with type, user, date and reference.</p></div><table className="w-full min-w-[860px] text-left text-xs"><thead className="text-muted-foreground"><tr><th className="pb-2">Date</th><th>Type</th><th>Item</th><th className="text-right">Qty</th><th>Reference</th><th>Recorded by</th></tr></thead><tbody>{movements.map((row) => <tr key={row.id} className="border-t border-border"><td className="py-3">{new Date(row.created_at).toLocaleString()}</td><td>{label(row.movement_type)}</td><td>{row.item_name}<br/><span className="text-muted-foreground">{row.item_sku}</span></td><td className="text-right font-semibold">{qty(row.quantity)}</td><td>{row.reference || "—"}</td><td>{row.created_by_email}</td></tr>)}{!movements.length && <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No stock transactions recorded yet.</td></tr>}</tbody></table></Card>
        </div>
      )}

      {section === "setup" && (
        <div className="space-y-4">
          <Card><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Item catalogue</h3><p className="text-xs text-muted-foreground">Create what Star Africa stocks. Quantity is recorded through Opening Stock or Receive Stock.</p></div><div className="flex flex-wrap gap-2"><Button onClick={() => { const defaultCategory = categories.find((row) => row.name === "General Supplies") || categories[0]; const defaultUnit = units.find((row) => row.code === "PCS") || units[0]; setItemForm({ ...emptyItem, category_id: defaultCategory?.id || "", unit_id: defaultUnit?.id || "" }); setDialog("item"); }}><Plus className="mr-2 h-4 w-4"/>New Item</Button><Button variant="outline" onClick={() => setDialog("category")}>New Category</Button><Button variant="outline" onClick={() => setDialog("unit")}>New Unit</Button></div></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="pb-3">SKU</th><th>Item</th><th>Category</th><th>Unit</th><th className="text-right">On hand</th><th className="text-right">Unit cost</th><th>Alert</th></tr></thead><tbody>{filteredItems.map((item) => <tr key={item.id} className="border-t border-border"><td className="py-3 font-mono text-xs">{item.sku}</td><td className="font-medium">{item.name}</td><td>{item.category_name || "—"}</td><td>{item.unit_code || "—"}</td><td className="text-right font-semibold">{qty(item.total_quantity)}</td><td className="text-right">{money(item.unit_cost_ugx)}</td><td>{item.is_low_stock ? <span className="text-amber-500">Low stock</span> : "—"}</td></tr>)}</tbody></table></div></Card>
          <div className="grid gap-4 lg:grid-cols-2"><Card><h3 className="font-semibold">Categories</h3><div className="mt-3 flex flex-wrap gap-2">{categories.map((row) => <span key={row.id} className="rounded-full border border-border px-3 py-1 text-xs">{row.name}</span>)}</div></Card><Card><h3 className="font-semibold">Units of measure</h3><div className="mt-3 flex flex-wrap gap-2">{units.map((row) => <span key={row.id} className="rounded-full border border-border px-3 py-1 text-xs"><b>{row.code}</b> · {row.name}</span>)}</div></Card></div>
        </div>
      )}

      <Modal isOpen={dialog === "workflow"} onClose={closeDialog} title={workflowMeta[workflow].title} description={workflowMeta[workflow].description} className="max-w-2xl"><form onSubmit={saveWorkflow} className="space-y-4">
        <div className="rounded-lg border border-primary/20 bg-primary/[0.04] p-3 text-xs">You choose the business action. Star Africa records the correct permanent stock transaction automatically.</div>
        <label className="text-xs font-medium">Item<select className={`${selectClass} mt-1.5`} value={workflowForm.item_id} onChange={(e) => setWorkflowForm({ ...workflowForm, item_id: e.target.value })}><option value="">Select inventory item</option>{items.map((row) => <option key={row.id} value={row.id}>{row.sku} — {row.name} ({qty(row.total_quantity)} {row.unit_code || ""} total)</option>)}</select></label>
        <div className="grid gap-3 md:grid-cols-2"><label className="text-xs font-medium">{["issue","return","transfer","count","damage","loss","writeoff"].includes(workflow) ? "Source warehouse" : "Warehouse receiving / holding stock"}<select className={`${selectClass} mt-1.5`} value={workflowForm.warehouse_id} onChange={(e) => setWorkflowForm({ ...workflowForm, warehouse_id: e.target.value, location_id: "" })}><option value="">Select warehouse</option>{warehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="text-xs font-medium">Storage location <span className="text-muted-foreground">(optional)</span><select className={`${selectClass} mt-1.5`} value={workflowForm.location_id} onChange={(e) => setWorkflowForm({ ...workflowForm, location_id: e.target.value })}><option value="">Warehouse root / no specific location</option>{locations.filter((row) => row.warehouse_id === workflowForm.warehouse_id).map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></label></div>
        {(["return","count","damage","loss","writeoff"].includes(workflow)) && <label className="text-xs font-medium">Stock ownership / project <span className="text-muted-foreground">(leave blank for company stock)</span><select className={`${selectClass} mt-1.5`} value={workflowForm.project_id} onChange={(e) => setWorkflowForm({ ...workflowForm, project_id: e.target.value })}><option value="">General company stock</option>{projects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
        {workflow === "issue" && <label className="text-xs font-medium">Project / site receiving stock<select className={`${selectClass} mt-1.5`} value={workflowForm.to_project_id} onChange={(e) => setWorkflowForm({ ...workflowForm, to_project_id: e.target.value })}><option value="">Select registered project</option>{projects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
        {workflow === "transfer" && <div className="grid gap-3 md:grid-cols-2"><label className="text-xs font-medium">Destination warehouse<select className={`${selectClass} mt-1.5`} value={workflowForm.to_warehouse_id} onChange={(e) => setWorkflowForm({ ...workflowForm, to_warehouse_id: e.target.value, to_location_id: "" })}><option value="">Select destination</option>{warehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="text-xs font-medium">Destination location <span className="text-muted-foreground">(optional)</span><select className={`${selectClass} mt-1.5`} value={workflowForm.to_location_id} onChange={(e) => setWorkflowForm({ ...workflowForm, to_location_id: e.target.value })}><option value="">Warehouse root</option>{locations.filter((row) => row.warehouse_id === workflowForm.to_warehouse_id).map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></label></div>}
        {workflow === "return" && <div className="grid gap-3 md:grid-cols-2"><label className="text-xs font-medium">Return to warehouse<select className={`${selectClass} mt-1.5`} value={workflowForm.to_warehouse_id} onChange={(e) => setWorkflowForm({ ...workflowForm, to_warehouse_id: e.target.value, to_location_id: "" })}><option value="">Same warehouse</option>{warehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="text-xs font-medium">Return to location<select className={`${selectClass} mt-1.5`} value={workflowForm.to_location_id} onChange={(e) => setWorkflowForm({ ...workflowForm, to_location_id: e.target.value })}><option value="">Warehouse root</option>{locations.filter((row) => row.warehouse_id === (workflowForm.to_warehouse_id || workflowForm.warehouse_id)).map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></label></div>}
        {workflow === "count" ? <div className="grid gap-3 md:grid-cols-3"><div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">System quantity</p><p className="mt-1 text-xl font-bold">{qty(currentQty)}</p></div><Input label="Physical count" type="number" min="0" step="0.001" value={workflowForm.counted_quantity} onChange={(e) => setWorkflowForm({ ...workflowForm, counted_quantity: e.target.value })}/><div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">Difference</p><p className={`mt-1 text-xl font-bold ${countDelta < 0 ? "text-red-500" : countDelta > 0 ? "text-emerald-500" : ""}`}>{countDelta > 0 ? "+" : ""}{qty(countDelta)}</p></div></div> : <div className="grid gap-3 md:grid-cols-2"><Input label={`Quantity ${selectedItem?.unit_code ? `(${selectedItem.unit_code})` : ""}`} type="number" min="0.001" step="0.001" value={workflowForm.quantity} onChange={(e) => setWorkflowForm({ ...workflowForm, quantity: e.target.value })}/>{["opening","receive"].includes(workflow) && <Input label="Unit cost (UGX)" type="number" min="0" step="0.01" value={workflowForm.unit_cost_ugx} onChange={(e) => setWorkflowForm({ ...workflowForm, unit_cost_ugx: e.target.value })}/>}</div>}
        <div className="grid gap-3 md:grid-cols-2"><Input label="Reference / GRN / issue note" placeholder={workflow === "opening" ? "OPENING-STOCK-2026" : "Optional reference"} value={workflowForm.reference} onChange={(e) => setWorkflowForm({ ...workflowForm, reference: e.target.value })}/><div><label className="mb-1.5 block text-xs font-medium">Reason / notes {(["count","damage","loss","writeoff"].includes(workflow)) && <span className="text-red-400">*</span>}</label><textarea className={`${textareaClass} min-h-10`} placeholder="Explain this transaction" value={workflowForm.notes} onChange={(e) => setWorkflowForm({ ...workflowForm, notes: e.target.value })}/></div></div>
        {workflowForm.item_id && workflowForm.warehouse_id && !["opening","receive"].includes(workflow) && <div className="rounded-lg bg-muted/30 p-3 text-xs"><b>Available at selected source:</b> {qty(currentQty)} {selectedItem?.unit_code || "units"}</div>}
        <Button type="submit" className="w-full" disabled={busy}>{workflowMeta[workflow].button}</Button>
      </form></Modal>

      <Modal isOpen={dialog === "item"} onClose={closeDialog} title="New inventory item" description="Create the catalogue item first. Then use Opening Stock or Receive Stock to record quantity."><form onSubmit={saveItem} className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><Input label="SKU / item code" placeholder="e.g. CEM-001" value={itemForm.sku} onChange={(e) => setItemForm({ ...itemForm, sku: e.target.value })} /><Input label="Item name" placeholder="e.g. Cement 50kg" value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} /></div><div><label className="mb-1.5 block text-xs font-medium">Description <span className="text-muted-foreground">(optional)</span></label><textarea className={textareaClass} placeholder="Short specification" value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} /></div><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium">Category<select className={`${selectClass} mt-1.5`} value={itemForm.category_id} onChange={(e) => setItemForm({ ...itemForm, category_id: e.target.value })}><option value="">Select category</option>{categories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="text-xs font-medium">Unit of measure<select className={`${selectClass} mt-1.5`} value={itemForm.unit_id} onChange={(e) => setItemForm({ ...itemForm, unit_id: e.target.value })}><option value="">Select unit</option>{units.map((row) => <option key={row.id} value={row.id}>{row.code} - {row.name}</option>)}</select></label></div><label className="text-xs font-medium">Preferred supplier <span className="text-muted-foreground">(optional)</span><select className={`${selectClass} mt-1.5`} value={itemForm.supplier_id} onChange={(e) => setItemForm({ ...itemForm, supplier_id: e.target.value })}><option value="">No preferred supplier</option>{suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><div className="grid gap-3 sm:grid-cols-2"><Input label="Default unit cost (UGX)" type="number" min="0" step="0.01" placeholder="0" value={itemForm.unit_cost_ugx} onChange={(e) => setItemForm({ ...itemForm, unit_cost_ugx: e.target.value })} /><Input label="Low-stock alert level" type="number" min="0" step="0.001" placeholder="0" value={itemForm.minimum_stock_level} onChange={(e) => setItemForm({ ...itemForm, minimum_stock_level: e.target.value })} /></div><Button type="submit" className="w-full" disabled={busy}>Create Item</Button></form></Modal>

      <Modal isOpen={dialog === "warehouse"} onClose={closeDialog} title="New warehouse"><form onSubmit={saveWarehouse} className="space-y-3"><div className="grid grid-cols-2 gap-3"><Input label="Warehouse code" value={warehouseForm.code} onChange={(e) => setWarehouseForm({ ...warehouseForm, code: e.target.value })} /><Input label="Warehouse name" value={warehouseForm.name} onChange={(e) => setWarehouseForm({ ...warehouseForm, name: e.target.value })} /></div><Input label="Address" value={warehouseForm.address} onChange={(e) => setWarehouseForm({ ...warehouseForm, address: e.target.value })} /><textarea className={textareaClass} placeholder="Notes" value={warehouseForm.notes} onChange={(e) => setWarehouseForm({ ...warehouseForm, notes: e.target.value })} /><Button type="submit" className="w-full" disabled={busy}>Create Warehouse</Button></form></Modal>

      <Modal isOpen={dialog === "location"} onClose={closeDialog} title="Add storage location" description="Model warehouse areas, rooms, shelves and bins."><form onSubmit={saveLocation} className="space-y-3"><label className="text-xs font-medium">Warehouse<select className={`${selectClass} mt-1.5`} value={locationForm.warehouse_id} onChange={(e) => setLocationForm({ ...locationForm, warehouse_id: e.target.value, parent_location_id: "" })}><option value="">Select warehouse</option>{warehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><div className="grid grid-cols-2 gap-3"><Input label="Location code" value={locationForm.code} onChange={(e) => setLocationForm({ ...locationForm, code: e.target.value })} /><Input label="Location name" value={locationForm.name} onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })} /></div><div className="grid grid-cols-2 gap-3"><label className="text-xs font-medium">Type<select className={`${selectClass} mt-1.5`} value={locationForm.location_type} onChange={(e) => setLocationForm({ ...locationForm, location_type: e.target.value })}>{["area","room","shelf","bin"].map((type) => <option key={type} value={type}>{label(type)}</option>)}</select></label><label className="text-xs font-medium">Parent location<select className={`${selectClass} mt-1.5`} value={locationForm.parent_location_id} onChange={(e) => setLocationForm({ ...locationForm, parent_location_id: e.target.value })}><option value="">No parent</option>{locations.filter((row) => row.warehouse_id === locationForm.warehouse_id).map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></label></div><Button type="submit" className="w-full" disabled={busy}>Create Location</Button></form></Modal>

      <Modal isOpen={dialog === "request"} onClose={closeDialog} title="New project stock request"><form onSubmit={saveRequest} className="space-y-3"><label className="text-xs font-medium">Project / site<select className={`${selectClass} mt-1.5`} value={requestForm.project_id} onChange={(e) => setRequestForm({ ...requestForm, project_id: e.target.value })}><option value="">Select project</option>{projects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="text-xs font-medium">Item<select className={`${selectClass} mt-1.5`} value={requestForm.item_id} onChange={(e) => setRequestForm({ ...requestForm, item_id: e.target.value })}><option value="">Select item</option>{items.map((row) => <option key={row.id} value={row.id}>{row.sku} — {row.name}</option>)}</select></label><Input label="Requested quantity" type="number" min="0.001" step="0.001" value={requestForm.requested_quantity} onChange={(e) => setRequestForm({ ...requestForm, requested_quantity: e.target.value })} /><textarea className={textareaClass} placeholder="Reason / notes" value={requestForm.notes} onChange={(e) => setRequestForm({ ...requestForm, notes: e.target.value })} /><Button type="submit" className="w-full" disabled={busy}>Submit Request</Button></form></Modal>

      <Modal isOpen={dialog === "issue_request"} onClose={closeDialog} title="Issue approved stock" description={selectedRequest ? `${selectedRequest.item_name} → ${selectedRequest.project_name}` : "Allocate approved stock to the project."}><form onSubmit={issueRequest} className="space-y-3"><label className="text-xs font-medium">Source warehouse<select className={`${selectClass} mt-1.5`} value={issueForm.warehouse_id} onChange={(e) => setIssueForm({ ...issueForm, warehouse_id: e.target.value, location_id: "" })}><option value="">Select source warehouse</option>{warehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="text-xs font-medium">Source location<select className={`${selectClass} mt-1.5`} value={issueForm.location_id} onChange={(e) => setIssueForm({ ...issueForm, location_id: e.target.value })}><option value="">Warehouse root / no location</option>{locations.filter((row) => row.warehouse_id === issueForm.warehouse_id).map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></label><Input label="Quantity to issue" type="number" min="0.001" step="0.001" max={selectedRequest?.approved_quantity || undefined} value={issueForm.quantity} onChange={(e) => setIssueForm({ ...issueForm, quantity: e.target.value })} /><Input label="Issue reference" value={issueForm.reference} onChange={(e) => setIssueForm({ ...issueForm, reference: e.target.value })} /><textarea className={textareaClass} placeholder="Issue notes" value={issueForm.notes} onChange={(e) => setIssueForm({ ...issueForm, notes: e.target.value })} /><Button type="submit" className="w-full" disabled={busy}>Issue & Allocate to Project</Button></form></Modal>

      <Modal isOpen={dialog === "category" || dialog === "unit"} onClose={closeDialog} title={dialog === "unit" ? "New inventory unit" : "New inventory category"}><form onSubmit={saveMaster} className="space-y-3">{dialog === "unit" && <Input label="Unit code" placeholder="PCS, KG, BAG, M" value={masterForm.code} onChange={(e) => setMasterForm({ ...masterForm, code: e.target.value })} />}<Input label={dialog === "unit" ? "Unit name" : "Category name"} value={masterForm.name} onChange={(e) => setMasterForm({ ...masterForm, name: e.target.value })} />{dialog === "category" && <textarea className={textareaClass} placeholder="Description" value={masterForm.description} onChange={(e) => setMasterForm({ ...masterForm, description: e.target.value })} />}<Button type="submit" className="w-full" disabled={busy}>Save</Button></form></Modal>
    </div>
  );
};

export default InventoryPage;
