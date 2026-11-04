// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { STORAGE_KEY, addExpense, addMember, emptyState, serializeState } from "@/domain";
import type { Expense, Group } from "@/domain";
import type { StorageLike } from "@/storage/statePersistence";
import { ExpenseSplitterApp } from "./ExpenseSplitterApp";

type User = ReturnType<typeof userEvent.setup>;

function group(names: string[], expenses: Omit<Expense, "split">[] = []): Group {
  let s = emptyState();
  names.forEach((name, i) => {
    const r = addMember(s, `m${i}`, name);
    if (!r.ok) throw new Error(r.error.message);
    s = r.value;
  });
  for (const e of expenses) {
    const r = addExpense(s, { ...e, split: { kind: "even", participantIds: s.members.map((m) => m.id) } });
    if (!r.ok) throw new Error(r.error.message);
    s = r.value;
  }
  return s;
}

function storageFor(state: Group | null): StorageLike {
  const data = new Map<string, string>();
  if (state) data.set(STORAGE_KEY, serializeState(state));
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function renderApp(state: Group | null) {
  const storage = storageFor(state);
  return render(<ExpenseSplitterApp getStorage={() => storage} />);
}

const trio = () => group(["Alice", "Bob", "Carol"]);
const dinner = (id: string, payerId = "m0"): Omit<Expense, "split"> => ({
  id,
  description: "Dinner",
  amountCents: 9000,
  payerId,
  date: "2026-10-03",
});

async function openPercent(user: User) {
  await user.type(await screen.findByLabelText("Description"), "Taxi");
  await user.type(screen.getByLabelText("Amount (USD)"), "60.00");
  await user.click(screen.getByRole("radio", { name: "Percent" }));
}

function addButton() {
  return screen.getByRole("button", { name: "Add expense" });
}

describe("percent helpers", () => {
  it("Split evenly overwrites garbage and keeps the form in percent mode", async () => {
    const user = userEvent.setup();
    renderApp(trio());
    await openPercent(user);
    await user.type(screen.getByLabelText("Percent for Alice"), "abc");
    expect(addButton()).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Split evenly" }));

    expect(screen.getByLabelText("Percent for Alice")).toHaveValue("33.34");
    expect(screen.getByLabelText("Percent for Bob")).toHaveValue("33.33");
    expect(screen.getByLabelText("Percent for Carol")).toHaveValue("33.33");
    expect(screen.getByText("Total 100.00%.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Percent" })).toBeChecked();
    expect(addButton()).toBeEnabled();
  });

  it("shows the Total sentence in an alert on a direct submit at 50/30/10 and adds nothing", async () => {
    const user = userEvent.setup();
    renderApp(trio());
    await openPercent(user);
    await user.type(screen.getByLabelText("Percent for Alice"), "50");
    await user.type(screen.getByLabelText("Percent for Bob"), "30");
    await user.type(screen.getByLabelText("Percent for Carol"), "10");

    fireEvent.submit(addButton().closest("form") as HTMLFormElement);

    expect(screen.getByRole("alert")).toHaveTextContent("Total 90.00%. 10.00% still unassigned.");
    expect(screen.getByLabelText("Description")).toHaveValue("Taxi");
    expect(screen.getByLabelText("Amount (USD)")).toHaveValue("60.00");
    expect(screen.getByLabelText("Percent for Alice")).toHaveValue("50");
    expect(screen.getByLabelText("Percent for Bob")).toHaveValue("30");
    expect(screen.getByLabelText("Percent for Carol")).toHaveValue("10");
    expect(screen.getByRole("radio", { name: "Percent" })).toBeChecked();
    expect(screen.getByText("No expenses yet.")).toBeInTheDocument();
  });
});

describe("first render", () => {
  it("shows the Loading placeholder and not the empty group before the load effect runs", () => {
    const storage = storageFor(null);
    const html = renderToString(<ExpenseSplitterApp getStorage={() => storage} />);
    expect(html).toContain("Loading");
    expect(html).not.toContain("No members yet.");
  });
});

describe("expense form errors", () => {
  it("shows description and amount errors together and clears each when its field is edited", async () => {
    const user = userEvent.setup();
    renderApp(trio());
    await user.click(await screen.findByRole("button", { name: "Add expense" }));

    expect(screen.getByText("Enter a description.")).toBeInTheDocument();
    expect(screen.getByText("Enter an amount.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Amount (USD)"), "5");
    expect(screen.queryByText("Enter an amount.")).not.toBeInTheDocument();
    expect(screen.getByText("Enter a description.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Description"), "T");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables Add expense with a visible reason when no participant is checked, and clears the form error on toggling", async () => {
    const user = userEvent.setup();
    renderApp(trio());
    await user.type(await screen.findByLabelText("Description"), "Lunch");
    await user.type(screen.getByLabelText("Amount (USD)"), "12");
    for (const name of ["Alice", "Bob", "Carol"]) await user.click(screen.getByRole("checkbox", { name }));

    expect(addButton()).toBeDisabled();
    expect(screen.getByText("Choose at least one person to split between.")).toBeInTheDocument();

    // A direct submit still reaches the domain, which refuses and explains.
    fireEvent.submit(addButton().closest("form") as HTMLFormElement);
    expect(screen.getByRole("alert")).toHaveTextContent("Choose at least one participant.");

    await user.click(screen.getByRole("checkbox", { name: "Bob" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Choose at least one person to split between.")).not.toBeInTheDocument();
    expect(addButton()).toBeEnabled();
  });

  it("returns to Even mode after a successful percent save", async () => {
    const user = userEvent.setup();
    renderApp(trio());
    await openPercent(user);
    await user.click(screen.getByRole("button", { name: "Split evenly" }));
    await user.click(addButton());

    expect(screen.getByRole("radio", { name: "Even" })).toBeChecked();
    expect(screen.queryByText(/Total 0\.00%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/still unassigned/)).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Alice" })).toBeChecked();
    expect(addButton()).toBeEnabled();
    expect(screen.getByLabelText("Description")).toHaveValue("");
  });
});

describe("one-member summary", () => {
  it("keeps showing balances once a record exists and the group drops to one member", async () => {
    const user = userEvent.setup();
    renderApp(trio());
    await user.type(await screen.findByLabelText("Description"), "Snacks");
    await user.type(screen.getByLabelText("Amount (USD)"), "10");
    await user.click(screen.getByRole("checkbox", { name: "Bob" }));
    await user.click(screen.getByRole("checkbox", { name: "Carol" }));
    await user.click(addButton());

    // Alice paid only for Alice, so Bob and Carol are unreferenced.
    await user.click(screen.getByRole("button", { name: "Remove Bob" }));
    await user.click(screen.getByRole("button", { name: "Remove Carol" }));

    expect(screen.queryByText("Balances appear once the group has 2 people.")).not.toBeInTheDocument();
    const balances = screen.getByRole("heading", { name: "Balances" }).nextElementSibling as HTMLElement;
    expect(within(balances).getAllByRole("listitem")).toHaveLength(1);
    expect(balances).toHaveTextContent("Alicesettled");
    expect(screen.getByText("All settled up")).toBeInTheDocument();
    expect(screen.getByText("Add at least 2 people to start")).toBeInTheDocument();
  });

  it("still shows the gate message for an empty one-member group", async () => {
    renderApp(group(["Alice"]));
    expect(await screen.findByText("Balances appear once the group has 2 people.")).toBeInTheDocument();
  });
});

describe("Mark as paid", () => {
  it("records one payment when a second click of a double-click lands on the next transfer", async () => {
    const user = userEvent.setup();
    renderApp(group(["Alice", "Bob", "Carol"], [dinner("e1")]));
    const first = await screen.findByRole("button", { name: "Mark as paid: Bob pays Alice" });
    const second = screen.getByRole("button", { name: "Mark as paid: Carol pays Alice" });

    await user.click(first);
    fireEvent.click(second, { detail: 2 });

    const payments = screen.getByRole("heading", { name: "Payments" }).nextElementSibling as HTMLElement;
    expect(within(payments).getAllByRole("listitem")).toHaveLength(1);
    expect(payments).toHaveTextContent("Bob paid Alice");
    expect(screen.getByRole("button", { name: "Mark as paid: Carol pays Alice" })).toBeInTheDocument();
  });

  it("announces the payment in a persistent status region and moves focus to the section heading", async () => {
    const user = userEvent.setup();
    const { container } = renderApp(group(["Alice", "Bob", "Carol"], [dinner("e1")]));
    const region = container.querySelector(".visually-hidden") as HTMLElement;
    expect(region).toHaveAttribute("role", "status");
    expect(region).toBeEmptyDOMElement();

    await user.click(await screen.findByRole("button", { name: "Mark as paid: Bob pays Alice" }));

    expect(region).toHaveTextContent("Payment recorded: Bob paid Alice $30.00");
    expect(screen.getByRole("heading", { name: "Who owes whom" })).toHaveFocus();
  });

  it("announces deletes and moves focus to the records heading", async () => {
    const user = userEvent.setup();
    const { container } = renderApp(group(["Alice", "Bob"], [dinner("e1")]));
    const region = container.querySelector(".visually-hidden") as HTMLElement;

    await user.click(await screen.findByRole("button", { name: "Mark as paid: Bob pays Alice" }));
    await user.click(screen.getByRole("button", { name: /^Delete payment: Bob paid Alice/ }));
    expect(region).toHaveTextContent("Payment deleted");
    expect(screen.getByRole("heading", { name: "Expenses and payments" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: /^Delete expense: Dinner/ }));
    expect(region).toHaveTextContent("Expense deleted: Dinner");
    expect(screen.getByRole("heading", { name: "Expenses and payments" })).toHaveFocus();
  });
});

describe("delete button names", () => {
  it("are unique even for identical expenses", async () => {
    const state = group(
      ["Alice", "Bob"],
      [
        { id: "e1", description: "Taxi", amountCents: 6000, payerId: "m0", date: "2026-10-03" },
        { id: "e2", description: "Taxi", amountCents: 6000, payerId: "m0", date: "2026-10-03" },
        { id: "e3", description: "Lunch", amountCents: 1250, payerId: "m1", date: "2026-10-04" },
      ],
    );
    renderApp(state);
    await screen.findByRole("heading", { name: "Expenses" });

    const names = screen
      .getAllByRole("button", { name: /^Delete expense/ })
      .map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual([
      "Delete expense: Taxi, $60.00, 2026-10-03 (1 of 2)",
      "Delete expense: Taxi, $60.00, 2026-10-03 (2 of 2)",
      "Delete expense: Lunch, $12.50, 2026-10-04",
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("name each payment with its amount", async () => {
    const user = userEvent.setup();
    renderApp(group(["Alice", "Bob", "Carol"], [dinner("e1")]));
    await user.click(await screen.findByRole("button", { name: "Mark as paid: Bob pays Alice" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete payment: Bob paid Alice, $30.00" })).toBeInTheDocument(),
    );
  });
});
