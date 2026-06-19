On identity & the web2/web3 boundary: When a user chooses to go on-chain (e.g. for $ savings or remittance), is the intention that their existing 1V balance is migrated to TTZA automatically at that point? The xlsx says "On KYC migrate user 1V balance on chain" but the mechanism isn't specified — is this a treasury operation where Flash credits the on-chain contract and the web2 wallet is zeroed, or something else?
Correct - A new API will be written to burin the users full web2 balance and mint it on chain - so we should probably spec this to a degree - where we pass in the consumer's web2 identity details and it completes the new on chain wallet setup first and then sets the balances.  
We may want to batch this process as a form of migration / take on.


On the legacy API layer: What APIs actually exist and have documentation? You mention FlashID for registration, Gwallet for balance, and product purchase APIs — are these REST APIs with known auth (JWT, API key)? Any existing API spec or swagger docs? This will determine whether Stream 5 is a thin adapter or substantial work.
Yes all of this exists today - I don't have the details but I will be getting them. So there are a few new API's that we will be requesting from the web2 Team.

On cash in specifically: Is there an existing PayShap or EFT integration in the 1V system that can be reused, or does this need to be built from scratch? And who holds the fiat float — Flash itself, or a banking partner?
Existing cash in processes exist and will be re used. There is some design work to do to understand those processes - for example some have APIs to banks, other use screen scrapers. Payshap cash in process does not exist but I expect will be added by the legacy business.
Flash holds the FIAT float in their Flash bank account and earns yield on it but this is managed by the parent group company so they take all the yield. I suspect we will need a separate Fiat account for this project to ring fence it neatly. 

On the smart contracts: You mention contracts exist at /Users/seanevans/eth/src but aren't deployed. Are these complete contracts that just need review, or work-in-progress? And are they on a specific testnet, or still local only?
These are complete but just need review.  


On the $ savings yield: "Some yield can be shared with the..." — this sentence is cut off in the overview. Shared with whom — the consumer, Flash, merchants? This affects the vault contract design.
The vault could be made up of some yield bearing USD stables like USDN or USDE, but also non yield bearing ones like USDT. In aggregate we want to take the total yield and share it in some ratio with users. So we need the ability to manage this and publish a current $savings yield % to the consumer. 

On merchant settlement: Is the expectation that merchants are always settled in TTZA first and then off-ramp themselves, or does the settlement router need to handle direct FIAT payout (e.g. via bank transfer) as part of the on-chain flow?
Merchants will always be settled in TTZA first (or the treasury token of the country / currency they operat in. ) Then at some interval we will settle FIAT into the mercht bank account if they elect for Fiat settlement. Alternately if the elect for USD on chain settlement (mostly applicable we think to non ZA merchants) then we can convert our TTZA to USD. We are not sure about the best way to go about this - CEX or DEX. CEX takes approx 2% so we prefer DEX - and the flow would be transfer Cash to our partner like OVEX and they send us ZARP, from there we purchase USDC on a DEX like Aerodrome or Uniswap. Fewer exchange hops is obviously better but we also want to keep to total costs to a minimum.  

Transactions and transaction history :
At this stage in the design it probably makes sense to add in any data components that would be required to make transactions ISO20022 compliant, since compliance will be one of our greatest reporting requirements
