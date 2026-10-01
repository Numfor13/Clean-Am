"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiRequestError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { formatDate, formatDateTime, initials, maskPhone } from "@/lib/format";
import { CITIES, FLAG_REASON_KEY, FLAG_THRESHOLD } from "@/lib/reports";
import type { Employee, Flag as FlagRecord, FlaggedCitizen, Lang } from "@/lib/types";
import { Dialog, useToast } from "@/components/shell";
import { LanguageToggle, TextField } from "@/components/forms";
import { Ban, ChevronLeft, ChevronRight, PlusCircle, Refresh, Search, User, UserRound, UserX, Users, Warning, Flag } from "@/components/icons";
import { EmptyState, ErrorState, FieldError, Skeleton } from "@/components/ui";

// ===========================================================================
// Employees
// ===========================================================================
export function EmployeesScreen() {
  const { t, lang } = useT();
  const toast = useToast();
  const [pages, setPages] = useState<Employee[][]>([]);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Employee | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchPage = useCallback(
    async (index: number, cursor: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const page = await api.get<{ employees: Employee[]; next_cursor: string | null }>("employees", { limit: 10, cursor });
        setPages((list) => {
          const next = list.slice(0, index);
          next[index] = page.employees;
          return next;
        });
        setCursors((list) => {
          const next = list.slice(0, index + 1);
          next[index + 1] = page.next_cursor;
          return next;
        });
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : t("common.error"));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    fetchPage(0, null);
  }, [fetchPage]);

  async function revoke() {
    if (!revoking) return;
    setBusy(true);
    try {
      await api.del(`employees/${encodeURIComponent(revoking.employee_id)}`);
      toast(t("admin.revoked", { name: revoking.name }));
      setRevoking(null);
      setPages([]);
      setPageIndex(0);
      await fetchPage(0, null);
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  const current = pages[pageIndex] ?? [];
  const hasNext = Boolean(cursors[pageIndex + 1]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t("admin.employees")}</h1>
          <p className="page-sub">{t("admin.employeesSub")}</p>
        </div>
        <Link href="/admin/employees/new" className="btn btn--primary btn--lg">
          <PlusCircle aria-hidden="true" />
          {t("admin.createEmployee")}
        </Link>
      </div>

      {error ? <ErrorState message={error} onRetry={() => fetchPage(pageIndex, cursors[pageIndex] ?? null)} /> : null}

      {!loading && !error && pages[0]?.length === 0 ? (
        <EmptyState
          icon={<Users aria-hidden="true" />}
          title={t("admin.noEmployeesTitle")}
          body={t("admin.noEmployees")}
          action={
            <Link href="/admin/employees/new" className="btn btn--primary">
              {t("admin.createEmployee")}
            </Link>
          }
        />
      ) : (
        <>
          <div className="table-card">
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("admin.col.name")}</th>
                    <th>{t("field.emailTitle")}</th>
                    <th>{t("admin.col.location")}</th>
                    <th>{t("admin.col.created")}</th>
                    <th>{t("staff.status")}</th>
                    <th>{t("admin.col.action")}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !pages[pageIndex]
                    ? Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i}>
                          {Array.from({ length: 6 }).map((__, j) => (
                            <td key={j}>
                              <Skeleton height={18} />
                            </td>
                          ))}
                        </tr>
                      ))
                    : current.map((e) => (
                        <tr key={e.employee_id} className={e.is_active ? undefined : "is-dim"}>
                          <td>
                            <span className="row" style={{ "--gap": "14px" } as React.CSSProperties}>
                              <span className={`avatar${e.is_active ? "" : " avatar--muted"}`} style={{ "--size": "44px" } as React.CSSProperties}>
                                {initials(e.name)}
                              </span>
                              <span className="col-title" style={e.is_active ? undefined : { color: "var(--ink-muted)" }}>
                                {e.name}
                              </span>
                            </span>
                          </td>
                          <td>{e.email}</td>
                          <td>{e.location}</td>
                          <td className="nowrap">{formatDate(e.created_at, lang)}</td>
                          <td>
                            <span className={`chip ${e.is_active ? "chip--active" : "chip--muted"}`}>
                              {e.is_active ? t("admin.active") : t("admin.revokedChip")}
                            </span>
                          </td>
                          <td>
                            {e.is_active ? (
                              <button type="button" className="btn btn--ghost btn--sm text-danger" style={{ color: "var(--flagged-ink)" }} onClick={() => setRevoking(e)}>
                                <UserX aria-hidden="true" />
                                {t("admin.revoke")}
                              </button>
                            ) : (
                              <span className="muted" aria-label={t("admin.noAction")}>
                                —
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="pagination">
            <span>{t("admin.showingPage", { page: pageIndex + 1, count: current.length })}</span>
            <div className="pager">
              <button type="button" onClick={() => setPageIndex((i) => Math.max(0, i - 1))} disabled={pageIndex === 0 || loading} aria-label={t("common.previous")}>
                <ChevronLeft aria-hidden="true" size={20} />
              </button>
              <span className="pager-current" aria-current="page">
                {pageIndex + 1}
              </span>
              <button
                type="button"
                onClick={() => {
                  const target = pageIndex + 1;
                  if (!pages[target]) fetchPage(target, cursors[target] ?? null);
                  setPageIndex(target);
                }}
                disabled={!hasNext || loading}
                aria-label={t("common.next")}
              >
                <ChevronRight aria-hidden="true" size={20} />
              </button>
            </div>
          </div>
        </>
      )}

      <Dialog open={Boolean(revoking)} onClose={() => setRevoking(null)} labelledBy="revoke-title" width={520}>
        <div className="stack">
          <h2 id="revoke-title" className="heading-l">
            {t("admin.revokeTitle", { name: revoking?.name ?? "" })}
          </h2>
          <p>{t("admin.revokeBody")}</p>
          <div className="flag-actions">
            <button type="button" className="btn btn--ghost desktop-only" onClick={() => setRevoking(null)}>
              {t("common.cancel")}
            </button>
            <button type="button" className="btn btn--danger btn--lg" onClick={revoke} disabled={busy}>
              {busy ? <span className="spinner" aria-hidden="true" /> : <UserX aria-hidden="true" />}
              {t("admin.revoke")}
            </button>
            <button type="button" className="btn btn--ghost mobile-only" onClick={() => setRevoking(null)}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

// ===========================================================================
// Create employee
// ===========================================================================
export function CreateEmployeeScreen() {
  const { t } = useT();
  const toast = useToast();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [location, setLocation] = useState(CITIES.Buea[0].name);
  const [language, setLanguage] = useState<Lang>("en");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (name.trim().length < 2) found.name = t("admin.error.name");
    if (!/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(email.trim())) found.email = t("auth.error.INVALID_EMAIL");
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("employees", { name: name.trim(), email: email.trim().toLowerCase(), location, language });
      toast(t("admin.created", { email: email.trim().toLowerCase() }));
      router.push("/admin/employees");
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "EMAIL_EXISTS") setErrors({ email: t("auth.error.EMAIL_TAKEN") });
      else setError(err instanceof ApiRequestError ? err.message : t("common.error"));
      setBusy(false);
    }
  }

  return (
    <form className="card form-card stack" style={{ "--gap": "22px", marginTop: 16 } as React.CSSProperties} onSubmit={submit} noValidate>
      <div className="row" style={{ "--gap": "18px", alignItems: "flex-start" } as React.CSSProperties}>
        <span className="icon-disc" style={{ "--size": "72px" } as React.CSSProperties}>
          <UserRound aria-hidden="true" />
        </span>
        <div>
          <h1 className="display-m" style={{ fontSize: 34 }}>
            {t("admin.createEmployee")}
          </h1>
          <p className="muted body-l">{t("admin.createSub")}</p>
        </div>
      </div>
      <TextField label={t("admin.fullName")} value={name} onChange={setName} placeholder="e.g. John N. Nkeng" autoComplete="off" error={errors.name} autoFocus />
      <TextField
        label={t("field.emailTitle")}
        type="email"
        value={email}
        onChange={setEmail}
        placeholder="e.g. john@buea-council.cm"
        autoComplete="off"
        inputMode="email"
        error={errors.email}
      />
      <div className="field">
        <label className="label" htmlFor="emp-location">
          {t("admin.col.location")}
        </label>
        <select id="emp-location" className="select" value={location} onChange={(e) => setLocation(e.target.value)}>
          {Object.entries(CITIES).map(([city, quarters]) => (
            <optgroup key={city} label={city}>
              {quarters.map((q) => (
                <option key={`${city}-${q.name}`} value={q.name}>
                  {q.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="help">{t("admin.locationHelp")}</p>
      </div>
      <div className="field">
        <span className="label">{t("field.languageTitle")}</span>
        <div>
          <LanguageToggle value={language} onChange={setLanguage} label={t("field.languageTitle")} />
        </div>
      </div>
      <FieldError>{error}</FieldError>
      <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
        {busy ? <span className="spinner" aria-hidden="true" /> : null}
        {t("admin.createSubmit")}
      </button>
      <Link href="/admin/employees" className="link center" style={{ textDecoration: "none" }}>
        {t("common.cancel")}
      </Link>
    </form>
  );
}

// ===========================================================================
// Flagged citizens
// ===========================================================================
interface CitizenDetail {
  citizen: FlaggedCitizen & { report_count?: number };
  flags: FlagRecord[];
  threshold: number;
}

export function FlaggedCitizensScreen() {
  const { t, lang } = useT();
  const toast = useToast();
  const [rows, setRows] = useState<FlaggedCitizen[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CitizenDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"suspend" | "reinstate" | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // Active and suspended citizens over the threshold live in two index
      // partitions, so ask for both and merge, most-flagged first.
      const [active, suspended] = await Promise.all([
        api.get<{ citizens: FlaggedCitizen[] }>("citizens/flagged", { limit: 100 }),
        api.get<{ citizens: FlaggedCitizen[] }>("citizens/flagged", { limit: 100, suspended: 1 }),
      ]);
      const all = [...active.citizens, ...suspended.citizens].sort((a, b) => b.flag_count - a.flag_count);
      setRows(all);
      setSelected((cur) => cur ?? all[0]?.citizen_id ?? null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("common.error"));
      setRows([]);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const loadDetail = useCallback(
    async (id: string) => {
      setDetail(null);
      setDetailError(null);
      try {
        setDetail(await api.get<CitizenDetail>(`citizens/${encodeURIComponent(id)}`));
      } catch (err) {
        setDetailError(err instanceof ApiRequestError ? err.message : t("common.error"));
      }
    },
    [t],
  );

  useEffect(() => {
    if (selected) loadDetail(selected);
  }, [selected, loadDetail]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!rows) return null;
    if (!q) return rows;
    return rows.filter((r) => r.username.toLowerCase().includes(q) || (r.phone_number ?? "").replace(/\s/g, "").includes(q.replace(/\s/g, "")));
  }, [rows, search]);

  async function afterAction(message: string) {
    setConfirm(null);
    toast(message);
    await load();
    if (selected) await loadDetail(selected);
  }

  const citizen = detail?.citizen;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t("admin.flagged")}</h1>
          <p className="page-sub">{t("admin.flaggedSub", { count: FLAG_THRESHOLD })}</p>
        </div>
      </div>
      {error ? <ErrorState message={error} onRetry={load} /> : null}

      <div className="admin-split">
        <div className="card" style={{ padding: 16 }}>
          <div className="search-input" style={{ marginBottom: 12 }}>
            <Search aria-hidden="true" />
            <input className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("admin.searchCitizens")} aria-label={t("admin.searchCitizens")} />
          </div>
          {visible === null ? (
            <div className="stack">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} height={44} />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <EmptyState icon={<Flag aria-hidden="true" />} title={search ? t("admin.noMatch") : t("admin.noFlagged")} />
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("admin.col.username")}</th>
                    <th>{t("field.phoneTitle")}</th>
                    <th>{t("admin.col.flags")}</th>
                    <th>{t("admin.col.reports")}</th>
                    <th>{t("staff.status")}</th>
                    <th aria-label={t("common.open")} />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => (
                    <tr
                      key={c.citizen_id}
                      className="is-link"
                      aria-selected={selected === c.citizen_id}
                      onClick={() => setSelected(c.citizen_id)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSelected(c.citizen_id)}
                      tabIndex={0}
                    >
                      <td>
                        <span className="row" style={{ "--gap": "12px" } as React.CSSProperties}>
                          <span className="avatar" style={{ "--size": "36px" } as React.CSSProperties}>
                            <User aria-hidden="true" size={18} />
                          </span>
                          <span className="strong">{c.username}</span>
                        </span>
                      </td>
                      <td className="nowrap">{maskPhone(c.phone_number) || "—"}</td>
                      <td>
                        <span className="count-badge">{c.flag_count}</span>
                      </td>
                      <td>{c.report_count ?? "—"}</td>
                      <td>
                        <span className={`chip ${c.is_suspended ? "chip--suspended" : "chip--active"}`}>
                          {c.is_suspended ? t("admin.suspendedChip") : t("admin.active")}
                        </span>
                      </td>
                      <td>
                        <ChevronRight aria-hidden="true" size={20} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="card" style={{ padding: 20 }} aria-label={t("admin.citizenPanel")}>
          {!selected ? (
            <EmptyState icon={<UserRound aria-hidden="true" />} title={t("admin.selectCitizen")} />
          ) : detailError ? (
            <ErrorState message={detailError} onRetry={() => loadDetail(selected)} />
          ) : !citizen ? (
            <div className="stack">
              <Skeleton height={80} />
              <Skeleton height={60} />
              <Skeleton height={60} />
            </div>
          ) : (
            <div className="stack" style={{ "--gap": "16px" } as React.CSSProperties}>
              <div className="row" style={{ "--gap": "16px", alignItems: "flex-start" } as React.CSSProperties}>
                <span className="avatar" style={{ "--size": "80px" } as React.CSSProperties}>
                  <User aria-hidden="true" size={40} />
                </span>
                <div className="grow">
                  <div className="row-between">
                    <h2 className="heading-l">{citizen.username}</h2>
                    <span className={`chip ${citizen.is_suspended ? "chip--suspended" : "chip--active"}`}>
                      {citizen.is_suspended ? t("admin.suspendedChip") : t("admin.active")}
                    </span>
                  </div>
                  <div style={{ fontSize: 17 }}>{maskPhone(citizen.phone_number) || "—"}</div>
                  <div className="muted">
                    {t("admin.reportsAndFlags", { reports: citizen.report_count ?? 0, flags: citizen.flag_count })}
                  </div>
                </div>
              </div>
              <hr className="divider" />
              <h3 className="heading-m">{t("admin.flagHistory")}</h3>
              {detail.flags.length === 0 ? (
                <p className="muted">{t("admin.noFlagsYet")}</p>
              ) : (
                <div className="stack" style={{ "--gap": "10px" } as React.CSSProperties}>
                  {detail.flags.map((f) => (
                    <div key={f.flag_id} className="flag-item">
                      <div className="stack" style={{ "--gap": "4px" } as React.CSSProperties}>
                        <span className="tag tag--danger" style={{ alignSelf: "flex-start" }}>
                          {t(FLAG_REASON_KEY[f.reason] ?? "flag.reason.OTHER")}
                        </span>
                        <span className="muted">{t("admin.flagBy", { name: f.flagged_by_username ?? "—", date: formatDateTime(f.flagged_at, lang) })}</span>
                        {f.note ? <span>{f.note}</span> : null}
                      </div>
                      <Link href={`/staff/reports/${f.report_id}`} className="mono" style={{ fontSize: 13, color: "var(--ink)" }}>
                        {f.report_id}
                      </Link>
                    </div>
                  ))}
                </div>
              )}
              <div className="row wrap" style={{ "--gap": "12px" } as React.CSSProperties}>
                <button type="button" className="btn btn--danger grow" disabled={citizen.is_suspended} onClick={() => setConfirm("suspend")}>
                  <Ban aria-hidden="true" />
                  {t("admin.suspend")}
                </button>
                <button type="button" className="btn btn--outline grow" disabled={!citizen.is_suspended} onClick={() => setConfirm("reinstate")}>
                  <Refresh aria-hidden="true" />
                  {t("admin.reinstate")}
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {citizen ? (
        <ModerationDialog
          mode={confirm}
          citizen={citizen}
          threshold={detail?.threshold ?? FLAG_THRESHOLD}
          onClose={() => setConfirm(null)}
          onDone={afterAction}
        />
      ) : null}
    </>
  );
}

function ModerationDialog({
  mode,
  citizen,
  threshold,
  onClose,
  onDone,
}: {
  mode: "suspend" | "reinstate" | null;
  citizen: FlaggedCitizen;
  threshold: number;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [override, setOverride] = useState(false);
  const [resetFlags, setResetFlags] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const below = citizen.flag_count < threshold;

  useEffect(() => {
    setText("");
    setOverride(false);
    setResetFlags(false);
    setError(null);
  }, [mode]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "suspend") {
        await api.post(`citizens/${encodeURIComponent(citizen.citizen_id)}/suspend`, {
          reason: text.trim() || undefined,
          override_threshold: below ? true : undefined,
        });
        onDone(t("admin.suspendedToast", { name: citizen.username }));
      } else {
        await api.post(`citizens/${encodeURIComponent(citizen.citizen_id)}/reinstate`, {
          note: text.trim() || undefined,
          reset_flags: resetFlags || undefined,
        });
        onDone(t("admin.reinstatedToast", { name: citizen.username }));
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const blocked = mode === "suspend" && below && !override;

  return (
    <Dialog open={Boolean(mode)} onClose={onClose} labelledBy="mod-title" width={560}>
      <div className="stack" style={{ "--gap": "16px" } as React.CSSProperties}>
        <h2 id="mod-title" className="heading-l">
          {mode === "suspend" ? t("admin.suspendTitle", { name: citizen.username }) : t("admin.reinstateTitle", { name: citizen.username })}
        </h2>
        <p>{mode === "suspend" ? t("admin.suspendBody") : t("admin.reinstateBody")}</p>
        {mode === "suspend" && below ? (
          <>
            <div className="banner banner--warning">
              <Warning aria-hidden="true" />
              <span>{t("admin.belowThreshold", { name: citizen.username, count: citizen.flag_count, threshold })}</span>
            </div>
            <label className="choice" style={{ minHeight: 56 }}>
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              <span>{t("admin.overrideConfirm")}</span>
            </label>
          </>
        ) : null}
        {mode === "reinstate" ? (
          <label className="choice">
            <input type="checkbox" checked={resetFlags} onChange={(e) => setResetFlags(e.target.checked)} />
            <span>{t("admin.resetFlags")}</span>
          </label>
        ) : null}
        <div className="field">
          <label className="label" htmlFor="mod-text">
            {mode === "suspend" ? t("admin.reasonOptional") : t("admin.noteOptional")}
          </label>
          <textarea id="mod-text" className="textarea" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} style={{ minHeight: 80 }} />
        </div>
        <FieldError>{error}</FieldError>
        <div className="flag-actions">
          <button type="button" className="btn btn--ghost desktop-only" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={`btn btn--lg ${mode === "suspend" ? "btn--danger" : "btn--primary"}`}
            disabled={busy || blocked}
            onClick={submit}
          >
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {mode === "suspend" ? t("admin.suspend") : t("admin.reinstate")}
          </button>
          <button type="button" className="btn btn--ghost mobile-only" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
