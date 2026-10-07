"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiRequestError, authCall, getReportPage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { formatCoords, formatMonthYear, formatPhone } from "@/lib/format";
import { reportTitle, STATUSES, STATUS_KEY } from "@/lib/reports";
import type { Lang, Profile, Report, ReportPage, ReportStatus } from "@/lib/types";
import { useSession } from "@/components/Providers";
import { MapView } from "@/components/MapView";
import { Dialog, TabBar, TopBar, useSignOut, useToast } from "@/components/shell";
import { ProgressTimeline, ReportCard, ReportCardSkeleton, WhatNextTimeline } from "@/components/reports";
import { LanguageToggle, OtpInput, TextField } from "@/components/forms";
import {
  Camera,
  Check,
  CheckCircle,
  ChevronRight,
  Copy,
  FileText,
  Globe,
  LogOut,
  Mail,
  MapPin,
  Phone,
  Quote,
  Truck,
  UserPlus,
} from "@/components/icons";
import { EmptyState, ErrorState, FieldError, Photo, Skeleton, StatusChip } from "@/components/ui";
import { LAST_REPORT_KEY } from "./SubmitReport";

function CopyButton({ text }: { text: string }) {
  const { t } = useT();
  const toast = useToast();
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={t("common.copy")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast(t("common.copied"));
        } catch {
          /* clipboard blocked: nothing to do */
        }
      }}
    >
      <Copy aria-hidden="true" />
    </button>
  );
}

// ===========================================================================
// Report submitted (citizen and guest variants)
// ===========================================================================
interface LastReport {
  report: Report;
  tracking: "account" | "none";
  thumb: string | null;
  guestLabel?: string | null;
}

export function SubmittedScreen() {
  const { t } = useT();
  const [data, setData] = useState<LastReport | null | undefined>(undefined);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(LAST_REPORT_KEY);
      setData(raw ? (JSON.parse(raw) as LastReport) : null);
    } catch {
      setData(null);
    }
  }, []);

  if (data === undefined) return <TopBar centerLogo />;

  if (data === null) {
    return (
      <>
        <TopBar centerLogo />
        <main id="main" className="m-screen m-screen--narrow m-screen--center stack center">
          <EmptyState
            icon={<FileText aria-hidden="true" />}
            title={t("submitted.missingTitle")}
            body={t("submitted.missingBody")}
            action={
              <Link href="/report" className="btn btn--primary btn--block btn--lg">
                {t("submitted.another")}
              </Link>
            }
          />
        </main>
      </>
    );
  }

  const { report, tracking } = data;
  const guest = tracking === "none";
  const title = reportTitle(report, t);

  return (
    <>
      <TopBar centerLogo />
      <main id="main" className="m-screen m-screen--narrow">
        <div className="stack" style={{ "--gap": "20px" } as React.CSSProperties}>
          <div className="confirm-head">
            <span className="icon-disc big-check">
              <Check aria-hidden="true" />
            </span>
            <h1>{t("submitted.title")}</h1>
            <p>{t("submitted.body")}</p>
          </div>

          <div className="card summary-card">
            {data.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.thumb} alt={title} />
            ) : (
              <Photo src={report.photo_url} alt={title} className="thumb" />
            )}
            <div className="summary-card__rows">
              <div className="stack" style={{ "--gap": "10px" } as React.CSSProperties}>
                <span className="place">
                  <MapPin aria-hidden="true" />
                  {report.quarter}
                  {report.city ? `, ${report.city}` : ""}
                </span>
                <span>
                  <StatusChip status={report.status} large />
                </span>
              </div>
              <div className="row" style={{ alignItems: "center", gap: 10, fontSize: 18, fontWeight: 700, fontFamily: "var(--font-display)", color: "var(--md-primary-text)", marginTop: 4 }}>
                <span className="icon-disc" style={{ "--size": "34px" } as React.CSSProperties}>
                  <Check strokeWidth={3} aria-hidden="true" style={{ width: 20, height: 20 }} />
                </span>
                <span>{t("submitted.sent")}</span>
              </div>
            </div>
          </div>

          {guest ? (
            <div className="guest-note" style={{ padding: 20 }}>
              <span className="icon-disc" style={{ "--size": "72px" } as React.CSSProperties}>
                <UserPlus aria-hidden="true" />
              </span>
              <div className="stack" style={{ "--gap": "6px" } as React.CSSProperties}>
                <strong className="heading-m">{t("submitted.guestTitle")}</strong>
                <span style={{ fontSize: 17 }}>{t("submitted.guestBody")}</span>
              </div>
            </div>
          ) : (
            <div className="card card--pad stack">
              <h2 className="heading-l">{t("submitted.next")}</h2>
              <WhatNextTimeline />
            </div>
          )}

          <div className="stack" style={{ "--gap": "12px" } as React.CSSProperties}>
            {guest ? (
              <Link href="/register" className="btn btn--primary btn--block btn--lg">
                {t("submitted.createAccount")}
              </Link>
            ) : (
              <Link href="/my-reports" className="btn btn--primary btn--block btn--lg">
                {t("submitted.track")}
              </Link>
            )}
            <Link href="/report" className="btn btn--outline btn--block btn--lg">
              {t("submitted.another")}
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}

// ===========================================================================
// My reports
// ===========================================================================
export function MyReportsScreen() {
  const { t } = useT();
  const [filter, setFilter] = useState<ReportStatus | "ALL">("ALL");
  const [reports, setReports] = useState<Report[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (more = false) => {
      setError(null);
      if (!more) setReports(null);
      else setLoadingMore(true);
      try {
        const page = await getReportPage<ReportPage>("reports/me", {
          status: filter === "ALL" ? undefined : filter,
          limit: 20,
          cursor: more ? cursor : undefined,
        });
        setReports((cur) => (more && cur ? [...cur, ...page.reports] : page.reports));
        setCursor(page.next_cursor);
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) {
          window.location.assign("/login?next=/my-reports");
          return;
        }
        setError(err instanceof ApiRequestError ? err.message : t("common.error"));
        if (!more) setReports([]);
      } finally {
        setLoadingMore(false);
      }
    },
    // cursor is read only when loading more
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter, t],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  const filters: (ReportStatus | "ALL")[] = ["ALL", ...STATUSES];

  return (
    <>
      <TopBar title={t("myReports.title")} />
      <main id="main" className="m-screen m-screen--tabs">
        <div className="stack" style={{ "--gap": "16px" } as React.CSSProperties}>
          <div className="chip-scroller chip-scroller--fill" role="group" aria-label={t("myReports.filter")}>
            {filters.map((f) => (
              <button key={f} type="button" className="filter-chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === "ALL" ? t("myReports.all") : t(STATUS_KEY[f])}
              </button>
            ))}
          </div>

          {error ? <ErrorState message={error} onRetry={() => load(false)} /> : null}

          {reports === null ? (
            <div className="report-grid">
              <ReportCardSkeleton />
              <ReportCardSkeleton />
              <ReportCardSkeleton />
            </div>
          ) : reports.length === 0 && !error ? (
            filter === "ALL" ? (
              <EmptyState
                icon={<FileText aria-hidden="true" />}
                title={t("myReports.emptyTitle")}
                body={t("myReports.empty")}
                action={
                  <Link href="/report" className="btn btn--primary btn--lg">
                    <Camera aria-hidden="true" />
                    {t("home.cta")}
                  </Link>
                }
              />
            ) : (
              <EmptyState icon={<FileText aria-hidden="true" />} title={t("myReports.emptyFiltered")} />
            )
          ) : (
            <div className="report-grid">
              {reports.map((r) => (
                <ReportCard key={r.report_id} report={r} href={`/my-reports/${r.report_id}`} />
              ))}
            </div>
          )}

          {cursor && reports?.length ? (
            <button type="button" className="btn btn--outline btn--block" onClick={() => load(true)} disabled={loadingMore}>
              {loadingMore ? <span className="spinner" aria-hidden="true" /> : null}
              {t("common.loadMore")}
            </button>
          ) : null}
        </div>
      </main>
      <TabBar />
    </>
  );
}

// ===========================================================================
// Report detail (citizen): their own report, no moderation data
// ===========================================================================
export function CitizenReportScreen({ id }: { id: string }) {
  const { t } = useT();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<{ message: string; missing: boolean } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.get<{ report: Report }>(`reports/${encodeURIComponent(id)}`);
      setReport(r.report);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        window.location.assign(`/login?next=/my-reports/${encodeURIComponent(id)}`);
        return;
      }
      setError({
        message: err instanceof ApiRequestError ? err.message : t("common.error"),
        missing: err instanceof ApiRequestError && err.status === 404,
      });
    }
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  const title = report ? reportTitle(report, t) : "";

  return (
    <>
      <TopBar title={t("report.title")} back="/my-reports" />
      <main id="main" className="m-screen m-screen--tabs">
        {error ? (
          error.missing ? (
            <EmptyState
              icon={<FileText aria-hidden="true" />}
              title={t("report.notFoundTitle")}
              body={t("report.notFound")}
              action={
                <Link href="/my-reports" className="btn btn--primary">
                  {t("myReports.title")}
                </Link>
              }
            />
          ) : (
            <ErrorState message={error.message} onRetry={load} />
          )
        ) : !report ? (
          <div className="stack">
            <Skeleton height={220} radius={12} />
            <Skeleton height={32} width="70%" />
            <Skeleton height={96} radius={12} />
            <Skeleton height={200} radius={12} />
          </div>
        ) : (
          <div className="stack citizen-detail" style={{ "--gap": "16px" } as React.CSSProperties}>
            <Photo src={report.photo_url} alt={title} className="photo photo--hero" />
            <div className="stack" style={{ "--gap": "10px" } as React.CSSProperties}>
              <h2 className="display-m" style={{ fontSize: 30 }}>
                {title}
              </h2>
              <div className="row wrap">
                <StatusChip status={report.status} large />
              </div>
            </div>

            <div className="card map-row">
              <MapView
                center={{ lat: Number(report.latitude), lng: Number(report.longitude) }}
                pin={{ lat: Number(report.latitude), lng: Number(report.longitude) }}
                height={110}
                zoom={16}
                interactive={false}
                label={t("report.location")}
              />
              <div className="stack" style={{ "--gap": "6px" } as React.CSSProperties}>
                <span className="place">
                  <MapPin aria-hidden="true" />
                  {report.quarter}
                  {report.city ? `, ${report.city}` : ""}
                </span>
                <span className="mono text-brand">{formatCoords(report.latitude, report.longitude)}</span>
              </div>
            </div>

            <div className="card card--pad stack">
              <h2 className="heading-l">{t("report.progress")}</h2>
              <ProgressTimeline status={report.status} history={report.status_history} />
            </div>

            {report.description ? (
              <div className="card card--pad">
                <div className="quote">
                  <Quote aria-hidden="true" />
                  <span>“{report.description}”</span>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </main>
      <TabBar />
    </>
  );
}

// ===========================================================================
// Profile & language
// ===========================================================================
export function ProfileScreen() {
  const { t, lang, setLang } = useT();
  const session = useSession();
  const toast = useToast();
  const signOut = useSignOut();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  // The saved language is applied once, on the first load. Later reloads
  // (after a language change, which re-creates `t`) must not undo a switch
  // the person just made while the save is still in flight.
  const langSynced = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.get<{ profile: Profile }>("me");
      setProfile(r.profile);
      if (r.profile.resolved_count == null) {
        // The profile record keeps a running report count but not a
        // collected count, so count Done reports directly.
        api
          .get<ReportPage>("reports/me", { status: "DONE", limit: 100 })
          .then((done) =>
            setProfile((p) => (p ? { ...p, resolved_count: done.has_more ? 100 : done.reports.length } : p)),
          )
          .catch(() => undefined);
      }
      if (!langSynced.current) {
        langSynced.current = true;
        if (r.profile.language && r.profile.language !== lang) setLang(r.profile.language);
      }
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        window.location.assign("/login?next=/profile");
        return;
      }
      setError(err instanceof ApiRequestError ? err.message : t("common.error"));
    }
    // Load once; language sync is one-way from the server on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeLanguage(next: Lang) {
    const previous = lang;
    setLang(next);
    try {
      await api.patch("me", { language: next });
    } catch {
      setLang(previous);
      toast(t("profile.languageFailed"), "error");
    }
  }

  const username = profile?.username ?? session.username ?? "";
  const hasEmail = Boolean(profile?.email);

  return (
    <>
      <TopBar title={t("profile.title")} />
      <main id="main" className="m-screen m-screen--tabs">
        {error ? <ErrorState message={error} onRetry={load} /> : null}
        <div className="stack profile-grid" style={{ "--gap": "16px" } as React.CSSProperties}>
          <div className="card" style={{ padding: 20 }}>
            <div className="row" style={{ "--gap": "16px" } as React.CSSProperties}>
              <span className="avatar" style={{ "--size": "72px" } as React.CSSProperties}>
                {username.slice(0, 1).toUpperCase() || "?"}
              </span>
              <div className="grow">
                <div className="heading-l">{username || <Skeleton width={120} height={24} />}</div>
                <div className="muted" style={{ fontSize: 17 }}>
                  {profile?.created_at ? t("profile.memberSince", { date: formatMonthYear(profile.created_at, lang) }) : " "}
                </div>
              </div>
            </div>
          </div>

          <div className="card settings-list">
            <div className="settings-row">
              <span className="icon-disc">
                <Phone aria-hidden="true" />
              </span>
              <div>
                <div className="settings-row__title">{t("field.phoneTitle")}</div>
                <div style={{ fontSize: 17 }}>{profile ? formatPhone(profile.phone_number) || "—" : <Skeleton width={150} />}</div>
              </div>
              {profile?.phone_number ? (
                <span className="verified-pill">
                  <CheckCircle aria-hidden="true" />
                  {t("profile.verified")}
                </span>
              ) : (
                <span />
              )}
            </div>
            <div className="settings-row">
              <span className="icon-disc">
                <Mail aria-hidden="true" />
              </span>
              <div className="stack" style={{ "--gap": "4px" } as React.CSSProperties}>
                <div className="settings-row__title">{t("field.emailTitle")}</div>
                {hasEmail ? (
                  <div style={{ fontSize: 17, wordBreak: "break-all" }}>{profile?.email}</div>
                ) : (
                  <button type="button" className="link" style={{ alignSelf: "flex-start", fontSize: 17 }} onClick={() => setEmailOpen(true)}>
                    {t("profile.addEmail")}
                  </button>
                )}
                <div className="help">
                  {profile?.notification_channel === "email" ? t("profile.emailOn") : hasEmail ? t("profile.emailUnverified") : t("profile.emailHelp")}
                </div>
              </div>
              {hasEmail ? (
                profile?.email_verified ? (
                  <span className="verified-pill">
                    <CheckCircle aria-hidden="true" />
                    {t("profile.verified")}
                  </span>
                ) : (
                  <button type="button" className="btn btn--outline btn--sm" onClick={() => setEmailOpen(true)}>
                    {t("profile.verify")}
                  </button>
                )
              ) : (
                <button type="button" className="icon-btn" aria-label={t("profile.addEmail")} onClick={() => setEmailOpen(true)}>
                  <ChevronRight aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="settings-row" style={{ gridTemplateColumns: "56px 1fr" }}>
              <span className="icon-disc">
                <Globe aria-hidden="true" />
              </span>
              <div className="row-between wrap">
                <div className="settings-row__title">{t("field.languageTitle")}</div>
                <LanguageToggle value={lang} onChange={changeLanguage} label={t("field.languageTitle")} />
              </div>
            </div>
          </div>

          <div className="card stat-pair">
            <div>
              <span className="icon-disc">
                <FileText aria-hidden="true" />
              </span>
              <span>
                <strong>{profile?.report_count ?? "—"}</strong>
                <span style={{ fontSize: 18 }}>{t("profile.reports")}</span>
              </span>
            </div>
            <div>
              <span className="icon-disc">
                <Truck aria-hidden="true" />
              </span>
              <span>
                <strong>{profile?.resolved_count ?? "—"}</strong>
                <span style={{ fontSize: 18 }}>{t("profile.collected")}</span>
              </span>
            </div>
          </div>

          <button type="button" className="btn btn--danger-outline btn--block btn--lg" onClick={signOut}>
            <LogOut aria-hidden="true" />
            {t("common.signOut")}
          </button>
        </div>
      </main>
      <TabBar />
      <AddEmailDialog
        open={emailOpen}
        initial={profile?.email ?? ""}
        onClose={() => setEmailOpen(false)}
        onDone={() => {
          setEmailOpen(false);
          toast(t("profile.emailAdded"));
          load();
        }}
      />
    </>
  );
}

function AddEmailDialog({ open, initial, onClose, onDone }: { open: boolean; initial: string; onClose: () => void; onDone: () => void }) {
  const { t } = useT();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(initial);
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setStep("email");
      setEmail(initial);
      setCode("");
      setError(null);
    }
  }, [open, initial]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await authCall("email-start", { email });
      setSentTo(r.destination ?? email);
      setStep("code");
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.code : "";
      setError(code === "INVALID_EMAIL" ? t("auth.error.INVALID_EMAIL") : code === "EMAIL_TAKEN" ? t("auth.error.EMAIL_TAKEN") : t("auth.error.SERVICE_ERROR"));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authCall("email-verify", { code });
      onDone();
    } catch (err) {
      const c = err instanceof ApiRequestError ? err.code : "";
      setError(c === "WRONG_CODE" ? t("profile.wrongEmailCode") : c === "CODE_EXPIRED" ? t("auth.error.CODE_EXPIRED") : t("auth.error.SERVICE_ERROR"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="email-title">
      {step === "email" ? (
        <form className="stack" onSubmit={send} noValidate>
          <h2 id="email-title" className="heading-l">
            {t("profile.addEmail")}
          </h2>
          <p>{t("profile.emailWhy")}</p>
          <TextField label={t("field.email")} type="email" value={email} onChange={setEmail} autoComplete="email" inputMode="email" autoFocus />
          <FieldError>{error}</FieldError>
          <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {t("profile.sendCode")}
          </button>
        </form>
      ) : (
        <form className="stack" onSubmit={verify} noValidate>
          <h2 id="email-title" className="heading-l">
            {t("verify.title")}
          </h2>
          <p>{t("profile.emailSentTo", { destination: sentTo })}</p>
          <OtpInput value={code} onChange={setCode} label={t("verify.codeLabel")} invalid={Boolean(error)} />
          <FieldError>{error}</FieldError>
          <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy || code.length !== 6}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {t("verify.submit")}
          </button>
        </form>
      )}
    </Dialog>
  );
}
