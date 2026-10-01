"use client";

// The screen the product exists for. Designed for one hand, bright sun and a
// connection that may drop mid-upload: the photo is shrunk on the phone
// before it is sent, upload progress is shown, and a failed upload keeps
// everything the person entered so "Try again" is one tap.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api, ApiRequestError, ensureGuest, uploadPhoto } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { formatCoords, timeAgo } from "@/lib/format";
import { CATEGORIES, CATEGORY_KEY, CITIES, DEFAULT_CENTER, DEFAULT_CITY, isInCameroon, suggestPlace } from "@/lib/reports";
import type { Category, Report } from "@/lib/types";
import { useSession } from "@/components/Providers";
import { MapView, type LatLng } from "@/components/MapView";
import { TabBar, TopBar } from "@/components/shell";
import { Camera, Check, CheckCircle, Crosshair, LocateFixed, Retry, UserRound, Warning, WifiOff } from "@/components/icons";
import { FieldError } from "@/components/ui";

const MAX_EDGE = 1600;
const MAX_BYTES = 10 * 1024 * 1024;
const OTHER = "__other__";

interface PreparedPhoto {
  blob: Blob;
  type: string;
  preview: string;
}

/** Shrink to at most 1600px on the long edge as JPEG: ~300 KB instead of 4 MB. */
async function preparePhoto(file: File): Promise<PreparedPhoto> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (blob) return { blob, type: "image/jpeg", preview: URL.createObjectURL(blob) };
  } catch {
    // Fall through: the browser cannot decode it (e.g. HEIC outside Safari).
  }
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic"];
  if (!allowed.includes(file.type) || file.size > MAX_BYTES) throw new Error("unsupported");
  return { blob: file, type: file.type, preview: URL.createObjectURL(file) };
}

/** A small thumbnail for the confirmation screen, kept in sessionStorage. */
async function thumbnail(blob: Blob): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  }
}

type LocState = "locating" | "found" | "denied" | "unavailable" | "manual" | "outside";
type Phase = "idle" | "uploading" | "saving" | "failed";

export const LAST_REPORT_KEY = "cam_last_report";

export function SubmitReportScreen() {
  const { t, lang } = useT();
  const router = useRouter();
  const session = useSession();
  const isGuest = session.role !== "Citizen";
  const fileInput = useRef<HTMLInputElement>(null);
  const noteId = useId();

  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [location, setLocation] = useState<LatLng | null>(null);
  const [locState, setLocState] = useState<LocState>("locating");
  const [city, setCity] = useState(DEFAULT_CITY);
  const [quarter, setQuarter] = useState("");
  const [customQuarter, setCustomQuarter] = useState("");
  const [placeTouched, setPlaceTouched] = useState(false);
  const [category, setCategory] = useState<Category | null>(null);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; created_at?: string } | null>(null);
  const [online, setOnline] = useState(true);
  const [guestLabel, setGuestLabel] = useState(session.guestLabel);
  const uploaded = useRef<{ blob: Blob; key: string } | null>(null);
  const abortUpload = useRef<(() => void) | null>(null);

  // ---- connection ----------------------------------------------------------
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // ---- location --------------------------------------------------------------
  const applyPoint = useCallback(
    (point: LatLng, source: "gps" | "manual") => {
      if (!isInCameroon(point.lat, point.lng)) {
        setLocation(point);
        setLocState("outside");
        return;
      }
      setLocation(point);
      setLocState(source === "gps" ? "found" : "manual");
      setErrors((e) => ({ ...e, location: "" }));
      if (!placeTouched) {
        const place = suggestPlace(point.lat, point.lng);
        if (place) {
          setCity(place.city);
          setQuarter(place.quarter);
        }
      }
    },
    [placeTouched],
  );

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setLocState("unavailable");
      return;
    }
    setLocState("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => applyPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude }, "gps"),
      (err) => setLocState(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }, [applyPoint]);

  useEffect(() => {
    locate();
    // Ask once when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => abortUpload.current?.(), []);

  // ---- photo -----------------------------------------------------------------
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoError(null);
    try {
      const prepared = await preparePhoto(file);
      if (photo) URL.revokeObjectURL(photo.preview);
      setPhoto(prepared);
      uploaded.current = null;
      setErrors((x) => ({ ...x, photo: "" }));
      setFailure(null);
      setPhase("idle");
    } catch {
      setPhotoError(t("submit.photoUnsupported"));
    }
  }

  // ---- submit ----------------------------------------------------------------
  const quarterValue = quarter === OTHER ? customQuarter.trim() : quarter;

  function validate(): boolean {
    const found: Record<string, string> = {};
    if (!photo) found.photo = t("submit.error.photo");
    if (!location || locState === "outside") found.location = locState === "outside" ? t("submit.error.outside") : t("submit.error.location");
    if (!quarterValue) found.quarter = t("submit.error.quarter");
    setErrors(found);
    const first = ["photo", "location", "quarter"].find((k) => found[k]);
    if (first) document.getElementById(`step-${first}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    return !first;
  }

  async function submit(confirmDuplicate = false, retried = false) {
    if (phase === "uploading" || phase === "saving") return;
    if (!validate() || !photo || !location) return;
    setFailure(null);
    setDuplicate(null);

    try {
      if (isGuest) {
        const guest = await ensureGuest();
        setGuestLabel(guest.guest_label);
      }

      // 1. Upload the photo straight to storage (skipped if already there).
      if (!uploaded.current || uploaded.current.blob !== photo.blob) {
        setPhase("uploading");
        setProgress(0);
        const presign = await api.post<{ upload_url: string; s3_key: string; required_headers: Record<string, string> }>(
          isGuest ? "guest/uploads/presign" : "uploads/presign",
          { content_type: photo.type, file_size: photo.blob.size },
        );
        const upload = uploadPhoto(presign.upload_url, photo.blob, presign.required_headers, setProgress);
        abortUpload.current = upload.abort;
        await upload.promise;
        abortUpload.current = null;
        uploaded.current = { blob: photo.blob, key: presign.s3_key };
      }

      // 2. Create the report.
      setPhase("saving");
      const result = await api.post<{ report: Report; tracking: "account" | "none" }>(isGuest ? "guest/reports" : "reports", {
        s3_key: uploaded.current.key,
        latitude: Number(location.lat.toFixed(6)),
        longitude: Number(location.lng.toFixed(6)),
        quarter: quarterValue,
        city,
        category: category ?? "OTHER",
        description: note.trim() || undefined,
        confirm_duplicate: confirmDuplicate || undefined,
      });

      const thumb = await thumbnail(photo.blob);
      try {
        sessionStorage.setItem(LAST_REPORT_KEY, JSON.stringify({ report: result.report, tracking: result.tracking, thumb, guestLabel }));
      } catch {
        // Private mode: the confirmation screen falls back to the photo URL.
      }
      router.push("/report/submitted");
    } catch (err) {
      abortUpload.current = null;
      // The server dropped a guest token the API no longer accepts: get a new
      // guest identity and try once more (the photo goes to the new folder).
      if (isGuest && !retried && err instanceof ApiRequestError && err.code === "GUEST_SESSION_EXPIRED") {
        uploaded.current = null;
        return submit(confirmDuplicate, true);
      }
      handleError(err);
    }
  }

  function handleError(err: unknown) {
    setPhase("failed");
    if (!(err instanceof ApiRequestError)) {
      setFailure(t("submit.error.generic"));
      return;
    }
    switch (err.code) {
      case "ACCOUNT_SUSPENDED":
        window.location.assign("/suspended");
        return;
      case "GUEST_BLOCKED":
        window.location.assign("/suspended?guest=1");
        return;
      case "POSSIBLE_DUPLICATE": {
        const d = err.details ?? {};
        setDuplicate({ id: String(d.existing_report_id ?? ""), created_at: d.created_at as string | undefined });
        setPhase("idle");
        return;
      }
      case "USE_ACCOUNT":
        setFailure(t("submit.error.useAccount"));
        return;
      case "RATE_LIMITED":
        setFailure(isGuest ? t("submit.error.rateGuest") : t("submit.error.rate"));
        return;
      case "PHOTO_NOT_UPLOADED":
      case "INVALID_PHOTO_KEY":
        uploaded.current = null;
        setFailure(t("submit.error.photoMissing"));
        return;
      case "NETWORK":
      case "UPLOAD_FAILED":
      case "API_UNREACHABLE":
        setFailure(t("submit.error.network"));
        return;
      case "UNAUTHORIZED":
        window.location.assign("/login?next=/report");
        return;
      default:
        setFailure(err.message || t("submit.error.generic"));
    }
  }

  // The duplicate question and upload errors sit below the form; bring them
  // into view, since the person's thumb is on the button at the bottom.
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (duplicate || failure) alertRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [duplicate, failure]);

  const busy = phase === "uploading" || phase === "saving";
  const quarters = CITIES[city] ?? [];
  const mapCenter = location ?? DEFAULT_CENTER;

  return (
    <>
      <TopBar title={t("submit.title")} back={isGuest ? "/guest" : "/home"} />
      <main id="main" className={`m-screen ${isGuest ? "" : "m-screen--tabs-cta"}`} style={isGuest ? { paddingBottom: 120 } : undefined}>
        <div className="stack" style={{ "--gap": "16px" } as React.CSSProperties}>
          {isGuest ? (
            <div className="banner banner--info" style={{ alignItems: "center" }}>
              <UserRound aria-hidden="true" />
              <span className="grow">
                {guestLabel ? t("submit.guestAs", { label: guestLabel }) : t("submit.guestNew")}{" "}
                <Link href="/login?next=/report" className="link">
                  {t("nav.signIn")}
                </Link>
              </span>
            </div>
          ) : null}

          {!online ? (
            <div className="banner banner--warning" role="status">
              <WifiOff aria-hidden="true" />
              <span>{t("submit.offline")}</span>
            </div>
          ) : null}

          {/* 1. Photo */}
          <section className="step-card" id="step-photo" aria-labelledby="s1">
            <div className="step-head">
              <span className={`step-num${photo ? " step-num--done" : ""}`} aria-hidden="true">
                {photo ? <Check strokeWidth={3} /> : 1}
              </span>
              <div>
                <h2 id="s1" className="step-title">
                  {t("submit.photo.title")}
                </h2>
                <p className="step-sub">{t("submit.photo.sub")}</p>
              </div>
            </div>
            <input ref={fileInput} type="file" accept="image/*" capture="environment" onChange={onFile} hidden />
            {photo ? (
              <div className="captured">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.preview} alt={t("submit.photo.alt")} />
                {phase === "uploading" ? (
                  <div className="captured__shade" role="status">
                    <span>{t("submit.uploading", { percent: progress })}</span>
                    <div className="progress" aria-hidden="true">
                      <span style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                ) : (
                  <div className="captured__bar">
                    <button type="button" className="pill-btn" onClick={() => fileInput.current?.click()} disabled={busy}>
                      <Camera aria-hidden="true" />
                      {t("submit.retake")}
                    </button>
                    <span className="pill-ok">
                      <CheckCircle aria-hidden="true" />
                      {t("submit.photoAdded")}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <button type="button" className="capture" onClick={() => fileInput.current?.click()} aria-describedby={errors.photo ? "photo-err" : undefined}>
                <span className="icon-disc">
                  <Camera aria-hidden="true" />
                </span>
                {t("submit.takePhoto")}
                <small>{t("submit.photoHint")}</small>
              </button>
            )}
            <FieldError id="photo-err">{errors.photo || photoError}</FieldError>
          </section>

          {/* 2. Location */}
          <section className="step-card" id="step-location" aria-labelledby="s2">
            <div className="step-head">
              <span className={`step-num${location && locState !== "outside" ? " step-num--done" : ""}`} aria-hidden="true">
                {location && locState !== "outside" ? <Check strokeWidth={3} /> : 2}
              </span>
              <div>
                <h2 id="s2" className="step-title">
                  {t("submit.location.title")}
                </h2>
                <p className="step-sub">{t("submit.location.sub")}</p>
              </div>
            </div>

            {locState === "denied" || locState === "unavailable" ? (
              <div className="banner banner--warning" role="status">
                <Warning aria-hidden="true" />
                <span>{locState === "denied" ? t("submit.locationDenied") : t("submit.locationUnavailable")}</span>
              </div>
            ) : null}

            <div className="map-frame">
              <MapView
                center={mapCenter}
                pin={location}
                zoom={location ? 17 : 15}
                label={t("submit.location.title")}
                onPick={(p) => applyPoint(p, "manual")}
              />
              <div className="map-overlay" style={{ top: 12, right: 12 }}>
                {locState === "locating" ? (
                  <span className="pill-float">
                    <span className="spinner" aria-hidden="true" />
                    {t("submit.locating")}
                  </span>
                ) : locState === "found" || locState === "manual" ? (
                  <span className="pill-float pill-float--ok">
                    <CheckCircle aria-hidden="true" style={{ color: "var(--brand-deep)" }} />
                    {locState === "found" ? t("submit.locationFound") : t("submit.pinPlaced")}
                  </span>
                ) : null}
              </div>
              {location ? (
                <div className="map-overlay" style={{ left: 12, bottom: 12 }}>
                  <span className="coords-pill mono">
                    <Crosshair aria-hidden="true" />
                    {formatCoords(location.lat, location.lng)}
                  </span>
                </div>
              ) : null}
            </div>
            <div className="row-between wrap">
              <span className="help">{location ? t("submit.adjustPin") : t("submit.tapMap")}</span>
              <button type="button" className="link" onClick={locate}>
                <LocateFixed aria-hidden="true" style={{ width: 16, height: 16, verticalAlign: "-3px", marginRight: 4 }} />
                {t("submit.useMyLocation")}
              </button>
            </div>
            <FieldError>{errors.location}</FieldError>
          </section>

          {/* 3. Details */}
          <section className="step-card" id="step-quarter" aria-labelledby="s3">
            <div className="step-head">
              <span className={`step-num${quarterValue ? " step-num--done" : ""}`} aria-hidden="true">
                {quarterValue ? <Check strokeWidth={3} /> : 3}
              </span>
              <div>
                <h2 id="s3" className="step-title">
                  {t("submit.details.title")}
                </h2>
                <p className="step-sub">{t("submit.details.sub")}</p>
              </div>
            </div>
            <div className="two-col">
              <div className="field">
                <label className="label" htmlFor="quarter">
                  {t("field.quarter")}
                </label>
                <select
                  id="quarter"
                  className="select"
                  value={quarter}
                  aria-invalid={errors.quarter ? true : undefined}
                  onChange={(e) => {
                    setQuarter(e.target.value);
                    setPlaceTouched(true);
                  }}
                >
                  <option value="">{t("submit.chooseQuarter")}</option>
                  {quarters.map((q) => (
                    <option key={q.name} value={q.name}>
                      {q.name}
                    </option>
                  ))}
                  <option value={OTHER}>{t("submit.otherQuarter")}</option>
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="city">
                  {t("field.city")}
                </label>
                <select
                  id="city"
                  className="select"
                  value={city}
                  onChange={(e) => {
                    setCity(e.target.value);
                    setQuarter("");
                    setPlaceTouched(true);
                  }}
                >
                  {Object.keys(CITIES).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {quarter === OTHER ? (
              <input
                className="input"
                aria-label={t("submit.otherQuarterLabel")}
                placeholder={t("submit.otherQuarterLabel")}
                value={customQuarter}
                maxLength={80}
                onChange={(e) => setCustomQuarter(e.target.value)}
              />
            ) : null}
            <FieldError>{errors.quarter}</FieldError>

            <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
              <legend className="label" style={{ marginBottom: 8 }}>
                {t("submit.category")}
              </legend>
              <div className="cat-grid">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="filter-chip"
                    aria-pressed={category === c}
                    onClick={() => setCategory((cur) => (cur === c ? null : c))}
                  >
                    {t(CATEGORY_KEY[c])}
                  </button>
                ))}
              </div>
            </fieldset>
          </section>

          {/* 4. Note */}
          <section className="step-card" aria-labelledby="s4">
            <div className="step-head">
              <span className="step-num" aria-hidden="true">
                4
              </span>
              <div>
                <h2 id="s4" className="step-title">
                  {t("submit.note.title")}
                </h2>
                <p className="step-sub">{t("submit.note.sub")}</p>
              </div>
            </div>
            <div className="input-wrap">
              <label htmlFor={noteId} className="sr-only">
                {t("submit.note.title")}
              </label>
              <textarea
                id={noteId}
                className="textarea"
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("submit.note.placeholder")}
              />
              <span className="counter" aria-hidden="true">
                {note.length} / 500
              </span>
            </div>
          </section>

          <div ref={alertRef} className="stack" style={{ "--gap": "12px" } as React.CSSProperties}>
          {duplicate ? (
            <div className="banner banner--warning" role="alert">
              <Warning aria-hidden="true" />
              <div className="stack" style={{ "--gap": "10px" } as React.CSSProperties}>
                <strong>{t("submit.duplicate.title")}</strong>
                <span>
                  {t("submit.duplicate.body", { ref: duplicate.id, when: duplicate.created_at ? timeAgo(duplicate.created_at, lang) : "" })}
                </span>
                <div className="row wrap">
                  <button type="button" className="btn btn--outline btn--sm" onClick={() => submit(true)}>
                    {t("submit.duplicate.separate")}
                  </button>
                  {!isGuest ? (
                    <Link href={`/my-reports/${duplicate.id}`} className="link">
                      {t("submit.duplicate.view")}
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {failure ? (
            <div className="banner banner--danger" role="alert">
              <Warning aria-hidden="true" />
              <div className="stack" style={{ "--gap": "10px" } as React.CSSProperties}>
                <span>{failure}</span>
                <span className="help" style={{ color: "inherit" }}>
                  {t("submit.kept")}
                </span>
              </div>
            </div>
          ) : null}
          </div>
        </div>
      </main>

      <div className={`action-bar${isGuest ? " action-bar--bottom" : ""}`}>
        <div className="action-bar__inner">
          <button type="button" className="btn btn--primary btn--block btn--lg" onClick={() => submit(false)} disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : phase === "failed" ? <Retry aria-hidden="true" /> : null}
            {phase === "uploading"
              ? t("submit.uploading", { percent: progress })
              : phase === "saving"
                ? t("submit.sending")
                : phase === "failed"
                  ? t("common.tryAgain")
                  : t("submit.submit")}
          </button>
        </div>
      </div>
      {isGuest ? null : <TabBar />}
    </>
  );
}
