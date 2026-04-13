/**
 * bot/src/contracts.ts
 * ABI definitions and address loading for the sandwich bot
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Load deployments ───────────────────────────────────────────────────────
function loadDeployments(): any {
  const deployPath = path.join(__dirname, '..', '..', 'deployments.json');
  if (!fs.existsSync(deployPath)) {
    console.warn('[contracts] ⚠ deployments.json not found. Run scripts/deploy.py first.');
    return null;
  }
  return JSON.parse(fs.readFileSync(deployPath, 'utf8'));
}

export const deployments = loadDeployments();

export const ADDRESSES = {
  nofeeswap:    (deployments?.contracts?.nofeeswap    ?? '0x0000000000000000000000000000000000000000') as string,
  operator:     (deployments?.contracts?.operator     ?? '0x0000000000000000000000000000000000000000') as string,
  token0:       (deployments?.contracts?.token0       ?? '0x0000000000000000000000000000000000000000') as string,
  token1:       (deployments?.contracts?.token1       ?? '0x0000000000000000000000000000000000000000') as string,
  poolId:       (deployments?.pool?.poolId             ?? '0x0') as string,
  token0Symbol: (deployments?.contracts?.token0Symbol ?? 'TK0') as string,  // fixed: was deployments.tokens
  token1Symbol: (deployments?.contracts?.token1Symbol ?? 'TK1') as string,  // fixed: was deployments.tokens
};

// ── ABIs ───────────────────────────────────────────────────────────────────
export const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function symbol() view returns (string)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

export const NOFEESWAP_ABI = [
  'function unlock(address target, bytes calldata data) external returns (bytes memory)',
  'function setOperator(address operator, bool approved) external',
  'event Swap(uint256 indexed poolId, bytes data)',
  'event Initialize(uint256 indexed poolId, uint256 indexed tag0, uint256 indexed tag1, bytes data)',
];

export const OPERATOR_ABI = [
  `function swap(
    uint256 poolId,
    int256 amountSpecified,
    int256 logPriceLimit,
    uint256 zeroForOne,
    address recipient,
    uint256 deadline,
    bytes calldata hookData
  ) external`,
];
