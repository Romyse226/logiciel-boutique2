import { useMemo, useState } from 'react';
import { Mic, Search, X, Filter, Plus, Pencil, ChevronLeft, Loader2 } from 'lucide-react';
import type { Product, ProductCategory } from '@/types';
import { ProductCard } from '@/components/ProductCard';
import { colorOf } from '@/lib/colors';
import { classNames } from '@/lib/format';
import { usePullToRefresh, PullToRefreshBar } from '@/lib/usePullToRefresh';

interface Props {
  products: Product[];
  categories: ProductCategory[];
  /** Autorisation "modifier les informations du stock". */
  canEditCatalog: boolean;
  /** Autorisation "ajouter de nouveaux produits". */
  canAddProducts: boolean;
  onSelect: (p: Product) => void;
  onEdit: (p: Product) => void;
  onDelete: (p: Product) => void;
  onNewProduct: () => void;
  onNotify: (message: string) => void;
  /** Tirer vers le bas : synchronise puis recharge les données. */
  onRefresh: () => void | Promise<void>;
  /** Retour vers l'accueil (visible à toutes les étapes de la vente). */
  onBack: () => void;
  editMode: boolean;
  onEditModeChange: (enabled: boolean) => void;
  onCreateCategory: (name: string) => Promise<void>;
  onDeleteCategory: (category: ProductCategory) => Promise<void>;
}

export function SellPage({
  products, categories, canEditCatalog, canAddProducts,
  onSelect, onEdit, onDelete, onNewProduct, onNotify, onRefresh, onBack,
  editMode, onEditModeChange,
  onCreateCategory, onDeleteCategory,
}: Props) {
  const pull = usePullToRefresh(onRefresh);
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [pendingCategoryDelete, setPendingCategoryDelete] = useState<ProductCategory | null>(null);
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [recognitionSupported] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (activeCat && p.category_id !== activeCat && p.category?.slug !== activeCat) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.category?.name.toLowerCase().includes(q) ?? false);
    });
  }, [products, query, activeCat]);

  async function submitCategory() {
    if (categoryBusy) return;
    if (!categoryName.trim()) {
      setCategoryError('Le nom de la catégorie est requis.');
      return;
    }
    setCategoryBusy(true);
    setCategoryError(null);
    try {
      await onCreateCategory(categoryName.trim());
      setCategoryName('');
      setAddCategoryOpen(false);
    } catch (error) {
      setCategoryError(error instanceof Error ? error.message : 'La catégorie n’a pas pu être créée.');
    } finally {
      setCategoryBusy(false);
    }
  }

  async function confirmCategoryDelete() {
    if (!pendingCategoryDelete || categoryBusy) return;
    setCategoryBusy(true);
    setCategoryError(null);
    try {
      await onDeleteCategory(pendingCategoryDelete);
      setActiveCat(null);
      setPendingCategoryDelete(null);
    } catch (error) {
      setCategoryError(error instanceof Error ? error.message : 'La catégorie n’a pas pu être supprimée.');
    } finally {
      setCategoryBusy(false);
    }
  }

  function toggleVoice() {
    if (!recognitionSupported) return;
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'fr-FR';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    setListening(true);
    rec.onresult = (e: SpeechRecognitionEvent) => {
      const txt = e.results[0]?.[0]?.transcript ?? '';
      setQuery(txt);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    try { rec.start(); } catch { setListening(false); }
  }

  return (
    <div className="space-y-4">
      <PullToRefreshBar distance={pull.distance} refreshing={pull.refreshing} />

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 active:scale-95"
            aria-label="Retour"
          >
            <ChevronLeft size={22} />
          </button>
          <h1 className="truncate text-2xl font-extrabold text-slate-800">Vendre</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Bouton crayon : active / désactive le mode édition (icônes des cartes). */}
          <button
            type="button"
            onClick={() => onEditModeChange(!editMode)}
            aria-pressed={editMode}
            aria-label={editMode ? 'Quitter le mode édition' : 'Modifier les produits'}
            title={editMode ? 'Quitter le mode édition' : 'Modifier les produits'}
            className={classNames(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 transition active:scale-95',
              editMode ? 'bg-slate-800 text-white ring-transparent' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-100',
            )}
          >
            <Pencil size={18} />
          </button>
          <button
            type="button"
            onClick={() => (canAddProducts ? onNewProduct() : onNotify('Demande au boss de t’autoriser avant d’effectuer cette action'))}
            className="flex shrink-0 items-center gap-1 rounded-xl bg-violet-600 px-3 py-2 text-sm font-bold text-white shadow active:scale-95"
          >
            <Plus size={18} />
            <span className="hidden sm:inline">Nouveau produit</span>
            <span className="sm:hidden">Nouveau produit</span>
          </button>
        </div>
      </div>

      {/* Bandeau du mode édition : permet de le quitter en un clic. */}
      {editMode && (
        <div className="flex items-center justify-between gap-2 rounded-2xl bg-slate-800 px-4 py-2.5 text-white">
          <p className="min-w-0 text-sm font-bold">Mode édition : modifiez ou supprimez un produit.</p>
          <button
            type="button"
            onClick={() => onEditModeChange(false)}
            className="shrink-0 rounded-xl bg-white/20 px-3 py-1.5 text-sm font-bold active:scale-95"
          >
            Terminer
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        {/* Mobile : barre inchangée (280 px max). PC / tablette : barre élargie. */}
        <div className="relative w-full max-w-[280px] sm:max-w-[560px] sm:flex-1">
          <Search className="absolute left-3 top-3.5 text-slate-400" size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un produit…"
            inputMode="search"
            className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-10 text-sm font-medium text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-2.5 rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
              aria-label="Effacer"
            >
              <X size={16} />
            </button>
          )}
        </div>
        {recognitionSupported && (
          <button
            type="button"
            onClick={toggleVoice}
            className={classNames(
              // Mobile : bouton 56 px d'origine. PC / tablette : redimensionné (44 px)
              // et au même niveau que « + Nouveau produit ».
              'ml-1.5 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ring-1 transition',
              'sm:ml-0 sm:h-11 sm:w-11 sm:rounded-xl',
              listening ? 'bg-red-500 text-white ring-transparent' : 'bg-white text-blue-600 ring-slate-200 hover:ring-slate-300',
            )}
            aria-label="Recherche vocale"
          >
            <Mic size={26} className={classNames('h-[26px] w-[26px] sm:h-5 sm:w-5', listening && 'animate-pulse')} />
          </button>
        )}
      </div>

      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => setActiveCat(null)}
          className={classNames(
            'shrink-0 rounded-full px-3.5 py-1.5 text-sm font-bold ring-1 transition',
            activeCat === null ? 'bg-slate-800 text-white ring-transparent' : 'bg-white text-slate-600 ring-slate-200 hover:ring-slate-300',
          )}
        >
          <Filter size={14} className="mr-1 inline" /> Toutes
        </button>
        {categories.map((cat) => {
          const c = colorOf(cat.color);
          const active = activeCat === cat.id || activeCat === cat.slug;
          return (
            <span key={cat.id} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setActiveCat(active ? null : cat.id)}
                className={classNames(
                  'rounded-full px-3.5 py-1.5 text-sm font-bold ring-1 transition',
                  editMode && canEditCatalog ? 'pr-8' : '',
                  active ? classNames(c.bg, 'text-outline text-white ring-transparent') : 'bg-white text-slate-600 ring-slate-200 hover:ring-slate-300',
                )}
              >
                {cat.name}
              </button>
              {editMode && canEditCatalog && (
                <button
                  type="button"
                  onClick={() => { setCategoryError(null); setPendingCategoryDelete(cat); }}
                  className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-red-50 text-red-600 hover:bg-red-100"
                  aria-label={`Supprimer la catégorie ${cat.name}`}
                >
                  <X size={14} />
                </button>
              )}
            </span>
          );
        })}
        {editMode && canEditCatalog && (
          <button
            type="button"
            onClick={() => { setCategoryError(null); setCategoryName(''); setAddCategoryOpen(true); }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-slate-400 bg-white text-slate-600 hover:border-slate-600 hover:text-slate-900"
            aria-label="Ajouter une catégorie"
            title="Ajouter une catégorie"
          >
            <Plus size={18} />
          </button>
        )}
      </div>

      {categoryError && !addCategoryOpen && (
        <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{categoryError}</p>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center text-slate-500 ring-1 ring-slate-100">
          Aucun produit trouvé.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {filtered.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              onSelect={onSelect}
              onEdit={onEdit}
              onDelete={onDelete}
              canEdit={canEditCatalog}
              onDenied={() => onNotify('Demande au boss de t’autoriser avant d’effectuer cette action')}
              editMode={editMode}
            />
          ))}
        </div>
      )}

      {addCategoryOpen && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-extrabold text-slate-800">Nouvelle catégorie</h2>
            <input
              autoFocus
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void submitCategory(); }}
              placeholder="Nom de la catégorie"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400"
            />
            {categoryError && <p className="text-sm font-semibold text-red-700">{categoryError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAddCategoryOpen(false)}
                disabled={categoryBusy}
                className="flex-1 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-700"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void submitCategory()}
                disabled={categoryBusy}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
              >
                {categoryBusy && <Loader2 size={16} className="animate-spin" />}
                Ajouter
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingCategoryDelete && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-extrabold text-slate-800">Supprimer cette catégorie ?</h2>
            <p className="text-sm text-slate-600">
              Les produits de « {pendingCategoryDelete.name} » seront conservés sans catégorie.
            </p>
            {categoryError && <p className="text-sm font-semibold text-red-700">{categoryError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPendingCategoryDelete(null)}
                disabled={categoryBusy}
                className="flex-1 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-700"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void confirmCategoryDelete()}
                disabled={categoryBusy}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
              >
                {categoryBusy && <Loader2 size={16} className="animate-spin" />}
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Minimal ambient types for SpeechRecognition (not in TS lib by default)
interface SpeechRecognitionEvent extends Event {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: (e: SpeechRecognitionEvent) => void;
  onerror: () => void;
  onend: () => void;
  start: () => void;
}
