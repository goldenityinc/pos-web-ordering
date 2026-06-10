const BRIDGE_API_URL = process.env.NEXT_PUBLIC_BRIDGE_API_URL;

export interface MenuCategory {
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  sortOrder?: number;
}

export interface MenuProduct {
  id: string;
  categoryId?: string | null;
  categoryName?: string | null;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  sku?: string | null;
  price: number;
  isAvailable: boolean;
  sortOrder?: number;
}

export interface TenantInfo {
  id?: string;
  name?: string;
  slug?: string;
}

export interface MenuResponse {
  tenant?: TenantInfo;
  categories: MenuCategory[];
  products: MenuProduct[];
}

export interface OrderItemInput {
  productId: string;
  quantity: number;
  price: number;
  name?: string;
  subtotal?: number;
}

export interface SubmitOrderInput {
  tenantId: string;
  table: string;
  cartItems: OrderItemInput[];
  totalAmount: number;
  notes?: string;
}

export interface SubmitOrderResponse {
  orderId?: string;
  message?: string;
  [key: string]: unknown;
}

interface RawApiResponse {
  data?: unknown;
  tenant?: TenantInfo;
  categories?: unknown[];
  products?: unknown[];
  items?: unknown[];
  menu?: {
    categories?: unknown[];
    products?: unknown[];
    items?: unknown[];
  };
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function toStringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function toNullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return toStringOrUndefined(value);
}

function normalizeCategory(raw: unknown): MenuCategory | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const data = raw as Record<string, unknown>;

  const id =
    toStringOrUndefined(data.id) ??
    toStringOrUndefined(data.categoryId) ??
    toStringOrUndefined(data.uuid);

  const name = toStringOrUndefined(data.name) ?? toStringOrUndefined(data.categoryName);

  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    description: toNullableString(data.description),
    imageUrl: toNullableString(data.imageUrl) ?? toNullableString(data.image),
    sortOrder: toNumber(data.sortOrder, 0),
  };
}

function normalizeProduct(raw: unknown): MenuProduct | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const data = raw as Record<string, unknown>;

  const id =
    toStringOrUndefined(data.id) ??
    toStringOrUndefined(data.productId) ??
    toStringOrUndefined(data.uuid);

  const name = toStringOrUndefined(data.name) ?? toStringOrUndefined(data.productName);

  if (!id || !name) {
    return null;
  }

  const availabilitySource =
    data.isAvailable ?? data.available ?? data.is_active ?? data.isActive;

  return {
    id,
    name,
    categoryId:
      toNullableString(data.categoryId) ?? toNullableString(data.menuCategoryId) ?? null,
    categoryName: toNullableString(data.categoryName) ?? null,
    description: toNullableString(data.description),
    imageUrl: toNullableString(data.imageUrl) ?? toNullableString(data.image),
    sku: toNullableString(data.sku),
    price: toNumber(data.price, 0),
    isAvailable: typeof availabilitySource === "boolean" ? availabilitySource : true,
    sortOrder: toNumber(data.sortOrder, 0),
  };
}

export async function getMenu(tenantId: string): Promise<MenuResponse> {
  if (!tenantId) {
    throw new Error("tenantId is required to fetch menu.");
  }

  if (!BRIDGE_API_URL) {
    throw new Error("NEXT_PUBLIC_BRIDGE_API_URL is missing. Check .env.local configuration.");
  }

  const url = `${BRIDGE_API_URL}/api/v1/qr-menu/${encodeURIComponent(tenantId)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch menu (${response.status}).`);
  }

  const json = (await response.json()) as RawApiResponse;
  const payload = (json.data ?? json) as RawApiResponse;

  const categoriesRaw =
    payload.categories ?? payload.menu?.categories ?? [];
  const productsRaw =
    payload.products ?? payload.items ?? payload.menu?.products ?? payload.menu?.items ?? [];

  const categories = categoriesRaw
    .map(normalizeCategory)
    .filter((item): item is MenuCategory => Boolean(item))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const products = productsRaw
    .map(normalizeProduct)
    .filter((item): item is MenuProduct => Boolean(item))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return {
    tenant: payload.tenant,
    categories,
    products,
  };
}

export async function submitOrder({
  tenantId,
  table,
  cartItems,
  totalAmount,
  notes,
}: SubmitOrderInput): Promise<SubmitOrderResponse> {
  if (!tenantId) {
    throw new Error("tenantId is required to submit order.");
  }

  if (!table) {
    throw new Error("table is required to submit order.");
  }

  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    throw new Error("cartItems cannot be empty.");
  }

  if (!BRIDGE_API_URL) {
    throw new Error("NEXT_PUBLIC_BRIDGE_API_URL is missing. Check .env.local configuration.");
  }

  const url = `${BRIDGE_API_URL}/api/v1/qr-orders`;

  const payload = {
    tenantId,
    table,
    items: cartItems.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      price: item.price,
      name: item.name,
      subtotal: item.subtotal ?? item.price * item.quantity,
    })),
    totalAmount,
    notes: notes?.trim() || undefined,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = (await response.json().catch(() => ({}))) as SubmitOrderResponse;

  if (!response.ok) {
    const message = typeof json.message === "string" ? json.message : `Failed to submit order (${response.status}).`;
    throw new Error(message);
  }

  return json;
}
