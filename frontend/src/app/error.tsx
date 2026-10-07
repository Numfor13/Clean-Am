"use client";

import { useT } from "@/lib/i18n";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useT();
  return (
    <main id="main" className="m-screen m-screen--narrow m-screen--center stack center" style={{ minHeight: "100vh" }}>
      <h1 className="display-m">{t("errorPage.title")}</h1>
      <p className="body-l">{t("errorPage.body")}</p>
      <button type="button" className="btn btn--primary btn--lg" onClick={reset}>
        {t("common.tryAgain")}
      </button>
    </main>
  );
}
