/**
 * Maintenance-mode flag.
 *
 * Flip this in the environment (Railway) or `.env.local` (local dev) to show the
 * maintenance screen for every route:
 *   MAINTENANCE_MODE=true   → maintenance screen is shown
 *   MAINTENANCE_MODE=false  → normal app (or remove the var)
 *
 * Because the root layout is a Server Component and the pages are rendered
 * dynamically, this value is read at runtime for every request, so toggling it
 * takes effect on the next request/deploy without editing code.
 */
export function isMaintenanceMode(): boolean {
  return process.env.MAINTENANCE_MODE === "true";
}
