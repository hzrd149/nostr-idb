import React, { useEffect } from "react";
import { useDB } from "../lib/db.ts";
import { ENGINES, isRawEngine, type Engine } from "../lib/engines.ts";
import { Field } from "./ui.tsx";

/** Dropdown for picking the query engine */
export function EngineSelect({
  value,
  onChange,
}: {
  value: Engine;
  onChange: (e: Engine) => void;
}) {
  const { worker } = useDB();
  // raw engines need the IndexedDB handle, which stays inside a worker
  useEffect(() => {
    if (worker && isRawEngine(value)) onChange("query");
  }, [worker, value, onChange]);

  return (
    <Field label="engine">
      <select
        className="grow mono"
        value={value}
        onChange={(e) => onChange(e.target.value as Engine)}
      >
        {ENGINES.map((e) => (
          <option key={e.value} value={e.value} disabled={worker && e.raw}>
            {e.title}
            {worker && e.raw ? " — main thread only" : ""}
          </option>
        ))}
      </select>
    </Field>
  );
}
