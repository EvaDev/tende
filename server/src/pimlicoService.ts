// src/pimlicoService.ts
// Pimlico paymaster integration.
// Whitelists a Safe wallet address so that Pimlico sponsors its gas.
//
// PIMLICO_MODE=stub  — logs the call, returns success (default for dev/test)
// PIMLICO_MODE=live  — calls Pimlico pm_addToSponsorshipPolicy API

import config from './config.js';
import type { PimlicoWhitelistResult } from './types.js';

const mode = process.env.PIMLICO_MODE ?? 'stub';

interface PimlicoService {
  whitelistSponsored(args: { walletAddress: string }): Promise<PimlicoWhitelistResult>;
  isWhitelisted(args: { walletAddress: string }): Promise<boolean>;
}

const stub: PimlicoService = {
  async whitelistSponsored({ walletAddress }) {
    console.log(`[pimlico:stub] whitelistSponsored wallet=${walletAddress}`);
    return { whitelisted: true, wallet: walletAddress };
  },

  async isWhitelisted({ walletAddress }) {
    console.log(`[pimlico:stub] isWhitelisted wallet=${walletAddress}`);
    return true;
  },
};

const live: PimlicoService = {
  async whitelistSponsored({ walletAddress }) {
    const response = await fetch(config.pimlico.bundlerUrl, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${config.pimlico.apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id:      1,
        method:  'pm_addToSponsorshipPolicy',
        params:  [config.pimlico.sponsorshipPolicy, { senderAddress: walletAddress }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Pimlico whitelist failed: ${response.status} ${text}`);
    }

    const json = await response.json() as { error?: unknown; result?: unknown };
    if (json.error) throw new Error(`Pimlico RPC error: ${JSON.stringify(json.error)}`);

    return { whitelisted: true, wallet: walletAddress, result: json.result };
  },

  async isWhitelisted({ walletAddress }) {
    const response = await fetch(config.pimlico.bundlerUrl, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${config.pimlico.apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id:      1,
        method:  'pm_getSponsorshipPolicySenders',
        params:  [config.pimlico.sponsorshipPolicy],
      }),
    });

    if (!response.ok) throw new Error(`Pimlico isWhitelisted failed: ${response.status}`);

    const json = await response.json() as { result?: string[] };
    const senders = json.result ?? [];
    return senders.map(s => s.toLowerCase()).includes(walletAddress.toLowerCase());
  },
};

export const pimlicoService: PimlicoService = mode === 'live' ? live : stub;
export default pimlicoService;
