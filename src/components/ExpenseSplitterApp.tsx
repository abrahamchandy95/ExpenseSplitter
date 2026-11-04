"use client";

import { useCallback, useRef } from "react";
import type { Expense } from "@/domain";
import { useExpenseSplitter } from "@/state/useExpenseSplitter";
import type { StorageLike } from "@/storage/statePersistence";
import { ExpenseForm } from "./ExpenseForm";
import { MembersPanel } from "./MembersPanel";
import { RecordsPanel } from "./RecordsPanel";
import { SummaryPanel } from "./SummaryPanel";

interface Props {
  /** Injectable for tests; defaults to window.localStorage, resolved after mount. */
  getStorage?: () => StorageLike | null;
}

export function ExpenseSplitterApp({ getStorage }: Props) {
  const { state, applyAction, dismissNotice } = useExpenseSplitter(getStorage);
  const statusRegionRef = useRef<HTMLParagraphElement>(null);

  // Update the live region's textContent directly via a ref instead of React state.
  // Screen readers observe DOM text mutations inside `role="status"`, and using a ref
  // avoids re-rendering the entire app and all 4 panels on every announcement.
  const announce = useCallback((message: string) => {
    if (statusRegionRef.current) {
      statusRegionRef.current.textContent = message;
    }
  }, []);

  // Memoized so `ExpenseForm` receives a stable function reference across renders.
  const handleAddExpense = useCallback(
    (expense: Expense) => applyAction({ type: "addExpense", expense }),
    [applyAction],
  );

  return (
    <div className="page">
      <header className="page-header">
        <h1>Expense Splitter</h1>
        <p className="muted">Share costs, then settle up with a short list of payments.</p>
      </header>

      {/* Always mounted: screen readers only announce changes to a region that already exists. */}
      <p ref={statusRegionRef} role="status" className="visually-hidden" />

      {state.status === "loading" ? (
        <p className="placeholder" aria-busy="true">
          Loading
        </p>
      ) : (
        <>
          {state.notice ? (
            <div role="alert" className="notice">
              <span>{state.notice}</span>
              <button type="button" className="secondary small" onClick={dismissNotice}>
                Dismiss notice
              </button>
            </div>
          ) : null}
          <main className="layout">
            <div className="column">
              <MembersPanel group={state.group} applyAction={applyAction} />
              <section className="card" aria-labelledby="expense-heading">
                <h2 id="expense-heading">Add expense</h2>
                {state.group.members.length < 2 ? (
                  <p className="empty-state">Add at least 2 people to start</p>
                ) : (
                  <ExpenseForm members={state.group.members} onAddExpense={handleAddExpense} />
                )}
              </section>
            </div>
            <div className="column">
              <SummaryPanel group={state.group} applyAction={applyAction} announce={announce} />
              <RecordsPanel group={state.group} applyAction={applyAction} announce={announce} />
            </div>
          </main>
        </>
      )}
    </div>
  );
}
