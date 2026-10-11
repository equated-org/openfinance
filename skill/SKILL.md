---
name: openfinance
slug: openfinance
version: 0.0.3
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
  --data-urlencode "cursor=CURSOR_VALUE" \
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
| `cursor` | string | Cursor for pagination (from previous response) |
| `pending` | boolean | Filter pending transactions |
| `status` | comma-separated | Filter by status: `active`, `hidden`, `deleted` |
| `fields` | comma-separated | Return only these fields per transaction (reduces payload) |
| `amountFilters` | JSON array | Filter by amount, e.g. `[{"operator":">","amount":50}]` |

### Transaction fields

`id`, `name`, `amount`, `date`, `authorizedDate`, `pending`, `merchantName`, `isoCurrencyCode`, `accountId`, `status`, `createdAt`, `updatedAt`

---

## 3. Query Transactions (SQL)

Run one validated SQL SELECT (maximum 2000 characters) against the unqualified `txns` relation for aggregations, grouping, and analysis. Only the caller's transactions are available; deleted transactions and hidden accounts are excluded. The query runs read-only with a 5-second timeout and a maximum of 1000 result rows. Aggregations still use all matching input rows, and smaller LIMITs and OFFSETs are preserved.

Filtering, DISTINCT, grouping, HAVING, sorting, subqueries, joins, and UNION/UNION ALL are supported. Every table source must be `txns` or a derived SELECT whose sources are `txns`. Other tables and schemas, caller-defined CTEs, window functions, SELECT INTO, locking clauses, table functions, transaction commands, and multiple statements are rejected.

Approved functions: COUNT, SUM, AVG, MIN, MAX, ABS, ROUND, CEIL, CEILING, FLOOR, LOWER, UPPER, LENGTH, TRIM, BTRIM, LTRIM, RTRIM, SUBSTRING, SUBSTR, REPLACE, DATE_TRUNC, DATE_PART, EXTRACT, TO_CHAR. CASE, COALESCE, NULLIF, GREATEST, LEAST, CURRENT_DATE, and CURRENT_TIMESTAMP are also supported. Casts are limited to built-in boolean, integer, numeric, floating-point, text, date, timestamp, and interval types. Arithmetic, comparisons, LIKE/ILIKE, IN, BETWEEN, and NULL/boolean tests are supported; custom operators, regex operators, COLLATE, and unlisted syntax are rejected. Function and type names may be unqualified or qualified with `pg_catalog`.

```bash
curl -s -X POST "$BASE_URL/api/transactions/query" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT SUM(amount), COUNT(*) FROM txns WHERE merchant_name ILIKE '\''%starbucks%'\''"}' \
  | cat
```

### `txns` CTE columns

`id`, `name`, `amount` (numeric), `date`, `authorized_date`, `merchant_name`, `pending`, `iso_currency_code`, `account_id`, `status`, `created_at`, `updated_at`

Note: SQL column names use `snake_case` (e.g. `merchant_name`), while the REST API returns `camelCase` (e.g. `merchantName`).

### Example queries

Monthly spend breakdown:
```sql
SELECT TO_CHAR(date, 'YYYY-MM') as month, SUM(amount) as total, COUNT(*) as count
FROM txns GROUP BY 1 ORDER BY 1
```

Top merchants by total spend:
```sql
SELECT COALESCE(merchant_name, name) as merchant, SUM(amount) as total
FROM txns GROUP BY 1 ORDER BY total DESC LIMIT 10
```

Spending in a date range:
```sql
SELECT SUM(amount) as total FROM txns
WHERE date >= '2026-01-01' AND date < '2026-02-01'
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

## Tips

- **Use SQL for aggregations** — monthly totals, top merchants, category breakdowns. It's faster and returns less data than fetching all transactions.
- **Use `fields` parameter** on GET /api/transactions to reduce payload size when you only need a few columns.
- **Pagination**: if there are more results, the response includes a cursor. Pass it as `cursor` in the next request.
- **Amount values** are positive for debits (money spent) and negative for credits (money received).
- When constructing SQL, always reference the `txns` CTE directly — do not define your own CTE or use transaction control statements.
