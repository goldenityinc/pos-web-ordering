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
  updateReceiptFooter,
  updateQrisImage,
} from "../services/api";

export const dynamic = "force-dynamic";

const rupiahFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

type CartItemState = {
  quantity: number;
  note?: string;
};

type CartMap = Record<string, CartItemState>;
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

export default function HomePage() {
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
  const isSettingsMode = mode === "settings" || searchParams.get("settings") === "1";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string>("");
  const [branchInfo, setBranchInfo] = useState<BranchInfo | undefined>(undefined);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [products, setProducts] = useState<MenuProduct[]>([]);
  const [cart, setCart] = useState<CartMap>({});
  const [searchText, setSearchText] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState<string>("all");
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isQrisFlowOpen, setIsQrisFlowOpen] = useState(false);
  const [isQrisPreviewOpen, setIsQrisPreviewOpen] = useState(false);
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
      setIsQrisPreviewOpen(false);
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
        setIsPaymentProofMandatory(settings.isPaymentProofMandatory !== false);
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
        setIsPaymentProofMandatory(true);
        setSettingsReceiptFooter(DEFAULT_RECEIPT_FOOTER);
      }
    };

    void run();
  }, [branchId, isCheckoutOpen, isSettingsMode, tenantId]);

  const productById = useMemo(() => {
    return new Map(products.map((product) => [product.id, product]));
  }, [products]);

  const cartSummary = useMemo(() => {
    let itemCount = 0;
    let total = 0;

    for (const product of products) {
      const quantity = cart[product.id]?.quantity ?? 0;
      if (quantity > 0) {
        itemCount += quantity;
        total += quantity * product.price;
      }
    }

    return { itemCount, total };
  }, [cart, products]);

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

  const cartItems = useMemo(() => {
    const rows: Array<{
      productId: string;
      name: string;
      quantity: number;
      price: number;
      subtotal: number;
      note?: string;
    }> = [];

    for (const [productId, item] of Object.entries(cart)) {
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

  const addToCart = (productId: string) => {
    setCart((prev) => ({
      ...prev,
      [productId]: {
        quantity: (prev[productId]?.quantity ?? 0) + 1,
        note: prev[productId]?.note,
      },
    }));
  };

  const decreaseFromCart = (productId: string) => {
    setCart((prev) => {
      const current = prev[productId]?.quantity ?? 0;
      if (current <= 1) {
        const { [productId]: _removed, ...rest } = prev;
        return rest;
      }

      return {
        ...prev,
        [productId]: {
          quantity: current - 1,
          note: prev[productId]?.note,
        },
      };
    });
  };

  const updateItemNote = (productId: string, newNote: string) => {
    setCart((prev) => {
      const existing = prev[productId];
      if (!existing || existing.quantity <= 0) {
        return prev;
      }

      return {
        ...prev,
        [productId]: {
          ...existing,
          note: newNote,
        },
      };
    });
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

  const handleSubmitOrder = async (
    selectedPaymentMethod: "CASHIER" | "QRIS",
    selectedProofFile?: File | null,
  ) => {
    if (!tenantId) {
      setSubmitError("Tenant tidak ditemukan pada URL.");
      return;
    }

    if (cartItems.length === 0) {
      setSubmitError("Keranjang kosong.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const payloadItems: OrderItemInput[] = cartItems.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        price: item.price,
        name: item.name,
        subtotal: item.subtotal,
        note: item.note,
      }));

      const response = await submitOrder({
        tenantId,
        table: tableNumber,
        tableId,
        branchId,
        cartItems: payloadItems,
        totalAmount: cartSummary.total,
        customerName: customerNameInput,
        paymentMethod: selectedPaymentMethod,
        paymentProofFile: selectedProofFile || null,
      });

      const responseData =
        response && typeof response === "object" && response.data && typeof response.data === "object"
          ? (response.data as Record<string, unknown>)
          : (response as unknown as Record<string, unknown>);

      const receiptNumber =
        String(
          responseData.receipt_number ??
            responseData.receiptNumber ??
            responseData.invoice_number ??
            responseData.invoiceNumber ??
            "",
        ).trim();

      const responseOrderId = String(
        responseData.id ?? responseData.orderId ?? responseData.order_id ?? response.orderId ?? "",
      ).trim();

      const paymentMethodLabel =
        selectedPaymentMethod === "QRIS" ? "QRIS" : "Bayar di Kasir";

      setOrderReceipt({
        orderId: responseOrderId,
        receiptNumber,
        createdAt: new Date().toISOString(),
        customerName: customerNameInput.trim() || "Guest",
        tenantName: tenantName || "Customer Ordering",
        tableNumber,
        branchName: branchInfo?.name || branchNameFromUrl || "-",
        paymentMethod: paymentMethodLabel,
        totalAmount: cartSummary.total,
        items: cartItems.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          subtotal: item.subtotal,
          note: item.note,
        })),
        paymentProofUrl: getUrlFromUnknown(
          responseData.payment_proof_url ?? responseData.paymentProofUrl,
        ),
        receiptUrl: getUrlFromUnknown(responseData.receipt_url ?? responseData.receiptUrl),
        receiptFooter: settingsReceiptFooter.trim() || DEFAULT_RECEIPT_FOOTER,
      });

      setIsOrderSuccess(true);
      setIsQrisFlowOpen(false);
      setCart({});
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Gagal mengirim pesanan.";
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
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

  const handlePrimaryCheckoutAction = () => {
    if (!allowPayAtCashier) {
      setPaymentMethod("QRIS");
      setIsQrisFlowOpen(true);
      setSubmitError(null);
      return;
    }

    if (paymentMethod === "QRIS") {
      setIsQrisFlowOpen(true);
      setSubmitError(null);
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

    const createdAt = new Date(orderReceipt.createdAt);
    const printableDate = Number.isNaN(createdAt.getTime())
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
            Customer Ordering
          </p>
          <h1 className="mt-2 text-2xl font-bold leading-tight text-slate-900">
            {tenantName || "Customer Ordering"}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="inline-flex rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
              Meja: {tableNumber}
            </span>
            {isSettingsMode ? (
              <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                Mode Setting
              </span>
            ) : null}
            {(branchInfo?.name || branchNameFromUrl) ? (
              <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                Cabang: {branchInfo?.name || branchNameFromUrl}
              </span>
            ) : null}
          </div>
        </header>

        {isSettingsMode ? (
          <section className="mt-4 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-emerald-100">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">
                  Pengaturan QR Static
                </p>
                <h2 className="mt-1 text-lg font-bold text-slate-900">Upload QRIS untuk web</h2>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                Internal
              </span>
            </div>

            <div className="mt-4 space-y-3 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-3">
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
                File QR Static
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
                {isSavingQris ? "Menyimpan..." : "Simpan Pengaturan Web"}
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
                Upload gambar QRIS di sini untuk dipakai oleh customer ordering web. Jika server memakai kunci pengaturan,
                isi kolom di atas sebelum menyimpan.
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

        <section className="mt-4 space-y-5">
          {!loading && !error && products.length > 0 ? (
            <div className="sticky top-3 z-10 space-y-3 rounded-2xl bg-white/90 p-3 shadow-sm ring-1 ring-orange-100 backdrop-blur">
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
                  const quantity = cart[product.id]?.quantity ?? 0;
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
      </section>

      <button
        type="button"
        onClick={handleOpenCheckout}
        disabled={cartSummary.itemCount === 0}
        className="fixed bottom-4 left-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl bg-slate-900 px-5 py-4 text-left text-white shadow-lg ring-1 ring-black/10"
      >
        <p className="text-sm font-semibold">
          {cartSummary.itemCount} items | {rupiahFormatter.format(cartSummary.total)}
        </p>
        <p className="text-xs text-slate-300">Tap untuk lanjut ke checkout</p>
      </button>

      {isCheckoutOpen ? (
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
              <p className="text-xs text-slate-500">{tenantName} • Meja {tableNumber}</p>
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
                    <p className="mt-1 text-sm text-slate-500">Ikuti langkah berikut sebelum kirim pesanan.</p>

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
                            {rupiahFormatter.format(cartSummary.total)}
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
                        disabled={isSubmitting}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                      >
                        Kembali
                      </button>
                      <button
                        type="button"
                        disabled={isSubmitting || (isPaymentProofMandatory && !paymentProofFile)}
                        onClick={() => void handleSubmitOrder("QRIS", paymentProofFile)}
                        className="rounded-xl bg-orange-500 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {isSubmitting ? "Mengirim pesanan..." : "Pesan Sekarang"}
                      </button>
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
                      <span className="font-semibold text-slate-900">{rupiahFormatter.format(cartSummary.total)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-base">
                      <span className="font-bold text-slate-900">Grand Total</span>
                      <span className="font-extrabold text-orange-600">{rupiahFormatter.format(cartSummary.total)}</span>
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
                      : `Pesan ke Kasir (${rupiahFormatter.format(cartSummary.total)})`}
                  </button>
                </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}

      {isQrisPreviewOpen && qrisImageUrl ? (
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
    </main>
  );
}
