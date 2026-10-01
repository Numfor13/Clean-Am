"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { translate, type MessageKey, type Vars } from "./messages";
import type { Lang } from "./types";

export const LANG_COOKIE = "cam_lang";

interface I18nValue {
  lang: Lang;
  t: (key: MessageKey, vars?: Vars) => string;
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ lang: initial, children }: { lang: Lang; children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    // A year; read by the server on the next request so SSR matches.
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
  }, []);

  const value = useMemo<I18nValue>(
    () => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useT must be used inside <I18nProvider>");
  return value;
}
