"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiRequestError, authCall } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/messages";
import { toE164 } from "@/lib/format";
import { usernameOk } from "@/lib/reports";
import { useSession } from "@/components/Providers";
import { LangSwitch, LanguageToggle, OtpInput, PasswordField, PasswordRules, PasswordMatchRule, PhoneInput, TextField, passwordOk } from "@/components/forms";
import { TopBar } from "@/components/shell";
import { CheckCircle, GoogleLogo, Lock, Mail, MessageDots, ShieldCheck, Smartphone, User, Warning } from "@/components/icons";
import { FieldError } from "@/components/ui";
import type { Lang } from "@/lib/types";

const KNOWN_AUTH_ERRORS = [
  "WRONG_CREDENTIALS",
  "NOT_CONFIRMED",
  "ACCOUNT_SUSPENDED",
  "PHONE_TAKEN",
  "EMAIL_TAKEN",
  "WEAK_PASSWORD",
  "WRONG_CODE",
  "CODE_EXPIRED",
  "TOO_MANY_ATTEMPTS",
  "INVALID_PHONE",
  "INVALID_USERNAME",
  "USERNAME_REQUIRED",
  "INVALID_EMAIL",
  "INVALID_INPUT",
  "ACCOUNT_DISABLED",
  "SESSION_EXPIRED",
  "SMS_UNAVAILABLE",
  "NETWORK",
];

/** `app`: the code came from an authenticator app, not an SMS. */
export function authErrorMessage(error: unknown, t: (key: MessageKey) => string, app = false): string {
  if (app && error instanceof ApiRequestError && error.code === "WRONG_CODE") return t("security.wrongCode");
  if (error instanceof ApiRequestError && KNOWN_AUTH_ERRORS.includes(error.code)) {
    return t(`auth.error.${error.code}` as MessageKey);
  }
  return t("auth.error.SERVICE_ERROR");
}

function go(next?: string) {
  window.location.assign(next || "/");
}

/** Where a failed sign-in step should send the person instead of showing an error. */
function redirectFor(error: unknown): string | null {
  if (error instanceof ApiRequestError && error.code === "ACCOUNT_SUSPENDED") return "/suspended";
  return null;
}

/** "Continue with Google": a plain link, the server does the OAuth round trip. */
function GoogleButton({ next }: { next?: string }) {
  // Google authentication commented out: authentication is purely phone-number based.
  /*
  const session = useSession();
  const { t } = useT();
  if (!session.google) return null;
  const href = `/api/auth/google${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  return (
    <a href={href} className="btn btn--outline btn--block btn--lg btn--google">
      <GoogleLogo aria-hidden="true" />
      {t("login.google")}
    </a>
  );
  */
  return null;
}

// ===========================================================================
// Sign in
// ===========================================================================
export function LoginScreen({ next, notice }: { next?: string; notice?: "confirmed" | "reset" | "google" | null }) {
  const { t } = useT();
  const [mode, setMode] = useState<"password" | "code">("password");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldError(null);
    const identifier = toE164(phone);
    if (!identifier) {
      setFieldError(t("auth.error.INVALID_PHONE"));
      return;
    }
    setBusy(true);
    try {
      const result =
        mode === "code"
          ? await authCall("sign-in-code", { phone: identifier, next })
          : await authCall("sign-in", { identifier, password, next });
      go(result.next);
    } catch (err) {
      const to = redirectFor(err);
      if (to) return go(to);
      setError(authErrorMessage(err, t));
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar logo end={<LangSwitch />} />
      <main id="main" className="auth-wrap">
        <div className="auth-hero">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/login-truck.jpg" alt="" />
          <div className="auth-hero__shade" />
          <p className="auth-hero__text">{t("login.heroLine")}</p>
        </div>
        <form className="auth-card stack" style={{ "--gap": "20px" } as React.CSSProperties} onSubmit={submit} noValidate>
          <div>
            <h1 className="display-l" style={{ fontSize: 44 }}>
              {t("login.title")}
            </h1>
            <p className="body-l" style={{ color: "var(--brand-deep)", fontSize: 21 }}>
              {t("login.welcome")}
            </p>
          </div>

          {notice === "confirmed" ? (
            <div className="banner banner--success" role="status">
              <CheckCircle aria-hidden="true" />
              <span>{t("login.confirmed")}</span>
            </div>
          ) : null}
          {notice === "reset" ? (
            <div className="banner banner--success" role="status">
              <CheckCircle aria-hidden="true" />
              <span>{t("login.resetDone")}</span>
            </div>
          ) : null}
          {notice === "google" ? (
            <div className="banner banner--danger" role="alert">
              <Warning aria-hidden="true" />
              <span>{t("login.googleFailed")}</span>
            </div>
          ) : null}

          <PhoneInput value={phone} onChange={setPhone} error={fieldError} />

          {mode === "password" ? (
            <div className="stack" style={{ "--gap": "10px" } as React.CSSProperties}>
              <PasswordField label={t("field.password")} value={password} onChange={setPassword} />
              <Link href="/forgot-password" className="link" style={{ alignSelf: "flex-end" }}>
                {t("login.forgot")}
              </Link>
            </div>
          ) : (
            <p className="help">{t("login.codeHelp")}</p>
          )}

          {error ? (
            <div className="banner banner--danger" role="alert">
              <Warning aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {mode === "code" ? t("login.sendCode") : t("login.submit")}
          </button>

          <div className="or-divider">{t("common.or")}</div>
          <GoogleButton next={next} />
          <button
            type="button"
            className="btn btn--outline btn--block btn--lg"
            onClick={() => {
              setMode((m) => (m === "password" ? "code" : "password"));
              setError(null);
            }}
          >
            {mode === "password" ? <MessageDots aria-hidden="true" /> : <Lock aria-hidden="true" />}
            {mode === "password" ? t("login.useCode") : t("login.usePassword")}
          </button>
          <p className="center" style={{ fontSize: 17 }}>
            {t("login.newHere")}{" "}
            <Link href="/register" className="link">
              {t("login.createAccount")}
            </Link>
          </p>
        </form>
      </main>
    </>
  );
}

// ===========================================================================
// Staff Sign in (Hidden Portal for Municipal Staff and Administrators)
// ===========================================================================
export function StaffLoginScreen({ next }: { next?: string }) {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldError(null);
    const identifier = email.trim();
    if (!identifier || !/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(identifier)) {
      setFieldError(t("auth.error.INVALID_EMAIL"));
      return;
    }
    setBusy(true);
    try {
      const result = await authCall("staff-sign-in", { email: identifier, password, next });
      go(result.next);
    } catch (err) {
      const to = redirectFor(err);
      if (to) return go(to);
      setError(authErrorMessage(err, t));
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar logo end={<span className="staff-pill staff-pill--mint">{t("nav.staff")}</span>} />
      <main id="main" className="auth-wrap">
        <div className="auth-hero">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/login-truck.jpg" alt="" />
          <div className="auth-hero__shade" />
          <p className="auth-hero__text">{t("login.staffWelcome")}</p>
        </div>
        <form className="auth-card stack" style={{ "--gap": "20px" } as React.CSSProperties} onSubmit={submit} noValidate>
          <div>
            <h1 className="display-l" style={{ fontSize: 40 }}>
              {t("nav.staff")} {t("nav.signIn")}
            </h1>
            <p className="body-l" style={{ color: "var(--brand-deep)", fontSize: 20 }}>
              {t("login.staffWelcome")}
            </p>
          </div>

          <TextField
            label={t("field.email")}
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="username"
            inputMode="email"
            placeholder="name@council.cm"
            error={fieldError}
            required
            autoFocus
          />

          <div className="stack" style={{ "--gap": "10px" } as React.CSSProperties}>
            <PasswordField label={t("field.password")} value={password} onChange={setPassword} />
            <Link href="/forgot-password?staff=1" className="link" style={{ alignSelf: "flex-end" }}>
              {t("login.forgot")}
            </Link>
          </div>

          {error ? (
            <div className="banner banner--danger" role="alert">
              <Warning aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {t("login.submit")}
          </button>
        </form>
      </main>
    </>
  );
}

// ===========================================================================
// Register
// ===========================================================================
export function RegisterScreen({ next }: { next?: string }) {
  const { t, lang, setLang } = useT();
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [language, setLanguage] = useState<Lang>(lang);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const session = useSession();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const found: Record<string, string> = {};
    const e164 = toE164(phone);
    if (!e164) found.phone = t("auth.error.INVALID_PHONE");
    if (!usernameOk(username)) found.username = t("auth.error.INVALID_USERNAME");
    if (!passwordOk(password)) found.password = t("auth.error.WEAK_PASSWORD");
    if (email.trim() && !/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(email.trim())) found.email = t("auth.error.INVALID_EMAIL");
    setErrors(found);
    if (Object.keys(found).length) return;

    setBusy(true);
    try {
      const result = await authCall("sign-up", {
        phone: e164,
        username: username.trim(),
        password,
        email: email.trim() || undefined,
        language,
        next,
      });
      go(result.next);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "PHONE_TAKEN") setErrors({ phone: t("auth.error.PHONE_TAKEN") });
      else if (err instanceof ApiRequestError && err.code === "EMAIL_TAKEN") setErrors({ email: t("auth.error.EMAIL_TAKEN") });
      else if (err instanceof ApiRequestError && err.code === "INVALID_USERNAME") setErrors({ username: t("auth.error.INVALID_USERNAME") });
      else setError(authErrorMessage(err, t));
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar back="/login" logo />
      <main id="main" className="auth-wrap">
        <div className="auth-hero auth-hero--short">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/register-road.jpg" alt="" style={{ objectPosition: "70% center" }} />
          <div className="auth-hero__shade auth-hero__shade--side" />
          <div className="auth-hero__text" style={{ bottom: 70 }}>
            <div className="auth-hero__title">{t("register.heroTitle")}</div>
            <div className="auth-hero__sub">{t("register.heroSub")}</div>
          </div>
        </div>
        <form className="auth-card stack" style={{ "--gap": "22px" } as React.CSSProperties} onSubmit={submit} noValidate>
          <h1 className="display-m" style={{ fontSize: 34 }}>
            {t("register.title")}
          </h1>
          {session.guestLabel ? (
            <div className="banner banner--info">
              <User aria-hidden="true" />
              <span>{t("register.guestMove", { label: session.guestLabel })}</span>
            </div>
          ) : null}
          <PhoneInput value={phone} onChange={setPhone} error={errors.phone} />
          <TextField
            label={t("field.username")}
            value={username}
            onChange={setUsername}
            placeholder="e.g. BueaCitizen"
            autoComplete="nickname"
            help={t("register.usernameHelp")}
            error={errors.username}
            maxLength={30}
            required
          />
          <div className="stack" style={{ "--gap": "10px" } as React.CSSProperties}>
            <PasswordField label={t("field.password")} value={password} onChange={setPassword} autoComplete="new-password" error={errors.password} />
            <PasswordRules password={password} />
          </div>
          <TextField
            label={t("field.emailOptional")}
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.cm"
            autoComplete="email"
            inputMode="email"
            help={t("register.emailHelp")}
            error={errors.email}
          />
          <div className="field">
            <span className="label" id="lang-label">
              {t("field.language")}
            </span>
            <LanguageToggle
              value={language}
              block
              label={t("field.language")}
              onChange={(l) => {
                setLanguage(l);
                setLang(l);
              }}
            />
          </div>
          {error ? (
            <div className="banner banner--danger" role="alert">
              <Warning aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}
          <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {t("register.submit")}
          </button>
          {/* Google authentication commented out:
          {session.google ? (
            <>
              <div className="or-divider">{t("common.or")}</div>
              <GoogleButton next={next} />
            </>
          ) : null}
          */}
          <p className="center" style={{ fontSize: 17 }}>
            {t("register.haveAccount")}{" "}
            <Link href="/login" className="link">
              {t("nav.signIn")}
            </Link>
          </p>
          <hr className="divider" />
          <p className="center help">{t("register.smsNote")}</p>
        </form>
      </main>
    </>
  );
}

// ===========================================================================
// Verify a code: SMS (sign-up, sign-in by code) or an authenticator app (staff)
// ===========================================================================
export function VerifyScreen({ purpose, destination }: { purpose: "signup" | "signin" | "mfa"; destination: string | null }) {
  const { t } = useT();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(60);
  const [sentTo, setSentTo] = useState(destination);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (code.length !== 6) {
      setError(purpose === "mfa" ? t("security.wrongCode") : t("auth.error.WRONG_CODE"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await authCall("verify", { code });
      go(result.next);
    } catch (err) {
      const to = redirectFor(err);
      if (to) return go(to);
      setError(authErrorMessage(err, t, purpose === "mfa"));
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      const result = await authCall("resend");
      if (result.destination) setSentTo(result.destination);
      setWait(60);
      setResent(true);
    } catch (err) {
      setError(authErrorMessage(err, t));
    }
  }

  // An authenticator code has no destination; an SMS code always has one.
  if (destination === null || (purpose !== "mfa" && !destination)) {
    return (
      <>
        <TopBar back="/login" logo />
        <main id="main" className="m-screen m-screen--narrow m-screen--center stack center">
          <span className="icon-disc hero-disc">
            <Warning aria-hidden="true" />
          </span>
          <h1 className="display-m">{t("verify.expiredTitle")}</h1>
          <p className="body-l">{t("verify.expiredBody")}</p>
          <Link href={purpose === "signup" ? "/register" : "/login"} className="btn btn--primary btn--block btn--lg">
            {t("verify.startAgain")}
          </Link>
        </main>
      </>
    );
  }

  const mm = Math.floor(wait / 60);
  const ss = String(wait % 60).padStart(2, "0");
  const app = purpose === "mfa";

  return (
    <>
      <TopBar back={purpose === "signup" ? "/register" : "/login"} logo />
      <main id="main" className="m-screen m-screen--narrow m-screen--center">
        <form className="stack center" style={{ "--gap": "24px" } as React.CSSProperties} onSubmit={submit} noValidate>
          <span className="icon-disc hero-disc">
            {app ? <ShieldCheck aria-hidden="true" /> : <Smartphone aria-hidden="true" />}
          </span>
          <div className="stack" style={{ "--gap": "8px" } as React.CSSProperties}>
            <h1 className="display-m" style={{ fontSize: 34 }}>
              {app ? t("verify.mfaTitle") : t("verify.title")}
            </h1>
            <p className="body-l muted">{app ? t("verify.mfaBody") : t("verify.sentTo", { destination: sentTo ?? "" })}</p>
          </div>
          <OtpInput value={code} onChange={setCode} invalid={Boolean(error)} label={t("verify.codeLabel")} />
          <FieldError>{error}</FieldError>
          <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {t("verify.submit")}
          </button>
          {app ? (
            <p className="help">{t("verify.mfaHelp")}</p>
          ) : (
            <>
              <p className="body-l muted" aria-live="polite">
                {resent && wait > 55 ? `${t("verify.resent")} ` : ""}
                {wait > 0 ? (
                  t("verify.resendIn", { time: `${mm}:${ss}` })
                ) : (
                  <>
                    {t("verify.didntGet")}{" "}
                    <button type="button" className="link" onClick={resend}>
                      {t("verify.resend")}
                    </button>
                  </>
                )}
              </p>
              <Link href={purpose === "signup" ? "/register" : "/login"} className="link" style={{ fontSize: 17 }}>
                {t("verify.changeNumber")}
              </Link>
            </>
          )}
        </form>
      </main>
    </>
  );
}

// ===========================================================================
// Forgot password → Reset password
// ===========================================================================
export function ForgotScreen({ staff: staffAtStart = false }: { staff?: boolean }) {
  const { t } = useT();
  const [staff, setStaff] = useState(staffAtStart);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const e164 = toE164(phone);
    const address = email.trim().toLowerCase();
    if (staff ? !/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(address) : !e164) {
      setError(staff ? t("auth.error.INVALID_EMAIL") : t("auth.error.INVALID_PHONE"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await authCall("forgot", staff ? { email: address } : { phone: e164 });
      setSent(result.destination ?? (staff ? address : e164));
    } catch (err) {
      setError(authErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar back="/login" logo />
      <main id="main" className="m-screen m-screen--narrow m-screen--center">
        <form className="stack" style={{ "--gap": "24px" } as React.CSSProperties} onSubmit={submit} noValidate>
          <div className="stack center" style={{ "--gap": "12px" } as React.CSSProperties}>
            <span className="icon-disc hero-disc">
              <Lock aria-hidden="true" />
            </span>
            <h1 className="display-m" style={{ fontSize: 34 }}>
              {t("forgot.title")}
            </h1>
            <p className="body-l">{staff ? t("forgot.bodyStaff") : t("forgot.body")}</p>
          </div>
          {staff ? (
            <TextField
              label={t("field.email")}
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="username"
              inputMode="email"
              placeholder="name@buea-council.cm"
              error={error}
              required
            />
          ) : (
            <PhoneInput value={phone} onChange={setPhone} error={error} autoFocus />
          )}
          {sent ? (
            <Link href="/reset-password" className="btn btn--primary btn--block btn--lg">
              {t("forgot.enterCode")}
            </Link>
          ) : (
            <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
              {busy ? <span className="spinner" aria-hidden="true" /> : null}
              {t("forgot.submit")}
            </button>
          )}
          <Link href="/login" className="link center" style={{ fontSize: 17 }}>
            {t("forgot.back")}
          </Link>
          {!sent ? (
            <p className="center help">
              <button
                type="button"
                className="link"
                onClick={() => {
                  setStaff((s) => !s);
                  setError(null);
                }}
              >
                {staff ? t("login.citizenSwitch") : t("login.staffSwitch")}
              </button>
            </p>
          ) : null}
          {sent ? (
            <div className="banner banner--success" role="status" style={{ padding: 20 }}>
              <span className="icon-disc icon-disc--deep" style={{ "--size": "56px" } as React.CSSProperties}>
                <CheckCircle aria-hidden="true" />
              </span>
              <div>
                <strong style={{ fontSize: 17 }}>{t("forgot.sent", { destination: sent })}</strong>
                <div className="muted">{t("forgot.expires")}</div>
              </div>
            </div>
          ) : null}
        </form>
      </main>
    </>
  );
}

export function ResetScreen({ destination }: { destination: string | null }) {
  const { t } = useT();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return setError(t("auth.error.WRONG_CODE"));
    if (!passwordOk(password, confirm)) return setError(t("auth.error.WEAK_PASSWORD"));
    setBusy(true);
    setError(null);
    try {
      const result = await authCall("reset", { code, password });
      go(result.next);
    } catch (err) {
      setError(authErrorMessage(err, t));
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar back="/forgot-password" logo />
      <main id="main" className="m-screen m-screen--narrow m-screen--center" style={{ paddingTop: 32 }}>
        <form className="stack" style={{ "--gap": "22px" } as React.CSSProperties} onSubmit={submit} noValidate>
          <div className="stack center" style={{ "--gap": "12px" } as React.CSSProperties}>
            <span className="icon-disc hero-disc">
              <Lock aria-hidden="true" />
            </span>
            <h1 className="display-m" style={{ fontSize: 34 }}>
              {t("reset.title")}
            </h1>
            <p className="body-l">{destination ? t("reset.bodyTo", { destination }) : t("reset.body")}</p>
          </div>
          <div className="field">
            <span className="label">{t("reset.code")}</span>
            <OtpInput value={code} onChange={setCode} autoFocus={false} label={t("reset.code")} />
          </div>
          <div className="stack" style={{ "--gap": "10px" } as React.CSSProperties}>
            <PasswordField label={t("field.newPassword")} value={password} onChange={setPassword} autoComplete="new-password" />
            <PasswordRules password={password} omitMatch />
          </div>
          <div className="stack" style={{ "--gap": "10px" } as React.CSSProperties}>
            <PasswordField label={t("field.confirmPassword")} value={confirm} onChange={setConfirm} autoComplete="new-password" />
            <PasswordMatchRule password={password} confirm={confirm} />
          </div>
          <FieldError>{error}</FieldError>
          <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {t("reset.submit")}
          </button>
          {!destination ? (
            <Link href="/forgot-password" className="link center">
              {t("reset.requestCode")}
            </Link>
          ) : null}
        </form>
      </main>
    </>
  );
}

// ===========================================================================
// Staff first sign-in: replace the temporary password
// ===========================================================================
export function FirstSignInScreen({ email }: { email: string | null }) {
  const { t } = useT();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!passwordOk(password, confirm)) return setError(t("auth.error.WEAK_PASSWORD"));
    setBusy(true);
    setError(null);
    try {
      const result = await authCall("new-password", { password });
      go(result.next);
    } catch (err) {
      setError(authErrorMessage(err, t));
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar logo end={<span className="staff-pill staff-pill--mint">{t("nav.staff")}</span>} />
      <main id="main" className="m-screen m-screen--narrow" style={{ paddingTop: 32 }}>
        {email === null ? (
          <div className="stack center" style={{ "--gap": "16px" } as React.CSSProperties}>
            <h1 className="display-m">{t("verify.expiredTitle")}</h1>
            <p className="body-l">{t("first.expired")}</p>
            <Link href="/staff/login" className="btn btn--primary btn--block btn--lg">
              {t("nav.signIn")}
            </Link>
          </div>
        ) : (
          <form className="stack" style={{ "--gap": "22px" } as React.CSSProperties} onSubmit={submit} noValidate>
            <div className="stack center" style={{ "--gap": "12px" } as React.CSSProperties}>
              <span className="icon-disc hero-disc">
                <Lock aria-hidden="true" />
              </span>
              <h1 className="display-m" style={{ fontSize: 34 }}>
                {t("first.title")}
              </h1>
              <p className="body-l">{t("first.body")}</p>
            </div>
            {email ? (
              <div className="banner banner--success" style={{ padding: 20, alignItems: "center" }}>
                <Mail aria-hidden="true" style={{ width: 32, height: 32 }} />
                <div>
                  <div>{t("first.signedInAs")}</div>
                  <strong style={{ fontSize: 18 }}>{email}</strong>
                </div>
              </div>
            ) : null}
            <div className="stack" style={{ "--gap": "10px" } as React.CSSProperties}>
              <PasswordField label={t("field.newPassword")} value={password} onChange={setPassword} autoComplete="new-password" autoFocus />
              <PasswordRules password={password} omitMatch />
            </div>
            <div className="stack" style={{ "--gap": "10px" } as React.CSSProperties}>
              <PasswordField label={t("field.confirmPassword")} value={confirm} onChange={setConfirm} autoComplete="new-password" />
              <PasswordMatchRule password={password} confirm={confirm} />
            </div>
            <FieldError>{error}</FieldError>
            <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
              {busy ? <span className="spinner" aria-hidden="true" /> : null}
              {t("first.submit")}
            </button>
          </form>
        )}
      </main>
    </>
  );
}
