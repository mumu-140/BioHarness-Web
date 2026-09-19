# BioHarness-Web Agent Rules

- V1 is strictly read-only toward BioHarness.
- Never add direct INSERT/UPDATE/DELETE/TRUNCATE/DDL against BioHarness tables.
- Browser code never receives database credentials.
- Keep graph nodes stage-level; raw RunEvents belong in drill-down detail.
- Do not fabricate chain-of-thought or memory usage that BioHarness did not persist.
- Use TDD for behavior changes and run builds/tests only on the remote target environment.
- Deployment writes on fwq10ys stay under /home/yangs/software/BioHarness-Web/.
