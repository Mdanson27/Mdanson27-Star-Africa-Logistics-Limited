import { apiRequest } from "@/lib/api";
const request = apiRequest;

export type BidStatus = "opportunity" | "preparing" | "submitted" | "evaluation" | "awarded" | "lost" | "cancelled";
export interface Bid {
  id:string; tender_number:string; title:string; procuring_entity:string; client_id:string|null;
  source:string|null; category:string|null; description:string|null; status:BidStatus;
  publication_date:string|null; closing_date:string|null; submission_method:string|null; submission_location:string|null;
  contact_person:string|null; contact_email:string|null; contact_phone:string|null;
  bid_fee_ugx:number; bid_security_ugx:number; estimated_value_ugx:number; internal_estimated_cost_ugx:number;
  proposed_bid_price_ugx:number; expected_profit_ugx:number; currency:string; bid_manager_email:string|null;
  team_emails:string[]; eligibility_notes:string|null; result_notes:string|null; award_date:string|null;
  award_value_ugx:number; project_id:string|null; converted_at:string|null; created_by_email:string;
  is_archived:boolean; created_at:string; updated_at:string;
}
export interface BidRequirement { id:string; bid_id:string; title:string; description:string|null; is_mandatory:boolean; status:string; responsible_email:string|null; due_date:string|null; notes:string|null; created_at:string; updated_at:string; }
export interface BidDocument { id:string; title:string; original_filename:string; category:string; content_type:string; size_bytes:number; uploaded_by_email:string; created_at:string; }
export interface BidActivity { id:string; operation:string; title:string; summary:string; changed_by:string|null; created_at:string; }
export interface BidWorkspace { bid:Bid; requirements:BidRequirement[]; documents:BidDocument[]; activity:BidActivity[]; }
export interface BidDashboard { total_bids:number; open_opportunities:number; preparing:number; submitted:number; evaluation:number; awarded:number; lost:number; due_within_7_days:number; overdue_open:number; pipeline_value_ugx:number; awarded_value_ugx:number; win_rate_percent:number; }
const query=(params?:Record<string,string|boolean|undefined>)=>{ const s=new URLSearchParams(); Object.entries(params||{}).forEach(([k,v])=>{if(v!==undefined&&v!=="")s.set(k,String(v));}); return s.size?`?${s}`:""; };
export const bidsApi = {
  list:(params?:{q?:string;status?:string;include_archived?:boolean})=>request<Bid[]>(`/bids${query(params)}`),
  dashboard:()=>request<BidDashboard>("/bids/dashboard"),
  get:(id:string)=>request<Bid>(`/bids/${id}`),
  workspace:(id:string)=>request<BidWorkspace>(`/bids/${id}/workspace`),
  create:(body:Record<string,unknown>)=>request<Bid>("/bids",{method:"POST",body:JSON.stringify(body)}),
  update:(id:string,body:Record<string,unknown>)=>request<Bid>(`/bids/${id}`,{method:"PATCH",body:JSON.stringify(body)}),
  addRequirement:(id:string,body:Record<string,unknown>)=>request<BidRequirement>(`/bids/${id}/requirements`,{method:"POST",body:JSON.stringify(body)}),
  updateRequirement:(bidId:string,id:string,body:Record<string,unknown>)=>request<BidRequirement>(`/bids/${bidId}/requirements/${id}`,{method:"PATCH",body:JSON.stringify(body)}),
  deleteRequirement:(bidId:string,id:string)=>request<{message:string}>(`/bids/${bidId}/requirements/${id}`,{method:"DELETE"}),
  convert:(id:string,body:Record<string,unknown>={})=>request<{id:string;name:string}>(`/bids/${id}/convert-to-project`,{method:"POST",body:JSON.stringify(body)}),
};
