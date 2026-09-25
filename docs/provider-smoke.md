# Bounded live provider validation

The ordinary test suite uses scripted provider responses. `scripts/provider-smoke.mjs` is a separate, explicitly invoked check that sends real requests through the production editorial-ranking and source-discovery implementations. It does not establish human clip quality, engagement or superiority to another product.

Use only public/synthetic media or footage explicitly authorized for the selected provider. Choose a source no longer than 45 seconds containing an observable setup, action and result. The harness first reviews one fixed candidate, then runs whole-source discovery and any supported refinements. It supplies an empty transcript by default; an optional transcript JSON must describe the actual source.

Create a safe configuration outside Git; never put credentials in it:

```json
{
  "provider": "chatgpt",
  "sourcePath": "/absolute/path/to/authorized-short.mp4",
  "sourceProvenance": "Public source URL, license/attribution and excerpt interval, or description of synthetic footage",
  "sourceAuthorizedForProvider": true,
  "model": "gpt-5.6-luna",
  "codexModel": "gpt-5.6-luna",
  "codexPath": "/absolute/path/to/codex",
  "subscriptionUserData": "/absolute/path/to/existing/cutawan/profile",
  "subscriptionDailyLimit": 10,
  "maxRequests": 4
}
```

Read the configured subscription limit before supplying it. The runner launches Electron with an isolated profile, then uses the production subscription cache and usage ledger for real ChatGPT requests. Its in-memory cap is the smaller of the configured limit and today's existing usage plus the requested smoke budget. It does not write settings, raise the configured limit, read authentication tokens or switch models. Cached responses remain identifiable through the final daily usage; a cache hit is not proof of a fresh provider request. The standalone helper needs permission to write the normal production cache/usage ledger.

For API validation, use `"provider": "api"`, the configured analysis model and optional `apiBaseUrl`. Supply the API key only through `OPENAI_API_KEY`; the runner neither reads nor prints encrypted settings or credentials. With no key it writes a blocked result and makes no request. API network attempts, including compatibility fallbacks and retries, are capped at four. ChatGPT never falls back to an API.

```sh
node scripts/provider-smoke.mjs .tmp/provider-config.json .tmp/new-provider-run
```

The output directory must be new. Existing installed esbuild/Electron dependencies compile and run the helper without changing the app build configuration. The entire run has a ten-minute cancellation deadline. Results include `summary.json`, `editorial-report.json` and `discovery-report.json` when each stage returns. Source video paths, source hashes, models, actual logical-call counts, evidence and sampling limits are preserved in the production reports; keys and authorization headers are not recorded.

Interpret the checks separately:

- A complete discovery scan can legitimately return no proposals. That tests the scan transport/schema path but does not test refinement.
- `refinementExercised: true` means at least one actual refinement completed. Inspect its evidence and interval; successful transport is not a quality judgment.
- A reviewed, grounded-rejected or valid uncertain editorial assessment with validated evidence exercises the response path. Valid uncertainty produces `provider-smoke-passed-with-content-review`; it does not become a positive content score. Missing, malformed or unsupported responses return the empty-evidence fallback and remain `needs-investigation`.
- Authentication, allowance, schema, extraction and timeout failures must remain recorded. Do not rerun until a pass and omit failed attempts.
- Run each intended provider explicitly. A ChatGPT pass is not an API pass; an unavailable API route stays untested.

To verify harness changes without spending new ChatGPT allowance, set `"cacheOnly": true` and reuse the identical source/model/instructions in a new output directory. The adapter's in-memory limit equals current usage, so only existing cached results can complete. A cache miss fails closed. Record this separately from the original fresh-provider trial.

Before a release, link actual run reports in the validation notes, record source provenance and budgets, explain failures or unavailable providers, and retain the independent human-evaluation requirement from the [quality benchmark](quality-benchmark.md).

## Recorded check: 25 September 2026

The [portable results](../benchmarks/provider-smoke/2026-09-25-chatgpt.json) record one real ChatGPT run using `gpt-5.6-luna`, followed by a cache-only harness check. Source: the public CC BY 3.0 [Blender tutorial “A cup of tea”](https://commons.wikimedia.org/wiki/File:Blender_Tutorial._A_cup_of_tea..webm), excerpt 65–105 seconds, 40 seconds at 1280×720/60 fps with no audio. The excerpt SHA-256 is `4dbcf9c69bcb4ab45590c45a53105ab55613567b6e97006adb0a5ec52c17fb50`.

The fresh run made **three Codex inference requests** against an in-memory maximum of four and recorded all three in the production usage ledger. One four-frame editorial review completed with validated evidence. The eight-frame discovery scan and ten-frame refinement completed successfully, returning one candidate at 7.886–18.761 seconds of the excerpt (“Smoothing the cup’s lower edge”). No request, schema or frame-extraction failure was observed.

The fixed editorial candidate was the entire 40-second excerpt. The model kept it as **needs review**, with no overall numeric score: it starts during modeling and ends in wireframe, so the four sampled frames did not establish a completed payoff. This is valid conservative behavior. The original harness labeled any uncertainty `needs-investigation`; that original result is retained and its artifact hashes are recorded. The harness was corrected to distinguish evidence-backed uncertainty from an invalid response. An identical **cache-only** replay returned `provider-smoke-passed-with-content-review`; the production usage count stayed at three. No new request was made to seek a more positive score.

The **API provider remains untested live** because no API credential was available. This single-source check establishes the exercised ChatGPT transport/serialization/schema paths, including the ten-image refinement boundary. It does not establish live multi-candidate diversity quality, publishability, correction-time improvement, audience outcomes or an advantage over OpusClip.
