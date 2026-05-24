# Third-Party Notices

This file records third-party license obligations currently visible from
Arlecchino's checked-in dependency manifests and bundled assets. It is a beta
release checklist artifact, not a substitute for running a full license scanner
before distributing public binaries.

## Dependency Manifests

- Go modules: `go.mod`, `go.sum`
- Frontend packages: `frontend/package.json`, `frontend/package-lock.json`
- PHP/composer packages, if used by optional tooling: `composer.lock`

## License Families Present

The current manifests include packages under these license families:

- MIT
- Apache-2.0
- BSD-3-Clause
- ISC
- 0BSD
- MPL-2.0
- CC-BY-4.0
- SIL Open Font License 1.1

No GPL, LGPL, or AGPL license was found in `frontend/package-lock.json` or
`composer.lock` during the April 2026 static audit. Go module licenses are not
fully represented in `go.mod` or `go.sum`; cached Go module sources inspected
during the audit did not surface a GPL-family license, but public binary
release still requires a Go license scanner over the resolved module source
tree.

## Notable Notices And Obligations

### Project License

Arlecchino itself is distributed under the MIT License. Keep the root `LICENSE`
file with source and binary redistributions.

### Font Assets

The bundled Nunito font is licensed under the SIL Open Font License 1.1. The
license text is included at:

- `frontend/src/assets/fonts/OFL.txt`

The bundled Fira Code Regular font is licensed under the SIL Open Font License
1.1. The license text is included at:

- `frontend/src/assets/fonts/FiraCode-OFL.txt`

### MPL-2.0 Packages

The frontend lockfile includes `lightningcss` packages under MPL-2.0. If any
MPL-covered source files are modified and distributed, keep those files under
MPL-2.0 and provide the required notices/source availability for those files.

### CC-BY-4.0 Packages

The frontend lockfile includes `caniuse-lite` under CC-BY-4.0. Preserve
attribution notices for redistributions that include this package or data
derived from it.

### Frontend Packages With Incomplete Checked-In Metadata

`codemirror-extension-inline-suggestion` is listed in
`frontend/package-lock.json` without a checked-in `license` field. The npm package
page for version `0.0.3` lists the package as MIT licensed. Keep this package on
the release scan checklist until the license is verified by a scanner or
upstream metadata is corrected.

### Wails Runtime Bindings

Generated Wails frontend runtime files include their own package metadata under
`frontend/wailsjs/runtime/package.json` and are listed as MIT licensed. Do not
hand-edit generated bindings; regenerate them through the Wails flow when
needed.

## Bundled ML Artifacts

The repository currently bundles an internal autocomplete model artifact and
its tokenizer artifact.

These files are project-owned Arlecchino artifacts licensed under the MIT
License for redistribution with Arlecchino beta source archives and binary
bundles. Keep the root `LICENSE`, this notice file, and
`MODEL_PROVENANCE.md` with any distribution containing the artifacts.

The internal autocomplete model was trained for completion candidate ranking
from public code-completion examples derived from The Stack / BigCode material.
Arlecchino does not redistribute raw The Stack dataset files. Track dataset
terms, citation requirements, and release-time memorization checks in
`MODEL_PROVENANCE.md`.

## Language Servers And Tooling

Language servers and optional tooling may be installed by the in-app LSP
installer or approved user/agent actions. Treat these as third-party
executables with their own licenses and supply-chain obligations.

## Release Checklist

Before shipping a public binary:

1. Run current license scanners for Go, npm, and Composer dependencies.
2. Resolve packages with missing checked-in license metadata, including
   `codemirror-extension-inline-suggestion`.
3. Refresh this file with any newly introduced licenses and package notices.
4. Confirm The Stack terms/citation obligations and model memorization check.
5. Include `LICENSE`, this notice file, `MODEL_PROVENANCE.md`, `PRIVACY.md`,
   and any dependency-required notices in source archives and binary
   distribution artifacts.
