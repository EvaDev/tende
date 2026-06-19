import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia, mainnet } from 'wagmi/chains';
import { http } from 'wagmi';

const alchemyKey = import.meta.env.VITE_ALCHEMY_API_KEY ?? '';

export const wagmiConfig = getDefaultConfig({
  appName:   'Tende Admin',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? 'demo',
  chains:    [sepolia, mainnet],
  transports: {
    [sepolia.id]:  http(alchemyKey ? `https://eth-sepolia.g.alchemy.com/v2/${alchemyKey}` : undefined),
    [mainnet.id]:  http(alchemyKey ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}` : undefined),
  },
});
