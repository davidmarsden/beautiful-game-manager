# Alpha retrospective evidence handling policy

**Status:** Required for Alpha 1 post-mortem and future TBG playtests.

## Scope and default

Manager retrospective emails, messages, survey submissions, and identifiable behavioural records are **private source evidence**, even when sent voluntarily. The public TBG repository is not an appropriate storage location for raw responses or per-person coded records. A filename or heading saying "internal" does not make public Git history private.

## Rules

1. **Keep original responses outside public Git.** By default, do not commit names, addresses, screenshots of private conversations, verbatim replies, individual answer sheets, or linkable per-respondent summaries. The narrow, documented consent exception in Rule 4 permits only the specifically approved quotation and/or attribution, never wholesale publication of the original response. Store source material only in an access-controlled private location with an appropriate retention and deletion process.
2. **Publish thematic synthesis, not respondent dossiers.** Group recurring findings across participants. Avoid respondent-numbered files, unusual quotations, precise combinations of preferences, device/platform complaints, and other details that could identify a participant within a small cohort.
3. **Check linkage and history before committing.** Review file content, filenames, commit messages, branch names, PR titles/descriptions, comments, links, and the full commit range for direct and indirect identifiers. Do not link public synthesis to private correspondence or to prior PRs containing it.
4. **Attribute only with explicit, documented permission.** Permission to provide feedback is not permission to publish identifiable comments. As a narrow exception to Rules 1 and 6 and the checklist's default prohibitions, an exact quotation or attribution may be published only when the respondent has explicitly approved that specific wording, identity disclosure, and public repository publication. Record consent privately, including the exact material and attribution approved. Consent to quote one passage does not imply blanket permission. All other source material remains private.
5. **Distinguish evidence from interpretation.** Public synthesis should identify thematic observations, analysis/hypotheses, limitations, and conflicting evidence. Do not present a single manager's experience as representative of all testers.
6. **Use a privacy gate before opening a PR.** Prefer drafting privately, checking the complete proposed Git diff and metadata, and then creating a clean branch from main with only publication-safe content. Never rely on a follow-up deletion commit to remove private material from history.
7. **Handle mistakes without amplifying them.** Stop publication/merging; restrict access where possible; avoid repeating sensitive details in issue comments or replacement PR descriptions; assess whether old refs/objects remain accessible and seek hosting support when necessary. Preserve a minimal private incident note, not an identifying public incident report.

## Public reporting threshold

Until multiple responses have been received and compared, keep detailed individual analysis private. Public outputs should report broad, non-identifying themes and clearly acknowledge the sample size and possible response bias. Small cohorts demand extra care: removing a name alone is not anonymisation.

## Reboot evidence workflow

Private intake → private coding of each response → cross-response thematic analysis → disclosure/linkage review → publication-safe synthesis → public PR.

The public synthesis may inform interface priorities, retention hypotheses, match engagement, transfer realism, reliability, and other design decisions, but must never expose the original respondent by inference.

## Review checklist

Before committing, confirm:

- [ ] No raw or verbatim private testimony, direct identifiers, or uniquely identifying detail bundles **except exact quotations/attribution covered by Rule 4's documented, passage-specific public-publication consent**
- [ ] No per-person filenames, IDs, dates, or metadata that permit linkage
- [ ] No links to private correspondence, sensitive PRs, or archived material
- [ ] Evidence, inference, and limitations clearly separated
- [ ] Public branch and commit history contain only publication-safe material
- [ ] Explicit consent recorded privately for any approved attribution

If any item is uncertain, **do not commit**. Generalise further or retain the analysis privately.
