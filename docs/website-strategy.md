# Cutawan website redesign

## Objective

Help a creator understand the outcome within the hero, see credible product evidence, understand the setup and decide whether to download. Give open-source contributors a clear second route into the repository. Conversion rate improvements require measurement; design quality alone does not establish an uplift.

## Research reviewed 19 September 2026

- [Linear](https://linear.app/): a precise product story, strong type hierarchy and interface demonstrations close to the introduction. Applied as an outcome-first hero with visible product proof.
- [Raycast](https://www.raycast.com/): a desktop product with a focused acquisition action and concrete examples of what the software enables. Applied as a prominent free-download path with explicit platform selection.
- [Cal.com](https://cal.com/): task-focused positioning and a low-friction entry point, with deeper explanations available further down. Applied as a short headline, concise supporting copy and a complete getting-started guide.
- [PostHog](https://posthog.com/): a distinctive visual identity and open access to product detail. Applied as an original editorial direction, inspectable source links and honest cost/data explanations rather than invented testimonials or popularity claims.
- [Google Search Central’s SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide): descriptive titles, useful crawlable content, relevant links and pages organised around readers’ needs. Applied through static HTML, unique page metadata, canonical URLs, internal links and an updated sitemap.

These are qualitative references. None of these companies’ private conversion rates was available or used to claim a best-performing design.

## Design and conversion decisions

- Warm paper, charcoal, vermilion and sage distinguish the site from generic dark developer-tool landing pages. Large sans-serif headings paired with italic serif phrases give the hero an editorial character.
- The headline communicates that value is already present in the creator’s footage. The supporting copy explains the actual product outcome, and the primary CTA clearly says the app is free.
- An original AI-generated podcast image makes the long-video-to-short-clips transformation concrete. It is explicitly labelled as an illustrated workflow, with click-driven captions and reframing demonstrations. It is not presented as a real customer, testimonial or actual video export.
- Actual application screenshots appear in a separate, keyboard-operable product gallery. The test footage is clearly disclosed.
- Download controls link to the latest release page rather than hard-coding a version or guessing asset availability. The platform selector explains the required installer and macOS signing caveat.
- Costs and data handling are explained before the final CTA. The site does not claim cloud AI is offline, that ChatGPT subscriptions include API credits, or that every generated clip will go viral.
- No fabricated ratings, customer logos, GitHub counts, savings estimates or artificial urgency.

## SEO and performance

- The site remains plain HTML/CSS/JavaScript, compatible with the existing `docs/` GitHub Pages deployment. No framework or build step was added.
- All meaningful copy and release links are present in the initial HTML.
- Each public page has a unique title, description, canonical and social metadata. The home page has SoftwareApplication structured data without invented reviews or ratings. Guides have breadcrumb structured data.
- Dedicated pages address the useful intents “open-source Opus Clip alternative” and “turn long video into short clips,” with substantive text rather than keyword filler.
- The hero uses a local 1200×800 WebP, approximately 90 KB. It is preloaded and reused across the illustration; below-fold screenshots are lazy-loaded. No remote fonts, analytics scripts or animation libraries are required.
- Reduced motion, visible focus, a skip link, native FAQ disclosures, accessible tabs and responsive layouts are included.
- `robots.txt` already declares the sitemap. Because this is a project hosted under `/cutawan/`, the domain-root robots policy remains controlled by the GitHub Pages domain owner.

## After publication

1. Verify the final canonical domain if the project moves away from GitHub Pages, updating canonical URLs, social URLs, structured data and sitemap together.
2. Submit the sitemap to Google Search Console and inspect the three public URLs. No ranking or rich-result guarantee is implied by the metadata.
3. If conversion measurement is wanted, agree on a privacy-conscious analytics setup. Measure hero CTA clicks, arrival at downloads and outbound release clicks. Website clicks alone do not prove installer downloads or successful activation.
4. Establish a baseline before testing alternate hero headlines or CTA text. Change one hypothesis at a time and compare equivalent traffic sources and devices.
5. Replace the illustrative footage with a consented real creator example when available, ideally showing a real before-and-after exported clip.

## Asset provenance

`assets/podcast-editorial.webp` is original AI-generated editorial artwork created for this redesign. It depicts a fictional podcast host. `assets/social-preview.png` is a locally rendered original graphic. Existing screenshot assets are retained from the project’s demo application.

## Verification on 19 September 2026

- Repository gates: 441 tests passed across 54 files; TypeScript and ESLint passed. Vitest required execution outside the filesystem sandbox to read its config.
- Desktop and mobile interactive checks passed for all three hero illustration modes, screenshot selection, arrow-key tab navigation, all three platform choices, FAQ disclosure and latest-release destination. Mobile menu opening, Escape closing and focus restoration passed.
- No horizontal page overflow at 320, 390, 768 or 1440 pixels.
- All 46 local file/anchor references across three public pages resolve; each page has one H1, unique IDs, canonical/description metadata and parseable JSON-LD.
- axe-core 4.12.1 reported zero automatic WCAG A/AA violations in the final home page checks at desktop and mobile sizes. Image overlays and some pseudo/decorative content require visual judgement; this is not a claim of complete accessibility certification.
- Actual app screenshot loading was verified after scrolling into the product section. The full-page screenshots taken before scrolling do not trigger every lazy-loaded image.
- No browser page errors were reported. Final hero reviewed at 1440×1000 and 390×844.
- A local browser vitals sample reported LCP 40 ms and CLS 0. This is a local development measurement, not a production, throttled-mobile or field-performance result.

Preview with any static HTTP server whose root is `docs/`. No build step is needed. The redesign has not been published by this task.
