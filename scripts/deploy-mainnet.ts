import { ethers, upgrades, network, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Verify a contract on Etherscan, swallowing "already verified" errors.
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
 * Deploy Agent Credit Protocol v2 on Ethereum Mainnet (chain 1).
 *
 * Same Safe-based architecture as Base deployment:
 *   Each agent gets a Safe account with Safe7579 adapter, providing full
 *   ERC-4337 + ERC-7579 compliance.
 *
 * Deployed Contracts:
 *   1. TimelockController — OZ governance, 7-day delay
 *   2. Agether8004ValidationModule — single mandatory 7579 validator (UUPS)
 *   3. AgetherHookMultiplexer — admin-managed hook chain
 *   4. Agether7579Bootstrap — delegatecalled during Safe.setup()
 *   5. Agether4337Factory — deploys Safe proxies with all modules pre-installed
 *   6. Agether8004Scorer — OCCR credit scoring (UUPS)
 *
 * External Contracts (pre-deployed on Ethereum):
 *   • Safe v1.4.1 singleton:  0x41675C099F32341bf84BFc5382aF534df5C7461a
 *   • SafeProxyFactory:       0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67
 *   • Safe7579 adapter:       0x7579EE8307284F293B1927136486880611F20002
 *   • EntryPoint v0.7:        0x0000000071727De22E5E9d8BAf0edAc6f37da032
 *   • ERC-8004 Registry:      0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 *   • Morpho Blue:            0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb
 *
 * Prerequisites:
 *   PRIVATE_KEY      in .env — deployer wallet with ETH on Ethereum
 *   MAINNET_RPC_URL  in .env — Ethereum RPC endpoint
 *
 * Usage:
 *   npx hardhat run scripts/deploy-mainnet.ts --network mainnet
 */

// ══════════════════════════════════════════════════════════════════════════
//                   EXTERNAL ADDRESSES (Ethereum Mainnet)
// ══════════════════════════════════════════════════════════════════════════

// Safe infrastructure (deterministic — same address on all EVM chains)
const SAFE_SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
const SAFE_PROXY_FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
const SAFE7579 = "0x7579EE8307284F293B1927136486880611F20002";
const ENTRYPOINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

// ERC-8004 Identity Registry (deterministic CREATE2 — same on all chains)
const ERC8004_IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

// Morpho Blue (deployed on Ethereum mainnet)
const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";

// Ethereum Mainnet Tokens
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WSTETH = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0";
const CBETH = "0xBe9895146f7AF43049ca1c1AE358B0541Ea49704";

// Timelock
const TIMELOCK_MIN_DELAY = 7 * 24 * 3600; // 1 week

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("🚀 Agent Credit Protocol v2 — Ethereum Mainnet Deployment");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("   Network:", network.name, `(chainId: ${network.config.chainId})`);
  console.log("   Deployer:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("   Balance:", ethers.formatEther(balance), "ETH");

  if (network.config.chainId !== 1) {
    console.error("❌ This script is for Ethereum mainnet (chainId: 1) only!");
    console.error("   Use: npx hardhat run scripts/deploy-mainnet.ts --network mainnet");
    process.exit(1);
  }

  if (balance < ethers.parseEther("0.005")) {
    console.error("❌ Deployer needs at least 0.005 ETH for gas on Ethereum mainnet!");
    process.exit(1);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //              0. VERIFY EXTERNAL CONTRACTS ON ETHEREUM
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n0. Verifying external contracts on Ethereum mainnet...");

  const externals: Record<string, string> = {
    "ERC-8004 IdentityRegistry": ERC8004_IDENTITY_REGISTRY,
    "Safe v1.4.1 Singleton": SAFE_SINGLETON,
    "SafeProxyFactory": SAFE_PROXY_FACTORY,
    "Safe7579 Adapter": SAFE7579,
    "EntryPoint v0.7": ENTRYPOINT_V07,
    "Morpho Blue": MORPHO_BLUE,
    "USDC": USDC,
  };

  for (const [name, addr] of Object.entries(externals)) {
    const code = await ethers.provider.getCode(addr);
    if (code === "0x") {
      console.error(`❌ ${name} not found at ${addr}`);
      process.exit(1);
    }
    console.log(`   ✓ ${name}`);
  }
  console.log("   ✓ All external contracts verified on Ethereum mainnet");

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

  // ── 3. AgetherHookMultiplexer (owned by timelock, UUPS proxy) ──
  console.log("\n3. Deploying AgetherHookMultiplexer (UUPS proxy)...");
  const AgetherHookMultiplexer = await ethers.getContractFactory("AgetherHookMultiplexer");
  const hookMultiplexer = await upgrades.deployProxy(
    AgetherHookMultiplexer,
    [timelockAddr],
    { kind: "uups" }
  );
  await hookMultiplexer.waitForDeployment();
  const hookMultiplexerAddr = await hookMultiplexer.getAddress();
  console.log("   AgetherHookMultiplexer (proxy):", hookMultiplexerAddr);

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
  const factory = await upgrades.deployProxy(
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

  // Agether8004Scorer: Set oracleSigner
  await (await agentReputation.setOracleSigner(deployer.address)).wait();
  console.log("   ✓ Agether8004Scorer: oracleSigner set to deployer");

  // Grant ORACLE_ROLE
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

  await (await agentReputation.grantRole(DEFAULT_ADMIN_ROLE, timelockAddr)).wait();
  await (await agentReputation.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address)).wait();
  console.log("   ✓ Agether8004Scorer: admin → TimelockController");
  // Agether8004ValidationModule, Agether4337Factory, AgetherHookMultiplexer: owned by timelock via proxy initialize()
  console.log("   ✓ Agether8004ValidationModule: owner = TimelockController (proxy initialize)");
  console.log("   ✓ AgetherHookMultiplexer: owner = TimelockController (proxy initialize)");
  console.log("   ✓ Agether4337Factory: owner = TimelockController (proxy initialize)");

  // TimelockController: renounce deployer admin role
  const timelockContract = await ethers.getContractAt("TimelockController", timelockAddr);
  await (await timelockContract.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address)).wait();
  console.log("   ✓ TimelockController: deployer renounced DEFAULT_ADMIN_ROLE");
  console.log("   🔒 Deployer no longer has admin bypass — all ops go through 7-day timelock");

  // ══════════════════════════════════════════════════════════════════════════
  //                          SAVE DEPLOYMENT
  // ══════════════════════════════════════════════════════════════════════════

  const blockNumber = await ethers.provider.getBlockNumber();

  const deployment = {
    network: "mainnet",
    chainId: 1,
    version: "v2-safe7579",
    blockNumber,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      // External (pre-existing on Ethereum)
      usdc: USDC,
      erc8004IdentityRegistry: ERC8004_IDENTITY_REGISTRY,
      morphoBlue: MORPHO_BLUE,
      safeSingleton: SAFE_SINGLETON,
      safeProxyFactory: SAFE_PROXY_FACTORY,
      safe7579: SAFE7579,
      entryPoint: ENTRYPOINT_V07,
      // Governance
      timelockController: timelockAddr,
      timelockMinDelay: TIMELOCK_MIN_DELAY,
      // Core
      agether4337Factory: factoryAddr,
      agether7579Bootstrap: bootstrapAddr,
      agether8004ValidationModule: validationModuleAddr,
      agetherHookMultiplexer: hookMultiplexerAddr,
      agether8004Scorer: agentReputationAddr,
    },
    collateralTokens: {
      weth: WETH,
      wsteth: WSTETH,
      cbeth: CBETH,
    },
  };

  const outPath = path.join(__dirname, "..", "deployments", "mainnet.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));
  console.log("\n📁 Deployment saved:", outPath);

  // ── Write backend .env ──
  const backendEnvPath = path.join(__dirname, "..", "..", "backend", ".env.mainnet");
  const signerKey = process.env.PRIVATE_KEY || "YOUR_SIGNER_PRIVATE_KEY";
  const mainnetRpc = process.env.MAINNET_RPC_URL || "https://eth.llamarpc.com";
  const backendEnv = `# Agether Backend — Ethereum Mainnet (Safe + Safe7579 Architecture)
# Auto-generated by deploy-mainnet.ts at ${new Date().toISOString()}
PORT=3001
HOST=0.0.0.0

RPC_URL=${mainnetRpc}
CHAIN_ID=1

# External contracts (Ethereum)
USDC_ADDRESS=${USDC}
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

# Signer
SIGNER_PRIVATE_KEY=${signerKey}

# x402
X402_FACILITATOR_URL=https://x402.org/facilitator
SCORING_PRICE_USDC=\$0.01
X402_PAY_TO_ADDRESS=${deployer.address}

DEBUG=true
`;
  fs.writeFileSync(backendEnvPath, backendEnv);
  console.log("   ✓ Backend .env.mainnet written:", backendEnvPath);

  // ══════════════════════════════════════════════════════════════════════════
  //                              SUMMARY
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("✅ ETHEREUM MAINNET DEPLOYMENT v2 COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("\n📋 Contract Addresses:");
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│ EXTERNAL (pre-deployed on Ethereum)                         │");
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ Safe Singleton:       ", SAFE_SINGLETON);
  console.log("│ SafeProxyFactory:     ", SAFE_PROXY_FACTORY);
  console.log("│ Safe7579:             ", SAFE7579);
  console.log("│ EntryPoint v0.7:      ", ENTRYPOINT_V07);
  console.log("│ ERC-8004 Identity:    ", ERC8004_IDENTITY_REGISTRY);
  console.log("│ Morpho Blue:          ", MORPHO_BLUE);
  console.log("│ USDC:                 ", USDC);
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ GOVERNANCE                                                  │");
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ TimelockController:   ", timelockAddr);
  console.log(`│ Timelock delay:        ${TIMELOCK_MIN_DELAY / 3600}h`);
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ DEPLOYED (v2 — Safe-based)                                  │");
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log("│ Agether4337Factory:   ", factoryAddr);
  console.log("│ Agether7579Bootstrap: ", bootstrapAddr);
  console.log("│ ValidationModule:     ", validationModuleAddr);
  console.log("│ HookMultiplexer:      ", hookMultiplexerAddr);
  console.log("│ Agether8004Scorer:    ", agentReputationAddr);
  console.log("└─────────────────────────────────────────────────────────────┘");

  console.log("\n🔧 Next Steps:");
  console.log("   1. Copy backend/.env.mainnet → backend/.env (or run separate instance)");
  console.log("   2. Renounce timelock admin role when ready:");
  console.log(`      timelock.renounceRole(0x00..00, "${deployer.address}")`);

  // ══════════════════════════════════════════════════════════════════════════
  //                       VERIFY ON ETHERSCAN
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n🔍 Verifying contracts on Etherscan...");

  // TimelockController — constructor args
  await verify(timelockAddr, [
    TIMELOCK_MIN_DELAY,
    [deployer.address],
    [deployer.address],
    deployer.address,
  ]);

  // Agether8004ValidationModule — UUPS proxy (no constructor args)
  await verify(validationModuleAddr);

  // AgetherHookMultiplexer — UUPS proxy (no constructor args)
  await verify(hookMultiplexerAddr);

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
