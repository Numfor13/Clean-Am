"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { STATUS_KEY } from "@/lib/reports";
import type { ReportStatus } from "@/lib/types";
import { AlertCircle, ImageOff } from "./icons";

/** The CLEAN-AM leaf mark and wordmark. */
export function Logo({ sub, href = "/", size = 38 }: { sub?: string | null; href?: string | null; size?: number }) {
  const mark = (
    <>
      <span className="logo__mark" style={{ "--logo-size": `${size}px` } as React.CSSProperties} aria-hidden="true">
        <svg viewBox="0 0 48 48">
          <path
            d="M42 6C24 6 8 14 8 31c0 4 1.3 7.4 3.4 10.1C14 32 20 25 29 20c-7 6.3-12 13.4-14.7 23.2C17.2 44.4 20.4 45 24 45 37 45 43 32 43 18c0-4-.3-8.4-1-12Z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span className="logo__name">
        <span className="logo__word">CLEAN-AM</span>
        {sub ? <span className="logo__sub">{sub}</span> : null}
      </span>
    </>
  );
  if (href === null) return <span className="logo">{mark}</span>;
  return (
    <Link href={href} className="logo" aria-label="CLEAN-AM home">
      {mark}
    </Link>
  );
}

/** Cameroon's flag, drawn rather than an emoji so it renders everywhere. */
export function FlagCm() {
  return (
    <span className="flag-cm" aria-hidden="true">
      <span style={{ background: "#007a5e" }} />
      <span style={{ background: "#ce1126", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg viewBox="0 0 10 10" width="8" height="8">
          <path d="M5 .8 6.2 3.9h3.2L6.8 5.8l1 3.2L5 7.1 2.2 9l1-3.2L.6 3.9h3.2Z" fill="#fcd116" />
        </svg>
      </span>
      <span style={{ background: "#fcd116" }} />
    </span>
  );
}

export function StatusChip({ status, flagged, large }: { status: ReportStatus; flagged?: boolean; large?: boolean }) {
  const { t } = useT();
  if (flagged) {
    return <span className={`chip chip--FLAGGED${large ? " chip--lg" : ""}`}>{t("status.FLAGGED")}</span>;
  }
  return <span className={`chip chip--${status}${large ? " chip--lg" : ""}`}>{t(STATUS_KEY[status])}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span role="status" className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
      <span className="spinner" aria-hidden="true" />
      {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

export function FieldError({ id, children }: { id?: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p className="field-error" id={id} role="alert">
      <AlertCircle aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** A report photo with a quiet fallback when the signed URL has expired. */
export function Photo({
  src,
  alt,
  className = "thumb",
  style,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div className={`${className} photo-fallback`} style={style} role="img" aria-label={alt}>
        <ImageOff aria-hidden="true" size={28} />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} style={style} loading="lazy" onError={() => setBroken(true)} />;
}

export function Skeleton({ height = 16, width = "100%", radius }: { height?: number; width?: number | string; radius?: number }) {
  return <div className="skeleton" style={{ height, width, borderRadius: radius }} aria-hidden="true" />;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="icon-disc" style={{ "--size": "88px" } as React.CSSProperties}>
        {icon}
      </span>
      <h2 className="heading-m">{title}</h2>
      {body ? <p>{body}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useT();
  return (
    <div className="banner banner--danger" role="alert">
      <AlertCircle aria-hidden="true" />
      <div className="stack grow" style={{ "--gap": "8px" } as React.CSSProperties}>
        <span>{message}</span>
        {onRetry ? (
          <button type="button" className="link" onClick={onRetry} style={{ alignSelf: "flex-start" }}>
            {t("common.retry")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

