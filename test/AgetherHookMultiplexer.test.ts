import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * AgetherHookMultiplexer — unit tests
 *
 * Covers:
 *  - Module lifecycle (onInstall / onUninstall / isModuleType)
 *  - Sub-hook management (add, remove, limits, duplicates)
 *  - Hook execution (preCheck, postCheck with sub-hooks)
 *  - Access control (onlyOwner)
 *  - View functions (getHooks, hookCount, isSubHook)
 */
describe("AgetherHookMultiplexer", function () {
  let admin: SignerWithAddress;
  let randomUser: SignerWithAddress;

  let hookMultiplexer: any;
  let mockHook1: any;
  let mockHook2: any;

  const TYPE_HOOK = 4;

  beforeEach(async function () {
    [admin, , randomUser] = await ethers.getSigners();

    const HookFactory = await ethers.getContractFactory("AgetherHookMultiplexer");
    hookMultiplexer = await upgrades.deployProxy(HookFactory, [admin.address], { kind: "uups" });
    await hookMultiplexer.waitForDeployment();

    const MockFactory = await ethers.getContractFactory("MockModule");
    mockHook1 = await MockFactory.deploy(TYPE_HOOK);
    await mockHook1.waitForDeployment();
    mockHook2 = await MockFactory.deploy(TYPE_HOOK);
    await mockHook2.waitForDeployment();
  });

  // ═════════════════════════════════════════════════════════════════════
  //                       MODULE LIFECYCLE
  // ═════════════════════════════════════════════════════════════════════

  describe("Module Lifecycle", function () {
    it("reports type = hook (4)", async function () {
      expect(await hookMultiplexer.isModuleType(4)).to.be.true;
      expect(await hookMultiplexer.isModuleType(1)).to.be.false;
      expect(await hookMultiplexer.isModuleType(2)).to.be.false;
      expect(await hookMultiplexer.isModuleType(3)).to.be.false;
    });

    it("onInstall succeeds (no-op)", async function () {
      await hookMultiplexer.onInstall("0x");
    });

    it("onUninstall always reverts", async function () {
      await expect(
        hookMultiplexer.onUninstall("0x")
      ).to.be.revertedWithCustomError(hookMultiplexer, "CannotUninstall");
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                    SUB-HOOK MANAGEMENT
  // ═════════════════════════════════════════════════════════════════════

  describe("Sub-Hook Management", function () {
    it("adds a sub-hook", async function () {
      await expect(
        hookMultiplexer.connect(admin).addHook(await mockHook1.getAddress())
      )
        .to.emit(hookMultiplexer, "SubHookAdded")
        .withArgs(await mockHook1.getAddress(), 1);
      expect(await hookMultiplexer.hookCount()).to.equal(1);
      expect(await hookMultiplexer.isSubHook(await mockHook1.getAddress())).to.be.true;
    });

    it("adds multiple sub-hooks", async function () {
      await hookMultiplexer.connect(admin).addHook(await mockHook1.getAddress());
      await hookMultiplexer.connect(admin).addHook(await mockHook2.getAddress());
      expect(await hookMultiplexer.hookCount()).to.equal(2);
      const hooks = await hookMultiplexer.getHooks();
      expect(hooks.length).to.equal(2);
    });

    it("returns all hooks via getHooks()", async function () {
      const a1 = await mockHook1.getAddress();
      const a2 = await mockHook2.getAddress();
      await hookMultiplexer.connect(admin).addHook(a1);
      await hookMultiplexer.connect(admin).addHook(a2);
      const hooks = await hookMultiplexer.getHooks();
      expect(hooks).to.include(a1);
      expect(hooks).to.include(a2);
    });

    it("rejects duplicate sub-hook", async function () {
      await hookMultiplexer.connect(admin).addHook(await mockHook1.getAddress());
      await expect(
        hookMultiplexer.connect(admin).addHook(await mockHook1.getAddress())
      ).to.be.revertedWithCustomError(hookMultiplexer, "HookAlreadyAdded");
    });

    it("rejects zero address", async function () {
      await expect(
        hookMultiplexer.connect(admin).addHook(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(hookMultiplexer, "ZeroAddress");
    });

    it("enforces MAX_HOOKS (10) limit", async function () {
      const MockFactory = await ethers.getContractFactory("MockModule");
      for (let i = 0; i < 10; i++) {
        const h = await MockFactory.deploy(TYPE_HOOK);
        await h.waitForDeployment();
        await hookMultiplexer.connect(admin).addHook(await h.getAddress());
      }
      expect(await hookMultiplexer.hookCount()).to.equal(10);

      const extra = await MockFactory.deploy(TYPE_HOOK);
      await extra.waitForDeployment();
      await expect(
        hookMultiplexer.connect(admin).addHook(await extra.getAddress())
      ).to.be.revertedWithCustomError(hookMultiplexer, "TooManyHooks");
    });

    it("removes a sub-hook", async function () {
      await hookMultiplexer.connect(admin).addHook(await mockHook1.getAddress());
      await hookMultiplexer.connect(admin).addHook(await mockHook2.getAddress());

      await expect(
        hookMultiplexer.connect(admin).removeHook(await mockHook1.getAddress())
      )
        .to.emit(hookMultiplexer, "SubHookRemoved")
        .withArgs(await mockHook1.getAddress(), 1);

      expect(await hookMultiplexer.hookCount()).to.equal(1);
      expect(await hookMultiplexer.isSubHook(await mockHook1.getAddress())).to.be.false;
      expect(await hookMultiplexer.isSubHook(await mockHook2.getAddress())).to.be.true;
    });

    it("allows re-adding a removed hook", async function () {
      const a = await mockHook1.getAddress();
      await hookMultiplexer.connect(admin).addHook(a);
      await hookMultiplexer.connect(admin).removeHook(a);
      expect(await hookMultiplexer.isSubHook(a)).to.be.false;

      await hookMultiplexer.connect(admin).addHook(a);
      expect(await hookMultiplexer.isSubHook(a)).to.be.true;
      expect(await hookMultiplexer.hookCount()).to.equal(1);
    });

    it("rejects removing non-existent hook", async function () {
      await expect(
        hookMultiplexer.connect(admin).removeHook(await mockHook1.getAddress())
      ).to.be.revertedWithCustomError(hookMultiplexer, "HookNotFound");
    });

    it("only owner can addHook", async function () {
      await expect(
        hookMultiplexer.connect(randomUser).addHook(await mockHook1.getAddress())
      ).to.be.revertedWithCustomError(hookMultiplexer, "OwnableUnauthorizedAccount");
    });

    it("only owner can removeHook", async function () {
      await hookMultiplexer.connect(admin).addHook(await mockHook1.getAddress());
      await expect(
        hookMultiplexer.connect(randomUser).removeHook(await mockHook1.getAddress())
      ).to.be.revertedWithCustomError(hookMultiplexer, "OwnableUnauthorizedAccount");
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                      HOOK EXECUTION
  // ═════════════════════════════════════════════════════════════════════

  describe("Hook Execution", function () {
    it("preCheck with no sub-hooks returns empty bytes", async function () {
      const r = await hookMultiplexer.preCheck.staticCall(admin.address, 0n, "0x");
      expect(r).to.equal("0x");
    });

    it("postCheck with no sub-hooks succeeds", async function () {
      await hookMultiplexer.postCheck("0x");
    });

    it("preCheck calls all sub-hooks", async function () {
      await hookMultiplexer.connect(admin).addHook(await mockHook1.getAddress());
      await hookMultiplexer.connect(admin).addHook(await mockHook2.getAddress());

      await hookMultiplexer.preCheck(admin.address, 0n, "0x");

      expect(await mockHook1.preCheckCount()).to.equal(1);
      expect(await mockHook2.preCheckCount()).to.equal(1);
    });

    it("preCheck returns encoded hook data", async function () {
      await hookMultiplexer.connect(admin).addHook(await mockHook1.getAddress());

      const hookData = await hookMultiplexer.preCheck.staticCall(admin.address, 0n, "0x");
      expect(hookData).to.not.equal("0x");

      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["bytes[]"], hookData);
      expect(decoded[0].length).to.equal(1);
    });

    it("preCheck + postCheck round-trip", async function () {
      await hookMultiplexer.connect(admin).addHook(await mockHook1.getAddress());

      await hookMultiplexer.preCheck(admin.address, 0n, "0x");
      expect(await mockHook1.preCheckCount()).to.equal(1);

      const mockHookData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes[]"],
        [[ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [1])]]
      );
      await hookMultiplexer.postCheck(mockHookData);
      expect(await mockHook1.postCheckCount()).to.equal(1);
    });

    it("preCheck forwards parameters to sub-hooks", async function () {
      await hookMultiplexer.connect(admin).addHook(await mockHook1.getAddress());
      await hookMultiplexer.preCheck(randomUser.address, 1000n, "0xdeadbeef");
      expect(await mockHook1.preCheckCount()).to.equal(1);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                     UUPS UPGRADEABILITY
  // ═════════════════════════════════════════════════════════════════════

  describe("UUPS Upgradeability", function () {
    it("owner can upgrade to new implementation", async function () {
      const V2 = await ethers.getContractFactory("AgetherHookMultiplexer");
      const upgraded = await upgrades.upgradeProxy(await hookMultiplexer.getAddress(), V2);
      expect(await upgraded.getAddress()).to.equal(await hookMultiplexer.getAddress());
    });

    it("non-owner cannot upgrade", async function () {
      const V2 = await ethers.getContractFactory("AgetherHookMultiplexer", randomUser);
      await expect(
        upgrades.upgradeProxy(await hookMultiplexer.getAddress(), V2)
      ).to.be.revertedWithCustomError(hookMultiplexer, "OwnableUnauthorizedAccount");
    });

    it("state persists after upgrade", async function () {
      // Add a sub-hook before upgrade
      await hookMultiplexer.connect(admin).addHook(await mockHook1.getAddress());
      expect(await hookMultiplexer.hookCount()).to.equal(1);

      // Upgrade
      const V2 = await ethers.getContractFactory("AgetherHookMultiplexer");
      const upgraded = await upgrades.upgradeProxy(await hookMultiplexer.getAddress(), V2);

      // State should persist
      expect(await upgraded.hookCount()).to.equal(1);
      expect(await upgraded.isSubHook(await mockHook1.getAddress())).to.be.true;
      expect(await upgraded.owner()).to.equal(admin.address);
    });
  });
});
