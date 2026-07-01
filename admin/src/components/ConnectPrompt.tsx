import { ConnectButton } from '@rainbow-me/rainbowkit';

interface Props {
  action?: string;
}

export function ConnectPrompt({ action = 'perform this action' }: Props) {
  return (
    <div className="flex items-center gap-3 p-3 bg-brand-accent/10 border border-brand-accent/30 rounded-lg text-sm text-brand-accent">
      <span>Connect your wallet to {action}.</span>
      <ConnectButton chainStatus="none" showBalance={false} accountStatus="avatar" label="Connect" />
    </div>
  );
}
