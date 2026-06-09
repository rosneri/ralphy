import { describe, expect, test, mock } from "bun:test";
import type { Indicators, GetIndicator, SetIndicator } from "@ralphy/types";

// Stub the resolver module so the factory's construction can be observed
// without a GraphQL round-trip: `createLinearResolvers` returns a recognizable
// stub bag, and `fetchDoneCandidatesWith` records the args it is called with.
const createResolversCalls: unknown[] = [];
const fetchDoneCandidatesCalls: unknown[][] = [];

const stubResolvers = {
  applyIndicator: async () => {},
  removeIndicator: async () => {},
  applyMarker: async () => {},
  resolveLabelId: async () => null,
  fetchByGet: async () => [],
  resolveLabelIdForTeam: async () => null,
};

mock.module("../../linear-resolvers", () => ({
  createLinearResolvers: (input: unknown) => {
    createResolversCalls.push(input);
    return stubResolvers;
  },
  fetchDoneCandidatesWith: async (...args: unknown[]) => {
    fetchDoneCandidatesCalls.push(args);
    return [];
  },
}));

const { createLinearProvider } = await import("../linear");

const getTodo: GetIndicator = { filter: [{ type: "label", value: "todo" }] };
const setDone: SetIndicator = { type: "status", value: "Done" };
const setError: SetIndicator = { type: "label", value: "ralphy:error" };

function makeIndicators(): Indicators {
  return { getTodo, setDone, setError };
}

describe("createLinearProvider", () => {
  test("spreads the resolver bag and exposes the resolvers handle", () => {
    createResolversCalls.length = 0;
    const indicators = makeIndicators();
    const provider = createLinearProvider({
      apiKey: "k",
      team: "ENG",
      assignee: "me",
      anyAssignee: false,
      scope: { requireAllLabels: ["bug"] },
      indicators,
      diag: () => {},
    });

    // The wire TrackerProvider surface delegates to the resolver bag.
    expect(provider.applyIndicator).toBe(stubResolvers.applyIndicator);
    expect(provider.removeIndicator).toBe(stubResolvers.removeIndicator);
    expect(provider.applyMarker).toBe(stubResolvers.applyMarker);
    expect(provider.fetchByGet).toBe(stubResolvers.fetchByGet);
    expect(provider.resolveLabelIdForTeam).toBe(stubResolvers.resolveLabelIdForTeam);
    // The resolvers handle (for the coordinator seam) is the same bag.
    expect(provider.resolvers).toBe(stubResolvers);
    // `fetchDoneCandidates` is bound here, not part of the resolver bag.
    expect(typeof provider.fetchDoneCandidates).toBe("function");
  });

  test("passes the configured filter inputs through to createLinearResolvers", () => {
    createResolversCalls.length = 0;
    createLinearProvider({
      apiKey: "k",
      team: "ENG",
      assignee: "me",
      anyAssignee: false,
      scope: { requireAllLabels: ["bug"] },
      indicators: makeIndicators(),
      diag: () => {},
    });
    expect(createResolversCalls).toHaveLength(1);
    expect(createResolversCalls[0]).toEqual({
      apiKey: "k",
      team: "ENG",
      assignee: "me",
      anyAssignee: false,
      scope: { requireAllLabels: ["bug"] },
      diag: expect.any(Function),
    });
  });

  test("fetchDoneCandidates delegates with the same args the inline literal passed", async () => {
    fetchDoneCandidatesCalls.length = 0;
    const indicators = makeIndicators();
    const provider = createLinearProvider({
      apiKey: "k",
      team: "ENG",
      assignee: "me",
      anyAssignee: true,
      scope: { requireAllLabels: ["bug"] },
      indicators,
      diag: () => {},
    });
    await provider.fetchDoneCandidates();
    expect(fetchDoneCandidatesCalls[0]).toEqual([
      "k",
      "ENG",
      "me",
      true,
      { requireAllLabels: ["bug"] },
      indicators,
      undefined,
    ]);
  });

  test("ticketNumbers: empty omits the resolver key and passes undefined downstream", async () => {
    createResolversCalls.length = 0;
    fetchDoneCandidatesCalls.length = 0;
    const indicators = makeIndicators();
    const provider = createLinearProvider({
      apiKey: "k",
      team: "ENG",
      assignee: undefined,
      anyAssignee: undefined,
      scope: { requireAllLabels: [] },
      indicators,
      diag: () => {},
      ticketNumbers: [],
    });
    // Key omitted from the resolver input when empty.
    expect(createResolversCalls[0]).not.toHaveProperty("ticketNumbers");
    await provider.fetchDoneCandidates();
    expect(fetchDoneCandidatesCalls[0]![6]).toBeUndefined();
  });

  test("ticketNumbers: present threads the same array into both calls", async () => {
    createResolversCalls.length = 0;
    fetchDoneCandidatesCalls.length = 0;
    const indicators = makeIndicators();
    const provider = createLinearProvider({
      apiKey: "k",
      team: "ENG",
      assignee: undefined,
      anyAssignee: undefined,
      scope: { requireAllLabels: [] },
      indicators,
      diag: () => {},
      ticketNumbers: [12, 34],
    });
    expect((createResolversCalls[0] as { ticketNumbers?: number[] }).ticketNumbers).toEqual([
      12, 34,
    ]);
    await provider.fetchDoneCandidates();
    expect(fetchDoneCandidatesCalls[0]![6]).toEqual([12, 34]);
  });
});
