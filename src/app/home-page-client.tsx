"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  getMenu,
  BranchInfo,
  MenuCategory,
  MenuProduct,
  OrderItemInput,
  submitOrder,
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
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isOrderSuccess, setIsOrderSuccess] = useState(false);

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
      setSubmitError(null);
      setIsOrderSuccess(false);
      setNotes("");
    }
  }, [isCheckoutOpen]);

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

  const handleSubmitOrder = async () => {
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

      await submitOrder({
        tenantId,
        table: tableNumber,
        tableId,
        branchId,
        cartItems: payloadItems,
        totalAmount: cartSummary.total,
        notes,
      });

      setIsOrderSuccess(true);
      setCart({});
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Gagal mengirim pesanan.";
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
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
            {(branchInfo?.name || branchNameFromUrl) ? (
              <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                Cabang: {branchInfo?.name || branchNameFromUrl}
              </span>
            ) : null}
          </div>
        </header>

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
                    <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">Catatan Khusus</p>
                    <textarea
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder="Contoh: tanpa sambal, es dipisah"
                      className="mt-2 h-24 w-full resize-none rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none ring-orange-300 focus:ring-2"
                    />
                  </div>

                  <div className="mt-4 rounded-xl border border-slate-100 p-3">
                    <div className="mb-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      Pembayaran dilakukan di kasir. Pesanan ini belum terhubung ke payment gateway.
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">Metode Pembayaran</span>
                      <span className="font-semibold text-slate-900">Bayar di Kasir</span>
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
                    onClick={() => void handleSubmitOrder()}
                    className="w-full rounded-xl bg-orange-500 px-4 py-4 text-sm font-bold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isSubmitting
                      ? "Mengirim pesanan..."
                      : `Pesan ke Kasir (${rupiahFormatter.format(cartSummary.total)})`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}
