import { redirect } from "next/navigation";

/**
 * /settings has no content of its own in the route-based overhaul — it
 * redirects to the first section. Server-component redirect() fires before
 * the settings layout paints anything meaningful, so there's no flash of the
 * empty shell. Deep links to /settings/account, /settings/privacy, etc. are
 * unaffected.
 */
export default function SettingsIndexPage() {
  redirect("/settings/account");
}
