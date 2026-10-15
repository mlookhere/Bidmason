# Chat FreePT CI operating policy

Agent: ChatGPT with connected GitHub tools only. Never invoke Claude, Claude Code or custom Claude action. `main` is production; `dev` integration. Branches `work/<issue>-<slug>`; PRs into `dev`. No required gate may count skipped, missing, pending or zero checks as successful. Inspect Actions logs on failure, repair causal failures, and keep the control Issue current. `./scripts/bootstrap --ci` installs only noninteractive dependencies; `./ci/run fast|pr|security` exits nonzero on failed checks. No tokens or live customer data committed.

The reference CI repository includes substantial Claude-exclusive machinery (hooks, workflow reviews, CLI orchestration) deliberately **not** vendored. Its runtime-neutral stage semantics and the supplied GPT-friendly archive inform this project's minimal headless runner. Future import must be reviewed file-by-file; all CI checks must execute on GitHub before certification.
