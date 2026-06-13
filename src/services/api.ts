const DEFAULT_BRIDGE_API_URL =
  "https://goldenity-pos-api-bridge-production.up.railway.app";

const BRIDGE_API_URL = (
  process.env.NEXT_PUBLIC_BRIDGE_API_URL?.trim() || DEFAULT_BRIDGE_API_URL
).replace(/\/$/, "");

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
  is_available: boolean;
  isAvailable: boolean;
  stock?: number;
  sortOrder?: number;
}

export interface TenantInfo {
  id?: string;
  name?: string;
  slug?: string;
}

export interface BranchInfo {
  id?: string;
  name?: string;
  code?: string;
}

export interface MenuResponse {
  tenant?: TenantInfo;
  branch?: BranchInfo;
  categories: MenuCategory[];
  products: MenuProduct[];
}

export interface GetMenuOptions {
  branchId?: string;
  branchName?: string;
}

export interface OrderItemInput {
  productId: string;
  quantity: number;
  price: number;
  name?: string;
  subtotal?: number;
  note?: string;
}

export interface SubmitOrderInput {
  tenantId: string;
  table: string;
  tableId?: string;
  branchId?: string;
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
  tenantId?: unknown;
  tenantName?: unknown;
  tenantSlug?: unknown;
  storeName?: unknown;
  name?: unknown;
  branch?: BranchInfo;
  categories?: unknown[];
  products?: unknown[];
  items?: unknown[];
  menu?: {
    categories?: unknown[];
    products?: unknown[];
    items?: unknown[];
  };
}

function normalizeTenant(payload: RawApiResponse): TenantInfo | undefined {
  const fromTenant = payload.tenant;
  const id =
    toStringOrUndefined(fromTenant?.id) ?? toStringOrUndefined(payload.tenantId);
  const name =
    toStringOrUndefined(fromTenant?.name) ??
    toStringOrUndefined(payload.tenantName) ??
    toStringOrUndefined(payload.storeName) ??
    toStringOrUndefined(payload.name);
  const slug =
    toStringOrUndefined(fromTenant?.slug) ?? toStringOrUndefined(payload.tenantSlug);

  if (!id && !name && !slug) {
    return undefined;
  }

  return {
    id,
    name,
    slug,
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

  const manualAvailabilitySource =
    data.is_available ?? data.isAvailable ?? data.available;
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
    is_available:
      typeof manualAvailabilitySource === "boolean" ? manualAvailabilitySource : true,
    isAvailable: typeof availabilitySource === "boolean" ? availabilitySource : true,
    stock: toNumber(data.stock, 0),
    sortOrder: toNumber(data.sortOrder, 0),
  };
}

export async function getMenu(
  tenantId: string,
  options: GetMenuOptions = {},
): Promise<MenuResponse> {
  if (!tenantId) {
    throw new Error("tenantId is required to fetch menu.");
  }

  const url = new URL(`/api/v1/qr-menu/${encodeURIComponent(tenantId)}`, BRIDGE_API_URL);
  const normalizedBranchId = options.branchId?.trim();
  const normalizedBranchName = options.branchName?.trim();
  if (normalizedBranchId) {
    url.searchParams.set("branchId", normalizedBranchId);
  }
  if (normalizedBranchName) {
    url.searchParams.set("branchName", normalizedBranchName);
  }

  const response = await fetch(url.toString(), {
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

  if (Array.isArray(payload)) {
    const products = payload
      .map(normalizeProduct)
      .filter((item): item is MenuProduct => Boolean(item))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    const categoriesMap = new Map<string, MenuCategory>();
    for (const product of products) {
      const id = product.categoryId || "menu";
      const name = product.categoryName || "Menu";
      if (!categoriesMap.has(id)) {
        categoriesMap.set(id, {
          id,
          name,
          sortOrder: categoriesMap.size,
        });
      }
    }

    return {
      categories: Array.from(categoriesMap.values()),
      products,
      branch: undefined,
    };
  }

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
    tenant: normalizeTenant(payload),
    branch:
      payload.branch && typeof payload.branch === "object"
        ? {
            id: toStringOrUndefined(payload.branch.id),
            name: toStringOrUndefined(payload.branch.name),
            code: toStringOrUndefined(payload.branch.code),
          }
        : undefined,
    categories,
    products,
  };
}

export async function submitOrder({
  tenantId,
  table,
  tableId,
  branchId,
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

  const url = `${BRIDGE_API_URL}/api/v1/qr-orders`;

  const payload = {
    tenantId,
    table,
    tableId,
    table_id: tableId,
    branchId: branchId?.trim() || undefined,
    branch_id: branchId?.trim() || undefined,
    items: cartItems.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      price: item.price,
      name: item.name,
      subtotal: item.subtotal ?? item.price * item.quantity,
      note: item.note?.trim() || undefined,
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
