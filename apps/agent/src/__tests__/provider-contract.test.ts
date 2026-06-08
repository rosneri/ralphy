// Drives the backend-parametrized provider contract against FakeLinear so the
// nx `test` target (`bun test apps/agent/src`) executes it in CI. A future
// FakeGithub proves itself by adding a sibling call with its own adapter.
import { makeLinearContractBackend, runProviderContract } from "../../test/harness";

runProviderContract(makeLinearContractBackend);
