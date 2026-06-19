import { ConnectButton } from '@rainbow-me/rainbowkit';

interface Props {
  action?: string;
}

export function ConnectPrompt({ action = 'perform this action' }: Props) {
  return (
    <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
      <span>Connect your wallet to {action}.</span>
      <ConnectButton chainStatus="none" showBalance={false} accountStatus="avatar" label="Connect" />
    </div>
  );
}
