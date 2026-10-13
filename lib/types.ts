export type Role = 'preparer' | 'approver' | 'admin';
export type ProfileStatus = 'new' | 'pending' | 'active' | 'rejected' | 'disabled';
export type RequestStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'cancelled';
export type StepStatus = 'waiting' | 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface Profile {
  id: string;
  email: string;
  name: string;
  title: string;
  dept: string | null;
  roles: Role[];
  position: string | null;
  status: ProfileStatus;
  requested_roles: Role[];
  apply_note: string;
  review_note: string;
  applied_at: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface Settings {
  id: number;
  vat_rate: number;
  recipient: string;
  request_prefix: string;
}
export interface Position { code: string; th: string; en: string; sort: number }
export interface Tier { id: number; label: string; max_amount: number | null; steps: string[]; sort: number }
export interface Department { id: string; th: string; en: string; sort: number; active: boolean }
export interface Company {
  id: string; th: string; en: string; initials: string; address: string;
  logo_path: string | null; sort: number; active: boolean;
}
export interface Product { sku: string; name: string; category: string; unit: string; active: boolean; updated_at?: string }

export interface Comparison {
  vendor: string;
  unit_price: number;
  subtotal?: number;
  total?: number;
  diff?: number;
}

export interface RequestStep {
  id?: number;
  request_id?: string;
  step_no: number;
  position: string;
  approver_id: string | null;
  status: StepStatus;
  acted_at?: string | null;
  comment?: string;
  signature?: string | null;
  signer_id?: string | null;
  on_behalf_of?: string | null;
}

export interface RequestRow {
  id: string;
  no: string | null;
  status: RequestStatus;
  preparer_id: string;
  subject_type: 'stock' | 'general' | 'hire';
  sku: string;
  product_name: string;
  qty: number;
  unit: string;
  unit_price: number;
  subtotal: number;
  vat: number;
  total: number;
  vat_rate: number;
  dept: string | null;
  purpose: 'repair' | 'replace' | 'stock';
  buyer_id: string | null;
  company_id: string | null;
  vendor: string;
  quote_no: string;
  quote_date: string | null;
  details: string;
  comparisons: Comparison[];
  no_comp: boolean;
  no_comp_reason: string;
  low_reason: string;
  message: string;
  tier_label: string;
  current_step: number;
  preparer_signature?: string | null;
  created_at: string;
  updated_at?: string;
  submitted_at: string | null;
  step_since: string | null;
  completed_at: string | null;
  letter_path: string | null;
  letter_at: string | null;
  request_steps?: RequestStep[];
}

export interface RequestFile {
  id: number; request_id: string; path: string; name: string; size: number; mime: string;
  uploaded_by: string; created_at: string;
}

export interface LogEntry {
  id: number; request_id: string; at: string; actor_id: string | null;
  kind: string; text: string; comment: string; target_id: string | null;
}

export interface Notification {
  id: number; user_id: string; request_id: string | null; kind: 'wait' | 'ok' | 'bad' | 'info';
  title: string; body: string; link: string; read_at: string | null; created_at: string;
}

export interface AppError {
  id: number; user_id: string | null; at: string; page: string; action: string; message: string;
  detail: string; user_agent: string; status: 'open' | 'investigating' | 'fixed' | 'ignored';
  admin_note: string; updated_at: string;
}

export interface ApproverPreview {
  step_no: number; pos: string; pos_th: string; approver_id: string | null;
  approver_name: string | null; has_signature: boolean; tier_label: string;
}
