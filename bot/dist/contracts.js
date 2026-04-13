"use strict";
/**
 * bot/src/contracts.ts
 * ABI definitions and address loading for the sandwich bot
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPERATOR_ABI = exports.NOFEESWAP_ABI = exports.ERC20_ABI = exports.ADDRESSES = exports.deployments = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ── Load deployments ───────────────────────────────────────────────────────
function loadDeployments() {
    const deployPath = path.join(__dirname, '..', '..', 'deployments.json');
    if (!fs.existsSync(deployPath)) {
        console.warn('[contracts] ⚠ deployments.json not found. Run scripts/deploy.py first.');
        return null;
    }
    return JSON.parse(fs.readFileSync(deployPath, 'utf8'));
}
exports.deployments = loadDeployments();
exports.ADDRESSES = {
    nofeeswap: (exports.deployments?.contracts?.nofeeswap ?? '0x0000000000000000000000000000000000000000'),
    operator: (exports.deployments?.contracts?.operator ?? '0x0000000000000000000000000000000000000000'),
    token0: (exports.deployments?.contracts?.token0 ?? '0x0000000000000000000000000000000000000000'),
    token1: (exports.deployments?.contracts?.token1 ?? '0x0000000000000000000000000000000000000000'),
    poolId: (exports.deployments?.pool?.poolId ?? '0x0'),
    token0Symbol: (exports.deployments?.contracts?.token0Symbol ?? 'TK0'), // fixed: was deployments.tokens
    token1Symbol: (exports.deployments?.contracts?.token1Symbol ?? 'TK1'), // fixed: was deployments.tokens
};
// ── ABIs ───────────────────────────────────────────────────────────────────
exports.ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function symbol() view returns (string)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
];
exports.NOFEESWAP_ABI = [
    'function unlock(address target, bytes calldata data) external returns (bytes memory)',
    'function setOperator(address operator, bool approved) external',
    'event Swap(uint256 indexed poolId, bytes data)',
    'event Initialize(uint256 indexed poolId, uint256 indexed tag0, uint256 indexed tag1, bytes data)',
];
exports.OPERATOR_ABI = [
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
