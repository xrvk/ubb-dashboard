# Security Policy

This project is deprecated and no longer maintained. The hosted app and container image will stop being updated, and the repository will be archived on December 7, 2026. Security fixes are not guaranteed.

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please **do not** open a public issue. Instead, report it privately via [GitHub Security Advisories](https://github.com/xrvk/ubb-dashboard/security/advisories/new) so it can be triaged and fixed before disclosure.

## Scope

This is a browser-only single-page app. Common considerations:

- **Credentials are never persisted.** Your enterprise URL and personal access token live in React state for the duration of the browser tab and are sent only to the API host you connected to.
- **No backend.** The app has no server, no analytics, no telemetry, and no third-party data collection. All fetches go directly from your browser to `api.<your-host>`.
- **Dependencies are pinned via `package-lock.json`.** This project receives no dependency updates.

This is not an officially supported GitHub product. See [SUPPORT.md](SUPPORT.md).
