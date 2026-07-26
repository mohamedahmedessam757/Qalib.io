import { redirect } from "next/navigation";

/** Bare `/` → default locale (middleware also handles this). */
export default function RootPage() {
  redirect("/ar");
}
