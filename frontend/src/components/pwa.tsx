"use client";

// The installable web app: service worker registration, the install offer
// ("Add to Home screen") and the offline page. People choose whether to
// install; the site works the same in the browser.

import { useEffect, useState, useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n";
import { Close, Download, Retry, Share, WifiOff } from "./icons";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type InstallOffer = "prompt" | "ios" | null;

// Chrome, Edge and Samsung Internet fire `beforeinstallprompt` once per page
// load, so it is caught here (mounted in the root layout) and kept for later.
let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function standalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function offer(): InstallOffer {
  if (installed || standalone()) return null;
  if (deferred) return "prompt";
  return isIos() ? "ios" : null; // iPhone has no prompt: people add it from the Share menu
}

export function PwaSetup() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }
    const onPrompt = (event: Event) => {
      event.preventDefault(); // we show our own offer instead of the browser's bar
      deferred = event as InstallPromptEvent;
      emit();
    };
    const onInstalled = () => {
      deferred = null;
      installed = true;
      emit();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}

/** What install offer this browser can show, and a way to act on it. */
export function useInstall() {
  const state = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    offer,
    () => null,
  );
  async function install(): Promise<boolean> {
    if (!deferred) return false;
    const event = deferred;
    deferred = null;
    await event.prompt();
    const { outcome } = await event.userChoice;
    emit();
    return outcome === "accepted";
  }
  return { offer: state, install };
}

const DISMISSED = "cam_install_dismissed";

/** A card inviting people to install; hidden once installed or dismissed. */
export function InstallCard() {
  const { t } = useT();
  const { offer: kind, install } = useInstall();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISSED) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  if (!kind || dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      // Private browsing: it will show again next visit, which is fine.
    }
  }

  return (
    <aside className="install-card" aria-labelledby="install-title">
      <img src="/icons/icon-192.png" alt="" width={56} height={56} className="install-card__icon" />
      <div className="install-card__body">
        <h2 id="install-title" className="heading-s">
          {t("install.title")}
        </h2>
        {kind === "ios" ? (
          <p>
            {t("install.iosBefore")} <Share aria-label={t("install.share")} className="install-card__inline" /> {t("install.iosAfter")}
          </p>
        ) : (
          <p>{t("install.body")}</p>
        )}
        {kind === "prompt" ? (
          <button type="button" className="btn btn--dark" onClick={install}>
            <Download aria-hidden="true" />
            {t("install.cta")}
          </button>
        ) : null}
      </div>
      <button type="button" className="icon-btn install-card__close" aria-label={t("install.notNow")} onClick={dismiss}>
        <Close aria-hidden="true" />
      </button>
    </aside>
  );
}

export function OfflineScreen() {
  const { t } = useT();
  return (
    <main id="main" className="m-screen m-screen--center stack center" style={{ "--gap": "20px" } as React.CSSProperties}>
      <span className="icon-disc hero-disc">
        <WifiOff aria-hidden="true" />
      </span>
      <h1 className="display-m">{t("offline.title")}</h1>
      <p className="body-l">{t("offline.body")}</p>
      <button type="button" className="btn btn--primary btn--block btn--lg" onClick={() => window.location.reload()}>
        <Retry aria-hidden="true" />
        {t("common.tryAgain")}
      </button>
    </main>
  );
}
