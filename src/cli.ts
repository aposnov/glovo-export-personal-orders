import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openSession, PROFILE_DIR } from './browser.js';
import { Fetcher } from './core/fetcher.js';
import { fetchOrdersInRange, listOrderIds } from './core/orders.js';
import { BrowserTransport } from './transport/browser.js';
import { printSummary } from './report.js';
import { readClaims, waitForLogin, type AccountClaims } from './session.js';
import type { ExportFile } from './core/types.js';

const USAGE = `
glovo-export

  npm run login
  npm run export -- --from 2025-01-01 --to 2026-12-31 [--expect-user <id>] [--out <path>]
`;

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

    printSummary(file, outputPath);
    return 0;
  } finally {
    await session.close();
  }
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

    if (!values.from || !values.to) {
      console.error('--from and --to are required (YYYY-MM-DD)');
      console.error(USAGE);
      return 1;
    }

    const defaultOut = `out/glovo-orders-${values.from.slice(0, 4)}-${values.to.slice(0, 4)}.json`;
    return runExport({
      from: values.from,
      to: values.to,
      out: values.out ?? defaultOut,
      expectUser: values['expect-user'],
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
