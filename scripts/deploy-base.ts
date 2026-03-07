import { ethers, upgrades, network, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Verify a contract on Basescan, swallowing "already verified" errors.
 */
async function verify(address: string, constructorArguments: any[] = []) {
  try {
    await run("verify:verify", { address, constructorArguments });
    console.log(`   ✓ Verified: ${address}`);
  } catch (e: any) {
    if (e.message?.includes("Already Verified") || e.message?.includes("already verified")) {
      console.log(`   ✓ Already verified: ${address}`);
    } else {
      console.log(`   ⚠️  Verification failed for ${address}: ${e.message}`);
    }
  }
}

/**
 * Deploy Agent Credit Protocol v2 on Base Mainnet (chain 8453).
 *
 * Safe-based Architecture:
 *   Each agent gets a Safe account with Safe7579 adapter, providing full
 *   ERC-4337 + ERC-7579 compliance. No custom smart wallet — battle-tested
 *   Safe v1.4.1 as the base.
 *
 * Deployed Contracts:
 *   1. TimelockController — OZ governance, 7-day delay
 *   2. Agether8004ValidationModule — single mandatory 7579 validator (UUPS)
 *      • Ownership: reads NFT owner live from ERC-8004
 *      • KYA gate: checks code approval in ValidationRegistry (set later)
 *      • Module lock: blocks installModule / uninstallModule UserOps
 *   3. AgetherHookMultiplexer — admin-managed hook chain (v1: zero sub-hooks)
 *   4. Agether7579Bootstrap — delegatecalled during Safe.setup()
 *   5. Agether4337Factory — deploys Safe proxies with all modules pre-installed
 *   6. Agether8004Scorer — OCCR credit scoring (UUPS)
 *
 * External Contracts (pre-deployed on Base):
 *   • Safe v1.4.1 singleton:  0x41675C099F32341bf84BFc5382aF534df5C7461a
 *   • SafeProxyFactory:       0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67
 *   • Safe7579 adapter:       0x7579EE8307284F293B1927136486880611F20002
 *   • EntryPoint v0.7:        0x0000000071727De22E5E9d8BAf0edAc6f37da032
 *   • ERC-8004 Registry:      0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 *   • Morpho Blue:            0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb
 *
 * Governance:
 *   • Agether4337Factory.owner       = TimelockController
 *   • Agether8004ValidationModule.owner = TimelockController
 *   • AgetherHookMultiplexer.owner        = TimelockController
 *   • Agether8004Scorer admin        = TimelockController
 *
 * Prerequisites:
 *   PRIVATE_KEY  in .env — deployer wallet with ETH on Base
 *   BASE_RPC_URL in .env — Base RPC endpoint
 *
 * Usage:
 *   npx hardhat run scripts/deploy-base.ts --network base
 */

// ══════════════════════════════════════════════════════════════════════════
//                        EXTERNAL ADDRESSES (Base)
// ══════════════════════════════════════════════════════════════════════════

// Safe infrastructure
const SAFE_SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
const SAFE_PROXY_FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
const SAFE7579 = "0x7579EE8307284F293B1927136486880611F20002";
const ENTRYPOINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

// ERC-8004 Identity Registry
const ERC8004_IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

// Morpho Blue
const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";

// Base Tokens
const WETH = "0x4200000000000000000000000000000000000006";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WSTETH = "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452";
const CBETH = "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22";

// Timelock
const TIMELOCK_MIN_DELAY = 7 * 24 * 3600; // 1 week

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("🚀 Agent Credit Protocol v2 — Base Deployment (Safe + Safe7579)");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   Network:", network.name, `(chainId: ${network.config.chainId})`);
  console.log("   Deployer:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("   Balance:", ethers.formatEther(balance), "ETH");

  if (balance < ethers.parseEther("0.0005")) {
    console.error("❌ Deployer needs more ETH for gas on Base!");
    process.exit(1);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //              0. VERIFY EXTERNAL CONTRACTS ON BASE
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n0. Verifying external contracts on Base...");

  const externals: Record<string, string> = {
    "ERC-8004 IdentityRegistry": ERC8004_IDENTITY_REGISTRY,
    "Safe v1.4.1 Singleton": SAFE_SINGLETON,
    "SafeProxyFactory": SAFE_PROXY_FACTORY,
    "Safe7579 Adapter": SAFE7579,
    "EntryPoint v0.7": ENTRYPOINT_V07,
    "Morpho Blue": MORPHO_BLUE,
    "USDC": USDC_BASE,
  };

  for (const [name, addr] of Object.entries(externals)) {
    const code = await ethers.provider.getCode(addr);
    if (code === "0x") {
      console.error(`❌ ${name} not found at ${addr}`);
      process.exit(1);
    }
    console.log(`   ✓ ${name}`);
  }
  console.log("   ✓ All external contracts verified");

  // ══════════════════════════════════════════════════════════════════════════
  //                          DEPLOY CONTRACTS
  // ══════════════════════════════════════════════════════════════════════════

  // ── 1. TimelockController ──
  console.log(`\n1. Deploying TimelockController (delay: ${TIMELOCK_MIN_DELAY / 3600}h)...`);
  const TimelockController = await ethers.getContractFactory("TimelockController");
  const timelock = await TimelockController.deploy(
    TIMELOCK_MIN_DELAY,
    [deployer.address], // proposers
    [deployer.address], // executors
    deployer.address    // admin (renounce after setup)
  );
  await timelock.waitForDeployment();
  const timelockAddr = await timelock.getAddress();
  console.log("   TimelockController:", timelockAddr);

  // ── 2. Agether8004ValidationModule (UUPS proxy, owned by timelock) ──
  console.log("\n2. Deploying Agether8004ValidationModule (UUPS proxy)...");
  const Agether8004ValidationModule = await ethers.getContractFactory("Agether8004ValidationModule");
  const validationModule = await upgrades.deployProxy(
    Agether8004ValidationModule,
    [timelockAddr],
    { kind: "uups" }
  );
  await validationModule.waitForDeployment();
  const validationModuleAddr = await validationModule.getAddress();
  console.log("   Agether8004ValidationModule (proxy):", validationModuleAddr);
  console.log("   Owner: TimelockController ✓");
  console.log("   ValidationRegistry: NOT SET (KYA gate disabled — all txs pass)");

  // ── 3. AgetherHookMultiplexer (owned by timelock) ──
  console.log("\n3. Deploying AgetherHookMultiplexer...");
  const AgetherHookMultiplexer = await ethers.getContractFactory("AgetherHookMultiplexer");
  const hookMultiplexer = await AgetherHookMultiplexer.deploy(timelockAddr);
  await hookMultiplexer.waitForDeployment();
  const hookMultiplexerAddr = await hookMultiplexer.getAddress();
  console.log("   AgetherHookMultiplexer:", hookMultiplexerAddr);
  console.log("   Owner: TimelockController ✓");
  console.log("   Sub-hooks: 0 (v1 — no sub-hooks yet)");

  // ── 4. Agether7579Bootstrap ──
  console.log("\n4. Deploying Agether7579Bootstrap...");
  const Bootstrap = await ethers.getContractFactory(
    "src/Agether7579Bootstrap.sol:Agether7579Bootstrap"
  );
  const bootstrap = await Bootstrap.deploy();
  await bootstrap.waitForDeployment();
  const bootstrapAddr = await bootstrap.getAddress();
  console.log("   Agether7579Bootstrap:", bootstrapAddr);

  // ── 5. Agether4337Factory (owned by timelock, UUPS proxy) ──
  console.log("\n5. Deploying Agether4337Factory (UUPS proxy)...");
  const Agether4337Factory = await ethers.getContractFactory("Agether4337Factory");
  const factory = await (await import("hardhat")).upgrades.deployProxy(
    Agether4337Factory,
    [
      SAFE_SINGLETON,
      SAFE_PROXY_FACTORY,
      SAFE7579,
      bootstrapAddr,
      ERC8004_IDENTITY_REGISTRY,
      validationModuleAddr,
      hookMultiplexerAddr,
      timelockAddr,
    ],
    { kind: "uups" }
  );
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("   Agether4337Factory (proxy):", factoryAddr);
  console.log("   Owner: TimelockController ✓");
  console.log("   Safe singleton:", SAFE_SINGLETON);
  console.log("   Safe7579:", SAFE7579);
  console.log("   Bootstrap:", bootstrapAddr);

  // ── 6. Agether8004Scorer (OCCR scoring — UUPS proxy) ──
  console.log("\n6. Deploying Agether8004Scorer (OCCR)...");
  const Agether8004Scorer = await ethers.getContractFactory("Agether8004Scorer");
  const agentReputation = await upgrades.deployProxy(
    Agether8004Scorer,
    [deployer.address],
    { kind: "uups" }
  );
  await agentReputation.waitForDeployment();
  const agentReputationAddr = await agentReputation.getAddress();
  console.log("   Agether8004Scorer:", agentReputationAddr);

  // ══════════════════════════════════════════════════════════════════════════
  //                          CONFIGURE CONTRACTS
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n📝 Configuring contracts...");

  // Agether8004Scorer: Set oracleSigner (backend signs score attestations)
  await (await agentReputation.setOracleSigner(deployer.address)).wait();
  console.log("   ✓ Agether8004Scorer: oracleSigner set to deployer");

  // Agether8004Scorer: Grant ORACLE_ROLE to deployer
  const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
  const hasOracleRole = await agentReputation.hasRole(ORACLE_ROLE, deployer.address);
  if (!hasOracleRole) {
    await (await agentReputation.grantRole(ORACLE_ROLE, deployer.address)).wait();
    console.log("   ✓ Agether8004Scorer: ORACLE_ROLE granted to deployer");
  } else {
    console.log("   ✓ Agether8004Scorer: deployer already has ORACLE_ROLE");
  }

  // ── Transfer admin roles to TimelockController ──
  console.log("\n🔐 Transferring admin roles to TimelockController...");

  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

  // Agether8004Scorer → timelock
  await (await agentReputation.grantRole(DEFAULT_ADMIN_ROLE, timelockAddr)).wait();
  await (await agentReputation.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address)).wait();
  console.log("   ✓ Agether8004Scorer: admin → TimelockController");

  // Agether8004ValidationModule, Agether4337Factory: owned by timelock via proxy initialize()
  // AgetherHookMultiplexer: owned by timelock from constructor
  console.log("   ✓ Agether8004ValidationModule: owner = TimelockController (proxy initialize)");
  console.log("   ✓ AgetherHookMultiplexer: owner = TimelockController (constructor)");
  console.log("   ✓ Agether4337Factory: owner = TimelockController (proxy initialize)");

  console.log("\n   ⚠️  TimelockController admin role still held by deployer.");
  console.log("   ⚠️  Renounce after verifying everything works:");
  console.log(`      timelock.renounceRole(DEFAULT_ADMIN_ROLE, "${deployer.address}")`);

  // ══════════════════════════════════════════════════════════════════════════
  //                          SAVE DEPLOYMENT
  // ══════════════════════════════════════════════════════════════════════════

  const blockNumber = await ethers.provider.getBlockNumber();

  const deployment = {
    network: "base",
    chainId: 8453,
    version: "v2-safe7579",
    blockNumber,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      // External (pre-existing on Base)
      usdc: USDC_BASE,
      erc8004IdentityRegistry: ERC8004_IDENTITY_REGISTRY,
      morphoBlue: MORPHO_BLUE,
      safeSingleton: SAFE_SINGLETON,
      safeProxyFactory: SAFE_PROXY_FACTORY,
      safe7579: SAFE7579,
      entryPoint: ENTRYPOINT_V07,
      // Governance
      timelockController: timelockAddr,
      timelockMinDelay: TIMELOCK_MIN_DELAY,
      // Core — NEW (Safe-based)
      agether4337Factory: factoryAddr,
      agether7579Bootstrap: bootstrapAddr,
      agether8004ValidationModule: validationModuleAddr,
      agetherHookMultiplexer: hookMultiplexerAddr,
      // UUPS Proxies
      agether8004Scorer: agentReputationAddr,
    },
    // Legacy v1 addresses (for reference — do NOT use)
    v1: {
      accountFactory: "0x89a8758E60A56EcB47247D92E05447eFd450d6Bf",
      kyaHook: "0x28e50Aa9eD517E369b2806928709B44062aD9821",
      agentAccountImpl: "0x46597a6CBb029e22eA1f44EE67dEbe832c076d47",
      upgradeableBeacon: "0x8670cABbC940AeF91351a559aeFe9D29c975A5B0",
    },
    collateralTokens: {
      weth: WETH,
      wsteth: WSTETH,
      cbeth: CBETH,
    },
  };

  const outPath = path.join(__dirname, "..", "deployments", "base.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));
  console.log("\n📁 Deployment saved:", outPath);

  // ── Write backend .env ──
  const backendEnvPath = path.join(__dirname, "..", "..", "backend", ".env.base");
  const signerKey = process.env.PRIVATE_KEY || "YOUR_SIGNER_PRIVATE_KEY";
  const baseRpc = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  const backendEnv = `# Agether Backend — Base Mainnet (Safe + Safe7579 Architecture)
# Auto-generated by deploy-base.ts at ${new Date().toISOString()}
PORT=3001
HOST=0.0.0.0

RPC_URL=${baseRpc}
CHAIN_ID=8453

# External contracts (Base)
USDC_ADDRESS=${USDC_BASE}
ERC8004_IDENTITY_REGISTRY=${ERC8004_IDENTITY_REGISTRY}
ENTRYPOINT_ADDRESS=${ENTRYPOINT_V07}

# Safe infrastructure
SAFE_SINGLETON=${SAFE_SINGLETON}
SAFE_PROXY_FACTORY=${SAFE_PROXY_FACTORY}
SAFE7579=${SAFE7579}

# Core deployed contracts
AGETHER_4337_FACTORY_ADDRESS=${factoryAddr}
AGETHER_8004_VALIDATION_MODULE_ADDRESS=${validationModuleAddr}
AGETHER_HOOK_MULTIPLEXER_ADDRESS=${hookMultiplexerAddr}
AGETHER_8004_SCORER_ADDRESS=${agentReputationAddr}

# Signer (deployer — replace with dedicated admin key in production)
SIGNER_PRIVATE_KEY=${signerKey}

# x402
X402_FACILITATOR_URL=https://x402.org/facilitator
SCORING_PRICE_USDC=\$0.01
X402_PAY_TO_ADDRESS=${deployer.address}

DEBUG=true
`;
  fs.writeFileSync(backendEnvPath, backendEnv);
  console.log("   ✓ Backend .env.base written:", backendEnvPath);

  // ══════════════════════════════════════════════════════════════════════════
  //                              SUMMARY
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("✅ BASE DEPLOYMENT v2 COMPLETE (Safe + Safe7579)");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("\n📋 Contract Addresses:");
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│ EXTERNAL (pre-deployed on Base)                             │");
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ Safe Singleton:       ", SAFE_SINGLETON);
  console.log("│ SafeProxyFactory:     ", SAFE_PROXY_FACTORY);
  console.log("│ Safe7579:             ", SAFE7579);
  console.log("│ EntryPoint v0.7:      ", ENTRYPOINT_V07);
  console.log("│ ERC-8004 Identity:    ", ERC8004_IDENTITY_REGISTRY);
  console.log("│ Morpho Blue:          ", MORPHO_BLUE);
  console.log("│ USDC:                 ", USDC_BASE);
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ GOVERNANCE                                                  │");
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ TimelockController:   ", timelockAddr);
  console.log(`│ Timelock delay:        ${TIMELOCK_MIN_DELAY / 3600}h`);
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ DEPLOYED (v2 — Safe-based)                                  │");
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ Agether4337Factory:     ", factoryAddr);
  console.log("│ Agether7579Bootstrap:    ", bootstrapAddr);
  console.log("│ ValidationModule:     ", validationModuleAddr);
  console.log("│ AgetherHookMultiplexer:      ", hookMultiplexerAddr);
  console.log("│ Agether8004Scorer:      ", agentReputationAddr);
  console.log("└─────────────────────────────────────────────────────────────┘");

  console.log("\n🏗️  Architecture:");
  console.log("   Agent registers (ERC-8004) → Agether4337Factory.createAccount(agentId)");
  console.log("   → Deploys Safe proxy with sentinel owner (no execTransaction)");
  console.log("   → Safe7579 installed as module + fallback handler");
  console.log("   → Agether8004ValidationModule: ownership + KYA + module lock");
  console.log("   → AgetherHookMultiplexer: admin-managed hooks (0 sub-hooks for now)");
  console.log("   → ALL execution through ERC-4337 EntryPoint → Safe7579 → validator");
  console.log("   → Agents interact with Morpho Blue via UserOps");
  console.log("   → All admin ops through TimelockController (7-day delay)");

  console.log("\n🔧 Next Steps:");
  console.log("   1. Copy backend/.env.base → backend/.env on VPS");
  console.log("   2. Restart backend: pm2 restart agether-backend");
  console.log("   3. Update SDK config with new addresses");
  console.log("   4. Update frontend config with new addresses");
  console.log("   5. Deploy ValidationRegistry (KYA gate) when ready");
  console.log("   6. Renounce timelock admin role:");
  console.log(`      timelock.renounceRole(0x00..00, "${deployer.address}")`);

  // ══════════════════════════════════════════════════════════════════════════
  //                       VERIFY ON BASESCAN
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n🔍 Verifying contracts on Basescan...");

  // TimelockController — constructor args
  await verify(timelockAddr, [
    TIMELOCK_MIN_DELAY,
    [deployer.address],
    [deployer.address],
    deployer.address,
  ]);

  // Agether8004ValidationModule — UUPS proxy (no constructor args)
  await verify(validationModuleAddr);

  // AgetherHookMultiplexer — constructor arg
  await verify(hookMultiplexerAddr, [timelockAddr]);

  // Agether7579Bootstrap — no constructor args
  await verify(bootstrapAddr);

  // Agether4337Factory — UUPS proxy (no constructor args)
  await verify(factoryAddr);

  // Agether8004Scorer — UUPS proxy (no constructor args)
  await verify(agentReputationAddr);

  console.log("\n✅ Verification complete.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
