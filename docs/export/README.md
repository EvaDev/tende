# Documentation PDF exports

Generated PDF copies of the admin **About** page, **Docs** sections, merchant **About**, and the system overview **presentation slides**.

## Regenerate

```bash
npm run export:docs-pdf
```

Requires Node 18+ and Chromium (installed automatically via Playwright on first run).

## Output

| File | Source |
|------|--------|
| `pdf/admin-about.pdf` | Admin app → About (with Key Decisions expanded) |
| `pdf/admin-docs-*.pdf` | Admin app → Docs (concepts, payments, gas-fees, merchant, contracts, functions, events, api) |
| `pdf/merchant-about.pdf` | `html/merchant-about.html` (merchant app requires login in UI) |
| `pdf/presentation-slides.pdf` | `html/presentation-slides.html` (12-slide deck) |

## Source artifacts

- `1voucher-system-overview.canvas.tsx` — interactive Cursor Canvas slide deck (original)
- `html/` — static HTML used for merchant About and slides PDFs
