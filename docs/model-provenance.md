# ARLE Model Provenance

Status: training notebook reviewed; model ownership, redistribution permission,
and dataset access attestation recorded. Public release still requires a
release-time memorization check.

This document tracks the provenance of the bundled ARLE model artifacts. It is
required before public binary distribution because model and tokenizer files are
separate redistributable artifacts with their own training data, conversion,
and license questions.

## Bundled Artifacts

| File                         | SHA256                                                             |
| ---------------------------- | ------------------------------------------------------------------ |
| `assets/arle_model.onnx`     | `32da674b8921a0cc5ecb30c06310bfe1a287ed8ca7c434731719f969e106e0ac` |
| `assets/arle_tokenizer.json` | `bc662721e925cfa2f785584cec6a2bbfa650a3a09a9f01f1424e97b3feee71d5` |

## Ownership, License, And Redistribution

- Model owner / author: Arlecchino project owner, publishing under the public
  pseudonym Klawdiy Klowerson.
- Ownership confirmation: project owner confirmed on April 25, 2026 that the
  model is project-owned and may be used in Arlecchino.
- Artifact license: MIT, same as the Arlecchino project license.
- Covered artifacts: `assets/arle_model.onnx` and
  `assets/arle_tokenizer.json`.
- Redistribution: these model artifacts may be redistributed as part of
  Arlecchino source archives and beta binary bundles, provided the root
  `LICENSE`, `THIRD_PARTY_NOTICES.md`, and this provenance document are kept
  with the distribution.
- No raw training dataset files are redistributed with Arlecchino.

## Current Evidence

- Conversion helper: `scripts/conversion/pt_to_onnx.py`
- Training notebooks: `scripts/training/`
- External training notebook link supplied for review:
  `https://colab.research.google.com/drive/1roaPXKA9IEQkibiCOGffyGYQfqAYoLif`
- Reviewed notebook export: `arle_ranking_model.ipynb`
- Reviewed notebook SHA256:
  `39c76d95ee79944ac695815f00395c2a41283a7b2e7aec7ec867f399d96f3ce2`

The Colab URL itself was not readable from the audit environment on April 24, 2026. The exported notebook was provided separately and reviewed locally.

## Training Summary

- Model purpose: local code-completion candidate ranking.
- Model type: scorer/ranker, not a generative code model.
- Base model: none found; architecture is defined in the notebook.
- Architecture: embedding layer, 2-layer bidirectional LSTM, attention pooling,
  and linear score head.
- Parameters: 1,732,994 trainable parameters.
- Tokenizer: BPE tokenizer trained in the notebook with vocab size 8,000 and
  saved as `arle_tokenizer.json`.
- Training objective: pairwise ranking with margin ranking loss.
- Training run: 5 epochs, batch size 64, AdamW, cosine annealing scheduler.
- Reported validation result: best validation accuracy 82.29%.
- Export path: PyTorch checkpoint -> FP32 ONNX -> dynamic INT8 quantized ONNX.
- Reported INT8 ONNX size: 1.68 MB.
- Export validation: ONNX checker passed.

## Training Data

- Dataset: `bigcode/the-stack-dedup`.
- Resolved dataset revision seen in notebook output:
  `17cad72c886a2858e08d4c349a00d6466f54df63`.
- Dataset access: Hugging Face login prompt; no actual token is embedded in the
  reviewed notebook.
- Sampling: up to 5,000 triplets per loaded language.
- Total training samples reported: 230,000 triplets.
- Successful languages: python, javascript, typescript, java, go, rust, c, php,
  ruby, swift, kotlin, scala, csharp, dart, lua, r, julia, perl, shell, haskell,
  clojure, elixir, erlang, groovy, powershell, fsharp, ocaml, fortran, cobol,
  ada, prolog, scheme, racket, assembly, vhdl, verilog, zig, crystal, json,
  yaml, toml, xml, markdown, dockerfile, sql, html.
- Failed language loads: cpp and nim.

The notebook uses only the `content` field when creating ranking pairs and does
not retain per-sample repository names, file paths, original licenses, or other
provenance metadata in the training artifact.

## Dataset Terms And Legal Notes

The Stack is described by its maintainers as permissively licensed source code,
but it is a collection of files with many original licenses. Its terms require
users to comply with the original licenses, including attribution clauses where
relevant. The dataset also has removal-request/update expectations and known
limitations around sensitive data that may have appeared in public repositories.

Primary references:

- Hugging Face dataset card:
  `https://huggingface.co/datasets/bigcode/the-stack-dedup`
- BigCode dataset governance notes:
  `https://www.bigcode-project.org/docs/about/the-stack/`
- Paper to cite in release notes or model documentation: Kocetkov et al.,
  "The Stack: 3 TB of permissively licensed source code", 2022,
  `https://arxiv.org/abs/2211.15533`.

Dataset access is gated on Hugging Face. The project owner confirmed that the
dataset terms were accepted before or during model training because the training
notebook required Hugging Face gated dataset access. No separate acceptance
receipt or screenshot was retained at training time, so do not invent an exact
historical acceptance date.

For release records, keep a current project-owner attestation instead:

- accepting account: project owner Hugging Face account, not recorded in public
  docs;
- historical acceptance date: accepted before/during training, exact date not
  retained;
- attestation recorded date: April 25, 2026;
- dataset: `bigcode/the-stack-dedup`;
- training revision:
  `17cad72c886a2858e08d4c349a00d6466f54df63`;
- current access evidence: screenshot supplied on April 25, 2026 shows the
  logged-in Hugging Face page for `bigcode/the-stack-dedup` with Dataset Viewer
  content visible, Files and versions tab available, and no access/terms prompt
  blocking the page.

If this evidence is refreshed before a later release and the logged-in Hugging
Face page shows an access button, accept it again and record the new current
date as a fresh acknowledgement. If it shows no button and files/content are
accessible, record that refreshed access state instead.

For Arlecchino's current ranker, this is lower risk than shipping a generative
model because the model scores candidate completions rather than producing code
from scratch. It still needs release discipline:

- cite The Stack / BigCode in release notes or model documentation;
- keep this document with the model artifacts;
- document that no raw dataset files are redistributed with Arlecchino;
- avoid claiming that all training data is risk-free;
- add a model removal/retrain process if The Stack maintainers mark the used
  dataset revision as no longer usable;
- run a small memorization/regurgitation check before public release, especially
  for uncommon code snippets and secrets.

## Quality Notes

The notebook's ONNX smoke test passed one example and failed one example: the
Fibonacci context scored `print("hello world")` higher than the intended
recursive return. This is not a legal blocker, but it should be documented as a
beta quality limitation before presenting the model as reliable.

## Required Provenance Fields

Completed:

- model owner / author;
- explicit license for `arle_model.onnx`;
- explicit license for `arle_tokenizer.json`;
- explicit statement that redistribution inside Arlecchino is allowed;
- project-owner attestation for the gated dataset terms and current access
  evidence for `bigcode/the-stack-dedup`.

Remaining release gates:

- release-time memorization/regurgitation check result.

## Release Decision

Ship the model in beta builds because local ranking-backed autocomplete depends
on it. Do not claim the bundled model is fully release-cleared until the
release-time memorization check is recorded and the release notes cite The Stack
/ BigCode as required.
