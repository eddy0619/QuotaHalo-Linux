# Changelog

## Unreleased

- Added persistent system notifications with natural English messages for manual refresh failures and stale Claude usage refresh errors.
- Provider refresh notifications now use the affected AI provider icon and repeat after manual refresh.
- Fixed Codex quota parsing when the latest local rate-limit event is empty and the previous event still contains valid 5h/7d usage.

## v0.2.0 - 2026-06-12

- Added GitHub tag based update checks with daily background polling and manual refresh checks.
- Added update notifications, per-version dismissal, and an in-panel update action.
- Added self-update protection that refuses to update with uncommitted local changes and creates a backup branch before checking out a release tag.
- Improved the AI quota details panel layout, provider visibility rules, and long-message handling.
- Added bounded manual-refresh diagnostics for easier troubleshooting without storing private tokens or unbounded logs.
- Improved installer behavior for first-run GNOME extension setup.
- Added system status improvements, including GPU hiding when unavailable and proxy public IP display through common local proxy ports.

## v0.1.0 - 2026-06-08

- Initial public release of QuotaHalo for Copilot, Codex, Claude, and system status monitoring in the GNOME top bar.
