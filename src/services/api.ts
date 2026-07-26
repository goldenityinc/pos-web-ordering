const DEFAULT_BRIDGE_API_URL =
  "https://goldenity-pos-api-bridge-production.up.railway.app";

const BRIDGE_API_URL = (
  process.env.NEXT_PUBLIC_BRIDGE_API_URL?.trim() || DEFAULT_BRIDGE_API_URL
).replace(/\/$/, "");

const NETWORK_WIFI_ERROR_MESSAGE =
  "Koneksi terhalang, mohon gunakan paket data atau cek koneksi internet Anda.";

export const DEFAULT_RECEIPT_FOOTER =
  "Barang yang sudah dibeli tidak dapat ditukar/dikembalikan";

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
  image_url?: string | null;
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
  customerName?: string;
  notes?: string;
  paymentMethod?: "CASHIER" | "QRIS" | "DIGITAL_PAYMENT";
  paymentProofFile?: File | null;
  paymentReceipt?:
    | string
    | {
        secure_url?: unknown;
        public_id?: unknown;
      }
    | null;
}

export interface SubmitOrderResponse {
  orderId?: string;
  message?: string;
  data?: Record<string, unknown>;
  receipt_number?: string;
  receiptNumber?: string;
  receipt_url?: string;
  receiptUrl?: string;
  [key: string]: unknown;
}

export interface PublicSettingsResponse {
  qrisImageUrl: string | null;
  allowPayAtCashier: boolean;
  isPaymentProofMandatory: boolean;
  receiptFooter: string;
}

export interface UpdateQrisImageInput {
  tenantId: string;
  qrisImageBase64?: string;
  qrisImageUrl?: string;
  fileName?: string;
  contentType?: string;
  settingsKey?: string;
}

export interface UpdateQrisImageResponse {
  tenantId?: string;
  qrisImageUrl?: string;
}

export interface UpdateReceiptFooterInput {
  tenantId: string;
  receiptFooter?: string;
  settingsKey?: string;
}

export interface UpdateReceiptFooterResponse {
  tenantId?: string;
  receiptFooter?: string;
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

class NetworkWifiError extends Error {
  constructor(message = NETWORK_WIFI_ERROR_MESSAGE) {
    super(message);
    this.name = "NetworkWifiError";
  }
}

function isJsonContentType(contentType: string | null) {
  return contentType?.toLowerCase().includes("application/json") ?? false;
}

async function parseJsonResponse<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const contentType = response.headers.get("content-type");

  if (!isJsonContentType(contentType)) {
    throw new NetworkWifiError(fallbackMessage);
  }

  try {
    return (await response.json()) as T;
  } catch (_error) {
    throw new NetworkWifiError(fallbackMessage);
  }
}

async function fetchJson<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  fallbackMessage = NETWORK_WIFI_ERROR_MESSAGE,
): Promise<{ response: Response; json: T }> {
  let response: Response;

  try {
    response = await fetch(input, init);
  } catch (_error) {
    throw new NetworkWifiError(fallbackMessage);
  }

  const json = await parseJsonResponse<T>(response, fallbackMessage);
  return { response, json };
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

function resolvePaymentReceiptUrl(
  value:
    | string
    | {
        secure_url?: unknown;
        public_id?: unknown;
      }
    | null
    | undefined,
): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  if (value && typeof value === "object") {
    return toStringOrUndefined(value.secure_url);
  }

  return undefined;
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
    image_url:
      toNullableString(data.image_url) ??
      toNullableString(data.imageUrl) ??
      toNullableString(data.image),
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

  const { response, json } = await fetchJson<RawApiResponse>(
    url.toString(),
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    },
    NETWORK_WIFI_ERROR_MESSAGE,
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch menu (${response.status}).`);
  }
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
  customerName,
  notes,
  paymentMethod,
  paymentProofFile,
  paymentReceipt,
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
  const normalizedPaymentMethod = (paymentMethod || "CASHIER").toString().trim();
  const paymentReceiptUrl = resolvePaymentReceiptUrl(paymentReceipt);

  const payload = {
    tenantId,
    table,
    tableId,
    table_id: tableId,
    branchId: branchId?.trim() || undefined,
    branch_id: branchId?.trim() || undefined,
    customerName: customerName?.trim() || undefined,
    customer_name: customerName?.trim() || undefined,
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
    payment_method: normalizedPaymentMethod,
    paymentReceipt: paymentReceiptUrl,
    payment_receipt: paymentReceiptUrl,
  };

  let response: Response;
  let json: SubmitOrderResponse;
  if (paymentProofFile) {
    const formData = new FormData();
    formData.append("tenantId", tenantId);
    formData.append("table", table);
    if (tableId?.trim()) {
      formData.append("tableId", tableId.trim());
      formData.append("table_id", tableId.trim());
    }
    if (branchId?.trim()) {
      formData.append("branchId", branchId.trim());
      formData.append("branch_id", branchId.trim());
    }
    if (customerName?.trim()) {
      formData.append("customerName", customerName.trim());
      formData.append("customer_name", customerName.trim());
    }
    formData.append("items", JSON.stringify(payload.items));
    formData.append("totalAmount", String(totalAmount));
    if (notes?.trim()) {
      formData.append("notes", notes.trim());
    }
    formData.append("payment_method", normalizedPaymentMethod);
    if (paymentReceiptUrl) {
      formData.append("paymentReceipt", paymentReceiptUrl);
      formData.append("payment_receipt", paymentReceiptUrl);
    }
    formData.append("payment_proof", paymentProofFile);

    ({ response, json } = await fetchJson<SubmitOrderResponse>(
      url,
      {
        method: "POST",
        body: formData,
      },
      NETWORK_WIFI_ERROR_MESSAGE,
    ));
  } else {
    ({ response, json } = await fetchJson<SubmitOrderResponse>(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      NETWORK_WIFI_ERROR_MESSAGE,
    ));
  }

  if (!response.ok) {
    const message = typeof json.message === "string" ? json.message : `Failed to submit order (${response.status}).`;
    throw new Error(message);
  }

  return json;
}

export async function getPublicSettings(
  tenantId: string,
  branchId?: string,
): Promise<PublicSettingsResponse> {
  if (!tenantId) {
    return {
      qrisImageUrl: null,
      allowPayAtCashier: true,
      isPaymentProofMandatory: true,
      receiptFooter: DEFAULT_RECEIPT_FOOTER,
    };
  }

  const url = new URL("/api/v1/settings", BRIDGE_API_URL);
  url.searchParams.set("tenantId", tenantId);
  if (branchId?.trim()) {
    url.searchParams.set("branchId", branchId.trim());
  }

  const { response, json } = await fetchJson<{
    data?: {
      config?: {
        qris_image_url?: unknown;
        allow_pay_at_cashier?: unknown;
        is_payment_proof_mandatory?: unknown;
        enable_qris_ocr?: unknown;
        receipt_footer?: unknown;
      };
    };
    config?: {
      qris_image_url?: unknown;
      allow_pay_at_cashier?: unknown;
      is_payment_proof_mandatory?: unknown;
      enable_qris_ocr?: unknown;
      receipt_footer?: unknown;
    };
  }>(
    url.toString(),
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    },
    NETWORK_WIFI_ERROR_MESSAGE,
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch settings (${response.status}).`);
  }

  const fromData = json.data?.config?.qris_image_url;
  const fromRoot = json.config?.qris_image_url;
  const qrisImageUrl =
    (typeof fromData === "string" && fromData.trim()) ||
    (typeof fromRoot === "string" && fromRoot.trim()) ||
    null;
  const allowFromData = json.data?.config?.allow_pay_at_cashier;
  const allowFromRoot = json.config?.allow_pay_at_cashier;
  const mandatoryFromData = json.data?.config?.is_payment_proof_mandatory;
  const mandatoryFromRoot = json.config?.is_payment_proof_mandatory;
  const ocrFromData = json.data?.config?.enable_qris_ocr;
  const ocrFromRoot = json.config?.enable_qris_ocr;
  const footerFromData = json.data?.config?.receipt_footer;
  const footerFromRoot = json.config?.receipt_footer;
  const receiptFooter =
    (typeof footerFromData === "string" && footerFromData.trim()) ||
    (typeof footerFromRoot === "string" && footerFromRoot.trim()) ||
    DEFAULT_RECEIPT_FOOTER;

  return {
    qrisImageUrl,
    allowPayAtCashier:
      typeof allowFromData === "boolean"
        ? allowFromData
        : typeof allowFromRoot === "boolean"
        ? allowFromRoot
        : true,
    isPaymentProofMandatory:
      typeof mandatoryFromData === "boolean"
        ? mandatoryFromData
        : typeof mandatoryFromRoot === "boolean"
        ? mandatoryFromRoot
        : typeof ocrFromData === "boolean"
        ? ocrFromData
        : typeof ocrFromRoot === "boolean"
        ? ocrFromRoot
        : true,
    receiptFooter,
  };
}


export async function updateQrisImage({
  tenantId,
  qrisImageBase64,
  qrisImageUrl,
  fileName,
  contentType,
  settingsKey,
}: UpdateQrisImageInput): Promise<UpdateQrisImageResponse> {
  if (!tenantId) {
    throw new Error("tenantId is required to update QRIS image.");
  }

  if (!qrisImageBase64 && !qrisImageUrl) {
    throw new Error("QRIS image payload is required.");
  }

  const url = new URL("/api/v1/settings/qris-image", BRIDGE_API_URL);
  const { response, json } = await fetchJson<{
    data?: UpdateQrisImageResponse;
    qrisImageUrl?: string;
    tenantId?: string;
    message?: string;
  }>(
    url.toString(),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settingsKey ? { "x-goldenity-settings-key": settingsKey.trim() } : {}),
      },
      body: JSON.stringify({
        tenantId,
        qrisImageBase64,
        qrisImageUrl,
        fileName,
        contentType,
      }),
    },
    NETWORK_WIFI_ERROR_MESSAGE,
  );

  if (!response.ok) {
    const message =
      typeof json.message === "string"
        ? json.message
        : `Failed to update QRIS image (${response.status}).`;
    throw new Error(message);
  }

  return json.data ?? {
    tenantId: json.tenantId,
    qrisImageUrl: json.qrisImageUrl,
  };
}

export async function updateReceiptFooter({
  tenantId,
  receiptFooter,
  settingsKey,
}: UpdateReceiptFooterInput): Promise<UpdateReceiptFooterResponse> {
  if (!tenantId) {
    throw new Error("tenantId is required to update receipt footer.");
  }

  const normalizedFooter =
    (typeof receiptFooter === "string" && receiptFooter.trim()) ||
    DEFAULT_RECEIPT_FOOTER;

  const url = new URL("/api/v1/settings/receipt-footer", BRIDGE_API_URL);
  const { response, json } = await fetchJson<{
    data?: UpdateReceiptFooterResponse;
    tenantId?: string;
    receiptFooter?: string;
    message?: string;
  }>(
    url.toString(),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settingsKey ? { "x-goldenity-settings-key": settingsKey.trim() } : {}),
      },
      body: JSON.stringify({
        tenantId,
        receiptFooter: normalizedFooter,
      }),
    },
    NETWORK_WIFI_ERROR_MESSAGE,
  );

  if (!response.ok) {
    const message =
      typeof json.message === "string"
        ? json.message
        : `Failed to update receipt footer (${response.status}).`;
    throw new Error(message);
  }

  return json.data ?? {
    tenantId: json.tenantId,
    receiptFooter: json.receiptFooter,
  };
}
