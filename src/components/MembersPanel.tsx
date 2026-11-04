"use client";

import { memo, useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import type { DomainError, Group, Result } from "@/domain";
import { createId } from "@/state/createId";
import type { GroupAction } from "@/state/reducer";

interface Props {
  group: Group;
  applyAction: (action: GroupAction) => Result<Group, DomainError>;
}

export const MembersPanel = memo(function MembersPanel({ group, applyAction }: Props) {
  const nameInputId = useId();
  const addErrorId = useId();
  const [name, setName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // A refusal counts records, so it goes stale once any expense or payment changes.
  // Passing a updater function `(prev) => (prev === null ? prev : null)` avoids
  // scheduling any state update when `removeError` is already `null`.
  useEffect(() => {
    setRemoveError((prev) => (prev === null ? prev : null));
  }, [group.expenses, group.payments]);

  function handleAdd(event: FormEvent) {
    event.preventDefault();
    setRemoveError(null);
    const result = applyAction({ type: "addMember", id: createId(), name });
    if (result.ok) {
      setName("");
      setAddError(null);
    } else {
      setAddError(result.error.message);
    }
  }

  function handleRemove(memberId: string) {
    setAddError(null);
    const result = applyAction({ type: "removeMember", memberId });
    setRemoveError(result.ok ? null : result.error.message);
  }

  return (
    <section className="card" aria-labelledby="members-heading">
      <h2 id="members-heading">Members</h2>
      <form onSubmit={handleAdd} noValidate className="inline-form">
        <div className="field grow">
          <label htmlFor={nameInputId}>Member name</label>
          <input
            id={nameInputId}
            type="text"
            value={name}
            autoComplete="off"
            aria-invalid={addError ? true : undefined}
            aria-describedby={addError ? addErrorId : undefined}
            onChange={(event) => {
              setName(event.target.value);
              if (addError) setAddError(null);
            }}
          />
        </div>
        <button type="submit" className="primary">
          Add member
        </button>
      </form>
      {addError ? (
        <p id={addErrorId} role="alert" className="error">
          {addError}
        </p>
      ) : null}

      {group.members.length === 0 ? (
        <p className="muted">No members yet.</p>
      ) : (
        <ul className="plain-list">
          {group.members.map((member) => (
            <li key={member.id} className="row">
              <span className="strong">{member.name}</span>
              <button
                type="button"
                className="secondary small"
                aria-label={`Remove ${member.name}`}
                onClick={() => handleRemove(member.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {removeError ? (
        <p role="alert" className="error">
          {removeError}
        </p>
      ) : null}
    </section>
  );
});
