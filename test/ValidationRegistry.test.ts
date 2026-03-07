import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * ValidationRegistry — unit tests
 *
 * Covers:
 *  - Initialization (proxy, roles, identity registry)
 *  - Validation request (access control, edge cases)
 *  - Validation response (validator role, score range, tags)
 *  - Credit-specific helpers (hasPassingValidation, isAgentCodeApproved, getApprovedCodeHash)
 *  - Query functions (getValidationStatus, getSummary, getAgentValidations, getValidatorRequests)
 *  - Admin (addValidator, removeValidator, pause, unpause)
 *  - UUPS upgrade authorization
 */
describe("ValidationRegistry", function () {
  let admin: SignerWithAddress;
  let agentOwner: SignerWithAddress;
  let validator: SignerWithAddress;
  let randomUser: SignerWithAddress;

  let registry: any;
  let mockNFT: any;

  const AGENT_ID = 1n;

  beforeEach(async function () {
    [admin, agentOwner, validator, randomUser] = await ethers.getSigners();

    // Deploy mock ERC-8004 registry
    const MockReg = await ethers.getContractFactory("MockAgentRegistry");
    mockNFT = await MockReg.deploy();
    await mockNFT.waitForDeployment();
    await mockNFT.connect(agentOwner).register(); // agentId=1

    // Deploy ValidationRegistry via UUPS proxy
    const VRFactory = await ethers.getContractFactory("ValidationRegistry");
    registry = await upgrades.deployProxy(
      VRFactory,
      [await mockNFT.getAddress(), admin.address],
      { kind: "uups" }
    );
    await registry.waitForDeployment();

    // Add validator role
    await registry.connect(admin).addValidator(validator.address);
  });

  // ── helpers ───────────────────────────────────────────────────────────

  function makeRequestHash(label: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(label));
  }

  async function submitRequest(
    agentId: bigint,
    validatorAddr: string,
    label: string
  ): Promise<string> {
    const reqHash = makeRequestHash(label);
    await registry
      .connect(agentOwner)
      .validationRequest(validatorAddr, agentId, `ipfs://${label}`, reqHash);
    return reqHash;
  }

  async function submitFullAudit(
    agentId: bigint,
    label: string,
    score = 100,
    tag = "code-audit"
  ): Promise<string> {
    const reqHash = await submitRequest(agentId, validator.address, label);
    await registry
      .connect(validator)
      .validationResponse(
        reqHash,
        score,
        `ipfs://${label}-resp`,
        ethers.keccak256(ethers.toUtf8Bytes(`${label}-content`)),
        tag
      );
    return reqHash;
  }

  // ═════════════════════════════════════════════════════════════════════
  //                      INITIALIZATION
  // ═════════════════════════════════════════════════════════════════════

  describe("Initialization", function () {
    it("sets identity registry", async function () {
      expect(await registry.getIdentityRegistry()).to.equal(await mockNFT.getAddress());
    });

    it("admin has DEFAULT_ADMIN_ROLE", async function () {
      const DEFAULT_ADMIN = ethers.ZeroHash;
      expect(await registry.hasRole(DEFAULT_ADMIN, admin.address)).to.be.true;
    });

    it("admin has VALIDATOR_ROLE", async function () {
      const VALIDATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VALIDATOR_ROLE"));
      expect(await registry.hasRole(VALIDATOR_ROLE, admin.address)).to.be.true;
    });

    it("admin has PAUSER_ROLE", async function () {
      const PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
      expect(await registry.hasRole(PAUSER_ROLE, admin.address)).to.be.true;
    });

    it("rejects zero address for identity registry", async function () {
      const VRFactory = await ethers.getContractFactory("ValidationRegistry");
      await expect(
        upgrades.deployProxy(VRFactory, [ethers.ZeroAddress, admin.address], { kind: "uups" })
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("rejects zero address for admin", async function () {
      const VRFactory = await ethers.getContractFactory("ValidationRegistry");
      await expect(
        upgrades.deployProxy(VRFactory, [await mockNFT.getAddress(), ethers.ZeroAddress], {
          kind: "uups",
        })
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("cannot initialize twice", async function () {
      await expect(
        registry.initialize(await mockNFT.getAddress(), admin.address)
      ).to.be.revertedWithCustomError(registry, "InvalidInitialization");
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                   VALIDATION REQUEST
  // ═════════════════════════════════════════════════════════════════════

  describe("validationRequest", function () {
    it("agent owner can submit a request", async function () {
      const reqHash = makeRequestHash("req1");
      await expect(
        registry
          .connect(agentOwner)
          .validationRequest(validator.address, AGENT_ID, "ipfs://req1", reqHash)
      )
        .to.emit(registry, "ValidationRequest")
        .withArgs(validator.address, AGENT_ID, "ipfs://req1", reqHash);
    });

    it("tracks request in agent validations", async function () {
      const reqHash = await submitRequest(AGENT_ID, validator.address, "req1");
      const hashes = await registry.getAgentValidations(AGENT_ID);
      expect(hashes).to.include(reqHash);
    });

    it("tracks request in validator requests", async function () {
      const reqHash = await submitRequest(AGENT_ID, validator.address, "req1");
      const hashes = await registry.getValidatorRequests(validator.address);
      expect(hashes).to.include(reqHash);
    });

    it("rejects zero validator address", async function () {
      const reqHash = makeRequestHash("req2");
      await expect(
        registry
          .connect(agentOwner)
          .validationRequest(ethers.ZeroAddress, AGENT_ID, "ipfs://req2", reqHash)
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("rejects empty request hash", async function () {
      await expect(
        registry
          .connect(agentOwner)
          .validationRequest(validator.address, AGENT_ID, "ipfs://req3", ethers.ZeroHash)
      ).to.be.revertedWithCustomError(registry, "EmptyRequestHash");
    });

    it("rejects non-owner caller", async function () {
      const reqHash = makeRequestHash("req4");
      await expect(
        registry
          .connect(randomUser)
          .validationRequest(validator.address, AGENT_ID, "ipfs://req4", reqHash)
      ).to.be.revertedWithCustomError(registry, "NotAgentOwnerOrOperator");
    });

    it("rejects duplicate request hash", async function () {
      const reqHash = makeRequestHash("req5");
      await registry
        .connect(agentOwner)
        .validationRequest(validator.address, AGENT_ID, "ipfs://req5", reqHash);
      await expect(
        registry
          .connect(agentOwner)
          .validationRequest(validator.address, AGENT_ID, "ipfs://req5dup", reqHash)
      ).to.be.revertedWithCustomError(registry, "RequestAlreadyExists");
    });

    it("reverts when paused", async function () {
      await registry.connect(admin).pause();
      const reqHash = makeRequestHash("req6");
      await expect(
        registry
          .connect(agentOwner)
          .validationRequest(validator.address, AGENT_ID, "ipfs://req6", reqHash)
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                   VALIDATION RESPONSE
  // ═════════════════════════════════════════════════════════════════════

  describe("validationResponse", function () {
    let reqHash: string;

    beforeEach(async function () {
      reqHash = await submitRequest(AGENT_ID, validator.address, "resp-test");
    });

    it("requested validator can respond", async function () {
      await expect(
        registry
          .connect(validator)
          .validationResponse(reqHash, 100, "ipfs://resp", ethers.keccak256("0x01"), "code-audit")
      )
        .to.emit(registry, "ValidationResponse")
        .withArgs(
          validator.address,
          AGENT_ID,
          reqHash,
          100,
          "ipfs://resp",
          ethers.keccak256("0x01"),
          "code-audit"
        );
    });

    it("admin (with VALIDATOR_ROLE) can respond on behalf", async function () {
      await registry
        .connect(admin)
        .validationResponse(reqHash, 80, "ipfs://resp", ethers.keccak256("0x02"), "code-audit");
      const status = await registry.getValidationStatus(reqHash);
      expect(status.response).to.equal(80);
    });

    it("rejects non-validator response", async function () {
      await expect(
        registry
          .connect(randomUser)
          .validationResponse(reqHash, 100, "ipfs://resp", ethers.keccak256("0x03"), "code-audit")
      ).to.be.revertedWithCustomError(registry, "NotRequestedValidator");
    });

    it("rejects response for non-existent request", async function () {
      const fakeHash = makeRequestHash("non-existent");
      await expect(
        registry
          .connect(validator)
          .validationResponse(fakeHash, 100, "ipfs://resp", ethers.keccak256("0x04"), "code-audit")
      ).to.be.revertedWithCustomError(registry, "RequestNotFound");
    });

    it("rejects response > 100", async function () {
      await expect(
        registry
          .connect(validator)
          .validationResponse(reqHash, 101, "ipfs://resp", ethers.keccak256("0x05"), "code-audit")
      ).to.be.revertedWithCustomError(registry, "InvalidResponse");
    });

    it("accepts response = 0 (failed)", async function () {
      await registry
        .connect(validator)
        .validationResponse(reqHash, 0, "ipfs://resp", ethers.keccak256("0x06"), "code-audit");
      const status = await registry.getValidationStatus(reqHash);
      expect(status.response).to.equal(0);
    });

    it("accepts response = 100 (passed)", async function () {
      await registry
        .connect(validator)
        .validationResponse(reqHash, 100, "ipfs://resp", ethers.keccak256("0x07"), "code-audit");
      const status = await registry.getValidationStatus(reqHash);
      expect(status.response).to.equal(100);
    });

    it("allows re-response (progressive validation)", async function () {
      await registry
        .connect(validator)
        .validationResponse(reqHash, 50, "ipfs://resp1", ethers.keccak256("0x08"), "code-audit");
      await registry
        .connect(validator)
        .validationResponse(reqHash, 100, "ipfs://resp2", ethers.keccak256("0x09"), "code-audit");
      const status = await registry.getValidationStatus(reqHash);
      expect(status.response).to.equal(100);
    });

    it("stores tag correctly", async function () {
      await registry
        .connect(validator)
        .validationResponse(reqHash, 100, "ipfs://resp", ethers.keccak256("0x10"), "security-audit");
      const status = await registry.getValidationStatus(reqHash);
      expect(status.tag).to.equal("security-audit");
    });

    it("reverts when paused", async function () {
      await registry.connect(admin).pause();
      await expect(
        registry
          .connect(validator)
          .validationResponse(reqHash, 100, "ipfs://resp", ethers.keccak256("0x11"), "code-audit")
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                   CREDIT-SPECIFIC HELPERS
  // ═════════════════════════════════════════════════════════════════════

  describe("Credit Helpers", function () {
    it("isAgentCodeApproved returns false for new agent", async function () {
      expect(await registry.isAgentCodeApproved(AGENT_ID)).to.be.false;
    });

    it("isAgentCodeApproved returns true after passing code-audit", async function () {
      await submitFullAudit(AGENT_ID, "audit1", 100, "code-audit");
      expect(await registry.isAgentCodeApproved(AGENT_ID)).to.be.true;
    });

    it("isAgentCodeApproved returns false after failed code-audit", async function () {
      await submitFullAudit(AGENT_ID, "audit2", 50, "code-audit");
      expect(await registry.isAgentCodeApproved(AGENT_ID)).to.be.false;
    });

    it("isAgentCodeApproved is not affected by other tags", async function () {
      await submitFullAudit(AGENT_ID, "audit3", 100, "security-audit");
      expect(await registry.isAgentCodeApproved(AGENT_ID)).to.be.false;
    });

    it("hasPassingValidation returns correct result", async function () {
      let [hasPassing] = await registry.hasPassingValidation(AGENT_ID, "code-audit");
      expect(hasPassing).to.be.false;

      await submitFullAudit(AGENT_ID, "audit4", 100, "code-audit");
      [hasPassing] = await registry.hasPassingValidation(AGENT_ID, "code-audit");
      expect(hasPassing).to.be.true;
    });

    it("hasPassingValidation returns request hash", async function () {
      const reqHash = await submitFullAudit(AGENT_ID, "audit5", 100, "code-audit");
      const [, returnedHash] = await registry.hasPassingValidation(AGENT_ID, "code-audit");
      expect(returnedHash).to.equal(reqHash);
    });

    it("getApprovedCodeHash returns approved hash", async function () {
      await submitFullAudit(AGENT_ID, "audit6", 100, "code-audit");
      const [codeHash, approved] = await registry.getApprovedCodeHash(AGENT_ID);
      expect(approved).to.be.true;
      expect(codeHash).to.not.equal(ethers.ZeroHash);
    });

    it("getApprovedCodeHash returns false for unapproved", async function () {
      const [, approved] = await registry.getApprovedCodeHash(AGENT_ID);
      expect(approved).to.be.false;
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                    QUERY FUNCTIONS
  // ═════════════════════════════════════════════════════════════════════

  describe("Query Functions", function () {
    it("getValidationStatus returns correct data", async function () {
      const reqHash = await submitFullAudit(AGENT_ID, "query1", 100, "code-audit");
      const status = await registry.getValidationStatus(reqHash);
      expect(status.validatorAddress).to.equal(validator.address);
      expect(status.agentId).to.equal(AGENT_ID);
      expect(status.response).to.equal(100);
      expect(status.tag).to.equal("code-audit");
      expect(status.lastUpdate).to.be.gt(0n);
    });

    it("getValidationStatus returns requestedAt if no response", async function () {
      const reqHash = await submitRequest(AGENT_ID, validator.address, "query2");
      const status = await registry.getValidationStatus(reqHash);
      expect(status.response).to.equal(0);
      expect(status.lastUpdate).to.be.gt(0n);
    });

    it("getSummary with no filter", async function () {
      await submitFullAudit(AGENT_ID, "sum1", 100, "code-audit");
      await submitFullAudit(AGENT_ID, "sum2", 80, "code-audit");
      const [count, avgResponse] = await registry.getSummary(AGENT_ID, [], "");
      expect(count).to.equal(2n);
      expect(avgResponse).to.equal(90); // (100+80)/2
    });

    it("getSummary filters by tag", async function () {
      await submitFullAudit(AGENT_ID, "sum3", 100, "code-audit");
      await submitFullAudit(AGENT_ID, "sum4", 80, "security-audit");
      const [count, avgResponse] = await registry.getSummary(AGENT_ID, [], "code-audit");
      expect(count).to.equal(1n);
      expect(avgResponse).to.equal(100);
    });

    it("getSummary filters by validator", async function () {
      // Request from validator
      await submitFullAudit(AGENT_ID, "sum5", 100, "code-audit");
      // Request from admin (who also has VALIDATOR_ROLE)
      const reqHash2 = makeRequestHash("sum6");
      await registry
        .connect(agentOwner)
        .validationRequest(admin.address, AGENT_ID, "ipfs://sum6", reqHash2);
      await registry
        .connect(admin)
        .validationResponse(reqHash2, 60, "ipfs://sum6-resp", ethers.keccak256("0x20"), "code-audit");

      const [count] = await registry.getSummary(AGENT_ID, [validator.address], "");
      expect(count).to.equal(1n);
    });

    it("getSummary returns zero for no responses", async function () {
      // Only request, no response
      await submitRequest(AGENT_ID, validator.address, "sum7");
      const [count, avgResponse] = await registry.getSummary(AGENT_ID, [], "");
      expect(count).to.equal(0n);
      expect(avgResponse).to.equal(0);
    });

    it("getAgentValidations returns all request hashes", async function () {
      await submitRequest(AGENT_ID, validator.address, "list1");
      await submitRequest(AGENT_ID, validator.address, "list2");
      const hashes = await registry.getAgentValidations(AGENT_ID);
      expect(hashes.length).to.equal(2);
    });

    it("getValidatorRequests returns all request hashes", async function () {
      await submitRequest(AGENT_ID, validator.address, "vlist1");
      await submitRequest(AGENT_ID, validator.address, "vlist2");
      const hashes = await registry.getValidatorRequests(validator.address);
      expect(hashes.length).to.equal(2);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                         ADMIN
  // ═════════════════════════════════════════════════════════════════════

  describe("Admin", function () {
    it("admin can add validator", async function () {
      await registry.connect(admin).addValidator(randomUser.address);
      const VALIDATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VALIDATOR_ROLE"));
      expect(await registry.hasRole(VALIDATOR_ROLE, randomUser.address)).to.be.true;
    });

    it("admin can remove validator", async function () {
      await registry.connect(admin).removeValidator(validator.address);
      const VALIDATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VALIDATOR_ROLE"));
      expect(await registry.hasRole(VALIDATOR_ROLE, validator.address)).to.be.false;
    });

    it("non-admin cannot add validator", async function () {
      await expect(
        registry.connect(randomUser).addValidator(randomUser.address)
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("admin can pause", async function () {
      await registry.connect(admin).pause();
      expect(await registry.paused()).to.be.true;
    });

    it("admin can unpause", async function () {
      await registry.connect(admin).pause();
      await registry.connect(admin).unpause();
      expect(await registry.paused()).to.be.false;
    });

    it("non-pauser cannot pause", async function () {
      await expect(
        registry.connect(randomUser).pause()
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                    UUPS UPGRADE
  // ═════════════════════════════════════════════════════════════════════

  describe("UUPS", function () {
    it("admin can upgrade", async function () {
      const VRV2 = await ethers.getContractFactory("ValidationRegistry");
      const upgraded = await upgrades.upgradeProxy(await registry.getAddress(), VRV2);
      expect(await upgraded.getAddress()).to.equal(await registry.getAddress());
    });

    it("non-admin cannot upgrade", async function () {
      const VRV2 = await ethers.getContractFactory("ValidationRegistry", randomUser);
      await expect(
        upgrades.upgradeProxy(await registry.getAddress(), VRV2)
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });
});
