import { describe, expect, test } from "bun:test";
import {
  formatTicketError,
  parseTicketIdentifier,
  resolveTicketNumbers,
} from "../linear-client/ticket-identifier";

describe("parseTicketIdentifier", () => {
  test("parses a full identifier, uppercasing the team key", () => {
    expect(parseTicketIdentifier("RLF-208")).toEqual({ teamKey: "RLF", number: 208 });
  });

  test("is case-insensitive on the team key", () => {
    expect(parseTicketIdentifier("rlf-208")).toEqual({ teamKey: "RLF", number: 208 });
  });

  test("parses a bare number with a null team key", () => {
    expect(parseTicketIdentifier("208")).toEqual({ teamKey: null, number: 208 });
  });

  test("tolerates a change-name slug, extracting the leading team-number", () => {
    expect(parseTicketIdentifier("rlf-208-some-slug")).toEqual({ teamKey: "RLF", number: 208 });
  });

  test("trims surrounding whitespace", () => {
    expect(parseTicketIdentifier("  RLF-208  ")).toEqual({ teamKey: "RLF", number: 208 });
  });

  test.each(["abc", "RLF-", "-208", ""])("throws on malformed input %p", (raw) => {
    expect(() => parseTicketIdentifier(raw)).toThrow();
  });
});

describe("resolveTicketNumbers", () => {
  test("resolves identifiers against a matching team", () => {
    expect(resolveTicketNumbers(["RLF-208"], "RLF")).toEqual([208]);
  });

  test("resolves a bare number against the configured team", () => {
    expect(resolveTicketNumbers(["208"], "RLF")).toEqual([208]);
  });

  test("dedupes mixed identifier and bare-number forms of the same ticket", () => {
    expect(resolveTicketNumbers(["208", "RLF-208"], "RLF")).toEqual([208]);
  });

  test("preserves order across multiple tickets", () => {
    expect(resolveTicketNumbers(["RLF-208", "210", "RLF-211"], "RLF")).toEqual([208, 210, 211]);
  });

  test("team comparison is case-insensitive", () => {
    expect(resolveTicketNumbers(["rlf-208"], "rlf")).toEqual([208]);
  });

  test("returns an empty array when there are no tokens", () => {
    expect(resolveTicketNumbers([], "RLF")).toEqual([]);
  });

  test("throws when an identifier's team disagrees with the configured team", () => {
    expect(() => resolveTicketNumbers(["RLF-208"], "ENG")).toThrow(/not in the configured team/);
  });

  test("attaches the offending ticket and team to a team-mismatch error", () => {
    try {
      resolveTicketNumbers(["RLF-208"], "ENG");
      throw new Error("expected resolveTicketNumbers to throw");
    } catch (err) {
      expect((err as { ticket?: string }).ticket).toBe("RLF-208");
      expect((err as { team?: string }).team).toBe("ENG");
    }
  });

  test("throws when a bare number is given but no team is configured", () => {
    expect(() => resolveTicketNumbers(["208"], undefined)).toThrow(/needs a configured team/);
  });

  test("throws when a bare number is given but team is blank", () => {
    expect(() => resolveTicketNumbers(["208"], "   ")).toThrow(/needs a configured team/);
  });

  test("allows a full identifier even when no team is configured", () => {
    expect(resolveTicketNumbers(["RLF-208"], undefined)).toEqual([208]);
  });
});

describe("formatTicketError", () => {
  test("appends ticket and team context to a team-mismatch error", () => {
    try {
      resolveTicketNumbers(["RLF-208"], "ENG");
      throw new Error("expected throw");
    } catch (err) {
      expect(formatTicketError(err)).toBe(
        "--ticket identifier is not in the configured team (ticket: RLF-208, configured team: ENG)",
      );
    }
  });

  test("appends the offending value for a malformed identifier", () => {
    try {
      parseTicketIdentifier("nope");
      throw new Error("expected throw");
    } catch (err) {
      expect(formatTicketError(err)).toContain("(ticket: nope)");
    }
  });

  test("returns the bare message when no context is attached", () => {
    expect(formatTicketError(new Error("plain message"))).toBe("plain message");
  });

  test("stringifies non-Error values", () => {
    expect(formatTicketError("boom")).toBe("boom");
  });
});
