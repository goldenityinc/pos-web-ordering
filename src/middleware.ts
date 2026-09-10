import { NextResponse, type NextRequest } from "next/server";
import migrated from "./data/migrated-tenants.json";

/**
 * V1 -> V2 QR redirect.
 *
 * Printed table stickers point at this app with:
 *   /?tenant=<uuid>&table=<code>&tableId=<v1PK>&branchId=<n>&branchName=...&store=...
 *
 * If the tenant has been migrated to POS V2 (present in migrated-tenants.json),
 * bounce to the V2 web-order URL:
 *   <V2_BASE>/<slug>/<branchId>/t/<qrToken>
 *
 * Otherwise fall through — this V1 app serves the order as before. So the cutover
 * is per-tenant and no sticker is ever reprinted.
 *
 * This never throws: any lookup problem falls through to the V1 app.
 */

type TableEntry = { branchId: string; qrToken: string };
type TenantEntry = {
  slug: string;
  v2Base?: string;
  byTableId?: Record<string, TableEntry>;
  byKey?: Record<string, TableEntry>; // "<branchId>:<code>"
};

const TENANTS = (migrated as { tenants?: Record<string, TenantEntry> }).tenants ?? {};
const V2_BASE_FALLBACK =
  (migrated as { _v2BaseFallback?: string })._v2BaseFallback ?? "";

function v2Base(entry: TenantEntry): string {
  return (
    process.env.V2_WEB_ORDER_BASE?.trim() ||
    entry.v2Base?.trim() ||
    V2_BASE_FALLBACK
  ).replace(/\/+$/, "");
}

export function middleware(req: NextRequest): NextResponse {
  try {
    const q = req.nextUrl.searchParams;
    const tenant = (q.get("tenant") || q.get("tenantId") || "").trim();
    if (!tenant) return NextResponse.next();

    const entry = TENANTS[tenant];
    if (!entry) return NextResponse.next(); // not migrated -> V1 serves

    const base = v2Base(entry);
    if (!base) return NextResponse.next(); // misconfigured -> don't break V1

    const branchId = (q.get("branchId") || q.get("branch_id") || "").trim();
    const tableId = (q.get("tableId") || q.get("table_id") || "").trim();
    const table = (q.get("table") || "").trim();

    let hit: TableEntry | undefined;
    if (tableId && entry.byTableId) hit = entry.byTableId[tableId];
    if (!hit && branchId && table && entry.byKey) hit = entry.byKey[`${branchId}:${table}`];

    // Migrated tenant but this exact table isn't mapped yet -> still send them to
    // V2 (branch menu root) rather than a stale V1 page.
    const target = hit
      ? `${base}/${entry.slug}/${hit.branchId}/t/${hit.qrToken}`
      : `${base}/${entry.slug}${branchId ? `/${branchId}` : ""}?from=v1qr`;

    return NextResponse.redirect(target, 307);
  } catch {
    return NextResponse.next();
  }
}

// Only the root path carries QR params.
export const config = { matcher: ["/"] };
