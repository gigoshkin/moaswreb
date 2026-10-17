# Auto-merge for andro's PRs (gigoshkin, 2026-10-17)

**For andro:** George decided (17 Oct) that your PRs merge themselves once he approves.

- Right after `gh pr create`, run `gh pr merge --auto --squash`. When George approves, GitHub merges it; you don't need to come back to press merge.
- Every PR still needs George's approval. New pushes after approval still need a fresh approval.
- For PRs that are already open (#3, #4), run `gh pr merge <number> --auto --squash` once.
- If the command says auto-merge isn't allowed, the repo setting isn't on yet. Tell George and merge by hand after approval, as before.

The rule is updated in `CLAUDE.md` (Protocol, step 2).
