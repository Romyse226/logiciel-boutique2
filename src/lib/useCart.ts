import { useCallback, useMemo, useState } from 'react';
import type { CartLine, Product } from '@/types';
import { findUnit } from '@/lib/product';

function lineKey(productId: string, unit: string): string {
  return `${productId}|${unit}`;
}

export interface UseCart {
  lines: CartLine[];
  add: (product: Product, unit: string, quantity: number) => void;
  setQuantity: (key: string, quantity: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  total: number;
  count: number;
}

export function useCart(): UseCart {
  const [lines, setLines] = useState<CartLine[]>([]);

  const add = useCallback((product: Product, unit: string, quantity: number) => {
    if (quantity <= 0) return;
    // Recherche tolérante : l'unité enregistrée peut être « DÃ©tail » (ancien encodage).
    const psu = findUnit(product.sale_units ?? [], unit);
    if (!psu) return;
    const key = lineKey(product.id, psu.unit);
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.key === key);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + quantity };
        return next;
      }
      return [
        ...prev,
        {
          key,
          product,
          // On conserve l'unité réellement enregistrée en base : c'est elle qui
          // permet au serveur de retrouver la ligne `product_sale_units` au
          // moment de l'enregistrement de la vente.
          unit: psu.unit,
          price: psu.price,
          factorToStock: psu.factor_to_stock,
          allowDecimal: psu.allow_decimal,
          quantity,
        },
      ];
    });
  }, []);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setLines((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, quantity } : l))
        .filter((l) => l.quantity > 0),
    );
  }, []);

  const remove = useCallback((key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const total = useMemo(
    () => lines.reduce((s, l) => s + l.price * l.quantity, 0),
    [lines],
  );
  const count = useMemo(
    () => lines.reduce((s, l) => s + (Number.isInteger(l.quantity) ? l.quantity : 1), 0),
    [lines],
  );

  return { lines, add, setQuantity, remove, clear, total, count };
}
