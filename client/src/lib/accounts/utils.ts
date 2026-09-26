import type { ConnectedAccount } from "@openfinance/shared";

export interface AccountGroup {
  key: string;
  label: string;
  accounts: ConnectedAccount[];
  subtotal: number;
}

const GROUP_CONFIG = [
  { key: "banking", label: "Banking", types: ["depository"] },
  { key: "credit", label: "Credit Cards", types: ["credit"] },
  { key: "loans", label: "Loans", types: ["loan"] },
  { key: "investments", label: "Investments", types: ["investment"] },
] as const;

const LIABILITY_GROUPS = new Set(["credit", "loans"]);

export function isLiabilityGroup(groupKey: string): boolean {
  return LIABILITY_GROUPS.has(groupKey);
}

export function groupAccounts(accounts: ConnectedAccount[]): AccountGroup[] {
  const grouped = new Map<string, ConnectedAccount[]>();
  for (const config of GROUP_CONFIG) {
    grouped.set(config.key, []);
  }

  for (const account of accounts) {
    const config = GROUP_CONFIG.find((g) =>
      (g.types as readonly string[]).includes(account.type),
    );
    const key = config?.key ?? "banking";
    grouped.get(key)!.push(account);
  }

  return GROUP_CONFIG.filter(
    (config) => grouped.get(config.key)!.length > 0,
  ).map((config) => {
    const groupAccounts = grouped.get(config.key)!;
    const subtotal = groupAccounts.reduce(
      (sum, a) => sum + (a.currentBalance ? parseFloat(a.currentBalance) : 0),
      0,
    );
    return {
      key: config.key,
      label: config.label,
      accounts: groupAccounts,
      subtotal,
    };
  });
}

export interface CurrencyTotal {
  currency: string;
  amount: number;
}

/**
 * Totals balances per currency, with liabilities subtracting. Balances are not
 * converted between currencies, so each total stands on its own.
 *
 * Zero totals are dropped — a wallet like Wise can carry many currency
 * sub-accounts sitting at 0. If every total is zero, the largest is kept so
 * callers always have something to render.
 */
export function currencyTotals(accounts: ConnectedAccount[]): CurrencyTotal[] {
  const totals = new Map<string, number>();

  for (const account of accounts) {
    const currency = account.isoCurrencyCode ?? "USD";
    const balance = parseFloat(account.currentBalance ?? "0");
    if (Number.isNaN(balance)) continue;
    const isLiability = account.type === "credit" || account.type === "loan";
    totals.set(
      currency,
      (totals.get(currency) ?? 0) + (isLiability ? -balance : balance),
    );
  }

  const sorted = [...totals]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  const nonZero = sorted.filter((t) => t.amount !== 0);
  return nonZero.length > 0 ? nonZero : sorted.slice(0, 1);
}

export interface BalanceBucket {
  key: string;
  label: string;
  totals: CurrencyTotal[];
}

const BALANCE_BUCKETS = [
  { key: "cash", label: "Cash" },
  { key: "investments", label: "Investments" },
  { key: "loans", label: "Loans" },
] as const;

function balanceBucketKey(type: string): string {
  if (type === "investment") return "investments";
  if (type === "loan") return "loans";
  return "cash";
}

/**
 * Splits the headline balance into cash, investments, and loans, each totalled
 * per currency (see currencyTotals). One combined figure overstates what's on
 * hand: an RRSP or 401(k) balance can dwarf the chequing account, and a
 * mortgage would sink it. Card balances still net against cash, since that's
 * money already spent.
 *
 * Buckets with no accounts are left out.
 */
export function balanceBuckets(accounts: ConnectedAccount[]): BalanceBucket[] {
  const buckets: BalanceBucket[] = [];
  for (const { key, label } of BALANCE_BUCKETS) {
    const members = accounts.filter((a) => balanceBucketKey(a.type) === key);
    if (members.length > 0) {
      buckets.push({ key, label, totals: currencyTotals(members) });
    }
  }
  return buckets;
}

export function formatBalance(
  balance: string | null,
  currency: string | null,
): string {
  if (!balance) return "--";
  const num = parseFloat(balance);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(num);
}

export function formatSubtotal(amount: number, isLiability: boolean): string {
  const display = isLiability ? -Math.abs(amount) : amount;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(display);
}

export function formatAccountType(
  type: string,
  subtype: string | null,
): string {
  const display = subtype && subtype.toUpperCase() !== "NONE" ? subtype : type;
  return display.charAt(0).toUpperCase() + display.slice(1).replace(/_/g, " ");
}

export function getAccountLogoUrl(
  institutionUrl: string | null,
  size: number = 64,
): string | null {
  const logoDevKey = import.meta.env.VITE_LOGO_DEV_PUBLISHABLE_KEY as
    | string
    | undefined;

  if (!logoDevKey || !institutionUrl) return null;
  try {
    const url = institutionUrl.startsWith("http")
      ? institutionUrl
      : `https://${institutionUrl}`;
    const domain = new URL(url).hostname;
    return `https://img.logo.dev/${domain}?token=${logoDevKey}&size=${size}&format=png`;
  } catch {
    return null;
  }
}
