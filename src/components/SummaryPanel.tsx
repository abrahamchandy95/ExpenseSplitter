"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { describeBalance, formatCents, summarize } from "@/domain";
import type { DomainError, Group, Result, Transfer } from "@/domain";
import { createId } from "@/state/createId";
import type { GroupAction } from "@/state/reducer";

interface Props {
  group: Group;
  applyAction: (action: GroupAction) => Result<Group, DomainError>;
  announce: (message: string) => void;
}

export const SummaryPanel = memo(function SummaryPanel({ group, applyAction, announce }: Props) {
  const summary = useMemo(() => summarize(group), [group]);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Pre-index member names into a Map so lookups inside loops are O(1) instead of O(N) .find() scans.
  const memberNames = useMemo(
    () => new Map(group.members.map((member) => [member.id, member.name])),
    [group.members],
  );
  const getMemberName = (id: string) => memberNames.get(id) ?? "Unknown member";
  const hasRecords = group.expenses.length > 0 || group.payments.length > 0;

  // A failed attempt leaves the group unchanged, so any group change makes the message stale.
  useEffect(() => {
    setError((prev) => (prev === null ? prev : null));
  }, [group]);

  function markPaid(event: MouseEvent, transfer: Transfer) {
    // After the first click the next transfer moves under the pointer, so the
    // second click of a double-click would pay a different transfer.
    if (event.detail > 1) return;
    const result = applyAction({
      type: "addPayment",
      payment: {
        id: createId(),
        from: transfer.from,
        to: transfer.to,
        amountCents: transfer.amountCents,
      },
    });
    setError(result.ok ? null : result.error.message);
    if (!result.ok) return;
    announce(
      `Payment recorded: ${getMemberName(transfer.from)} paid ${getMemberName(transfer.to)} ${formatCents(transfer.amountCents)}`,
    );
    // The clicked button is about to move or disappear, so keep keyboard users in this section.
    headingRef.current?.focus();
  }

  return (
    <section className="card" aria-labelledby="summary-heading">
      <h2 id="summary-heading" ref={headingRef} tabIndex={-1}>
        Who owes whom
      </h2>
      {group.members.length < 2 && !hasRecords ? (
        <p className="muted">Balances appear once the group has 2 people.</p>
      ) : !summary.ok ? (
        <p role="alert" className="error">
          {`Balances could not be computed. ${summary.error.message}`}
        </p>
      ) : (
        <>
          <h3>Balances</h3>
          <ul className="plain-list">
            {summary.value.balances.map((balance) => {
              const description = describeBalance(balance.netCents);
              return (
                <li key={balance.memberId} className="row">
                  <span className="strong">{balance.name}</span>
                  <span className={`balance balance-${description.kind}`}>{description.text}</span>
                </li>
              );
            })}
          </ul>

          <h3>Settlement plan</h3>
          {summary.value.allSettled ? (
            <p role="status" className="settled">
              All settled up
            </p>
          ) : (
            <ul className="plain-list">
              {summary.value.plan.map((transfer) => {
                const text = `${getMemberName(transfer.from)} pays ${getMemberName(transfer.to)}`;
                return (
                  <li key={`${transfer.from}-${transfer.to}`} className="row">
                    <span>{`${text} ${formatCents(transfer.amountCents)}`}</span>
                    <button
                      type="button"
                      className="primary small"
                      aria-label={`Mark as paid: ${text}`}
                      onClick={(event) => markPaid(event, transfer)}
                    >
                      Mark as paid
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
    </section>
  );
});
