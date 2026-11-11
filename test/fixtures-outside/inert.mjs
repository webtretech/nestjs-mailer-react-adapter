// An existing, harmless file that lies OUTSIDE test/fixtures, the template root the build verifier
// uses. The verifier's escape probe names it, so a regression in confinement would load this file
// (it only returns null) instead of re-running the verifier script itself. It is not a test
// fixture and is never shipped: package.json `files` lists only dist.
export default function inert() {
  return null;
}
