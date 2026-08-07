const DEFAULT_BRIDGE_API_URL =
  "https://goldenity-pos-api-bridge-production.up.railway.app";

const BRIDGE_API_URL = (
  process.env.NEXT_PUBLIC_BRIDGE_API_URL?.trim() || DEFAULT_BRIDGE_API_URL
).replace(/\/$/, "");

import { resolveOrderItemProductId } from "./order-utils.js";

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
  product?: {
    id?: string;
  };
  product_id?: string;
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
  orderId?: string;
  status?: string;
  orderStatus?: string;
  paymentStatus?: string;
  tableNumber?: string;
  items?: OrderItemInput[];
  paymentProofImageBase64?: string;
  orderNote?: string;
  submissionId: string;
  paxCount?: number;
  transactionId?: string;
  orderIndex?: number;
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
  success?: boolean;
  receipt?: any;
  submissionId?: string;
  ackStatus?: "PENDING_ACK" | "POS_ACKNOWLEDGED" | "POS_PRINTED" | "FAILED_DELIVERY" | "TIMEOUT";
  resolvedDeviceUuid?: string;
  queueEtaSeconds?: number;
  retryAvailable?: boolean;
  pollUntilAckUrl?: string;
}

export interface PublicSettingsResponse {
  qrisImageUrl: string | null;
  allowPayAtCashier: boolean;
  isPaymentProofMandatory: boolean;
  receiptFooter: string;
}

export interface UpdateQrisImageInput {
  tenantId: string;
  branchId?: string;
  qrisImageBase64?: string;
  qrisImageUrl?: string;
  fileName?: string;
  contentType?: string;
  settingsKey?: string;
}

export interface UpdateQrisImageResponse {
  tenantId?: string;
  branchId?: string;
  qrisImageUrl?: string;
}

export interface UpdateReceiptFooterInput {
  tenantId: string;
  branchId?: string;
  receiptFooter?: string;
  settingsKey?: string;
}

export interface UpdateReceiptFooterResponse {
  tenantId?: string;
  branchId?: string;
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
  orderId,
  status,
  orderStatus,
  paymentStatus,
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
  const normalizedOrderId = orderId?.trim();
  const normalizedStatus = (status || orderStatus || (normalizedOrderId ? "PREPARING" : "PENDING_PAYMENT")).toString().trim();
  const normalizedPaymentStatus = (
    paymentStatus || (normalizedOrderId ? "PAID" : "PENDING_PAYMENT")
  ).toString().trim();

  const payload = {
    tenantId,
    table,
    tableId,
    table_id: tableId,
    branchId: branchId?.trim() || undefined,
    branch_id: branchId?.trim() || undefined,
    orderId: normalizedOrderId || undefined,
    order_id: normalizedOrderId || undefined,
    customerName: customerName?.trim() || undefined,
    customer_name: customerName?.trim() || undefined,
    items: cartItems.map((item) => ({
      productId: resolveOrderItemProductId(item),
      quantity: item.quantity,
      price: item.price,
      name: item.name,
      subtotal: item.subtotal ?? item.price * item.quantity,
      note: item.note?.trim() || undefined,
    })),
    totalAmount,
    notes: notes?.trim() || undefined,
    payment_method: normalizedPaymentMethod,
    payment_method_name: normalizedPaymentMethod,
    paymentReceipt: paymentReceiptUrl,
    payment_receipt: paymentReceiptUrl,
    status: normalizedStatus,
    orderStatus: normalizedStatus,
    paymentStatus: normalizedPaymentStatus,
    payment_status: normalizedPaymentStatus,
    enable_qris_ocr: false,
    skip_ocr: true,
    disable_ocr: true,
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
    if (normalizedOrderId) {
      formData.append("orderId", normalizedOrderId);
      formData.append("order_id", normalizedOrderId);
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
    formData.append("payment_method_name", normalizedPaymentMethod);
    if (paymentReceiptUrl) {
      formData.append("paymentReceipt", paymentReceiptUrl);
      formData.append("payment_receipt", paymentReceiptUrl);
    }
    formData.append("status", normalizedStatus);
    formData.append("orderStatus", normalizedStatus);
    formData.append("paymentStatus", normalizedPaymentStatus);
    formData.append("payment_status", normalizedPaymentStatus);
    formData.append("enable_qris_ocr", "false");
    formData.append("skip_ocr", "true");
    formData.append("disable_ocr", "true");
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
    isPaymentProofMandatory: false,
    receiptFooter,
  };
}


export async function updateQrisImage({
  tenantId,
  branchId,
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
        branchId,
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
    branchId: json.data?.branchId,
    qrisImageUrl: json.qrisImageUrl,
  };
}

export async function updateReceiptFooter({
  tenantId,
  branchId,
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
        branchId,
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
    branchId: json.data?.branchId,
    receiptFooter: json.receiptFooter,
  };
}

export async function pollOrderAckStatus({
  tenantId,
  branchId,
  orderId,
  submissionId,
  maxSeconds = 35,
  onTick,
}: {
  tenantId: string;
  branchId?: string;
  orderId?: string | number;
  submissionId?: string;
  maxSeconds?: number;
  onTick?: (remainingSec: number) => void;
}): Promise<{ ackStatus: string; ackMessage?: string; error?: string }> {
  const pollIntervalMs = 2000;
  const startTime = Date.now();
  const maxMs = maxSeconds * 1000;

  while (Date.now() - startTime < maxMs) {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, Math.ceil((maxMs - elapsed) / 1000));
    if (onTick) {
      try {
        onTick(remaining);
      } catch (_) {}
    }

    try {
      const pathSegment = orderId
        ? encodeURIComponent(String(orderId))
        : submissionId
        ? `by-submission/${encodeURIComponent(submissionId)}`
        : null;

      if (!pathSegment) {
        return {
          ackStatus: "FAILED_DELIVERY",
          error: "orderId atau submissionId diperlukan untuk polling.",
        };
      }

      // 🔴 FIX 401 Unauthorized polling ACK status:
      //    Bridge /api/v1/orders/* route PROTECTED (butuh Bearer tenant token).
      //    Web Ordering TIDAK punya token → wajib pakai BYPASS prefix /relay/
      //    DAN kirim header "X-Internal-Relay: 1" untuk tenantResolver Bridge
      //    melakukan bypass Bearer auth dan resolve tenant dari query/body.
      const url = new URL(
        `/api/v1/relay/orders/${pathSegment}/ack-status`,
        BRIDGE_API_URL,
      );
      url.searchParams.set("tenantId", tenantId);
      if (branchId?.trim()) {
        url.searchParams.set("branchId", branchId.trim());
      }

      const resp = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Relay": "1",
        },
        cache: "no-store",
      });

      if (resp.ok) {
        try {
          const data = (await resp.json()) as Record<string, unknown>;
          const ackStatus =
            toStringOrUndefined(data.ackStatus) ??
            toStringOrUndefined(data.ack_status) ??
            "";
          const ackMessage =
            toStringOrUndefined(data.ackMessage) ??
            toStringOrUndefined(data.ack_message) ??
            toStringOrUndefined(data.message);

          if (
            ackStatus === "POS_PRINTED" ||
            ackStatus === "POS_ACKNOWLEDGED" ||
            ackStatus === "FAILED_DELIVERY"
          ) {
            return { ackStatus, ackMessage };
          }
        } catch (_parseErr) {}
      }
    } catch (_pollErr) {}

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  return {
    ackStatus: "TIMEOUT",
    error: `Polling ACK melebihi ${maxSeconds} detik.`,
  };
}

export async function submitOrderWithPosQueueAck(
  input: SubmitOrderInput & {
    onProgress?: (pct: number, stage: string, etaSeconds?: number) => void;
  },
): Promise<SubmitOrderResponse & { ackStatus?: string; error?: string }> {
  const { onProgress, ...restInput } = input;

  let submissionId = restInput.submissionId?.trim();
  if (!submissionId) {
    try {
      if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        submissionId = (crypto as Crypto).randomUUID();
      } else {
        submissionId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      }
    } catch (_) {
      submissionId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
  }

  const relayUrl = `${BRIDGE_API_URL}/api/v1/relay/web-order`;
  const payloadItems = restInput.items ?? restInput.cartItems ?? [];
  const tableNum = restInput.tableNumber ?? restInput.table;

  const relayPayload = {
    tenantId: restInput.tenantId,
    branchId: restInput.branchId?.trim() || undefined,
    tableId: restInput.tableId?.trim() || undefined,
    tableNumber: tableNum,
    submissionId,
    transactionId: restInput.transactionId?.trim() || undefined,
    orderIndex: restInput.orderIndex,
    paxCount: restInput.paxCount,
    orderPayload: {
      items: payloadItems.map((item) => ({
        productId: resolveOrderItemProductId(item),
        quantity: item.quantity,
        price: item.price,
        name: item.name,
        subtotal: item.subtotal ?? item.price * item.quantity,
        note: item.note?.trim() || undefined,
      })),
      customerName: restInput.customerName?.trim() || undefined,
      totalAmount: restInput.totalAmount,
      paymentMethod: (restInput.paymentMethod || "CASHIER").toString().trim(),
      orderNote:
        (restInput.orderNote ?? restInput.notes)?.trim() || undefined,
      paymentProofImageBase64: restInput.paymentProofImageBase64?.trim() || undefined,
    },
  };

  const reportProgress = (pct: number, stage: string, etaSeconds?: number) => {
    if (!onProgress) return;
    try {
      onProgress(pct, stage, etaSeconds);
    } catch (_) {}
  };

  reportProgress(5, "Menyiapkan pesanan...");

  try {
    const startTime = Date.now();
    let response: Response;
    let rawJson: Record<string, unknown>;
    let queueEtaFromHeader: number | undefined;

    try {
      reportProgress(15, "Mengirim ke kasir...", 30);
      response = await fetch(relayUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // 🔴 FIX 401 Unauthorized submit order:
          //    Wajib tambahkan header "X-Internal-Relay: 1" ke endpoint
          //    /api/v1/relay/* agar Bridge tenantResolver bypass Bearer auth
          //    dan resolve tenant dari body payload (bukan dari JWT).
          "X-Internal-Relay": "1",
        },
        body: JSON.stringify(relayPayload),
      });

      const etaHeader = response.headers.get("X-Queue-Eta");
      if (etaHeader) {
        const parsed = Number(etaHeader);
        if (Number.isFinite(parsed) && parsed > 0) {
          queueEtaFromHeader = parsed;
        }
      }

      try {
        rawJson = (await response.json()) as Record<string, unknown>;
      } catch (_parseErr) {
        rawJson = {};
      }
    } catch (fetchErr) {
      return {
        success: false,
        submissionId,
        ackStatus: "TIMEOUT",
        retryAvailable: true,
        error:
          fetchErr instanceof Error
            ? fetchErr.message
            : "Koneksi terputus saat mengirim pesanan.",
      };
    }

    const dataRoot =
      rawJson && typeof rawJson.data === "object" && rawJson.data
        ? (rawJson.data as Record<string, unknown>)
        : rawJson;

    const ackStatus =
      (toStringOrUndefined(dataRoot.ackStatus) as SubmitOrderResponse["ackStatus"]) ??
      (toStringOrUndefined(rawJson.ackStatus) as SubmitOrderResponse["ackStatus"]);

    const retryAvailable =
      typeof dataRoot.retryAvailable === "boolean"
        ? dataRoot.retryAvailable
        : typeof rawJson.retryAvailable === "boolean"
        ? rawJson.retryAvailable
        : undefined;

    const echoSubmissionId =
      toStringOrUndefined(dataRoot.submissionId) ??
      toStringOrUndefined(rawJson.submissionId) ??
      submissionId;

    const resolvedDeviceUuid =
      toStringOrUndefined(dataRoot.resolvedDeviceUuid) ??
      toStringOrUndefined(rawJson.resolvedDeviceUuid);

    const pollUntilAckUrl =
      toStringOrUndefined(dataRoot.pollUntilAckUrl) ??
      toStringOrUndefined(rawJson.pollUntilAckUrl);

    const responseOrderId =
      toStringOrUndefined(dataRoot.orderId) ??
      toStringOrUndefined(dataRoot.id) ??
      toStringOrUndefined(rawJson.orderId) ??
      toStringOrUndefined(rawJson.order_id);

    const responseReceiptNumber =
      toStringOrUndefined(dataRoot.receiptNumber) ??
      toStringOrUndefined(dataRoot.receipt_number) ??
      toStringOrUndefined(rawJson.receiptNumber) ??
      toStringOrUndefined(rawJson.receipt_number);

    const responseMessage =
      toStringOrUndefined(rawJson.message) ??
      toStringOrUndefined(dataRoot.message);

    if (!response.ok) {
      if (response.status === 504 || response.status === 503 || response.status === 502) {
        return {
          success: false,
          submissionId: echoSubmissionId,
          orderId: responseOrderId,
          receiptNumber: responseReceiptNumber,
          message: responseMessage ?? `Perangkat kasir tidak merespon (${response.status}).`,
          ackStatus: "TIMEOUT",
          retryAvailable: true,
          resolvedDeviceUuid,
          queueEtaSeconds: queueEtaFromHeader,
          pollUntilAckUrl,
          error: responseMessage ?? `Perangkat kasir tidak merespon (${response.status}).`,
        };
      }

      return {
        success: false,
        submissionId: echoSubmissionId,
        orderId: responseOrderId,
        receiptNumber: responseReceiptNumber,
        message: responseMessage ?? `Gagal mengirim pesanan (${response.status}).`,
        ackStatus: "FAILED_DELIVERY",
        retryAvailable: retryAvailable ?? false,
        resolvedDeviceUuid,
        queueEtaSeconds: queueEtaFromHeader,
        pollUntilAckUrl,
        error: responseMessage ?? `Gagal mengirim pesanan (${response.status}).`,
      };
    }

    if (ackStatus === "POS_PRINTED" || ackStatus === "POS_ACKNOWLEDGED") {
      reportProgress(100, "Pesanan diterima & dicetak dapur!", 0);
      return {
        success: true,
        submissionId: echoSubmissionId,
        orderId: responseOrderId,
        receiptNumber: responseReceiptNumber,
        message: responseMessage,
        receipt: dataRoot.receipt ?? rawJson.receipt,
        ackStatus,
        resolvedDeviceUuid,
        queueEtaSeconds: queueEtaFromHeader,
        retryAvailable: false,
        pollUntilAckUrl,
        data: dataRoot,
      };
    }

    reportProgress(50, "Menunggu konfirmasi print...", queueEtaFromHeader ?? 35);

    const pollResult = await pollOrderAckStatus({
      tenantId: restInput.tenantId,
      branchId: restInput.branchId,
      orderId: responseOrderId,
      submissionId: echoSubmissionId,
      maxSeconds: 35,
      onTick: (remaining) => {
        const elapsedMs = Date.now() - startTime;
        const totalMs = Math.max(elapsedMs + remaining * 1000, 1);
        const pct = Math.min(95, Math.max(50, Math.floor((elapsedMs / totalMs) * 100)));
        reportProgress(pct, "Menunggu konfirmasi print...", remaining);
      },
    });

    if (pollResult.ackStatus === "POS_PRINTED" || pollResult.ackStatus === "POS_ACKNOWLEDGED") {
      reportProgress(100, "Pesanan diterima & dicetak dapur!", 0);
      return {
        success: true,
        submissionId: echoSubmissionId,
        orderId: responseOrderId,
        receiptNumber: responseReceiptNumber,
        message: pollResult.ackMessage ?? responseMessage,
        receipt: dataRoot.receipt ?? rawJson.receipt,
        ackStatus: pollResult.ackStatus as SubmitOrderResponse["ackStatus"],
        resolvedDeviceUuid,
        queueEtaSeconds: queueEtaFromHeader,
        retryAvailable: false,
        pollUntilAckUrl,
        data: dataRoot,
      };
    }

    if (pollResult.ackStatus === "FAILED_DELIVERY") {
      return {
        success: false,
        submissionId: echoSubmissionId,
        orderId: responseOrderId,
        receiptNumber: responseReceiptNumber,
        message: pollResult.ackMessage ?? pollResult.error ?? "Pesanan gagal dikirim ke dapur.",
        ackStatus: "FAILED_DELIVERY",
        retryAvailable: true,
        resolvedDeviceUuid,
        queueEtaSeconds: queueEtaFromHeader,
        pollUntilAckUrl,
        error: pollResult.error ?? "Pesanan gagal dikirim ke dapur.",
      };
    }

    return {
      success: false,
      submissionId: echoSubmissionId,
      orderId: responseOrderId,
      receiptNumber: responseReceiptNumber,
      message: pollResult.error ?? "Perangkat kasir tidak merespon dalam 30 detik.",
      ackStatus: "TIMEOUT",
      retryAvailable: true,
      resolvedDeviceUuid,
      queueEtaSeconds: queueEtaFromHeader,
      pollUntilAckUrl,
      error: pollResult.error ?? "Perangkat kasir tidak merespon dalam 30 detik.",
    };
  } catch (err) {
    return {
      success: false,
      submissionId,
      ackStatus: "FAILED_DELIVERY",
      retryAvailable: true,
      error: err instanceof Error ? err.message : "Terjadi kesalahan tak terduga.",
    };
  }
}
