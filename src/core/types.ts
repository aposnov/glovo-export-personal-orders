export interface RawListEntry {
  orderId?: number | string;
  content?: { title?: string | null; body?: Array<{ type?: string; data?: string }> | null } | null;
  footer?: { left?: { type?: string; data?: string } | null; right?: unknown } | null;
  layoutType?: string | null;
  style?: string | null;
}

export interface RawListResponse {
  orders?: RawListEntry[];
  pagination?: { currentLimit?: number; next?: { offset?: number | string } | null } | null;
}

export interface RawBoughtProduct {
  name?: string | null;
  quantity?: string | number | null;
  quantityDescription?: string | null;
  price?: string | null;
  originalPrice?: string | null;
  customizationsDescription?: string | null;
  promotionDescription?: string | null;
  freeProduct?: boolean | null;
  displayStyle?: string | null;
  notice?: string | null;
}

export interface RawPricingLine {
  type?: string | null;
  label?: string | null;
  amount?: string | null;
  finalAmount?: string | null;
  displayStyle?: string | null;
  note?: string | null;
}

export interface RawOrderDetail {
  id?: number | string;
  code?: string | null;
  creationTime?: unknown;
  currentStatus?: { type?: string | null; creationTime?: number | null } | null;
  storeId?: number | string | null;
  storeName?: string | null;
  storeSlug?: string | null;
  vertical?: string | null;
  type?: string | null;
  subtype?: string | null;
  boughtProducts?: RawBoughtProduct[] | null;
  pricingBreakdown?: { lines?: RawPricingLine[] | null } | null;
  refunded?: boolean | null;
  recentlyCancelled?: boolean | null;
  handlingStrategy?: { type?: string | null } | string | null;
  shortSummary?: string | null;
}

export interface NormalizedItem {
  name: string | null;
  quantity: number;
  lineTotal: number | null;
  originalLineTotal: number | null;
  discount: number | null;
  unitPrice: number | null;
  charged: boolean;
  notice: string | null;
  customizations: string | null;
  promotion: string | null;
  freeProduct: boolean;
}

export interface NormalizedTotalLine {
  type: string | null;
  label: string | null;
  amount: number | null;
  raw: string | null;
}

export interface NormalizedOrder {
  id: string;
  date: string | null;
  store: { id: string | null; name: string | null; slug: string | null };
  status: string | null;
  cancelled: boolean;
  refunded: boolean;
  excludedFromSpend: 'cancelled' | null;
  vertical: string | null;
  handling: string | null;
  currency: string | null;
  summary: string | null;
  items: NormalizedItem[];
  totals: {
    products: number | null;
    delivery: number | null;
    total: number | null;
    lines: NormalizedTotalLine[];
  };
  validation: { productsMatch: boolean | null; delta: number | null };
}

export interface Warning {
  orderId: string | null;
  kind: string;
  detail: string;
}

export interface NormalizeResult {
  order: NormalizedOrder;
  warnings: Warning[];
}

export interface ExportFile {
  meta: {
    exportedAt: string;
    accountUserId: string | null;
    grantType: string | null;
    accountRole: string | null;
    range: { from: string; to: string };
    ordersSeen: number;
    ordersExported: number;
    requestCount: number;
    warnings: Warning[];
  };
  orders: NormalizedOrder[];
}
