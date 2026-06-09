Project Instructions

The current project folder is here:
/Users/seanevans/eth and this do is in 
/Users/seanevans/eth/prompt

The project enables users to manage their money, make payments, and interact with merchants in a decentralized, secure environment.
UI is as simple as possible and users are not aware they are on chain - all details abstracted away and interactions are in FIAT denominations (eg ZAR not ZARP, USD not USDC).
The design thinking should be global and as open as possible (eg idOS vs Daon for identity); we want minimal vendor / third party dependencies.
The building blocks to support an ambitious future - for example we should enable payments so as far as possible we become our own PSP and provide this service to merchants in future. 

This is a complex app with 2 main UI components (React front end with node.js back end)
1. Consumer UI (register, send, spend, manage)
2. Server back end for Administrator & Merchants (depending on connected wallet address )and open visibility to some comments (no connected wallet) 
    1. Admin set up country / currency (stored in local DB)
    2. doubles as an open platform for merchant self registration (list products, create QR check out)
    Node.js: Server runtime environment
    Express.js: Web application framework
    JWT: Session management and authentication
    PM2: Process management for production deployment

Complexity comes from the fact that this is a new dApp, but it will most likely replace an existing web2 kotlin app (the 1Voucher app). Since we are not sure about how or even if that will happen, will will build the new stand alone components above to interact with on chain and existing APIs, and decide later how to merge the 2 versions if required. Consumer balance and identity will start as existing web2 components, but if the user choses to use an on chain only product (eg $ savings or remittance) then they will have to move to on chain identity and on chain balances. Its either or - users cannot have both.

To allow easy visual identification of what is on offer, we need to have a very simple 3 tier colour scheme that can easily be changed. For example the current on chain iMali POC has yellow background, blue buttons ad accents and white/black text. The existing 1Voucher app has Orange / white as per the attached screen shots. You can see from the attached merchants.jpg that the merchant can set their own colours for the consumer UI to allow them to embed this in their own UI as seamlessly as possible - so an aggregation enabler.

There are a few main technical components
1. idOS for Identity (https://docs.idos.network/)
    When available we will add faceSign for biometrics to secure wallets
2. System data : Local relational database for country, currency, Function /country compliance limits, local storage of indexed on chain events, etc for reporting 
3. Ethereum smart contract layer. Much of the design has already been done but we may need to upgrade for allowing merchant registration and the fact that PII now resides in idOS. Current contracts (not deployed) sit here /Users/seanevans/eth/src
    3.1. Use this for all Solidity https://github.com/austintgriffith/ethskills/blob/master/concepts/SKILL.md
    3.2. Includes ERC4337 account abstraction
    3.3. Paymaster (Pimlico)
    3.4. Multi-Stablecoin Support: Unified balance system supporting multiple stablecoins per currency (e.g., ZARU, TTZA for ZAR — TTZA is the treasury token from zarf.cairo, not a tradeable stablecoin)
4. Legacy APIs - for example there are legacy we2 user registration , wallet balance and product purchase API's. These spend APIs are coulpled in some cases to third party supplier API's, which will continue in service - with new API's required for on chain balance spend rather than legacy wallet balance spend. 
5. Existing and new cash in and cash out capabilities. These are not only technical components but crucial business process components that ensure Cash deposits & are tied to on chain mint & burn events. This process has not been fully designed yet.  

Consumer Wallet  
1. non custodial ERC4337 using Safe and passkey
2. React web app with ether.js and webAuthn for passkey 
3. Wallet recovery : first option using passkey but for lost device allow user to set up mobile / email / guardians - but this may change with idOS integration
4. Gas fees are covered by a paymaster (initially Pimlico)
5. Wallet capability : need to store 2 types of vault balance, 
    * Local currency 
    * USD balance for $ savings. This $ stablecoin may earn yield, some of which can be shared with the 
6. User can send to mobile number or  Account number. If that user does not already have an account on chain with us, we send them a WhatsApp link inviting them to sign up and register.
7. ENS Subdomains: Privacy-preserving payment tags (hashed on-chain)
8. Transaction History: On-chain transaction tracking for purchases, top-ups, and transfers
9. No PII stored on chain
10. Passkey Authentication: Serverless, biometric-based login WebAuthn for secure, passwordless access
11.Payment Tags: Human-readable payment addresses (ENS subdomains) for easy peer-to-peer transfers
12. Enforce spend / wallet transfer amounts according to the KYC limits set in the system data database by the administrator (see KYC.jpg) 
13. Aggregated balance is shown in the FIAT currency of the consumer's country currency eg see consumerUI.jpg

Admin wallet (Owner and deployer of all smart contracts)
Management on the server back end UI allows Admin to manage treasury - eg
    1. top up paymaster wallet thei ETH. 
    2. Purchase USDC for $savings functions
    3. Manage merchant payout & burning TTZA
    4. Yield on $savings accounts & vault balances
Key individuals will have to manage safe wallet signing - need a robust process to cover this

Merchant Wallet & Integration: 
Merchant onboarding and product management system, allowing them to create a QR check out option and be settled in stable coin.
Merchcant off ramp : Allows merchant to be settled in FIAT or crypto for stablecoin balance  (eg convert TTZA to USDC or ZAR in bank)
Settlement Router: Handles payments between consumers and merchants with fee distribution - this will become a new smart contract 
Merchant Logo management via files stored in Arweave wallet owned by admin

See the design.jpg for an overview of the high level functions