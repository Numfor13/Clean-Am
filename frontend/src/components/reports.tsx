"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n";
import { formatDateTime, formatShortDateTime, timeAgo } from "@/lib/format";
import { isGuestReport, reportTitle, STATUS_KEY, STATUSES } from "@/lib/reports";
import type { Report, ReportStatus, StatusHistoryEntry } from "@/lib/types";
import { Check, ChevronRight, MapPin, User } from "./icons";
import { Photo, StatusChip } from "./ui";

/** One report in a phone list: photo, title, place, time, reference. */
export function ReportCard({ report, href, showReporter }: { report: Report; href: string; showReporter?: boolean }) {
  const { t, lang } = useT();
  const title = reportTitle(report, t);
  const guest = isGuestReport(report);
  return (
    <Link href={href} className="report-card">
      <div className="report-card__media">
        <Photo src={report.photo_url} alt={title} />
      </div>
      <div className="report-card__body">
        <div className="report-card__top">
          <h3 className="report-card__title">{title}</h3>
          <StatusChip status={report.status} flagged={report.is_fraudulent} />
        </div>
        {showReporter ? (
          <div className="report-card__meta">
            <User aria-hidden="true" />
            <span className="truncate">{report.username}</span>
            {guest ? <span className="tag">{t("report.guestTag")}</span> : null}
            <span className="muted nowrap">· {timeAgo(report.created_at, lang)}</span>
          </div>
        ) : (
          <>
            <div className="report-card__meta">
              <MapPin aria-hidden="true" />
              <span className="truncate">
                {report.quarter}
                {report.city ? `, ${report.city}` : ""}
              </span>
            </div>
            <div className="muted" style={{ fontSize: 15 }}>
              {t("report.submittedAgo", { when: timeAgo(report.created_at, lang) })}
            </div>
          </>
        )}
        <div className="report-card__foot">
          {showReporter ? (
            <span>
              {t("report.ref")}{" "}
              <span className="mono" style={{ color: "var(--ink-strong)" }}>
                {report.report_id}
              </span>
            </span>
          ) : <span />}
          <ChevronRight aria-hidden="true" />
        </div>
      </div>
    </Link>
  );
}

export function ReportCardSkeleton() {
  return (
    <div className="report-card" aria-hidden="true">
      <div className="report-card__media skeleton" style={{ borderRadius: 12 }} />
      <div className="report-card__body">
        <div className="skeleton" style={{ height: 20, width: "80%" }} />
        <div className="skeleton" style={{ height: 14, width: "60%" }} />
        <div className="skeleton" style={{ height: 14, width: "45%" }} />
        <div className="skeleton" style={{ height: 14, width: "70%", marginTop: "auto" }} />
      </div>
    </div>
  );
}

/**
 * The citizen's view of progress: Submitted → In Progress → Done, with the
 * sentence each state means. No staff names (FR-REPORT-04).
 */
export function ProgressTimeline({ status, history }: { status: ReportStatus; history?: StatusHistoryEntry[] }) {
  const { t, lang } = useT();
  const reached = STATUSES.indexOf(status);
  const at = (s: ReportStatus) => history?.filter((h) => h.status === s).pop()?.at;

  const steps: { key: ReportStatus; title: string; note?: string }[] = [
    { key: "PENDING", title: t("progress.submitted") },
    { key: "IN_PROGRESS", title: t(STATUS_KEY.IN_PROGRESS), note: t("progress.inProgressNote") },
    { key: "DONE", title: t(STATUS_KEY.DONE), note: t("progress.doneNote") },
  ];

  return (
    <ol className="timeline">
      {steps.map((step, i) => {
        // "Submitted" is always complete; the report's current state is the
        // one step shown as in progress, unless it is Done.
        const done = i === 0 || i < reached || (i === reached && step.key === "DONE");
        const current = i === reached && i > 0 && step.key !== "DONE";
        const when = at(step.key);
        return (
          <li key={step.key} data-state={i < reached ? "done" : undefined}>
            <span
              className={`tl-mark ${
                done ? (step.key === "DONE" ? "tl-mark--DONE" : "tl-mark--done") : current ? `tl-mark--${step.key}` : ""
              }`}
              aria-hidden="true"
            >
              {done ? <Check strokeWidth={3} /> : null}
            </span>
            <div>
              <div className={`tl-title${i > reached ? " tl-title--muted" : ""}`} style={i <= reached ? { color: "var(--brand-deep)" } : undefined}>
                {step.title}
                <span className="sr-only">
                  {done ? ` (${t("progress.complete")})` : current ? ` (${t("progress.current")})` : ` (${t("progress.notYet")})`}
                </span>
              </div>
              {i <= reached && step.note ? <div style={{ fontSize: 16 }}>{step.note}</div> : null}
              {when && i <= reached ? (
                <div className="mono muted" style={{ fontSize: 15 }}>
                  {formatShortDateTime(when, lang)}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** The static "what happens next" list on the confirmation screen. */
export function WhatNextTimeline() {
  const { t } = useT();
  const steps: [ReportStatus, string][] = [
    ["PENDING", t("next.pending")],
    ["IN_PROGRESS", t("next.inProgress")],
    ["DONE", t("next.done")],
  ];
  return (
    <ol className="timeline">
      {steps.map(([key, note], i) => (
        <li key={key}>
          <span className={`tl-mark ${i === 0 ? "tl-mark--PENDING" : "tl-mark--todo"}`} aria-hidden="true" />
          <div>
            <div className="tl-title">{t(STATUS_KEY[key])}</div>
            <div style={{ fontSize: 16 }}>{note}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Staff accountability trail: who changed what, and when (FR-MGMT-06). */
export function HistoryTimeline({ report }: { report: Report }) {
  const { t, lang } = useT();
  const entries = [...(report.status_history ?? [])].reverse();
  return (
    <ol className="timeline">
      {entries.map((h, i) => {
        const who = h.by_username ?? report.username;
        const title =
          h.status === "PENDING" && !h.from_status
            ? t("history.submittedBy", { name: who })
            : t("history.markedBy", { status: t(STATUS_KEY[h.status]), name: who });
        const note = h.status === "PENDING" && !h.from_status ? report.description : h.note;
        return (
          <li key={`${h.at}-${i}`}>
            <span className={`tl-mark tl-mark--small tl-mark--${h.status}`} aria-hidden="true" />
            <div>
              <div>
                <span className="strong">{title}</span>
                <span className="muted"> · {formatDateTime(h.at, lang)}</span>
              </div>
              {note ? <div className="tl-note">{note}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
