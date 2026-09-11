import type { Page } from 'playwright';
import type { NormalizedOrder, Warning } from '../core/types.js';
import { evaluateInPage } from './evaluate.js';
import { extractDetailPage, extractListPage } from './extract.js';
import { allListLabels, localeFromLang, parseAmazonDate, type AmazonLocale } from './locale.js';
import { normalizeAmazonOrder } from './normalize.js';
import { checkChallenge, isAuthPath } from './session.js';
import type { RawAmazonCard, RawAmazonListPage, RawAmazonOrderDetail } from './types.js';
import { detailPath, listPath } from './urls.js';

const LIST_DELAY_MS = 1_000;
const DETAIL_DELAY_MS = 1_500;
const CHALLENGE_POLL_MS = 2_000;
const CHALLENGE_TIMEOUT_MS = 5 * 60_000;
const MAX_PAGES_PER_YEAR = 200;

export interface Loader {
  page: Page;
  apex: string;
  log: (message: string) => void;
  loads: number;
}

export interface WalkOptions {
  from: string;
  to: string;
  onList?: (year: number, page: number, cards: number) => void;
  onDetail?: (done: number, total: number) => void;
}

export interface AmazonRun {
  orders: NormalizedOrder[];
  warnings: Warning[];
  cardsSeen: number;
}

async function goto(loader: Loader, url: string): Promise<void> {
  await loader.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  loader.loads += 1;
}

export async function loadPage(loader: Loader, path: string): Promise<void> {
  const url = `${loader.apex}${path}`;
  await goto(loader, url);

  const deadline = Date.now() + CHALLENGE_TIMEOUT_MS;
  let announced = false;
  let reloads = 0;

  for (;;) {
    const check = await checkChallenge(loader.page);
    if (!check.challenge) {
      if (!announced) return;
      const landed = new URL(loader.page.url()).pathname;
      if (landed === new URL(url).pathname || reloads >= 2) return;
      reloads += 1;
      await goto(loader, url);
      announced = false;
      continue;
    }

    if (!announced) {
      const what = isAuthPath(loader.page.url()) ? 'asking you to sign in again' : `showing a check (${check.reason})`;
      loader.log(`\nAmazon is ${what} in the browser window — solve it there, the export continues by itself`);
      announced = true;
    }
    if (Date.now() > deadline) {
      throw new Error(`Amazon check not solved within ${CHALLENGE_TIMEOUT_MS / 60_000} minutes`);
    }
    await loader.page.waitForTimeout(CHALLENGE_POLL_MS);
  }
}

export async function fetchListPage(loader: Loader, year: number, page: number): Promise<RawAmazonListPage> {
  await loadPage(loader, listPath(year, page));
  return evaluateInPage(loader.page, extractListPage, allListLabels());
}

export async function fetchDetailPage(loader: Loader, orderId: string): Promise<RawAmazonOrderDetail> {
  await loadPage(loader, detailPath(orderId));
  return evaluateInPage(loader.page, extractDetailPage);
}

interface Candidate {
  card: RawAmazonCard;
  locale: AmazonLocale | null;
}

export async function exportAmazonOrders(loader: Loader, options: WalkOptions): Promise<AmazonRun> {
  const warnings: Warning[] = [];
  const fromYear = Number(options.from.slice(0, 4));
  const toYear = Number(options.to.slice(0, 4));
  const candidates = new Map<string, Candidate>();
  const unmatchedLabels = new Set<string>();
  const unsupportedLangs = new Set<string>();
  let availableYears: number[] | null = null;
  let cardsSeen = 0;

  for (let year = toYear; year >= fromYear; year -= 1) {
    if (availableYears !== null && !availableYears.includes(year)) continue;
    let previousFirstId: string | null = null;

    for (let pageNo = 1; pageNo <= MAX_PAGES_PER_YEAR; pageNo += 1) {
      if (pageNo > 1) await loader.page.waitForTimeout(LIST_DELAY_MS);
      const list = await fetchListPage(loader, year, pageNo);
      if (availableYears === null && list.years.length > 0) availableYears = list.years;

      const locale = localeFromLang(list.lang);
      if (locale === null && list.cards.length > 0) unsupportedLangs.add(list.lang ?? '');
      options.onList?.(year, pageNo, list.cards.length);
      if (list.cards.length === 0) break;

      const firstId = list.cards[0]?.orderId ?? null;
      if (firstId !== null && firstId === previousFirstId) break;
      previousFirstId = firstId;

      for (const card of list.cards) {
        cardsSeen += 1;
        for (const label of card.unmatchedLabels) unmatchedLabels.add(label);
        if (card.orderId === null) {
          warnings.push({
            orderId: null,
            kind: 'missing_order_id',
            detail: `list ${year} page ${pageNo}: card without an order id, skipped`,
          });
          continue;
        }
        if (candidates.has(card.orderId)) continue;
        const date = parseAmazonDate(card.date, locale);
        if (date !== null && (date < options.from || date > options.to)) continue;
        candidates.set(card.orderId, { card, locale });
      }

      if (!list.hasNext) break;
    }
  }

  for (const lang of unsupportedLangs) {
    warnings.push({
      orderId: null,
      kind: 'unsupported_locale',
      detail: `page lang "${lang}" is not es/en; labels were matched against every known table`,
    });
  }
  if (unmatchedLabels.size > 0) {
    warnings.push({
      orderId: null,
      kind: 'unmatched_header_label',
      detail: `order card labels not in the locale tables: ${[...unmatchedLabels].join(', ')}`,
    });
  }

  const entries = [...candidates.values()];
  const orders: NormalizedOrder[] = [];
  let done = 0;

  for (const { card, locale } of entries) {
    if (done > 0) await loader.page.waitForTimeout(DETAIL_DELAY_MS);
    let detail: RawAmazonOrderDetail | null = null;

    if (card.detailHref === null || card.detailHref.includes('order-details')) {
      const extracted = await fetchDetailPage(loader, card.orderId as string);
      detail = extracted.found ? extracted : null;
    }

    const result = normalizeAmazonOrder(detail, card, localeFromLang(detail?.lang) ?? locale);
    orders.push(result.order);
    warnings.push(...result.warnings);
    done += 1;
    options.onDetail?.(done, entries.length);
  }

  return { orders, warnings, cardsSeen };
}
