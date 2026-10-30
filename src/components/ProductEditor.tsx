import { useEffect, useMemo, useRef, useState } from 'react';
import type { Product, ProductCategory } from '@/types';
import { classNames } from '@/lib/format';
import { pricesOf } from '@/lib/product';
import { resolveProductImageSrc } from '@/lib/productImages';
import { CategoryIcon } from './CategoryIcon';
import { userMessage } from '@/lib/errors';
import { X, Check, Loader2, Camera, Image as ImageIcon, ChevronLeft, ChevronDown } from 'lucide-react';

export interface ProductFormValue {
  name: string;
  category_id: string | null;
  image_url: string | null;
  price_gros: number;
  price_detail: number;
  stock_qty: number | null;
  low_stock_threshold: number;
}

interface Props {
  open: boolean;
  /** null = formulaire "Nouveau produit" ; sinon formulaire du crayon. */
  product: Product | null;
  categories: ProductCategory[];
  onClose: () => void;
  onSubmit: (value: ProductFormValue, imageFile: File | null) => Promise<{ ok: boolean; error?: string }>;
}

function digitsOnly(v: string): string {
  return v.replace(/[^0-9]/g, '');
}

export function ProductEditor({ open, product, categories, onClose, onSubmit }: Props) {
  const [mode, setMode] = useState<'edit' | 'create'>('create');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [priceGros, setPriceGros] = useState('');
  const [priceDetail, setPriceDetail] = useState('');
  const [stockQty, setStockQty] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode(product ? 'edit' : 'create');
    setName(product?.name ?? '');
    setCategoryId(product?.category_id ?? categories[0]?.id ?? null);
    const prices = product ? pricesOf(product) : { gros: 0, detail: 0 };
    setPriceGros(prices.gros > 0 ? String(prices.gros) : '');
    setPriceDetail(prices.detail > 0 ? String(prices.detail) : '');
    setStockQty(product?.stock_qty == null ? '' : String(product.stock_qty));
    setImageUrl(product?.image_url ?? null);
    setImageFile(null);
    setError(null);
    setSubmitting(false);
  }, [open, product, categories]);

  // Aperçu de la photo : la sélection locale d'abord, sinon la photo/image
  // déjà associée au produit (photo commerçant `image_url` ou image du
  // catalogue `image_key`). Sans image, on retombe sur l'icône de catégorie.
  // Ce hook reste AVANT le retour anticipé : l'ordre des hooks ne doit jamais
  // dépendre de `open`.
  const previewSrc = useMemo(
    () => imageUrl ?? (product ? resolveProductImageSrc(product) : null),
    [imageUrl, product],
  );

  if (!open) return null;

  const isEdit = mode === 'edit';

  function pickImage(file: File) {
    setImageFile(file);
    setImageUrl(URL.createObjectURL(file));
  }

  async function handleSubmit() {
    if (submitting) return;
    if (!name.trim()) { setError('Le nom du produit est requis.'); return; }
    const gros = Number(priceGros) || 0;
    const detail = Number(priceDetail) || 0;
    if (gros <= 0 && detail <= 0) { setError('Renseignez au moins un prix.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await onSubmit(
        {
          name: name.trim(),
          category_id: categoryId,
          image_url: imageUrl,
          price_gros: gros,
          price_detail: detail,
          stock_qty: stockQty === '' ? null : Number(stockQty),
          low_stock_threshold: isEdit ? (product?.low_stock_threshold ?? 0) : 0,
        },
        imageFile,
      );
      if (!res.ok) { setError(res.error ?? 'Échec de l’enregistrement.'); setSubmitting(false); return; }
      setSubmitting(false);
      onClose();
    } catch (e) {
      setError(userMessage(e));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={submitting ? undefined : onClose} aria-hidden />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex items-center gap-1 rounded-xl px-2 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          >
            <ChevronLeft size={20} /> Retour
          </button>
          <h2 className="text-base font-extrabold text-slate-800">{isEdit ? 'Modifier le produit' : 'Nouveau produit'}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
            aria-label="Fermer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* Photo */}
          <div className="flex items-center gap-3">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-200">
              {previewSrc ? (
                /* Aperçu carré 1:1 : `object-cover` remplit le cadre (recadrage
                   centré) au lieu de laisser des bandes vides. */
                <img src={previewSrc} alt="" className="h-full w-full object-cover" />
              ) : (
                <CategoryIcon slug={categories.find((cat) => cat.id === categoryId)?.slug} size={36} rounded="full" />
              )}
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200">
                <Camera size={18} /> Appareil photo
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pickImage(f); }} />
              </label>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200">
                <ImageIcon size={18} /> Galerie
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pickImage(f); }} />
              </label>
            </div>
          </div>

          <Field label="Nom du produit">
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
          </Field>

          <div>
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Catégorie</span>
            <CategorySelect value={categoryId} categories={categories} onChange={setCategoryId} disabled={submitting} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <PriceField label="Prix Gros (facultatif)" value={priceGros} onChange={setPriceGros} />
            <PriceField label="Prix Détail (facultatif)" value={priceDetail} onChange={setPriceDetail} />
          </div>
          <p className="-mt-2 text-xs text-slate-500">Renseigne un prix de gros, un prix de détail, ou les deux.</p>

          <Field label={isEdit ? 'Nouveau Stock' : 'Stock actuel'}>
            <input inputMode="numeric" value={stockQty} onChange={(e) => setStockQty(digitsOnly(e.target.value))} placeholder="0" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
          </Field>

          {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700 ring-1 ring-red-200">{error}</p>}
        </div>

        <div className="border-t border-slate-100 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-3.5 text-base font-bold text-white shadow transition hover:opacity-95 active:scale-[0.99] disabled:opacity-50"
          >
            {submitting
              ? <><Loader2 size={20} className="animate-spin" /> Enregistrement…</>
              : <><Check size={20} /> {isEdit ? 'Enregistrer' : 'Créer le produit'}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={classNames('block')}>
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

/** Champ de prix avec suffixe « F » purement visuel (jamais enregistré). */
function PriceField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <div className="flex items-center rounded-xl border border-slate-200 focus-within:border-orange-400">
        <input
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(digitsOnly(e.target.value))}
          placeholder="0"
          aria-label={`${label} en FCFA`}
          className="min-w-0 flex-1 rounded-l-xl bg-transparent px-2 py-2.5 text-sm outline-none"
        />
        <span className="pl-1 pr-3 text-sm font-bold text-slate-500" aria-hidden>F</span>
      </div>
    </div>
  );
}

/**
 * Menu de catégorie personnalisé : remplace le `<select>` natif dans les
 * formulaires d'ajout ET de modification. Le panneau s'ouvre dans le flux
 * (il pousse le contenu suivant), ce qui évite tout rognage par la zone de
 * défilement du formulaire. Fermeture au clic/toucher à l'extérieur et via
 * la touche Échap ; état sélectionné mis en évidence.
 */
function CategorySelect({
  value, categories, onChange, disabled,
}: {
  value: string | null;
  categories: ProductCategory[];
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = categories.find((c) => c.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref}>
      <button
        type="button"
        onClick={() => { if (!disabled) setOpen((o) => !o); }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={classNames(
          'flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold outline-none transition disabled:opacity-50',
          open ? 'border-orange-400 ring-2 ring-orange-100' : 'border-slate-200',
        )}
      >
        <CategoryIcon slug={current?.slug} size={22} rounded="lg" />
        <span className="min-w-0 flex-1 truncate text-slate-800">{current?.name ?? 'Choisir une catégorie'}</span>
        <ChevronDown size={18} className={classNames('shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <ul role="listbox" className="mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {categories.map((cat) => {
            const selected = cat.id === value;
            return (
              <li key={cat.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => { onChange(cat.id); setOpen(false); }}
                  className={classNames(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-semibold transition',
                    selected ? 'bg-orange-50 text-orange-700' : 'text-slate-700 hover:bg-slate-100',
                  )}
                >
                  <CategoryIcon slug={cat.slug} size={20} rounded="lg" />
                  <span className="min-w-0 flex-1 truncate">{cat.name}</span>
                  {selected && <Check size={16} className="shrink-0 text-orange-600" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
