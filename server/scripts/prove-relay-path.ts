// scripts/prove-relay-path.ts
// Proves the FULL Option-A relay path against the live deployed Safe 1.4.1 stack:
//   1. deploy a SafeWebAuthnSigner for a Node-generated P-256 key (real tx)
//   2. deploy a Safe owned by that signer, same setup() as Consumer.sol (real tx)
//   3. build a harmless SafeTx, hash it via the Safe's own getTransactionHash
//   4. sign the hash with the Node key, wrap as a Safe contract-signature
//   5. staticCall execTransaction — non-destructive; reverts if the signature or
//      the legacy isValidSignature(bytes,bytes) path is wrong, returns true if ok
//
// This is the definitive check that the deployed 1.4.1 Safe accepts a passkey
// (contract-owner) signature through execTransaction. Costs gas only for the two
// deploys. Run: cd server && npx tsx scripts/prove-relay-path.ts

import crypto from 'crypto';
import { ethers } from 'ethers';
import config from '../src/config.js';
import { encodeWebAuthnSignature, encodeSafeContractSignature } from '../src/safeWebAuthn.js';

const FACTORY_ABI = [
  'function createSigner(uint256 x, uint256 y, uint176 verifiers) returns (address signer)',
  'function getSigner(uint256 x, uint256 y, uint176 verifiers) view returns (address signer)',
];
const PROXY_FACTORY_ABI = [
  'function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)',
];
const SAFE_SETUP_ABI = [
  'function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)',
];
const SAFE_ABI = [
  'function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns (bytes32)',
  'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)',
  'function isOwner(address owner) view returns (bool)',
];

function b64url(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function main() {
  const provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  const wallet = new ethers.Wallet(config.backend.privateKey, provider);
  const bal = await provider.getBalance(wallet.address);
  console.log('relayer:', wallet.address, 'balance:', ethers.formatEther(bal), 'ETH');
  if (bal < ethers.parseEther('0.002')) { console.log('⚠️  Low balance — fund the relayer to run this live proof. Skipping.'); return; }

  // 1. Software P-256 key → signer
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const x = BigInt('0x' + Buffer.from(jwk.x, 'base64url').toString('hex'));
  const y = BigInt('0x' + Buffer.from(jwk.y, 'base64url').toString('hex'));
  const verifiers = config.safe.webAuthnVerifiers;

  const factory = new ethers.Contract(config.safe.webAuthnSignerFactory, FACTORY_ABI, wallet);
  const signerAddr: string = await factory.getSigner(x, y, verifiers);
  if ((await provider.getCode(signerAddr)) === '0x') {
    console.log('deploying signer…');
    await (await factory.createSigner(x, y, verifiers)).wait();
  }
  console.log('signer:', signerAddr);

  // 2. Deploy a Safe owned by the signer (identical setup() to Consumer.sol)
  const initializer = new ethers.Interface(SAFE_SETUP_ABI).encodeFunctionData('setup', [
    [signerAddr], 1, ethers.ZeroAddress, '0x', config.safe.fallbackHandler, ethers.ZeroAddress, 0, ethers.ZeroAddress,
  ]);
  const proxyFactory = new ethers.Contract(config.safe.proxyFactory, PROXY_FACTORY_ABI, wallet);
  const saltNonce = BigInt('0x' + crypto.randomBytes(8).toString('hex'));
  const safeAddr: string = await proxyFactory.createProxyWithNonce.staticCall(config.safe.singleton, initializer, saltNonce);
  console.log('deploying Safe…', safeAddr);
  await (await proxyFactory.createProxyWithNonce(config.safe.singleton, initializer, saltNonce)).wait();

  const safe = new ethers.Contract(safeAddr, SAFE_ABI, wallet);
  console.log('isOwner(signer):', await safe.isOwner(signerAddr));

  // 3. Harmless SafeTx: empty call to the relayer EOA (always succeeds), nonce 0
  const tx = { to: wallet.address, value: 0n, data: '0x', operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ethers.ZeroAddress, refundReceiver: ethers.ZeroAddress, nonce: 0n };
  const safeTxHash: string = await safe.getTransactionHash(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, tx.nonce);
  console.log('safeTxHash:', safeTxHash);

  // 4. Sign the hash with the Node key (synthetic assertion), wrap as contract sig
  const challenge = Buffer.from(safeTxHash.slice(2), 'hex');
  const clientDataJSON = Buffer.from(`{"type":"webauthn.get","challenge":"${b64url(challenge)}","origin":"${config.webauthn.origin}","crossOrigin":false}`, 'utf8');
  const authData = Buffer.concat([crypto.createHash('sha256').update(config.webauthn.rpId).digest(), Buffer.from([0x05]), Buffer.from([0, 0, 0, 0])]);
  const signedData = Buffer.concat([authData, crypto.createHash('sha256').update(clientDataJSON).digest()]);
  const derSignature = crypto.sign('sha256', signedData, privateKey);
  const innerSig = encodeWebAuthnSignature({ authenticatorData: authData, clientDataJSON, derSignature });
  const signatures = encodeSafeContractSignature(signerAddr, innerSig);

  // 5. Non-destructive proof
  const ok: boolean = await safe.execTransaction.staticCall(tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, signatures);
  console.log('execTransaction.staticCall →', ok);
  console.log(ok ? '✅ PROVEN: deployed Safe 1.4.1 accepts the passkey contract-signature via execTransaction' : '❌ FAILED');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('ERROR:', e.shortMessage ?? e.message ?? e); process.exit(1); });
