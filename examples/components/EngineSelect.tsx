import React from "react";
import { ENGINES, type Engine } from "../lib/engines.ts";
import { Field } from "./ui.tsx";

/** Dropdown for picking the query engine */
export function EngineSelect({
  value,
  onChange,
}: {
  value: Engine;
  onChange: (e: Engine) => void;
}) {
  return (
    <Field label="engine">
      <select
        className="grow mono"
        value={value}
        onChange={(e) => onChange(e.target.value as Engine)}
      >
        {ENGINES.map((e) => (
          <option key={e.value} value={e.value}>
            {e.title}
          </option>
        ))}
      </select>
    </Field>
  );
}
