"use client";

import { createContext, useContext } from "react";
import { I18nProvider } from "@/lib/i18n";
import type { Lang, Session } from "@/lib/types";
import { ToastProvider } from "./shell";

const SessionContext = createContext<Session>({ role: null, username: null, guestLabel: null, google: false });

export function useSession(): Session {
  return useContext(SessionContext);
}

export function Providers({ lang, session, children }: { lang: Lang; session: Session; children: React.ReactNode }) {
  return (
    <I18nProvider lang={lang}>
      <SessionContext.Provider value={session}>
        <ToastProvider>
          {children}
        </ToastProvider>
      </SessionContext.Provider>
    </I18nProvider>
  );
}
