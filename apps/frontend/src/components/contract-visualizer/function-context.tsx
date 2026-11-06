import type { FunctionContext } from "../../../../../packages/snapshot-artifacts/src/index";

import { getFunctionTooltip } from "./graph";

export function FunctionDocumentation({ value }: { value?: FunctionContext }) {
  if (!value) return null;
  const exact = value.source?.match === "exact";
  return (
    <div className="mt-1 text-muted">
      {exact && value.notice && <p>{value.notice}</p>}
      <details className="mt-1">
        <summary className="cursor-pointer">Function documentation</summary>
        <code className="break-all">{value.signature}</code>
        {exact && value.details && (
          <p className="mt-1 whitespace-pre-line">{value.details}</p>
        )}
        {(
          [
            ["Parameters", value.params],
            ["Returns", value.returns],
          ] as const
        ).map(
          ([label, entries]) =>
            exact &&
            entries && (
              <dl key={label} className="mt-1">
                <dt className="font-medium">{label}</dt>
                {Object.entries(entries).map(([name, text]) => (
                  <dd key={name} className="break-words">
                    {name}: {text}
                  </dd>
                ))}
              </dl>
            )
        )}
        {value.source?.match === "code" && (
          <p className="mt-1">
            Executable code verified; original NatSpec unavailable.
          </p>
        )}
        {value.source && (
          <a
            className="mt-1 inline-block text-link hover:underline"
            href={value.source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`Verified runtime code ${value.source.codeHash}`}
          >
            Compiler verification record
          </a>
        )}
      </details>
    </div>
  );
}

export function ConnectionLabel({
  label,
  functions,
}: {
  label: string;
  functions: FunctionContext[];
}) {
  return (
    <tspan>
      <title>{getFunctionTooltip(functions)}</title>
      {label}
    </tspan>
  );
}
