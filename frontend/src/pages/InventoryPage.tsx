import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  Boxes,
  PackagePlus,
  Plus,
  RefreshCw,
  Warehouse as WarehouseIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SectionNav } from "@/components/common/SectionNav";
import { SyncStatus } from "@/components/common/SyncStatus";
import { useCustomToast } from "@/hooks/useCustomToast";
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

type Section = "dashboard" | "items" | "warehouses" | "stock" | "movements" | "requests" | "low_stock";
type Dialog = "item" | "warehouse" | "location" | "movement" | "request" | "issue_request" | "category" | "unit" | null;

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
const textareaClass = "min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
const money = (value: number) => new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 }).format(value || 0);
const qty = (value: number) => new Intl.NumberFormat("en-UG", { maximumFractionDigits: 3 }).format(value || 0);
const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());

const emptyItem = { sku: "", name: "", description: "", category_id: "", unit_id: "", supplier_id: "", unit_cost_ugx: "", minimum_stock_level: "" };
const emptyWarehouse = { code: "", name: "", address: "", notes: "" };
const emptyLocation = { warehouse_id: "", parent_location_id: "", code: "", name: "", location_type: "area" };
const emptyMovement = {
  item_id: "", movement_type: "stock_in", quantity: "", unit_cost_ugx: "", reference: "", notes: "",
  from_warehouse_id: "", from_location_id: "", from_project_id: "", to_warehouse_id: "", to_location_id: "", to_project_id: "",
};
const emptyRequest = { project_id: "", item_id: "", requested_quantity: "", notes: "" };
const emptyIssue = { warehouse_id: "", location_id: "", quantity: "", reference: "", notes: "" };

export const InventoryPage: React.FC = () => {
  const { showSuccessToast, showErrorToast, showWarningToast } = useCustomToast();
  const [section, setSection] = useState<Section>("dashboard");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<InventoryDashboard | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [movements, setMovements] = useState<StockTransaction[]>([]);
  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [itemForm, setItemForm] = useState(emptyItem);
  const [warehouseForm, setWarehouseForm] = useState(emptyWarehouse);
  const [locationForm, setLocationForm] = useState(emptyLocation);
  const [movementForm, setMovementForm] = useState(emptyMovement);
  const [requestForm, setRequestForm] = useState(emptyRequest);
  const [issueForm, setIssueForm] = useState(emptyIssue);
  const [selectedRequest, setSelectedRequest] = useState<StockRequest | null>(null);
  const [masterForm, setMasterForm] = useState({ code: "", name: "", description: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summary, itemRows, categoryRows, unitRows, warehouseRows, locationRows, balanceRows, movementRows, requestRows, supplierRows, projectRows] = await Promise.all([
        inventoryApi.dashboard(), inventoryApi.items(), inventoryApi.categories(), inventoryApi.units(), inventoryApi.warehouses(), inventoryApi.locations(),
        inventoryApi.balances(), inventoryApi.movements({ limit: 150 }), inventoryApi.requests(), businessApi.suppliers(), workspaceApi.projects({ include_archived: false }),
      ]);
      setDashboard(summary); setItems(itemRows); setCategories(categoryRows); setUnits(unitRows); setWarehouses(warehouseRows); setLocations(locationRows);
      setBalances(balanceRows); setMovements(movementRows); setRequests(requestRows); setSuppliers(supplierRows); setProjects(projectRows);
      setLastSyncedAt(new Date().toISOString());
    } catch (error) {
      showErrorToast(getErrorMessage(error, "Inventory could not be refreshed."), "Inventory unavailable");
    } finally {
      setLoading(false);
    }
  }, [showErrorToast]);

  useEffect(() => { void load(); }, [load]);

  const filteredItems = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter((item) => !term || `${item.sku} ${item.name} ${item.category_name || ""}`.toLowerCase().includes(term));
  }, [items, query]);
  const lowItems = useMemo(() => items.filter((item) => item.is_low_stock), [items]);
  const companyBalances = useMemo(() => balances.filter((row) => !row.project_id), [balances]);
  const projectBalances = useMemo(() => balances.filter((row) => Boolean(row.project_id)), [balances]);

  const sections = [
    { id: "dashboard" as const, label: "Dashboard" },
    { id: "items" as const, label: "Items", count: items.length },
    { id: "warehouses" as const, label: "Warehouses", count: warehouses.length },
    { id: "stock" as const, label: "Stock" },
    { id: "movements" as const, label: "Movements", count: movements.length },
    { id: "requests" as const, label: "Requests", count: requests.filter((r) => r.status === "pending").length },
    { id: "low_stock" as const, label: "Low Stock", count: lowItems.length },
  ];

  const closeDialog = () => { if (!busy) setDialog(null); };

  const saveItem = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!itemForm.sku.trim() || !itemForm.name.trim()) { showWarningToast("SKU and item name are required.", "Check item"); return; }
    setBusy(true);
    try {
      await inventoryApi.createItem({
        sku: itemForm.sku, name: itemForm.name, description: itemForm.description || null,
        category_id: itemForm.category_id || null, unit_id: itemForm.unit_id || null, supplier_id: itemForm.supplier_id || null,
        unit_cost_ugx: Number(itemForm.unit_cost_ugx || 0), minimum_stock_level: Number(itemForm.minimum_stock_level || 0),
      });
      setItemForm(emptyItem); setDialog(null); await load(); showSuccessToast("Inventory item created.", "Item saved");
    } catch (error) { showErrorToast(getErrorMessage(error, "Item could not be saved."), "Item not saved"); } finally { setBusy(false); }
  };

  const saveWarehouse = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { await inventoryApi.createWarehouse(warehouseForm); setWarehouseForm(emptyWarehouse); setDialog(null); await load(); showSuccessToast("Warehouse created.", "Warehouse saved"); }
    catch (error) { showErrorToast(getErrorMessage(error, "Warehouse could not be saved."), "Warehouse not saved"); } finally { setBusy(false); }
  };

  const saveLocation = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      await inventoryApi.createLocation({ ...locationForm, parent_location_id: locationForm.parent_location_id || null });
      setLocationForm(emptyLocation); setDialog(null); await load(); showSuccessToast("Storage location created.", "Location saved");
    } catch (error) { showErrorToast(getErrorMessage(error, "Location could not be saved."), "Location not saved"); } finally { setBusy(false); }
  };

  const saveMovement = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!movementForm.item_id || Number(movementForm.quantity) <= 0) { showWarningToast("Select an item and enter a quantity greater than zero.", "Check movement"); return; }
    setBusy(true);
    try {
      await inventoryApi.createMovement({
        ...movementForm, quantity: Number(movementForm.quantity), unit_cost_ugx: movementForm.unit_cost_ugx ? Number(movementForm.unit_cost_ugx) : null,
        from_warehouse_id: movementForm.from_warehouse_id || null, from_location_id: movementForm.from_location_id || null, from_project_id: movementForm.from_project_id || null,
        to_warehouse_id: movementForm.to_warehouse_id || null, to_location_id: movementForm.to_location_id || null, to_project_id: movementForm.to_project_id || null,
        reference: movementForm.reference || null, notes: movementForm.notes || null,
      });
      setMovementForm(emptyMovement); setDialog(null); await load(); showSuccessToast("Stock transaction posted and balances updated.", "Movement recorded");
    } catch (error) { showErrorToast(getErrorMessage(error, "Stock movement could not be recorded."), "Movement failed"); } finally { setBusy(false); }
  };

  const saveRequest = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      await inventoryApi.createRequest({ ...requestForm, requested_quantity: Number(requestForm.requested_quantity), notes: requestForm.notes || null });
      setRequestForm(emptyRequest); setDialog(null); await load(); showSuccessToast("Stock request submitted.", "Request created");
    } catch (error) { showErrorToast(getErrorMessage(error, "Stock request could not be created."), "Request failed"); } finally { setBusy(false); }
  };

  const saveMaster = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      if (dialog === "category") await inventoryApi.createCategory({ name: masterForm.name, description: masterForm.description || null });
      if (dialog === "unit") await inventoryApi.createUnit({ code: masterForm.code, name: masterForm.name });
      setMasterForm({ code: "", name: "", description: "" }); setDialog(null); await load(); showSuccessToast("Master data saved.", "Saved");
    } catch (error) { showErrorToast(getErrorMessage(error, "Master data could not be saved."), "Not saved"); } finally { setBusy(false); }
  };

  const updateRequest = async (request: StockRequest, status: string) => {
    try {
      await inventoryApi.updateRequest(request.id, { status, approved_quantity: status === "approved" ? request.requested_quantity : request.approved_quantity });
      await load(); showSuccessToast(`Request ${status}.`, "Request updated");
    } catch (error) { showErrorToast(getErrorMessage(error, "Request could not be updated."), "Request not updated"); }
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
      await inventoryApi.issueRequest(selectedRequest.id, {
        warehouse_id: issueForm.warehouse_id,
        location_id: issueForm.location_id || null,
        quantity: Number(issueForm.quantity || selectedRequest.approved_quantity),
        reference: issueForm.reference || null,
        notes: issueForm.notes || null,
      });
      setIssueForm(emptyIssue); setSelectedRequest(null); setDialog(null); await load();
      showSuccessToast("Approved stock was allocated to the project and recorded in movement history.", "Stock issued");
    } catch (error) { showErrorToast(getErrorMessage(error, "Approved stock could not be issued."), "Issue failed"); }
    finally { setBusy(false); }
  };

  const metric = (title: string, value: React.ReactNode, helper: string, icon: React.ReactNode) => (
    <Card><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">{title}</p><p className="mt-2 text-xl font-bold">{value}</p><p className="mt-1 text-[10px] text-muted-foreground">{helper}</p></div><div className="rounded-lg bg-primary/10 p-2 text-primary">{icon}</div></div></Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold">Inventory & Warehouses</h1><p className="mt-1 text-sm text-muted-foreground">Control company and project stock with a complete auditable movement trail.</p></div>
        <div className="flex items-center gap-2"><SyncStatus isRefreshing={loading} lastSyncedAt={lastSyncedAt} /><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button><Button onClick={() => setDialog("movement")}><ArrowRightLeft className="mr-2 h-4 w-4" />Stock Movement</Button></div>
      </div>

      <SectionNav items={sections} active={section} onChange={setSection} ariaLabel="Inventory sections" />

      {section === "dashboard" && (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {metric("Inventory value", money(dashboard?.inventory_value_ugx || 0), `${qty(dashboard?.total_quantity || 0)} units on hand`, <Boxes className="h-4 w-4" />)}
            {metric("Items", dashboard?.items || 0, "Active stock items", <PackagePlus className="h-4 w-4" />)}
            {metric("Warehouses", dashboard?.warehouses || 0, "Active warehouse sites", <WarehouseIcon className="h-4 w-4" />)}
            {metric("Low stock", dashboard?.low_stock_items || 0, "At or below minimum level", <AlertTriangle className="h-4 w-4" />)}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><h3 className="font-semibold">Stock ownership</h3><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-lg border border-border p-4"><p className="text-xs text-muted-foreground">General company stock</p><p className="mt-2 text-lg font-bold">{money((dashboard?.inventory_value_ugx || 0) - (dashboard?.project_stock_value_ugx || 0))}</p></div><div className="rounded-lg border border-border p-4"><p className="text-xs text-muted-foreground">Allocated to projects</p><p className="mt-2 text-lg font-bold">{money(dashboard?.project_stock_value_ugx || 0)}</p></div></div></Card>
            <Card><h3 className="font-semibold">Recent movement</h3><div className="mt-3 space-y-2">{(dashboard?.recent_movements || []).slice(0, 5).map((row) => <div key={row.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs"><div><p className="font-medium">{row.item_name}</p><p className="text-muted-foreground">{label(row.movement_type)} · {row.reference || "No reference"}</p></div><span className="font-semibold">{qty(row.quantity)}</span></div>)}{!dashboard?.recent_movements.length && <p className="text-sm text-muted-foreground">No stock movements yet.</p>}</div></Card>
          </div>
        </div>
      )}

      {section === "items" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2"><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search item name, SKU or category" className="max-w-sm" /><Button onClick={() => setDialog("item")}><Plus className="mr-2 h-4 w-4" />New Item</Button><Button variant="outline" onClick={() => setDialog("category")}>New Category</Button><Button variant="outline" onClick={() => setDialog("unit")}>New Unit</Button></div>
          <Card className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="pb-3">SKU</th><th className="pb-3">Item</th><th className="pb-3">Category</th><th className="pb-3">Unit</th><th className="pb-3 text-right">Qty</th><th className="pb-3 text-right">Unit cost</th><th className="pb-3 text-right">Value</th><th className="pb-3">Status</th></tr></thead><tbody>{filteredItems.map((item) => <tr key={item.id} className="border-t border-border"><td className="py-3 font-mono text-xs">{item.sku}</td><td className="py-3 font-medium">{item.name}</td><td className="py-3">{item.category_name || "—"}</td><td className="py-3">{item.unit_code || "—"}</td><td className="py-3 text-right">{qty(item.total_quantity)}</td><td className="py-3 text-right">{money(item.unit_cost_ugx)}</td><td className="py-3 text-right">{money(item.total_value_ugx)}</td><td className="py-3"><span className={item.is_low_stock ? "rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-500" : "rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-500"}>{item.is_low_stock ? "Low stock" : "In stock"}</span></td></tr>)}</tbody></table></Card>
        </div>
      )}

      {section === "warehouses" && (
        <div className="space-y-4"><div className="flex gap-2"><Button onClick={() => setDialog("warehouse")}><Plus className="mr-2 h-4 w-4" />New Warehouse</Button><Button variant="outline" onClick={() => setDialog("location")}>Add Room / Shelf / Bin</Button></div><div className="grid gap-4 lg:grid-cols-2">{warehouses.map((warehouse) => <Card key={warehouse.id}><div className="flex items-start justify-between"><div><p className="font-semibold">{warehouse.name}</p><p className="text-xs text-muted-foreground">{warehouse.code} · {warehouse.address || "No address"}</p></div><WarehouseIcon className="h-5 w-5 text-primary" /></div><div className="mt-4 space-y-2">{locations.filter((location) => location.warehouse_id === warehouse.id).map((location) => <div key={location.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs"><span>{location.name} <span className="text-muted-foreground">({location.code})</span></span><span className="capitalize text-muted-foreground">{location.location_type}</span></div>)}{!locations.some((location) => location.warehouse_id === warehouse.id) && <p className="text-xs text-muted-foreground">No rooms, areas, shelves or bins added yet.</p>}</div></Card>)}</div></div>
      )}

      {section === "stock" && (
        <div className="grid gap-4 xl:grid-cols-2"><Card className="overflow-x-auto"><h3 className="mb-4 font-semibold">General company stock</h3><table className="w-full text-left text-xs"><thead className="text-muted-foreground"><tr><th className="pb-2">Item</th><th>Warehouse / Location</th><th className="text-right">Qty</th><th className="text-right">Value</th></tr></thead><tbody>{companyBalances.map((row) => <tr key={row.id} className="border-t border-border"><td className="py-2"><b>{row.item_name}</b><br/><span className="text-muted-foreground">{row.item_sku}</span></td><td>{row.warehouse_name}<br/><span className="text-muted-foreground">{row.location_name || "Warehouse root"}</span></td><td className="text-right">{qty(row.quantity)}</td><td className="text-right">{money(row.value_ugx)}</td></tr>)}</tbody></table></Card><Card className="overflow-x-auto"><h3 className="mb-4 font-semibold">Project stock</h3><table className="w-full text-left text-xs"><thead className="text-muted-foreground"><tr><th className="pb-2">Project</th><th>Item</th><th>Warehouse</th><th className="text-right">Qty</th></tr></thead><tbody>{projectBalances.map((row) => <tr key={row.id} className="border-t border-border"><td className="py-2 font-medium">{row.project_name}</td><td>{row.item_name}<br/><span className="text-muted-foreground">{row.item_sku}</span></td><td>{row.warehouse_name}</td><td className="text-right">{qty(row.quantity)}</td></tr>)}</tbody></table></Card></div>
      )}

      {section === "movements" && <Card className="overflow-x-auto"><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">Movement history</h3><Button size="sm" onClick={() => setDialog("movement")}><Plus className="mr-2 h-4 w-4" />Record Movement</Button></div><table className="w-full text-left text-xs"><thead className="text-muted-foreground"><tr><th className="pb-2">Date</th><th>Type</th><th>Item</th><th className="text-right">Qty</th><th>Reference</th><th>Recorded by</th></tr></thead><tbody>{movements.map((row) => <tr key={row.id} className="border-t border-border"><td className="py-2">{new Date(row.created_at).toLocaleString()}</td><td>{label(row.movement_type)}</td><td>{row.item_name}<br/><span className="text-muted-foreground">{row.item_sku}</span></td><td className="text-right font-semibold">{qty(row.quantity)}</td><td>{row.reference || "—"}</td><td>{row.created_by_email}</td></tr>)}</tbody></table></Card>}

      {section === "requests" && <Card className="overflow-x-auto"><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">Stock request workflow</h3><Button size="sm" onClick={() => setDialog("request")}><Plus className="mr-2 h-4 w-4" />New Request</Button></div><table className="w-full text-left text-xs"><thead className="text-muted-foreground"><tr><th className="pb-2">Project</th><th>Item</th><th className="text-right">Requested</th><th className="text-right">Approved</th><th>Status</th><th>Action</th></tr></thead><tbody>{requests.map((row) => <tr key={row.id} className="border-t border-border"><td className="py-2 font-medium">{row.project_name}</td><td>{row.item_name}</td><td className="text-right">{qty(row.requested_quantity)}</td><td className="text-right">{qty(row.approved_quantity)}</td><td><span className="capitalize">{row.status}</span></td><td>{row.status === "pending" && <div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => void updateRequest(row, "approved")}>Approve</Button><Button size="sm" variant="ghost" onClick={() => void updateRequest(row, "rejected")}>Reject</Button></div>}{row.status === "approved" && <Button size="sm" onClick={() => openIssueRequest(row)}>Issue Stock</Button>}{row.status === "issued" && <span className="text-emerald-500">Allocated</span>}</td></tr>)}</tbody></table></Card>}

      {section === "low_stock" && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{lowItems.map((item) => <Card key={item.id}><div className="flex items-start justify-between"><div><p className="font-semibold">{item.name}</p><p className="text-xs text-muted-foreground">{item.sku} · Minimum {qty(item.minimum_stock_level)}</p></div><AlertTriangle className="h-5 w-5 text-amber-500" /></div><p className="mt-4 text-2xl font-bold">{qty(item.total_quantity)}</p><p className="text-xs text-muted-foreground">Current stock · {money(item.total_value_ugx)}</p></Card>)}{!lowItems.length && <Card><p className="text-sm text-muted-foreground">No low-stock alerts.</p></Card>}</div>}

      <Modal isOpen={dialog === "item"} onClose={closeDialog} title="New inventory item" description="Create the SKU, costing and stock-control settings."><form onSubmit={saveItem} className="space-y-3"><div className="grid grid-cols-2 gap-3"><Input placeholder="SKU / item code" value={itemForm.sku} onChange={(e) => setItemForm({ ...itemForm, sku: e.target.value })} /><Input placeholder="Item name" value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} /></div><textarea className={textareaClass} placeholder="Description" value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} /><div className="grid grid-cols-2 gap-3"><select className={selectClass} value={itemForm.category_id} onChange={(e) => setItemForm({ ...itemForm, category_id: e.target.value })}><option value="">Category</option>{categories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><select className={selectClass} value={itemForm.unit_id} onChange={(e) => setItemForm({ ...itemForm, unit_id: e.target.value })}><option value="">Unit</option>{units.map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></div><select className={selectClass} value={itemForm.supplier_id} onChange={(e) => setItemForm({ ...itemForm, supplier_id: e.target.value })}><option value="">Preferred supplier (optional)</option>{suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><div className="grid grid-cols-2 gap-3"><Input type="number" min="0" step="0.01" placeholder="Unit cost UGX" value={itemForm.unit_cost_ugx} onChange={(e) => setItemForm({ ...itemForm, unit_cost_ugx: e.target.value })} /><Input type="number" min="0" step="0.001" placeholder="Minimum stock level" value={itemForm.minimum_stock_level} onChange={(e) => setItemForm({ ...itemForm, minimum_stock_level: e.target.value })} /></div><Button type="submit" className="w-full" disabled={busy}>Create Item</Button></form></Modal>

      <Modal isOpen={dialog === "warehouse"} onClose={closeDialog} title="New warehouse"><form onSubmit={saveWarehouse} className="space-y-3"><div className="grid grid-cols-2 gap-3"><Input placeholder="Warehouse code" value={warehouseForm.code} onChange={(e) => setWarehouseForm({ ...warehouseForm, code: e.target.value })} /><Input placeholder="Warehouse name" value={warehouseForm.name} onChange={(e) => setWarehouseForm({ ...warehouseForm, name: e.target.value })} /></div><Input placeholder="Address" value={warehouseForm.address} onChange={(e) => setWarehouseForm({ ...warehouseForm, address: e.target.value })} /><textarea className={textareaClass} placeholder="Notes" value={warehouseForm.notes} onChange={(e) => setWarehouseForm({ ...warehouseForm, notes: e.target.value })} /><Button type="submit" className="w-full" disabled={busy}>Create Warehouse</Button></form></Modal>

      <Modal isOpen={dialog === "location"} onClose={closeDialog} title="Add storage location" description="Model warehouse areas, rooms, shelves and bins."><form onSubmit={saveLocation} className="space-y-3"><select className={selectClass} value={locationForm.warehouse_id} onChange={(e) => setLocationForm({ ...locationForm, warehouse_id: e.target.value, parent_location_id: "" })}><option value="">Select warehouse</option>{warehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><div className="grid grid-cols-2 gap-3"><Input placeholder="Location code" value={locationForm.code} onChange={(e) => setLocationForm({ ...locationForm, code: e.target.value })} /><Input placeholder="Location name" value={locationForm.name} onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })} /></div><div className="grid grid-cols-2 gap-3"><select className={selectClass} value={locationForm.location_type} onChange={(e) => setLocationForm({ ...locationForm, location_type: e.target.value })}>{["area","room","shelf","bin"].map((type) => <option key={type} value={type}>{label(type)}</option>)}</select><select className={selectClass} value={locationForm.parent_location_id} onChange={(e) => setLocationForm({ ...locationForm, parent_location_id: e.target.value })}><option value="">No parent</option>{locations.filter((row) => row.warehouse_id === locationForm.warehouse_id).map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select></div><Button type="submit" className="w-full" disabled={busy}>Create Location</Button></form></Modal>

      <Modal isOpen={dialog === "movement"} onClose={closeDialog} title="Record stock movement" description="Every posting creates a permanent auditable stock transaction." className="max-w-3xl"><form onSubmit={saveMovement} className="space-y-4"><div className="grid gap-3 md:grid-cols-3"><select className={selectClass} value={movementForm.movement_type} onChange={(e) => setMovementForm({ ...movementForm, movement_type: e.target.value })}>{["stock_in","stock_out","transfer","project_allocation","project_return","adjustment_in","adjustment_out","damaged","lost","write_off"].map((type) => <option key={type} value={type}>{label(type)}</option>)}</select><select className={selectClass} value={movementForm.item_id} onChange={(e) => setMovementForm({ ...movementForm, item_id: e.target.value })}><option value="">Select item</option>{items.map((row) => <option key={row.id} value={row.id}>{row.sku} — {row.name}</option>)}</select><Input type="number" min="0.001" step="0.001" placeholder="Quantity" value={movementForm.quantity} onChange={(e) => setMovementForm({ ...movementForm, quantity: e.target.value })} /></div><div className="grid gap-4 md:grid-cols-2"><div className="rounded-lg border border-border p-3"><p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">From</p><div className="space-y-2"><select className={selectClass} value={movementForm.from_warehouse_id} onChange={(e) => setMovementForm({ ...movementForm, from_warehouse_id: e.target.value, from_location_id: "" })}><option value="">No source warehouse</option>{warehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><select className={selectClass} value={movementForm.from_location_id} onChange={(e) => setMovementForm({ ...movementForm, from_location_id: e.target.value })}><option value="">Warehouse root / no location</option>{locations.filter((row) => row.warehouse_id === movementForm.from_warehouse_id).map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select><select className={selectClass} value={movementForm.from_project_id} onChange={(e) => setMovementForm({ ...movementForm, from_project_id: e.target.value })}><option value="">General company stock</option>{projects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></div></div><div className="rounded-lg border border-border p-3"><p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">To</p><div className="space-y-2"><select className={selectClass} value={movementForm.to_warehouse_id} onChange={(e) => setMovementForm({ ...movementForm, to_warehouse_id: e.target.value, to_location_id: "" })}><option value="">No destination warehouse</option>{warehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><select className={selectClass} value={movementForm.to_location_id} onChange={(e) => setMovementForm({ ...movementForm, to_location_id: e.target.value })}><option value="">Warehouse root / no location</option>{locations.filter((row) => row.warehouse_id === movementForm.to_warehouse_id).map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select><select className={selectClass} value={movementForm.to_project_id} onChange={(e) => setMovementForm({ ...movementForm, to_project_id: e.target.value })}><option value="">General company stock</option>{projects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></div></div></div><div className="grid gap-3 md:grid-cols-3"><Input type="number" min="0" step="0.01" placeholder="Unit cost UGX (optional)" value={movementForm.unit_cost_ugx} onChange={(e) => setMovementForm({ ...movementForm, unit_cost_ugx: e.target.value })} /><Input placeholder="Reference / GRN / issue note" value={movementForm.reference} onChange={(e) => setMovementForm({ ...movementForm, reference: e.target.value })} /><Input placeholder="Notes" value={movementForm.notes} onChange={(e) => setMovementForm({ ...movementForm, notes: e.target.value })} /></div><Button type="submit" className="w-full" disabled={busy}>Post Stock Transaction</Button></form></Modal>

      <Modal isOpen={dialog === "request"} onClose={closeDialog} title="New stock request"><form onSubmit={saveRequest} className="space-y-3"><select className={selectClass} value={requestForm.project_id} onChange={(e) => setRequestForm({ ...requestForm, project_id: e.target.value })}><option value="">Select project</option>{projects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><select className={selectClass} value={requestForm.item_id} onChange={(e) => setRequestForm({ ...requestForm, item_id: e.target.value })}><option value="">Select item</option>{items.map((row) => <option key={row.id} value={row.id}>{row.sku} — {row.name}</option>)}</select><Input type="number" min="0.001" step="0.001" placeholder="Requested quantity" value={requestForm.requested_quantity} onChange={(e) => setRequestForm({ ...requestForm, requested_quantity: e.target.value })} /><textarea className={textareaClass} placeholder="Reason / notes" value={requestForm.notes} onChange={(e) => setRequestForm({ ...requestForm, notes: e.target.value })} /><Button type="submit" className="w-full" disabled={busy}>Submit Request</Button></form></Modal>

      <Modal isOpen={dialog === "issue_request"} onClose={closeDialog} title="Issue approved stock" description={selectedRequest ? `${selectedRequest.item_name} → ${selectedRequest.project_name}` : "Allocate approved stock to the project."}><form onSubmit={issueRequest} className="space-y-3"><select className={selectClass} value={issueForm.warehouse_id} onChange={(e) => setIssueForm({ ...issueForm, warehouse_id: e.target.value, location_id: "" })}><option value="">Select source warehouse</option>{warehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><select className={selectClass} value={issueForm.location_id} onChange={(e) => setIssueForm({ ...issueForm, location_id: e.target.value })}><option value="">Warehouse root / no location</option>{locations.filter((row) => row.warehouse_id === issueForm.warehouse_id).map((row) => <option key={row.id} value={row.id}>{row.code} — {row.name}</option>)}</select><Input type="number" min="0.001" step="0.001" max={selectedRequest?.approved_quantity || undefined} placeholder="Quantity to issue" value={issueForm.quantity} onChange={(e) => setIssueForm({ ...issueForm, quantity: e.target.value })} /><Input placeholder="Issue reference (optional)" value={issueForm.reference} onChange={(e) => setIssueForm({ ...issueForm, reference: e.target.value })} /><textarea className={textareaClass} placeholder="Issue notes" value={issueForm.notes} onChange={(e) => setIssueForm({ ...issueForm, notes: e.target.value })} /><Button type="submit" className="w-full" disabled={busy}>Issue & Allocate to Project</Button></form></Modal>

      <Modal isOpen={dialog === "category" || dialog === "unit"} onClose={closeDialog} title={dialog === "unit" ? "New inventory unit" : "New inventory category"}><form onSubmit={saveMaster} className="space-y-3">{dialog === "unit" && <Input placeholder="Unit code e.g. PCS, KG, M" value={masterForm.code} onChange={(e) => setMasterForm({ ...masterForm, code: e.target.value })} />}<Input placeholder={dialog === "unit" ? "Unit name" : "Category name"} value={masterForm.name} onChange={(e) => setMasterForm({ ...masterForm, name: e.target.value })} />{dialog === "category" && <textarea className={textareaClass} placeholder="Description" value={masterForm.description} onChange={(e) => setMasterForm({ ...masterForm, description: e.target.value })} />}<Button type="submit" className="w-full" disabled={busy}>Save</Button></form></Modal>
    </div>
  );
};

export default InventoryPage;
