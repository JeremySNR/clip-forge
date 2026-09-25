# Untouched quality holdout protocol

Status: **protocol and offline tooling implemented; footage, human labels, and matched OpusClip outputs are not yet collected for this holdout.** Nothing in this directory is a measured competitive result. The nine public videos under `benchmarks/public-corpus` have already guided development and remain regression cases, regardless of their older provisional split labels.

## Freeze the questions before acquiring footage

Use three separate experiments. Do not change the question after seeing which system wins.

1. **Discovery:** give every system the identical full source, destination, duration constraints and five-clip budget. Preserve its original suggestion ordering. Compare top-five publishability and distinct worthwhile reference moments retrieved. Include no-good-moment sources; they reveal false-positive selection and should be reported as their own stratum. Low yield can be appropriate on those sources.
2. **Editing:** give every system identical human-selected source intervals and matched visual/caption settings. Compare source fidelity, composition, timing, sound and measured correction work. A system unable to accept fixed intervals is unavailable for this experiment, not a zero-error pass.
3. **Complete workflow:** start from identical full sources using each product's documented recommended settings. Record import-to-first-usable-clip time, processing failures, retries, repair time, cost and publishable output. Keep product defaults and manual interventions in provenance.

Record product version/model, settings, prompts, date, hardware, provider, source SHA-256, export SHA-256 and all manual changes before review. Freeze the code revision and protocol before generating test exports. Never pick a system's best rerun without counting other attempts. Predeclare how transient retries are handled.

## Acquire genuinely new source groups

Recruit or license recordings that have not been used to tune Cutawan, including footage from creators outside the existing corpus. Obtain permission for local testing and, separately, any provider upload involved in generating competitive exports. Keep media out of Git and retain acquisition/permission records next to its inventory. This protocol does not authorize uploading private footage.

Start with a feasibility pilot using development footage, then aim for at least 30 untouched source recordings from at least 15 independent creator groups. These are planning targets, not a power calculation or a guarantee of statistical confidence; use pilot variance to determine the sample needed for the decision. Reserve sufficient footage for later release confirmation rather than consuming the entire holdout during iteration.

Include expert interviews and narrated demonstrations as primary strata. Include remote calls, multiple/overlapping speakers, varied accents and speaking styles, soft speech, background noise/music, moving subjects, scene changes, off-screen questions, small text, moving insets, long setup/payoff chains and weak/no-good-moment sources. Predeclare any languages or genres outside the claim. Do not present English interviews as proof of sports/gameplay or multilingual quality.

Assign stable opaque `creatorGroup` and `recordingGroup` IDs before splitting. The same creator, host/channel family, studio/layout or recording session stays on one side of development/test; union overlapping relationships conservatively. Re-encodes and excerpts of a recording inherit its group. The runner rejects cross-split reuse of supplied groups and identical source hashes. It warns when groups are missing for compatibility, so incomplete metadata is not a certified holdout.

Maintain a private inventory with case ID, source path/hash/duration, creator and recording groups, acquisition date, permissions, tags, language, capture setup, and a record of whether developers have inspected it. Limit access to the untouched test labels. Once a source is used to tune a fix, treat it as regression footage and evaluate the fix on new held-out groups.

## Annotate the entire source independently

Two editors watch the full recording **before seeing any system's proposals**. Each identifies worthwhile self-contained moments, their necessary context, promised payoff, source interval and rationale. Include valuable visual events with little or no useful transcript: a visible result, demonstration, reaction or readable comparison. Annotate hard negatives such as intros, advertisements, repeated ideas and incomplete promises. Explicitly record sources with no worthwhile moment; do not force three or five positives.

Reconcile independent source annotations into distinct moment references without inspecting system outputs. Preserve both original annotations and the adjudication record. A missing reference must remain a possible annotation gap: interval-IoU recall measures agreement with those references, not exhaustive creative merit. Record reasons for disagreements and unresolved alternatives. When evaluating timing or speakers, annotate all relevant speech and overlap, not just easy excerpts.

Write validated `QualitySample` reference JSON and a version 1 benchmark manifest using the [runner contract](../../docs/quality-benchmark.md). References must be frozen before running discovery. Use source hashes and optional source paths to verify identical media. For each product, store outputs under their original rank with explicit `rank`; missing exports remain missing, and a run that returns nothing still includes that case with `highlights: []`. Never remove failed or difficult cases.

## Review exports and time corrections

Run `npm run quality:benchmark -- compare <manifest> <new-directory>`. A coordinator retains the private maps and metrics and sends only the blind HTML and anonymized videos to reviewers. Inspect the package for branding leaks before the experiment. Randomize independently for repeat rounds; avoid presenting paired alternatives consecutively where recognition would bias first impressions.

At least two reviewers independently rate each clip using the generated form. Watch the export standalone, then check the original source for missing context and changed meaning. Mark publishable/repairable/reject, severe defects, source verification, dimension scores and timestamped notes. Time corrections on a copy of accepted exports in a fixed editing environment; include verification time and distinguish editing from machine waiting in separate run notes. Blank timing means unmeasured. Reviewers should not discuss their decisions until submissions are frozen.

Aggregate with `summarize-review`. Keep conditional publishability alongside full top-K yield, reviewed/eligible coverage, rendering failures, missing outputs, severe defects and repair-timing coverage. At least two files are necessary but do not prove reviewer independence. Resolve disagreements with a third reviewer or a documented adjudication, retaining original votes; the current tool conservatively requires unanimous publishable votes and exposes disagreements rather than silently adjudicating them.

## Proposed release gates

Freeze gates after the development pilot and before the untouched comparison. Initial targets for the primary interview/demo strata are:

- At least four publishable suggestions per five requested, while also reporting no-good-moment strata and abstention behavior separately.
- Median measured repair time below 60 seconds for accepted clips, with high, reported timing coverage and tail times inspected.
- At least 90% of reviewed clips actually labelled Ready are publishable as shown; report all declared-Ready coverage so selective omissions cannot satisfy the gate.
- No observed changed-meaning or seriously damaged-speech defect in a release candidate; adjudicate every such flag and report sample size. Zero observed does not prove zero risk.
- No loss on previously fixed regression examples, and no material failure rate increase on declared primary strata.

Use confidence intervals and source-level cases alongside aggregates. The runner currently provides source-cluster intervals for observed publishable yield, not a powered superiority test or direct pairwise-preference test. Add a preregistered matched preference study with independent source-level uncertainty before claiming that Cutawan beats OpusClip. Reviewer preference and publishability do not establish audience lift; that requires later authorized publishing experiments with comparable audiences and exposure.
