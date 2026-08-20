# Transfer UI observer hardening

A production tablet/browser freeze exposed excessive document-wide DOM observation on the Transfers view. Open Market, external-market search, free-agent offer projection and Transfer History each watched `document.documentElement` with subtree MutationObservers. As the portal mounted and those helpers inserted or rewrote their own DOM, every helper was repeatedly woken by unrelated page mutations.

This patch removes those document-wide observers from the four transfer helpers. Reconciliation now happens from the portal's existing lifecycle events (`tbg:portal-rendered`, `tbg:view-changed`) plus the relevant direct user interactions. The helpers schedule one deferred reconciliation after those events rather than reacting to every DOM mutation.

The patch also avoids avoidable DOM rewrites in the external-search copy helper and free-agent offer panel.

No database migration is required.
