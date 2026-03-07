import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Agether4337Factory — unit tests
 *
 * Covers:
 *  - Constructor validation (zero address checks)
 *  - View functions (getAccount, accountExists, getAgentId, totalAccounts, etc.)
 *  - Admin functions (setValidationModule, setHookMultiplexer)
 *  - Access control (onlyOwner)
 *  - createAccount (NFT ownership, duplicate prevention)
 *  - Full account creation on Base fork with real Safe infrastructure
 *
 * NOTE: Tests run on a Base fork (chainId 8453) so real Safe, SafeProxyFactory,
 *       and Safe7579 contracts are available at their deployed addresses.
 */
describe("Agether4337Factory", function () {
  let admin: SignerWithAddress;
  let agentOwner: SignerWithAddress;
  let randomUser: SignerWithAddress;

  let mockRegistry: any; // MockAgentRegistry (ERC-721)
  let factory: any;      // Agether4337Factory
  let validationModule: any; // Agether8004ValidationModule
  let hookMultiplexer: any;  // AgetherHookMultiplexer
  let bootstrap: any;        // Agether7579Bootstrap

  const AGENT_ID = 1n;

  // Real Base addresses
  const SAFE_SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
  const SAFE_PROXY_FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
  const SAFE7579 = "0x7579EE8307284F293B1927136486880611F20002";

  beforeEach(async function () {
    [admin, agentOwner, randomUser] = await ethers.getSigners();

    // Deploy mock identity registry
    const MockReg = await ethers.getContractFactory("MockAgentRegistry");
    mockRegistry = await MockReg.deploy();
    await mockRegistry.waitForDeployment();
    await mockRegistry.connect(agentOwner).register(); // agentId=1

    // Deploy validation module (UUPS proxy)
    const ModFactory = await ethers.getContractFactory("Agether8004ValidationModule");
    validationModule = await (await import("hardhat")).upgrades.deployProxy(
      ModFactory,
      [admin.address],
      { kind: "uups" }
    );
    await validationModule.waitForDeployment();

    // Deploy hook multiplexer
    const HookFactory = await ethers.getContractFactory("AgetherHookMultiplexer");
    hookMultiplexer = await HookFactory.deploy(admin.address);
    await hookMultiplexer.waitForDeployment();

    // Deploy bootstrap (use fully qualified name to avoid ambiguity)
    const BootstrapFactory = await ethers.getContractFactory("Agether7579Bootstrap");
    bootstrap = await BootstrapFactory.deploy();
    await bootstrap.waitForDeployment();

    // Deploy factory (UUPS proxy)
    const FactoryDeploy = await ethers.getContractFactory("Agether4337Factory");
    factory = await upgrades.deployProxy(
      FactoryDeploy,
      [
        SAFE_SINGLETON,
        SAFE_PROXY_FACTORY,
        SAFE7579,
        await bootstrap.getAddress(),
        await mockRegistry.getAddress(),
        await validationModule.getAddress(),
        await hookMultiplexer.getAddress(),
        admin.address,
      ],
      { kind: "uups" }
    );
    await factory.waitForDeployment();
  });

  // ═════════════════════════════════════════════════════════════════════
  //                  CONSTRUCTOR VALIDATION
  // ═════════════════════════════════════════════════════════════════════

  describe("Initialize", function () {
    it("sets state correctly", async function () {
      expect(await factory.safeSingleton()).to.equal(SAFE_SINGLETON);
      expect(await factory.safe7579()).to.equal(SAFE7579);
      expect(await factory.identityRegistry()).to.equal(await mockRegistry.getAddress());
      expect(await factory.validationModule()).to.equal(await validationModule.getAddress());
      expect(await factory.hookMultiplexer()).to.equal(await hookMultiplexer.getAddress());
    });

    it("rejects zero safeSingleton", async function () {
      const F = await ethers.getContractFactory("Agether4337Factory");
      await expect(
        upgrades.deployProxy(
          F,
          [
            ethers.ZeroAddress,
            SAFE_PROXY_FACTORY,
            SAFE7579,
            await bootstrap.getAddress(),
            await mockRegistry.getAddress(),
            await validationModule.getAddress(),
            await hookMultiplexer.getAddress(),
            admin.address,
          ],
          { kind: "uups" }
        )
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("rejects zero safeProxyFactory", async function () {
      const F = await ethers.getContractFactory("Agether4337Factory");
      await expect(
        upgrades.deployProxy(
          F,
          [
            SAFE_SINGLETON,
            ethers.ZeroAddress,
            SAFE7579,
            await bootstrap.getAddress(),
            await mockRegistry.getAddress(),
            await validationModule.getAddress(),
            await hookMultiplexer.getAddress(),
            admin.address,
          ],
          { kind: "uups" }
        )
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("rejects zero safe7579", async function () {
      const F = await ethers.getContractFactory("Agether4337Factory");
      await expect(
        upgrades.deployProxy(
          F,
          [
            SAFE_SINGLETON,
            SAFE_PROXY_FACTORY,
            ethers.ZeroAddress,
            await bootstrap.getAddress(),
            await mockRegistry.getAddress(),
            await validationModule.getAddress(),
            await hookMultiplexer.getAddress(),
            admin.address,
          ],
          { kind: "uups" }
        )
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("rejects zero bootstrap", async function () {
      const F = await ethers.getContractFactory("Agether4337Factory");
      await expect(
        upgrades.deployProxy(
          F,
          [
            SAFE_SINGLETON,
            SAFE_PROXY_FACTORY,
            SAFE7579,
            ethers.ZeroAddress,
            await mockRegistry.getAddress(),
            await validationModule.getAddress(),
            await hookMultiplexer.getAddress(),
            admin.address,
          ],
          { kind: "uups" }
        )
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("rejects zero identityRegistry", async function () {
      const F = await ethers.getContractFactory("Agether4337Factory");
      await expect(
        upgrades.deployProxy(
          F,
          [
            SAFE_SINGLETON,
            SAFE_PROXY_FACTORY,
            SAFE7579,
            await bootstrap.getAddress(),
            ethers.ZeroAddress,
            await validationModule.getAddress(),
            await hookMultiplexer.getAddress(),
            admin.address,
          ],
          { kind: "uups" }
        )
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("rejects zero validationModule", async function () {
      const F = await ethers.getContractFactory("Agether4337Factory");
      await expect(
        upgrades.deployProxy(
          F,
          [
            SAFE_SINGLETON,
            SAFE_PROXY_FACTORY,
            SAFE7579,
            await bootstrap.getAddress(),
            await mockRegistry.getAddress(),
            ethers.ZeroAddress,
            await hookMultiplexer.getAddress(),
            admin.address,
          ],
          { kind: "uups" }
        )
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("rejects zero hookMultiplexer", async function () {
      const F = await ethers.getContractFactory("Agether4337Factory");
      await expect(
        upgrades.deployProxy(
          F,
          [
            SAFE_SINGLETON,
            SAFE_PROXY_FACTORY,
            SAFE7579,
            await bootstrap.getAddress(),
            await mockRegistry.getAddress(),
            await validationModule.getAddress(),
            ethers.ZeroAddress,
            admin.address,
          ],
          { kind: "uups" }
        )
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("cannot be initialized twice", async function () {
      await expect(
        factory.initialize(
          SAFE_SINGLETON,
          SAFE_PROXY_FACTORY,
          SAFE7579,
          await bootstrap.getAddress(),
          await mockRegistry.getAddress(),
          await validationModule.getAddress(),
          await hookMultiplexer.getAddress(),
          admin.address
        )
      ).to.be.revertedWithCustomError(factory, "InvalidInitialization");
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                      VIEW FUNCTIONS
  // ═════════════════════════════════════════════════════════════════════

  describe("View Functions", function () {
    it("getAccount returns zero for unknown agent", async function () {
      expect(await factory.getAccount(999n)).to.equal(ethers.ZeroAddress);
    });

    it("accountExists returns false for unknown agent", async function () {
      expect(await factory.accountExists(999n)).to.be.false;
    });

    it("getAgentId returns 0 for unknown address", async function () {
      expect(await factory.getAgentId(randomUser.address)).to.equal(0n);
    });

    it("totalAccounts starts at 0", async function () {
      expect(await factory.totalAccounts()).to.equal(0n);
    });

    it("getAllAgentIds starts empty", async function () {
      expect(await factory.getAllAgentIds()).to.deep.equal([]);
    });

    it("getAgentIdByIndex reverts for out of bounds", async function () {
      await expect(factory.getAgentIdByIndex(0)).to.be.reverted;
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                      ADMIN FUNCTIONS
  // ═════════════════════════════════════════════════════════════════════

  describe("Admin", function () {
    it("owner can set validation module", async function () {
      const newModule = ethers.Wallet.createRandom().address;
      const oldModule = await factory.validationModule();
      await expect(factory.connect(admin).setValidationModule(newModule))
        .to.emit(factory, "ValidationModuleUpdated")
        .withArgs(oldModule, newModule);
      expect(await factory.validationModule()).to.equal(newModule);
    });

    it("rejects zero address for validation module", async function () {
      await expect(
        factory.connect(admin).setValidationModule(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("non-owner cannot set validation module", async function () {
      const newModule = ethers.Wallet.createRandom().address;
      await expect(
        factory.connect(randomUser).setValidationModule(newModule)
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("owner can set hook multiplexer", async function () {
      const newHook = ethers.Wallet.createRandom().address;
      const oldHook = await factory.hookMultiplexer();
      await expect(factory.connect(admin).setHookMultiplexer(newHook))
        .to.emit(factory, "HookMultiplexerUpdated")
        .withArgs(oldHook, newHook);
      expect(await factory.hookMultiplexer()).to.equal(newHook);
    });

    it("rejects zero address for hook multiplexer", async function () {
      await expect(
        factory.connect(admin).setHookMultiplexer(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("non-owner cannot set hook multiplexer", async function () {
      const newHook = ethers.Wallet.createRandom().address;
      await expect(
        factory.connect(randomUser).setHookMultiplexer(newHook)
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //                    createAccount — ACCESS CONTROL
  // ═════════════════════════════════════════════════════════════════════

  describe("createAccount — Access Control", function () {
    it("rejects non-NFT-owner caller", async function () {
      await expect(
        factory.connect(randomUser).createAccount(AGENT_ID)
      ).to.be.revertedWithCustomError(factory, "NotAgentNFTOwner");
    });

    it("rejects for non-existent agent", async function () {
      // agentId=999 was never minted — ownerOf will revert in ERC721
      await expect(factory.connect(agentOwner).createAccount(999n)).to.be.reverted;
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //            createAccount — FULL SAFE DEPLOYMENT (Base fork)
  // ═════════════════════════════════════════════════════════════════════

  describe("createAccount — Safe Deployment", function () {
    let hasFork: boolean;

    before(async function () {
      // Check if Safe infrastructure is available on the fork
      const code = await ethers.provider.getCode(SAFE_PROXY_FACTORY);
      hasFork = code.length > 2; // "0x" means no code
      if (!hasFork) {
        console.log("      ⚠ Skipping Safe integration tests (Base fork not available)");
      }
    });

    beforeEach(function () {
      if (!hasFork) this.skip();
    });

    it("creates a Safe account for an agent", async function () {
      const tx = await factory.connect(agentOwner).createAccount(AGENT_ID);
      const receipt = await tx.wait();

      const safeAddr = await factory.getAccount(AGENT_ID);
      expect(safeAddr).to.not.equal(ethers.ZeroAddress);

      // Check mappings
      expect(await factory.accountExists(AGENT_ID)).to.be.true;
      expect(await factory.getAgentId(safeAddr)).to.equal(AGENT_ID);
      expect(await factory.totalAccounts()).to.equal(1n);
    });

    it("emits AccountCreated event", async function () {
      await expect(factory.connect(agentOwner).createAccount(AGENT_ID))
        .to.emit(factory, "AccountCreated")
        .withArgs(AGENT_ID, (v: string) => v !== ethers.ZeroAddress, agentOwner.address);
    });

    it("rejects duplicate account for same agent", async function () {
      await factory.connect(agentOwner).createAccount(AGENT_ID);
      await expect(
        factory.connect(agentOwner).createAccount(AGENT_ID)
      ).to.be.revertedWithCustomError(factory, "AccountAlreadyExists");
    });

    it("tracks multiple agents", async function () {
      // Register a second agent
      await mockRegistry.connect(randomUser).register(); // agentId=2
      await factory.connect(agentOwner).createAccount(AGENT_ID);
      await factory.connect(randomUser).createAccount(2n);

      expect(await factory.totalAccounts()).to.equal(2n);
      const ids = await factory.getAllAgentIds();
      expect(ids.length).to.equal(2);
      expect(ids[0]).to.equal(AGENT_ID);
      expect(ids[1]).to.equal(2n);
    });

    it("getAgentIdByIndex works after creation", async function () {
      await factory.connect(agentOwner).createAccount(AGENT_ID);
      expect(await factory.getAgentIdByIndex(0)).to.equal(AGENT_ID);
    });

    it("validation module is installed on created Safe", async function () {
      await factory.connect(agentOwner).createAccount(AGENT_ID);
      const safeAddr = await factory.getAccount(AGENT_ID);

      // Check the validation module knows about this account
      expect(await validationModule.isInstalled(safeAddr)).to.be.true;
      const [reg, id] = await validationModule.getConfig(safeAddr);
      expect(reg).to.equal(await mockRegistry.getAddress());
      expect(id).to.equal(AGENT_ID);
    });

    it("validation module reports correct owner", async function () {
      await factory.connect(agentOwner).createAccount(AGENT_ID);
      const safeAddr = await factory.getAccount(AGENT_ID);
      expect(await validationModule.getOwner(safeAddr)).to.equal(agentOwner.address);
    });
  });
});
