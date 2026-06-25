# crab-cli npm launcher

This package provides the `crab` npm binary launcher for platform-specific crab-cli release binaries.

Runtime resolution order:

1. `CRAB_CLI_BINARY`
2. `vendor/<target>/crab`
3. local development release output under `dist/<target>/crab` or `release/<target>/crab`

Supported targets:

- `darwin-arm64`
- `darwin-x64`
- `linux-x64`

The package must not be published as production-ready unless the release pipeline packages a verified `vendor/<target>/crab` payload or the installer downloads and verifies a GitHub Release archive with the checksum manifest.
