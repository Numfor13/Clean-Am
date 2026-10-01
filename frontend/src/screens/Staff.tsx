"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiRequestError, authCall, getReportPage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { formatCoords, formatDateTime, formatMonthYear, formatNumber, timeAgo } from "@/lib/format";
import {
  CATEGORY_KEY,
  CITIES,
  FLAG_REASONS,
  FLAG_REASON_KEY,
  FLAG_THRESHOLD,
  isGuestReport,
  nextStatus,
  reportTitle,
  STATUSES,
  STATUS_KEY,
} from "@/lib/reports";
import type { IconType } from "react-icons";
import type { FlagReason, PublicStats, Report, ReportPage, ReportStatus } from "@/lib/types";
import { useSession } from "@/components/Providers";
import { Dialog, TopBar, useToast } from "@/components/shell";
import { directionsUrl, MapView } from "@/components/MapView";
import { HistoryTimeline, ReportCard, ReportCardSkeleton } from "@/components/reports";
import {
  Calendar,
  Check,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Close,
  Copy,
  Ellipsis,
  ExternalLink,
  FileText,
  FilterIcon,
  Flag,
  ImageIcon,
  MapIcon,
  MapPin,
  MessageText,
  Play,
  Refresh,
  Search,
  ShieldCheck,
  Smartphone,
  SortIcon,
  Tag,
  Trash,
  User,
  Warning,
} from "@/components/icons";
import { EmptyState, ErrorState, FieldError, Photo, Skeleton, StatusChip } from "@/components/ui";
import { OtpInput } from "@/components/forms";
import { authErrorMessage } from "@/screens/Auth";

type StatusFilter = ReportStatus | "ALL" | "FLAGGED";
type DateFilter = "any" | "today" | "7" | "30";

interface Filters {
  quarter: string;
  status: StatusFilter;
  date: DateFilter;
  search: string;
}

const EMPTY_FILTERS: Filters = { quarter: "", status: "ALL", date: "any", search: "" };
const PAGE_SIZE = 10;

function fromDate(date: DateFilter): string | undefined {
  if (date === "any") return undefined;
  const d = new Date();
  if (date === "today") d.setHours(0, 0, 0, 0);
  else d.setDate(d.getDate() - Number(date));
  return d.toISOString();
}

const ALL_QUARTERS = Object.values(CITIES)
  .flat()
  .map((q) => q.name)
  .filter((q, i, list) => list.indexOf(q) === i);

// ===========================================================================
// Report list: table on desktop, cards + filter sheet on phones
// ===========================================================================
export function StaffReportListScreen() {
  const { t, lang } = useT();
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [searchText, setSearchText] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [pages, setPages] = useState<Report[][]>([]);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    api
      .get<{ stats: PublicStats }>("public/stats")
      .then((r) => setTotal(r.stats.reports_total))
      .catch(() => setTotal(null));
  }, []);

  // Debounce typing into the search box.
  useEffect(() => {
    const id = setTimeout(() => setFilters((f) => (f.search === searchText.trim() ? f : { ...f, search: searchText.trim() })), 400);
    return () => clearTimeout(id);
  }, [searchText]);

  const query = useMemo(
    () => ({
      quarter: filters.quarter || undefined,
      status: STATUSES.includes(filters.status as ReportStatus) ? filters.status : undefined,
      fraudulent_only: filters.status === "FLAGGED" ? 1 : undefined,
      include_fraudulent: filters.status === "ALL" ? 1 : undefined,
      from: fromDate(filters.date),
      search: filters.search || undefined,
      sort,
      limit: PAGE_SIZE,
    }),
    [filters, sort],
  );

  const fetchPage = useCallback(
    async (index: number, cursor: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const page = await getReportPage<ReportPage>("reports", { ...query, cursor });
        setPages((list) => {
          const next = list.slice(0, index);
          next[index] = page.reports;
          return next;
        });
        setCursors((list) => {
          const next = list.slice(0, index + 1);
          next[index + 1] = page.next_cursor;
          return next;
        });
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) {
          window.location.assign("/login?next=/staff/reports");
          return;
        }
        setError(err instanceof ApiRequestError ? err.message : t("common.error"));
      } finally {
        setLoading(false);
      }
    },
    [query, t],
  );

  // New filters: start again from page one.
  useEffect(() => {
    setPages([]);
    setCursors([null]);
    setPageIndex(0);
    fetchPage(0, null);
  }, [fetchPage]);

  const current = pages[pageIndex] ?? [];
  const everything = pages.flat();
  const hasNext = Boolean(cursors[pageIndex + 1]);
  const activeCount = (filters.quarter ? 1 : 0) + (filters.status !== "ALL" ? 1 : 0) + (filters.date !== "any" ? 1 : 0);
  const filtered = activeCount > 0 || Boolean(filters.search);

  function goNext() {
    const target = pageIndex + 1;
    if (!pages[target]) fetchPage(target, cursors[target] ?? null);
    setPageIndex(target);
  }

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ref = searchText.trim();
    if (/^rpt_[a-z0-9]{6,}$/i.test(ref)) router.push(`/staff/reports/${ref}`);
  }

  const statusLabel = (s: StatusFilter) =>
    s === "ALL" ? t("staff.allStatuses") : s === "FLAGGED" ? t("status.FLAGGED") : t(STATUS_KEY[s]);
  const dateLabel: Record<DateFilter, string> = {
    any: t("staff.date.any"),
    today: t("staff.date.today"),
    "7": t("staff.date.7"),
    "30": t("staff.date.30"),
  };

  const empty = !loading && !error && (pages[0]?.length ?? 0) === 0;

  return (
    <>
      <div className="page-head desktop-only" style={{ display: "flex" }}>
        <div>
          <h1 className="page-title">{t("staff.allReports")}</h1>
          <p className="page-sub">{total !== null && !filtered ? t("staff.total", { count: formatNumber(total, lang) }) : t("staff.newestFirst")}</p>
        </div>
      </div>

      {/* Desktop filter bar */}
      <form className="card filter-bar desktop-only" style={{ display: "flex" }} onSubmit={onSearchSubmit} role="search">
        <label htmlFor="f-quarter">{t("field.quarter")}</label>
        <select id="f-quarter" className="select" value={filters.quarter} onChange={(e) => setFilters((f) => ({ ...f, quarter: e.target.value }))}>
          <option value="">{t("staff.allQuarters")}</option>
          {ALL_QUARTERS.map((q) => (
            <option key={q}>{q}</option>
          ))}
        </select>
        <label htmlFor="f-status">{t("staff.status")}</label>
        <select
          id="f-status"
          className="select"
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as StatusFilter }))}
        >
          {(["ALL", ...STATUSES, "FLAGGED"] as StatusFilter[]).map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        <label htmlFor="f-date">{t("staff.dateRange")}</label>
        <select id="f-date" className="select" value={filters.date} onChange={(e) => setFilters((f) => ({ ...f, date: e.target.value as DateFilter }))}>
          {(Object.keys(dateLabel) as DateFilter[]).map((d) => (
            <option key={d} value={d}>
              {dateLabel[d]}
            </option>
          ))}
        </select>
        <div className="search-input">
          <Search aria-hidden="true" />
          <input
            className="input"
            type="search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder={t("staff.searchPlaceholder")}
            aria-label={t("staff.search")}
          />
        </div>
        <button
          type="button"
          className="link"
          onClick={() => {
            setFilters(EMPTY_FILTERS);
            setSearchText("");
          }}
        >
          {t("staff.clearFilters")}
        </button>
      </form>

      {/* Mobile search + filters */}
      <div className="stack mobile-only" style={{ "--gap": "12px", marginBottom: 16 } as React.CSSProperties}>
        <form className="mobile-filters" onSubmit={onSearchSubmit} role="search">
          <div className="search-input">
            <Search aria-hidden="true" />
            <input
              className="input"
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder={t("staff.searchPlaceholderShort")}
              aria-label={t("staff.search")}
            />
          </div>
          <button type="button" className="filters-btn" onClick={() => setSheetOpen(true)} aria-haspopup="dialog">
            <FilterIcon aria-hidden="true" />
            {t("staff.filters")}
            {activeCount ? <span className="count">{activeCount}</span> : null}
          </button>
        </form>
        {activeCount ? (
          <div className="chip-scroller">
            {filters.quarter ? (
              <button type="button" className="filter-chip filter-chip--removable" onClick={() => setFilters((f) => ({ ...f, quarter: "" }))}>
                {t("staff.quarterChip", { quarter: filters.quarter })}
                <Close aria-label={t("common.remove")} />
              </button>
            ) : null}
            {filters.status !== "ALL" ? (
              <button type="button" className="filter-chip filter-chip--removable" onClick={() => setFilters((f) => ({ ...f, status: "ALL" }))}>
                {statusLabel(filters.status)}
                <Close aria-label={t("common.remove")} />
              </button>
            ) : null}
            {filters.date !== "any" ? (
              <button type="button" className="filter-chip filter-chip--removable" onClick={() => setFilters((f) => ({ ...f, date: "any" }))}>
                {dateLabel[filters.date]}
                <Close aria-label={t("common.remove")} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? <ErrorState message={error} onRetry={() => fetchPage(pageIndex, cursors[pageIndex] ?? null)} /> : null}

      {empty ? (
        <EmptyState
          icon={<FileText aria-hidden="true" />}
          title={filtered ? t("staff.emptyFiltered") : t("staff.empty")}
          action={
            filtered ? (
              <button
                type="button"
                className="btn btn--outline"
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setSearchText("");
                }}
              >
                {t("staff.clearFilters")}
              </button>
            ) : undefined
          }
        />
      ) : null}

      {/* Desktop table */}
      {!empty ? (
        <div className="desktop-only">
          <div className="table-card">
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 360 }}>{t("staff.col.photo")}</th>
                    <th>{t("staff.col.reference")}</th>
                    <th>{t("field.quarterPlain")}</th>
                    <th>{t("staff.col.submittedBy")}</th>
                    <th>
                      <button
                        type="button"
                        className="sort-btn"
                        onClick={() => setSort((s) => (s === "newest" ? "oldest" : "newest"))}
                        aria-label={sort === "newest" ? t("staff.sortOldest") : t("staff.sortNewest")}
                      >
                        {t("staff.col.submitted")}
                        <SortIcon aria-hidden="true" />
                      </button>
                    </th>
                    <th>{t("staff.status")}</th>
                    <th aria-label={t("common.open")} />
                  </tr>
                </thead>
                <tbody>
                  {loading && !pages[pageIndex]
                    ? Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i}>
                          {Array.from({ length: 7 }).map((__, j) => (
                            <td key={j}>
                              <Skeleton height={j === 0 ? 48 : 16} />
                            </td>
                          ))}
                        </tr>
                      ))
                    : current.map((r) => {
                        const title = reportTitle(r, t);
                        return (
                          <tr key={r.report_id} className="is-link" onClick={() => router.push(`/staff/reports/${r.report_id}`)}>
                            <td>
                              <div className="row" style={{ "--gap": "16px" } as React.CSSProperties}>
                                <Photo src={r.photo_url} alt="" className="thumb-sm" />
                                <Link href={`/staff/reports/${r.report_id}`} className="col-title" style={{ textDecoration: "none", color: "inherit" }}>
                                  {title}
                                </Link>
                              </div>
                            </td>
                            <td className="mono">{r.report_id}</td>
                            <td>{r.quarter}</td>
                            <td>
                              <span className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
                                {r.username}
                                {isGuestReport(r) ? <span className="tag">{t("report.guestTag")}</span> : null}
                              </span>
                            </td>
                            <td className="nowrap">{timeAgo(r.created_at, lang)}</td>
                            <td>
                              <StatusChip status={r.status} flagged={r.is_fraudulent} />
                            </td>
                            <td>
                              <ChevronRight aria-hidden="true" size={22} />
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="pagination">
            <span>{t("staff.showingPage", { page: pageIndex + 1, count: current.length })}</span>
            <div className="pager">
              <button type="button" onClick={() => setPageIndex((i) => Math.max(0, i - 1))} disabled={pageIndex === 0 || loading} aria-label={t("common.previous")}>
                <ChevronLeft aria-hidden="true" size={20} />
              </button>
              <span className="pager-current" aria-current="page">
                {pageIndex + 1}
              </span>
              <button type="button" onClick={goNext} disabled={!hasNext || loading} aria-label={t("common.next")}>
                <ChevronRight aria-hidden="true" size={20} />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Mobile cards */}
      {!empty ? (
        <div className="stack mobile-only" style={{ "--gap": "16px" } as React.CSSProperties}>
          {everything.map((r) => (
            <ReportCard key={r.report_id} report={r} href={`/staff/reports/${r.report_id}`} showReporter />
          ))}
          {loading ? (
            <>
              <ReportCardSkeleton />
              <ReportCardSkeleton />
            </>
          ) : null}
          {cursors[pages.length] && !loading ? (
            <button
              type="button"
              className="btn btn--outline btn--block btn--lg"
              style={{ background: "#f1fbf5", borderColor: "#bfe9d1" }}
              onClick={() => fetchPage(pages.length, cursors[pages.length] ?? null)}
            >
              <Refresh aria-hidden="true" />
              {t("common.loadMore")}
            </button>
          ) : null}
        </div>
      ) : null}

      <FilterSheet
        open={sheetOpen}
        initial={filters}
        onClose={() => setSheetOpen(false)}
        onApply={(f) => {
          setFilters((cur) => ({ ...cur, quarter: f.quarter, status: f.status, date: f.date }));
          setSheetOpen(false);
        }}
        statusLabel={statusLabel}
        dateLabel={dateLabel}
      />
    </>
  );
}

function FilterSheet({
  open,
  initial,
  onClose,
  onApply,
  statusLabel,
  dateLabel,
}: {
  open: boolean;
  initial: Filters;
  onClose: () => void;
  onApply: (f: Filters) => void;
  statusLabel: (s: StatusFilter) => string;
  dateLabel: Record<DateFilter, string>;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState(initial);
  useEffect(() => {
    if (open) setDraft(initial);
  }, [open, initial]);

  return (
    <Dialog open={open} onClose={onClose} labelledBy="filters-title">
      <div className="stack" style={{ "--gap": "20px" } as React.CSSProperties}>
        <h2 id="filters-title" className="heading-l">
          {t("staff.filters")}
        </h2>
        <div className="field">
          <label className="label" htmlFor="m-quarter">
            {t("field.quarter")}
          </label>
          <select id="m-quarter" className="select" value={draft.quarter} onChange={(e) => setDraft((d) => ({ ...d, quarter: e.target.value }))}>
            <option value="">{t("staff.allQuarters")}</option>
            {ALL_QUARTERS.map((q) => (
              <option key={q}>{q}</option>
            ))}
          </select>
        </div>
        <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="label" style={{ marginBottom: 8 }}>
            {t("staff.status")}
          </legend>
          <div className="cat-grid">
            {(["ALL", ...STATUSES, "FLAGGED"] as StatusFilter[]).map((s) => (
              <button key={s} type="button" className="filter-chip" aria-pressed={draft.status === s} onClick={() => setDraft((d) => ({ ...d, status: s }))}>
                {statusLabel(s)}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label className="label" htmlFor="m-date">
            {t("staff.dateRange")}
          </label>
          <select id="m-date" className="select" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value as DateFilter }))}>
            {(Object.keys(dateLabel) as DateFilter[]).map((d) => (
              <option key={d} value={d}>
                {dateLabel[d]}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn--primary btn--block btn--lg" onClick={() => onApply(draft)}>
          {t("staff.applyFilters")}
        </button>
        <button type="button" className="link center" onClick={() => onApply(EMPTY_FILTERS)}>
          {t("staff.clearFilters")}
        </button>
      </div>
    </Dialog>
  );
}

// ===========================================================================
// Report detail (employee)
// ===========================================================================
function Copyable({ text }: { text: string }) {
  const { t } = useT();
  const toast = useToast();
  return (
    <button
      type="button"
      className="icon-btn"
      style={{ width: 36, height: 36 }}
      aria-label={t("common.copy")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast(t("common.copied"));
        } catch {
          /* ignore */
        }
      }}
    >
      <Copy aria-hidden="true" style={{ width: 20, height: 20 }} />
    </button>
  );
}

export function StaffReportScreen({ id }: { id: string }) {
  const { t, lang } = useT();
  const session = useSession();
  const toast = useToast();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<{ message: string; missing: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.get<{ report: Report }>(`reports/${encodeURIComponent(id)}`);
      setReport(r.report);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        window.location.assign(`/login?next=/staff/reports/${encodeURIComponent(id)}`);
        return;
      }
      setError({ message: err instanceof ApiRequestError ? err.message : t("common.error"), missing: err instanceof ApiRequestError && err.status === 404 });
    }
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function advance() {
    if (!report) return;
    const target = nextStatus(report.status);
    if (!target) return;
    setBusy(true);
    try {
      await api.patch(`reports/${encodeURIComponent(report.report_id)}/status`, { status: target, expected_current: report.status });
      toast(t("staff.statusChanged", { status: t(STATUS_KEY[target]) }));
      await load();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        toast(t("staff.statusConflict"), "error");
        await load();
      } else {
        toast(err instanceof ApiRequestError ? err.message : t("common.error"), "error");
      }
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return error.missing ? (
      <EmptyState
        icon={<FileText aria-hidden="true" />}
        title={t("report.notFoundTitle")}
        body={t("staff.notFound")}
        action={
          <Link href="/staff/reports" className="btn btn--primary">
            {t("staff.allReports")}
          </Link>
        }
      />
    ) : (
      <ErrorState message={error.message} onRetry={load} />
    );
  }

  if (!report) {
    return (
      <div className="detail-grid">
        <div className="stack">
          <Skeleton height={380} radius={12} />
          <Skeleton height={220} radius={12} />
        </div>
        <div className="stack">
          <Skeleton height={48} />
          <Skeleton height={300} radius={12} />
        </div>
      </div>
    );
  }

  const title = reportTitle(report, t);
  const target = nextStatus(report.status);
  const guest = isGuestReport(report);
  const reporterFlags = guest ? report.guest?.flag_count ?? 0 : report.citizen?.flag_count ?? 0;
  const reporterName = guest ? report.guest?.label ?? report.username : report.citizen?.username ?? report.username;
  const alreadyFlaggedByMe = Boolean(session.username && report.flags?.some((f) => f.flagged_by_username === session.username));
  const lat = Number(report.latitude);
  const lng = Number(report.longitude);

  const actionButtons = (
    <>
      {target ? (
        <button type="button" className="btn btn--primary btn--lg grow" onClick={advance} disabled={busy}>
          {busy ? <span className="spinner" aria-hidden="true" /> : target === "DONE" ? <CheckCircle aria-hidden="true" /> : <Play aria-hidden="true" />}
          {target === "DONE" ? t("staff.markDone") : t("staff.markInProgress")}
        </button>
      ) : (
        <span className="btn btn--outline btn--lg grow" aria-disabled="true">
          <CheckCircle aria-hidden="true" />
          {t("staff.collected")}
        </span>
      )}
      <button
        type="button"
        className="btn btn--danger-outline btn--lg"
        onClick={() => setFlagOpen(true)}
        disabled={alreadyFlaggedByMe}
        title={alreadyFlaggedByMe ? t("staff.alreadyFlagged") : undefined}
      >
        <Flag aria-hidden="true" />
        <span className="desktop-only">{alreadyFlaggedByMe ? t("staff.alreadyFlagged") : t("staff.flagReport")}</span>
        <span className="mobile-only">{t("staff.flag")}</span>
      </button>
    </>
  );

  const flagsTag =
    reporterFlags > 0 ? (
      <span className="tag tag--flags">
        <Flag aria-hidden="true" />
        {t("staff.flags", { count: reporterFlags })}
      </span>
    ) : null;

  return (
    <>
      <nav className="breadcrumb desktop-only" style={{ display: "flex" }} aria-label={t("common.breadcrumb")}>
        <Link href="/staff/reports">{t("staff.allReports")}</Link>
        <span aria-hidden="true">/</span>
        <span className="mono">{report.report_id}</span>
      </nav>
      <div className="mobile-only" style={{ margin: "-16px -16px 16px" }}>
        <TopBar title={t("staff.reportTitle", { id: report.report_id })} back="/staff/reports" wide small />
      </div>

      <div className="detail-grid" style={{ paddingBottom: 90 }}>
        <div className="stack" style={{ "--gap": "20px" } as React.CSSProperties}>
          <Photo src={report.photo_url} alt={title} className="photo photo--hero" />

          {/* Mobile: title, reporter */}
          <div className="stack mobile-only" style={{ "--gap": "16px" } as React.CSSProperties}>
            <div className="row-between" style={{ alignItems: "flex-start" }}>
              <h1 className="heading-l" style={{ fontSize: 26 }}>
                {title}
              </h1>
              <StatusChip status={report.status} flagged={report.is_fraudulent} large />
            </div>
            <div className="card card--pad stack" style={{ "--gap": "10px" } as React.CSSProperties}>
              <span className="card-kicker">{t("staff.submittedBy")}</span>
              <div className="reporter-card">
                <span className={`avatar${guest ? " avatar--muted" : ""}`}>{guest ? <User aria-hidden="true" /> : reporterName.slice(0, 1).toUpperCase()}</span>
                <div>
                  <div className="row wrap" style={{ "--gap": "8px" } as React.CSSProperties}>
                    <span className="heading-m">{reporterName}</span>
                    {guest ? <span className="tag">{t("report.guestTag")}</span> : null}
                    {flagsTag}
                  </div>
                  <div className="muted">
                    {guest
                      ? t("staff.guestSince", { date: formatMonthYear(report.guest?.first_seen, lang) || "—" })
                      : t("profile.memberSince", { date: formatMonthYear(report.citizen?.member_since, lang) || "—" })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <section className="card card--pad stack" aria-labelledby="loc-title" style={{ "--gap": "12px" } as React.CSSProperties}>
            <h2 id="loc-title" className="heading-m">
              {t("report.location")}
            </h2>
            <MapView center={{ lat, lng }} pin={{ lat, lng }} height={240} zoom={17} label={t("report.location")} />
            <div className="row-between wrap">
              <span className="row mono" style={{ fontSize: 18 } as React.CSSProperties}>
                <MapPin aria-hidden="true" size={24} />
                {formatCoords(lat, lng)}
              </span>
              <a href={directionsUrl(lat, lng)} target="_blank" rel="noopener noreferrer" className="link row" style={{ "--gap": "6px" } as React.CSSProperties}>
                <ExternalLink aria-hidden="true" size={20} />
                {t("staff.directions")}
              </a>
            </div>
          </section>

          <section className="card card--pad stack mobile-only" aria-labelledby="hist-m">
            <h2 id="hist-m" className="heading-m">
              {t("staff.history")}
            </h2>
            <HistoryTimeline report={report} />
          </section>
        </div>

        {/* Desktop right column */}
        <div className="stack desktop-only" style={{ "--gap": "20px", display: "flex" } as React.CSSProperties}>
          <div className="row" style={{ "--gap": "12px" } as React.CSSProperties}>
            {actionButtons}
          </div>
          <div className="row-between" style={{ alignItems: "center" }}>
            <h1 className="display-m" style={{ fontSize: 34 }}>
              {title}
            </h1>
            <StatusChip status={report.status} flagged={report.is_fraudulent} large />
          </div>
          <section className="card card--pad" aria-labelledby="details-title">
            <h2 id="details-title" className="heading-m" style={{ marginBottom: 8 }}>
              {t("staff.details")}
            </h2>
            <dl className="dl-rows" style={{ margin: 0 }}>
              <div className="dl-row">
                <User aria-hidden="true" />
                <dt>{t("staff.submittedBy")}</dt>
                <dd className="row wrap" style={{ "--gap": "8px" } as React.CSSProperties}>
                  {reporterName}
                  {guest ? <span className="tag">{t("report.guestTag")}</span> : null}
                  {flagsTag}
                </dd>
                <span />
              </div>
              <div className="dl-row">
                <Calendar aria-hidden="true" />
                <dt>{t("staff.col.submitted")}</dt>
                <dd>{formatDateTime(report.created_at, lang)}</dd>
                <span />
              </div>
              <div className="dl-row">
                <MapIcon aria-hidden="true" />
                <dt>{t("field.quarterPlain")}</dt>
                <dd>
                  {report.quarter}
                  {report.city ? `, ${report.city}` : ""}
                </dd>
                <span />
              </div>
              <div className="dl-row">
                <MapPin aria-hidden="true" />
                <dt>{t("staff.coordinates")}</dt>
                <dd className="mono">{formatCoords(lat, lng)}</dd>
                <Copyable text={formatCoords(lat, lng)} />
              </div>
              <div className="dl-row">
                <FileText aria-hidden="true" />
                <dt>{t("staff.col.reference")}</dt>
                <dd className="mono">{report.report_id}</dd>
                <Copyable text={report.report_id} />
              </div>
              <div className="dl-row">
                <Tag aria-hidden="true" />
                <dt>{t("staff.type")}</dt>
                <dd>{t(CATEGORY_KEY[report.category ?? "OTHER"])}</dd>
                <span />
              </div>
              {report.description ? (
                <div className="dl-row">
                  <MessageText aria-hidden="true" />
                  <dt>{t("staff.note")}</dt>
                  <dd>{report.description}</dd>
                  <span />
                </div>
              ) : null}
            </dl>
          </section>
          <section className="card card--pad stack" aria-labelledby="hist-d">
            <h2 id="hist-d" className="heading-m">
              {t("staff.history")}
            </h2>
            <HistoryTimeline report={report} />
          </section>
          {report.flags?.length ? (
            <section className="card card--pad stack" aria-labelledby="flags-d">
              <h2 id="flags-d" className="heading-m">
                {t("staff.flagsOnReport")}
              </h2>
              {report.flags.map((f) => (
                <div key={f.flag_id} className="flag-item">
                  <div className="stack" style={{ "--gap": "4px" } as React.CSSProperties}>
                    <span className="tag tag--danger" style={{ alignSelf: "flex-start" }}>
                      {t(FLAG_REASON_KEY[f.reason] ?? "flag.reason.OTHER")}
                    </span>
                    <span className="muted">
                      {t("admin.flagBy", { name: f.flagged_by_username ?? "—", date: formatDateTime(f.flagged_at, lang) })}
                    </span>
                    {f.note ? <span>{f.note}</span> : null}
                  </div>
                </div>
              ))}
            </section>
          ) : null}
        </div>
      </div>

      {/* Mobile sticky actions */}
      <div className="action-bar action-bar--bottom mobile-only">
        <div className="action-bar__inner">{actionButtons}</div>
      </div>

      <FlagDialog
        open={flagOpen}
        report={report}
        reporterName={reporterName}
        reporterFlags={reporterFlags}
        guest={guest}
        onClose={() => setFlagOpen(false)}
        onDone={async (message) => {
          setFlagOpen(false);
          toast(message);
          await load();
        }}
      />
    </>
  );
}

// ===========================================================================
// Flag report: bottom sheet on phones, modal on desktop
// ===========================================================================
const REASON_ICON: Record<FlagReason, IconType> = {
  NOT_WASTE: Trash,
  DUPLICATE: FileText,
  WRONG_LOCATION: MapPin,
  STAGED: ImageIcon,
  ALREADY_COLLECTED: CheckCircle,
  OTHER: Ellipsis,
};

function FlagDialog({
  open,
  report,
  reporterName,
  reporterFlags,
  guest,
  onClose,
  onDone,
}: {
  open: boolean;
  report: Report;
  reporterName: string;
  reporterFlags: number;
  guest: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { t } = useT();
  const [reason, setReason] = useState<FlagReason | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setReason(null);
      setNote("");
      setError(null);
    }
  }, [open]);

  const nth = reporterFlags + 1;
  const reachesThreshold = nth >= FLAG_THRESHOLD;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) return setError(t("flag.chooseReason"));
    if (reason === "OTHER" && !note.trim()) return setError(t("flag.noteRequired"));
    setBusy(true);
    setError(null);
    try {
      await api.post(`reports/${encodeURIComponent(report.report_id)}/flag`, { reason, note: note.trim() || undefined });
      onDone(t("flag.done"));
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "ALREADY_FLAGGED") setError(t("staff.alreadyFlagged"));
      else setError(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="flag-title" width={620}>
      <form className="stack" style={{ "--gap": "16px" } as React.CSSProperties} onSubmit={submit} noValidate>
        <div>
          <h2 id="flag-title" className="display-m" style={{ fontSize: 30 }}>
            {t("flag.title")}
          </h2>
          <p className="body-l muted">{guest ? t("flag.subGuest", { count: FLAG_THRESHOLD }) : t("flag.sub", { count: FLAG_THRESHOLD })}</p>
        </div>
        <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="heading-s" style={{ marginBottom: 8 }}>
            {t("flag.reason")}
          </legend>
          <div className="reason-grid">
            {FLAG_REASONS.map((r) => {
              const Icon = REASON_ICON[r];
              return (
                <label key={r} className="choice">
                  <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
                  <Icon className="choice-icon desktop-only" aria-hidden />
                  <span>{t(FLAG_REASON_KEY[r])}</span>
                  {reason === r ? <Check className="choice-check mobile-only" aria-hidden /> : null}
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="flag-note">
            <span className="heading-s">{t("flag.note")}</span> <span className="muted">{t("flag.noteHint")}</span>
          </label>
          <div className="input-wrap">
            <textarea
              id="flag-note"
              className="textarea"
              value={note}
              maxLength={250}
              placeholder={t("flag.notePlaceholder")}
              onChange={(e) => setNote(e.target.value)}
              aria-invalid={reason === "OTHER" && error ? true : undefined}
            />
            <span className="counter" aria-hidden="true">
              {note.length}/250
            </span>
          </div>
        </div>
        {reachesThreshold ? (
          <div className="banner banner--warning" role="status">
            <Warning aria-hidden="true" />
            <span>
              {guest
                ? t("flag.warnGuest", { name: reporterName, nth })
                : t("flag.warnCitizen", { name: reporterName, nth })}
            </span>
          </div>
        ) : null}
        <FieldError>{error}</FieldError>
        <div className="flag-actions">
          <button type="button" className="btn btn--ghost desktop-only" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn btn--danger btn--lg" disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {t("flag.submit")}
          </button>
          <button type="button" className="btn btn--ghost mobile-only" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ===========================================================================
// Sign-in security: optional two-step verification with an authenticator app
// ===========================================================================
interface MfaSetup {
  secret: string;
  uri: string;
}

export function SecurityScreen() {
  const { t } = useT();
  const toast = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await authCall<{ enabled: boolean }>("mfa-status");
      setEnabled(result.enabled);
    } catch (err) {
      setLoadError(authErrorMessage(err, t));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  // The QR code is drawn in the browser; the secret never leaves this page.
  useEffect(() => {
    if (!setup) {
      setQr(null);
      return;
    }
    let live = true;
    import("qrcode")
      .then((QRCode) => QRCode.toDataURL(setup.uri, { margin: 1, width: 440, errorCorrectionLevel: "M" }))
      .then((url) => live && setQr(url))
      .catch(() => live && setQr(null));
    return () => {
      live = false;
    };
  }, [setup]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setSetup(await authCall<MfaSetup>("mfa-setup"));
      setCode("");
    } catch (err) {
      setError(authErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return setError(t("security.wrongCode"));
    setBusy(true);
    setError(null);
    try {
      await authCall("mfa-confirm", { code });
      setEnabled(true);
      setSetup(null);
      toast(t("security.turnedOn"));
    } catch (err) {
      setError(authErrorMessage(err, t, true));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      await authCall("mfa-disable");
      setEnabled(false);
      setConfirmOff(false);
      toast(t("security.turnedOff"));
    } catch (err) {
      setError(authErrorMessage(err, t));
      setConfirmOff(false);
    } finally {
      setBusy(false);
    }
  }

  async function copyKey() {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.secret);
      toast(t("common.copied"));
    } catch {
      // Clipboard blocked: the key is on screen to type by hand.
    }
  }

  return (
    <div className="card form-card stack" style={{ "--gap": "22px", marginTop: 16 } as React.CSSProperties}>
      <div className="security-head">
        <span className="icon-disc">
          <ShieldCheck aria-hidden="true" />
        </span>
        <div>
          <h1 className="display-m" style={{ fontSize: 34 }}>
            {t("security.title")}
          </h1>
          <p className="muted body-l">{t("security.sub")}</p>
        </div>
      </div>

      {loadError ? <ErrorState message={loadError} onRetry={load} /> : null}
      {enabled === null && !loadError ? <Skeleton height={88} radius={16} /> : null}

      {enabled !== null ? (
        <div className={`banner ${enabled ? "banner--success" : "banner--info"}`} role="status">
          {enabled ? <CheckCircle aria-hidden="true" /> : <Warning aria-hidden="true" />}
          <div className="stack" style={{ "--gap": "4px" } as React.CSSProperties}>
            <strong>{enabled ? t("security.statusOn") : t("security.statusOff")}</strong>
            <span>{enabled ? t("security.onBody") : t("security.offBody")}</span>
          </div>
        </div>
      ) : null}

      {enabled === false && !setup ? (
        <>
          <FieldError>{error}</FieldError>
          <button type="button" className="btn btn--primary btn--block btn--lg btn--wrap" onClick={start} disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : <Smartphone aria-hidden="true" />}
            {t("security.setUp")}
          </button>
        </>
      ) : null}

      {setup ? (
        <form className="stack" style={{ "--gap": "18px" } as React.CSSProperties} onSubmit={confirm} noValidate>
          <p className="strong">{t("security.step1")}</p>
          <div className="mfa-qr">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt={t("security.qrAlt")} width={220} height={220} />
            ) : (
              <Skeleton height={220} width={220} radius={12} />
            )}
          </div>
          <div className="stack" style={{ "--gap": "8px" } as React.CSSProperties}>
            <span className="help">{t("security.cantScan")}</span>
            <div className="mfa-key">
              <code>{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
              <button type="button" className="btn btn--outline" onClick={copyKey}>
                <Copy aria-hidden="true" />
                {t("common.copy")}
              </button>
            </div>
            <a href={setup.uri} className="link mobile-only">
              {t("security.openApp")}
            </a>
          </div>
          <p className="strong">{t("security.step2")}</p>
          <OtpInput value={code} onChange={setCode} invalid={Boolean(error)} autoFocus={false} label={t("verify.codeLabel")} />
          <FieldError>{error}</FieldError>
          <button type="submit" className="btn btn--primary btn--block btn--lg btn--wrap" disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {t("security.confirm")}
          </button>
          <button type="button" className="link center" onClick={() => setSetup(null)}>
            {t("common.cancel")}
          </button>
        </form>
      ) : null}

      {enabled ? (
        <>
          <FieldError>{error}</FieldError>
          <button type="button" className="btn btn--danger-outline btn--block btn--lg btn--wrap" onClick={() => setConfirmOff(true)}>
            {t("security.turnOff")}
          </button>
        </>
      ) : null}

      <Dialog open={confirmOff} onClose={() => setConfirmOff(false)} labelledBy="mfa-off-title" width={480}>
        <div className="stack" style={{ "--gap": "16px" } as React.CSSProperties}>
          <h2 id="mfa-off-title" className="heading-l">
            {t("security.turnOffTitle")}
          </h2>
          <p>{t("security.turnOffBody")}</p>
          <div className="flag-actions">
            <button type="button" className="btn btn--ghost desktop-only" onClick={() => setConfirmOff(false)}>
              {t("common.cancel")}
            </button>
            <button type="button" className="btn btn--danger btn--lg btn--wrap" onClick={turnOff} disabled={busy}>
              {busy ? <span className="spinner" aria-hidden="true" /> : null}
              {t("security.turnOff")}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
