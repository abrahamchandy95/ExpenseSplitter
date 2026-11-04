"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { DomainError, Group, Result } from "@/domain";
import { createStatePersistence } from "@/storage/statePersistence";
import type { StorageLike } from "@/storage/statePersistence";
import { applyGroupAction, initialState, reducer } from "./reducer";
import type { GroupAction, State } from "./reducer";

export interface ExpenseSplitter {
  state: State;
  /** Runs one domain transition. Returns the outcome so a form can keep its values on error. */
  applyAction(action: GroupAction): Result<Group, DomainError>;
  dismissNotice(): void;
}

export function useExpenseSplitter(getStorage?: () => StorageLike | null): ExpenseSplitter {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [storageAdapter] = useState(() => createStatePersistence(getStorage));

  // Keep a ref to the latest group state so `applyAction` can read it without depending
  // on `[state.group]` in `useCallback`. This keeps `applyAction` referentially stable across
  // renders so child components receiving `applyAction` don't unnecessarily re-render.
  const latestGroupRef = useRef(state.group);
  latestGroupRef.current = state.group;

  // Read after mount only: the server render and first client render are identical.
  useEffect(() => {
    const outcome = storageAdapter.load();
    latestGroupRef.current = outcome.state;
    dispatch({ type: "loaded", group: outcome.state, notice: outcome.notice });
  }, [storageAdapter]);

  // Guarded twice: by status here, and by the adapter's own loaded flag.
  useEffect(() => {
    if (state.status === "ready") storageAdapter.save(state.group);
  }, [storageAdapter, state.status, state.group]);

  const applyAction = useCallback((action: GroupAction) => {
    const result = applyGroupAction(latestGroupRef.current, action);
    if (result.ok) {
      // Update the ref immediately so back-to-back synchronous calls see the latest state,
      // and dispatch `groupUpdated` with the already-validated state so the reducer doesn't
      // re-run `applyGroupAction` a second time.
      latestGroupRef.current = result.value;
      dispatch({ type: "groupUpdated", group: result.value });
    }
    return result;
  }, []);

  const dismissNotice = useCallback(() => dispatch({ type: "dismissNotice" }), []);

  return { state, applyAction, dismissNotice };
}
