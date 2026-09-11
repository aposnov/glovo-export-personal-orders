import type { ChallengeCheck, RawAmazonListPage, RawAmazonOrderDetail } from './types.js';

export interface ListLabels {
  date: string[];
  total: string[];
  orderId: string[];
}

export function extractListPage(labels: ListLabels): RawAmazonListPage {
  const clean = (value: string | null | undefined): string | null => {
    const text = (value ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    return text === '' ? null : text;
  };
  const labelKey = (value: string | null): string =>
    (value ?? '').replace(/\s*:\s*$/, '').toLowerCase();
  const orderIdIn = (value: string | null): string | null =>
    value?.match(/\d{3}-\d{7}-\d{7}/)?.[0] ?? null;

  const cards = Array.from(document.querySelectorAll('div.order-card')).map((card) => {
    let orderId: string | null = null;
    let date: string | null = null;
    let total: string | null = null;
    const unmatchedLabels: string[] = [];

    for (const li of Array.from(card.querySelectorAll('li.order-header__header-list-item'))) {
      if (li.querySelector('.yohtmlc-recipient')) continue;
      const labelEl = li.querySelector('.a-text-caps');
      const label = labelKey(clean(labelEl?.textContent));
      if (!label) continue;

      const valueEl =
        li.querySelector('.yohtmlc-order-id span[dir="ltr"]') ??
        li.querySelector('span.aok-break-word') ??
        Array.from(li.querySelectorAll('span')).find(
          (span) => span !== labelEl && !span.contains(labelEl as Node) && clean(span.textContent) !== null,
        ) ??
        null;
      const value = clean(valueEl?.textContent);

      if (labels.date.includes(label)) date = value;
      else if (labels.total.includes(label)) total = value;
      else if (labels.orderId.includes(label)) orderId = orderIdIn(value);
      else unmatchedLabels.push(label);
    }

    const detailAnchor = card.querySelector('a[href*="order-details"]');
    const detailHref = detailAnchor?.getAttribute('href') ?? null;
    if (orderId === null) {
      orderId =
        orderIdIn(clean(card.querySelector('.yohtmlc-order-id')?.textContent)) ??
        (detailHref ? orderIdIn(decodeURIComponent(detailHref)) : null);
    }

    const titles = Array.from(card.querySelectorAll('.yohtmlc-product-title'))
      .map((el) => clean(el.textContent))
      .filter((title): title is string => title !== null);
    const status = clean(card.querySelector('.yohtmlc-shipment-status-primaryText')?.textContent);

    return { orderId, date, total, detailHref, titles, status, unmatchedLabels };
  });

  const years = Array.from(document.querySelectorAll('select[name="timeFilter"] option'))
    .map((option) => option.getAttribute('value') ?? '')
    .filter((value) => /^year-\d{4}$/.test(value))
    .map((value) => Number(value.slice(5)));

  return {
    lang: document.documentElement.lang || null,
    cards,
    hasNext: document.querySelector('ul.a-pagination li.a-last a') !== null,
    years,
  };
}

export function extractDetailPage(): RawAmazonOrderDetail {
  const clean = (value: string | null | undefined): string | null => {
    const text = (value ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    return text === '' ? null : text;
  };
  const component = (scope: ParentNode, name: string): Element | null =>
    scope.querySelector(`[data-component="${name}"]`);
  const root = document.querySelector('#orderDetails');
  const lang = document.documentElement.lang || null;

  if (!root) {
    return { lang, found: false, orderId: null, date: null, statuses: [], items: [], rows: [] };
  }

  const orderId = clean(component(root, 'orderId')?.textContent)?.match(/\d{3}-\d{7}-\d{7}/)?.[0] ?? null;
  const date = clean(component(root, 'orderDate')?.textContent);
  const statuses = Array.from(root.querySelectorAll('[data-component="shipmentStatus"]'))
    .map((el) => clean(el.textContent))
    .filter((status): status is string => status !== null);

  const seen = new Set<Element>();
  const items = Array.from(root.querySelectorAll('[data-component="purchasedItems"] [data-component="itemTitle"]'))
    .map((titleEl) => titleEl.closest('.a-fixed-left-grid') ?? titleEl.parentElement)
    .filter((grid): grid is Element => grid !== null && !seen.has(grid) && Boolean(seen.add(grid)))
    .map((grid) => {
      const titleEl = component(grid, 'itemTitle');
      const titleLink = titleEl?.querySelector('a[href*="/dp/"]');
      const asin = titleLink?.getAttribute('href')?.match(/\/dp\/([A-Z0-9]{10})(?:[/?]|$)/)?.[1] ?? null;
      const priceEl = component(grid, 'unitPrice');
      const unitPrice = clean(priceEl?.querySelector('.a-offscreen')?.textContent) ?? clean(priceEl?.textContent);
      const merchantEl = component(grid, 'orderedMerchant');
      const sellerHref = merchantEl?.querySelector('a[href*="seller="]')?.getAttribute('href') ?? null;
      const sellerId = sellerHref?.match(/[?&]seller=([A-Z0-9]+)/i)?.[1] ?? null;

      return {
        title: clean(titleEl?.textContent),
        asin,
        unitPrice,
        quantity: clean(component(grid, 'quantity')?.textContent),
        seller: clean(merchantEl?.textContent),
        sellerId,
      };
    });

  const rows = Array.from(root.querySelectorAll('[data-component="chargeSummary"] .od-line-item-row'))
    .map((row) => ({
      label: clean(row.querySelector('.od-line-item-row-label')?.textContent),
      amount: clean(row.querySelector('.od-line-item-row-content')?.textContent),
    }))
    .filter((row): row is { label: string; amount: string } => row.label !== null && row.amount !== null);

  return { lang, found: true, orderId, date, statuses, items, rows };
}

export function detectChallenge(): ChallengeCheck {
  const path = location.pathname;
  if (path.startsWith('/ap/')) return { challenge: true, reason: `path ${path}` };
  if (path.includes('/errors/validateCaptcha')) return { challenge: true, reason: `path ${path}` };

  const tells = [
    '#aa-challenge-page-captcha-container',
    '.amzn-captcha-modal',
    'script[src*="awswaf.com"]',
    'form[action$="validateCaptcha"]',
    'input[id^="captchacharacters"]',
    'form#verification-code-form',
  ];
  for (const selector of tells) {
    if (document.querySelector(selector)) return { challenge: true, reason: selector };
  }
  return { challenge: false, reason: null };
}
