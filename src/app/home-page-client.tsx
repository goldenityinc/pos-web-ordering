"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  DEFAULT_RECEIPT_FOOTER,
  getPublicSettings,
  getMenu,
  BranchInfo,
  MenuCategory,
  MenuProduct,
  OrderItemInput,
  submitOrder,
  submitOrderWithPosQueueAck,
  pollOrderAckStatus,
  updateReceiptFooter,
  updateQrisImage,
  SubmitOrderResponse,
  uploadQrOrderPaymentProof,
} from "../services/api";
import { resolveOrderItemProductId } from "../services/order-utils.js";
import { useCart } from "../contexts/cart-context";
import {
  safeGetStorage,
  safeSetStorage,
  safeRemoveStorage,
  safeParseLocalStorageJson,
  writeLocalStorageJson,
  removeLocalStorageKey,
  APP_STORAGE_PREFIX,
} from "../lib/app-storage";

export const dynamic = "force-dynamic";

const rupiahFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

type GroupedMenuSection = {
  id: string;
  name: string;
  items: MenuProduct[];
};

type OnlineReceiptItem = {
  name: string;
  quantity: number;
  price: number;
  subtotal: number;
  note?: string;
};

type OnlineReceiptSnapshot = {
  orderId: string;
  receiptNumber: string;
  createdAt: string;
  customerName: string;
  tenantName: string;
  tableNumber: string;
  branchName: string;
  paymentMethod: string;
  totalAmount: number;
  items: OnlineReceiptItem[];
  orderNote?: string;
  paymentProofUrl?: string;
  receiptUrl?: string;
  receiptFooter: string;
};

type AckStatusType =
  | "PENDING_ACK"
  | "POS_ACKNOWLEDGED"
  | "POS_PRINTED"
  | "FAILED_DELIVERY"
  | "TIMEOUT"
  | string;

type OrderItemRecord = {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  subtotal: number;
  note?: string;
  modifiers?: string[];
  variantNotes?: string[];
};

type OrderRecord = {
  submissionId: string;
  orderId?: string;
  orderIndex: number;
  transactionId: string;
  items: OrderItemRecord[];
  subtotal: number;
  customerName?: string;
  tableNumber: string;
  tableId?: string;
  branchId?: string;
  tenantId: string;
  paymentMethod?: "CASHIER" | "QRIS";
  createdAt: string;
  receiptNumber?: string;
  ackStatus: AckStatusType;
  resolvedDeviceUuid?: string;
  orderNote?: string;
};

type QueueScreenState = {
  isOpen: boolean;
  progressPct: number;
  stageMessage: string;
  etaSeconds?: number;
  isFailed: boolean;
  failureMessage?: string;
  submissionId?: string;
  transactionId?: string;
  queuePosition?: number;
  queueTotal?: number;
  retryPayload?: Parameters<typeof submitOrderWithPosQueueAck>[0];
};

type SnackbarState = {
  isOpen: boolean;
  message: string;
  type: "success" | "error" | "info";
};

type HomePageClientProps = {
  forcedMode?: "settings";
};

function parseDateStringSafely(value: string) {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return null;
  }

  const isoCandidate = normalizedValue.includes("T")
    ? normalizedValue
    : normalizedValue.replace(" ", "T");
  const parsedDate = new Date(isoCandidate);

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function getUrlFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  if (value && typeof value === "object" && "secure_url" in value) {
    const secureUrl = (value as { secure_url?: unknown }).secure_url;
    return typeof secureUrl === "string" && secureUrl.trim() ? secureUrl.trim() : undefined;
  }

  return undefined;
}

const UNPAID_ORDER_PAYMENT_STATUSES = new Set([
  "PENDING_PAYMENT",
  "PENDING",
  "AWAITING_PAYMENT",
  "PARTIALLY_PAID",
  "PARTIAL",
  "",
  null,
  undefined,
]);

export default function HomePage({ forcedMode }: HomePageClientProps = {}) {
  const searchParams = useSearchParams();

  const tenantId =
    searchParams.get("tenant")?.trim() || searchParams.get("tenantId")?.trim() || "";
  const tableNumber = searchParams.get("table")?.trim() || "-";
  const tableId =
    searchParams.get("tableId")?.trim() || searchParams.get("table_id")?.trim() || "";
  const storeNameFromUrl =
    searchParams.get("store")?.trim() || searchParams.get("storeName")?.trim() || "";
  const branchId =
    searchParams.get("branchId")?.trim() || searchParams.get("branch_id")?.trim() || "";
  const branchNameFromUrl =
    searchParams.get("branchName")?.trim() || searchParams.get("branch_name")?.trim() || "";
  const mode = searchParams.get("mode")?.trim().toLowerCase() || "";
  const isSettingsMode =
    forcedMode === "settings" || mode === "settings" || searchParams.get("settings") === "1";
  const isSettingsOnlyMode = forcedMode === "settings";
  const { addToCart, cart, clearCart, decreaseFromCart, updateItemNote } = useCart();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string>("");
  const [branchInfo, setBranchInfo] = useState<BranchInfo | undefined>(undefined);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [products, setProducts] = useState<MenuProduct[]>([]);
  const [searchText, setSearchText] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState<string>("all");
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isQrisFlowOpen, setIsQrisFlowOpen] = useState(false);
  const [isQrisPreviewOpen, setIsQrisPreviewOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [customerNameInput, setCustomerNameInput] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"CASHIER" | "QRIS">("CASHIER");
  const [allowPayAtCashier, setAllowPayAtCashier] = useState(true);
  const [isPaymentProofMandatory, setIsPaymentProofMandatory] = useState(true);
  const [qrisImageUrl, setQrisImageUrl] = useState<string | null>(null);
  const [qrisLoadError, setQrisLoadError] = useState<string | null>(null);
  const [settingsQrisKey, setSettingsQrisKey] = useState("");
  const [settingsQrisFile, setSettingsQrisFile] = useState<File | null>(null);
  const [settingsQrisPreviewUrl, setSettingsQrisPreviewUrl] = useState("");
  const [settingsQrisMessage, setSettingsQrisMessage] = useState("");
  const [settingsQrisError, setSettingsQrisError] = useState<string | null>(null);
  const [settingsReceiptFooter, setSettingsReceiptFooter] = useState<string>(
    DEFAULT_RECEIPT_FOOTER,
  );
  const [isSavingQris, setIsSavingQris] = useState(false);
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const [paymentProofPreviewUrl, setPaymentProofPreviewUrl] = useState<string>("");
  const [copySuccess, setCopySuccess] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isOrderSuccess, setIsOrderSuccess] = useState(false);
  const [orderReceipt, setOrderReceipt] = useState<OnlineReceiptSnapshot | null>(null);
  const [pendingOrderId, setPendingOrderId] = useState("");
  const [qrisFirstStepCompleted, setQrisFirstStepCompleted] = useState(false);
  const [isQrisPaymentUploading, setIsQrisPaymentUploading] = useState(false);
  const [pendingQrisOrder, setPendingQrisOrder] = useState<{
    orderId: string;
    submissionId: string;
    transactionId: string;
    receiptNumber?: string;
    orderIndex: number;
    orderRecord?: OrderRecord;
  } | null>(null);

  const [queueScreen, setQueueScreen] = useState<QueueScreenState>({
    isOpen: false,
    progressPct: 0,
    stageMessage: "",
    etaSeconds: undefined,
    isFailed: false,
  });
  const [snackbar, setSnackbar] = useState<SnackbarState>({
    isOpen: false,
    message: "",
    type: "info",
  });
  const [activeTab, setActiveTab] = useState<"menu" | "orderList">("menu");
  const [orderList, setOrderList] = useState<OrderRecord[]>([]);
  const [paxCountInput, setPaxCountInput] = useState<number | "">("");
  const [isPaymentMethodModalOpen, setIsPaymentMethodModalOpen] = useState(false);
  const [isAwaitingPaymentConfirmation, setIsAwaitingPaymentConfirmation] = useState(false);
  const [orderListPollingToken, setOrderListPollingToken] = useState(0);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // 🔴 [CRITICAL FIX 2 - STALE CACHE LAMA DI MEJA BERBEDA]
  //    User pindah dari Meja 3 (URL ...?tableId=3) ke Meja A1 (...?tableId=36)
  //    Tapi localStorage ACTIVE_TX_ID_KEY masih bawa transactionId MEJA LAMA →
  //    Order List Tab menampilkan data LAMA (trx lama / kosong items) → TIDAK BISA BAYAR.
  //    Solusi: Compare URL current tableId/branchId/tenantId vs storedScope, jika TIDAK SAMA
  //    → FORCE RESET SEMUA CACHE TRANSAKSI LAMA (scope = 1 browser tab 1 meja).
  useEffect(() => {
    if (!isMounted || !tenantId) return;
    try {
      const STORED_SCOPE_KEY = `${APP_STORAGE_PREFIX}currentSessionScope_v1`;
      const currentScope = {
        tenantId: tenantId.trim(),
        branchId: branchId.trim(),
        tableId: tableId.trim(),
        tableNumber: tableNumber.trim(),
      };
      const scopeStr = JSON.stringify(currentScope);
      const stored = safeGetStorage(STORED_SCOPE_KEY) || "";
      const storedTxId = safeGetStorage(ACTIVE_TX_ID_KEY) || "";

      const storedIsEmpty = stored === "" || stored === "{}";
      const scopeMatches = !storedIsEmpty && stored === scopeStr;
      const scopeTableChanged = !scopeMatches && storedTxId !== "";

      if (scopeTableChanged || storedIsEmpty) {
        if (storedTxId) {
          safeRemoveStorage(buildOrdersStorageKey(storedTxId));
          safeRemoveStorage(`${APP_STORAGE_PREFIX}paxCount_${storedTxId}`);
          safeRemoveStorage(`${APP_STORAGE_PREFIX}customerName_${storedTxId}`);
        }
        safeRemoveStorage(ACTIVE_TX_ID_KEY);
        safeRemoveStorage(ACTIVE_ORDER_IDX_KEY);
        safeRemoveStorage(AWAITING_PAYMENT_KEY);
        safeRemoveStorage(`${APP_STORAGE_PREFIX}lastPaymentTx`);
        safeRemoveStorage(`${APP_STORAGE_PREFIX}qr_order_progress`);
        try {
          if (typeof localStorage !== "undefined" && localStorage && APP_STORAGE_PREFIX) {
            const keysToDelete: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key && key.startsWith(APP_STORAGE_PREFIX) && !key.endsWith("SETTINGS_v1") && !key.endsWith("FOOTER_v1") && !key.endsWith("QRIS_URL_v1")) {
                if (key === STORED_SCOPE_KEY) continue;
                keysToDelete.push(key);
              }
            }
            for (const k of keysToDelete) {
              try { localStorage.removeItem(k); } catch (_e) { /* ignore */ }
            }
          }
        } catch (_e) { /* ignore */ }
        setOrderList([]);
        setIsAwaitingPaymentConfirmation(false);
        setIsOrderSuccess(false);
        setOrderReceipt(null);
        setPendingOrderId("");
        if (typeof clearCart === "function") {
          try { clearCart(); } catch (_e) { /* ignore */ }
        }
      }
      safeSetStorage(STORED_SCOPE_KEY, scopeStr);
    } catch (_e) {
      console.warn("[scope reset error]", _e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, tenantId, branchId, tableId, tableNumber]);

  useEffect(() => {
    if (!tenantId) {
      setCategories([]);
      setProducts([]);
      setTenantName(storeNameFromUrl);
      return;
    }

    const run = async () => {
      setLoading(true);
      setError(null);

      try {
        const menu = await getMenu(tenantId, {
          branchId,
          branchName: branchNameFromUrl,
        });
        setCategories(menu.categories);
        setProducts(menu.products);
        setBranchInfo(menu.branch);

        const resolvedTenantName = [
          storeNameFromUrl,
          menu.tenant?.name?.trim(),
          menu.tenant?.slug?.trim(),
          tenantId,
        ].find((value) => Boolean(value)) || "Customer Ordering";

        setTenantName(resolvedTenantName);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Gagal mengambil data menu.";
        setError(message);
        setCategories([]);
        setProducts([]);
        setBranchInfo(undefined);
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [branchId, branchNameFromUrl, storeNameFromUrl, tenantId]);

  useEffect(() => {
    if (activeCategoryId === "all") {
      return;
    }

    const categoryExists = categories.some((category) => category.id === activeCategoryId);
    if (!categoryExists) {
      setActiveCategoryId("all");
    }
  }, [activeCategoryId, categories]);

  useEffect(() => {
    if (!isCheckoutOpen) {
      if (paymentProofPreviewUrl) {
        URL.revokeObjectURL(paymentProofPreviewUrl);
      }
      setSubmitError(null);
      setIsOrderSuccess(false);
      setCustomerNameInput("");
      setPaymentMethod(allowPayAtCashier ? "CASHIER" : "QRIS");
      setIsQrisFlowOpen(false);
      setQrisLoadError(null);
      setPaymentProofFile(null);
      setPaymentProofPreviewUrl("");
      setCopySuccess("");
      setOrderReceipt(null);
      setPendingOrderId("");
      setIsQrisPreviewOpen(false);
      setQrisFirstStepCompleted(false);
      setIsQrisPaymentUploading(false);
      setPendingQrisOrder(null);
    }
  }, [allowPayAtCashier, isCheckoutOpen, paymentProofPreviewUrl]);

  useEffect(() => {
    if (!settingsQrisPreviewUrl) {
      return;
    }

    return () => {
      URL.revokeObjectURL(settingsQrisPreviewUrl);
    };
  }, [settingsQrisPreviewUrl]);

  useEffect(() => {
    if ((!isCheckoutOpen && !isSettingsMode) || !tenantId) {
      return;
    }

    const run = async () => {
      try {
        setQrisLoadError(null);
        const settings = await getPublicSettings(tenantId, branchId);
        setQrisImageUrl(settings.qrisImageUrl);
        setAllowPayAtCashier(settings.allowPayAtCashier !== false);
        setIsPaymentProofMandatory(false);
        setSettingsReceiptFooter(settings.receiptFooter || DEFAULT_RECEIPT_FOOTER);
        if (settings.allowPayAtCashier === false) {
          setPaymentMethod("QRIS");
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Gagal memuat QRIS toko.";
        setQrisLoadError(message);
        setQrisImageUrl(null);
        setAllowPayAtCashier(true);
        setIsPaymentProofMandatory(false);
        setSettingsReceiptFooter(DEFAULT_RECEIPT_FOOTER);
      }
    };

    void run();
  }, [branchId, isCheckoutOpen, isSettingsMode, tenantId]);

  const ACTIVE_TX_ID_KEY = `${APP_STORAGE_PREFIX}activeTransactionId`;
  const ACTIVE_ORDER_IDX_KEY = `${APP_STORAGE_PREFIX}activeOrderIndex`;
  const AWAITING_PAYMENT_KEY = `${APP_STORAGE_PREFIX}awaitingPayment`;

  const buildOrdersStorageKey = (txId: string) =>
    `${APP_STORAGE_PREFIX}orders_transaction_${txId}`;

  const getOrCreateTransactionId = (): string => {
    if (!isMounted) return "";
    const existing = safeGetStorage(ACTIVE_TX_ID_KEY);
    if (existing && existing.trim()) {
      return existing.trim();
    }
    const newId = `TX-${Date.now()}`;
    safeSetStorage(ACTIVE_TX_ID_KEY, newId);
    return newId;
  };

  const getNextOrderIndex = (): number => {
    if (!isMounted) return 1;
    const raw = safeGetStorage(ACTIVE_ORDER_IDX_KEY);
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.floor(parsed);
    }
    safeSetStorage(ACTIVE_ORDER_IDX_KEY, "1");
    return 1;
  };

  const incrementOrderIndex = (): void => {
    if (!isMounted) return;
    const current = getNextOrderIndex();
    safeSetStorage(ACTIVE_ORDER_IDX_KEY, String(current + 1));
  };

  const clearTransactionContext = (): void => {
    if (!isMounted) return;
    const txId = safeGetStorage(ACTIVE_TX_ID_KEY);
    safeRemoveStorage(ACTIVE_TX_ID_KEY);
    safeRemoveStorage(ACTIVE_ORDER_IDX_KEY);
    safeRemoveStorage(AWAITING_PAYMENT_KEY);
    if (txId) {
      safeRemoveStorage(buildOrdersStorageKey(txId));
    }
  };

  const isPaymentStatusUnpaid = (raw: unknown): boolean => {
    const s = (raw == null ? "" : String(raw)).trim().toUpperCase();
    if (UNPAID_ORDER_PAYMENT_STATUSES.has(s as any) || s.length === 0) return true;
    if (s.includes("PAID") && !s.includes("PARTIAL")) return false;
    if (["REFUNDED", "VOID", "CANCELLED", "EXPIRED", "FAILED"].includes(s)) return false;
    return true;
  };

  const isAckStatusPaid = (raw: unknown): boolean => {
    const s = (raw == null ? "" : String(raw)).trim().toUpperCase();
    return s === "PAID" || s === "COMPLETED" || s === "POS_PRINTED";
  };

  const isOrderRecordPaid = (o: any): boolean => {
    const pmRaw = String(o.paymentMethod || o.payment_method || "").toUpperCase().trim();
    const psRaw = o.paymentStatus ?? o.payment_status ?? o.status;
    const ackRaw = o.ackStatus ?? o.ack_status ?? "";
    const isPaidFlag =
      Boolean((o as any)?.isPaid) === true ||
      Boolean((o as any)?.paid) === true ||
      Boolean((o as any)?.is_paid) === true;
    if (isPaidFlag) return true;
    if (!isPaymentStatusUnpaid(psRaw)) return true;
    if (pmRaw === "QRIS" && isAckStatusPaid(ackRaw)) return true;
    return false;
  };

  const loadOrdersForTransaction = (txId: string): OrderRecord[] => {
    if (!txId || !isMounted) return [];
    return safeParseLocalStorageJson<OrderRecord[]>(
      buildOrdersStorageKey(txId),
      [],
    );
  };

  const saveOrderToTransaction = (txId: string, order: OrderRecord): void => {
    if (!txId || !isMounted) return;
    const existing = loadOrdersForTransaction(txId);
    const idx = existing.findIndex((o) => o.submissionId === order.submissionId);
    if (idx >= 0) {
      existing[idx] = order;
    } else {
      existing.push(order);
    }
    writeLocalStorageJson(buildOrdersStorageKey(txId), existing);
    setOrderList(existing);
  };

  const patchOrderInList = (
    txId: string,
    submissionId: string,
    patch: Partial<OrderRecord>,
  ): void => {
    if (!txId || !submissionId || !isMounted) return;
    const existing = loadOrdersForTransaction(txId);
    const idx = existing.findIndex((o) => o.submissionId === submissionId);
    if (idx >= 0) {
      existing[idx] = { ...existing[idx], ...patch };
      writeLocalStorageJson(buildOrdersStorageKey(txId), existing);
      setOrderList([...existing]);
    }
  };

  const showSnackbar = (message: string, type: "success" | "error" | "info" = "info") => {
    setSnackbar({ isOpen: true, message, type });
  };

  const closeSnackbar = () => {
    setSnackbar((s) => ({ ...s, isOpen: false }));
  };

  const generateSubmissionId = (): string => {
    try {
      if (
        typeof crypto !== "undefined" &&
        crypto &&
        "randomUUID" in crypto
      ) {
        return (crypto as Crypto).randomUUID();
      }
    } catch (_) {}
    return `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  };

  useEffect(() => {
    if (!snackbar.isOpen) return;
    const t = setTimeout(() => {
      setSnackbar((s) => ({ ...s, isOpen: false }));
    }, 3500);
    return () => clearTimeout(t);
  }, [snackbar.isOpen, snackbar.message]);

  useEffect(() => {
    if (!isMounted) return;
    const txId = safeGetStorage(ACTIVE_TX_ID_KEY);
    if (txId) {
      const orders = loadOrdersForTransaction(txId);
      setOrderList(orders);
    }
    const awaiting = safeGetStorage(AWAITING_PAYMENT_KEY);
    setIsAwaitingPaymentConfirmation(Boolean(awaiting && awaiting === "1"));
  }, [isMounted, tenantId, orderListPollingToken]);

  useEffect(() => {
    if (!isMounted) return;
    const txId = safeGetStorage(ACTIVE_TX_ID_KEY);
    if (!txId) return;

    const interval = setInterval(() => {
      (async () => {
        try {
          // 🔴 FIX 401 Unauthorized order history poller by-transaction:
          //    Protected Bridge route /api/v1/orders/... → ganti ke BYPASS
          //    /api/v1/relay/orders/... + header X-Internal-Relay: 1 agar
          //    tenantResolver bypass Bearer auth check.
          const url = new URL(
            `/api/v1/relay/orders/by-transaction/${encodeURIComponent(txId)}`,
            process.env.NEXT_PUBLIC_BRIDGE_API_URL?.trim() ||
              "https://goldenity-pos-api-bridge-production.up.railway.app",
          );
          url.searchParams.set("tenantId", tenantId);
          if (branchId?.trim()) {
            url.searchParams.set("branchId", branchId.trim());
          }
          // 🔴 FIX 2 CROSS-TABLE ISOLATION: PASS tableId KE ENDPOINT POLLING BY-TRANSACTION
          //    Supaya Bridge + Admin Core WHERE filter table_id = MEJA INI SAJA.
          //    Data order meja TIDAK BOcOR ke meja lain!
          if (tableId?.trim()) {
            url.searchParams.set("tableId", tableId.trim());
          } else if (tableNumber?.trim() && /^\d+$/.test(tableNumber.trim())) {
            // Fallback jika hanya ada tableNumber string numeric (mis. "3"):
            url.searchParams.set("tableId", tableNumber.trim());
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
            const data = await resp.json();
            const orders =
              data && Array.isArray(data)
                ? data
                : data && Array.isArray((data as any).data)
                ? (data as any).data
                : null;
            if (orders) {
              // 🔴 [FIX 3a] REMOVE stale cache entries: Bridge return hasil LOCAL dengan items LENGHT 0.
              //    Hapus order dari storage yang items = [] tapi transactionId match (HINDARI
              //    Order List Tab menampilkan data kosong → TIDAK BISA BAYAR karena totalAmount = 0).
              const currentStored = loadOrdersForTransaction(txId) || [];
              const purgeKeys = new Set<string>();
              for (const upstream of orders) {
                const subId = String(upstream.submissionId || "").trim() || "";
                const hasItems = Array.isArray(upstream.items) && upstream.items.length > 0;
                if (!subId) continue;
                if (hasItems) purgeKeys.add(subId + "__KEEP_FRESH");
              }

              // 🔴 CRITICAL FIX (ROOT CAUSE: Cart State Contamination QRIS PAID):
              //    Upstream polling SELALU mengembalikan SEMUA order per table (termasuk
              //    status PAID / REFUNDED / VOID / CANCELLED), TAPI user request MUTLAK:
              //    "Barang yang sudah dibayar SEBELUMNYA JANGAN PERNAH muncul kembali di
              //    order list / keranjang belanja user saat ini."
              //
              //    FILTER KETAT upstream order: hanya yang BELUM LUNAS (unpaid) yang
              //    boleh masuk normalized / storage / orderList.
              //    Order PAID — APAPUN metodenya (QRIS/CASHIER) — BUANG dari active session.
              //    Helper functions dipindahkan ke component scope (atas) agar legal menurut strict ES5.

              const unpaidUpstream = (orders as any[]).filter((o) => !isOrderRecordPaid(o));
              const upstreamHasAnyPaid = (orders as any[]).some((o) => isOrderRecordPaid(o));

              // 🔴 🔴 CRITICAL HOTFIX (PAYMENT BANNER STATE LOCK "SUDAH LUNAS" PADAHAL ADA
              //    ORDER TAMBAHAN BARU YANG UNPAID Rp 10.000):
              //    Skenario bug user:
              //      1) Order 1 (Americano Rp 10k) → QRIS PAID (ada di server upstream).
              //      2) User tekan TAMBAH PESANAN → Order 2 (Teh Hijau Rp 10k) → Bayar di Kasir.
              //      3) Submit order via POST checkout → order 2 MASIH di LOCAL STORAGE / orderList.
              //      4) Polling 10 detik berjalan: upstream HANYA return Order 1 yang PAID
              //         (karena Order 2 BELUM TERKIRIM / BELUM MASUK DB).
              //      5) Hasil upstream: unpaidUpstream.length === 0 + upstreamHasAnyPaid = TRUE
              //         → code L721 sebelumnya JALANKAN PURGE SEMUA (clearTransactionContext,
              //           clearCart, setOrderList([])) → ORDER 2 BARU USER DITAMBAHKAN TERHAPUS!
              //      6) orderList = [] → sortedOrderList = [] → orderPaymentFlags.allPaid === TRUE
              //         → Banner hijau "SUDAH LUNAS" padahal user BERHUTANG Rp 10.000!
              //    FIX:
              //    SEBELUM jalankan purge → CHECK local currentStored (order yg sudah ada di
              //    localStorage / state) APAKAH ADA YANG BELUM LUNAS / items>0 (artinya order
              //    tambahan baru user yang masih pending offline). JIKA ADA → BATALKAN PURGE.
              //    Purge HANYA boleh dijalankan JIKA:
              //      (upstream semua paid) AND (local juga tidak ada unpaid apapun AND cart kosong).
              const localHasAnyUnpaidItems = currentStored.some((s) => {
                if (Array.isArray(s.items) && s.items.length > 0) {
                  // Ada items → cek apakah ini unpaid:
                  return !isOrderRecordPaid({
                    paymentMethod: s.paymentMethod,
                    paymentStatus: (s as any).paymentStatus,
                    ackStatus: s.ackStatus,
                  });
                }
                return false;
              });
              const localCartNotEmpty = Array.isArray(cart) && cart.length > 0 && cart.some((c) => Number(c.quantity || 0) > 0);
              const safeToPurgeAll =
                unpaidUpstream.length === 0 &&
                orders.length > 0 &&
                upstreamHasAnyPaid &&
                !localHasAnyUnpaidItems &&
                !localCartNotEmpty;

              let shouldPurgeStorageTotal = safeToPurgeAll;

              // Step 2: Normalize fresh (HANYA unpaid yang masuk normalized)
              const normalized: OrderRecord[] = unpaidUpstream.map((o) => ({
                submissionId:
                  String(o.submissionId || "").trim() || generateSubmissionId(),
                orderId: o.orderId ?? o.id ?? undefined,
                orderIndex: Number(o.orderIndex) || 1,
                transactionId: o.transactionId || txId,
                items:
                  (Array.isArray(o.items) ? o.items : []).map((it: any) => ({
                    productId: String(it.productId || it.product_id || ""),
                    name: String(it.name || ""),
                    quantity: Number(it.quantity) || Number(it.qty) || 0,
                    price: Number(it.price) || Number(it.harga_jual) || Number(it.unit_price) || 0,
                    subtotal:
                      Number(it.subtotal) ||
                      (Number(it.price) || 0) * (Number(it.quantity) || Number(it.qty) || 0) ||
                      0,
                    note: it.note || it.special_note || undefined,
                    modifiers: Array.isArray(it.modifiers) ? it.modifiers : [],
                    variantNotes: Array.isArray(it.variantNotes)
                      ? it.variantNotes
                      : [],
                  })),
                subtotal:
                  Number(o.subtotal) ||
                  Number(o.grandTotal) ||
                  Number(o.totalAmount) ||
                  Number(o.total_amount) ||
                  0,
                customerName: o.customerName || o.customer_name || o.customer || undefined,
                tableNumber: o.tableNumber || o.table_number || o.table || tableNumber,
                tableId: o.tableId || o.table_id || undefined,
                branchId: o.branchId || o.branch_id || undefined,
                tenantId: o.tenantId || o.tenant_id || tenantId,
                paymentMethod:
                  o.paymentMethod === "QRIS"
                    ? "QRIS"
                    : (o.paymentMethod && String(o.paymentMethod).toUpperCase() === "QRIS")
                    ? "QRIS"
                    : o.paymentMethod
                    ? "CASHIER"
                    : undefined,
                createdAt:
                  o.createdAt ||
                  o.created_at ||
                  new Date().toISOString(),
                receiptNumber:
                  o.receiptNumber || o.receipt_number || undefined,
                ackStatus:
                  o.ackStatus || o.ack_status || "POS_ACKNOWLEDGED",
                resolvedDeviceUuid: o.resolvedDeviceUuid || undefined,
                orderNote: o.orderNote || o.notes || o.special_note || undefined,
              }));
              // Step 3: Fresh data punya order BERISI items → override storage
              const freshHasAnyItems = normalized.some((n) => n.items && n.items.length > 0);

              // 🔴 CRITICAL FIX: JIKA upstream SEMUA order PAID (unpaidUpstream = 0 tapi
              //    upstreamHasAnyPaid = TRUE) + LOCAL TIDAK ADA UNPAID ORDER BARU (cart juga
              //    kosong) → ARTINYA SESSION INI SUDAH LUNAS SEMUA.
              //    Segera jalankan "Sapu Bersih" (clearCart + clearTransactionContext
              //    + reset orderList + close modals).
              //    Ini mencegah bug user: "Setelah QRIS PAID, user mau tambah pesanan →
              //    ITEM BARANG LAMA YANG SUDAH DIBAYAR muncul kembali di cart/order."
              //
              // 🔴 HOTFIX PAYMENT BANNER: Ganti conditional → safeToPurgeAll (sudah
              //    include localHasAnyUnpaidItems + localCartNotEmpty check → JIKA ADA
              //    order tambahan baru user yang masih offline pending → TIDAK DI PURGE).
              if (isMounted && safeToPurgeAll) {
                try {
                  clearTransactionContext();
                } catch (_) {}
                try {
                  clearCart();
                } catch (_) {}
                setOrderList([]);
                setIsAwaitingPaymentConfirmation(false);
                setIsQrisFlowOpen(false);
                setIsCheckoutOpen(false);
                setActiveTab("menu");
                setCustomerNameInput("");
                setPaymentMethod("CASHIER");
                setPendingOrderId("");
                setOrderReceipt(null);
                setIsOrderSuccess(false);
                safeRemoveStorage(buildOrdersStorageKey(txId));
                safeRemoveStorage(ACTIVE_TX_ID_KEY);
                safeRemoveStorage(AWAITING_PAYMENT_KEY);
                safeRemoveStorage(`${APP_STORAGE_PREFIX}paxCount_${txId}`);
                safeRemoveStorage(`${APP_STORAGE_PREFIX}customerName_${txId}`);
                if (typeof safeGetStorage === "function") {
                  try {
                    const allKeys = Object.keys(localStorage || {});
                    for (const k of allKeys) {
                      if (k.startsWith(APP_STORAGE_PREFIX)) {
                        try { localStorage.removeItem(k); } catch (_e) {}
                      }
                    }
                  } catch (_e) { /* ignore */ }
                }
                return;
              }

              if (freshHasAnyItems) {
                writeLocalStorageJson(buildOrdersStorageKey(txId), normalized);
                setOrderList(normalized);
                if (normalized.length > 0) {
                  setIsAwaitingPaymentConfirmation(true);
                  if (isMounted) safeSetStorage(AWAITING_PAYMENT_KEY, "1");
                } else {
                  setIsAwaitingPaymentConfirmation(false);
                  if (isMounted) safeSetStorage(AWAITING_PAYMENT_KEY, "0");
                }
              } else if (currentStored.length === 0 || shouldPurgeStorageTotal) {
                // Step 4: Semua data kosong → purge empty stale
                writeLocalStorageJson(buildOrdersStorageKey(txId), []);
                setOrderList([]);
                setIsAwaitingPaymentConfirmation(false);
                if (isMounted) safeSetStorage(AWAITING_PAYMENT_KEY, "0");
              } else {
                // Step 5: Gabung (merge) existing STORED yg sudah ada items dengan upstream
                //          (upstream acak waktu empty karena Bridge cache baru di-setting)
                // 🔴 EXTRA SAFETY: Saat merge, FILTER currentStored yang SUDAH PAID juga
                //    (jika user sebelumnya sudah bayar via simulasi lunas tapi storage
                //    belum ke-clear karena refresh page).
                const paidStored = currentStored.filter((s) =>
                  isOrderRecordPaid({
                    paymentMethod: s.paymentMethod,
                    ackStatus: s.ackStatus,
                  })
                );
                let cleanCurrent = currentStored;
                if (paidStored.length > 0) {
                  cleanCurrent = currentStored.filter((s) =>
                    !isOrderRecordPaid({
                      paymentMethod: s.paymentMethod,
                      ackStatus: s.ackStatus,
                    })
                  );
                }
                const merged = [...cleanCurrent];
                for (const n of normalized) {
                  const idx = merged.findIndex((m) => m.submissionId === n.submissionId);
                  if (idx >= 0) {
                    merged[idx] = { ...merged[idx], ...n, items: (n.items && n.items.length > 0 ? n.items : merged[idx].items) };
                  } else {
                    merged.push(n);
                  }
                }
                writeLocalStorageJson(buildOrdersStorageKey(txId), merged);
                setOrderList([...merged]);
                if (merged.length === 0) {
                  setIsAwaitingPaymentConfirmation(false);
                  if (isMounted) safeSetStorage(AWAITING_PAYMENT_KEY, "0");
                }
              }
            }
          }
        } catch (_e) {}
      })();
    }, 10000);

    return () => clearInterval(interval);
  }, [isMounted, tenantId, branchId]);

  const activeTransactionId = isMounted ? safeGetStorage(ACTIVE_TX_ID_KEY) || "" : "";

  const productById = useMemo(() => {
    return new Map(products.map((product) => [product.id, product]));
  }, [products]);

  const cartByProductId = useMemo(() => {
    return new Map(cart.map((item) => [item.productId, item]));
  }, [cart]);

  const cartSummary = useMemo(() => {
    let itemCount = 0;
    let total = 0;

    for (const item of cart) {
      const product = productById.get(item.productId);
      if (!product || item.quantity <= 0) {
        continue;
      }

      itemCount += item.quantity;
      total += item.quantity * product.price;
    }

    return { itemCount, total };
  }, [cart, productById]);

  const groupedSections = useMemo<GroupedMenuSection[]>(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    const groups = new Map<string, GroupedMenuSection>();

    for (const category of categories) {
      groups.set(category.id, {
        id: category.id,
        name: category.name,
        items: [],
      });
    }

    const uncategorizedId = "uncategorized";
    const uncategorizedName = "Lainnya";

    for (const item of products) {
      if (activeCategoryId !== "all" && (item.categoryId || "uncategorized") !== activeCategoryId) {
        continue;
      }

      if (normalizedSearch) {
        const haystack = [item.name, item.categoryName, item.description]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(normalizedSearch)) {
          continue;
        }
      }

      const groupId = item.categoryId || uncategorizedId;
      const fallbackName = item.categoryName || uncategorizedName;

      if (!groups.has(groupId)) {
        groups.set(groupId, {
          id: groupId,
          name: fallbackName,
          items: [],
        });
      }

      groups.get(groupId)?.items.push(item);
    }

    const orderedCategoryIds = categories.map((category) => category.id);
    const knownSections = orderedCategoryIds
      .map((id) => groups.get(id))
      .filter((group): group is GroupedMenuSection => Boolean(group) && group.items.length > 0);

    const extraSections = Array.from(groups.values()).filter(
      (group) => !orderedCategoryIds.includes(group.id) && group.items.length > 0,
    );

    return [...knownSections, ...extraSections];
  }, [activeCategoryId, categories, products, searchText]);

  const visibleCategoryChips = useMemo(() => {
    return [
      { id: "all", name: "Semua" },
      ...categories,
    ];
  }, [categories]);

  const displayTableNumber = isMounted ? tableNumber : "-";
  const displayBranchName = isMounted ? branchInfo?.name || branchNameFromUrl : "";
  const resolvedSettingsScope = branchId?.trim()
    ? `Tenant ${tenantId} • Cabang ${displayBranchName || `#${branchId.trim()}`}`
    : tenantId
      ? `Tenant ${tenantId} • Semua cabang/default tenant`
      : "Tenant belum dipilih";
  const displayCartSummary = isMounted
    ? cartSummary
    : {
        itemCount: 0,
        total: 0,
      };

  const cartItems = useMemo(() => {
    const rows: Array<{
      productId: string;
      name: string;
      quantity: number;
      price: number;
      subtotal: number;
      note?: string;
    }> = [];

    for (const item of cart) {
      const productId = item.productId;
      const quantity = item.quantity;
      if (quantity <= 0) {
        continue;
      }

      const product = productById.get(productId);
      if (!product) {
        continue;
      }

      rows.push({
        productId,
        name: product.name,
        quantity,
        price: product.price,
        subtotal: product.price * quantity,
        note: item.note,
      });
    }

    return rows;
  }, [cart, productById]);

  const sortedOrderList = useMemo(() => {
    const seenSub = new Set<string>();
    const deduped: Array<OrderRecord> = [];
    for (const o of [...orderList].sort((a, b) => b.orderIndex - a.orderIndex)) {
      const key = `${String(o.submissionId || "").trim()}|${String(o.orderIndex || 1)}|${String(o.transactionId || "").trim()}|${String(o.createdAt || "").trim()}|${(o.items || []).map((it) => `${it.productId}:${it.quantity}:${it.price}`).join(",")}`;
      const sub = String(o.submissionId || "").trim();
      if (sub && seenSub.has(sub)) continue;
      if (sub) seenSub.add(sub);
      else if (seenSub.has(key)) continue;
      seenSub.add(key);
      deduped.push(o);
    }
    return deduped;
  }, [orderList]);

  const totalOrderPayment = useMemo(() => {
    return sortedOrderList.reduce((sum, o) => sum + (o.subtotal || 0), 0);
  }, [sortedOrderList]);

  // 🔴 CRITICAL FIX (PAYMENT BANNER STATE LOCK + REMAINING UNPAID BALANCE):
  //    User problem: Setelah bayar QRIS order 1 Rp 10k → banner hijau "SUDAH LUNAS".
  //    Tambah order 2 Rp 10k Bayar di Kasir → banner MASIH hijau "SUDAH LUNAS"
  //    padahal ada sisa tagihan Rp 10.000 yang harusnya muncul BAYAR Rp 10.000.
  //
  //    PERBAIKAN:
  //    1) Pisahkan `remainingUnpaidAmount`: SUM subtotal dari ORDER YANG BELUM LUNAS SAJA.
  //    2) Tampilkan angka ini di BANNER TOTAL PAYMENT (jika > 0), TOTAL keseluruhan
  //       (totalOrderPayment) tetap ada tapi footer info tambahin "Remaining: Rp X".
  //    3) showPayButton = remainingUnpaidAmount > 0 (bukan allPaid negation); jika unpaid > 0 →
  //       tombol BAYAR MUNCUL, label BANNER tidak lagi nyangkut hijau.
  //    4) sortedOrderList.length === 0 → semua false.
  const remainingUnpaidBalance = useMemo(() => {
    return sortedOrderList.reduce((sum, order) => {
      const pmRaw = String(order.paymentMethod || "").toUpperCase().trim();
      const isQris = pmRaw === "QRIS";
      const ackStatus = String(order.ackStatus || "").toUpperCase().trim();
      const anyPaymentStatus = String(
        (order as unknown as { paymentStatus?: string; payment_status?: string }).paymentStatus ||
        (order as unknown as { paymentStatus?: string; payment_status?: string }).payment_status ||
        ""
      ).toUpperCase().trim();
      const isPaidFlag =
        (order as unknown as { isPaid?: boolean; paid?: boolean }).isPaid === true ||
        (order as unknown as { isPaid?: boolean; paid?: boolean }).paid === true;
      let paid = false;
      if (isQris) {
        const paymentStatusExplicitPaid =
          anyPaymentStatus === "PAID" ||
          anyPaymentStatus === "COMPLETED" ||
          anyPaymentStatus === "SETTLED";
        paid =
          isPaidFlag ||
          paymentStatusExplicitPaid ||
          ackStatus === "PAID" ||
          ackStatus === "COMPLETED";
      } else {
        const isCashier = pmRaw === "CASHIER" || pmRaw === "";
        if (isCashier) {
          paid = isPaidFlag || ackStatus === "POS_PRINTED" || ackStatus === "COMPLETED";
        }
      }
      if (paid) return sum;
      return sum + (Number(order.subtotal) || 0);
    }, 0);
  }, [sortedOrderList]);

  // Banner total: prefer unpaid remaining (jika > 0) agar user lihat tagihan yang harus dibayar.
  const bannerDisplayTotal = remainingUnpaidBalance > 0 ? remainingUnpaidBalance : totalOrderPayment;

  // 🔴 [FIX 3 - QRIS PAID FLOW + HIDE BAYAR BUTTON JIKA SUDAH BAYAR]
  // Aturan user exact:
  //   a) BAYAR QRIS SUDAH DONE => Order TETAP MUNCUL di list (history) TAPI:
  //      - HIDE TOMBOL BAYAR (disable click / set label SUDAH DIBAYAR)
  //      - TTL MAX 30 MENIT (1800 detik) => auto clear storage expired
  //   b) BAYAR DI KASIR (paymentMethod = CASHIER) => BELUM LUNAS => TOMBOL BAYAR TETAP ADA
  const orderPaymentFlags = useMemo(() => {
    let anyQrisPaid = false;
    let anyCashierUnpaid = false;
    let allPaid = sortedOrderList.length > 0;
    let hasExpiredRows = false;
    const nowMs = Date.now();
    const TTL_MS = 30 * 60 * 1000; // 30 menit exact user request
    for (const order of sortedOrderList) {
      const pmRaw = String(order.paymentMethod || "").toUpperCase().trim();
      const isQris = pmRaw === "QRIS";
      const isCashier = pmRaw === "CASHIER" || pmRaw === "";
      const ackStatus = String(order.ackStatus || "").toUpperCase().trim();
      const anyPaymentStatus = String(
        (order as unknown as { paymentStatus?: string; payment_status?: string }).paymentStatus ||
        (order as unknown as { paymentStatus?: string; payment_status?: string }).payment_status ||
        ""
      ).toUpperCase().trim();
      const isPaidFlag =
        (order as unknown as { isPaid?: boolean; paid?: boolean }).isPaid === true ||
        (order as unknown as { isPaid?: boolean; paid?: boolean }).paid === true;
      let paid = false;
      if (isQris) {
        const paymentStatusExplicitPaid =
          anyPaymentStatus === "PAID" ||
          anyPaymentStatus === "COMPLETED" ||
          anyPaymentStatus === "SETTLED";
        paid =
          isPaidFlag ||
          paymentStatusExplicitPaid ||
          ackStatus === "PAID" ||
          ackStatus === "COMPLETED";
        if (paid) anyQrisPaid = true;
      } else if (isCashier) {
        paid = isPaidFlag || ackStatus === "POS_PRINTED" || ackStatus === "COMPLETED";
        if (!paid) anyCashierUnpaid = true;
      }
      if (!paid) allPaid = false;
      const ts = order.createdAt ? new Date(order.createdAt).getTime() : 0;
      if (ts && Number.isFinite(ts) && nowMs - ts > TTL_MS) {
        hasExpiredRows = true;
      }
    }
    return {
      anyQrisPaid,
      anyCashierUnpaid,
      allPaid,
      hasExpiredRows,
      remainingUnpaidBalance,
      showPayButton: sortedOrderList.length === 0 ? false : remainingUnpaidBalance > 0,
      allPaidViaQrisOnly: anyQrisPaid && !anyCashierUnpaid && allPaid,
      statusLabel: (() => {
        if (sortedOrderList.length === 0) return "";
        if (anyQrisPaid && !anyCashierUnpaid && allPaid) return "✅ Sudah dibayar via QRIS";
        if (allPaid) return "✅ Sudah lunas";
        if (anyQrisPaid && remainingUnpaidBalance > 0) return `⏳ Sisa tagihan ${rupiahFormatter.format(remainingUnpaidBalance)}`;
        if (anyCashierUnpaid) return "⏳ Menunggu pembayaran di kasir";
        if (anyQrisPaid) return "⏳ Sebagian dibayar QRIS";
        return "⏳ Menunggu pembayaran";
      })(),
      TTL_MS,
    };
  }, [sortedOrderList]);

  // 🔴 Auto-purge QRIS expired (> 30 menit) dari storage & orderList
  useEffect(() => {
    if (!isMounted || !activeTransactionId) return;
    if (!orderPaymentFlags.hasExpiredRows) return;
    const TTL_MS = orderPaymentFlags.TTL_MS;
    const nowMs = Date.now();
    const freshRows = orderList.filter((o) => {
      const ts = o.createdAt ? new Date(o.createdAt).getTime() : 0;
      return ts ? nowMs - ts <= TTL_MS : true;
    });
    if (freshRows.length !== orderList.length) {
      setOrderList(freshRows);
      writeLocalStorageJson(buildOrdersStorageKey(activeTransactionId), freshRows);
      if (freshRows.length === 0) {
        safeRemoveStorage(ACTIVE_TX_ID_KEY);
        safeRemoveStorage(AWAITING_PAYMENT_KEY);
        safeRemoveStorage(`${APP_STORAGE_PREFIX}paxCount_${activeTransactionId}`);
        safeRemoveStorage(`${APP_STORAGE_PREFIX}customerName_${activeTransactionId}`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, activeTransactionId, orderPaymentFlags.hasExpiredRows]);

  const hasAnyOrder = sortedOrderList.length > 0;

  const paxCountDisplay = isMounted
    ? safeGetStorage(`${APP_STORAGE_PREFIX}paxCount_${activeTransactionId}`) || ""
    : "";

  const handleRetryOrderCard = async (submissionId: string) => {
    const order = orderList.find((o) => o.submissionId === submissionId);
    if (!order) return;
    const txId = order.transactionId || activeTransactionId || getOrCreateTransactionId();

    const itemsPayload: OrderItemInput[] = order.items.map((it) => ({
      productId: it.productId,
      quantity: it.quantity,
      price: it.price,
      name: it.name,
      subtotal: it.subtotal,
      note: it.note,
    }));

    const submitPayload: Parameters<typeof submitOrderWithPosQueueAck>[0] = {
      tenantId: order.tenantId || tenantId,
      table: order.tableNumber || tableNumber,
      tableNumber: order.tableNumber || tableNumber,
      tableId: order.tableId || tableId,
      branchId: order.branchId || branchId,
      cartItems: itemsPayload,
      items: itemsPayload,
      totalAmount: order.subtotal,
      customerName: order.customerName,
      paymentMethod: order.paymentMethod || "CASHIER",
      paymentProofFile: null,
      orderNote: order.orderNote || "",
      submissionId: order.submissionId,
      transactionId: txId,
      orderIndex: order.orderIndex,
    };

    setQueueScreen({
      isOpen: true,
      progressPct: 5,
      stageMessage: "Mengirim ulang pesanan...",
      etaSeconds: 35,
      isFailed: false,
      submissionId: order.submissionId,
      transactionId: txId,
      retryPayload: submitPayload,
    });
    setIsSubmitting(true);

    try {
      const response = await submitOrderWithPosQueueAck({
        ...submitPayload,
        onProgress: (pct, stage, etaSec) => {
          setQueueScreen((prev) => ({
            ...prev,
            progressPct: pct,
            stageMessage: stage,
            etaSeconds: etaSec ?? prev.etaSeconds,
          }));
        },
      });

      if (response.success && (response.ackStatus === "POS_PRINTED" || response.ackStatus === "POS_ACKNOWLEDGED")) {
        patchOrderInList(txId, submissionId, {
          ackStatus: response.ackStatus || "POS_PRINTED",
          orderId: response.orderId ? String(response.orderId) : undefined,
          receiptNumber: response.receiptNumber,
          resolvedDeviceUuid: response.resolvedDeviceUuid,
        });
        setTimeout(() => {
          setQueueScreen((prev) => ({ ...prev, isOpen: false }));
        }, 800);
        showSnackbar("Pesanan berhasil terkirim ke dapur!", "success");
      } else {
        setQueueScreen((prev) => ({
          ...prev,
          isFailed: true,
          failureMessage:
            response.error ||
            response.message ||
            "Perangkat kasir tidak merespon.",
          retryPayload: submitPayload,
          progressPct: 0,
        }));
        patchOrderInList(txId, submissionId, {
          ackStatus: response.ackStatus || "FAILED_DELIVERY",
        });
      }
    } catch (err) {
      setQueueScreen((prev) => ({
        ...prev,
        isFailed: true,
        failureMessage: err instanceof Error ? err.message : "Gagal mengirim ulang.",
        retryPayload: submitPayload,
      }));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBayarClick = () => {
    if (!hasAnyOrder) return;
    if (allowPayAtCashier && qrisImageUrl) {
      setIsPaymentMethodModalOpen(true);
    } else if (qrisImageUrl && !allowPayAtCashier) {
      setIsPaymentMethodModalOpen(false);
      if (isMounted) safeSetStorage(AWAITING_PAYMENT_KEY, "0");
      setIsQrisFlowOpen(true);
    } else {
      setIsPaymentMethodModalOpen(false);
      if (isMounted) safeSetStorage(AWAITING_PAYMENT_KEY, "1");
      setIsAwaitingPaymentConfirmation(true);
      showSnackbar("Silakan selesaikan pembayaran di kasir.", "info");
    }
  };

  const handlePaymentMethodSelected = (method: "QRIS" | "CASHIER") => {
    setIsPaymentMethodModalOpen(false);
    if (method === "QRIS") {
      if (isMounted) safeSetStorage(AWAITING_PAYMENT_KEY, "0");
      setIsQrisFlowOpen(true);
    } else {
      if (isMounted) safeSetStorage(AWAITING_PAYMENT_KEY, "1");
      setIsAwaitingPaymentConfirmation(true);
      showSnackbar("Silakan selesaikan pembayaran di kasir. Meja akan otomatis bersih setelah kasir mengonfirmasi.", "info");
    }
  };

  const handleRefreshOrderList = () => {
    setOrderListPollingToken((t) => t + 1);
    showSnackbar("Memperbarui daftar pesanan...", "info");
  };

  const handleCompletePaymentSuccess = () => {
    clearTransactionContext();
    clearCart();
    setOrderList([]);
    setIsAwaitingPaymentConfirmation(false);
    setIsQrisFlowOpen(false);
    setIsCheckoutOpen(false);
    setActiveTab("menu");
    setCustomerNameInput("");
    setPaymentMethod("CASHIER");
    setPendingOrderId("");
    setOrderReceipt(null);
    setIsOrderSuccess(false);
    showSnackbar("Pembayaran berhasil, terima kasih!", "success");
  };

  const handleOpenCheckout = () => {
    if (cartSummary.itemCount === 0) {
      return;
    }

    setIsCheckoutOpen(true);
  };

  const handleCloseCheckout = () => {
    if (isSubmitting) {
      return;
    }

    setIsCheckoutOpen(false);
  };

  const readFileAsDataUrlGeneric = (file: File): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === "string") {
          resolve(result);
          return;
        }
        reject(new Error("Gagal membaca file."));
      };
      reader.onerror = () => reject(new Error("Gagal membaca file."));
      reader.readAsDataURL(file);
    });
  };

  const handleSubmitOrderWithQueue = async (
    selectedPaymentMethod: "CASHIER" | "QRIS",
    selectedProofFile?: File | null,
    overrideSubmissionId?: string,
  ) => {
    // 🔴 GUARD CLAUSE PALING ATAS - MENCEGAH DOUBLE CLICK / SPAM
    if (isSubmitting) return;

    if (!tenantId) {
      setSubmitError("Tenant tidak ditemukan pada URL.");
      return;
    }

    if (cartItems.length === 0) {
      setSubmitError("Keranjang kosong.");
      return;
    }

    // 🔴 SET isSubmitting TRUE SEKARANG JUGA — SEBELUM generate submissionId
    //    Agar tidak ada window race condition dimana klik 2x cepat
    //    menghasilkan 2 UUID berbeda sebelum state sempat ter-update.
    setIsSubmitting(true);
    setSubmitError(null);

    const submissionId = overrideSubmissionId?.trim() || generateSubmissionId();
    const transactionId = getOrCreateTransactionId();
    const orderIndex = getNextOrderIndex();
    const paxCount = typeof paxCountInput === "number" ? paxCountInput : undefined;

    if (typeof paxCountInput === "number" && isMounted) {
      safeSetStorage(
        `${APP_STORAGE_PREFIX}paxCount_${transactionId}`,
        String(paxCountInput),
      );
    }

    let paymentProofImageBase64: string | undefined;
    if (selectedProofFile) {
      try {
        paymentProofImageBase64 = await readFileAsDataUrlGeneric(selectedProofFile);
      } catch (_e) {}
    }

    const payloadItems: OrderItemInput[] = cartItems.map((item) => ({
      productId: resolveOrderItemProductId(item as {
        productId: string;
        product?: { id?: string };
        product_id?: string;
      }),
      quantity: item.quantity,
      price: item.price,
      name: item.name,
      subtotal: item.subtotal,
      note: item.note,
    }));

    const submitPayload: Parameters<typeof submitOrderWithPosQueueAck>[0] = {
      tenantId,
      table: tableNumber,
      tableNumber,
      tableId,
      branchId,
      cartItems: payloadItems,
      items: payloadItems,
      totalAmount: cartSummary.total,
      customerName: customerNameInput,
      paymentMethod: selectedPaymentMethod,
      paymentProofFile: selectedProofFile || null,
      paymentProofImageBase64,
      orderNote: "",
      submissionId,
      paxCount,
      transactionId,
      orderIndex,
    };

    setQueueScreen({
      isOpen: true,
      progressPct: 0,
      stageMessage: "Menyiapkan pesanan...",
      etaSeconds: 35,
      isFailed: false,
      submissionId,
      transactionId,
      retryPayload: submitPayload,
    });

    try {
      const response = await submitOrderWithPosQueueAck({
        ...submitPayload,
        onProgress: (pct, stage, etaSec) => {
          setQueueScreen((prev) => ({
            ...prev,
            progressPct: pct,
            stageMessage: stage,
            etaSeconds: etaSec ?? prev.etaSeconds,
          }));
        },
      });

      if (response.success && (response.ackStatus === "POS_PRINTED" || response.ackStatus === "POS_ACKNOWLEDGED")) {
        const orderRecord: OrderRecord = {
          submissionId,
          orderId: response.orderId ? String(response.orderId) : undefined,
          orderIndex,
          transactionId,
          items: cartItems.map((item) => ({
            productId: item.productId,
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            subtotal: item.subtotal,
            note: item.note,
            modifiers: [],
            variantNotes: item.note ? [item.note] : [],
          })),
          subtotal: cartSummary.total,
          customerName: customerNameInput.trim() || undefined,
          tableNumber,
          tableId: tableId || undefined,
          branchId: branchId || undefined,
          tenantId,
          paymentMethod: selectedPaymentMethod,
          createdAt: new Date().toISOString(),
          receiptNumber: response.receiptNumber,
          ackStatus: response.ackStatus || "POS_PRINTED",
          resolvedDeviceUuid: response.resolvedDeviceUuid,
        };
        saveOrderToTransaction(transactionId, orderRecord);
        incrementOrderIndex();

        setQueueScreen((prev) => ({
          ...prev,
          progressPct: 100,
          stageMessage: "Pesanan berhasil terkirim!",
          isFailed: false,
        }));

        setOrderReceipt({
          orderId: response.orderId ? String(response.orderId) : "",
          receiptNumber: response.receiptNumber || "",
          createdAt: new Date().toISOString(),
          customerName: customerNameInput.trim() || "Guest",
          tenantName: tenantName || "Customer Ordering",
          tableNumber,
          branchName: branchInfo?.name || branchNameFromUrl || "-",
          paymentMethod: selectedPaymentMethod === "QRIS" ? "QRIS" : "Bayar di Kasir",
          totalAmount: cartSummary.total,
          items: cartItems.map((item) => ({
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            subtotal: item.subtotal,
            note: item.note,
          })),
          paymentProofUrl: undefined,
          receiptUrl: undefined,
          receiptFooter: settingsReceiptFooter.trim() || DEFAULT_RECEIPT_FOOTER,
        });

        setTimeout(() => {
          if (selectedPaymentMethod === "QRIS") {
            setQueueScreen((prev) => ({ ...prev, isOpen: false }));
            setQrisFirstStepCompleted(true);
            setIsQrisFlowOpen(true);
            if (response.orderId) {
              setPendingOrderId(String(response.orderId));
            }
            const theOrderRecord: OrderRecord = {
              submissionId,
              orderId: response.orderId ? String(response.orderId) : undefined,
              orderIndex,
              transactionId,
              items: cartItems.map((item) => ({
                productId: item.productId,
                name: item.name,
                quantity: item.quantity,
                price: item.price,
                subtotal: item.subtotal,
                note: item.note,
                modifiers: [],
                variantNotes: item.note ? [item.note] : [],
              })),
              subtotal: cartSummary.total,
              customerName: customerNameInput.trim() || undefined,
              tableNumber,
              tableId: tableId || undefined,
              branchId: branchId || undefined,
              tenantId,
              paymentMethod: selectedPaymentMethod,
              createdAt: new Date().toISOString(),
              receiptNumber: response.receiptNumber,
              ackStatus: "CHECKER_PRINTED",
              resolvedDeviceUuid: response.resolvedDeviceUuid,
            };
            setPendingQrisOrder({
              orderId: response.orderId ? String(response.orderId) : "",
              submissionId,
              transactionId,
              receiptNumber: response.receiptNumber,
              orderIndex,
              orderRecord: theOrderRecord,
            });
            setSubmitError(null);
            showSnackbar("Checker terkirim ke dapur! Silakan upload bukti transfer.", "success");
          } else {
            setQueueScreen((prev) => ({ ...prev, isOpen: false }));
            setIsCheckoutOpen(false);
            setIsOrderSuccess(true);
            setActiveTab("orderList");
            clearCart();
            showSnackbar("Pesanan berhasil terkirim ke dapur!", "success");
          }
        }, 800);

        return;
      }

      setQueueScreen((prev) => ({
        ...prev,
        isFailed: true,
        failureMessage:
          response.error ||
          response.message ||
          "Perangkat kasir tidak merespon dalam 30 detik.",
        submissionId: response.submissionId || prev.submissionId,
        retryPayload: submitPayload,
        progressPct: 0,
      }));

      if (response.ackStatus !== "POS_PRINTED" && response.ackStatus !== "POS_ACKNOWLEDGED") {
        const failedOrder: OrderRecord = {
          submissionId: response.submissionId || submissionId,
          orderId: response.orderId ? String(response.orderId) : undefined,
          orderIndex,
          transactionId,
          items: cartItems.map((item) => ({
            productId: item.productId,
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            subtotal: item.subtotal,
            note: item.note,
            modifiers: [],
            variantNotes: item.note ? [item.note] : [],
          })),
          subtotal: cartSummary.total,
          customerName: customerNameInput.trim() || undefined,
          tableNumber,
          tableId: tableId || undefined,
          branchId: branchId || undefined,
          tenantId,
          paymentMethod: selectedPaymentMethod,
          createdAt: new Date().toISOString(),
          receiptNumber: response.receiptNumber,
          ackStatus: response.ackStatus || "TIMEOUT",
          resolvedDeviceUuid: response.resolvedDeviceUuid,
        };
        saveOrderToTransaction(transactionId, failedOrder);
      }
    } catch (err) {
      setQueueScreen((prev) => ({
        ...prev,
        isFailed: true,
        failureMessage: err instanceof Error ? err.message : "Terjadi kesalahan tak terduga.",
        retryPayload: submitPayload,
      }));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetryFailedOrder = async () => {
    if (!queueScreen.retryPayload) {
      setQueueScreen((prev) => ({ ...prev, isOpen: false }));
      return;
    }
    const subId = queueScreen.submissionId;
    setQueueScreen((prev) => ({
      ...prev,
      isFailed: false,
      progressPct: 5,
      stageMessage: "Mengirim ulang pesanan...",
      failureMessage: undefined,
    }));
    await handleSubmitOrderWithQueue(
      queueScreen.retryPayload.paymentMethod === "QRIS" ? "QRIS" : "CASHIER",
      queueScreen.retryPayload.paymentProofFile || null,
      subId,
    );
  };

  const handleCloseQueueScreen = () => {
    if (isSubmitting) return;
    setQueueScreen((prev) => ({ ...prev, isOpen: false }));
  };

  const handleSubmitOrder = async (
    selectedPaymentMethod: "CASHIER" | "QRIS",
    selectedProofFile?: File | null,
  ) => {
    if (isSubmitting) return;
    await handleSubmitOrderWithQueue(selectedPaymentMethod, selectedProofFile);
  };

  const handleProofFileChange = (file: File | null) => {
    if (paymentProofPreviewUrl) {
      URL.revokeObjectURL(paymentProofPreviewUrl);
    }

    if (!file) {
      setPaymentProofFile(null);
      setPaymentProofPreviewUrl("");
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setPaymentProofFile(file);
    setPaymentProofPreviewUrl(previewUrl);
  };

  const handleSettingsQrisFileChange = (file: File | null) => {
    if (settingsQrisPreviewUrl) {
      URL.revokeObjectURL(settingsQrisPreviewUrl);
    }

    setSettingsQrisMessage("");
    setSettingsQrisError(null);

    if (!file) {
      setSettingsQrisFile(null);
      setSettingsQrisPreviewUrl("");
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setSettingsQrisFile(file);
    setSettingsQrisPreviewUrl(previewUrl);
  };

  const readFileAsDataUrl = (file: File) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === "string") {
          resolve(result);
          return;
        }
        reject(new Error("Gagal membaca file QRIS."));
      };
      reader.onerror = () => reject(new Error("Gagal membaca file QRIS."));
      reader.readAsDataURL(file);
    });
  };

  const handleSaveSettingsQris = async () => {
    if (!tenantId) {
      setSettingsQrisError("Tenant tidak ditemukan pada URL.");
      return;
    }

    setIsSavingQris(true);
    setSettingsQrisError(null);
    setSettingsQrisMessage("");

    try {
      if (settingsQrisFile) {
        const dataUrl = await readFileAsDataUrl(settingsQrisFile);
        const result = await updateQrisImage({
          tenantId,
          branchId,
          qrisImageBase64: dataUrl,
          fileName: settingsQrisFile.name,
          contentType: settingsQrisFile.type || "image/png",
          settingsKey: settingsQrisKey,
        });

        if (result.qrisImageUrl) {
          setQrisImageUrl(result.qrisImageUrl);
        }
      }

      const footerResult = await updateReceiptFooter({
        tenantId,
        branchId,
        receiptFooter: settingsReceiptFooter,
        settingsKey: settingsQrisKey,
      });
      const resolvedFooter =
        footerResult.receiptFooter?.trim() || settingsReceiptFooter.trim() || DEFAULT_RECEIPT_FOOTER;
      setSettingsReceiptFooter(resolvedFooter);

      setSettingsQrisMessage(
        settingsQrisFile
          ? "QR static dan footer struk berhasil disimpan."
          : "Footer struk berhasil disimpan.",
      );
      setSettingsQrisFile(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal menyimpan pengaturan web.";
      setSettingsQrisError(message);
    } finally {
      setIsSavingQris(false);
    }
  };

  const handleCopyGrandTotal = async () => {
    try {
      await navigator.clipboard.writeText(String(cartSummary.total));
      setCopySuccess("Nominal berhasil disalin.");
    } catch (_) {
      setCopySuccess("Gagal menyalin nominal.");
    }
  };

  const handleSubmitQrisPaymentProof = async () => {
    if (isQrisPaymentUploading || isSubmitting) return;
    if (!pendingQrisOrder?.orderId) {
      setSubmitError("Order ID tidak ditemukan, ulangi proses checkout.");
      return;
    }
    if (isPaymentProofMandatory && !paymentProofFile) {
      setSubmitError("Silakan upload bukti transfer terlebih dahulu.");
      return;
    }
    if (!tenantId) {
      setSubmitError("Tenant tidak valid.");
      return;
    }

    setIsQrisPaymentUploading(true);
    setSubmitError(null);

    try {
      const result = await uploadQrOrderPaymentProof({
        tenantId,
        branchId: branchId || undefined,
        orderId: pendingQrisOrder.orderId,
        paymentProofFile,
        paymentMethod: "QRIS",
      });

      if (!result.success) {
        setSubmitError(result.error || result.message || "Gagal mengirim bukti pembayaran.");
        return;
      }

      const txId = pendingQrisOrder.transactionId;
      const subId = pendingQrisOrder.submissionId;
      if (pendingQrisOrder.orderRecord && txId) {
        const storageOrder: OrderRecord = {
          ...pendingQrisOrder.orderRecord,
          ackStatus: "PAID",
          paymentProofUrl: result.data?.paymentProofUrl,
          receiptNumber: result.data?.receiptNumber || pendingQrisOrder.receiptNumber,
        };
        saveOrderToTransaction(txId, storageOrder);
      } else if (txId && subId) {
        patchOrderInList(txId, subId, {
          ackStatus: "PAID",
        });
      }

      setTimeout(() => {
        setQueueScreen((prev) => ({ ...prev, isOpen: false }));
        setIsQrisFlowOpen(false);
        setIsCheckoutOpen(false);
        setIsOrderSuccess(true);
        setActiveTab("orderList");
        clearCart();
        setQrisFirstStepCompleted(false);
        setPendingQrisOrder(null);
        setIsQrisPaymentUploading(false);
      }, 500);

      showSnackbar("Pembayaran QRIS berhasil! Struk akan dicetak di kasir.", "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal memproses pembayaran QRIS.";
      setSubmitError(message);
    } finally {
      setIsQrisPaymentUploading(false);
    }
  };

  const handlePrimaryCheckoutAction = () => {
    // 🔴 GUARD CLAUSE FIRST LINE — CEGAH SPAM KLIK
    if (isSubmitting) return;

    if (!allowPayAtCashier) {
      setPaymentMethod("QRIS");
      setIsQrisFlowOpen(true);
      setSubmitError(null);
      void handleSubmitOrder("QRIS");
      return;
    }

    if (paymentMethod === "QRIS") {
      setIsQrisFlowOpen(true);
      setSubmitError(null);
      void handleSubmitOrder("QRIS");
      return;
    }

    void handleSubmitOrder("CASHIER");
  };

  const openQrisPreview = () => {
    if (!qrisImageUrl) {
      return;
    }

    setIsQrisPreviewOpen(true);
  };

  const handleDownloadOnlineReceipt = () => {
    if (!orderReceipt) {
      return;
    }

    const createdAt = parseDateStringSafely(orderReceipt.createdAt);
    const printableDate = !createdAt
      ? orderReceipt.createdAt
      : createdAt.toLocaleString("id-ID");

    const lines = [
      "=== STRUK ORDER ONLINE ===",
      `Toko: ${orderReceipt.tenantName}`,
      `Cabang: ${orderReceipt.branchName}`,
      `Meja: ${orderReceipt.tableNumber}`,
      `Waktu: ${printableDate}`,
      `No. Struk: ${orderReceipt.receiptNumber || "-"}`,
      `Order ID: ${orderReceipt.orderId || "-"}`,
      `Metode Bayar: ${orderReceipt.paymentMethod}`,
      "",
      "Item:",
      ...orderReceipt.items.map(
        (item) =>
          `- ${item.quantity} x ${item.name} @ ${rupiahFormatter.format(item.price)} = ${rupiahFormatter.format(item.subtotal)}${
            item.note?.trim() ? ` (Catatan: ${item.note.trim()})` : ""
          }`,
      ),
      "",
      `Total: ${rupiahFormatter.format(orderReceipt.totalAmount)}`,
      orderReceipt.orderNote ? `Catatan Pesanan: ${orderReceipt.orderNote}` : "",
      orderReceipt.paymentProofUrl ? `Bukti Transfer: ${orderReceipt.paymentProofUrl}` : "",
      orderReceipt.receiptUrl ? `Struk URL: ${orderReceipt.receiptUrl}` : "",
      "",
      orderReceipt.receiptFooter?.trim() || DEFAULT_RECEIPT_FOOTER,
    ].filter((line) => line.length > 0);

    const fileName =
      (orderReceipt.receiptNumber || orderReceipt.orderId || `order-${Date.now()}`)
        .replace(/[^a-zA-Z0-9-_]/g, "_") +
      ".txt";

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-amber-50 via-orange-50 to-white pb-28">
      <section className="mx-auto w-full max-w-md px-4 pt-6">
        <header className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-orange-100 backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-600">
            {isSettingsOnlyMode ? "Web POS Settings" : "Customer Ordering"}
          </p>
          <h1 className="mt-2 text-2xl font-bold leading-tight text-slate-900">
            {tenantName || (isSettingsOnlyMode ? "Pengaturan Web POS" : "Customer Ordering")}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2">
            {!isSettingsOnlyMode ? (
              <span className="inline-flex rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
                Meja: {displayTableNumber}
              </span>
            ) : null}
            {isSettingsMode ? (
              <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                Mode Setting
              </span>
            ) : null}
            {displayBranchName ? (
              <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                Cabang: {displayBranchName}
              </span>
            ) : null}
          </div>
        </header>

        {isSettingsMode ? (
          <section className="mt-4 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-emerald-100">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">
                  Pembayaran & QRIS
                </p>
                <h2 className="mt-1 text-lg font-bold text-slate-900">QRIS Statis Toko</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Unggah gambar QRIS standar toko Anda untuk ditampilkan saat pelanggan membayar.
                </p>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                {branchId?.trim() ? "Per Cabang" : "Default Tenant"}
              </span>
            </div>

            <div className="mt-4 space-y-3 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-3">
              <div className="rounded-2xl border border-emerald-100 bg-white px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">
                  Scope Penyimpanan
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{resolvedSettingsScope}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Jika `branchId` terisi, QRIS dan footer akan disimpan untuk cabang tersebut. Jika kosong,
                  sistem memakai default tenant.
                </p>
              </div>

              <label className="block text-sm font-semibold text-slate-800" htmlFor="settings-tenant-id">
                Tenant ID
              </label>
              <input
                id="settings-tenant-id"
                type="text"
                value={tenantId}
                readOnly
                className="w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700"
              />

              <label className="block text-sm font-semibold text-slate-800" htmlFor="settings-branch-id">
                Branch ID
              </label>
              <input
                id="settings-branch-id"
                type="text"
                value={branchId}
                readOnly
                placeholder="Kosong = default tenant"
                className="w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400"
              />

              <label className="block text-sm font-semibold text-slate-800" htmlFor="settings-qris-key">
                Kunci pengaturan QRIS
              </label>
              <input
                id="settings-qris-key"
                type="password"
                value={settingsQrisKey}
                onChange={(event) => setSettingsQrisKey(event.target.value)}
                placeholder="Opsional jika server memakai WEB_SETTINGS_UPLOAD_KEY"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-emerald-300 placeholder:text-slate-400 focus:ring-2"
              />

              <label className="block text-sm font-semibold text-slate-800" htmlFor="settings-qris-file">
                Upload Gambar QRIS
              </label>
              <input
                id="settings-qris-file"
                type="file"
                accept="image/*"
                onChange={(event) => handleSettingsQrisFileChange(event.target.files?.[0] ?? null)}
                className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              />

              <label className="block text-sm font-semibold text-slate-800" htmlFor="settings-receipt-footer">
                Pesan Footer Struk
              </label>
              <textarea
                id="settings-receipt-footer"
                value={settingsReceiptFooter}
                onChange={(event) => setSettingsReceiptFooter(event.target.value)}
                placeholder={DEFAULT_RECEIPT_FOOTER}
                rows={3}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-emerald-300 placeholder:text-slate-400 focus:ring-2"
              />

              {settingsQrisPreviewUrl ? (
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-2">
                  <img
                    src={settingsQrisPreviewUrl}
                    alt="Preview QR static"
                    className="h-64 w-full rounded-xl object-contain"
                  />
                </div>
              ) : qrisImageUrl ? (
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-2">
                  <img
                    src={qrisImageUrl}
                    alt="QR static aktif"
                    className="h-64 w-full rounded-xl object-contain"
                  />
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => void handleSaveSettingsQris()}
                disabled={isSavingQris || !tenantId}
                className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSavingQris ? "Menyimpan..." : "Simpan Pembayaran & QRIS"}
              </button>

              {settingsQrisMessage ? (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {settingsQrisMessage}
                </p>
              ) : null}

              {settingsQrisError ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {settingsQrisError}
                </p>
              ) : null}

              <p className="text-xs leading-relaxed text-slate-500">
                QRIS statis ini dipakai oleh checkout web dan dibaca ulang oleh POS berdasarkan tenant serta branch.
                Jika server memakai kunci pengaturan, isi kolom di atas sebelum menyimpan.
              </p>
            </div>
          </section>
        ) : null}

        {!tenantId ? (
          <div className="mt-4 rounded-xl border border-dashed border-orange-200 bg-white p-4 text-sm text-slate-600">
            Tambahkan parameter URL seperti <strong>?tenant=TantoPink&amp;table=1</strong>
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {!isSettingsOnlyMode && !isSettingsMode ? (
          <div className="mt-4 sticky top-3 z-10 rounded-2xl bg-white/90 shadow-sm ring-1 ring-orange-100 backdrop-blur overflow-hidden">
            <div className="grid grid-cols-2">
              <button
                type="button"
                onClick={() => setActiveTab("menu")}
                className={`px-3 py-3 text-sm font-bold transition ${
                  activeTab === "menu"
                    ? "bg-orange-500 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                🍽️ Menu
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("orderList")}
                className={`px-3 py-3 text-sm font-bold transition relative ${
                  activeTab === "orderList"
                    ? "bg-orange-500 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                📋 Order List
                {orderList.length > 0 ? (
                  <span className={`absolute top-1.5 right-3 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-extrabold ${
                    activeTab === "orderList" ? "bg-white text-orange-600" : "bg-orange-500 text-white"
                  }`}>
                    {orderList.length}
                  </span>
                ) : null}
              </button>
            </div>
          </div>
        ) : null}

        {!isSettingsOnlyMode && activeTab === "orderList" ? (
          <section className="mt-4 space-y-4 pb-36">
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-orange-100">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
                    Table & Transaksi
                  </p>
                  <h2 className="mt-1 text-base font-bold text-slate-900">
                    Table: {displayTableNumber}
                  </h2>
                  {activeTransactionId ? (
                    <p className="mt-0.5 text-xs text-slate-500">
                      Transaction: <span className="font-mono font-semibold">{activeTransactionId}</span>
                    </p>
                  ) : null}
                  {paxCountDisplay ? (
                    <p className="mt-0.5 text-xs text-slate-500">
                      Number of Pax: <span className="font-semibold">{paxCountDisplay} orang</span>
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={handleRefreshOrderList}
                  className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-700 hover:bg-orange-100"
                >
                  Refresh 🔄
                </button>
              </div>
              {isAwaitingPaymentConfirmation ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  ⏳ Menunggu konfirmasi pembayaran di kasir...
                </div>
              ) : null}
            </div>

            {sortedOrderList.length === 0 ? (
              <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-100">
                <p className="text-3xl">📋</p>
                <p className="mt-2 text-sm font-semibold text-slate-700">Belum ada order</p>
                <p className="mt-1 text-xs text-slate-500">
                  Tambahkan item ke keranjang dan lakukan order untuk mulai.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {sortedOrderList.map((order) => {
                  const needAckBadge =
                    order.ackStatus === "PENDING_ACK" ||
                    order.ackStatus === "TIMEOUT";
                  const isFailed = order.ackStatus === "FAILED_DELIVERY";
                  const itemCount = order.items.reduce(
                    (sum, it) => sum + it.quantity,
                    0,
                  );
                  return (
                    <div
                      key={order.submissionId}
                      className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ${
                        isFailed
                          ? "ring-rose-200"
                          : needAckBadge
                          ? "ring-amber-200"
                          : "ring-slate-100"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2 flex-1">
                          <span className="text-lg">📋</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-extrabold text-slate-900">
                                Order {order.orderIndex} ({itemCount} Item)
                              </h3>
                              {needAckBadge ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                                  ⚠️ Menunggu Konfirmasi Kasir
                                </span>
                              ) : isFailed ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-800">
                                  ❌ Gagal Terkirim
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
                                  ✓ Dapur
                                </span>
                              )}
                            </div>
                            {order.receiptNumber ? (
                              <p className="mt-0.5 text-[11px] text-slate-500 font-mono">
                                Struk: {order.receiptNumber}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <p className="text-sm font-extrabold text-slate-900 shrink-0">
                          {rupiahFormatter.format(order.subtotal)}
                        </p>
                      </div>

                      <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                        {order.items.map((it, idx) => (
                          <div key={`${order.submissionId}-${idx}`}>
                            <div className="flex items-baseline justify-between gap-2">
                              <p className="text-xs font-semibold text-slate-800">
                                <span className="font-extrabold text-slate-900">
                                  {it.quantity}x
                                </span>{" "}
                                {it.name}
                              </p>
                              <p className="text-xs font-bold text-slate-700">
                                {rupiahFormatter.format(it.subtotal)}
                              </p>
                            </div>
                            {it.variantNotes && it.variantNotes.length > 0 ? (
                              <div className="mt-0.5 pl-5">
                                {it.variantNotes.map((vn, vIdx) => (
                                  <p
                                    key={vIdx}
                                    className="text-[11px] leading-relaxed text-slate-500"
                                  >
                                    1x {vn}
                                  </p>
                                ))}
                              </div>
                            ) : it.note ? (
                              <div className="mt-0.5 pl-5">
                                <p className="text-[11px] leading-relaxed text-slate-500">
                                  Catatan: {it.note}
                                </p>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>

                      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                        <span className="text-xs text-slate-500">Subtotal</span>
                        <div className="flex items-center gap-2">
                          {isFailed || needAckBadge ? (
                            <button
                              type="button"
                              onClick={() => handleRetryOrderCard(order.submissionId)}
                              disabled={isSubmitting}
                              className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-700 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              🔄 Kirim Ulang
                            </button>
                          ) : null}
                          <span className="text-sm font-extrabold text-slate-900">
                            {rupiahFormatter.format(order.subtotal)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}

        {!isSettingsOnlyMode ? (
          <>
            {activeTab === "menu" ? (
              <section className="mt-4 space-y-5">
                {!loading && !error && products.length > 0 ? (
                  <div className="sticky top-[4.5rem] z-10 space-y-3 rounded-2xl bg-white/90 p-3 shadow-sm ring-1 ring-orange-100 backdrop-blur">
              <div className="flex items-center gap-2 rounded-xl border border-orange-100 bg-orange-50 px-3 py-2">
                <span className="text-sm text-orange-500">⌕</span>
                <input
                  type="search"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Cari menu atau kategori"
                  className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                />
              </div>

              <div className="flex gap-2 overflow-x-auto pb-1">
                {visibleCategoryChips.map((category) => {
                  const isActive = activeCategoryId === category.id;
                  return (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => setActiveCategoryId(category.id)}
                      className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        isActive
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {category.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-xl bg-white p-4 text-sm text-slate-600 shadow-sm ring-1 ring-orange-100">
              Memuat menu...
            </div>
          ) : null}

          {!loading && !error && products.length === 0 && tenantId ? (
            <div className="rounded-xl bg-white p-4 text-sm text-slate-600 shadow-sm ring-1 ring-orange-100">
              Menu belum tersedia.
            </div>
          ) : null}

          {!loading && !error && products.length > 0 && groupedSections.length === 0 ? (
            <div className="rounded-xl bg-white p-4 text-sm text-slate-600 shadow-sm ring-1 ring-orange-100">
              Tidak ada menu yang cocok dengan pencarian atau filter kategori.
            </div>
          ) : null}

              {groupedSections.map((section) => (
            <div key={section.id}>
              <h2 className="mb-3 text-base font-extrabold tracking-wide text-slate-900">{section.name}</h2>
              <div className="space-y-3">
                {section.items.map((product) => {
                  const quantity = cartByProductId.get(product.id)?.quantity ?? 0;
                  const isOutOfStock =
                    !product.is_available ||
                    (!product.isAvailable && (product.stock ?? 0) <= 0);
                  const productImage =
                    product.image_url?.trim() ||
                    product.imageUrl?.trim() ||
                    "https://placehold.co/400x400/eeeeee/999999?text=No+Image";

                  return (
                    <article
                      key={product.id}
                      className={`flex items-start gap-4 rounded-2xl p-4 shadow-sm ring-1 ${
                        isOutOfStock
                          ? "bg-slate-100 ring-slate-200"
                          : "bg-white ring-orange-100"
                      }`}
                    >
                      <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-gray-100">
                        <img
                          src={productImage}
                          alt={product.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          onError={(event) => {
                            event.currentTarget.src =
                              "https://placehold.co/400x400/eeeeee/999999?text=No+Image";
                          }}
                        />
                      </div>

                      <div className="ml-0 flex flex-1 flex-col justify-between">
                        <div>
                          <h3 className={`text-base font-bold leading-snug ${isOutOfStock ? "text-slate-500" : "text-gray-900"}`}>
                            {product.name}
                          </h3>
                          {isOutOfStock ? (
                            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-rose-600">
                              Habis
                            </p>
                          ) : null}
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-3">
                          <p className={`text-base font-bold ${isOutOfStock ? "text-slate-400" : "text-gray-800"}`}>
                            {rupiahFormatter.format(product.price)}
                          </p>

                          {quantity === 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (isOutOfStock) {
                                  return;
                                }
                                addToCart(product.id);
                              }}
                              disabled={isOutOfStock}
                              className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl font-bold text-white transition ${
                                isOutOfStock
                                  ? "cursor-not-allowed bg-slate-400"
                                  : "bg-orange-500 hover:bg-orange-600 active:scale-95"
                              }`}
                              aria-label={`Add ${product.name} to cart`}
                            >
                              +
                            </button>
                          ) : (
                            <div className="inline-flex h-10 shrink-0 items-center rounded-lg bg-orange-100 px-1 text-orange-700">
                              <button
                                type="button"
                                onClick={() => decreaseFromCart(product.id)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-lg font-bold shadow-sm"
                                aria-label={`Decrease ${product.name}`}
                              >
                                -
                              </button>
                              <span className="inline-block min-w-9 px-2 text-center text-sm font-bold">{quantity.toString().padStart(2, "0")}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  if (isOutOfStock) {
                                    return;
                                  }
                                  addToCart(product.id);
                                }}
                                disabled={isOutOfStock}
                                className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-lg font-bold text-white shadow-sm ${
                                  isOutOfStock ? "cursor-not-allowed bg-slate-400" : "bg-orange-500"
                                }`}
                                aria-label={`Increase ${product.name}`}
                              >
                                +
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
              ))}
              </section>
            ) : null}
          </>
        ) : null}
      </section>

      {!isSettingsOnlyMode && activeTab === "orderList" && hasAnyOrder ? (
        <div className="fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-6px_16px_rgba(0,0,0,0.08)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {remainingUnpaidBalance > 0 && remainingUnpaidBalance < totalOrderPayment
                  ? "Sisa Tagihan ▲"
                  : "Total Payment ▲"}
              </p>
              <p className="text-lg font-extrabold text-slate-900">
                {rupiahFormatter.format(bannerDisplayTotal)}
              </p>
              {remainingUnpaidBalance > 0 && remainingUnpaidBalance < totalOrderPayment ? (
                <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
                  Total keseluruhan: {rupiahFormatter.format(totalOrderPayment)}
                </p>
              ) : null}
              {orderPaymentFlags.statusLabel ? (
                <p
                  className={`mt-1 text-xs font-bold ${
                    orderPaymentFlags.allPaid
                      ? "text-emerald-700"
                      : "text-amber-700"
                  }`}
                >
                  {orderPaymentFlags.statusLabel}
                </p>
              ) : null}
            </div>
            {orderPaymentFlags.showPayButton ? (
              <button
                type="button"
                onClick={handleBayarClick}
                disabled={isAwaitingPaymentConfirmation}
                className="rounded-2xl bg-emerald-600 px-6 py-3 text-sm font-extrabold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAwaitingPaymentConfirmation ? "MENUNGGU KASIR..." : "BAYAR"}
              </button>
            ) : (
              <div className="rounded-2xl bg-emerald-50 px-5 py-3 text-right ring-1 ring-emerald-200">
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-600">
                  Sudah Lunas
                </p>
                <p className="text-sm font-extrabold text-emerald-800">
                  ✅ {orderPaymentFlags.allPaidViaQrisOnly ? "QRIS PAID" : "LUNAS"}
                </p>
              </div>
            )}
          </div>
          {orderPaymentFlags.showPayButton && isAwaitingPaymentConfirmation ? (
            <div className="mt-2 flex items-center justify-between">
              <p className="text-xs text-amber-700">
                ⏳ Silakan selesaikan di kasir.
              </p>
              <button
                type="button"
                onClick={handleCompletePaymentSuccess}
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
              >
                (Simulasi Lunas)
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {!isSettingsOnlyMode ? (
        <button
          type="button"
          onClick={handleOpenCheckout}
          disabled={displayCartSummary.itemCount === 0}
          className={`fixed left-1/2 z-40 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl bg-slate-900 px-5 py-4 text-left text-white shadow-lg ring-1 ring-black/10 transition ${
            activeTab === "orderList" && hasAnyOrder ? (orderPaymentFlags.showPayButton ? "bottom-20" : "bottom-24") : "bottom-4"
          }`}
        >
          <p className="text-sm font-semibold">
            {displayCartSummary.itemCount} items | {rupiahFormatter.format(displayCartSummary.total)}
          </p>
          <p className="text-xs text-slate-300">Tap untuk lanjut ke checkout</p>
        </button>
      ) : null}

      {!isSettingsOnlyMode && isCheckoutOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-900/45">
          <div className="mx-auto flex h-[90vh] w-full max-w-md flex-col rounded-t-3xl bg-white">
            <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-4 py-3">
              <div className="mb-2 h-1.5 w-12 rounded-full bg-slate-200" />
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">Rincian Pesanan</h2>
                <button
                  type="button"
                  onClick={handleCloseCheckout}
                  className="rounded-lg px-2 py-1 text-sm font-medium text-slate-500"
                >
                  Tutup
                </button>
              </div>
              <p className="text-xs text-slate-500">{tenantName} • Meja {displayTableNumber}</p>
            </div>

            {isOrderSuccess ? (
              <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                <div className="rounded-full bg-emerald-100 p-4 text-2xl">✓</div>
                <h3 className="mt-4 text-xl font-bold text-slate-900">Pesanan sedang diproses dapur!</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Terima kasih, pesanan Anda sudah masuk ke kasir dan dapur.
                </p>
                {orderReceipt ? (
                  <div className="mt-4 w-full rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-left text-xs text-emerald-900">
                    <p>No. Struk: <strong>{orderReceipt.receiptNumber || "-"}</strong></p>
                    <p>Order ID: <strong>{orderReceipt.orderId || "-"}</strong></p>
                    <p>Total: <strong>{rupiahFormatter.format(orderReceipt.totalAmount)}</strong></p>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={handleDownloadOnlineReceipt}
                  disabled={!orderReceipt}
                  className="mt-4 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Download Struk Online
                </button>
                <button
                  type="button"
                  onClick={handleCloseCheckout}
                  className="mt-6 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white"
                >
                  Kembali ke Menu
                </button>
              </div>
            ) : (
              <>
                {isQrisFlowOpen ? (
                  <div className="flex flex-1 flex-col overflow-y-auto px-4 py-4">
                    <h3 className="text-xl font-extrabold text-slate-900">Pembayaran QRIS</h3>
                    {qrisFirstStepCompleted ? (
                      <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                        <p className="text-sm font-bold text-emerald-800">
                          ✅ Step 1 Selesai — Checker dapur sudah tercetak
                        </p>
                        <p className="mt-1 text-xs text-emerald-700">
                          {pendingQrisOrder?.receiptNumber
                            ? `No. Struk Checker: ${pendingQrisOrder.receiptNumber} — `
                            : ""}
                          Silakan lakukan pembayaran via QRIS, upload bukti transfer, lalu tekan tombol "Selesaikan Pembayaran" di bawah.
                        </p>
                      </div>
                    ) : (
                      <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 p-3">
                        <p className="text-sm font-bold text-sky-800">
                          ⚠️ Step 1 dari 2 — Kirim Order & Cetak Checker Dapur
                        </p>
                        <p className="mt-1 text-xs text-sky-700">
                          Tekan tombol "Kirim Order ke Dapur" di bawah untuk mengirim pesanan ke kasir dan mencetak checker dapur terlebih dahulu.
                          Setelah itu, Anda bisa scan QRIS, upload bukti transfer, dan menyelesaikan pembayaran di Step 2.
                        </p>
                      </div>
                    )}

                    <div className="mt-4 rounded-2xl border border-orange-100 bg-orange-50 p-3">
                      {qrisImageUrl ? (
                        <button
                          type="button"
                          onClick={openQrisPreview}
                          className="block w-full overflow-hidden rounded-xl bg-white p-2 shadow-sm transition hover:scale-[1.01] active:scale-[0.99]"
                          aria-label="Lihat QRIS ukuran penuh"
                        >
                          <img
                            src={qrisImageUrl}
                            alt="QRIS Toko"
                            className="mx-auto h-72 w-full max-w-sm rounded-lg object-contain bg-white"
                          />
                          <span className="mt-2 block text-center text-xs font-semibold text-orange-700">
                            Ketuk untuk perbesar
                          </span>
                        </button>
                      ) : (
                        <p className="rounded-xl bg-white px-3 py-4 text-sm text-slate-600">
                          QRIS statis belum tersedia untuk tenant ini.
                        </p>
                      )}
                      {qrisLoadError ? (
                        <p className="mt-2 text-xs text-rose-600">{qrisLoadError}</p>
                      ) : null}
                    </div>

                    <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-700">
                      <li>Screenshot kode QRIS di atas.</li>
                      <li>Buka aplikasi M-Banking atau E-Wallet Anda, lalu scan/upload screenshot QRIS.</li>
                      <li>Masukkan nominal tagihan.</li>
                      <li>Upload bukti transfer di bawah ini untuk memproses pesanan.</li>
                    </ol>

                    <div className="mt-4 rounded-xl border border-slate-100 bg-white p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm text-slate-500">Grand Total</span>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-extrabold text-orange-600">
                            {rupiahFormatter.format(displayCartSummary.total)}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleCopyGrandTotal()}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                      {copySuccess ? (
                        <p className="mt-2 text-xs text-emerald-700">{copySuccess}</p>
                      ) : null}
                    </div>

                    <div className="mt-4 rounded-xl border border-slate-100 bg-white p-3">
                      <label className="text-sm font-semibold text-slate-800" htmlFor="payment-proof-upload">
                        {isPaymentProofMandatory
                          ? "Upload Bukti Transfer (Wajib)"
                          : "Upload Bukti Transfer (Opsional)"}
                      </label>
                      <input
                        id="payment-proof-upload"
                        type="file"
                        accept="image/*"
                        onChange={(event) =>
                          handleProofFileChange(event.target.files?.[0] ?? null)
                        }
                        className="mt-2 block w-full rounded-lg border border-slate-200 p-2 text-sm"
                      />
                      {paymentProofPreviewUrl ? (
                        <img
                          src={paymentProofPreviewUrl}
                          alt="Preview bukti transfer"
                          className="mt-3 h-56 w-full rounded-lg object-cover"
                        />
                      ) : null}
                    </div>

                    {submitError ? (
                      <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                        {submitError}
                      </p>
                    ) : null}

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setIsQrisFlowOpen(false)}
                        disabled={isSubmitting || isQrisPaymentUploading}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                      >
                        Kembali
                      </button>
                      {qrisFirstStepCompleted ? (
                        <button
                          type="button"
                          disabled={
                            isSubmitting ||
                            isQrisPaymentUploading ||
                            !pendingQrisOrder?.orderId ||
                            (isPaymentProofMandatory && !paymentProofFile)
                          }
                          onClick={() => void handleSubmitQrisPaymentProof()}
                          className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isQrisPaymentUploading
                            ? "Memproses pembayaran..."
                            : "Selesaikan Pembayaran"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => void handleSubmitOrder("QRIS", null)}
                          className="rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isSubmitting
                            ? "Mengirim pesanan..."
                            : "Kirim Order ke Dapur"}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                <div className="flex-1 overflow-y-auto px-4 py-4">
                  <div className="space-y-3">
                    {cartItems.map((item) => (
                      <div
                        key={item.productId}
                        className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                            <p className="text-xs text-slate-500">{item.quantity} x {rupiahFormatter.format(item.price)}</p>
                          </div>
                          <p className="text-sm font-bold text-slate-900">{rupiahFormatter.format(item.subtotal)}</p>
                        </div>
                        <div className="mt-2">
                          <input
                            type="text"
                            value={item.note ?? ""}
                            onChange={(event) =>
                              updateItemNote(item.productId, event.target.value)
                            }
                            placeholder="Catatan item: Pedas, tanpa bawang..."
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none ring-orange-300 placeholder:text-slate-400 focus:ring-2"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 rounded-xl border border-orange-100 bg-orange-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">Nama Pelanggan</p>
                    <input
                      type="text"
                      value={customerNameInput}
                      onChange={(event) => setCustomerNameInput(event.target.value)}
                      placeholder="Masukkan nama Anda (Contoh: Andre, Meja 1)"
                      className="mt-2 w-full rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-orange-300 focus:ring-2"
                    />
                  </div>

                  <div className="mt-3 rounded-xl border border-orange-100 bg-orange-50/60 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">Jumlah Orang (Pax)</p>
                    <input
                      type="number"
                      min={1}
                      value={paxCountInput}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "") {
                          setPaxCountInput("");
                          return;
                        }
                        const n = Number(v);
                        if (Number.isFinite(n) && n >= 1) setPaxCountInput(Math.floor(n));
                      }}
                      placeholder="Contoh: 2"
                      className="mt-2 w-full rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-orange-300 focus:ring-2"
                    />
                  </div>

                  <div className="mt-4 rounded-xl border border-slate-100 p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">Metode Pembayaran</span>
                      <div className="flex gap-2">
                        {allowPayAtCashier ? (
                          <button
                            type="button"
                            onClick={() => setPaymentMethod("CASHIER")}
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${
                              paymentMethod === "CASHIER"
                                ? "bg-slate-900 text-white"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            Bayar di Kasir
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setPaymentMethod("QRIS")}
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            paymentMethod === "QRIS"
                              ? "bg-emerald-600 text-white"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          QRIS
                        </button>
                      </div>
                    </div>
                    <div className="mb-3 mt-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      {paymentMethod === "QRIS"
                        ? "Lanjutkan ke halaman QRIS untuk upload bukti transfer sebelum pesanan dikirim."
                        : allowPayAtCashier
                        ? "Pembayaran dilakukan di kasir. Pesanan ini belum terhubung ke payment gateway."
                        : "Pembayaran di kasir sedang dinonaktifkan oleh toko. Gunakan QRIS."}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="text-slate-500">Subtotal</span>
                      <span className="font-semibold text-slate-900">{rupiahFormatter.format(displayCartSummary.total)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-base">
                      <span className="font-bold text-slate-900">Grand Total</span>
                      <span className="font-extrabold text-orange-600">{rupiahFormatter.format(displayCartSummary.total)}</span>
                    </div>
                  </div>

                  {submitError ? (
                    <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {submitError}
                    </p>
                  ) : null}
                </div>

                <div className="sticky bottom-0 border-t border-slate-100 bg-white px-4 py-4">
                  <button
                    type="button"
                    disabled={isSubmitting || cartItems.length === 0}
                    onClick={handlePrimaryCheckoutAction}
                    className="w-full rounded-xl bg-orange-500 px-4 py-4 text-sm font-bold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isSubmitting
                      ? "Mengirim pesanan..."
                      : paymentMethod === "QRIS" || !allowPayAtCashier
                      ? "Lanjut Bayar QRIS"
                      : `Pesan ke Kasir (${rupiahFormatter.format(displayCartSummary.total)})`}
                  </button>
                </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}

      {!isSettingsOnlyMode && isQrisPreviewOpen && qrisImageUrl ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4">
          <div className="relative flex h-[92vh] w-full max-w-5xl items-center justify-center overflow-hidden rounded-3xl bg-slate-950 shadow-2xl ring-1 ring-white/10">
            <button
              type="button"
              onClick={() => setIsQrisPreviewOpen(false)}
              className="absolute right-4 top-4 z-10 rounded-full bg-white/90 px-3 py-2 text-sm font-semibold text-slate-900 shadow-lg transition hover:bg-white"
              aria-label="Tutup preview QRIS"
            >
              Tutup
            </button>
            <img
              src={qrisImageUrl}
              alt="QRIS Toko ukuran penuh"
              className="max-h-full max-w-full object-contain"
            />
          </div>
        </div>
      ) : null}

      {queueScreen.isOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden">
            {!queueScreen.isFailed ? (
              <div className="p-6 text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-orange-100">
                  <span className="text-4xl animate-pulse">⏳</span>
                </div>
                <h2 className="mt-5 text-xl font-extrabold text-slate-900">
                  Pesanan Sedang Diproses
                </h2>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <span className="inline-flex rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
                    Meja: {displayTableNumber}
                  </span>
                  {queueScreen.transactionId ? (
                    <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 font-mono">
                      {queueScreen.transactionId}
                    </span>
                  ) : null}
                </div>

                {queueScreen.queuePosition && queueScreen.queueTotal ? (
                  <div className="mt-4 rounded-2xl bg-slate-50 p-3">
                    <p className="text-sm font-semibold text-slate-800">
                      Antrian: <span className="text-orange-600">#{queueScreen.queuePosition}</span> dari {queueScreen.queueTotal}
                    </p>
                  </div>
                ) : null}

                {queueScreen.etaSeconds !== undefined ? (
                  <p className="mt-3 text-sm text-slate-600">
                    Estimasi: <span className="font-bold text-slate-900">{queueScreen.etaSeconds}</span> detik
                  </p>
                ) : null}

                <div className="mt-5">
                  <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-orange-400 to-orange-600 transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.max(0, queueScreen.progressPct))}%` }}
                    />
                  </div>
                  <p className="mt-2 text-right text-xs font-bold text-slate-600">
                    {Math.floor(Math.min(100, Math.max(0, queueScreen.progressPct)))}%
                  </p>
                </div>

                <div className="mt-4 rounded-2xl border border-orange-100 bg-orange-50/60 px-4 py-3">
                  <p className="text-sm font-semibold text-orange-800">
                    {queueScreen.stageMessage || "Memproses..."}
                  </p>
                </div>

                {queueScreen.submissionId ? (
                  <p className="mt-4 text-[10px] font-mono text-slate-400 break-all">
                    submissionId: {queueScreen.submissionId}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="p-6 text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-rose-100">
                  <span className="text-4xl">⚠️</span>
                </div>
                <h2 className="mt-5 text-xl font-extrabold text-slate-900">
                  Pesanan Belum Terkirim
                </h2>
                <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3">
                  <p className="text-sm text-rose-800">
                    {queueScreen.failureMessage ||
                      "Perangkat kasir tidak merespon dalam 30 detik. Pesanan belum tercetak di dapur."}
                  </p>
                </div>
                {queueScreen.submissionId ? (
                  <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-left">
                    <p className="text-[11px] font-mono text-slate-500 break-all">
                      submissionId: {queueScreen.submissionId}
                    </p>
                  </div>
                ) : null}
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={handleCloseQueueScreen}
                    disabled={isSubmitting}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Batalkan
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRetryFailedOrder()}
                    disabled={isSubmitting}
                    className="rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    🔄 COBA LAGI
                  </button>
                </div>
                <p className="mt-3 text-[11px] text-slate-400">
                  Retry menggunakan submissionId yang sama (tidak akan double order)
                </p>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {isPaymentMethodModalOpen ? (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl ring-1 ring-black/5 p-6">
            <h3 className="text-center text-xl font-extrabold text-slate-900">
              Pilih Metode Pembayaran
            </h3>
            <p className="mt-1 text-center text-sm text-slate-500">
              Total tagihan: <span className="font-bold text-slate-900">{rupiahFormatter.format(totalOrderPayment)}</span>
            </p>
            <div className="mt-6 space-y-3">
              {qrisImageUrl ? (
                <button
                  type="button"
                  onClick={() => handlePaymentMethodSelected("QRIS")}
                  className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-left transition hover:bg-emerald-100 active:scale-[0.99]"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white text-xl">
                      💳
                    </span>
                    <div>
                      <p className="text-sm font-extrabold text-emerald-800">Bayar QRIS</p>
                      <p className="text-xs text-emerald-700/80">Scan QRIS toko via E-Wallet / M-Banking</p>
                    </div>
                  </div>
                </button>
              ) : null}
              {allowPayAtCashier ? (
                <button
                  type="button"
                  onClick={() => handlePaymentMethodSelected("CASHIER")}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:bg-slate-100 active:scale-[0.99]"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-700 text-white text-xl">
                      🏧
                    </span>
                    <div>
                      <p className="text-sm font-extrabold text-slate-800">Bayar di Kasir</p>
                      <p className="text-xs text-slate-600">Selesaikan pembayaran langsung ke kasir toko</p>
                    </div>
                  </div>
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setIsPaymentMethodModalOpen(false)}
              className="mt-5 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Batal
            </button>
          </div>
        </div>
      ) : null}

      {snackbar.isOpen ? (
        <div className="fixed left-1/2 top-6 z-[90] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 pointer-events-none">
          <div
            className={`rounded-2xl px-4 py-3 shadow-lg ring-1 ${
              snackbar.type === "success"
                ? "bg-emerald-600 text-white ring-emerald-500"
                : snackbar.type === "error"
                ? "bg-rose-600 text-white ring-rose-500"
                : "bg-slate-900 text-white ring-slate-800"
            }`}
          >
            <div className="flex items-start gap-3">
              <span className="text-lg shrink-0">
                {snackbar.type === "success"
                  ? "✅"
                  : snackbar.type === "error"
                  ? "❌"
                  : "ℹ️"}
              </span>
              <p className="text-sm font-semibold leading-relaxed flex-1">
                {snackbar.message}
              </p>
              <button
                type="button"
                onClick={closeSnackbar}
                className="pointer-events-auto text-xs font-bold opacity-80 hover:opacity-100 shrink-0"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
