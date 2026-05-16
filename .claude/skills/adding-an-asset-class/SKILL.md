---
name: adding-an-asset-class
description: Use when the user wants to add a new asset class (e.g. carbon credits, private credit, gold-backed tokens) to the holding taxonomy. Walks through the four files that must change in lockstep — lib/types.ts (extend AssetClass union), lib/portfolio/holdingKinds.ts (kind metadata), lib/portfolio/holdingFactory.ts (builder), and one or more form components under app/_components/holdings/holding-creator/. Skip when the change is just adding a new ETF preset to an existing class — use the presets file directly.
---

# Adding a new asset class

The codebase treats "asset class" as a load-bearing concept — extending it touches the type system, the kind registry, the factory, and the UI. **Skipping any one of the four steps produces a class that compiles but doesn't render or aggregate correctly.**

## The four files that must change together

| File | What you add |
|---|---|
| `lib/types.ts` | Extend the `AssetClass` union; if the new class is a discriminated kind, add a holding-shape interface (mirrors EquityHolding / BondHolding / etc.) |
| `lib/portfolio/holdingKinds.ts` | Add a meta entry — label, color, default real CAGR, default leverage, whether it's "live-priced" (live-price API) or manual |
| `lib/portfolio/holdingFactory.ts` | Add a builder function `buildHolding(id, input)` for the new kind; route from the dispatcher at the top of the file |
| `app/_components/holdings/holding-creator/<NewKind>Form.tsx` | New per-kind creation form — copy the closest existing form (TickerForm for live-priced, RealEstateForm for manual valuation, etc.) as the template |

## Order of operations

1. **Read** `lib/types.ts:Holding` and a similar existing holding type (e.g. `EquityHolding`) to understand the shape contract.
2. **Read** `lib/portfolio/holdingKinds.ts` to see how an existing entry is structured.
3. **Read** the most-similar existing form under `app/_components/holdings/holding-creator/` as your template.
4. **Add the type** to `lib/types.ts` first — typecheck will then flag every site that needs updating.
5. **Add the meta entry** in `holdingKinds.ts`.
6. **Add the builder** in `holdingFactory.ts`.
7. **Add the form** under `holding-creator/`.
8. **Wire the form** into the kind picker in `HoldingCreator.tsx`.
9. **Write tests:**
   - `lib/portfolio/holdingKinds.test.ts` — assert the new kind appears in the registry with sensible defaults
   - `lib/portfolio/holdingFactory.test.ts` — assert the builder returns the expected shape
   - Property invariant in `lib/properties.test.ts` if the new kind participates in portfolio aggregation
10. **Run** `npm test && npm run lint && npx tsc --noEmit` to confirm green.

## Common mistakes

- Skipping the `holdingKinds.ts` meta entry → the class compiles but doesn't appear in pickers, dropdowns, or breakdowns
- Skipping the form → users can't create the holding through the UI
- Adding `expectedRealCAGR` as a default per-class but forgetting per-holding override path → users can't customize their actual expected return
- Forgetting to update `lib/portfolio/portfolio.ts:computePortfolio` if the class has special aggregation rules (leverage decomposition, etc.)

## Reference past PRs

Search `git log --oneline | grep -i "asset class\|new kind"` to find prior examples in this repo's history.
