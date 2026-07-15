# Third-Party Notices

This file records third-party license information visible from Arlecchino's
checked-in dependency manifests and bundled assets.

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
during the audit did not surface a GPL-family license.

## Notable Notices And Obligations

### Project License

Arlecchino itself is distributed under the MIT License. The root `LICENSE` file
is included with source and binary redistributions.

### Font Assets

The bundled Nunito font is licensed under the SIL Open Font License 1.1. The
license text is included at:

- `frontend/src/assets/fonts/OFL.txt`

The bundled Fira Code Regular font is licensed under the SIL Open Font License
1.1. The license text is included at:

- `frontend/src/assets/fonts/FiraCode-OFL.txt`

### MPL-2.0 Packages

The frontend lockfile includes `lightningcss` packages under MPL-2.0. Modified
and distributed MPL-covered source files remain subject to MPL-2.0 notice and
source-availability requirements.

### CC-BY-4.0 Packages

The frontend lockfile includes `caniuse-lite` under CC-BY-4.0. Preserve
attribution notices for redistributions that include this package or data
derived from it.

### Frontend Packages With Incomplete Checked-In Metadata

`codemirror-extension-inline-suggestion` is listed in
`frontend/package-lock.json` without a checked-in `license` field. The npm package
page for version `0.0.3` lists the package as MIT licensed.

### Wails Runtime Bindings

Generated Wails frontend runtime files include their own package metadata under
`frontend/wailsjs/runtime/package.json` and are listed as MIT licensed.

## Bundled ML Artifacts

The repository currently bundles an internal autocomplete model artifact and
its tokenizer artifact.

These files are project-owned Arlecchino artifacts licensed under the MIT
License for redistribution with Arlecchino beta source archives and binary
bundles. Distributions containing the artifacts include the root `LICENSE`,
this notice file, and `MODEL_PROVENANCE.md`.

The internal autocomplete model was trained for completion candidate ranking
from public code-completion examples derived from The Stack / BigCode material.
Arlecchino does not redistribute raw The Stack dataset files.

## Language Servers And Tooling

Language servers and optional tooling may be installed by the in-app LSP
installer or approved user/agent actions. These are third-party executables
with their own licenses and supply-chain obligations.
