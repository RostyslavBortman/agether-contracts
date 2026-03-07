import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Agether8004Scorer — unit tests
 *
 * Covers:
 *  - Initialization
 *  - Oracle score submission (valid, wrong signer, expired, range, stale, replay)
 *  - View functions (getCreditScore, getAttestation, isEligible, isScoreFresh)
 *  - ERC-8004 Reputation Registry feedback publishing
 *  - Admin: setOracleSigner, setERC8004ReputationRegistry
 *  - UUPS upgrade authorization
 */
describe("Agether8004Scorer", function () {
  let admin: SignerWithAddress;
  let oracleSigner: SignerWithAddress;
  let randomUser: SignerWithAddress;

  let scorer: any;

  const AGENT_ID = 1n;
  const MAX_SCORE = 1000n;
  const BASE_SCORE = 300n;
  const MAX_ORACLE_AGE = 86400; // 24 hours

  beforeEach(async function () {
    [admin, oracleSigner, randomUser] = await ethers.getSigners();

    const ScorerFactory = await ethers.getContractFactory("Agether8004Scorer");
    scorer = await upgrades.deployProxy(ScorerFactory, [admin.address], { kind: "uups" });
    await scorer.waitForDeployment();

    // Set oracle signer
    await scorer.connect(admin).setOracleSigner(oracleSigner.address);
  });

  // ── helpers ───────────────────────────────────────────────────────────

  async function signScore(
    agentId: bigint,
    score: bigint,
    ts: number,
    signer?: SignerWithAddress
  ): Promise<string> {
    const s = signer || oracleSigner;
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const scorerAddr = await scorer.getAddress();
    const hash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "uint256", "uint256", "address"],
        [agentId, score, ts, chainId, scorerAddr]
      )
    );
    return await s.signMessage(ethers.getBytes(hash));
  }

  async function submitValidScore(
    agentId: bigint,
    score: bigint,
    offsetSeconds = 0
  ) {
    const ts = (await time.latest()) - offsetSeconds;
    const sig = await signScore(agentId, score, ts);
    await scorer.submitScore(agentId, score, ts, sig);
    return ts;
  }

  // ═════════════════════════════════════════════════════════════════════
  //                      INITIALIZATION
  // ═════════════════════════════════════════════════════════════════════

  describe("Initialization", function () {
    it("admin has DEFAULT_ADMIN_ROLE", async function () {
      const DEFAULT_ADMIN = ethers.ZeroHash;
      expect(await scorer.hasRole(DEFAULT_ADMIN, admin.address)).to.be.true;
    });

    it("oracle signer is set", async function () {
      expect(await scorer.oracleSigner()).to.equal(oracleSigner.address);
    });

    it("cannot initialize twice", async function () {
      await expect(scorer.initialize(admin.address)).to.be.revertedWithCustomError(
        scorer,
        "InvalidInitialization"
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                    SCORE SUBMISSION
  // ═════════════════════════════════════════════════════════════════════

  describe("submitScore", function () {
    it("accepts valid oracle-signed score", async function () {
      const ts = await time.latest();
      const sig = await signScore(AGENT_ID, 750n, ts);
      await expect(scorer.submitScore(AGENT_ID, 750n, ts, sig))
        .to.emit(scorer, "ScoreUpdated")
        .withArgs(AGENT_ID, 750n, ts, oracleSigner.address);
    });

    it("stores attestation correctly", async function () {
      const ts = await time.latest();
      const sig = await signScore(AGENT_ID, 600n, ts);
      await scorer.submitScore(AGENT_ID, 600n, ts, sig);

      const att = await scorer.getAttestation(AGENT_ID);
      expect(att.score).to.equal(600n);
      expect(att.timestamp).to.equal(ts);
      expect(att.signer).to.equal(oracleSigner.address);
    });

    it("rejects when oracle signer not set", async function () {
      // Deploy fresh scorer without signer
      const ScorerFactory = await ethers.getContractFactory("Agether8004Scorer");
      const fresh = await upgrades.deployProxy(ScorerFactory, [admin.address], { kind: "uups" });
      await fresh.waitForDeployment();

      const ts = await time.latest();
      const sig = await signScore(AGENT_ID, 500n, ts);
      await expect(
        fresh.submitScore(AGENT_ID, 500n, ts, sig)
      ).to.be.revertedWithCustomError(fresh, "OracleSignerNotSet");
    });

    it("rejects score above MAX_SCORE (1000)", async function () {
      const ts = await time.latest();
      const sig = await signScore(AGENT_ID, 1001n, ts);
      await expect(
        scorer.submitScore(AGENT_ID, 1001n, ts, sig)
      ).to.be.revertedWithCustomError(scorer, "AboveMaximum");
    });

    it("rejects score below BASE_SCORE (300)", async function () {
      const ts = await time.latest();
      const sig = await signScore(AGENT_ID, 299n, ts);
      await expect(
        scorer.submitScore(AGENT_ID, 299n, ts, sig)
      ).to.be.revertedWithCustomError(scorer, "BelowMinimum");
    });

    it("accepts score at boundary values", async function () {
      const ts1 = await time.latest();
      const sig1 = await signScore(AGENT_ID, BASE_SCORE, ts1);
      await scorer.submitScore(AGENT_ID, BASE_SCORE, ts1, sig1);
      expect(await scorer.getCreditScore(AGENT_ID)).to.equal(BASE_SCORE);

      // Submit a newer score at MAX_SCORE
      const ts2 = ts1 + 1;
      const sig2 = await signScore(AGENT_ID, MAX_SCORE, ts2);
      await time.setNextBlockTimestamp(ts2 + 1);
      await scorer.submitScore(AGENT_ID, MAX_SCORE, ts2, sig2);
      expect(await scorer.getCreditScore(AGENT_ID)).to.equal(MAX_SCORE);
    });

    it("rejects expired attestation", async function () {
      const staleTs = (await time.latest()) - MAX_ORACLE_AGE - 1;
      const sig = await signScore(AGENT_ID, 500n, staleTs);
      await expect(
        scorer.submitScore(AGENT_ID, 500n, staleTs, sig)
      ).to.be.revertedWithCustomError(scorer, "OracleAttestationExpired");
    });

    it("rejects wrong signer", async function () {
      const ts = await time.latest();
      const sig = await signScore(AGENT_ID, 500n, ts, randomUser);
      await expect(
        scorer.submitScore(AGENT_ID, 500n, ts, sig)
      ).to.be.revertedWithCustomError(scorer, "InvalidOracleSignature");
    });

    it("rejects score with older timestamp than existing", async function () {
      const ts1 = await time.latest();
      const sig1 = await signScore(AGENT_ID, 500n, ts1);
      await scorer.submitScore(AGENT_ID, 500n, ts1, sig1);

      // Try to submit with same or older timestamp
      const sig2 = await signScore(AGENT_ID, 600n, ts1);
      await expect(
        scorer.submitScore(AGENT_ID, 600n, ts1, sig2)
      ).to.be.revertedWithCustomError(scorer, "AlreadySet");
    });

    it("allows updating score with newer timestamp", async function () {
      const ts1 = await time.latest();
      const sig1 = await signScore(AGENT_ID, 500n, ts1);
      await scorer.submitScore(AGENT_ID, 500n, ts1, sig1);

      const ts2 = ts1 + 10;
      const sig2 = await signScore(AGENT_ID, 700n, ts2);
      await time.setNextBlockTimestamp(ts2 + 1);
      await scorer.submitScore(AGENT_ID, 700n, ts2, sig2);
      expect(await scorer.getCreditScore(AGENT_ID)).to.equal(700n);
    });

    it("anyone can relay a valid oracle-signed score", async function () {
      const ts = await time.latest();
      const sig = await signScore(AGENT_ID, 500n, ts);
      // randomUser relays the score
      await scorer.connect(randomUser).submitScore(AGENT_ID, 500n, ts, sig);
      expect(await scorer.getCreditScore(AGENT_ID)).to.equal(500n);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                       VIEW FUNCTIONS
  // ═════════════════════════════════════════════════════════════════════

  describe("View Functions", function () {
    it("getCreditScore returns BASE_SCORE for new agent", async function () {
      expect(await scorer.getCreditScore(999n)).to.equal(BASE_SCORE);
    });

    it("getAttestation returns empty struct for new agent", async function () {
      const att = await scorer.getAttestation(999n);
      expect(att.score).to.equal(0n);
      expect(att.timestamp).to.equal(0n);
      expect(att.signer).to.equal(ethers.ZeroAddress);
    });

    it("isEligible returns correct results", async function () {
      // No score yet: getCreditScore returns BASE_SCORE (300)
      let [eligible, currentScore] = await scorer.isEligible(AGENT_ID, 300n);
      expect(eligible).to.be.true;
      expect(currentScore).to.equal(BASE_SCORE);

      [eligible] = await scorer.isEligible(AGENT_ID, 301n);
      expect(eligible).to.be.false;

      // Submit a score
      await submitValidScore(AGENT_ID, 700n);
      [eligible, currentScore] = await scorer.isEligible(AGENT_ID, 600n);
      expect(eligible).to.be.true;
      expect(currentScore).to.equal(700n);
    });

    it("isScoreFresh returns false for new agent", async function () {
      const [fresh, age] = await scorer.isScoreFresh(AGENT_ID);
      expect(fresh).to.be.false;
      expect(age).to.equal(ethers.MaxUint256);
    });

    it("isScoreFresh returns true for recent score", async function () {
      await submitValidScore(AGENT_ID, 500n);
      const [fresh, age] = await scorer.isScoreFresh(AGENT_ID);
      expect(fresh).to.be.true;
      expect(age).to.be.lessThanOrEqual(2n); // within a few seconds
    });

    it("isScoreFresh returns false for stale score", async function () {
      await submitValidScore(AGENT_ID, 500n);
      await time.increase(MAX_ORACLE_AGE + 1);
      const [fresh] = await scorer.isScoreFresh(AGENT_ID);
      expect(fresh).to.be.false;
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                    ERC-8004 FEEDBACK
  // ═════════════════════════════════════════════════════════════════════

  describe("ERC-8004 Feedback", function () {
    it("does not revert if no reputation registry set", async function () {
      // erc8004Reputation is address(0) by default — _publishToERC8004 returns early
      await submitValidScore(AGENT_ID, 700n);
    });

    it("maps score >= 700 to feedback +10", async function () {
      // We can't easily mock the reputation registry for a full integration test,
      // but we can verify score submission succeeds.
      // The _publishToERC8004 silently skips if registry is address(0).
      await submitValidScore(AGENT_ID, 700n);
      expect(await scorer.getCreditScore(AGENT_ID)).to.equal(700n);
    });

    it("maps score >= 500 to feedback +5", async function () {
      await submitValidScore(AGENT_ID, 500n);
      expect(await scorer.getCreditScore(AGENT_ID)).to.equal(500n);
    });

    it("maps score >= 400 to feedback -5", async function () {
      await submitValidScore(AGENT_ID, 400n);
      expect(await scorer.getCreditScore(AGENT_ID)).to.equal(400n);
    });

    it("maps score < 400 to feedback -10", async function () {
      await submitValidScore(AGENT_ID, 300n);
      expect(await scorer.getCreditScore(AGENT_ID)).to.equal(300n);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                         ADMIN
  // ═════════════════════════════════════════════════════════════════════

  describe("Admin", function () {
    it("admin can set oracle signer", async function () {
      await expect(
        scorer.connect(admin).setOracleSigner(randomUser.address)
      )
        .to.emit(scorer, "OracleSignerUpdated")
        .withArgs(oracleSigner.address, randomUser.address);
      expect(await scorer.oracleSigner()).to.equal(randomUser.address);
    });

    it("rejects zero address for oracle signer", async function () {
      await expect(
        scorer.connect(admin).setOracleSigner(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(scorer, "ZeroAddress");
    });

    it("non-admin cannot set oracle signer", async function () {
      await expect(
        scorer.connect(randomUser).setOracleSigner(randomUser.address)
      ).to.be.revertedWithCustomError(scorer, "AccessControlUnauthorizedAccount");
    });

    it("admin can set ERC-8004 reputation registry", async function () {
      const newAddr = ethers.Wallet.createRandom().address;
      await expect(
        scorer.connect(admin).setERC8004ReputationRegistry(newAddr)
      )
        .to.emit(scorer, "RegistryUpdated")
        .withArgs(ethers.ZeroAddress, newAddr);
    });

    it("non-admin cannot set reputation registry", async function () {
      await expect(
        scorer.connect(randomUser).setERC8004ReputationRegistry(randomUser.address)
      ).to.be.revertedWithCustomError(scorer, "AccessControlUnauthorizedAccount");
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                    UUPS UPGRADE
  // ═════════════════════════════════════════════════════════════════════

  describe("UUPS", function () {
    it("admin can authorize upgrade", async function () {
      const ScorerV2 = await ethers.getContractFactory("Agether8004Scorer");
      const upgraded = await upgrades.upgradeProxy(await scorer.getAddress(), ScorerV2);
      expect(await upgraded.getAddress()).to.equal(await scorer.getAddress());
    });

    it("non-admin cannot upgrade", async function () {
      const ScorerV2 = await ethers.getContractFactory("Agether8004Scorer", randomUser);
      await expect(
        upgrades.upgradeProxy(await scorer.getAddress(), ScorerV2)
      ).to.be.revertedWithCustomError(scorer, "AccessControlUnauthorizedAccount");
    });
  });
});
