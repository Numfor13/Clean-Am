"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { formatLocalPhoneInput } from "@/lib/format";
import type { Lang } from "@/lib/types";
import { Check, ChevronDown, Eye, EyeOff } from "./icons";
import { FieldError, FlagCm } from "./ui";

/** Cameroon-only phone entry: the +237 prefix is fixed, the person types 9 digits. */
export function PhoneInput({
  value,
  onChange,
  error,
  autoFocus,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  autoFocus?: boolean;
  label?: string;
}) {
  const { t } = useT();
  const id = useId();
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label ?? t("field.phone")}
      </label>
      <div className="phone-group" data-invalid={error ? "true" : undefined}>
        <span className="phone-prefix" aria-label="Cameroon +237">
          <FlagCm />
          <span>+237</span>
          <ChevronDown aria-hidden="true" size={18} />
        </span>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="6XX XX XX XX"
          value={value}
          onChange={(e) => onChange(formatLocalPhoneInput(e.target.value))}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          autoFocus={autoFocus}
          required
        />
      </div>
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  error,
  help,
  type = "text",
  placeholder,
  autoComplete,
  inputMode,
  required,
  maxLength,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  help?: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  required?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
}) {
  const id = useId();
  const describedBy = [help ? `${id}-help` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        required={required}
        maxLength={maxLength}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {help ? (
        <p className="help" id={`${id}-help`}>
          {help}
        </p>
      ) : null}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );
}

/**
 * Mirrors the user pool's password policy (backend/stacks/auth_stack.py):
 * 8+ characters with a lower-case letter, a capital, a number and a symbol.
 */
export const PASSWORD_MIN = 8;

export function passwordChecks(password: string, confirm?: string) {
  return {
    length: password.length >= PASSWORD_MIN,
    number: /\d/.test(password),
    capital: /[A-Z]/.test(password),
    symbol: /[^A-Za-z0-9\s]/.test(password),
    // Almost every real password has a lower-case letter, so this rule is
    // checked but only shown when it is the one missing.
    lower: /[a-z]/.test(password),
    match: confirm === undefined ? true : password.length > 0 && password === confirm,
  };
}

export function passwordOk(password: string, confirm?: string): boolean {
  const c = passwordChecks(password, confirm);
  return c.length && c.number && c.capital && c.symbol && c.lower && c.match;
}

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete = "current-password",
  error,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  error?: string | null;
  autoFocus?: boolean;
}) {
  const { t } = useT();
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="input-wrap">
        <input
          id={id}
          className="input"
          type={visible ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          required
        />
        <button
          type="button"
          className="icon-btn"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t("field.hidePassword") : t("field.showPassword")}
          aria-pressed={visible}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </div>
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );
}

/** The rules, visible before the person types, ticking off as they do. */
export function PasswordRules({ password, confirm }: { password: string; confirm?: string }) {
  const { t } = useT();
  const c = passwordChecks(password, confirm);
  const rules: [boolean, string][] = [
    [c.length, t("password.rule.length")],
    [c.number, t("password.rule.number")],
    [c.capital, t("password.rule.capital")],
    [c.symbol, t("password.rule.symbol")],
  ];
  if (password.length > 0 && !c.lower) rules.push([false, t("password.rule.lower")]);
  if (confirm !== undefined) rules.push([c.match, t("password.rule.match")]);
  return (
    <ul className="rules" aria-label={t("password.rules")}>
      {rules.map(([met, text]) => (
        <li key={text} data-met={met ? "true" : "false"}>
          <span className="rule-mark" aria-hidden="true">
            {met ? <Check strokeWidth={3} /> : null}
          </span>
          <span>
            {text}
            <span className="sr-only">{met ? ` (${t("password.met")})` : ` (${t("password.notMet")})`}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Six boxes that behave like one field: paste, autofill and backspace all work. */
export function OtpInput({
  value,
  onChange,
  invalid,
  autoFocus = true,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  autoFocus?: boolean;
  label: string;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, " ").slice(0, 6).split("");

  useEffect(() => {
    if (autoFocus) refs.current[Math.min(value.length, 5)]?.focus();
    // Focus once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setAt(index: number, text: string) {
    const clean = text.replace(/\D/g, "");
    if (clean.length > 1) {
      // Paste or SMS autofill of the whole code.
      const merged = (value.slice(0, index) + clean).slice(0, 6);
      onChange(merged);
      refs.current[Math.min(merged.length, 5)]?.focus();
      return;
    }
    const chars = value.padEnd(6, " ").split("");
    chars[index] = clean || " ";
    const next = chars.join("").replace(/\s+$/, "");
    onChange(next.replace(/ /g, ""));
    if (clean && index < 5) refs.current[index + 1]?.focus();
  }

  return (
    <div className="otp" role="group" aria-label={label} data-invalid={invalid ? "true" : undefined}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d.trim()}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={i === 0 ? 6 : 1}
          aria-label={`${label} ${i + 1}`}
          onChange={(e) => setAt(i, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !d.trim() && i > 0) {
              refs.current[i - 1]?.focus();
              onChange(value.slice(0, i - 1));
              e.preventDefault();
            }
            if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
          }}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}

export function LanguageToggle({
  value,
  onChange,
  block,
  label,
}: {
  value: Lang;
  onChange: (lang: Lang) => void;
  block?: boolean;
  label: string;
}) {
  return (
    <div className={`segmented${block ? " segmented--block" : ""}`} role="group" aria-label={label}>
      <button type="button" aria-pressed={value === "en"} onClick={() => onChange("en")} lang="en">
        English
      </button>
      <button type="button" aria-pressed={value === "fr"} onClick={() => onChange("fr")} lang="fr">
        Français
      </button>
    </div>
  );
}

/** "EN / FR" on the dark bar. */
export function LangSwitch() {
  const { lang, setLang } = useT();
  return (
    <span className="lang-switch" role="group" aria-label="Language / Langue">
      <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")} lang="en">
        EN
      </button>
      <span aria-hidden="true">/</span>
      <button type="button" aria-pressed={lang === "fr"} onClick={() => setLang("fr")} lang="fr">
        FR
      </button>
    </span>
  );
}
