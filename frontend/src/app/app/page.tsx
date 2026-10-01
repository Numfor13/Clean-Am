import { redirect } from "next/navigation";
import { homeFor } from "@/lib/jwt";
import { getSession } from "@/server/session";

// Where the installed app opens (the manifest's start_url): straight to the
// person's own home, or the public start page if they are not signed in.
export const dynamic = "force-dynamic";

export default async function AppStart() {
  const session = await getSession();
  redirect(session.role ? homeFor(session.role) : session.guestLabel ? "/guest" : "/");
}
