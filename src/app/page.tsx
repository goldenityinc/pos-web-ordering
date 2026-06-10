"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  getMenu,
  MenuCategory,
  MenuProduct,
  OrderItemInput,
  submitOrder,
} from "@/services/api";

const rupiahFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

type CartMap = Record<string, number>;
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

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string>("Goldenity Resto");
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [products, setProducts] = useState<MenuProduct[]>([]);
  const [cart, setCart] = useState<CartMap>({});
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isOrderSuccess, setIsOrderSuccess] = useState(false);

  useEffect(() => {
    if (!tenantId) {
      setCategories([]);
      setProducts([]);
      setTenantName("Goldenity Resto");
      return;
    }

    const run = async () => {
      setLoading(true);
      setError(null);

      try {
        const menu = await getMenu(tenantId);
        setCategories(menu.categories);
        setProducts(menu.products.filter((item) => item.isAvailable));

        const resolvedTenantName =
          menu.tenant?.name?.trim() || menu.tenant?.slug?.trim() || tenantId;

        setTenantName(resolvedTenantName);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Gagal mengambil data menu.";
        setError(message);
        setCategories([]);
        setProducts([]);
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [tenantId]);

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
      const quantity = cart[product.id] ?? 0;
      if (quantity > 0) {
        itemCount += quantity;
        total += quantity * product.price;
      }
    }

    return { itemCount, total };
  }, [cart, products]);

  const groupedSections = useMemo<GroupedMenuSection[]>(() => {
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
  }, [categories, products]);

  const cartItems = useMemo(() => {
    const rows: Array<{
      productId: string;
      name: string;
      quantity: number;
      price: number;
      subtotal: number;
    }> = [];

    for (const [productId, quantity] of Object.entries(cart)) {
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
      });
    }

    return rows;
  }, [cart, productById]);

  const addToCart = (productId: string) => {
    setCart((prev) => ({
      ...prev,
      [productId]: (prev[productId] ?? 0) + 1,
    }));
  };

  const decreaseFromCart = (productId: string) => {
    setCart((prev) => {
      const current = prev[productId] ?? 0;
      if (current <= 1) {
        const { [productId]: _removed, ...rest } = prev;
        return rest;
      }

      return {
        ...prev,
        [productId]: current - 1,
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
      }));

      await submitOrder({
        tenantId,
        table: tableNumber,
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
            {tenantName}
          </h1>
          <span className="mt-3 inline-flex rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
            Meja: {tableNumber}
          </span>
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

          {groupedSections.map((section) => (
            <div key={section.id}>
              <h2 className="mb-3 text-base font-extrabold tracking-wide text-slate-900">{section.name}</h2>
              <div className="space-y-3">
                {section.items.map((product) => {
                  const quantity = cart[product.id] ?? 0;

                  return (
                    <article
                      key={product.id}
                      className="flex items-center justify-between gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-orange-100"
                    >
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-slate-900">{product.name}</h3>
                        <p className="mt-1 text-sm font-medium text-orange-600">
                          {rupiahFormatter.format(product.price)}
                        </p>
                      </div>

                      {quantity === 0 ? (
                        <button
                          type="button"
                          onClick={() => addToCart(product.id)}
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-500 text-lg font-bold text-white shadow-sm transition hover:bg-orange-600 active:scale-95"
                          aria-label={`Add ${product.name} to cart`}
                        >
                          +
                        </button>
                      ) : (
                        <div className="inline-flex h-9 shrink-0 items-center rounded-full bg-orange-100 p-1 text-orange-700">
                          <button
                            type="button"
                            onClick={() => decreaseFromCart(product.id)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-base font-bold shadow-sm"
                            aria-label={`Decrease ${product.name}`}
                          >
                            -
                          </button>
                          <span className="inline-block min-w-8 px-2 text-center text-sm font-bold">{quantity}</span>
                          <button
                            type="button"
                            onClick={() => addToCart(product.id)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-orange-500 text-base font-bold text-white shadow-sm"
                            aria-label={`Increase ${product.name}`}
                          >
                            +
                          </button>
                        </div>
                      )}
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
                    <div className="flex items-center justify-between text-sm">
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
                      : `Pesan & Bayar (${rupiahFormatter.format(cartSummary.total)})`}
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
