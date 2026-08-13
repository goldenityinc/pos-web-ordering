const DEFAULT_BRIDGE_API_URL =
  "https://goldenity-pos-api-bridge-production.up.railway.app";

const BRIDGE_API_URL = (
  process.env.NEXT_PUBLIC_BRIDGE_API_URL?.trim() || DEFAULT_BRIDGE_API_URL
).replace(/\/$/, "");

import { resolveOrderItemProductId } from "./order-utils.js";

const NETWORK_WIFI_ERROR_MESSAGE =
  "Koneksi terhalang, mohon gunakan paket data atau cek koneksi internet Anda.";

const _pendingAckPolls = new Map<string, AbortController>();
const _pendingSubmitOrders = new Map<string, Promise<any>>();

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
    isPaymentProofMandatory:
      typeof mandatoryFromData === "boolean"
        ? mandatoryFromData
        : typeof mandatoryFromRoot === "boolean"
        ? mandatoryFromRoot
        : false,
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
  // 🔴 STRICT MUTEX PER submissionId/orderId + AbortController:
  //    Jika pollOrderAckStatus dipanggil BERULANG KALI untuk submission YANG SAMA
  //    (karena double submit bug / re-render spam), maka poll LAMA di-abort
  //    dan hanya poll BARU yang berjalan. Ini menghilangkan SPAM bertubi ack-status
  //    seperti di screenshot pertama (20+ request paralel same id).
  const pollMutexKey = submissionId
    ? `sub:${String(submissionId).trim()}`
    : orderId !== undefined && orderId !== null && String(orderId).trim() !== ""
    ? `ord:${String(orderId).trim()}`
    : `anon:${Date.now()}`;
  const prevCtrl = _pendingAckPolls.get(pollMutexKey);
  if (prevCtrl) {
    try { prevCtrl.abort(new Error("duplicate-poll-cancelled")); } catch (_) {}
    _pendingAckPolls.delete(pollMutexKey);
  }
  const abortCtrl = new AbortController();
  _pendingAckPolls.set(pollMutexKey, abortCtrl);
  let pollSucceededCleanly = false;
  const cleanup = () => {
    const stored = _pendingAckPolls.get(pollMutexKey);
    if (stored === abortCtrl) _pendingAckPolls.delete(pollMutexKey);
  };
  try {
    const pollIntervalMs = 2000;
    const startTime = Date.now();
    const maxMs = maxSeconds * 1000;
    let flyingRequest: Promise<any> | null = null;

    while (Date.now() - startTime < maxMs) {
      if (abortCtrl.signal.aborted) {
        return {
          ackStatus: "CANCELLED",
          error: "Polling dibatalkan (duplicate / navigasi).",
        };
      }
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, Math.ceil((maxMs - elapsed) / 1000));
      if (onTick) {
        try { onTick(remaining); } catch (_) {}
      }

      let statusDone = false;
      if (flyingRequest === null) {
        const pathSegment = orderId
          ? encodeURIComponent(String(orderId))
          : submissionId
          ? `by-submission/${encodeURIComponent(submissionId)}`
          : null;

        if (!pathSegment) {
          pollSucceededCleanly = true;
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

        const fetchPromise = (async () => {
          try {
            const resp = await fetch(url.toString(), {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                "X-Internal-Relay": "1",
              },
              cache: "no-store",
              signal: abortCtrl.signal,
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
                  statusDone = true;
                  flyingRequest = null;
                  pollSucceededCleanly = true;
                  cleanup();
                  return { ackStatus, ackMessage, done: true };
                }
              } catch (_parseErr) {}
            }
          } catch (_pollErr) {
            if (_pollErr && (_pollErr as any).name === "AbortError") {
              statusDone = true;
              flyingRequest = null;
              pollSucceededCleanly = true;
              cleanup();
              return { ackStatus: "CANCELLED", error: "Cancelled", done: true };
            }
          }
          return { done: false };
        })();
        flyingRequest = fetchPromise;
        fetchPromise.then((r) => {
          if (flyingRequest === fetchPromise) flyingRequest = null;
          return r;
        }).catch(() => {
          if (flyingRequest === fetchPromise) flyingRequest = null;
        });
      }

      const tickDeadline = Date.now() + pollIntervalMs;
      // Wait BOTH: minimal 1 tick interval DAN (optional flying promise selesai sebelum deadline)
      // TAPI NEVER start request BARU kalau sebelumnya BELUM selesai (mutex FLYING).
      // Loop ini akan idle menunggu: sleep 150ms chunks check deadline or flying resolved.
      while (Date.now() < tickDeadline) {
        if (abortCtrl.signal.aborted) break;
        if (statusDone) break;
        const resolved = await Promise.race([
          new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 180)),
          flyingRequest ? Promise.resolve(flyingRequest.then((x: any) => x as any)).catch(() => null) : Promise.resolve(null),
        ]);
        if (resolved && (resolved as any).done === true) {
          return (resolved as any).ackStatus
            ? { ackStatus: (resolved as any).ackStatus, ackMessage: (resolved as any).ackMessage, error: (resolved as any).error }
            : { ackStatus: "CANCELLED", error: (resolved as any).error };
        }
      }
      if (statusDone) break;
    }

    pollSucceededCleanly = true;
    return {
      ackStatus: "TIMEOUT",
      error: `Polling ACK melebihi ${maxSeconds} detik.`,
    };
  } finally {
    if (!pollSucceededCleanly) cleanup();
    else cleanup();
  }
}

export async function submitOrderWithPosQueueAck(
  input: SubmitOrderInput & {
    onProgress?: (pct: number, stage: string, etaSeconds?: number) => void;
    isRetry?: boolean;
  },
): Promise<SubmitOrderResponse & { ackStatus?: string; error?: string }> {
  const { onProgress, isRetry = false, ...restInput } = input;

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

  // 🔴 GLOBAL SUBMIT ORDER MUTEX: cegah DDoS sendiri dari DOUBLE CLICK user / 2 tab / 2 meja.
  //    Key = combination of transactionId:submissionId:tableId:tenantId.
  //    Jika function submit order YANG SAMA masih FLYING (promise blm resolve) → return promise SAMA (dedup).
  //    User klik 5x bertubi dalam 200ms: hanya 1 request yang benar-benar terkirim.
  const submitMutexKey = [
    String(restInput.tenantId || "").trim(),
    String(restInput.branchId || "").trim(),
    String(restInput.tableId || restInput.table || "").trim(),
    String(restInput.transactionId || "").trim(),
    submissionId,
  ].join("|");

  if (isRetry) {
    // 🔴 CRITICAL HOTFIX 2B: Retry mode → BYPASS CACHE SEPENUHNYA, NUKE old dedup, FRESH network call!
    try {
      _pendingSubmitOrders.delete(submitMutexKey);
      if (typeof window !== "undefined" && typeof console !== "undefined") {
        try { console.log(`[dedup:retry] Cleared dedup cache for retry (isRetry=true) key=${submitMutexKey}`); } catch (_noop) {}
      }
    } catch (_noop) {}
  } else {
    const prev = _pendingSubmitOrders.get(submitMutexKey);
    if (prev) {
      // Return promise SAMA dengan yang sudah berjalan (deduplicate 100%).
      return prev as Promise<any>;
    }
  }

  const finalWork = (async () => {
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
    let queueEtaFromBody: number | undefined;
    const BASE_ETA_FALLBACK_SECONDS = 10;

    try {
      // 🔴 DYNAMIC ETA FIX (user exact request):
      //    Initial fallback 10 detik jika TIDAK ADA ANTRIAN (queue empty),
      //    jika ada antrian bridge kirim X-Queue-Eta header & etaNextQueue body.
      reportProgress(15, "Mengirim ke kasir...", BASE_ETA_FALLBACK_SECONDS);
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
      // Extract etaNextQueue dari body jika ada (prioritas #1, lalu header, lalu fallback 10):
      const rawEtaBody =
        (rawJson && typeof rawJson === "object" && (rawJson as any).etaNextQueue != null)
          ? (rawJson as any).etaNextQueue
          : (rawJson && typeof rawJson === "object" && typeof (rawJson as any).data === "object" && (rawJson as any).data?.etaNextQueue != null)
          ? (rawJson as any).data.etaNextQueue
          : undefined;
      if (rawEtaBody != null) {
        const pBody = Number(rawEtaBody);
        if (Number.isFinite(pBody) && pBody > 0) queueEtaFromBody = pBody;
      }
      // Segera UPDATE progress ETA ke user DENGAN nilai real dari Bridge!
      {
        const actualEta = queueEtaFromBody ?? queueEtaFromHeader ?? BASE_ETA_FALLBACK_SECONDS;
        if (actualEta) {
          try { reportProgress(28, "Menunggu perangkat POS menerima pesanan...", actualEta); } catch (_) { /* noop */ }
        }
      }
    } catch (fetchErr) {
      try { _pendingSubmitOrders.delete(submitMutexKey); } catch (_noop) {}
      try {
        if (typeof window !== "undefined" && typeof console !== "undefined") {
          try { console.log(`[dedup:fetchErr] Cleared dedup cache for retry (immediate fetch err) key=${submitMutexKey} err=${fetchErr instanceof Error ? fetchErr.message : fetchErr}`); } catch (_noop) {}
        }
      } catch (_noop2) {}
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

    reportProgress(50, "Menunggu konfirmasi print...", queueEtaFromBody ?? queueEtaFromHeader ?? BASE_ETA_FALLBACK_SECONDS);

    const resolvedDisplayEta = Math.max(
      queueEtaFromBody ?? queueEtaFromHeader ?? BASE_ETA_FALLBACK_SECONDS,
      BASE_ETA_FALLBACK_SECONDS,
    );

    const pollResult = await pollOrderAckStatus({
      tenantId: restInput.tenantId,
      branchId: restInput.branchId,
      orderId: responseOrderId,
      submissionId: echoSubmissionId,
      maxSeconds: 35,
      onTick: (remaining) => {
        const elapsedMs = Date.now() - startTime;
        const baseEtaTotal = Math.max(queueEtaFromBody ?? queueEtaFromHeader ?? BASE_ETA_FALLBACK_SECONDS, BASE_ETA_FALLBACK_SECONDS);
        const totalMs = Math.max(baseEtaTotal * 1000, elapsedMs + remaining * 1000, 1);
        const pct = Math.min(95, Math.max(50, Math.floor((elapsedMs / totalMs) * 100)));
        // 🔴 FIX DISPLAY ETA (Bukan pakai remaining polling countdown 35s → selalu 30/35 detik ke user)
        //    remaining = sisa detik POLLING LOOP countdown maxSeconds=35, BUKAN perkiraan ETA pesanan.
        //    Pakai resolvedDisplayEta (actualEta from bridge atau base 10 detik jika tanpa antrian) → user lihat 10/25/40 sesuai kecepatan antrian.
        const displayEtaRemainingCountdown = Math.max(0, Math.min(remaining, resolvedDisplayEta));
        reportProgress(pct, "Menunggu konfirmasi print...", displayEtaRemainingCountdown);
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

    try { _pendingSubmitOrders.delete(submitMutexKey); } catch (_noop) {}
    try {
      if (typeof window !== "undefined" && typeof console !== "undefined") {
        try { console.log(`[dedup:pollTimeout] Cleared dedup cache for retry (ack polling timeout 35s) key=${submitMutexKey} submissionId=${submissionId}`); } catch (_noop) {}
      }
    } catch (_noop2) {}
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
    try { _pendingSubmitOrders.delete(submitMutexKey); } catch (_noop) {}
    try {
      if (typeof window !== "undefined" && typeof console !== "undefined") {
        try { console.log(`[dedup:catch] Cleared dedup cache for retry (exception thrown) key=${submitMutexKey} err=${err?.message || err}`); } catch (_noop) {}
      }
    } catch (_noop2) {}
    return {
      success: false,
      submissionId,
      ackStatus: "FAILED_DELIVERY",
      retryAvailable: true,
      error: err instanceof Error ? err.message : "Terjadi kesalahan tak terduga.",
    };
  }
  })();

  const dedupFinallyAttached: Promise<any> = finalWork.then(
    (res) => {
      try {
        const rAny = (res || {}) as Record<string, unknown>;
        const success = Boolean(rAny.success);
        const ackStatus = String(rAny.ackStatus || "").trim().toUpperCase();
        if (success && (ackStatus === "POS_PRINTED" || ackStatus === "POS_ACKNOWLEDGED" || ackStatus === "SYNC_DELAYED" || ackStatus === "ACK")) {
          // SUCCESS path: dedup already cleaned below; keep for idempotency window 10 detik then remove
          setTimeout(() => { try { _pendingSubmitOrders.delete(submitMutexKey); } catch (_noop) {} }, 10_000);
        } else {
          // success=false / timeout / 5xx / ackStatus TIMEOUT → NUKE immediately supaya retry bisa langsung
          try {
            _pendingSubmitOrders.delete(submitMutexKey);
            if (typeof window !== "undefined" && typeof console !== "undefined") {
              try { console.log(`[dedup:finally] Cleared dedup cache for retry (success=${success} ackStatus=${ackStatus}) key=${submitMutexKey}`); } catch (_noop) {}
            }
          } catch (_noop) {}
        }
      } catch (_noop) {}
      return res;
    },
    (err) => {
      try {
        _pendingSubmitOrders.delete(submitMutexKey);
        if (typeof window !== "undefined" && typeof console !== "undefined") {
          try { console.log(`[dedup:catch] Cleared dedup cache for retry (exception thrown) key=${submitMutexKey} err=${err?.message || err}`); } catch (_noop) {}
        }
      } catch (_noop) {}
      // re-throw preserved for legacy upstream behaviour
      throw err;
    },
  );
  try {
    _pendingSubmitOrders.set(submitMutexKey, dedupFinallyAttached);
  } catch (_noop) {}
  try {
    const finalResult = await dedupFinallyAttached;
    const resultAny = finalResult as Record<string, unknown> | null | undefined;
    try {
      if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
        const STORAGE_KEY_TX = "goldenity:v1:activeTxId";
        const STORAGE_KEY_ORDER = "goldenity:v1:activeOrderId";
        const STORAGE_KEY_SUBMISSION = "goldenity:v1:activeSubmissionId";
        const STORAGE_KEY_RECEIPT = "goldenity:v1:activeReceiptNumber";
        const STORAGE_KEY_META = "goldenity:v1:activeOrderMeta";

        const extractTxId =
          (restInput as Record<string, unknown>).transactionId ??
          (restInput as Record<string, unknown>).transaction_id ??
          resultAny?.transactionId ??
          resultAny?.transaction_id ??
          resultAny?.receiptNumber ??
          resultAny?.receipt_number ??
          (restInput as Record<string, unknown>).receiptNumber ??
          (restInput as Record<string, unknown>).receipt_number;
        const extractOrderId =
          resultAny?.orderId ??
          resultAny?.order_id ??
          resultAny?.id ??
          (restInput as Record<string, unknown>).orderId ??
          (restInput as Record<string, unknown>).order_id;
        const extractSubmission =
          resultAny?.submissionId ??
          resultAny?.submission_id ??
          (restInput as Record<string, unknown>).submissionId ??
          (restInput as Record<string, unknown>).submission_id ??
          submissionId;
        const extractReceipt =
          resultAny?.receiptNumber ??
          resultAny?.receipt_number ??
          (restInput as Record<string, unknown>).receiptNumber ??
          (restInput as Record<string, unknown>).receipt_number;
        if (extractTxId && typeof extractTxId === "string" && extractTxId.trim().length > 0) {
          localStorage.setItem(STORAGE_KEY_TX, String(extractTxId).trim());
        }
        if (extractOrderId && typeof extractOrderId === "string" && String(extractOrderId).trim().length > 0) {
          localStorage.setItem(STORAGE_KEY_ORDER, String(extractOrderId).trim());
        }
        if (extractSubmission && typeof extractSubmission === "string" && extractSubmission.trim().length > 0) {
          localStorage.setItem(STORAGE_KEY_SUBMISSION, String(extractSubmission).trim());
        }
        if (extractReceipt && typeof extractReceipt === "string" && extractReceipt.trim().length > 0) {
          localStorage.setItem(STORAGE_KEY_RECEIPT, String(extractReceipt).trim());
        }
        try {
          const metaObj: Record<string, unknown> = {
            savedAt: new Date().toISOString(),
            tenantId: (restInput as Record<string, unknown>).tenantId,
            branchId: (restInput as Record<string, unknown>).branchId,
            tableId: (restInput as Record<string, unknown>).tableId,
            success: (resultAny?.success === true),
            ackStatus: resultAny?.ackStatus ?? null,
          };
          localStorage.setItem(STORAGE_KEY_META, JSON.stringify(metaObj));
        } catch (_metaErr) {
          // ignore JSON serialization issues for meta
        }
      }
    } catch (_lsErr) {
      // localStorage write must NEVER break the submit flow. SSR/hydration safety.
    }
    return finalResult as any;
  } finally {
    try {
      const storedNow = _pendingSubmitOrders.get(submitMutexKey);
      if (Object.is(storedNow, finalWork) || Object.is(storedNow, dedupFinallyAttached)) {
        _pendingSubmitOrders.delete(submitMutexKey);
      }
    } catch (_dedupCleanNoop) { /* noop */ }
  }
}

export type UploadQrPaymentProofResponse = {
  success: boolean;
  idempotentReplay?: boolean;
  transition?: string;
  message?: string;
  error?: string;
  data?: {
    id?: string | number;
    tenantId?: string;
    referenceId?: string;
    receiptNumber?: string;
    orderType?: string;
    orderStatus?: string;
    paymentStatus?: string;
    paymentMethod?: string;
    paymentProofUrl?: string;
    storageKey?: string;
    amountPaid?: string | number;
    total_price?: string | number;
    total_amount?: string | number;
    tableId?: string | number;
    customerName?: string;
    updatedAt?: string;
  };
};

export async function uploadQrOrderPaymentProof({
  tenantId,
  orderId,
  transactionId,
  branchId,
  paymentProofFile,
  paymentProofUrl,
  paymentMethod,
}: {
  tenantId: string;
  orderId?: string | number;
  transactionId?: string | number;
  branchId?: string;
  paymentProofFile?: File | null;
  paymentProofUrl?: string;
  paymentMethod?: "QRIS" | "CASHIER";
}): Promise<UploadQrPaymentProofResponse> {
  if (!tenantId) {
    throw new Error("tenantId is required to upload payment proof.");
  }
  const hasOrderRef = Boolean(orderId || transactionId);
  if (!hasOrderRef) {
    throw new Error("orderId or transactionId is required to upload payment proof.");
  }
  // 🔴 FIX: BUKAN unconditional throw!
  //    isPaymentProofMandatory=false (QRIS bukti opsional / Settings OFF) → TANPA file upload di-ALLOW.
  //    Bila tidak ada bukti: kirim payment_proof_url = null / empty agar upstream accept tanpa file upload mutipart.
  //    Throw HANYA bila keduanya tidak ada AND user secara explicit mau upload bukti (paymentProofFile = required scenario).
  //    Frontend sudah guard di home-page-client.tsx via isPaymentProofMandatory flag → biarkan flow kosong lewat sini.
  const hasPaymentProof = Boolean(paymentProofFile) || Boolean(paymentProofUrl && paymentProofUrl.trim().length > 0);

  const orderIdStr = orderId != null ? String(orderId).trim() : "";
  const txIdStr = transactionId != null ? String(transactionId).trim() : "";
  // Build by-order OR by-transaction endpoint
  const url = orderIdStr
    ? `${BRIDGE_API_URL}/api/v1/relay/qr-orders/${encodeURIComponent(orderIdStr)}/payment`
    : `${BRIDGE_API_URL}/api/v1/relay/qr-orders/by-transaction/${encodeURIComponent(txIdStr)}/payment`;
  const normalizedMethod = (paymentMethod || "QRIS").toString().trim();

  let response: Response;
  let json: UploadQrPaymentProofResponse;

  if (hasPaymentProof) {
    const formData = new FormData();
    formData.append("tenantId", tenantId);
    formData.append("tenant_id", tenantId);
    if (branchId?.trim()) {
      formData.append("branchId", branchId.trim());
      formData.append("branch_id", branchId.trim());
    }
    if (txIdStr) {
      formData.append("transactionId", txIdStr);
      formData.append("transaction_id", txIdStr);
    }
    formData.append("paymentMethod", normalizedMethod);
    formData.append("payment_method", normalizedMethod);
    if (paymentProofUrl?.trim()) {
      formData.append("payment_proof_url", paymentProofUrl.trim());
    }
    if (paymentProofFile) {
      formData.append("payment_proof", paymentProofFile);
    }

    ({ response, json } = await fetchJson<UploadQrPaymentProofResponse>(
      url,
      {
        method: "PUT",
        body: formData,
        headers: {
          "X-Internal-Relay": "1",
        },
      },
      NETWORK_WIFI_ERROR_MESSAGE,
    ));
  } else {
    const payload = {
      tenantId,
      tenant_id: tenantId,
      branchId: branchId?.trim() || undefined,
      branch_id: branchId?.trim() || undefined,
      transactionId: txIdStr || undefined,
      transaction_id: txIdStr || undefined,
      paymentMethod: normalizedMethod,
      payment_method: normalizedMethod,
      payment_proof_url: paymentProofUrl?.trim(),
      paymentProofUrl: paymentProofUrl?.trim(),
    };

    ({ response, json } = await fetchJson<UploadQrPaymentProofResponse>(
      url,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Relay": "1",
        },
        body: JSON.stringify(payload),
      },
      NETWORK_WIFI_ERROR_MESSAGE,
    ));
  }

  if (!response.ok) {
    const message =
      (typeof json.message === "string" ? json.message : null) ||
      (typeof json.error === "string" ? json.error : null) ||
      `Failed to upload payment proof (${response.status}).`;
    return {
      success: false,
      error: message,
      message,
    };
  }

  return {
    ...json,
    success: true,
  };
}

export type ReplayTransactionOrderResponse = {
  ok: boolean;
  success?: boolean;
  message: string;
  transactionId?: string | null;
  submissionId?: string | null;
  ackStatus?: string | null;
  socket?: unknown;
  orderId?: unknown;
  emittedAt?: string;
  retryAvailable?: boolean;
  error?: string;
};

export async function replayStuckTransactionOrder({
  tenantId,
  branchId,
  transactionId,
  submissionId,
}: {
  tenantId: string;
  branchId?: string;
  transactionId?: string;
  submissionId?: string;
}): Promise<ReplayTransactionOrderResponse> {
  try {
    const hasTxId = typeof transactionId === "string" && transactionId.trim().length > 0;
    const hasSubId = typeof submissionId === "string" && submissionId.trim().length > 0;
    if (!hasTxId && !hasSubId) {
      return {
        ok: false,
        message: "Transaction ID atau Submission ID wajib diisi untuk replay order ke POS.",
        retryAvailable: false,
      };
    }

    let url: string;
    if (hasTxId) {
      url = `${BRIDGE_API_URL}/api/v1/relay/replay/by-transaction/${encodeURIComponent(transactionId!.trim())}`;
    } else {
      url = `${BRIDGE_API_URL}/api/v1/relay/replay/by-submission/${encodeURIComponent(submissionId!.trim())}`;
    }

    const bodyPayload: Record<string, string | undefined> = {
      tenantId,
      tenant_id: tenantId,
    };
    if (branchId?.trim()) {
      bodyPayload.branchId = branchId.trim();
      bodyPayload.branch_id = branchId.trim();
    }
    if (hasTxId) bodyPayload.transactionId = transactionId!.trim();
    if (hasSubId) bodyPayload.submissionId = submissionId!.trim();

    const { response, json } = await fetchJson<ReplayTransactionOrderResponse>(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": tenantId,
          "X-Internal-Relay": "1",
        },
        body: JSON.stringify(bodyPayload),
      },
      NETWORK_WIFI_ERROR_MESSAGE,
    );

    if (!response.ok) {
      const message =
        typeof json === "object" && json !== null && typeof (json as ReplayTransactionOrderResponse).message === "string"
          ? (json as ReplayTransactionOrderResponse).message
          : `Replay order gagal (HTTP ${response.status}). Silakan submit order baru dari halaman menu jika order lebih dari 30 menit.`;
      return {
        ok: false,
        message,
        retryAvailable: true,
        error: message,
      };
    }

    return {
      ok: true,
      retryAvailable: false,
      ...(typeof json === "object" && json !== null ? (json as ReplayTransactionOrderResponse) : { message: "Replay order dikirim ke POS." }),
    };
  } catch (err) {
    return {
      ok: false,
      retryAvailable: true,
      message: err instanceof Error ? err.message : "Koneksi terputus saat replay order ke POS.",
      error: err instanceof Error ? err.message : "Terjadi kesalahan tak terduga.",
    };
  }
}

const ACTIVE_TX_STORAGE_KEY = "goldenity:v1:activeTxId";
const ACTIVE_ORDER_STORAGE_KEY = "goldenity:v1:activeOrderId";
const ACTIVE_SUBMISSION_STORAGE_KEY = "goldenity:v1:activeSubmissionId";
const ACTIVE_RECEIPT_STORAGE_KEY = "goldenity:v1:activeReceiptNumber";
const ACTIVE_ORDER_META_KEY = "goldenity:v1:activeOrderMeta";

export type PersistedActiveOrderSnapshot = {
  transactionId: string | null;
  orderId: string | null;
  submissionId: string | null;
  receiptNumber: string | null;
  meta: Record<string, unknown> | null;
  found: boolean;
};

function readStorageValueSafely(key: string): string | null {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    const s = String(raw).trim();
    return s.length > 0 ? s : null;
  } catch {
    return null;
  }
}

export function getPersistedActiveOrder(): PersistedActiveOrderSnapshot {
  const txId = readStorageValueSafely(ACTIVE_TX_STORAGE_KEY);
  const orderId = readStorageValueSafely(ACTIVE_ORDER_STORAGE_KEY);
  const submissionId = readStorageValueSafely(ACTIVE_SUBMISSION_STORAGE_KEY);
  const receiptNumber = readStorageValueSafely(ACTIVE_RECEIPT_STORAGE_KEY);
  let meta: Record<string, unknown> | null = null;
  try {
    const rawMeta = readStorageValueSafely(ACTIVE_ORDER_META_KEY);
    if (rawMeta) {
      const parsed = JSON.parse(rawMeta);
      if (parsed && typeof parsed === "object") meta = parsed as Record<string, unknown>;
    }
  } catch {
    meta = null;
  }
  const found = Boolean(txId || orderId || submissionId || receiptNumber);
  return {
    transactionId: txId,
    orderId,
    submissionId,
    receiptNumber,
    meta,
    found,
  };
}

export function clearPersistedActiveOrder(): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(ACTIVE_TX_STORAGE_KEY);
  } catch {
    /* noop */
  }
  try {
    localStorage.removeItem(ACTIVE_ORDER_STORAGE_KEY);
  } catch {
    /* noop */
  }
  try {
    localStorage.removeItem(ACTIVE_SUBMISSION_STORAGE_KEY);
  } catch {
    /* noop */
  }
  try {
    localStorage.removeItem(ACTIVE_RECEIPT_STORAGE_KEY);
  } catch {
    /* noop */
  }
  try {
    localStorage.removeItem(ACTIVE_ORDER_META_KEY);
  } catch {
    /* noop */
  }
}

export function getActiveOrderByTransaction(
  transactionId: string,
  params: { tenantId?: string | null; branchId?: string | null; tableId?: string | null } = {},
) {
  const { tenantId, branchId, tableId } = params || {};
  if (typeof transactionId !== "string" || transactionId.trim().length === 0) {
    return Promise.resolve({ ok: false, data: [], error: "Transaction ID kosong." });
  }
  const q = new URLSearchParams();
  if (typeof tenantId === "string" && tenantId.trim().length > 0) q.set("tenantId", tenantId.trim());
  if (typeof branchId === "string" && branchId.trim().length > 0) q.set("branchId", branchId.trim());
  if (typeof tableId === "string" && tableId.trim().length > 0) q.set("tableId", tableId.trim());
  const qs = q.toString();
  const url = `${BRIDGE_API_URL}/api/v1/relay/orders/by-transaction/${encodeURIComponent(transactionId.trim())}${qs ? `?${qs}` : ""}`;
  return fetchJson(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(typeof tenantId === "string" && tenantId.trim().length > 0 ? { "X-Tenant-Id": tenantId.trim() } : {}),
      "X-Internal-Relay": "1",
    },
  })
    .then(({ response, json }) => {
      if (!response.ok) {
        const errMsg =
          (typeof json === "object" && json !== null && typeof (json as { message?: string }).message === "string"
            ? (json as { message: string }).message
            : null) || `Gagal mengambil status order (HTTP ${response.status}).`;
        return { ok: false, data: [], error: errMsg };
      }
      let arr: unknown[] = [];
      if (Array.isArray(json)) {
        arr = json as unknown[];
      } else if (typeof json === "object" && json !== null) {
        const candidate = (json as { data?: unknown }).data;
        if (Array.isArray(candidate)) arr = candidate as unknown[];
      }
      return { ok: true, data: arr as any[], error: null };
    })
    .catch((err) => ({
      ok: false,
      data: [],
      error: err instanceof Error ? err.message : "Koneksi terputus saat mengambil status order.",
    }));
}
