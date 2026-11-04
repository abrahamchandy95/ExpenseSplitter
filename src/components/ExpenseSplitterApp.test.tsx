// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { STORAGE_KEY, addMember, emptyState, serializeState } from "@/domain";
import type { Group } from "@/domain";
import type { StorageLike } from "@/storage/statePersistence";
import { ExpenseSplitterApp } from "./ExpenseSplitterApp";

function trio(): Group {
  let s = emptyState();
  for (const [id, name] of [["a", "Alice"], ["b", "Bob"], ["c", "Carol"]]) {
    const r = addMember(s, id, name);
    if (!r.ok) throw new Error(r.error.message);
    s = r.value;
  }
  return s;
}

function seededStorage(group: Group | null) {
  const data = new Map<string, string>();
  if (group) data.set(STORAGE_KEY, serializeState(group));
  const storage: StorageLike = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
  return { storage, data };
}

async function openPercentForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Description"), "Taxi");
  await user.type(screen.getByLabelText("Amount (USD)"), "60.00");
  await user.selectOptions(screen.getByLabelText("Paid by"), "Bob");
  await user.click(screen.getByLabelText("Percent"));
}

describe("expense splitter app", () => {
  it("shows the empty state until there are 2 members", async () => {
    const { storage } = seededStorage(null);
    render(<ExpenseSplitterApp getStorage={() => storage} />);
    expect(await screen.findByText("Add at least 2 people to start")).toBeInTheDocument();
    expect(screen.queryByLabelText("Description")).not.toBeInTheDocument();
  });

  it("drives the percent split through 50/30/10, fill remainder, and save", async () => {
    const user = userEvent.setup();
    const { storage, data } = seededStorage(trio());
    render(<ExpenseSplitterApp getStorage={() => storage} />);
    await openPercentForm(user);

    await user.type(screen.getByLabelText("Percent for Alice"), "50");
    await user.type(screen.getByLabelText("Percent for Bob"), "30");
    await user.type(screen.getByLabelText("Percent for Carol"), "10");

    const totalLine = screen.getByText("Total 90.00%. 10.00% still unassigned.");
    expect(totalLine).toHaveAttribute("role", "status");
    const save = screen.getByRole("button", { name: "Add expense" });
    expect(save).toBeDisabled();
    expect(screen.getByText("Percentages must total 100.00%. 10.00% still unassigned.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Fill remainder for Carol" }));
    expect(screen.getByLabelText("Percent for Carol")).toHaveValue("20.00");
    expect(screen.getByText("Total 100.00%.")).toBeInTheDocument();
    expect(save).toBeEnabled();

    await user.click(save);

    const expenses = screen.getByRole("heading", { name: "Expenses" }).nextElementSibling as HTMLElement;
    expect(within(expenses).getByText(/Taxi/)).toBeInTheDocument();
    expect(within(expenses).getByText(/Alice 50\.00%, Bob 30\.00%, Carol 20\.00%/)).toBeInTheDocument();
    // Shares are Alice 30.00, Bob 18.00, Carol 12.00 of $60.00, and Bob paid.
    expect(screen.getByText("Alice pays Bob $30.00")).toBeInTheDocument();
    expect(screen.getByText("Carol pays Bob $12.00")).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(data.get(STORAGE_KEY) as string).expenses).toHaveLength(1));
  });

  it("never adds an invalid percent expense when Enter is pressed", async () => {
    const user = userEvent.setup();
    const { storage } = seededStorage(trio());
    render(<ExpenseSplitterApp getStorage={() => storage} />);
    await openPercentForm(user);

    await user.type(screen.getByLabelText("Percent for Alice"), "50");
    await user.type(screen.getByLabelText("Percent for Bob"), "30{Enter}");

    expect(screen.getByText("No expenses yet.")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toHaveValue("Taxi");
    expect(screen.getByLabelText("Percent for Alice")).toHaveValue("50");
    expect(screen.getByLabelText("Percent for Bob")).toHaveValue("30");
  });

  it("refuses to remove a member that an expense uses and says why", async () => {
    const user = userEvent.setup();
    const { storage } = seededStorage(trio());
    render(<ExpenseSplitterApp getStorage={() => storage} />);
    await user.type(await screen.findByLabelText("Description"), "Dinner");
    await user.type(screen.getByLabelText("Amount (USD)"), "90");
    await user.click(screen.getByRole("button", { name: "Add expense" }));

    await user.click(screen.getByRole("button", { name: "Remove Alice" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Alice is used by 1 expense.");
    expect(screen.getByRole("button", { name: "Remove Alice" })).toBeInTheDocument();
  });

  it("shows a notice and starts empty when stored data is corrupt", async () => {
    const data = new Map<string, string>([[STORAGE_KEY, "{broken"]]);
    const storage: StorageLike = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
    };
    render(<ExpenseSplitterApp getStorage={() => storage} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("discarded");
    expect(screen.getByText("Add at least 2 people to start")).toBeInTheDocument();
  });
});
