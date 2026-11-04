"use client";

import { memo, useMemo, useRef } from "react";
import { formatCents, formatPercent } from "@/domain";
import type { DomainError, Expense, Group, Result } from "@/domain";
import type { GroupAction } from "@/state/reducer";

interface Props {
  group: Group;
  applyAction: (action: GroupAction) => Result<Group, DomainError>;
  announce: (message: string) => void;
}

function describeSplit(expense: Expense, getMemberName: (id: string) => string): string {
  const split = expense.split;
  if (split.kind === "even") {
    const count = split.participantIds.length;
    return `Even split, ${count} ${count === 1 ? "person" : "people"}`;
  }
  const shares = split.shares.map(
    (share) => `${getMemberName(share.memberId)} ${formatPercent(share.bps)}`,
  );
  return `Percent split: ${shares.join(", ")}`;
}

/** Adds "(1 of 2)" only to labels that would otherwise be identical, so every button name is unique. */
function uniqueLabels(labels: string[]): string[] {
  const totals = new Map<string, number>();
  for (const label of labels) totals.set(label, (totals.get(label) ?? 0) + 1);
  const seen = new Map<string, number>();
  return labels.map((label) => {
    const total = totals.get(label) ?? 1;
    if (total === 1) return label;
    const current = (seen.get(label) ?? 0) + 1;
    seen.set(label, current);
    return `${label} (${current} of ${total})`;
  });
}

export const RecordsPanel = memo(function RecordsPanel({ group, applyAction, announce }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Pre-index member names into a Map so lookups across expenses, shares, and payments are O(1).
  const memberNames = useMemo(
    () => new Map(group.members.map((member) => [member.id, member.name])),
    [group.members],
  );
  const getMemberName = (id: string) => memberNames.get(id) ?? "Unknown member";

  const expenseLabels = useMemo(
    () =>
      uniqueLabels(
        group.expenses.map(
          (expense) =>
            `Delete expense: ${expense.description}, ${formatCents(expense.amountCents)}, ${expense.date}`,
        ),
      ),
    [group.expenses],
  );

  const paymentLabels = useMemo(
    () =>
      uniqueLabels(
        group.payments.map(
          (payment) =>
            `Delete payment: ${getMemberName(payment.from)} paid ${getMemberName(payment.to)}, ${formatCents(payment.amountCents)}`,
        ),
      ),
    [group.payments, memberNames],
  );

  // The clicked Delete button disappears, so keep keyboard users in this section.
  function removeRecord(action: GroupAction, message: string) {
    if (!applyAction(action).ok) return;
    announce(message);
    headingRef.current?.focus();
  }

  return (
    <section className="card" aria-labelledby="records-heading">
      <h2 id="records-heading" ref={headingRef} tabIndex={-1}>
        Expenses and payments
      </h2>

      <h3>Expenses</h3>
      {group.expenses.length === 0 ? (
        <p className="muted">No expenses yet.</p>
      ) : (
        <ul className="plain-list">
          {group.expenses.map((expense, index) => (
            <li key={expense.id} className="record">
              <div className="record-main">
                <p className="strong">
                  {expense.description}{" "}
                  <span className="amount">{formatCents(expense.amountCents)}</span>
                </p>
                <p className="muted">
                  {`Paid by ${getMemberName(expense.payerId)} on ${expense.date}. ${describeSplit(expense, getMemberName)}`}
                </p>
              </div>
              <button
                type="button"
                className="secondary small danger"
                aria-label={expenseLabels[index]}
                onClick={() =>
                  removeRecord(
                    { type: "deleteExpense", expenseId: expense.id },
                    `Expense deleted: ${expense.description}`,
                  )
                }
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>Payments</h3>
      {group.payments.length === 0 ? (
        <p className="muted">No payments yet.</p>
      ) : (
        <ul className="plain-list">
          {group.payments.map((payment, index) => {
            const text = `${getMemberName(payment.from)} paid ${getMemberName(payment.to)}`;
            return (
              <li key={payment.id} className="record">
                <div className="record-main">
                  <p className="strong">
                    {text} <span className="amount">{formatCents(payment.amountCents)}</span>
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary small danger"
                  aria-label={paymentLabels[index]}
                  onClick={() =>
                    removeRecord({ type: "deletePayment", paymentId: payment.id }, "Payment deleted")
                  }
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
});
