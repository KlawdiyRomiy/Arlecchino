# Autocomplete Model Notice

Status: public beta notice for bundled internal autocomplete artifacts.

Arlecchino bundles an internal autocomplete model used by the completion
pipeline. This notice records the public facts needed for beta distribution
without treating the model as a standalone product surface.

## What It Is

- An internal autocomplete model used to rank completion candidates.
- A bundled model artifact plus tokenizer artifact distributed with Arlecchino.
- Part of the editor completion pipeline, alongside deterministic editor and
  language-tooling sources.

## What It Is Not

- It is not a generative code model.
- It is not an autonomous agent or AI Chat runtime.
- It does not redistribute raw training dataset files.

## Bundled Artifacts

| Artifact                   | SHA256                                                             |
| -------------------------- | ------------------------------------------------------------------ |
| Bundled model artifact     | `32da674b8921a0cc5ecb30c06310bfe1a287ed8ca7c434731719f969e106e0ac` |
| Bundled tokenizer artifact | `bc662721e925cfa2f785584cec6a2bbfa650a3a09a9f01f1424e97b3feee71d5` |

## Redistribution And License

- Model owner/author: Arlecchino project owner, publishing under the public
  pseudonym Klawdiy Klowerson.
- Artifact license: MIT, same as the Arlecchino project license.
- Covered artifacts: bundled model artifact and bundled tokenizer artifact.
- Redistribution: these artifacts may be redistributed with Arlecchino source
  archives and beta binary bundles when the root `LICENSE`,
  `THIRD_PARTY_NOTICES.md`, and this file are included.

## Training Data Summary

The model was trained for completion candidate ranking from public
code-completion examples derived from The Stack / BigCode material. Arlecchino
does not redistribute raw dataset files, per-sample repository names, file
paths, or original source snippets with the bundled artifacts.

The Stack source material is covered by many original licenses. This notice
does not change those upstream terms.
