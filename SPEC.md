# Expense Splitter: Spec

Scope: one group, one currency (USD), runs in the browser. Prototype quality, but the money logic is treated as production quality.

## Goal

A small group records shared expenses, splits each one evenly or by custom percentage, and sees a short list of payments (at most one fewer than the number of people with a balance) that settles everyone up.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Cents-vs-dollars mistakes become type errors. Domain and UI share types. |
| Framework | Next.js 15 (App Router) + React 19 | One-command dev server, familiar to most reviewers, and route handlers give a ready path to a real API later. |
| Domain | Plain TS modules, no React, Next, or DOM imports | Pure functions are trivial to test and reusable by a future API. |
| Tests | Vitest, including property-style tests | Domain tests run in plain Node with no framework involved. Money invariants deserve randomized checks. |
| State and storage | React reducer in a client component + `localStorage` behind a small adapter | No backend or database to stand up for the demo. State is loaded after mount to avoid hydration mismatches. |
| Styling | Plain CSS (global stylesheet) | No component library to fight during a demo. |

Pinned to what Node 18.20 supports (Next 15, Vitest 2). Next 16 needs Node 20, so it is not used. Upgrade path: replace the storage adapter with calls to Next route handlers backed by SQLite or Postgres, without touching the domain.

## Domain model and relationships

- A **Group** has many **Members** (id, name). The prototype has exactly one group.
- An **Expense** has a description, `amountCents` (integer), one **payer** (a Member), a date, and one **split**.
- A **split** is either `even` (a list of participant ids) or `percent` (a list of `{memberId, bps}`). `bps` is hundredths of a percent, so 10000 means 100.00%.
- A **Payment** (settle-up) records `from`, `to`, `amountCents`. It moves balances without being an expense.
- **Allocation** (derived, never stored): an expense plus its split gives cents owed per member. It always sums exactly to `amountCents`.
- **Net balance** (derived): cents paid, minus cents allocated, plus payments sent, minus payments received. Positive means the group owes that member. All nets sum to zero.
- **Settlement plan** (derived): net balances reduced to a list of `{from, to, amountCents}`.
- Expenses and payments reference members by id. A member that is referenced cannot be removed.

## Rules

**Money.** Integer cents everywhere in the domain. Amount and percent text share one grammar: after trimming surrounding whitespace, an optional leading `-`, then ASCII digits, optionally a dot followed by ASCII digits. Anything else is non-numeric (for example `.5`, `5.`, `1,000`, `$5`, `+5`, `1e2`, `0x10`, inner spaces). A leading `-` on an otherwise valid number is negative, including `-0`. Cents and bps are built from the digit strings (whole part times 100, plus the fraction right-padded to 2 digits), never with `Number`, `parseFloat`, or float multiplication, because `0.29 * 100` is 28.999999999999996. Amount input accepts `12`, `12.5`, `12.50`. It rejects empty text, zero, negatives, more than 2 decimals (even when the extra digits are zeros), and an expense above 1,000,000.00 (that exact value is allowed).

**Even split.** Participants are chosen by checkbox (default: everyone), at least one. Each gets `floor(amount / n)`. The leftover cents go one each to the first participants in member order. Example: $100.00 among 3 is 33.34, 33.33, 33.33.

**Percent split.** Each member has a percent with up to 2 decimals, stored as `bps`. Cents are apportioned by largest remainder: floor each share, give leftover cents to the largest fractional remainders, ties broken by member order. Shares always sum to the amount.

**Expense form.** A field's error clears as soon as that field is edited, and a failed save keeps everything typed. After a successful save the form clears and returns to Even mode, so a fresh form never opens with a percent gap warning.

**Member order** is the order members were added. A name added again after removal is a new member, placed last. Both the even-split leftover cents and the percent-split remainder ties use this order.

### When percentages do not add up to 100%

Decision: reject, explain, and help. Never auto-normalize, scale, or dump the difference on someone, because that silently changes what people agreed to pay.

1. The total is checked on integer `bps` and must equal exactly 10000. No tolerance. So 33.33 + 33.33 + 33.33 = 99.99 is rejected.
2. Percent mode shows one percent row for every member and no participant checkboxes. An empty or whitespace-only field counts as 0.00, and rows at 0.00 are not stored in the split (so they never count as references).
3. Each field shows at most one error, checked in this order: non-numeric, negative, more than 2 decimals, above 100.
4. A live line sits next to the inputs. It reads "Total X%." followed by "Y% still unassigned." when under or "Y% over." when over, and nothing more at exactly 100.00. X and Y are formatted from integer `bps` with exactly 2 decimals. If any field has an error, the line reads "Total unavailable until every field is valid." and the Save button's disabled reason names the invalid fields instead of the gap. Nothing is saved while the split is invalid.
5. Two explicit helpers, both user-triggered. **Fill remainder** on each row ignores that row's current text and sets it to 100.00 minus the other rows. It is offered only when every other row is valid and the result is 0.00 or more (with a single row it gives 100.00). **Split evenly** overwrites every row with equal percentages by largest remainder in member order (33.34, 33.33, 33.33), and the form stays in percent mode.
6. The domain enforces the same rule and returns a typed error (`PERCENT_SUM_MISMATCH` with integer-bps `expected` and `actual`), so the UI is not the only guard.

### Domain validation

The domain validates every expense and payment before computing anything, and returns a typed error on violation. `PERCENT_SUM_MISMATCH` is one; other violations use a distinct error such as `INVALID_SPLIT`. Checks:

- `amountCents` is a positive safe integer, and an expense is at most 100000000.
- The payer and every participant are group members. Participant ids are unique and there is at least one.
- Every stored `bps` is an integer from 1 to 10000, and the sum is exactly 10000.
- A payment's `from` and `to` differ.

Every submit path, including the Enter key, calls the domain. On an error the form keeps all typed values and the chosen mode, shows the same Total and gap sentence for a percent mismatch, and adds nothing.

### Group and relationship rules

- Member names are trimmed and internal runs of whitespace collapsed to one space, then must be non-empty, unique ignoring case, and at most 40 characters.
- At least 2 members are needed before an expense can be added.
- The payer must be a member and does not have to be a participant (they paid for others). A payer who is the only participant creates no debt.
- A member is referenced if they are the payer or a stored participant of any expense, or the `from` or `to` of any payment. Removing a referenced member is blocked, with a message that counts each referencing record once, for example "Alice is used by 2 expenses and 1 payment." Removing an unreferenced member works.
- Payments are created only by Mark as paid, are not linked to any expense, and are not checked against the plan. A payment needs two different members and any positive whole number of cents (the expense cap does not apply to payments).
- Deleting an expense never changes payments, so balances can flip: deleting a $30.00 dinner after Bob paid Alice $30.00 makes the summary say Alice owes Bob $30.00. The page lists every expense and every payment, each with its own delete control, so a mistaken Mark as paid can be undone. All balances are derived, so any delete recomputes everything.

### Who-owes-whom summary

- Shows each member as "is owed $X", "owes $X", or "settled". A group with fewer than 2 members and no records shows "Balances appear once the group has 2 people." instead, but a group that has any expense or payment always shows its members' balances.
- Shows the settlement plan. Mutual debts net out and chains collapse (A owes B and B owes C becomes A owes C).
- At most `max(0, k - 1)` transfers for `k` members with a nonzero balance (none when everyone is settled). The plan is built greedily: repeatedly take the member who owes the most and the member who is owed the most (ties by lowercase name), transfer the smaller of the two amounts, and update both balances before the next pick. Each transfer zeroes at least one balance, which gives the bound. The result is not guaranteed to be the fewest possible. Transfers are listed in the order produced, so the plan does not shuffle between renders.
- When every balance is zero it says "All settled up".
- **Mark as paid** on a transfer records a Payment for exactly that amount, and the plan recomputes. A double-click records one payment, not two (the next transfer moves under the pointer after the first click).

### Persistence

State is saved to `localStorage` under `expense-splitter:v1`. On load it is checked with the same domain validation used when records are created, plus unique member ids and no payment or expense referencing a non-member. If anything fails, the whole stored state is discarded (never partially repaired, because dropping one record silently changes every balance), the app starts empty, and a visible notice says so. The storage adapter writes only after the load attempt has finished (an explicit loaded flag). Until then the UI shows a neutral placeholder, never the empty group.

## Out of scope

Multiple groups, multiple currencies, exact-amount or share-based splits, multiple payers per expense, editing an expense (delete and re-add instead), a reset-data control, accounts, server sync, receipts.

## Acceptance criteria

- Even split of $100.00 among 3 yields 33.34, 33.33, 33.33 and the allocations sum to 10000 cents.
- Percent 50/30/20 on $60.00 yields 30.00, 18.00, 12.00.
- Percent 50/30/10 is rejected, shows "10.00% still unassigned", and cannot be saved. 33.33 x 3 is rejected as 99.99%. Percent `[15000, -5000]` bps is rejected even though it sums to 10000.
- Split evenly always, and Fill remainder whenever it is offered, produce a savable 100.00% split.
- For any sequence of valid expenses and payments: allocations sum to each amount, nets sum to zero, applying the settlement plan zeroes every net, and transfers number at most `max(0, k - 1)`.
- Removing a referenced member is refused with an explanation. Removing an unreferenced one works.
- Reloading the page restores state, and the first render after reload never overwrites stored data. Corrupt storage does not crash the app.
- The UI never shows NaN, floating-point artifacts like 0.30000000000000004, or negative zero.
- The demo script produces exactly the numbers listed in it.

## Demo script

Start from empty storage (a fresh private window, or clear `expense-splitter:v1`), otherwise names collide after a rehearsal. Type amounts without a dollar sign.

1. Add Alice, Bob, Carol.
2. Alice pays 90.00 for dinner, split evenly. Nets: Alice +60.00, Bob -30.00, Carol -30.00. Plan: Bob pays Alice $30.00, Carol pays Alice $30.00.
3. Bob pays 60.00 for a taxi. Choose percent and enter 50/30/10 for Alice/Bob/Carol. The line shows "Total 90.00%. 10.00% still unassigned." and Save is disabled. Click Fill remainder on Carol (her field becomes 20.00) and save. Shares are Alice 30.00, Bob 18.00, Carol 12.00. Nets: Alice +30.00, Bob +12.00, Carol -42.00. Plan: Carol pays Alice $30.00, Carol pays Bob $12.00. Alice and Bob net against each other, so no Alice-Bob transfer appears.
4. Try to remove Alice. Refused: "Alice is used by 2 expenses."
5. Click Mark as paid on "Carol pays Bob $12.00". Bob shows settled, Carol owes $30.00, and only Carol pays Alice $30.00 remains. Reload to show persistence.
