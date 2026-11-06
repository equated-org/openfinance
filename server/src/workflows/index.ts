/**
 * Centralized workflow imports for DBOS
 *
 * All workflows must be imported here before DBOS.launch() is called.
 * This ensures proper registration of workflow classes with the DBOS runtime.
 *
 * To add a new workflow:
 * 1. Create your workflow file (e.g., my-workflow.workflow.ts)
 * 2. Import it here
 * 3. The workflow will be automatically registered with DBOS
 */

import "./plaid-transaction-sync.workflow";
import "./mx-transaction-sync.workflow";
import "./quiltt-transaction-sync.workflow";
import "./institution-sync.workflow";
import "./transaction-poll.workflow";
