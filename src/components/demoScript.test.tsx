// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { STORAGE_KEY } from "@/domain";
import { DISCARD_NOTICE } from "@/storage/statePersistence";
import type { StorageLike } from "@/storage/statePersistence";
import { ExpenseSplitterApp } from "./ExpenseSplitterApp";

type User = ReturnType<typeof userEvent.setup>;

/** A fake storage that records every call, so tests can check ordering and values written. */
function recordingStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(STORAGE_KEY, initial);
  const events: string[] = [];
  const storage: StorageLike = {
    getItem: (k) => {
      events.push("get");
      return data.get(k) ?? null;
    },
    setItem: (k, v) => {
      events.push(`set:${v}`);
      data.set(k, v);
    },
  };
  return { storage, data, events };
}

function listUnder(headingName: string, level?: number): HTMLElement {
  const heading = screen.getByRole("heading", { name: headingName, ...(level ? { level } : {}) });
  const list = heading.nextElementSibling as HTMLElement | null;
  if (!list) throw new Error(`Nothing follows the heading ${headingName}`);
  return list;
}

/** Each balance row as [member name, description]. */
function balances(): string[][] {
  return within(listUnder("Balances"))
    .getAllByRole("listitem")
    .map((li) => Array.from(li.children).map((c) => c.textContent ?? ""));
}

/** The transfer sentences of the settlement plan, in listed order. */
function plan(): string[] {
  const list = listUnder("Settlement plan");
  return within(list)
    .queryAllByRole("listitem")
    .map((li) => li.firstElementChild?.textContent ?? "");
}

function expenseRows(): string[] {
  const list = listUnder("Expenses");
  return within(list)
    .queryAllByRole("listitem")
    .map((li) => li.textContent ?? "");
}

function paymentRows(): string[] {
  const list = listUnder("Payments");
  return within(list)
    .queryAllByRole("listitem")
    .map((li) => li.textContent ?? "");
}

async function addMemberByName(user: User, name: string) {
  await user.type(await screen.findByRole("textbox", { name: "Member name" }), name);
  await user.click(screen.getByRole("button", { name: "Add member" }));
}

async function addTrio(user: User) {
  for (const name of ["Alice", "Bob", "Carol"]) await addMemberByName(user, name);
}

describe("demo script, end to end", () => {
  it("runs the whole script and persists across a remount", async () => {
    const user = userEvent.setup();
    const { storage, data, events } = recordingStorage();
    const getStorage = () => storage;
    const first = render(<ExpenseSplitterApp getStorage={getStorage} />);

    // Step 1: add Alice, Bob, Carol.
    await addTrio(user);
    const membersCard = screen.getByRole("region", { name: "Members" });
    for (const name of ["Alice", "Bob", "Carol"]) {
      expect(within(membersCard).getByRole("button", { name: `Remove ${name}` })).toBeInTheDocument();
    }
    expect(screen.queryByText("Add at least 2 people to start")).not.toBeInTheDocument();
    expect(balances()).toEqual([
      ["Alice", "settled"],
      ["Bob", "settled"],
      ["Carol", "settled"],
    ]);
    expect(screen.getByText("All settled up")).toBeInTheDocument();

    // Step 2: Alice pays 90.00 for dinner, split evenly.
    await user.type(screen.getByRole("textbox", { name: "Description" }), "Dinner");
    await user.type(screen.getByRole("textbox", { name: "Amount (USD)" }), "90.00");
    expect(screen.getByRole("combobox", { name: "Paid by" })).toHaveValue(
      (screen.getByRole("option", { name: "Alice" }) as HTMLOptionElement).value,
    );
    expect(screen.getByRole("radio", { name: "Even" })).toBeChecked();
    for (const name of ["Alice", "Bob", "Carol"]) {
      expect(screen.getByRole("checkbox", { name })).toBeChecked();
    }
    await user.click(screen.getByRole("button", { name: "Add expense" }));

    expect(balances()).toEqual([
      ["Alice", "is owed $60.00"],
      ["Bob", "owes $30.00"],
      ["Carol", "owes $30.00"],
    ]);
    expect(plan()).toEqual(["Bob pays Alice $30.00", "Carol pays Alice $30.00"]);
    expect(expenseRows()).toHaveLength(1);
    expect(expenseRows()[0]).toContain("Dinner");
    expect(expenseRows()[0]).toContain("$90.00");
    expect(expenseRows()[0]).toContain("Paid by Alice");
    expect(expenseRows()[0]).toContain("Even split, 3 people");

    // Step 3: Bob pays 60.00 for a taxi, percent mode 50/30/10.
    await user.type(screen.getByRole("textbox", { name: "Description" }), "Taxi");
    await user.type(screen.getByRole("textbox", { name: "Amount (USD)" }), "60.00");
    await user.selectOptions(screen.getByRole("combobox", { name: "Paid by" }), "Bob");
    await user.click(screen.getByRole("radio", { name: "Percent" }));

    // Percent mode shows one row per member and no participant checkboxes.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    for (const name of ["Alice", "Bob", "Carol"]) {
      expect(screen.getByRole("textbox", { name: `Percent for ${name}` })).toBeInTheDocument();
    }

    await user.type(screen.getByRole("textbox", { name: "Percent for Alice" }), "50");
    await user.type(screen.getByRole("textbox", { name: "Percent for Bob" }), "30");
    await user.type(screen.getByRole("textbox", { name: "Percent for Carol" }), "10");

    expect(screen.getByText("Total 90.00%. 10.00% still unassigned.")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Add expense" });
    expect(save).toBeDisabled();
    expect(screen.getByText("Percentages must total 100.00%. 10.00% still unassigned.")).toBeInTheDocument();

    // Clicking the disabled Save adds nothing.
    await user.click(save);
    expect(expenseRows()).toHaveLength(1);
    expect(balances()).toEqual([
      ["Alice", "is owed $60.00"],
      ["Bob", "owes $30.00"],
      ["Carol", "owes $30.00"],
    ]);
    expect(plan()).toEqual(["Bob pays Alice $30.00", "Carol pays Alice $30.00"]);

    // Fill remainder on Carol gives 20.00.
    await user.click(screen.getByRole("button", { name: "Fill remainder for Carol" }));
    expect(screen.getByRole("textbox", { name: "Percent for Carol" })).toHaveValue("20.00");
    expect(screen.getByText("Total 100.00%.")).toBeInTheDocument();
    expect(screen.queryByText(/still unassigned/)).not.toBeInTheDocument();
    expect(screen.queryByText(/over\./)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add expense" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Add expense" }));

    expect(expenseRows()).toHaveLength(2);
    expect(expenseRows()[1]).toContain("Taxi");
    expect(expenseRows()[1]).toContain("$60.00");
    expect(expenseRows()[1]).toContain("Paid by Bob");
    expect(expenseRows()[1]).toContain("Percent split: Alice 50.00%, Bob 30.00%, Carol 20.00%");
    // Shares Alice 30.00, Bob 18.00, Carol 12.00.
    expect(balances()).toEqual([
      ["Alice", "is owed $30.00"],
      ["Bob", "is owed $12.00"],
      ["Carol", "owes $42.00"],
    ]);
    expect(plan()).toEqual(["Carol pays Alice $30.00", "Carol pays Bob $12.00"]);
    // Alice and Bob net against each other, so no transfer between them.
    expect(plan().some((t) => t.includes("Alice pays Bob") || t.includes("Bob pays Alice"))).toBe(false);

    // Step 4: try to remove Alice.
    await user.click(screen.getByRole("button", { name: "Remove Alice" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/^Alice is used by 2 expenses\.$/);
    expect(screen.getByRole("button", { name: "Remove Alice" })).toBeInTheDocument();
    expect(balances().map((r) => r[0])).toEqual(["Alice", "Bob", "Carol"]);

    // Step 5: Mark as paid on "Carol pays Bob $12.00".
    await user.click(screen.getByRole("button", { name: "Mark as paid: Carol pays Bob" }));
    expect(balances()).toEqual([
      ["Alice", "is owed $30.00"],
      ["Bob", "settled"],
      ["Carol", "owes $30.00"],
    ]);
    expect(plan()).toEqual(["Carol pays Alice $30.00"]);
    expect(paymentRows()).toHaveLength(1);
    expect(paymentRows()[0]).toContain("Carol paid Bob");
    expect(paymentRows()[0]).toContain("$12.00");
    // The stale removal refusal went away once the records changed.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Persistence is written for the final state.
    await waitFor(() => {
      const saved = JSON.parse(data.get(STORAGE_KEY) as string);
      expect(saved.members).toHaveLength(3);
      expect(saved.expenses).toHaveLength(2);
      expect(saved.payments).toHaveLength(1);
    });

    // Reload: unmount, then mount again over the SAME storage.
    const snapshot = data.get(STORAGE_KEY) as string;
    first.unmount();
    events.length = 0;
    render(<ExpenseSplitterApp getStorage={getStorage} />);

    expect(await screen.findByRole("heading", { name: "Balances" })).toBeInTheDocument();
    expect(balances()).toEqual([
      ["Alice", "is owed $30.00"],
      ["Bob", "settled"],
      ["Carol", "owes $30.00"],
    ]);
    expect(plan()).toEqual(["Carol pays Alice $30.00"]);
    expect(expenseRows()).toHaveLength(2);
    expect(expenseRows()[0]).toContain("Dinner");
    expect(expenseRows()[1]).toContain("Taxi");
    expect(paymentRows()).toHaveLength(1);
    expect(paymentRows()[0]).toContain("Carol paid Bob");
    const remountedMembers = screen.getByRole("region", { name: "Members" });
    for (const name of ["Alice", "Bob", "Carol"]) {
      expect(within(remountedMembers).getByRole("button", { name: `Remove ${name}` })).toBeInTheDocument();
    }
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // The first render after remount read storage before any write, and wrote nothing different.
    expect(events[0]).toBe("get");
    for (const e of events.filter((x) => x.startsWith("set:"))) {
      expect(e).toBe(`set:${snapshot}`);
    }
    expect(data.get(STORAGE_KEY)).toBe(snapshot);
  });

  it("shows a notice and an empty group when stored JSON is corrupt", async () => {
    const { storage, events } = recordingStorage("{not valid json");
    render(<ExpenseSplitterApp getStorage={() => storage} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(DISCARD_NOTICE);
    expect(events[0]).toBe("get");
    expect(screen.getByText("No members yet.")).toBeInTheDocument();
    expect(screen.getByText("Add at least 2 people to start")).toBeInTheDocument();
    expect(screen.getByText("Balances appear once the group has 2 people.")).toBeInTheDocument();
    expect(screen.getByText("No expenses yet.")).toBeInTheDocument();
    expect(screen.getByText("No payments yet.")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("keeps typed values and adds nothing when Enter submits 90 percent", async () => {
    const user = userEvent.setup();
    const { storage, data } = recordingStorage();
    render(<ExpenseSplitterApp getStorage={() => storage} />);
    await addTrio(user);

    await user.type(screen.getByRole("textbox", { name: "Description" }), "Taxi");
    await user.type(screen.getByRole("textbox", { name: "Amount (USD)" }), "60.00");
    await user.selectOptions(screen.getByRole("combobox", { name: "Paid by" }), "Bob");
    await user.click(screen.getByRole("radio", { name: "Percent" }));
    await user.type(screen.getByRole("textbox", { name: "Percent for Alice" }), "50");
    await user.type(screen.getByRole("textbox", { name: "Percent for Bob" }), "30");
    await user.type(screen.getByRole("textbox", { name: "Percent for Carol" }), "10{Enter}");

    expect(expenseRows()).toHaveLength(0);
    expect(screen.getByText("No expenses yet.")).toBeInTheDocument();
    expect(paymentRows()).toHaveLength(0);
    expect(balances()).toEqual([
      ["Alice", "settled"],
      ["Bob", "settled"],
      ["Carol", "settled"],
    ]);

    // Typed values and the chosen mode are kept.
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("Taxi");
    expect(screen.getByRole("textbox", { name: "Amount (USD)" })).toHaveValue("60.00");
    expect((screen.getByRole("combobox", { name: "Paid by" }) as HTMLSelectElement).selectedOptions[0].text).toBe("Bob");
    expect(screen.getByRole("radio", { name: "Percent" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Percent for Alice" })).toHaveValue("50");
    expect(screen.getByRole("textbox", { name: "Percent for Bob" })).toHaveValue("30");
    expect(screen.getByRole("textbox", { name: "Percent for Carol" })).toHaveValue("10");

    // The same Total and gap sentence is still shown, and Save stays blocked.
    expect(screen.getByText("Total 90.00%. 10.00% still unassigned.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add expense" })).toBeDisabled();

    // Nothing was persisted as an expense.
    await waitFor(() => expect(JSON.parse(data.get(STORAGE_KEY) as string).members).toHaveLength(3));
    expect(JSON.parse(data.get(STORAGE_KEY) as string).expenses).toHaveLength(0);
  });
});
