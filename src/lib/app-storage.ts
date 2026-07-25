"use client";

export const APP_STORAGE_PREFIX = "goldenity:web-ordering:";
export const WEB_ORDER_CART_STORAGE_KEY = "web_order_cart";
export const CART_STORAGE_PREFIX = `${APP_STORAGE_PREFIX}cart:`;

type CartStorageKeyParams = {
  tenantId: string;
  branchId?: string;
  tableId?: string;
  tableNumber?: string;
};

function normalizeStorageSegment(value: string | undefined, fallback: string) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  return normalized.replace(/[^a-z0-9_-]+/g, "-");
}

export function buildCartStorageKey({
  tenantId,
  branchId,
  tableId,
  tableNumber,
}: CartStorageKeyParams) {
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    return null;
  }

  return [
    CART_STORAGE_PREFIX,
    normalizeStorageSegment(normalizedTenantId, "unknown-tenant"),
    ":",
    normalizeStorageSegment(branchId, "all-branches"),
    ":",
    normalizeStorageSegment(tableId, normalizeStorageSegment(tableNumber, "unknown-table")),
  ].join("");
}

export function safeParseLocalStorageJson<T>(key: string, fallback: T) {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const rawValue = window.localStorage.getItem(key);
    if (!rawValue) {
      return fallback;
    }

    return JSON.parse(rawValue) as T;
  } catch (_error) {
    window.localStorage.removeItem(key);
    return fallback;
  }
}

export function writeLocalStorageJson(key: string, value: unknown) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (_error) {
    window.localStorage.removeItem(key);
  }
}

export function removeLocalStorageKey(key: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(key);
}

export function clearAppStorage() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(WEB_ORDER_CART_STORAGE_KEY);

  const keysToDelete: string[] = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(APP_STORAGE_PREFIX)) {
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    window.localStorage.removeItem(key);
  }
}

export function shouldAutoRecoverFromError(error: Error | null | undefined) {
  if (!error) {
    return false;
  }

  const message = error.message.toLowerCase();

  return [
    "localstorage",
    "sessionstorage",
    "json",
    "unexpected token",
    "parse",
    "hydrate",
    "hydration",
    "did not match",
  ].some((keyword) => message.includes(keyword));
}
