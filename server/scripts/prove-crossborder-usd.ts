import { ethers } from 'ethers';
import { buildVaultTransferSafeTx, unifiedBalanceOf, isRegisteredConsumer } from '../src/safeRelayService.js';

const sender = '0xB9CED87DEF0a312B9BD04270F3E081309821c315'; // @se1 ZA
const recipient = '0x466254B09A645a028e1E7547987719Bd92204B0e'; // @mw1 MW
const amount = ethers.parseUnits('1.00', 6);

const [sReg, rReg, bal] = await Promise.all([
  isRegisteredConsumer(sender),
  isRegisteredConsumer(recipient),
  unifiedBalanceOf(sender, 'USDC'),
]);
console.log('sender registered:', sReg, 'recipient registered:', rReg);
console.log('sender USDC:', ethers.formatUnits(bal, 6));
console.log('amount:', ethers.formatUnits(amount, 6));

const { safeTxHash } = await buildVaultTransferSafeTx({
  safeAddress: sender,
  toAddress: recipient,
  amount,
  currency: 'USDC',
});
console.log('prepare ok, safeTxHash:', safeTxHash);
