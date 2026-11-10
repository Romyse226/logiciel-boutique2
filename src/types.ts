export type CategoryColor =
  | 'orange' | 'blue' | 'yellow' | 'violet' | 'turquoise'
  | 'red' | 'slate' | 'cyan' | 'amber' | 'green';

export type UserRole = 'gerant' | 'employe';

export interface UserProfile {
  role: UserRole;
  name: string;
  /** "Autoriser à modifier les informations du stock" */
  canEditCatalog: boolean;
  /** "Autoriser à ajouter de nouveaux produits" */
  canAddProducts: boolean;
  /** Identifiant serveur de l'acteur (null = pas encore identifié). */
  employeeId: string | null;
  /** Jeton secret vérifié en base à chaque écriture. */
  accessToken: string;
  /** true si cet appareil est celui du boss. */
  isOwner: boolean;
  /** Jeton d'appareil, utilisé pour réclamer la propriété au premier lancement. */
  deviceToken: string;
  /** true quand le boss a renseigné son nom et son téléphone (page d'accueil). */
  onboarded: boolean;
  /** Numéro de téléphone du boss (saisi à l'inscription). */
  phone: string | null;
}

export type EmployeeStatus = 'invited' | 'active' | 'suspended';

export interface Employee {
  id: string;
  name: string;
  phone: string | null;
  status: EmployeeStatus;
  can_edit_catalog: boolean;
  can_add_products: boolean;
  access_token: string;
  /** Nom du boss qui a suspendu l'accès (renseigné par le serveur). */
  suspended_by?: string | null;
  created_at: string;
}

export type Permission = 'edit_catalog' | 'add_products' | 'cancel_sale' | 'manage_employees';

export interface ProductInput {
  id?: string;
  name: string;
  category_id: string | null;
  image_url: string | null;
  /**
   * Clé d'image stable (`image_key`), indépendante de l'identifiant du produit.
   * Sert à retrouver l'image standard (voir `productImages.ts`). Ne pas confondre
   * avec `image_url`, qui est la photo personnalisée du commerçant.
   */
  image_key?: string | null;
  stock_qty: number | null;
  low_stock_threshold: number;
  price_gros: number;
  price_detail: number;
  idempotency_key?: string | null;
}

export interface ProductCategory {
  id: string;
  slug: string;
  name: string;
  color: CategoryColor;
  icon: string | null;
  sort_order: number;
}

export interface ProductSaleUnit {
  id: string;
  product_id: string;
  unit: string;
  price: number;
  factor_to_stock: number;
  is_default: boolean;
  allow_decimal: boolean;
}

export interface Product {
  id: string;
  store_id?: string | null;
  category_id: string | null;
  name: string;
  description: string | null;
  /** Photo personnalisée du commerçant (prioritaire sur l'image standard). */
  image_url: string | null;
  /** Clé d'image standard stable (voir `productImages.ts`). Null = aucune. */
  image_key?: string | null;
  stock_unit: string;
  stock_qty: number | null;
  initial_stock_qty?: number | null;
  low_stock_threshold: number;
  is_active: boolean;
  is_archived: boolean;
  category?: ProductCategory | null;
  sale_units?: ProductSaleUnit[];
}

export interface CartLine {
  key: string;
  product: Product;
  unit: string;
  price: number;
  factorToStock: number;
  allowDecimal: boolean;
  quantity: number;
}

export interface SaleItem {
  id: string;
  product_id: string;
  product_name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  factor_to_stock: number;
  stock_decrement: number;
  restocked: boolean;
}

export type SaleStatus = 'paid' | 'cancelled';

export interface Sale {
  id: string;
  reference: string;
  total: number;
  amount_received: number;
  status: SaleStatus;
  customer_name: string | null;
  customer_phone: string | null;
  note: string | null;
  created_at: string;
  created_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  sale_items?: SaleItem[];
}

export interface StockMovement {
  id: string;
  product_id: string;
  sale_id: string | null;
  reason: 'sale' | 'arrival' | 'cancellation' | 'adjustment';
  delta: number;
  unit: string;
  quantity: number;
  created_by: string | null;
  note: string | null;
  created_at: string;
  product?: { name: string } | null;
}

export interface StoreInfo {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  is_demo: boolean;
}

export interface RegisterSaleResult {
  ok: boolean;
  sale_id: string;
  reference: string;
  total: number;
  amount_received: number;
  status: SaleStatus;
  replayed?: boolean;
  error?: string;
}

export interface ArrivalResult {
  ok: boolean;
  product_id: string;
  new_stock_qty: number;
  unit: string;
  error?: string;
}

export interface CancelSaleResult {
  ok: boolean;
  sale_id: string;
  reference: string;
  restocked_lines: number;
  error?: string;
}

export interface RegisterSaleInput {
  storeId?: string | null;
  idempotencyKey: string;
  items: Array<{ product_id: string; unit: string; quantity: number; unit_price: number }>;
  amountReceived: number | null;
  customerName?: string | null;
  customerPhone?: string | null;
  note?: string | null;
  createdBy?: string | null;
  /** Identifiants de l'acteur : permet au serveur de refuser un accès retiré. */
  actorId?: string | null;
  actorToken?: string | null;
}

export interface PendingOperation {
  id: string;
  type: 'sale' | 'arrival' | 'adjust_stock';
  payload: unknown;
  createdAt: number;
  attempts: number;
  lastError?: string;
}
