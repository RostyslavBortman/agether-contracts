# Agether — Smart Contracts

> Safe-based smart wallets and credit scoring for autonomous AI agents on Ethereum & Base.

## 📋 Overview

AI agents need wallets to operate — pay for API calls, buy compute, interact with services via [x402](https://www.x402.org/). But agents can't get traditional accounts. No bank, no credit history, no identity. **Agether** fixes this.

Every agent gets an **ERC-8004 identity** (NFT), a **Safe smart account** (ERC-4337 + ERC-7579), and an **onchain credit score** attested by an offchain ML oracle:

| Component | What It Does |
|---|---|
| **Agether4337Factory** | Deploys a Safe proxy per agent with pre-installed ERC-7579 modules |
| **Agether8004ValidationModule** | Non-removable validator — ownership via NFT, KYA gate, module lock |
| **AgetherHookMultiplexer** | Admin-managed hook chain for all accounts |
| **Agether8004Scorer** | Oracle-signed credit scores (300–1000) pushed to ERC-8004 Reputation |
| **ValidationRegistry** | KYA code audit registry — gate for credit and execution |

---

## 🦞 How OpenClaw Agents Use Agether

[OpenClaw](https://openclaw.ai) is an open-source personal AI assistant. OpenClaw agents can extend themselves with **skills** — plugins that give them new capabilities.

Agether is the onchain identity and wallet layer for these agents:

1. **Get an identity** — register an [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) agent NFT
2. **Get a wallet** — `Agether4337Factory.createAccount(agentId)` deploys a Safe with ERC-7579 modules
3. **Pass KYA** — submit code for audit via ValidationRegistry, get approved
4. **Get scored** — offchain ML model computes credit score, signs attestation, agent submits onchain
5. **Transact** — all execution goes through ERC-4337 EntryPoint → Safe7579 → our validator

### Interaction Flow

```
┌──────────────────────────────────────────────────────────────┐
│                    OpenClaw (your machine)                    │
│                                                              │
│  "Hey, buy me 10 GPU-hours on Akash"                        │
│                                                              │
│  1. Agent builds UserOp (ERC-4337)                          │
│  2. Signs with ERC-8004 NFT owner key                       │
│  3. EntryPoint → Safe7579 → ValidationModule                │
│     a. Module lock: not installModule/uninstallModule ✓     │
│     b. KYA gate: code is approved in ValidationRegistry ✓   │
│     c. Ownership: signer = NFT owner ✓                      │
│  4. Safe executes the call (pay Akash via x402)             │
│  5. HookMultiplexer runs pre/post checks                    │
└──────────────────────────────────────────────────────────────┘
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AGENT OWNER (EOA)                            │
│               holds ERC-8004 NFT on Ethereum or Base                │
└────────────────────────────┬────────────────────────────────────────┘
                             │ owns NFT
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  ERC-4337 EntryPoint (v0.7)                         │
│              0x0000000071727De22E5E9d8BAf0edAc6f37da032             │
└────────────────────────────┬────────────────────────────────────────┘
                             │ handleOps
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Safe Proxy (per agent)                            │
│                                                                     │
│  Owner: SENTINEL (no execTransaction — 4337 only)                  │
│  FallbackHandler: Safe7579                                          │
│  Module: Safe7579                                                   │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                     Safe7579 Adapter                           │  │
│  │                                                               │  │
│  │  Validator: Agether8004ValidationModule                       │  │
│  │    • Ownership — live NFT owner check                        │  │
│  │    • KYA gate — ValidationRegistry code approval             │  │
│  │    • Module lock — blocks install/uninstall                  │  │
│  │    • ERC-1271 — signature validation for x402                │  │
│  │                                                               │  │
│  │  Hook: AgetherHookMultiplexer                                │  │
│  │    • Admin-managed chain of sub-hooks                        │  │
│  │    • preCheck / postCheck on every UserOp                    │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐     ┌───────────────────────┐
│  Agether8004Scorer   │     │  ValidationRegistry   │
│                      │     │  (KYA — code audits)  │
│  Oracle-attested     │     │                       │
│  credit scores       │     │  ERC-8004 compliant   │
│  300–1000 range      │     │  gate for execution   │
│  → ERC-8004 feedback │     │                       │
└──────────────────────┘     └───────────────────────┘
```

### Account Creation Flow

```
Agether4337Factory.createAccount(agentId)
  │
  ├─ Verify: caller == ERC-8004 NFT owner
  ├─ Verify: no existing account for this agent
  │
  ├─ Build Safe.setup() calldata:
  │   owners:          [SENTINEL_OWNER]
  │   threshold:       1
  │   to:              Agether7579Bootstrap (delegatecall)
  │   fallbackHandler: Safe7579
  │
  ├─ SafeProxyFactory.createProxyWithNonce(singleton, setup, salt)
  │   │
  │   └─ Safe.setup() → delegatecall Bootstrap:
  │       ├─ enableModule(Safe7579)
  │       └─ initializeAccount(validators, executors, fallbacks, hooks)
  │           ├─ Install Agether8004ValidationModule
  │           │   └─ onInstall(identityRegistry, agentId)
  │           └─ Install AgetherHookMultiplexer (global hook)
  │               └─ onInstall() (no-op)
  │
  └─ Store: agentId ↔ safeAddress mappings
```

---

## 📜 Contracts

### Agether4337Factory.sol
Factory for deploying Safe-based agent accounts with ERC-7579 modules. Each agent (ERC-8004 NFT) gets one Safe, deterministic address (based on `agentId + chainId`).

- **createAccount(agentId)** — deploys Safe proxy with validator + hook pre-installed
- **getAccount(agentId)** / **getAgentId(address)** — bidirectional lookup
- **setValidationModule()** / **setHookMultiplexer()** — update modules for NEW accounts only
- Owner: TimelockController (7-day delay)

### Agether7579Bootstrap.sol
Stateless bootstrap contract delegatecalled during `Safe.setup()`. Wires up Safe7579 as a module and fallback handler, then calls `initializeAccount()` to install all ERC-7579 modules in one atomic transaction.

### modules/Agether8004ValidationModule.sol
The single mandatory ERC-7579 validator for all agent Safes. Three responsibilities:

1. **Ownership** — validates UserOp signer is the current ERC-8004 NFT holder (read LIVE — NFT transfer instantly changes control)
2. **KYA Gate** — checks `ValidationRegistry.isAgentCodeApproved()` before allowing execution (disabled if registry = address(0))
3. **Module Lock** — rejects `installModule` / `uninstallModule` selectors in UserOps

Also handles **ERC-1271** signature validation for x402 payments (KYA NOT enforced on signatures — they're read-only).

- `onUninstall()` always reverts — non-removable by design
- Owner: TimelockController (for `setValidationRegistry()`)

### modules/AgetherHookMultiplexer.sol
Admin-managed ERC-7579 hook chain. Singleton for all accounts. Iterates through sub-hooks on every `preCheck` / `postCheck`.

- **addHook()** / **removeHook()** — manage sub-hooks (max 10)
- `onUninstall()` always reverts — non-removable by design
- Owner: TimelockController

### Agether8004Scorer.sol
Oracle-based credit score store with ERC-8004 Reputation Registry bridge. All scoring happens offchain via ML model.

**Flow:**
1. Agent pays via x402 to request a credit score from the backend
2. Backend ML model computes score offchain
3. Backend signs `(agentId, score, timestamp, chainId, contractAddress)`
4. Agent (or relayer) calls `submitScore()` with the signed attestation
5. Contract verifies signature, stores score, pushes feedback to ERC-8004

**Score range:** 300 (thin file / new agent) to 1000 (perfect)

**ERC-8004 feedback mapping:**
| Score | Feedback |
|---|---|
| ≥ 700 | +10 (good) |
| ≥ 500 | +5 (neutral-good) |
| ≥ 400 | −5 (neutral-bad) |
| < 400 | −10 (bad) |

Key views: `getCreditScore()`, `isEligible()`, `isScoreFresh()`, `getAttestation()`

### kya/ValidationRegistry.sol
ERC-8004 compliant Validation Registry for Know Your Agent code audits. The KYA gate for agent execution.

- **validationRequest()** — agent owner requests audit from a validator
- **validationResponse()** — validator responds with score 0–100
- **isAgentCodeApproved()** — quick check (used by ValidationModule's KYA gate)
- Tags: `code-audit`, `security-audit`, `tee-attestation`, `zkml-proof`
- Roles: `VALIDATOR_ROLE`, `PAUSER_ROLE`, `DEFAULT_ADMIN_ROLE`
- Pausable + UUPS upgradeable

---

## 🔐 Security Architecture

| Feature | Implementation |
|---|---|
| All errors centralized | `IErrors.sol` — `import {IErrors as IA}` pattern |
| All events centralized | `IEvents.sol` — `import {IEvents as IE}` pattern |
| Shared constants | `Constants.sol` — `import {Constants as C}` pattern |
| Non-removable modules | `onUninstall()` always reverts on validator + hook |
| Module lock | Validator rejects `installModule`/`uninstallModule` UserOps |
| Sentinel owner | Safe owner is sentinel address — no `execTransaction` possible |
| 4337-only execution | All calls go through EntryPoint → Safe7579 → our validator |
| Live ownership | NFT transfer instantly changes who controls the Safe |
| KYA gate | Code must be approved in ValidationRegistry before execution |
| Oracle replay protection | Signature covers `chainId + contractAddress` |
| Access control | `Ownable` (factory, modules) + `AccessControl` (scorer, registry) |
| Upgradeability | UUPS proxy on Agether8004Scorer and ValidationRegistry |
| Emergency pause | Pausable on ValidationRegistry |
| Governance | TimelockController (7-day delay) owns all admin functions |

---

## 🛠️ Development

### Setup

```bash
npm install
npx hardhat compile
```

### Testing

Tests run on a **Base fork** (chainId 8453) — real Safe, SafeProxyFactory, and Safe7579 are available at their deployed addresses.

```bash
# Run all tests (161 tests)
npx hardhat test

# Run specific test file
npx hardhat test test/Agether4337Factory.test.ts
npx hardhat test test/Agether8004Scorer.test.ts
npx hardhat test test/Agether8004ValidationModule.test.ts
npx hardhat test test/AgetherHookMultiplexer.test.ts
npx hardhat test test/ValidationRegistry.test.ts
```

### Test Coverage

| Test File | Tests | Coverage |
|---|---|---|
| `Agether4337Factory.test.ts` | 29 | Constructor validation, view functions, admin, access control, full Safe deployment on fork |
| `Agether8004Scorer.test.ts` | 26 | Initialization, oracle score submission, views, ERC-8004 feedback, admin, UUPS |
| `Agether8004ValidationModule.test.ts` | 31 | Module lifecycle, ownership validation, KYA gate, module lock, ERC-1271, admin |
| `AgetherHookMultiplexer.test.ts` | 18 | Module lifecycle, sub-hook CRUD, limits, hook execution (preCheck/postCheck) |
| `ValidationRegistry.test.ts` | 57 | Request/response flow, credit helpers, query functions, admin, pause, UUPS |

### Deploy

```bash
# Deploy to Base mainnet
npx hardhat run scripts/deploy-base.ts --network base

# Deploy to Ethereum mainnet
npx hardhat run scripts/deploy-base.ts --network mainnet
```

### Agether Contracts — Base (Chain ID 8453)

| Contract | Address |
|---|---|
| Agether4337Factory | `0x73f4153bf1d46dB203Db27fc8FC942f6279D8d38` |
| Agether7579Bootstrap | `0xbD0BDFE70fDB88fc03F2Ea22B81A2dfc99298E42` |
| Agether8004ValidationModule | `0x85C8C97cE5AE540a4408D6A77a6D3aFcA9BCdB71` |
| AgetherHookMultiplexer | `0x688cab46ce5A7450D706e9E3C8e0F31BaEa6c8BE` |
| Agether8004Scorer | `0x33eB904fe9975e2D8c577aD7e5B14CefBD4A65E1` |
| TimelockController | `0xB3FD04f0B7c9DeC7f7B52d5c2CdfdCB3Fc9eE111` |

### Agether Contracts — Ethereum (Chain ID 1)

| Contract | Address |
|---|---|
| Agether4337Factory | `0xb6363c2B5C72C14D3fC4261e3dd836D8966bE072` |
| Agether7579Bootstrap | `0x055C2e70dd011C4ADEEfB795Ab77D74437be6D33` |
| Agether8004ValidationModule | `0xE282fB8615abb8bA53F07b8BAB2937C78fE3867D` |
| AgetherHookMultiplexer | `0xeD62ac874F58CEc9F065aB8e6872752Eb0F6eA14` |
| Agether8004Scorer | `0x960853769d52B14aA0daeab7E1E59f5c9299cb65` |
| TimelockController | `0x78e0227f9DE577e583B8149C73F0bA1E7200AD01` |

### Shared Infrastructure (same addresses on both chains)

| Contract | Address |
|---|---|
| Safe v1.4.1 Singleton | `0x41675C099F32341bf84BFc5382aF534df5C7461a` |
| SafeProxyFactory | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` |
| Safe7579 Adapter | `0x7579EE8307284F293B1927136486880611F20002` |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| ERC-8004 IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ERC-8004 ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| Morpho Blue | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` |

---

## 📁 Project Structure

```
contracts/
├── src/
│   ├── Agether4337Factory.sol          # Safe-based account factory
│   ├── Agether7579Bootstrap.sol        # Safe7579 initialization bootstrap
│   ├── Agether8004Scorer.sol           # Oracle credit scoring (UUPS)
│   ├── modules/
│   │   ├── Agether8004ValidationModule.sol  # ERC-7579 validator (ownership + KYA + lock)
│   │   └── AgetherHookMultiplexer.sol       # ERC-7579 hook chain
│   ├── kya/
│   │   └── ValidationRegistry.sol      # KYA code audit registry (UUPS)
│   ├── interfaces/
│   │   ├── IAgether4337Factory.sol     # Factory interface
│   │   ├── IAgether7579Bootstrap.sol   # Bootstrap interface
│   │   ├── IAgether8004Scorer.sol      # Scorer interface + structs
│   │   ├── IERC7579Module.sol          # ERC-7579 module types (validator, hook, etc.)
│   │   ├── IERC7579Account.sol         # ERC-7579 account interface
│   │   ├── IERC8004.sol                # ERC-8004 Identity + Reputation interfaces
│   │   ├── IERC8004ValidationRegistry.sol  # KYA registry interface
│   │   ├── IEntryPoint.sol             # PackedUserOperation struct
│   │   ├── IErrors.sol                 # All custom errors
│   │   ├── IEvents.sol                 # All events
│   │   ├── ISafe.sol                   # Safe v1.4.1 interface
│   │   └── ISafe7579.sol               # Safe7579 adapter interface
│   ├── libraries/
│   │   ├── Constants.sol               # Shared constants, selectors, thresholds
│   │   └── ERC7579ModeLib.sol          # ERC-7579 execution mode helpers
│   └── mocks/
│       ├── MockAgentRegistry.sol       # Mock ERC-8004 (ERC-721)
│       ├── MockERC20.sol               # Mock ERC-20
│       ├── MockERC721.sol              # Mock ERC-721
│       ├── MockModule.sol              # Mock ERC-7579 module (validator/hook/executor)
│       ├── MockMorpho.sol              # Mock Morpho Blue
│       └── MockOracle.sol              # Mock price oracle
├── test/
│   ├── Agether4337Factory.test.ts      # Factory tests (29)
│   ├── Agether8004Scorer.test.ts       # Scorer tests (26)
│   ├── Agether8004ValidationModule.test.ts  # Validator tests (31)
│   ├── AgetherHookMultiplexer.test.ts  # Hook tests (18)
│   └── ValidationRegistry.test.ts      # KYA tests (57)
├── scripts/
│   └── deploy-base.ts                  # Base mainnet deployment
├── hardhat.config.ts
└── package.json
```

---

## 🔑 Roles & Governance

All admin functions are behind a **TimelockController** with a 7-day delay.

| Role / Owner | Contract | Purpose |
|---|---|---|
| `owner` (Ownable) | Agether4337Factory | Update modules for new accounts |
| `owner` (Ownable) | Agether8004ValidationModule | Set ValidationRegistry address |
| `owner` (Ownable) | AgetherHookMultiplexer | Add/remove sub-hooks |
| `DEFAULT_ADMIN_ROLE` | Agether8004Scorer | Set oracle signer, reputation registry, upgrade |
| `DEFAULT_ADMIN_ROLE` | ValidationRegistry | Add/remove validators, upgrade |
| `VALIDATOR_ROLE` | ValidationRegistry | Respond to validation requests |
| `PAUSER_ROLE` | ValidationRegistry | Emergency pause |

---

## Tech Stack

- Solidity ^0.8.33
- Safe v1.4.1 + Safe7579 (ERC-4337 + ERC-7579)
- OpenZeppelin Contracts Upgradeable 5.x
- Hardhat + TypeScript + ethers v6
- UUPS Proxy Pattern (Agether8004Scorer, ValidationRegistry)
- Ethereum (chainId 1) & Base (chainId 8453)

---

## 📄 License

MIT