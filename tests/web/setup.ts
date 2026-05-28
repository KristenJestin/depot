import "@testing-library/jest-dom/vitest";

// PRD 0012 / T1 — bypass the `--user-confirmed` gate on lifecycle CLI commands
// so existing tests do not have to fabricate an approval quote per call. Tests
// that exercise the gate itself unset this env var locally before running.
process.env["DEPOT_BYPASS_USER_CONFIRMATION"] = "1";
