import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { exportAmazonOrders, fetchListPage, type Loader } from './amazon/orders.js';
import { localeFromLang, parseAmazonDate } from './amazon/locale.js';
import {
  AMAZON_PROFILE_DIR,
  checkChallenge,
  isSignedIn,
  waitForLogin as waitForAmazonLogin,
} from './amazon/session.js';
import { apexOf, DEFAULT_MARKETPLACE, ORDERS_PATH } from './amazon/urls.js';
import { openSession, PROFILE_DIR } from './browser.js';
import { Fetcher } from './core/fetcher.js';
import { parseMoney } from './core/normalize.js';
import { fetchOrdersInRange, listOrderIds } from './core/orders.js';
import { BrowserTransport } from './transport/browser.js';
import { printSummary } from './report.js';
import { readClaims, waitForLogin, type AccountClaims } from './session.js';
import type { ExportFile } from './core/types.js';

const USAGE = `
glovo-export

  npm run login
  npm run export -- --from 2025-01-01 --to 2026-12-31 [--expect-user <id>] [--out <path>]

  npm run amazon:login  [-- --marketplace amazon.es]
  npm run amazon:probe  [-- --marketplace amazon.es --year 2025]
  npm run amazon:export -- --from 2025-01-01 --to 2026-12-31 [--marketplace amazon.es] [--out <path>] [--headless]
`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function login(): Promise<number> {
  console.log(`profile: ${PROFILE_DIR}`);
  const session = await openSession(false);

  const existing = await readClaims(session.page);
  if (existing) {
    console.log('\nalready signed in:');
    printClaims(existing);
    await session.close();
    return 0;
  }

  console.log('\nsign in to Glovo in the browser window. waiting up to 5 minutes...');
  const claims = await waitForLogin(session.page, 5 * 60_000);
  await session.close();

  if (!claims) {
    console.error('no session detected. run login again.');
    return 1;
  }

  console.log('\nsigned in:');
  printClaims(claims);
  return 0;
}

function printClaims(claims: AccountClaims): void {
  console.log(`  userId     ${claims.userId ?? 'not in token'}`);
  console.log(`  grantType  ${claims.grantType ?? 'not in token'}`);
  console.log(`  role       ${claims.role ?? 'not in token'}`);
  console.log(`  expires    ${claims.expiresAt ?? '?'}`);
}

async function runExport(args: {
  from: string;
  to: string;
  out: string;
  expectUser?: string;
}): Promise<number> {
  const from = `${args.from}T00:00:00.000Z`;
  const to = `${args.to}T23:59:59.999Z`;

  const session = await openSession(true);
  const claims = await readClaims(session.page);

  if (!claims) {
    console.error('not signed in. run: npm run login');
    await session.close();
    return 1;
  }

  if (args.expectUser) {
    if (claims.userId === null) {
      console.error('cannot verify account: this token carries no userId claim. drop --expect-user to proceed.');
      await session.close();
      return 1;
    }
    if (claims.userId !== args.expectUser) {
      console.error(`account mismatch: session is userId ${claims.userId}, expected ${args.expectUser}`);
      await session.close();
      return 1;
    }
  }

  console.log(`account ${claims.userId ?? 'unidentified'} (${claims.grantType ?? claims.role ?? '?'})`);
  console.log(`range ${args.from} .. ${args.to}\n`);

  const fetcher = new Fetcher(new BrowserTransport(session.page));

  try {
    const ids = await listOrderIds(fetcher, {
      onPage: (pages, seen) => {
        process.stderr.write(`\rlist: ${pages} pages, ${seen} orders`);
      },
    });
    process.stderr.write('\n');

    const run = await fetchOrdersInRange(fetcher, ids, from, to, {
      onProgress: (examined, total, kept) => {
        process.stderr.write(`\rdetails: ${examined}/${total} examined, ${kept} in range`);
      },
    });
    process.stderr.write('\n');

    const file: ExportFile = {
      meta: {
        source: 'glovo',
        exportedAt: new Date().toISOString(),
        accountUserId: claims.userId,
        grantType: claims.grantType,
        accountRole: claims.role,
        range: { from: args.from, to: args.to },
        ordersSeen: ids.length,
        ordersExported: run.orders.length,
        requestCount: fetcher.requestCount,
        warnings: run.warnings,
      },
      orders: run.orders,
    };

    const outputPath = resolve(args.out);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');

    printSummary({
      orders: run.orders,
      seen: ids.length,
      requests: { label: 'api requests', count: fetcher.requestCount },
      warnings: run.warnings,
      outputPath,
    });
    return 0;
  } finally {
    await session.close();
  }
}

function amazonSession(marketplace: string, headless: boolean) {
  const apex = apexOf(marketplace);
  return openSession(headless, { apex, profileDir: AMAZON_PROFILE_DIR, startPath: ORDERS_PATH });
}

async function amazonLogin(marketplace: string): Promise<number> {
  const apex = apexOf(marketplace);
  console.log(`profile: ${AMAZON_PROFILE_DIR}`);
  const session = await amazonSession(marketplace, false);

  if (await isSignedIn(session.page)) {
    console.log(`\nalready signed in to ${marketplace}`);
    await session.close();
    return 0;
  }

  console.log(`\nsign in to ${marketplace} in the browser window. waiting up to 5 minutes...`);
  const ok = await waitForAmazonLogin(session.page, 5 * 60_000, `${apex}${ORDERS_PATH}`);
  await session.close();

  if (!ok) {
    console.error('no session detected. run amazon:login again.');
    return 1;
  }
  console.log(`\nsigned in to ${marketplace}`);
  return 0;
}

async function amazonProbe(marketplace: string, year: number): Promise<number> {
  const session = await amazonSession(marketplace, false);
  try {
    const challenge = await checkChallenge(session.page);
    if (!(await isSignedIn(session.page))) {
      console.error(
        challenge.challenge
          ? `challenge    yes (${challenge.reason})`
          : 'not signed in. run: npm run amazon:login',
      );
      return 1;
    }

    const loader: Loader = { page: session.page, apex: apexOf(marketplace), log: console.log, loads: 0 };
    const list = await fetchListPage(loader, year, 1);
    const locale = localeFromLang(list.lang);
    const count = (pick: (card: (typeof list.cards)[number]) => boolean): number => list.cards.filter(pick).length;
    const unmatched = [...new Set(list.cards.flatMap((card) => card.unmatchedLabels))];

    console.log(
      [
        '',
        `marketplace  ${marketplace}`,
        `year         ${year}`,
        `page lang    ${list.lang ?? '?'} (${locale ?? 'unsupported — will match all tables'})`,
        'challenge    no',
        `years seen   ${list.years.join(', ') || 'none found'}`,
        `cards        ${list.cards.length}`,
        `ids          ${count((card) => card.orderId !== null)}`,
        `dates        ${count((card) => parseAmazonDate(card.date, locale) !== null)}`,
        `totals       ${count((card) => parseMoney(card.total).value !== null)}`,
        `detail links ${count((card) => card.detailHref?.includes('order-details') ?? false)}`,
        `has next     ${list.hasNext ? 'yes' : 'no'}`,
        `unmatched    ${unmatched.join(', ') || 'none'}`,
      ].join('\n'),
    );
    return 0;
  } finally {
    await session.close();
  }
}

async function amazonExport(args: {
  from: string;
  to: string;
  out: string;
  marketplace: string;
  headless: boolean;
}): Promise<number> {
  const session = await amazonSession(args.marketplace, args.headless);
  try {
    if (!(await isSignedIn(session.page))) {
      console.error('not signed in. run: npm run amazon:login');
      return 1;
    }

    console.log(`marketplace ${args.marketplace}`);
    console.log(`range ${args.from} .. ${args.to}\n`);

    const loader: Loader = { page: session.page, apex: apexOf(args.marketplace), log: console.log, loads: 0 };
    const run = await exportAmazonOrders(loader, {
      from: args.from,
      to: args.to,
      onList: (year, page, cards) => {
        process.stderr.write(`\rlist: ${year} page ${page}, ${cards} cards`);
      },
      onDetail: (done, total) => {
        if (done === 1) process.stderr.write('\n');
        process.stderr.write(`\rdetails: ${done}/${total}`);
      },
    });
    process.stderr.write('\n');

    const file: ExportFile = {
      meta: {
        source: 'amazon',
        marketplace: args.marketplace,
        exportedAt: new Date().toISOString(),
        range: { from: args.from, to: args.to },
        ordersSeen: run.cardsSeen,
        ordersExported: run.orders.length,
        pagesLoaded: loader.loads,
        warnings: run.warnings,
      },
      orders: run.orders,
    };

    const outputPath = resolve(args.out);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');

    printSummary({
      orders: run.orders,
      seen: run.cardsSeen,
      requests: { label: 'pages loaded', count: loader.loads },
      warnings: run.warnings,
      outputPath,
      storesLabel: 'top sellers',
    });
    return 0;
  } finally {
    await session.close();
  }
}

function parseRange(from: string | undefined, to: string | undefined): { from: string; to: string } | null {
  if (!from || !to || !DATE.test(from) || !DATE.test(to)) {
    console.error('--from and --to are required (YYYY-MM-DD)');
    return null;
  }
  if (from > to) {
    console.error('--from must not be after --to');
    return null;
  }
  return { from, to };
}

async function main(): Promise<number> {
  const command = process.argv[2];

  if (command === 'login') return login();

  if (command === 'export') {
    const { values } = parseArgs({
      args: process.argv.slice(3),
      options: {
        from: { type: 'string' },
        to: { type: 'string' },
        out: { type: 'string' },
        'expect-user': { type: 'string' },
      },
      allowPositionals: false,
    });

    const range = parseRange(values.from, values.to);
    if (!range) {
      console.error(USAGE);
      return 1;
    }

    const defaultOut = `out/glovo-orders-${range.from.slice(0, 4)}-${range.to.slice(0, 4)}.json`;
    return runExport({
      from: range.from,
      to: range.to,
      out: values.out ?? defaultOut,
      expectUser: values['expect-user'],
    });
  }

  if (command === 'amazon:login' || command === 'amazon:probe' || command === 'amazon:export') {
    const { values } = parseArgs({
      args: process.argv.slice(3),
      options: {
        from: { type: 'string' },
        to: { type: 'string' },
        out: { type: 'string' },
        marketplace: { type: 'string' },
        year: { type: 'string' },
        headless: { type: 'boolean' },
      },
      allowPositionals: false,
    });

    const marketplace = (values.marketplace ?? DEFAULT_MARKETPLACE).toLowerCase().replace(/^www\./, '');
    try {
      apexOf(marketplace);
    } catch (error) {
      console.error((error as Error).message);
      return 1;
    }

    if (command === 'amazon:login') return amazonLogin(marketplace);

    if (command === 'amazon:probe') {
      const year = values.year ? Number(values.year) : new Date().getFullYear();
      if (!Number.isInteger(year) || year < 1995) {
        console.error('--year must be a four-digit year');
        return 1;
      }
      return amazonProbe(marketplace, year);
    }

    const range = parseRange(values.from, values.to);
    if (!range) {
      console.error(USAGE);
      return 1;
    }
    const defaultOut = `out/amazon-orders-${range.from.slice(0, 4)}-${range.to.slice(0, 4)}.json`;
    return amazonExport({
      from: range.from,
      to: range.to,
      out: values.out ?? defaultOut,
      marketplace,
      headless: values.headless ?? false,
    });
  }

  console.error(USAGE);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
