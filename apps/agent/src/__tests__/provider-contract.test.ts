// Drives the backend-parametrized provider contract against both FakeLinear and
// FakeGithub so the nx `test` target (`bun test apps/agent/src`) executes it in
// CI. The two sibling calls prove the same kit is genuinely tracker-agnostic.
import {
  makeGithubContractBackend,
  makeLinearContractBackend,
  runProviderContract,
} from "../../test/harness";

runProviderContract(makeLinearContractBackend);
runProviderContract(makeGithubContractBackend);
