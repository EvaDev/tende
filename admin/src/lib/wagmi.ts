import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { injectedWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import { sepolia, mainnet } from 'wagmi/chains';
import { http } from 'wagmi';

const alchemyKey = import.meta.env.VITE_ALCHEMY_API_KEY ?? '';
const projectId  = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? 'demo';

// Wallet connectors. We deliberately do NOT use RainbowKit's `metaMaskWallet`,
// which (since RainbowKit v2) routes through the MetaMask SDK. On a desktop dapp
// with the extension installed, the SDK's connect path deep-links and throws
// "MetaMask extension not found" / "Disconnected from MetaMask background. Page
// reload required." whenever MetaMask's MV3 background service-worker is asleep
// (e.g. right after the extension auto-updates) — which left the connect modal
// stuck on "Opening MetaMask…".
//
// `injectedWallet` talks straight to the EIP-6963 / window.ethereum provider the
// extension injects, so the connect popup opens directly with no SDK in the path.
// EIP-6963 multi-provider discovery (a wagmi default) still surfaces each installed
// wallet (MetaMask, Rabby, …) by its real name/icon under the "Installed" group.
export const wagmiConfig = getDefaultConfig({
  appName:   'iMali Admin',
  projectId,
  chains:    [sepolia, mainnet],
  wallets: [
    { groupName: 'Recommended', wallets: [injectedWallet, walletConnectWallet] },
  ],
  transports: {
    [sepolia.id]:  http(alchemyKey ? `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}` : undefined),
    [mainnet.id]:  http(alchemyKey ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}` : undefined),
  },
});
