"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { WEB_ORDER_CART_STORAGE_KEY } from "../lib/app-storage";

export type CartItem = {
  productId: string;
  quantity: number;
  note?: string;
};

type CartContextValue = {
  cart: CartItem[];
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

function getInitialCart(): CartItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawCart = window.localStorage.getItem(WEB_ORDER_CART_STORAGE_KEY);
    if (!rawCart) {
      return [];
    }

    const parsedCart = JSON.parse(rawCart) as unknown;
    if (!Array.isArray(parsedCart)) {
      window.localStorage.removeItem(WEB_ORDER_CART_STORAGE_KEY);
      return [];
    }

    return parsedCart
      .map((item) => normalizeCartItem(item))
      .filter((item): item is CartItem => Boolean(item));
  } catch (_error) {
    window.localStorage.removeItem(WEB_ORDER_CART_STORAGE_KEY);
    return [];
  }
}

type CartProviderProps = {
  children: ReactNode;
};

export function CartProvider({ children }: CartProviderProps) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [hasLoadedCart, setHasLoadedCart] = useState(false);

  useEffect(() => {
    setCart(getInitialCart());
    setHasLoadedCart(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedCart) {
      return;
    }

    try {
      window.localStorage.setItem(WEB_ORDER_CART_STORAGE_KEY, JSON.stringify(cart));
    } catch (_error) {
      window.localStorage.removeItem(WEB_ORDER_CART_STORAGE_KEY);
    }
  }, [cart, hasLoadedCart]);

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
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
        window.localStorage.removeItem(WEB_ORDER_CART_STORAGE_KEY);
        setCart([]);
      },
    }),
    [cart],
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
