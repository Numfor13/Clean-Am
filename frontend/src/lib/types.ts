// Shapes returned by the CLEAN-AM API (see backend/README.md, "API").

export type Role = "Citizen" | "Employee" | "Admin";
export type Lang = "en" | "fr";
export type ReportStatus = "PENDING" | "IN_PROGRESS" | "DONE";

export type Category =
  | "ILLEGAL_DUMPING"
  | "OVERFLOWING_BIN"
  | "BLOCKED_DRAIN"
  | "BURNING_WASTE"
  | "HOUSEHOLD_WASTE"
  | "OTHER";

export type FlagReason =
  | "NOT_WASTE"
  | "DUPLICATE"
  | "WRONG_LOCATION"
  | "STAGED"
  | "ALREADY_COLLECTED"
  | "OTHER";

export interface StatusHistoryEntry {
  status: ReportStatus;
  from_status?: ReportStatus | null;
  at: string;
  by?: string;
  by_username?: string;
  by_role?: string;
  note?: string | null;
}

export interface Flag {
  flag_id: string;
  report_id: string;
  citizen_id?: string;
  reason: FlagReason;
  reason_label?: string;
  note?: string | null;
  flagged_at: string;
  flagged_by?: string;
  flagged_by_username?: string;
}

export interface Report {
  report_id: string;
  citizen_id?: string;
  reporter_type?: "citizen" | "guest";
  username: string;
  category?: Category;
  photo_url?: string | null;
  latitude: number | string;
  longitude: number | string;
  quarter: string;
  city?: string;
  address_hint?: string | null;
  description?: string | null;
  status: ReportStatus;
  is_fraudulent?: boolean;
  flag_count?: number;
  created_at: string;
  updated_at?: string;
  status_history?: StatusHistoryEntry[];
  citizen?: {
    citizen_id: string;
    username: string;
    flag_count: number;
    is_suspended: boolean;
    total_reports: number;
    member_since?: string;
  };
  guest?: {
    label: string;
    flag_count: number;
    is_blocked: boolean;
    total_reports: number;
    first_seen?: string;
  };
  flags?: Flag[];
}

export interface ReportPage {
  reports: Report[];
  count: number;
  next_cursor: string | null;
  has_more: boolean;
  page_summary?: Record<ReportStatus, number>;
}

export interface Profile {
  user_id?: string;
  citizen_id?: string;
  employee_id?: string;
  admin_id?: string;
  username?: string;
  name?: string;
  phone_number?: string | null;
  phone_verified?: boolean;
  email?: string | null;
  email_verified?: boolean;
  language?: Lang;
  location?: string;
  created_at?: string;
  report_count?: number;
  resolved_count?: number;
  flag_count?: number;
  is_suspended?: boolean;
  notification_channel?: "email" | "in_app";
  provisioning?: boolean;
}

export interface Employee {
  employee_id: string;
  name: string;
  email: string;
  location: string;
  language: Lang;
  is_active: boolean;
  created_at: string;
  created_by_username?: string;
  reports_resolved?: number;
}

export interface FlaggedCitizen {
  citizen_id: string;
  username: string;
  phone_number?: string | null;
  email?: string | null;
  flag_count: number;
  report_count?: number;
  is_suspended: boolean;
  suspension_eligible: boolean;
  created_at?: string;
}

export interface PublicStats {
  reports_total: number | null;
  reports_resolved: number | null;
  reports_in_progress: number | null;
  reports_pending: number | null;
  resolution_rate: number | null;
  unavailable?: boolean;
}

/** What the server tells the page about who is looking at it. */
export interface Session {
  role: Role | null;
  username: string | null;
  /** "Guest-4F2A" when this browser has reported as a guest. */
  guestLabel: string | null;
  /** Show "Continue with Google" (Google is configured on the user pool). */
  google: boolean;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
