// Native ESM template for the load-failure checks: it counts each evaluation, then throws at top level
// unless globalThis.__reactAdapterEsmThrows is false. Test-only flags; no imports.
globalThis.__reactAdapterEsmThrowsEvaluations =
  (globalThis.__reactAdapterEsmThrowsEvaluations ?? 0) + 1;

if (globalThis.__reactAdapterEsmThrows !== false) {
  throw new Error("esm-throws: top-level failure");
}

export default function Template(props) {
  return "esm-throws:" + props.body;
}
