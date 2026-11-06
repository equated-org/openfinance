# Financial data providers

Self-hosting OpenFinance requires your own financial data provider account and credentials. Start with **Plaid Sandbox** to test the complete flow, then enable the providers you need for real accounts. You do not need all three to make a connection.

| Provider | Integration in OpenFinance | Credentials in your server environment |
| --- | --- | --- |
| [Plaid](#plaid) | Direct Plaid Link and Transactions API | `PLAID_CLIENT_ID` and the secret selected by `APP_ENV` |
| [MX](#mx) | Direct MX Platform API and Connect widget | `MX_CLIENT_ID`, `MX_API_KEY`, `MX_API_URL` |
| [Mastercard via Quiltt](#mastercard-via-quiltt) | Quiltt Connector with Mastercard Open Finance / Finicity enabled | `QUILTT_API_SECRET`, `QUILTT_CONNECTOR_ID` |

OpenFinance stores the resulting accounts, balances, and transactions in your database. Provider pricing, production approval, institution coverage, and available history are separate from the OpenFinance code license.

## Before you start

1. Complete the [local development setup](development.md), including the database and Google sign-in.
2. Add the credentials below to the root `.env` file. For deployment, put the same variables in your server's environment or secret store.
3. Restart the API after changing credentials. Keep provider secrets on the server; do not add them to `VITE_` variables or commit them.
4. Use credentials and test institutions from the same provider environment. Sandbox connections do not become live connections when you change keys; link accounts again in the live environment.

## Plaid

### 1. Get credentials

Create an account in the [Plaid Dashboard](https://dashboard.plaid.com/). In **API Keys**, copy your client ID and Sandbox secret. OpenFinance requests the **Transactions** product when opening Plaid Link; ensure your account has access to it. See [Plaid's quickstart](https://plaid.com/docs/quickstart/).

### 2. Configure OpenFinance

For local testing:

```dotenv
APP_ENV=dev
PLAID_CLIENT_ID=your_plaid_client_id
PLAID_SANDBOX_SECRET=your_plaid_sandbox_secret
```

OpenFinance selects Plaid's environment as follows:

| `APP_ENV` | Plaid environment | Secret used |
| --- | --- | --- |
| `prod` | Production | `PLAID_PROD_SECRET` |
| Any other value, including `dev` or unset | Sandbox | `PLAID_SANDBOX_SECRET` |

Use the exact value `prod` for live Plaid connections; `production` is not a recognized production value in this app.

### 3. Load institutions and test

After migrations, load the institution catalog. Run from the repository root:

```sh
cd server
pnpm exec tsx src/scripts/sync-institutions.ts plaid
```

Open the web app, start adding an account, search for an institution, and choose **Plaid** if prompted. Complete Link with the test credentials in [Plaid's Sandbox guide](https://plaid.com/docs/sandbox/test-credentials/). Confirm accounts appear, then wait for the initial transaction sync. Finally, connect your AI from the **Connect** tab and ask it to list your accounts.

### 4. Use real accounts

Request Production access in the Plaid Dashboard and complete Plaid's required product and institution approvals. Then set:

```dotenv
APP_ENV=prod
PLAID_CLIENT_ID=your_plaid_client_id
PLAID_PROD_SECRET=your_plaid_production_secret
```

Restart the API and refresh the Plaid institution catalog in the production environment. Connect a real account through the app. See [Plaid's production checklist](https://plaid.com/docs/launch-checklist/) for institution-specific OAuth and launch requirements.

## MX

### 1. Get credentials

Use the [MX Client Dashboard](https://dashboard.mx.com/) to obtain your development client ID and API key. Enable the Platform API access needed for account aggregation and the Connect widget. Allowlist the public IP addresses from which your server calls MX, as required by [MX's integration checklist](https://docs.mx.com/resources/integration-checklist).

### 2. Configure OpenFinance

```dotenv
MX_CLIENT_ID=your_mx_development_client_id
MX_API_KEY=your_mx_development_api_key
MX_API_URL=https://int-api.mx.com
```

MX selects its environment through `MX_API_URL`, independently of `APP_ENV`. All three variables are required. OpenFinance creates the MX user and requests the Connect widget URL on your behalf.

### 3. Load institutions and test

Run from the repository root:

```sh
cd server
pnpm exec tsx src/scripts/sync-institutions.ts mx
```

In the web app, add an account, search for an MX test institution, and choose **MX** if prompted. Complete the Connect widget using the scenarios linked from [MX's integration checklist](https://docs.mx.com/resources/integration-checklist). Confirm accounts and transactions reach OpenFinance, then check them from your AI.

### 4. Use real accounts

Request production access through MX and complete the required registration, including institution OAuth registration where applicable. Replace the development credentials with your production credentials and set:

```dotenv
MX_CLIENT_ID=your_mx_production_client_id
MX_API_KEY=your_mx_production_api_key
MX_API_URL=https://api.mx.com
```

Allowlist the production server's outbound IP, restart the API, refresh the MX institution catalog, and link a real account. Refer to [MX's integration checklist](https://docs.mx.com/resources/integration-checklist) for the current production requirements.

## Mastercard via Quiltt

OpenFinance reaches **Mastercard Open Finance (Finicity) through Quiltt**. It does not currently have a direct Mastercard API integration. A standalone Mastercard developer key cannot replace the Quiltt credentials below.

### 1. Set up Quiltt and enable Mastercard

1. Create an account in the [Quiltt Dashboard](https://dashboard.quiltt.dev) and select a sandbox environment.
2. Enable **Finicity / Mastercard Open Finance** on the environment's **Integrations** page.
3. Create or configure a Connector with Finicity enabled and the account balances and transactions product required by OpenFinance.
4. Copy the environment's API secret and that Connector's ID. Both must belong to the same environment.

See [Quiltt's Connector tutorial](https://www.quiltt.dev/get-started/tutorials/connectors) and [Finicity integration guide](https://www.quiltt.dev/integrations/connectivity/finicity).

### 2. Configure OpenFinance

```dotenv
QUILTT_API_SECRET=your_quiltt_environment_api_secret
QUILTT_CONNECTOR_ID=your_quiltt_connector_id
```

Quiltt's environment is selected by its credentials and Connector configuration, independently of `APP_ENV`. Keep the API secret private; the app obtains a user session token from the server to open the Connector.

### 3. Test the connection

In OpenFinance's add-account dialog, choose **Search all institutions** to open Quiltt's own institution search. In a Finicity-enabled sandbox Connector, select the Finicity test institution and use the test logins from [Quiltt's Finicity guide](https://www.quiltt.dev/integrations/connectivity/finicity). Confirm accounts and transactions appear in OpenFinance.

There is no Mastercard catalog import to run: this path uses Quiltt's search, and institution details are saved when you connect.

### 4. Use real accounts

Arrange Finicity production access through Quiltt. Quiltt can provision the underlying provider access, or work with credentials you already have; confirm the arrangement in [its integration guide](https://www.quiltt.dev/integrations/connectivity/finicity). Enable Finicity on your production environment and Connector, replace both OpenFinance variables with the production values, restart the API, and link a real account.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No Plaid or MX institutions in search | Run the provider's catalog import after configuring credentials and migrations. The scheduled refresh is not an immediate first-run import. |
| A provider option appears but will not connect | Verify that provider is configured. The UI does not automatically hide every unconfigured connection path. |
| Plaid still opens Sandbox | `APP_ENV` must be exactly `prod` to use `PLAID_PROD_SECRET`. |
| MX returns an authentication or access error | Match the credentials to `MX_API_URL` and check the server's outbound IP allowlist. |
| Quiltt does not open or lacks Finicity institutions | Match the secret and Connector to one environment; enable Finicity and the required products there. |
| Accounts appear before transactions | Wait for initial aggregation and check the connection's sync status. Available history depends on the bank and provider. |

For deployment configuration, see [Docker Compose](deploy-docker-compose.md) or [Fly.io](deploy-fly.md).
