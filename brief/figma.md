Figma Make Prompt: iMali Web App Mockup
Global Design Direction
Mobile-first responsive web app (RWA). Brand name: iMali. Clean, trustworthy fintech aesthetic.  Progress indicators for multi-step flows. Card-style containers with soft shadows for content grouping.
UC-1: Registration Flow (9 screens)
Screen 1 — Welcome / Entry
iMali logo centred
Headline: "Send money home. Simply."
CTA button: "Create Account"
Secondary link: "Already have an account? Log in"
Screen 2 — Facial Biometric Capture
Camera viewfinder oval/circle frame
Instruction text: "Position your face within the frame"
Liveness animation indicator (animated ring)
Status states: Detecting → Liveness Check → Verified ✓
"Retry" option
Screen 3 — Mobile Number Entry
Input field: Mobile number with +27 SA country code prefix (non-editable)
CTA: "Send OTP"
Screen 4 — OTP Verification
6-digit OTP input (individual boxes)
Countdown timer: "Resend in 0:45"
"Resend OTP" link (greyed until timer expires)
CTA: "Verify"
Screen 5 — ID Document Scan
Two options displayed as cards: "Passport" / "SA ID Card"
Camera viewfinder with document outline frame
Status states: Scanning → Extracting Data → Verified ✓
Auto-populated review fields after scan: Full Name, Date of Birth, Document Number, Expiry Date (pre-filled, read-only)
Face match confirmation banner: "Selfie match: Confirmed ✓"
CTA: "Confirm & Continue"
Screen 6 — Personal Details
Pre-populated from OCR: Full Name, DOB, ID/Passport Number (read-only)
Address Line 1 (required), Address Line 2, City, Province, Postal Code (required)
Email address (optional — labelled as such)
CTA: "Continue"
Screen 7 — Financial Profile
Dropdown: Occupation (Employed (Formal) / Self-Employed / Informal Business / Unemployed / Student / Retired / Pensioner / Government Employee / Domestic Worker / Agriculture / Farming / Casual / Piece Work / Other)
Dropdown: Source of Income (Salary / Wages / Business Income / Savings / Family Support / Gift Received / Pension / Grant / Sale of Goods or Assets / Investment Income / Loan Proceeds / Other)
CTA: "Continue"
Screen 8 — PIN Registration
Instruction: "Create your 5-digit PIN"
5-dot PIN entry pad (numeric keypad)
Second screen state: "Confirm your PIN"
Error state: "PINs do not match — try again"
CTA: "Set PIN"
Screen 9 — Registration Success
Animated checkmark
"Account Created Successfully"
Wallet balance shown: R0.00
CTA: "Go to Home"
UC-2: Login Flow
Screen 1 — Login Options
Two large tap cards: "Login with Face ID" (face icon) / "Login with PIN" (keypad icon)
Link: "Forgot PIN?"
Screen 2a — Face Login
Camera oval frame
Status: Verifying → Authenticated ✓
Auto-navigates to Home on success
Screen 2b — PIN Login
5-dot PIN entry pad
"Forgot PIN?" link
Error state: "Incorrect PIN — 2 attempts remaining"
UC-3: Home Screen + RemitVoucher Top-Up
Home Screen
Top bar: iMali logo + profile avatar icon
Wallet balance card (prominent): "Available Balance: R1,250.00"
Two primary action buttons: "Top Up" | "Send Money"
Recent Transactions list (3–4 placeholder rows): recipient name, date, amount sent, status pill (Completed / Pending)
Bottom nav: Home | Send | History | Account
Top-Up — Voucher Redemption
Heading: "Redeem RemitVoucher"
16-digit code input formatted as XXXX-XXXX-XXXX-XXXX with auto-hyphen spacing
CTA: "Redeem Voucher"
Loading state: "Verifying voucher…"
Success state: Green banner — "R500.00 credited to your wallet" + updated balance
Error state: Red banner — "Invalid or already redeemed voucher"
UC-4: Remit / Send Money Flow (5 screens)
Screen 1 — Destination & Payout Method
Dropdown: Destination Country — Zimbabwe (selectable); South Africa, UK, USA (greyed, labelled "Coming Soon")
Dropdown: Recipient receives via — Bank | Mobile Money | Cash Collection
If Bank selected — additional fields:
Bank Name (dropdown): CBZ Bank, Stanbic Zimbabwe, FBC Bank, ZB Bank, NMB Bank, Steward Bank, BancABC, CABS
Branch / Sort Code (text input)
Account Number (text input)
If Mobile Money selected — additional fields:
Operator (dropdown): EcoCash, O'Mari
Recipient Mobile Number (text input)
If Cash Collection selected:
No recipient banking fields shown
Info banner: "A FlashRemit Voucher will be generated for your recipient to collect cash"
All payout methods include these common recipient fields:
Recipient Full Name
Recipient ID / Passport Number
Relationship to Recipient (dropdown): Immediate Family (spouse, parent, child) / Extended Family (sibling, cousin, uncle/aunt) / Friend / Employee / Employer / Business Partner / Self (sending to own account/wallet) / Other
CTA: "Continue"
Screen 2 — Amount & Currency
Dropdown: Currency recipient receives — ZWG | USD | ZAR
Input: Amount to send (ZAR)
Indicative FX rate shown below input (greyed)
CTA: "Get Quotes"
Screen 3 — Quote Selection
Heading: "Select your quote"
3 quote cards, ranked lowest fee first — each shows:
Provider logo placeholder
Recipient gets: e.g. "USD 42.10"
FX Rate: e.g. "1 ZAR = 0.054 USD"
Total cost to send: e.g. "R785.00 (incl. R7.50 fee)"
Estimated delivery: e.g. "~15 mins"
Quote expires in: countdown 02:47 (animated)
"Select" button
Top card badged: "Lowest Fee ✓"
Screen 4 — Confirm Transaction
Summary card: Sending amount, Fee, Total debited, Recipient name, Payout method, Recipient gets, FX rate, Delivery time
If Cash Collection: additional line — "Voucher will be sent to recipient's mobile number" (prompt for recipient mobile if not already captured)
CTA: "Confirm & Send" | "Cancel"
Screen 5 — Transaction Success
Animated success checkmark
Transaction Reference: 1R-20260515-00423
Full transaction summary
If Cash Collection: FlashRemit Voucher code displayed prominently — FRVZW-XXXX-XXXX-XXXX — with "Share Voucher" button (triggers native share)
Wallet balance updated
CTA: "Back to Home"
Home screen shown with new transaction entry at top of list
UC-5: Transaction History
Screen — Transaction History
List rows: Recipient name + Zimbabwe flag, date/time, ZAR sent, recipient currency amount, status pill (Completed / Pending / Failed)
Tap row → Transaction Detail screen with all fields
Cash Collection transactions: show FlashRemit Voucher code in detail view with copy icon
UC-6: Account Admin
Account Menu
Profile summary: avatar, name, mobile number
Menu items: Change PIN / Manage Beneficiaries / Update Profile / Change Mobile Number / Help & Support / Log Out
Change PIN: Current PIN → New PIN → Confirm → Success
Manage Beneficiaries: Saved beneficiary list with Edit/Delete. "Add New Beneficiary" triggers same fields as UC-4 recipient section (including Relationship to Recipient and ID/Passport Number)
Update Profile: Editable address, email, Occupation, Source of Income dropdowns. Save button.
Change Mobile Number: New number entry → OTP verification → Confirm
Flow Connections
Welcome → Registration (linear, back navigation throughout)
Welcome → Login → Home
Home "Top Up" → Voucher Redemption → Home (balance updated)
Home "Send Money" → Payout Method → Amount → Quotes → Confirm → Success → Home (new transaction top of list)
Home bottom nav → History
Home bottom nav → Account → sub-flows