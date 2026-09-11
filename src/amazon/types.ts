export interface RawAmazonCard {
  orderId: string | null;
  date: string | null;
  total: string | null;
  detailHref: string | null;
  titles: string[];
  status: string | null;
  unmatchedLabels: string[];
}

export interface RawAmazonListPage {
  lang: string | null;
  cards: RawAmazonCard[];
  hasNext: boolean;
  years: number[];
}

export interface RawSubtotalRow {
  label: string;
  amount: string;
}

export interface RawAmazonItem {
  title: string | null;
  asin: string | null;
  unitPrice: string | null;
  quantity: string | null;
  seller: string | null;
  sellerId: string | null;
}

export interface RawAmazonOrderDetail {
  lang: string | null;
  found: boolean;
  orderId: string | null;
  date: string | null;
  statuses: string[];
  items: RawAmazonItem[];
  rows: RawSubtotalRow[];
}

export interface ChallengeCheck {
  challenge: boolean;
  reason: string | null;
}
