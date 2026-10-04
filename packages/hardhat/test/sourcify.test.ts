import { expect } from "chai";

import { buildVerifyBody, existingMatch, interpretJob, verifyOnSourcify } from "../scripts/lib/sourcify";

const BUILD_INFO = {
  solcLongVersion: "0.8.28+commit.7893614a",
  input: { sources: { "contracts/PassportRegistry.sol": { content: "contract PassportRegistry {}" } } },
};
const ADDRESS = "0xCBc3089cb39ef55114341Ff1aB9BFeA5f22D5a7A";

/** A fetch that answers each call with the next canned response. */
function cannedFetch(responses: Array<{ status: number; body: unknown }>, calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    calls.push(String(input));
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
}

describe("sourcify", () => {
  describe("buildVerifyBody", () => {
    it("sends the exact compiler input and version for the named contract", () => {
      const body = buildVerifyBody(BUILD_INFO, "contracts/PassportRegistry.sol:PassportRegistry");
      expect(body.stdJsonInput).to.equal(BUILD_INFO.input);
      expect(body.compilerVersion).to.equal("0.8.28+commit.7893614a");
      expect(body.contractIdentifier).to.equal("contracts/PassportRegistry.sol:PassportRegistry");
    });

    it("refuses a contract that is not in the build", () => {
      expect(() => buildVerifyBody(BUILD_INFO, "contracts/Other.sol:Other")).to.throw(/not in this build/);
    });
  });

  describe("interpretJob", () => {
    it("is pending until the job completes", () => {
      expect(interpretJob({ isJobCompleted: false })).to.deep.equal({ state: "pending" });
    });

    it("reports the match kind when verified", () => {
      expect(interpretJob({ isJobCompleted: true, contract: { match: "exact_match" } })).to.deep.equal({
        state: "verified",
        match: "exact_match",
      });
    });

    it("passes Sourcify's reason through when it fails", () => {
      expect(interpretJob({ isJobCompleted: true, error: { message: "bytecode does not match" } })).to.deep.equal({
        state: "failed",
        message: "bytecode does not match",
      });
    });

    it("treats a completed job without a match as a failure", () => {
      expect(interpretJob({ isJobCompleted: true, contract: { match: null } }).state).to.equal("failed");
    });
  });

  describe("existingMatch", () => {
    it("returns null for an unverified address", async () => {
      const fetchImpl = cannedFetch([{ status: 200, body: { match: null } }]);
      expect(await existingMatch(296, ADDRESS, fetchImpl)).to.equal(null);
    });

    it("returns the match kind for a verified address", async () => {
      const fetchImpl = cannedFetch([{ status: 200, body: { match: "match" } }]);
      expect(await existingMatch(296, ADDRESS, fetchImpl)).to.equal("match");
    });
  });

  describe("verifyOnSourcify", () => {
    it("submits to the v2 API, then polls the job until it finishes", async () => {
      const calls: string[] = [];
      const fetchImpl = cannedFetch(
        [
          { status: 202, body: { verificationId: "job-1" } },
          { status: 200, body: { isJobCompleted: false } },
          { status: 200, body: { isJobCompleted: true, contract: { match: "match" } } },
        ],
        calls,
      );
      const body = buildVerifyBody(BUILD_INFO, "contracts/PassportRegistry.sol:PassportRegistry");
      const outcome = await verifyOnSourcify(296, ADDRESS, body, { fetchImpl, intervalMs: 0 });

      expect(outcome).to.deep.equal({ state: "verified", match: "match" });
      expect(calls[0]).to.equal(`https://sourcify.dev/server/v2/verify/296/${ADDRESS}`);
      expect(calls[1]).to.equal("https://sourcify.dev/server/v2/verify/job-1");
    });

    it("reports a refused submission as a failure", async () => {
      const fetchImpl = cannedFetch([{ status: 400, body: { message: "bad input" } }]);
      const body = buildVerifyBody(BUILD_INFO, "contracts/PassportRegistry.sol:PassportRegistry");
      const outcome = await verifyOnSourcify(296, ADDRESS, body, { fetchImpl, intervalMs: 0 });
      expect(outcome.state).to.equal("failed");
    });
  });
});
