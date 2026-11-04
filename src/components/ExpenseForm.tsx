"use client";

import { memo, useId, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  evaluatePercentRows,
  parseAmountCents,
  rowsToPercentSplit,
  splitEvenlyTexts,
} from "@/domain";
import type { DomainError, Expense, Group, Member, PercentRowInput, Result, Split } from "@/domain";
import { createId } from "@/state/createId";
import { PercentFields } from "./PercentFields";

interface Props {
  members: readonly Member[];
  onAddExpense: (expense: Expense) => Result<Group, DomainError>;
}

type Mode = "even" | "percent";

interface FieldErrors {
  description?: string;
  amount?: string;
  date?: string;
  form?: string;
}

function todayIso(): string {
  const now = new Date();
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const ExpenseForm = memo(function ExpenseForm({ members, onAddExpense }: Props) {
  const baseId = useId();
  const descriptionRef = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState("");
  const [amountText, setAmountText] = useState("");
  const [payerChoice, setPayerChoice] = useState("");
  const [date, setDate] = useState(todayIso);
  const [mode, setMode] = useState<Mode>("even");
  // Tracking who is excluded (not who is included) makes new members default to included.
  const [excluded, setExcluded] = useState<string[]>([]);
  const [percentTexts, setPercentTexts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});

  const payerId = members.some((member) => member.id === payerChoice)
    ? payerChoice
    : (members[0]?.id ?? "");

  // Memoize `rows` and `evaluation` so typing into Description, Amount, or Date
  // does not re-parse and re-evaluate all percent rows on every keystroke.
  const rows: PercentRowInput[] = useMemo(
    () => members.map((member) => ({ memberId: member.id, text: percentTexts[member.id] ?? "" })),
    [members, percentTexts],
  );
  const evaluation = useMemo(() => evaluatePercentRows(rows, members), [rows, members]);

  const noParticipants =
    mode === "even" && members.every((member) => excluded.includes(member.id));
  const evenReason = noParticipants ? "Choose at least one person to split between." : null;
  const saveReason = mode === "percent" ? evaluation.saveDisabledReason : evenReason;
  const saveBlocked = saveReason !== null;

  const ids = {
    description: `${baseId}-description`,
    amount: `${baseId}-amount`,
    payer: `${baseId}-payer`,
    date: `${baseId}-date`,
  };

  /** Drops the listed errors; keeps the same object when none of them is set. */
  function clearErrors(...keys: (keyof FieldErrors)[]) {
    setErrors((prev) => {
      if (keys.every((fieldKey) => prev[fieldKey] === undefined)) return prev;
      const next = { ...prev };
      for (const fieldKey of keys) delete next[fieldKey];
      return next;
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    // Both fields are checked before returning so one error never hides the other.
    const amount = parseAmountCents(amountText);
    const fieldErrors: FieldErrors = {};
    if (description.trim() === "") fieldErrors.description = "Enter a description.";
    if (!amount.ok) fieldErrors.amount = amount.error.message;
    if (!amount.ok || fieldErrors.description) {
      setErrors(fieldErrors);
      return;
    }

    let split: Split;
    if (mode === "even") {
      split = {
        kind: "even",
        participantIds: members
          .filter((member) => !excluded.includes(member.id))
          .map((member) => member.id),
      };
    } else {
      const built = rowsToPercentSplit(rows);
      if (!built.ok) {
        setErrors({ form: evaluation.saveDisabledReason ?? "Fix the invalid percent fields." });
        return;
      }
      split = built.value;
    }

    const result = onAddExpense({
      id: createId(),
      description,
      amountCents: amount.value,
      payerId,
      date,
      split,
    });

    if (!result.ok) {
      const { code, message } = result.error;
      if (code === "INVALID_DESCRIPTION") setErrors({ description: message });
      else if (code === "INVALID_DATE") setErrors({ date: message });
      else setErrors({ form: message });
      return;
    }

    setErrors({});
    setDescription("");
    setAmountText("");
    setMode("even");
    setExcluded([]);
    setPercentTexts({});
    descriptionRef.current?.focus();
  }

  function toggleParticipant(memberId: string, checked: boolean) {
    clearErrors("form");
    setExcluded((prev) => (checked ? prev.filter((id) => id !== memberId) : [...prev, memberId]));
  }

  function splitEvenly() {
    const texts = splitEvenlyTexts(members.length);
    const next: Record<string, string> = {};
    members.forEach((member, index) => {
      next[member.id] = texts[index];
    });
    setPercentTexts(next);
    clearErrors("form");
  }

  function changeMode(next: Mode) {
    setMode(next);
    clearErrors("form");
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="stack">
      <div className="field">
        <label htmlFor={ids.description}>Description</label>
        <input
          ref={descriptionRef}
          id={ids.description}
          type="text"
          value={description}
          autoComplete="off"
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={errors.description ? `${ids.description}-error` : undefined}
          onChange={(event) => {
            setDescription(event.target.value);
            clearErrors("description");
          }}
        />
        {errors.description ? (
          <p id={`${ids.description}-error`} role="alert" className="error">
            {errors.description}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor={ids.amount}>Amount (USD)</label>
        <input
          id={ids.amount}
          type="text"
          inputMode="decimal"
          placeholder="12.50"
          value={amountText}
          autoComplete="off"
          aria-invalid={errors.amount ? true : undefined}
          aria-describedby={errors.amount ? `${ids.amount}-error` : `${ids.amount}-hint`}
          onChange={(event) => {
            setAmountText(event.target.value);
            clearErrors("amount");
          }}
        />
        <p id={`${ids.amount}-hint`} className="hint">
          Digits with up to 2 decimals, no dollar sign.
        </p>
        {errors.amount ? (
          <p id={`${ids.amount}-error`} role="alert" className="error">
            {errors.amount}
          </p>
        ) : null}
      </div>

      <div className="two-up">
        <div className="field">
          <label htmlFor={ids.payer}>Paid by</label>
          <select
            id={ids.payer}
            value={payerId}
            onChange={(event) => {
              setPayerChoice(event.target.value);
              clearErrors("form");
            }}
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.date}>Date</label>
          <input
            id={ids.date}
            type="date"
            value={date}
            aria-invalid={errors.date ? true : undefined}
            aria-describedby={errors.date ? `${ids.date}-error` : undefined}
            onChange={(event) => {
              setDate(event.target.value);
              clearErrors("date");
            }}
          />
          {errors.date ? (
            <p id={`${ids.date}-error`} role="alert" className="error">
              {errors.date}
            </p>
          ) : null}
        </div>
      </div>

      <fieldset className="mode-toggle">
        <legend>Split type</legend>
        <label className={mode === "even" ? "chip selected" : "chip"}>
          <input
            type="radio"
            name={`${baseId}-mode`}
            value="even"
            checked={mode === "even"}
            onChange={() => changeMode("even")}
          />
          Even
        </label>
        <label className={mode === "percent" ? "chip selected" : "chip"}>
          <input
            type="radio"
            name={`${baseId}-mode`}
            value="percent"
            checked={mode === "percent"}
            onChange={() => changeMode("percent")}
          />
          Percent
        </label>
      </fieldset>

      {mode === "even" ? (
        <fieldset className="participants">
          <legend>Split between</legend>
          <ul className="plain-list checks">
            {members.map((member) => (
              <li key={member.id}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!excluded.includes(member.id)}
                    onChange={(event) => toggleParticipant(member.id, event.target.checked)}
                  />
                  {member.name}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : (
        <PercentFields
          members={members}
          rows={rows}
          evaluation={evaluation}
          onChange={(memberId, text) => {
            setPercentTexts((prev) => ({ ...prev, [memberId]: text }));
            clearErrors("form");
          }}
          onSplitEvenly={splitEvenly}
        />
      )}

      {errors.form ? (
        <p role="alert" className="error">
          {errors.form}
        </p>
      ) : null}

      <div className="submit-row">
        <button
          type="submit"
          className="primary"
          disabled={saveBlocked}
          aria-describedby={saveBlocked ? `${baseId}-save-reason` : undefined}
        >
          Add expense
        </button>
        {saveBlocked ? (
          <p id={`${baseId}-save-reason`} className="save-reason">
            {saveReason}
          </p>
        ) : null}
      </div>
    </form>
  );
});
