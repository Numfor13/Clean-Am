import Link from "next/link";
import { getLang } from "@/server/session";
import { translate } from "@/lib/messages";

export default async function NotFound() {
  const lang = await getLang();
  return (
    <main id="main" className="m-screen m-screen--narrow m-screen--center stack center" style={{ minHeight: "100vh" }}>
      <p className="mono muted">404</p>
      <h1 className="display-m">{translate(lang, "notFound.title")}</h1>
      <p className="body-l">{translate(lang, "notFound.body")}</p>
      <Link href="/" className="btn btn--primary btn--lg">
        {translate(lang, "common.backHome")}
      </Link>
    </main>
  );
}
