"use client";

import { useId } from "react";
import { fillRemainderText } from "@/domain";
import type { Member, PercentFormEvaluation, PercentRowInput } from "@/domain";

interface Props {
  members: readonly Member[];
  rows: readonly PercentRowInput[];
  evaluation: PercentFormEvaluation;
  onChange: (memberId: string, text: string) => void;
  onSplitEvenly: () => void;
}

export function PercentFields({ members, rows, evaluation, onChange, onSplitEvenly }: Props) {
  const baseId = useId();
  return (
    <fieldset className="percent-fields">
      <legend>Percent for each person</legend>
      <ul className="plain-list">
        {members.map((member, index) => {
          const row = rows[index];
          const result = evaluation.rows[index];
          const inputId = `${baseId}-${member.id}`;
          const errorId = `${inputId}-error`;
          // `fillRemainderText` returns `null` when any other row is invalid or the remainder is negative,
          // so checking `fillText === null` also determines whether the button should be disabled
          // without calling `canFillRemainder(rows, member.id)` to re-parse all rows a second time.
          const fillText = fillRemainderText(rows, member.id);
          return (
            <li key={member.id} className="percent-row">
              <div className="percent-line">
                <label htmlFor={inputId}>{`Percent for ${member.name}`}</label>
                <div className="percent-input">
                  <input
                    id={inputId}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={row.text}
                    aria-invalid={result.error ? true : undefined}
                    aria-describedby={result.error ? errorId : undefined}
                    onChange={(event) => onChange(member.id, event.target.value)}
                  />
                  <span aria-hidden="true">%</span>
                </div>
                <button
                  type="button"
                  className="secondary small"
                  disabled={fillText === null}
                  aria-label={`Fill remainder for ${member.name}`}
                  title={
                    fillText === null
                      ? "Not available until the other fields are valid"
                      : `Set to ${fillText}`
                  }
                  onClick={() => {
                    if (fillText !== null) onChange(member.id, fillText);
                  }}
                >
                  Fill remainder
                </button>
              </div>
              {result.error ? (
                <p id={errorId} role="alert" className="error">
                  {`${member.name}: ${result.error.message}`}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="percent-footer">
        <button type="button" className="secondary" onClick={onSplitEvenly}>
          Split evenly
        </button>
        <p role="status" className={`total-line total-${evaluation.status}`}>
          {evaluation.totalLine}
        </p>
      </div>
    </fieldset>
  );
}
