---
name: openfinance
slug: openfinance
version: 0.0.4
description: Connect bank accounts to AI models using openfinance.sh
tags:
  - finance
  - banking
  - ai
requires:
  env:
    - name: OPENFINANCE_API_KEY
      description: API key from openfinance.sh (Connect tab)
      required: true
    - name: OPENFINANCE_URL
      description: Custom API base URL (defaults to https://api.openfinance.sh)
      required: false
---

# OpenFinance Skill

Query your financial accounts and transactions via the OpenFinance API.

## Setup

1. Go to [openfinance.sh](https://openfinance.sh) and create an account
2. Link a bank account through the dashboard
3. Copy your API key from the **Connect** tab
4. Set the environment variable:
   ```bash
   export OPENFINANCE_API_KEY="your_api_key_here"
   ```

All commands below use these variables:

```
BASE_URL="${OPENFINANCE_URL:-https://api.openfinance.sh}"
AUTH_HEADER="Authorization: Bearer $OPENFINANCE_API_KEY"
```

---

## 1. Get Accounts

Fetch all connected financial accounts with balances and institution info.

```bash
curl -s "$BASE_URL/api/accounts" -H "$AUTH_HEADER" | cat
```

Response shape per account:
- `id` (number) — account ID (use for filtering transactions)
- `name`, `officialName` — account names
- `type` (e.g. "depository", "credit"), `subtype` (e.g. "checking", "credit card")
- `mask` — last 4 digits
- `currentBalance`, `availableBalance`, `isoCurrencyCode`
- `institutionName`, `institutionUrl`
- `status` — "active" or "hidden"
- `isSyncing` (boolean), `syncError` (object or null)

A non-null `syncError` means the bank connection needs the owner to sign in again. Use [Create Reconnect Link](#4-create-reconnect-link) to fix it.

---

## 2. Get Transactions

Search and filter transactions. Returns newest first by default.

```bash
curl -s -G "$BASE_URL/api/transactions" \
  -H "$AUTH_HEADER" \
  --data-urlencode "startDate=YYYY-MM-DD" \
  --data-urlencode "endDate=YYYY-MM-DD" \
  --data-urlencode "search=coffee" \
  --data-urlencode "merchants=Starbucks,Walmart" \
  --data-urlencode "accountId=123" \
  --data-urlencode "limit=100" \
  --data-urlencode "cursor=YYYY-MM-DD:ID" \
  --data-urlencode "pending=false" \
  --data-urlencode "status=active,hidden" \
  --data-urlencode "fields=name,amount,date,merchantName" \
  --data-urlencode 'amountFilters=[{"operator":">","amount":100}]' \
  | cat
```

All query parameters are **optional**. Only include the ones you need.

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `startDate` | `YYYY-MM-DD` | Start date filter |
| `endDate` | `YYYY-MM-DD` | End date filter |
| `search` | string | Search by transaction name or merchant |
| `merchants` | comma-separated | Filter by exact merchant names |
| `accountId` | number | Filter by account ID |
| `limit` | number | Max results (default 100, max 500) |
| `cursor` | string | Next page: `<date>:<id>` of the last transaction you received. Date sort only |
| `pending` | boolean | Filter pending transactions |
| `status` | comma-separated | Filter by status: `active`, `hidden`, `deleted` |
| `fields` | comma-separated | Return only these fields per transaction (reduces payload) |
| `amountFilters` | JSON array | Filter by amount, e.g. `[{"operator":">","amount":50}]` |

### Transaction fields

`id`, `name`, `amount`, `date`, `authorizedDate`, `pending`, `merchantName`, `isoCurrencyCode`, `accountId`, `status`, `createdAt`, `updatedAt`

---

## 3. Query Transactions (SQL)

Run one validated SQL SELECT (maximum 2000 characters) against the unqualified `txns` relation for aggregations, grouping, and analysis. Only the caller's transactions are available; deleted transactions and hidden accounts are excluded. The query runs read-only with a 5-second timeout and a maximum of 1000 result rows. Aggregations still use all matching input rows, and smaller LIMITs and OFFSETs are preserved.

Filtering, DISTINCT, grouping, HAVING, sorting, subqueries (including EXISTS), joins, and UNION/UNION ALL are supported, as are aggregate `FILTER (WHERE ...)` and `COUNT(DISTINCT ...)`. Every table source must be `txns` or a derived SELECT whose sources are `txns`. Other tables and schemas, caller-defined CTEs, window functions, SELECT INTO, locking clauses, table functions, transaction commands, and multiple statements are rejected.

Approved functions: COUNT, SUM, AVG, MIN, MAX, ABS, ROUND, CEIL, CEILING, FLOOR, LOWER, UPPER, LENGTH, TRIM, BTRIM, LTRIM, RTRIM, SUBSTRING, SUBSTR, REPLACE, DATE_TRUNC, DATE_PART, EXTRACT, TO_CHAR. CASE, COALESCE, NULLIF, GREATEST, LEAST, CURRENT_DATE, and CURRENT_TIMESTAMP are also supported. Other functions are rejected, including `NOW()` (use `CURRENT_TIMESTAMP`) and `STRING_AGG`. Casts are limited to built-in boolean, integer, numeric, floating-point, text, date, timestamp, and interval types. Arithmetic, comparisons, `||`, LIKE/ILIKE, IN, BETWEEN, and NULL/boolean tests are supported; custom operators, regex operators, arrays (including `ANY` over an array), COLLATE, and unlisted syntax are rejected. Function and type names may be unqualified or qualified with `pg_catalog`.

```bash
curl -s -X POST "$BASE_URL/api/transactions/query" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT SUM(amount), COUNT(*) FROM txns WHERE merchant_name ILIKE '\''%starbucks%'\''"}' \
  | cat
```

### `txns` CTE columns

`id`, `name`, `amount` (numeric), `date` (timestamp), `authorized_date`, `merchant_name`, `pending`, `iso_currency_code`, `account_id`, `status`, `created_at`, `updated_at`

Note: SQL column names use `snake_case` (e.g. `merchant_name`), while the REST API returns `camelCase` (e.g. `merchantName`).

### Before totaling

- **Sign:** a positive `amount` is money out (purchases, bills, transfers out) and a negative one is money in (income, refunds, payments received). `SUM(amount)` alone subtracts income from spending, so filter on `amount > 0` for spending.
- **Currencies:** accounts can be in different currencies. Group by `iso_currency_code`; never add amounts across currencies.
- **Transfers:** a transfer between the owner's linked accounts appears twice, as money out of one and money in on the other (a credit card payment, for example). Leaving out rows with an equal and opposite amount on another account within a few days removes most of them. Transfers to unlinked accounts or between currencies still look like spending, so check the largest rows and exclude those by name.
- **Categories:** there is no category column. Group by `COALESCE(merchant_name, name)`, or map merchants to categories with `CASE`.
- **Accounts:** `txns` has no account details. Map `account_id` to names, types and currencies with [Get Accounts](#1-get-accounts).

### Example queries

Spending this month, leaving out transfers between linked accounts:
```sql
SELECT iso_currency_code, SUM(amount) AS spent
FROM txns t
WHERE amount > 0
  AND date >= DATE_TRUNC('month', CURRENT_DATE)
  AND NOT EXISTS (
    SELECT 1 FROM txns o
    WHERE o.amount = -t.amount
      AND o.account_id <> t.account_id
      AND o.iso_currency_code = t.iso_currency_code
      AND o.date BETWEEN t.date - INTERVAL '3 days' AND t.date + INTERVAL '3 days'
  )
GROUP BY 1
```

Money in and out by month:
```sql
SELECT TO_CHAR(date, 'YYYY-MM') AS month, iso_currency_code,
  SUM(amount) FILTER (WHERE amount > 0) AS money_out,
  -SUM(amount) FILTER (WHERE amount < 0) AS money_in
FROM txns GROUP BY 1, 2 ORDER BY 1, 2
```

Top merchants in the last 90 days:
```sql
SELECT COALESCE(merchant_name, name) AS merchant, iso_currency_code,
  SUM(amount) AS total, COUNT(*) AS n
FROM txns
WHERE amount > 0 AND date >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY 1, 2 ORDER BY total DESC LIMIT 10
```

Spending by category this month (extend the `CASE` with the merchants you see):
```sql
SELECT CASE
    WHEN merchant_name IN ('Uber', 'Lyft', 'MTA') THEN 'Transit'
    WHEN merchant_name ILIKE '%coffee%' OR merchant_name ILIKE '%cafe%' THEN 'Coffee'
    ELSE 'Other'
  END AS category,
  iso_currency_code, SUM(amount) AS spent
FROM txns
WHERE amount > 0 AND date >= DATE_TRUNC('month', CURRENT_DATE)
GROUP BY 1, 2 ORDER BY spent DESC
```

Large transactions:
```sql
SELECT name, merchant_name, amount, date FROM txns
WHERE amount > 500 ORDER BY amount DESC
```

### Response shape

Success: `{ "rows": [...], "rowCount": N }`
Error: `{ "error": "error message" }` — fix the SQL and retry.

---

## 4. Create Reconnect Link

Create a public link that reconnects a disconnected account without signing in to OpenFinance. Give the URL to the account's owner. Opening it walks them through their bank's sign-in (Plaid or Quiltt), then shows the account re-syncing. Only the owner can finish this step: bank credentials and verification codes can't be sent through the API.

Find accounts that need reconnecting:

```bash
curl -s "$BASE_URL/api/accounts" -H "$AUTH_HEADER" \
  | jq '.accounts[] | select(.syncError != null) | {id, institutionName, syncError}'
```

Create a link for one of them:

```bash
curl -s -X POST "$BASE_URL/api/accounts/ACCOUNT_ID/reconnect-link" \
  -H "$AUTH_HEADER" \
  | cat
```

Response (`201`):
```json
{
  "url": "https://app.openfinance.sh/reconnect#<token>",
  "expiresAt": "2026-01-02T15:04:05.000Z",
  "accountId": 123,
  "institutionName": "Chase",
  "provider": "plaid"
}
```

- Links expire after **24 hours**. Until then the link follows the account: it offers a sign-in only while the bank needs one, and otherwise shows that the account is connected. The same link can be used again if the bank later asks for another sign-in.
- The re-sync runs in the background, so the owner can close the page as soon as they've signed in.
- To check it worked, poll `GET /api/accounts`: the account's `syncError` turns `null` as soon as the owner reconnects, and `isSyncing` stays `true` until the re-sync finishes, which can take a few minutes.
- Reconnecting repairs the account's whole bank connection, so it also fixes the other accounts linked through the same sign-in.
- `404`: no account with that ID. `422`: the account's provider (MX) isn't supported.

---

## Tips

- **Use SQL for aggregations** — monthly totals, top merchants, recurring charges. It's faster and returns less data than fetching all transactions. Read [Before totaling](#before-totaling) first.
- **Use `fields` parameter** on GET /api/transactions to reduce payload size when you only need a few columns.
- **Pagination**: the response doesn't include a cursor. If a page returns `limit` transactions, request the next one with `cursor=<date>:<id>` from the last transaction, keeping the other parameters the same. Cursors only work with the default date sort.
- **Amount values** are positive for debits (money spent) and negative for credits (money received).
- When constructing SQL, always reference the `txns` CTE directly — do not define your own CTE or use transaction control statements.
- **Disconnected accounts**: if an account has a `syncError`, create a reconnect link and send it to the owner rather than asking them to open the app.
