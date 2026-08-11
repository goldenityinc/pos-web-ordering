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

export type CartItem = {
  productId: string;
  quantity: number;
  note?: string;
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

  useEffect(() => {
    if (prevScopeKeyRef.current === scopeKey && hasLoadedCart) {
      return;
    }
    prevScopeKeyRef.current = scopeKey;
    setCart(loadCartFromScope(scope));
    setHasLoadedCart(true);
  }, [scopeKey, scope, hasLoadedCart]);

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
    }),
    [cart, scope, scopeKey],
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
