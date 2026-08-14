"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  safeGetStorage,
  safeRemoveStorage,
  safeSetStorage,
  WEB_ORDER_CART_STORAGE_KEY,
  buildCartStorageKey,
  type CartStorageKeyParams,
} from "../lib/app-storage";
import {
  clearPersistedActiveOrder as clearActiveOrderStorage,
  getActiveOrderByTransaction,
  getPersistedActiveOrder,
  type PersistedActiveOrderSnapshot,
} from "../services/api";

export type CartItem = {
  productId: string;
  quantity: number;
  note?: string;
};

export type PersistedActiveOrderStatus = {
  loading: boolean;
  snapshot: PersistedActiveOrderSnapshot;
  orderData: unknown[] | null;
  fetchError: string | null;
  fetchedAt: string | null;
  refetch: () => Promise<void>;
  clear: () => void;
};

type CartContextValue = {
  cart: CartItem[];
  scope: CartStorageKeyParams | null;
  scopeKey: string | null;
  setStorageScope: (scope: CartStorageKeyParams | null) => void;
  addToCart: (productId: string) => void;
  decreaseFromCart: (productId: string) => void;
  updateItemNote: (productId: string, note: string) => void;
  clearCart: () => void;
  persistedActiveOrder: PersistedActiveOrderStatus;
};

const CartContext = createContext<CartContextValue | undefined>(undefined);

function normalizeCartItem(value: unknown): CartItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const productId =
    typeof (value as { productId?: unknown }).productId === "string"
      ? (value as { productId: string }).productId.trim()
      : "";
  const quantity = Number((value as { quantity?: unknown }).quantity);
  const note = (value as { note?: unknown }).note;

  if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  return {
    productId,
    quantity: Math.floor(quantity),
    note: typeof note === "string" ? note : undefined,
  };
}

function buildScopeKey(scope: CartStorageKeyParams | null) {
  if (!scope) return WEB_ORDER_CART_STORAGE_KEY;
  const fromBuilder = buildCartStorageKey(scope);
  return fromBuilder || WEB_ORDER_CART_STORAGE_KEY;
}

function loadCartFromScope(scope: CartStorageKeyParams | null): CartItem[] {
  const key = buildScopeKey(scope);
  try {
    const rawCart = safeGetStorage(key);
    if (!rawCart) {
      if (key !== WEB_ORDER_CART_STORAGE_KEY) {
        // 🔴 ISOLATION FIRST-LOAD FALLBACK:
        //    JIKA scope per-table BARU DIBUKA (kosong), cek apakah ada global
        //    WEB_ORDER_CART_STORAGE_KEY yang masih punya sisa cart (sisa test lama).
        //    HANYA COPY jika scope != global key, DAN global ada.
        //    Setelah copy ke scope → hapus global key AGAR TIDAK BOCOR lagi ke
        //    scope table LAINNYA.
        const globalRaw = safeGetStorage(WEB_ORDER_CART_STORAGE_KEY);
        if (globalRaw) {
          try {
            const parsedGlobal = JSON.parse(globalRaw) as unknown;
            if (Array.isArray(parsedGlobal)) {
              const normalized = parsedGlobal
                .map((item) => normalizeCartItem(item))
                .filter((item): item is CartItem => Boolean(item));
              if (normalized.length > 0) {
                try { safeSetStorage(key, JSON.stringify(normalized)); } catch (_) {}
                safeRemoveStorage(WEB_ORDER_CART_STORAGE_KEY);
                return normalized;
              }
              safeRemoveStorage(WEB_ORDER_CART_STORAGE_KEY);
            } else {
              safeRemoveStorage(WEB_ORDER_CART_STORAGE_KEY);
            }
          } catch (_err2) {
            safeRemoveStorage(WEB_ORDER_CART_STORAGE_KEY);
          }
        }
      }
      return [];
    }

    const parsedCart = JSON.parse(rawCart) as unknown;
    if (!Array.isArray(parsedCart)) {
      safeRemoveStorage(key);
      return [];
    }

    return parsedCart
      .map((item) => normalizeCartItem(item))
      .filter((item): item is CartItem => Boolean(item));
  } catch (_error) {
    safeRemoveStorage(key);
    return [];
  }
}

type CartProviderProps = {
  children: ReactNode;
};

export function CartProvider({ children }: CartProviderProps) {
  const [scope, setScope] = useState<CartStorageKeyParams | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [hasLoadedCart, setHasLoadedCart] = useState(false);
  const scopeKey = useMemo(() => buildScopeKey(scope), [scope]);
  const prevScopeKeyRef = useRef<string | null>(null);

  const [persistedSnapshot, setPersistedSnapshot] = useState<PersistedActiveOrderSnapshot>({
    transactionId: null,
    orderId: null,
    submissionId: null,
    receiptNumber: null,
    meta: null,
    found: false,
  });
  const [persistedOrders, setPersistedOrders] = useState<unknown[] | null>(null);
  const [persistedLoading, setPersistedLoading] = useState(false);
  const [persistedFetchError, setPersistedFetchError] = useState<string | null>(null);
  const [persistedFetchedAt, setPersistedFetchedAt] = useState<string | null>(null);
  const fetchActiveOrderFromStorageRef = useRef<(() => Promise<void>) | null>(null);

  const fetchPersistedOrderFromStorage = async () => {
    let snapshot: PersistedActiveOrderSnapshot;
    try {
      // 🔴 CRITICAL HOTFIX: Pass scope table-aktif agar getPersistedActiveOrder TIDAK
      //    pernah me-return data milik meja lain (misal TX-ID sisa Meja 1 saat Meja 5 dibuka).
      snapshot = getPersistedActiveOrder(scope
        ? { tenantId: scope.tenantId, branchId: scope.branchId, tableId: scope.tableId, tableNumber: scope.tableNumber }
        : undefined);
    } catch {
      snapshot = {
        transactionId: null,
        orderId: null,
        submissionId: null,
        receiptNumber: null,
        meta: null,
        found: false,
      };
    }
    setPersistedSnapshot(snapshot);
    if (!snapshot.found || !snapshot.transactionId) {
      setPersistedOrders(null);
      setPersistedFetchError(null);
      setPersistedFetchedAt(new Date().toISOString());
      return;
    }
    const tenantId =
      (snapshot.meta &&
        typeof snapshot.meta === "object" &&
        typeof (snapshot.meta as { tenantId?: unknown }).tenantId === "string"
        ? (snapshot.meta as { tenantId: string }).tenantId
        : scope?.tenantId || null) as string | null;
    const branchId =
      (snapshot.meta &&
        typeof snapshot.meta === "object" &&
        typeof (snapshot.meta as { branchId?: unknown }).branchId === "string"
        ? (snapshot.meta as { branchId: string }).branchId
        : scope?.branchId || null) as string | null;
    const tableId =
      (snapshot.meta &&
        typeof snapshot.meta === "object" &&
        typeof (snapshot.meta as { tableId?: unknown }).tableId === "string"
        ? (snapshot.meta as { tableId: string }).tableId
        : scope?.tableId || null) as string | null;
    setPersistedLoading(true);
    setPersistedFetchError(null);
    try {
      const result = await getActiveOrderByTransaction(snapshot.transactionId, {
        tenantId,
        branchId,
        tableId,
      });
      if (result.ok) {
        setPersistedOrders(Array.isArray(result.data) ? result.data : []);
        setPersistedFetchError(null);
      } else {
        setPersistedOrders(null);
        setPersistedFetchError(result.error ?? "Gagal mengambil status order.");
      }
    } catch (err) {
      setPersistedOrders(null);
      setPersistedFetchError(err instanceof Error ? err.message : "Terjadi kesalahan saat memuat status order.");
    } finally {
      setPersistedLoading(false);
      setPersistedFetchedAt(new Date().toISOString());
    }
  };

  fetchActiveOrderFromStorageRef.current = fetchPersistedOrderFromStorage;

  useEffect(() => {
    if (prevScopeKeyRef.current === scopeKey && hasLoadedCart) {
      return;
    }
    prevScopeKeyRef.current = scopeKey;
    setCart(loadCartFromScope(scope));
    setHasLoadedCart(true);
  }, [scopeKey, scope, hasLoadedCart]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let snapshot: PersistedActiveOrderSnapshot;
      try {
        // 🔴 CRITICAL HOTFIX: Pass scope table-aktif agar getPersistedActiveOrder TIDAK
        //    pernah me-return data milik meja lain (misal TX-ID sisa Meja 1 saat Meja 5 dibuka).
        snapshot = getPersistedActiveOrder(scope
          ? { tenantId: scope.tenantId, branchId: scope.branchId, tableId: scope.tableId, tableNumber: scope.tableNumber }
          : undefined);
      } catch {
        snapshot = {
          transactionId: null,
          orderId: null,
          submissionId: null,
          receiptNumber: null,
          meta: null,
          found: false,
        };
      }
      if (cancelled) return;
      setPersistedSnapshot(snapshot);
      if (!snapshot.found || !snapshot.transactionId) {
        setPersistedOrders(null);
        setPersistedFetchError(null);
        setPersistedFetchedAt(new Date().toISOString());
        return;
      }
      const tenantId =
        (snapshot.meta &&
          typeof snapshot.meta === "object" &&
          typeof (snapshot.meta as { tenantId?: unknown }).tenantId === "string"
          ? (snapshot.meta as { tenantId: string }).tenantId
          : scope?.tenantId || null) as string | null;
      const branchId =
        (snapshot.meta &&
          typeof snapshot.meta === "object" &&
          typeof (snapshot.meta as { branchId?: unknown }).branchId === "string"
          ? (snapshot.meta as { branchId: string }).branchId
          : scope?.branchId || null) as string | null;
      const tableId =
        (snapshot.meta &&
          typeof snapshot.meta === "object" &&
          typeof (snapshot.meta as { tableId?: unknown }).tableId === "string"
          ? (snapshot.meta as { tableId: string }).tableId
          : scope?.tableId || null) as string | null;
      setPersistedLoading(true);
      setPersistedFetchError(null);
      try {
        const result = await getActiveOrderByTransaction(snapshot.transactionId, {
          tenantId,
          branchId,
          tableId,
        });
        if (cancelled) return;
        if (result.ok) {
          setPersistedOrders(Array.isArray(result.data) ? result.data : []);
          setPersistedFetchError(null);
        } else {
          setPersistedOrders(null);
          setPersistedFetchError(result.error ?? "Gagal mengambil status order.");
        }
      } catch (err) {
        if (cancelled) return;
        setPersistedOrders(null);
        setPersistedFetchError(err instanceof Error ? err.message : "Terjadi kesalahan saat memuat status order.");
      } finally {
        if (!cancelled) {
          setPersistedLoading(false);
          setPersistedFetchedAt(new Date().toISOString());
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // We intentionally only run this effect once on mount + scope changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope?.tenantId, scope?.branchId, scope?.tableId]);

  useEffect(() => {
    if (!hasLoadedCart) {
      return;
    }

    try {
      safeSetStorage(scopeKey, JSON.stringify(cart));
    } catch (_error) {
      safeRemoveStorage(scopeKey);
    }
  }, [cart, hasLoadedCart, scopeKey]);

  const persistedActiveOrderValue = useMemo<PersistedActiveOrderStatus>(
    () => ({
      loading: persistedLoading,
      snapshot: persistedSnapshot,
      orderData: persistedOrders,
      fetchError: persistedFetchError,
      fetchedAt: persistedFetchedAt,
      refetch: async () => {
        const fn = fetchActiveOrderFromStorageRef.current;
        if (fn) await fn();
      },
      clear: () => {
        try {
          // 🔴 CRITICAL HOTFIX: Clear storage sesuai scope aktif, bukan global.
          //    Jangan sampai clear() Meja 5 malah menghapus data persist Meja 1.
          clearActiveOrderStorage(scope
            ? { tenantId: scope.tenantId, branchId: scope.branchId, tableId: scope.tableId, tableNumber: scope.tableNumber }
            : undefined);
        } catch {
          /* noop */
        }
        setPersistedSnapshot({
          transactionId: null,
          orderId: null,
          submissionId: null,
          receiptNumber: null,
          meta: null,
          found: false,
        });
        setPersistedOrders(null);
        setPersistedFetchError(null);
        setPersistedFetchedAt(new Date().toISOString());
      },
    }),
    [
      persistedLoading,
      persistedSnapshot,
      persistedOrders,
      persistedFetchError,
      persistedFetchedAt,
    ],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      scope,
      scopeKey,
      setStorageScope: (nextScope: CartStorageKeyParams | null) => {
        setScope((prevScope) => {
          const nextKey = buildScopeKey(nextScope);
          const prevKey = buildScopeKey(prevScope);
          if (prevKey === nextKey && prevScope === nextScope) {
            return prevScope;
          }
          // 🔴 CRITICAL HOTFIX: Saat scope berganti (user PINDAH MEJA),
          //    SEGERA invalidate snapshot & clear storage scope LAMA.
          //    Ini mencegah Meja 5 menampilkan transactionId sisa Meja 1
          //    selama jendela sebelum useEffect (mount) re-fetch jalan.
          if (prevScope) {
            try {
              clearActiveOrderStorage({
                tenantId: prevScope.tenantId,
                branchId: prevScope.branchId,
                tableId: prevScope.tableId,
                tableNumber: prevScope.tableNumber,
              });
            } catch (_noop) {
              /* noop */
            }
          }
          setPersistedSnapshot({
            transactionId: null,
            orderId: null,
            submissionId: null,
            receiptNumber: null,
            meta: null,
            found: false,
          });
          setPersistedOrders(null);
          setPersistedFetchError(null);
          setPersistedFetchedAt(new Date().toISOString());
          return nextScope;
        });
      },
      addToCart: (productId: string) => {
        setCart((previousCart) => {
          const existingItem = previousCart.find((item) => item.productId === productId);
          if (!existingItem) {
            return [...previousCart, { productId, quantity: 1 }];
          }

          return previousCart.map((item) =>
            item.productId === productId
              ? { ...item, quantity: item.quantity + 1 }
              : item,
          );
        });
      },
      decreaseFromCart: (productId: string) => {
        setCart((previousCart) => {
          const existingItem = previousCart.find((item) => item.productId === productId);
          if (!existingItem) {
            return previousCart;
          }

          if (existingItem.quantity <= 1) {
            return previousCart.filter((item) => item.productId !== productId);
          }

          return previousCart.map((item) =>
            item.productId === productId
              ? { ...item, quantity: item.quantity - 1 }
              : item,
          );
        });
      },
      updateItemNote: (productId: string, note: string) => {
        setCart((previousCart) =>
          previousCart.map((item) =>
            item.productId === productId ? { ...item, note } : item,
          ),
        );
      },
      clearCart: () => {
        safeRemoveStorage(scopeKey);
        setCart([]);
      },
      persistedActiveOrder: persistedActiveOrderValue,
    }),
    [cart, scope, scopeKey, persistedActiveOrderValue],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);

  if (!context) {
    throw new Error("useCart must be used within a CartProvider.");
  }

  return context;
}
