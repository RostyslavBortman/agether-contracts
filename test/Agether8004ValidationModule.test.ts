import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Agether8004ValidationModule — unit tests
 *
 * Covers:
 *  - Module lifecycle (onInstall / onUninstall / isModuleType)
 *  - validateUserOp: ownership via ERC-8004 NFT
 *  - validateUserOp: KYA gate via ValidationRegistry
 *  - validateUserOp: module lock (blocks install/uninstall selectors)
 *  - ERC-1271 signature validation (isValidSignatureWithSender)
 *  - Admin: setValidationRegistry
 *  - View helpers: getConfig, getOwner, isInstalled, isKYAApproved
 */
describe("Agether8004ValidationModule", function () {
  let admin: SignerWithAddress;
  let agentOwner: SignerWithAddress;
  let randomUser: SignerWithAddress;

  let mockRegistry: any;       // MockAgentRegistry (ERC-721)
  let validationModule: any;   // Agether8004ValidationModule
  let validationRegistry: any; // ValidationRegistry (KYA)

  const AGENT_ID = 1n;
  const ZERO_BYTES32 = ethers.ZeroHash;
  const EMPTY_BYTES = "0x";
  const INSTALL_MODULE_SELECTOR = "0x9517e29f";   // installModule(uint256,address,bytes)
  const UNINSTALL_MODULE_SELECTOR = "0xa71763a8";  // uninstallModule(uint256,address,bytes)
  const EXECUTE_SELECTOR = "0xe9ae5c53";            // execute(bytes32,bytes)
  const EXECUTE_FROM_EXECUTOR_SELECTOR = "0xd691c964"; // executeFromExecutor(bytes32,bytes)

  // ERC-7579 call types (first byte of mode)
  const MODE_SINGLE = "0x00" + "00".repeat(31);      // callType=0x00 (single)
  const MODE_BATCH  = "0x01" + "00".repeat(31);      // callType=0x01 (batch)
  const MODE_DELEGATECALL = "0xff" + "00".repeat(31); // callType=0xff (delegatecall)

  let fakeAccount: string; // simulates a Safe address

  beforeEach(async function () {
    [admin, agentOwner, randomUser] = await ethers.getSigners();

    // Mock ERC-8004 identity registry
    const MockReg = await ethers.getContractFactory("MockAgentRegistry");
    mockRegistry = await MockReg.deploy();
    await mockRegistry.waitForDeployment();
    await mockRegistry.connect(agentOwner).register(); // agentId = 1

    // ValidationRegistry (UUPS proxy)
    const VRFactory = await ethers.getContractFactory("ValidationRegistry");
    validationRegistry = await (await import("hardhat")).upgrades.deployProxy(
      VRFactory,
      [await mockRegistry.getAddress(), admin.address],
      { kind: "uups" }
    );
    await validationRegistry.waitForDeployment();

    // Agether8004ValidationModule (UUPS proxy)
    const ModFactory = await ethers.getContractFactory("Agether8004ValidationModule");
    validationModule = await (await import("hardhat")).upgrades.deployProxy(
      ModFactory,
      [admin.address],
      { kind: "uups" }
    );
    await validationModule.waitForDeployment();

    // Wire KYA registry
    await validationModule.connect(admin).setValidationRegistry(
      await validationRegistry.getAddress()
    );

    fakeAccount = ethers.Wallet.createRandom().address;
  });

  // ── helpers ───────────────────────────────────────────────────────────

  async function installFor(account: string, agentId: bigint) {
    await ethers.provider.send("hardhat_setBalance", [account, "0x56BC75E2D63100000"]);
    const signer = await ethers.getImpersonatedSigner(account);
    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"],
      [await mockRegistry.getAddress(), agentId]
    );
    await validationModule.connect(signer).onInstall(data);
  }

  function buildUserOp(sender: string, callData: string, signature: string) {
    return {
      sender,
      nonce: 0n,
      initCode: EMPTY_BYTES,
      callData,
      accountGasLimits: ZERO_BYTES32,
      preVerificationGas: 0n,
      gasFees: ZERO_BYTES32,
      paymasterAndData: EMPTY_BYTES,
      signature,
    };
  }

  async function signHash(hash: string, signer?: SignerWithAddress) {
    return await (signer || agentOwner).signMessage(ethers.getBytes(hash));
  }

  async function approveCode(agentId: bigint) {
    const reqHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "uint256"],
        ["code-audit-request", agentId]
      )
    );
    await validationRegistry
      .connect(agentOwner)
      .validationRequest(admin.address, agentId, "ipfs://req", reqHash);
    await validationRegistry
      .connect(admin)
      .validationResponse(reqHash, 100, "ipfs://resp", ethers.keccak256("0x01"), "code-audit");
  }

  // ── ERC-7579 execute() calldata builders ─────────────────────────────

  /**
   * Build userOp.callData for execute(bytes32 mode, bytes executionCalldata).
   * Single mode uses abi.encodePacked(target, value, innerCalldata).
   */
  function buildExecuteSingle(target: string, value: bigint = 0n, innerCalldata: string = "0x"): string {
    const execData = ethers.solidityPacked(
      ["address", "uint256", "bytes"],
      [target, value, innerCalldata]
    );
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes"],
      [MODE_SINGLE, execData]
    );
    return EXECUTE_SELECTOR + encoded.slice(2);
  }

  /**
   * Build userOp.callData for execute() in batch mode.
   * Batch uses abi.encode(Execution[]) where Execution = (address, uint256, bytes).
   */
  function buildExecuteBatch(executions: Array<{ target: string; value: bigint; callData: string }>): string {
    const execData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address target, uint256 value, bytes callData)[]"],
      [executions]
    );
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes"],
      [MODE_BATCH, execData]
    );
    return EXECUTE_SELECTOR + encoded.slice(2);
  }

  /**
   * Build userOp.callData for execute() in delegatecall mode.
   */
  function buildExecuteDelegatecall(target: string, innerCalldata: string = "0x"): string {
    const execData = ethers.solidityPacked(
      ["address", "bytes"],
      [target, innerCalldata]
    );
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes"],
      [MODE_DELEGATECALL, execData]
    );
    return EXECUTE_SELECTOR + encoded.slice(2);
  }

  // ═════════════════════════════════════════════════════════════════════
  //                       MODULE LIFECYCLE
  // ═════════════════════════════════════════════════════════════════════

  describe("Module Lifecycle", function () {
    it("should report type = validator (1)", async function () {
      expect(await validationModule.isModuleType(1)).to.be.true;
      expect(await validationModule.isModuleType(2)).to.be.false;
      expect(await validationModule.isModuleType(3)).to.be.false;
      expect(await validationModule.isModuleType(4)).to.be.false;
    });

    it("should install for an account", async function () {
      await installFor(fakeAccount, AGENT_ID);
      expect(await validationModule.isInstalled(fakeAccount)).to.be.true;
      const [reg, id] = await validationModule.getConfig(fakeAccount);
      expect(reg).to.equal(await mockRegistry.getAddress());
      expect(id).to.equal(AGENT_ID);
    });

    it("should return correct owner after install", async function () {
      await installFor(fakeAccount, AGENT_ID);
      expect(await validationModule.getOwner(fakeAccount)).to.equal(agentOwner.address);
    });

    it("should reject double install", async function () {
      await installFor(fakeAccount, AGENT_ID);
      await ethers.provider.send("hardhat_setBalance", [fakeAccount, "0x56BC75E2D63100000"]);
      const s = await ethers.getImpersonatedSigner(fakeAccount);
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [await mockRegistry.getAddress(), AGENT_ID]
      );
      await expect(
        validationModule.connect(s).onInstall(data)
      ).to.be.revertedWithCustomError(validationModule, "AlreadyInstalled");
    });

    it("should reject zero registry on install", async function () {
      await ethers.provider.send("hardhat_setBalance", [fakeAccount, "0x56BC75E2D63100000"]);
      const s = await ethers.getImpersonatedSigner(fakeAccount);
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [ethers.ZeroAddress, AGENT_ID]
      );
      await expect(
        validationModule.connect(s).onInstall(data)
      ).to.be.revertedWithCustomError(validationModule, "InvalidRegistryAddress");
    });

    it("onUninstall always reverts", async function () {
      await expect(
        validationModule.onUninstall("0x")
      ).to.be.revertedWithCustomError(validationModule, "CannotUninstall");
    });

    it("getOwner returns zero for non-installed account", async function () {
      expect(await validationModule.getOwner(randomUser.address)).to.equal(ethers.ZeroAddress);
    });

    it("isInstalled returns false for non-installed account", async function () {
      expect(await validationModule.isInstalled(randomUser.address)).to.be.false;
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                  validateUserOp — OWNERSHIP
  // ═════════════════════════════════════════════════════════════════════

  describe("validateUserOp — Ownership", function () {
    beforeEach(async function () {
      await installFor(fakeAccount, AGENT_ID);
      await approveCode(AGENT_ID);
    });

    it("accepts UserOp signed by NFT owner", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("op1"));
      const sig = await signHash(hash, agentOwner);
      const op = buildUserOp(fakeAccount, "0x12345678", sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(0n);
    });

    it("rejects UserOp signed by wrong signer", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("op2"));
      const sig = await signHash(hash, randomUser);
      const op = buildUserOp(fakeAccount, "0x12345678", sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(1n);
    });

    it("rejects UserOp for uninstalled account", async function () {
      const other = ethers.Wallet.createRandom().address;
      const hash = ethers.keccak256(ethers.toUtf8Bytes("op3"));
      const sig = await signHash(hash, agentOwner);
      const op = buildUserOp(other, "0x12345678", sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(1n);
    });

    it("tracks live ownership after NFT transfer", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("op4"));

      // transfer NFT to randomUser
      await mockRegistry
        .connect(agentOwner)
        .transferFrom(agentOwner.address, randomUser.address, AGENT_ID);

      // old owner fails
      const oldSig = await signHash(hash, agentOwner);
      expect(
        await validationModule.validateUserOp(
          buildUserOp(fakeAccount, "0x12345678", oldSig),
          hash
        )
      ).to.equal(1n);

      // new owner succeeds
      const newSig = await signHash(hash, randomUser);
      expect(
        await validationModule.validateUserOp(
          buildUserOp(fakeAccount, "0x12345678", newSig),
          hash
        )
      ).to.equal(0n);
    });

    it("rejects empty signature", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("op5"));
      const op = buildUserOp(fakeAccount, "0x12345678", "0x");
      expect(await validationModule.validateUserOp(op, hash)).to.equal(1n);
    });

    it("rejects short signature (< 65 bytes)", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("op6"));
      const op = buildUserOp(fakeAccount, "0x12345678", "0x" + "ab".repeat(32));
      expect(await validationModule.validateUserOp(op, hash)).to.equal(1n);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                  validateUserOp — KYA GATE
  // ═════════════════════════════════════════════════════════════════════

  describe("validateUserOp — KYA Gate", function () {
    let unapprovedAccount: string;

    beforeEach(async function () {
      unapprovedAccount = ethers.Wallet.createRandom().address;
      await mockRegistry.connect(agentOwner).register(); // agentId = 2
      await installFor(unapprovedAccount, 2n);
    });

    it("rejects when code is not approved", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("kya1"));
      const sig = await signHash(hash, agentOwner);
      const op = buildUserOp(unapprovedAccount, "0x12345678", sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(1n);
    });

    it("passes after code is approved", async function () {
      await approveCode(2n);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("kya2"));
      const sig = await signHash(hash, agentOwner);
      const op = buildUserOp(unapprovedAccount, "0x12345678", sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(0n);
    });

    it("passes when KYA gate disabled (registry = address(0))", async function () {
      await validationModule.connect(admin).setValidationRegistry(ethers.ZeroAddress);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("kya3"));
      const sig = await signHash(hash, agentOwner);
      const op = buildUserOp(unapprovedAccount, "0x12345678", sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(0n);
    });

    it("isKYAApproved returns correct status", async function () {
      expect(await validationModule.isKYAApproved(unapprovedAccount)).to.be.false;
      await approveCode(2n);
      expect(await validationModule.isKYAApproved(unapprovedAccount)).to.be.true;
    });

    it("isKYAApproved returns true when gate disabled", async function () {
      await validationModule.connect(admin).setValidationRegistry(ethers.ZeroAddress);
      expect(await validationModule.isKYAApproved(unapprovedAccount)).to.be.true;
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                  validateUserOp — MODULE LOCK
  // ═════════════════════════════════════════════════════════════════════

  describe("validateUserOp — Module Lock", function () {
    beforeEach(async function () {
      await installFor(fakeAccount, AGENT_ID);
      await approveCode(AGENT_ID);
    });

    it("blocks installModule selector", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("lock1"));
      const sig = await signHash(hash, agentOwner);
      const op = buildUserOp(fakeAccount, INSTALL_MODULE_SELECTOR + "0".repeat(192), sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(1n);
    });

    it("blocks uninstallModule selector", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("lock2"));
      const sig = await signHash(hash, agentOwner);
      const op = buildUserOp(fakeAccount, UNINSTALL_MODULE_SELECTOR + "0".repeat(192), sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(1n);
    });

    it("allows other selectors (non-module-management)", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("lock3"));
      const sig = await signHash(hash, agentOwner);
      // Use a random selector that isn't execute/install/uninstall
      const op = buildUserOp(fakeAccount, "0xaabbccdd" + "0".repeat(128), sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(0n);
    });

    it("blocks executeFromExecutor selector", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("lock3b"));
      const sig = await signHash(hash, agentOwner);
      const op = buildUserOp(fakeAccount, EXECUTE_FROM_EXECUTOR_SELECTOR + "0".repeat(192), sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(1n);
    });

    it("allows calldata < 4 bytes", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("lock4"));
      const sig = await signHash(hash, agentOwner);
      const op = buildUserOp(fakeAccount, "0x1234", sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(0n);
    });

    it("allows empty calldata", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("lock5"));
      const sig = await signHash(hash, agentOwner);
      const op = buildUserOp(fakeAccount, "0x", sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(0n);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //          validateUserOp — C-02: execute() WRAPPING BYPASS
  // ═════════════════════════════════════════════════════════════════════

  describe("validateUserOp — C-02: execute() wrapping bypass", function () {
    beforeEach(async function () {
      await installFor(fakeAccount, AGENT_ID);
      await approveCode(AGENT_ID);
    });

    // ── Single mode ─────────────────────────────────────────────────

    it("blocks single execute() targeting self (self-call bypass)", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("c02-single-self"));
      const sig = await signHash(hash, agentOwner);
      // Wrap installModule inside execute(single) targeting the Safe itself
      const installCalldata = INSTALL_MODULE_SELECTOR + "0".repeat(192);
      const callData = buildExecuteSingle(fakeAccount, 0n, installCalldata);
      const op = buildUserOp(fakeAccount, callData, sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(1n);
    });

    it("allows single execute() targeting another address", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("c02-single-other"));
      const sig = await signHash(hash, agentOwner);
      const otherAddr = ethers.Wallet.createRandom().address;
      const callData = buildExecuteSingle(otherAddr, 0n, "0xdeadbeef");
      const op = buildUserOp(fakeAccount, callData, sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(0n);
    });

    it("blocks single execute() targeting self even with value transfer", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("c02-single-value"));
      const sig = await signHash(hash, agentOwner);
      const callData = buildExecuteSingle(fakeAccount, ethers.parseEther("1"), "0x");
      const op = buildUserOp(fakeAccount, callData, sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(1n);
    });

    // ── Batch mode ──────────────────────────────────────────────────

    it("blocks batch execute() when ANY target is self", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("c02-batch-self"));
      const sig = await signHash(hash, agentOwner);
      const otherAddr = ethers.Wallet.createRandom().address;
      const callData = buildExecuteBatch([
        { target: otherAddr, value: 0n, callData: "0xaabb" },
        { target: fakeAccount, value: 0n, callData: INSTALL_MODULE_SELECTOR + "0".repeat(192) },
      ]);
      const op = buildUserOp(fakeAccount, callData, sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(1n);
    });

    it("allows batch execute() when no target is self", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("c02-batch-ok"));
      const sig = await signHash(hash, agentOwner);
      const addr1 = ethers.Wallet.createRandom().address;
      const addr2 = ethers.Wallet.createRandom().address;
      const callData = buildExecuteBatch([
        { target: addr1, value: 0n, callData: "0xaabb" },
        { target: addr2, value: ethers.parseEther("0.5"), callData: "0x" },
      ]);
      const op = buildUserOp(fakeAccount, callData, sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(0n);
    });

    it("blocks batch execute() when self-call is buried among many", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("c02-batch-buried"));
      const sig = await signHash(hash, agentOwner);
      const addrs = Array.from({ length: 5 }, () => ethers.Wallet.createRandom().address);
      const executions = addrs.map(a => ({ target: a, value: 0n, callData: "0x" }));
      // Insert self-call at position 3
      executions.splice(3, 0, { target: fakeAccount, value: 0n, callData: "0xdeadbeef" });
      const callData = buildExecuteBatch(executions);
      const op = buildUserOp(fakeAccount, callData, sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(1n);
    });

    // ── Delegatecall mode ───────────────────────────────────────────

    it("blocks delegatecall execute() unconditionally", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("c02-delegate"));
      const sig = await signHash(hash, agentOwner);
      const otherAddr = ethers.Wallet.createRandom().address;
      const callData = buildExecuteDelegatecall(otherAddr, "0xdeadbeef");
      const op = buildUserOp(fakeAccount, callData, sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(1n);
    });

    it("blocks delegatecall even targeting self", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("c02-delegate-self"));
      const sig = await signHash(hash, agentOwner);
      const callData = buildExecuteDelegatecall(fakeAccount, "0x");
      const op = buildUserOp(fakeAccount, callData, sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(1n);
    });

    // ── Edge cases ──────────────────────────────────────────────────

    it("allows execute() calldata shorter than 100 bytes (no decode attempt)", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("c02-short"));
      const sig = await signHash(hash, agentOwner);
      // execute selector + very short payload (< 100 bytes total)
      const op = buildUserOp(fakeAccount, EXECUTE_SELECTOR + "00".repeat(40), sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(0n);
    });

    it("blocks single execute() with self-target regardless of inner calldata", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("c02-any-inner"));
      const sig = await signHash(hash, agentOwner);
      // Even a benign inner call to self is blocked — no legitimate reason
      const callData = buildExecuteSingle(fakeAccount, 0n, "0x");
      const op = buildUserOp(fakeAccount, callData, sig);
      expect(await validationModule.validateUserOp(op, hash)).to.equal(1n);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                     ERC-1271 SIGNATURES
  // ═════════════════════════════════════════════════════════════════════

  describe("ERC-1271", function () {
    beforeEach(async function () {
      await installFor(fakeAccount, AGENT_ID);
      await approveCode(AGENT_ID); // H-01: KYA now enforced for ERC-1271
    });

    it("validates signature from NFT owner", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("msg1"));
      const sig = await agentOwner.signMessage(ethers.getBytes(hash));
      await ethers.provider.send("hardhat_setBalance", [fakeAccount, "0x56BC75E2D63100000"]);
      const s = await ethers.getImpersonatedSigner(fakeAccount);
      expect(
        await validationModule.connect(s).isValidSignatureWithSender(randomUser.address, hash, sig)
      ).to.equal("0x1626ba7e");
    });

    it("rejects signature from non-owner", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("msg2"));
      const sig = await randomUser.signMessage(ethers.getBytes(hash));
      await ethers.provider.send("hardhat_setBalance", [fakeAccount, "0x56BC75E2D63100000"]);
      const s = await ethers.getImpersonatedSigner(fakeAccount);
      expect(
        await validationModule.connect(s).isValidSignatureWithSender(randomUser.address, hash, sig)
      ).to.equal("0xffffffff");
    });

    it("returns invalid for uninstalled account", async function () {
      const addr = ethers.Wallet.createRandom().address;
      await ethers.provider.send("hardhat_setBalance", [addr, "0x56BC75E2D63100000"]);
      const s = await ethers.getImpersonatedSigner(addr);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("msg3"));
      const sig = await agentOwner.signMessage(ethers.getBytes(hash));
      expect(
        await validationModule.connect(s).isValidSignatureWithSender(randomUser.address, hash, sig)
      ).to.equal("0xffffffff");
    });

    it("enforces KYA gate (H-01 fix)", async function () {
      // agentId=2, no code approval — should be REJECTED
      const addr2 = ethers.Wallet.createRandom().address;
      await mockRegistry.connect(agentOwner).register();
      await installFor(addr2, 2n);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("msg4"));
      const sig = await agentOwner.signMessage(ethers.getBytes(hash));
      await ethers.provider.send("hardhat_setBalance", [addr2, "0x56BC75E2D63100000"]);
      const s = await ethers.getImpersonatedSigner(addr2);
      expect(
        await validationModule.connect(s).isValidSignatureWithSender(randomUser.address, hash, sig)
      ).to.equal("0xffffffff"); // KYA enforced — unapproved code is rejected
    });

    it("passes ERC-1271 after code is approved", async function () {
      const addr2 = ethers.Wallet.createRandom().address;
      await mockRegistry.connect(agentOwner).register();
      await installFor(addr2, 2n);
      await approveCode(2n);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("msg4b"));
      const sig = await agentOwner.signMessage(ethers.getBytes(hash));
      await ethers.provider.send("hardhat_setBalance", [addr2, "0x56BC75E2D63100000"]);
      const s = await ethers.getImpersonatedSigner(addr2);
      expect(
        await validationModule.connect(s).isValidSignatureWithSender(randomUser.address, hash, sig)
      ).to.equal("0x1626ba7e"); // approved → valid
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                         ADMIN
  // ═════════════════════════════════════════════════════════════════════

  describe("Admin", function () {
    it("owner can set validationRegistry", async function () {
      await expect(
        validationModule.connect(admin).setValidationRegistry(ethers.ZeroAddress)
      ).to.emit(validationModule, "ValidationRegistryUpdated");
    });

    it("non-owner cannot set validationRegistry", async function () {
      await expect(
        validationModule.connect(randomUser).setValidationRegistry(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(validationModule, "OwnableUnauthorizedAccount");
    });

    it("emits old and new registry addresses", async function () {
      const oldAddr = await validationModule.validationRegistry();
      const newAddr = ethers.Wallet.createRandom().address;
      await expect(
        validationModule.connect(admin).setValidationRegistry(newAddr)
      )
        .to.emit(validationModule, "ValidationRegistryUpdated")
        .withArgs(oldAddr, newAddr);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                     UUPS UPGRADEABILITY
  // ═════════════════════════════════════════════════════════════════════

  describe("UUPS Upgradeability", function () {
    it("owner can upgrade to a new implementation", async function () {
      const ModFactory = await ethers.getContractFactory("Agether8004ValidationModule");
      const upgraded = await (await import("hardhat")).upgrades.upgradeProxy(
        await validationModule.getAddress(),
        ModFactory,
        { kind: "uups" }
      );
      expect(await upgraded.getAddress()).to.equal(await validationModule.getAddress());
    });

    it("non-owner cannot upgrade", async function () {
      const ModFactory = await ethers.getContractFactory("Agether8004ValidationModule", randomUser);
      await expect(
        (await import("hardhat")).upgrades.upgradeProxy(
          await validationModule.getAddress(),
          ModFactory,
          { kind: "uups" }
        )
      ).to.be.revertedWithCustomError(validationModule, "OwnableUnauthorizedAccount");
    });

    it("implementation has initializers disabled", async function () {
      const ModFactory = await ethers.getContractFactory("Agether8004ValidationModule");
      const impl = await ModFactory.deploy();
      await impl.waitForDeployment();
      await expect(
        impl.initialize(admin.address)
      ).to.be.revertedWithCustomError(impl, "InvalidInitialization");
    });

    it("proxy cannot be initialized twice", async function () {
      await expect(
        validationModule.connect(admin).initialize(randomUser.address)
      ).to.be.revertedWithCustomError(validationModule, "InvalidInitialization");
    });

    it("state is preserved after upgrade", async function () {
      // Install + set registry
      await installFor(fakeAccount, AGENT_ID);
      const registryBefore = await validationModule.validationRegistry();

      // Upgrade
      const ModFactory = await ethers.getContractFactory("Agether8004ValidationModule");
      const upgraded = await (await import("hardhat")).upgrades.upgradeProxy(
        await validationModule.getAddress(),
        ModFactory,
        { kind: "uups" }
      );

      // Verify state preserved
      expect(await upgraded.isInstalled(fakeAccount)).to.be.true;
      expect(await upgraded.validationRegistry()).to.equal(registryBefore);
      const [reg, id] = await upgraded.getConfig(fakeAccount);
      expect(reg).to.equal(await mockRegistry.getAddress());
      expect(id).to.equal(AGENT_ID);
    });
  });
});
