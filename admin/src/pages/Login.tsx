import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount, useSignMessage } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { loginWithWallet } from '@/lib/auth';
import { useAppName } from '@/hooks/useAppConfig';

export default function LoginPage() {
  const { isConnected, address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const navigate = useNavigate();
  const appName = useAppName();

  useEffect(() => {
    if (!isConnected || !address) return;
    loginWithWallet(address, (msg) => signMessageAsync({ message: msg }))
      .then(() => navigate('/'))
      .catch(() => {});
  }, [isConnected, address]);

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-xl p-10 w-full max-w-sm text-center space-y-6">
        <h1 className="text-2xl font-bold text-brand-accent">{appName}</h1>
        <p className="text-sm text-gray-500">Connect your wallet to access the admin console.</p>
        <div className="flex justify-center">
          <ConnectButton />
        </div>
      </div>
    </div>
  );
}
