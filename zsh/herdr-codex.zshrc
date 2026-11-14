# In Herdr, run Codex without its shared daemon. With the daemon, Codex runs its hooks and
# shell commands outside the Herdr terminal, so they can't see HC_TERMINAL_ID: hc can't
# nest its children and the kit's herdr-delegate hook can't route subagents to panes
# (`hc --skill`: "Codex must run with --no-daemon"). Covers typed `codex` and the session
# launcher, which starts agents through `zsh -lic`. Outside Herdr, codex is unchanged.
codex() {
  if [[ -n "$HC_TERMINAL_SOCKET" && ${@[(Ie)--no-daemon]} -eq 0 ]]; then
    command codex --no-daemon "$@"
  else
    command codex "$@"
  fi
}
