/**
 * Tests for how a failed Plaid call reaches the rest of the app.
 *
 * The SDK is axios-based, so its own error has only "Request failed with status
 * code 400" for a message and carries the whole request. Reading only the
 * message meant every disconnected Item was recorded as an anonymous 400 and
 * retried forever, and DBOS stored the secret and access token with each one.
 * These run a real SDK call, failed by a stub adapter.
 */
import { describe, it, expect } from "vitest";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import {
  extractPlaidError,
  plaidClient,
  PlaidRequestError,
} from "./plaid.client";

const ACCESS_TOKEN = "access-production-do-not-store";

/** Fails the call the way Plaid does, with the request the SDK built. */
function rejectWith(status: number, data: unknown) {
  return {
    adapter: (config: InternalAxiosRequestConfig) =>
      Promise.reject(
        new AxiosError(
          `Request failed with status code ${status}`,
          "ERR_BAD_REQUEST",
          config,
          null,
          { status, statusText: "", data, headers: {}, config },
        ),
      ),
  };
}

function callPlaid(options: Record<string, unknown>) {
  return plaidClient
    .itemGet({ access_token: ACCESS_TOKEN }, options)
    .catch((err: unknown) => err);
}

describe("a failed Plaid call", () => {
  it("rejects with Plaid's code and message, not the axios ones", async () => {
    const err = await callPlaid(
      rejectWith(400, {
        error_code: "ITEM_LOGIN_REQUIRED",
        error_message: "the login details of this item have changed",
      }),
    );

    expect(err).toBeInstanceOf(PlaidRequestError);
    expect(extractPlaidError(err)).toEqual({
      errorCode: "ITEM_LOGIN_REQUIRED",
      message: "the login details of this item have changed",
    });
  });

  it("carries nothing from the request", async () => {
    const err = await callPlaid(
      rejectWith(400, { error_code: "ITEM_NOT_FOUND" }),
    );

    // What DBOS would store: every own property, plus message and stack.
    const stored = JSON.stringify(err, [
      ...Object.getOwnPropertyNames(err),
      "message",
      "stack",
    ]);
    expect(stored).not.toContain(ACCESS_TOKEN);
    expect(stored).not.toContain("PLAID-SECRET");
    expect((err as { config?: unknown }).config).toBeUndefined();
  });

  it("falls back to display_message when error_message is absent", async () => {
    const err = await callPlaid(
      rejectWith(400, {
        error_code: "INSTITUTION_DOWN",
        display_message: "This bank is temporarily unavailable.",
      }),
    );

    expect(extractPlaidError(err).message).toBe(
      "This bank is temporarily unavailable.",
    );
  });

  it("has no code when the body doesn't carry one", async () => {
    const err = await callPlaid(rejectWith(503, { something: "else" }));

    expect(extractPlaidError(err)).toEqual({
      errorCode: undefined,
      message: "Request failed with status code 503",
    });
  });

  it("keeps a network failure's message", async () => {
    const err = await callPlaid({
      adapter: () => Promise.reject(new Error("socket hang up")),
    });

    expect(err).toBeInstanceOf(PlaidRequestError);
    expect(extractPlaidError(err)).toEqual({
      errorCode: undefined,
      message: "socket hang up",
    });
  });
});

describe("extractPlaidError", () => {
  it("handles an error that never came from Plaid", () => {
    expect(extractPlaidError(new Error("boom")).errorCode).toBeUndefined();
  });

  it("handles a non-Error throw", () => {
    expect(extractPlaidError("boom").message).toBe("Unknown sync error");
    expect(extractPlaidError(null).message).toBe("Unknown sync error");
  });
});
