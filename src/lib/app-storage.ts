"use client";

export const APP_STORAGE_PREFIX = "goldenity:web-ordering:";
export const WEB_ORDER_CART_STORAGE_KEY = "web_order_cart";
export const CART_STORAGE_PREFIX = `${APP_STORAGE_PREFIX}cart:`;

export type CartStorageKeyParams = {
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

export const safeGetStorage = (key: string): string | null => {
  try {
    if (typeof window !== "undefined") {
      return localStorage.getItem(key);
    }
  } catch (e) {
    console.warn("Safari blocked localStorage read:", e);
  }

  return null;
};

export const safeSetStorage = (key: string, value: string): void => {
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(key, value);
    }
  } catch (e) {
    console.warn("Safari blocked localStorage write:", e);
  }
};

export const safeRemoveStorage = (key: string): void => {
  try {
    if (typeof window !== "undefined") {
      localStorage.removeItem(key);
    }
  } catch (e) {
    console.warn("Safari blocked localStorage remove:", e);
  }
};

export const safeClearStorage = (): void => {
  try {
    if (typeof window !== "undefined") {
      localStorage.clear();
    }
  } catch (e) {
    console.warn("Safari blocked localStorage clear:", e);
  }
};

export const safeClearSessionStorage = (): void => {
  try {
    if (typeof window !== "undefined") {
      sessionStorage.clear();
    }
  } catch (e) {
    console.warn("Safari blocked sessionStorage clear:", e);
  }
};

function safeListStorageKeys() {
  try {
    if (typeof window === "undefined") {
      return [];
    }

    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) {
        keys.push(key);
      }
    }

    return keys;
  } catch (e) {
    console.warn("Safari blocked localStorage key iteration:", e);
    return [];
  }
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
  try {
    const rawValue = safeGetStorage(key);
    if (!rawValue) {
      return fallback;
    }

    return JSON.parse(rawValue) as T;
  } catch (_error) {
    safeRemoveStorage(key);
    return fallback;
  }
}

export function writeLocalStorageJson(key: string, value: unknown) {
  try {
    safeSetStorage(key, JSON.stringify(value));
  } catch (_error) {
    safeRemoveStorage(key);
  }
}

export function removeLocalStorageKey(key: string) {
  safeRemoveStorage(key);
}

export function clearAppStorage() {
  safeRemoveStorage(WEB_ORDER_CART_STORAGE_KEY);

  for (const key of safeListStorageKeys()) {
    if (key.startsWith(APP_STORAGE_PREFIX)) {
      safeRemoveStorage(key);
    }
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
