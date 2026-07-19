# tmux Codex status design

## Goal

Keep the tmux agent map accurate for long-running Codex turns and automatic approval review.

## Behavior

- `PermissionRequest` records `approval-pending`, a neutral state that does not imply the user must review anything.
- The map renders `approval-pending` as active work, while retaining a distinct label for context.
- A `working` state remains working until a later lifecycle event or liveness check replaces it. Elapsed time alone does not make a live Codex pane idle.

## Scope

Only the shared hook writer, map renderer, waiting counter, and status documentation change. Existing manual-approval and Codex configurations need no mode detection or setup changes.

## Verification

Shell regression tests will verify that permission requests produce `approval-pending`, the counter does not call it waiting for user input, and old `working` state remains working.
