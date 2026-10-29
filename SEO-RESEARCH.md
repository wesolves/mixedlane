# Mixedlane organic search research and launch plan

Research date: 29 October 2026. Audience: English-speaking software teams worldwide, confirmed by the user. Tracking: MIX-0007 / MIX-0008; research MIX-0009; implementation MIX-0010. The repository remains unlinked by request.

## Recommendation

Position Mixedlane as **project tracking, docs, and AI agents in one workspace**. Start with the homepage and expand into useful, evidence-based guides about MCP workflows and self-hosting. Treat generic “project management software” and “Jira alternative” as longer-term topics, rather than expecting a new homepage to displace established products immediately.

The implementation creates a public, static homepage in the existing application. It explains the actual features found in README.md and the source, links to registration and sign-in, and keeps private workspaces behind existing authentication. It does not invent customer logos, adoption figures, pricing, reviews, migration capabilities, or performance claims.

## Method and limits

- Used the user's Brave browser to inspect live Google results for **project management MCP server**, **self hosted Jira alternative**, and **kanban project management with documentation**. Supplemented these observations with web searches and primary vendor documentation for the keyword clusters below.
- Brave showed personalized Google results in India. These are directional observations, not a neutral worldwide ranking audit. Do not describe the observed order as a universal position.
- Checked competitor positioning against vendor pages: Plane, OpenProject, Linear, Taskade, ClickUp, Asana, and Atlassian. Vendor marketing is evidence of positioning, not independent proof of superiority.
- No Google Ads Keyword Planner, Search Console, Ahrefs, or Semrush dataset was available. **Monthly volume, CPC, numerical difficulty, and Mixedlane's current positions are unverified.** Priority is an editorial judgment based on product fit, intent, and visible competition; it is not a traffic forecast.
- A search for `site:mixedlane.wesolves.dpdns.org` returned no results in the web search tool. This alone does not prove that Google has indexed zero pages. Confirm through the production property's Search Console.

## Keyword shortlist: 16 terms

P1 means the first content opportunities to validate; P2 supports category discovery; P3 is a broad or competitive topic. Competition labels are qualitative estimates. Evidence IDs link to primary sources below. Future paths are proposals, **not pages shipped in this change**. Homepage anchors are sections of one URL, not separate indexable landing pages.

| Keyword | Intent | Priority / competition estimate | Product fit and evidence | Page mapping |
| --- | --- | --- | --- | --- |
| project management MCP server | Technical evaluation / setup | P1 / medium-high | Native MCP tools; Google shows both setup and explainer intent. E1, E2 | `/` now; future `/guides/project-management-mcp` |
| MCP task management software | Commercial / technical | P1 / medium-high | Task planning and progress through permitted tools. E1, E2 | `/` agents section; same future MCP guide |
| MCP issue tracker | Commercial / setup | P1 / medium-high | Search, create, and update issue workflows. E1 | Future `/guides/mcp-issue-tracking` |
| AI agent task management | Mixed informational / commercial | P2 / high; ambiguous | Clarify that agents operate on project work, rather than claiming autonomous scheduling. E2, E8 | `/` agents section; future workflow examples |
| project management with docs | Commercial evaluation | P1 / high | Linked documentation is a real feature. E3, E4 | `/` product section; future `/features/project-tracking-and-docs` |
| self hosted project management with docs | Commercial / deployment | P1 / high | Docker, PostgreSQL, shared docs; avoid air-gap or compliance promises. E3 | `/` self-host section; future `/guides/self-hosted-project-management` |
| self hosted Jira alternative | Comparison / replacement | P2 / high | Strong fit for teams seeking issue tracking and deployment control; migration not promised. E5, E6 | Homepage FAQ now; future `/compare/jira` |
| open source Jira alternative | Comparison / replacement | P2 / high | MIT license and Public repository badge verified in Brave. E5, E6 | Future `/compare/jira`, with a sourced feature matrix |
| Jira alternative for small teams | Commercial comparison | P2 / high | Simpler tracking proposition; public results include dedicated competitor comparison pages. E7 | Same future comparison page; do not create near-duplicate pages |
| self hosted issue tracker | Commercial / deployment | P2 / high | Relevant to the source deployment model. E5, E6 | Future self-hosting guide, with real setup steps |
| Kanban project management | Mixed informational / commercial | P3 / very high | Google is dominated by educational guides; the homepage alone is a weak match. E9 | `/` supports the feature; future practical Kanban guide |
| kanban project management with documentation | Mostly informational in observed Google results | P3 / high | Observed results skew toward general Kanban education, not a distinct purchase niche. E9 | Supporting language; not the homepage's primary keyword |
| issue tracking GitHub integration | Technical / commercial | P2 / high | Existing linking by work item keys, branches, commits, and PRs. E10 | `/` GitHub section; future `/guides/github-issue-tracking` |
| project management epics milestones tasks | Informational / workflow | P2 / high | Six-level configurable hierarchy. E11 | `/` hierarchy example; future hierarchy guide |
| AI project management software | Broad commercial / list comparison | P3 / very high | Established brands; many incompatible meanings of “AI.” E8, E12 | Contextual copy only; validate long-tail workflows first |
| Mixedlane project management | Branded / navigational | P1 / competition unmeasured | Brand ownership and consistent product naming | Homepage title, description, and source documentation |

## Sources and observed competition

- **E1:** [Linear MCP documentation](https://linear.app/docs/mcp). Establishes issue/project/comment tool access as a competitor capability; MCP alone is not a unique differentiator.
- **E2:** [Taskade MCP documentation](https://www.taskade.com/learn/connect/mcp-server). Supports the agent/task/workspace cluster and the value of an actionable setup guide.
- **E3:** [Plane self-hosting page](https://plane.so/self-hosted). Connects deployment control with project and knowledge management. Mixedlane should explain its own operational requirements concretely.
- **E4:** [Plane documentation](https://docs.plane.so/). Shows projects, wiki/pages, integrations, and setup content as distinct visitor needs.
- **E5:** [OpenProject's Jira alternative page](https://www.openproject.org/blog/open-source-jira-alternative/). Appeared in the Brave Google results. Comparison intent needs an honest feature/deployment comparison.
- **E6:** [Plane's self-hosted Jira alternatives](https://plane.so/blog/11-jira-alternatives-you-can-self-host-in-2026). Also observed in Brave; competition includes detailed list and comparison content.
- **E7:** [Taskive Jira comparison](https://taskive.ai/alternatives/jira). A vendor example of small-team targeting. Do not reproduce unverified pricing or limits.
- **E8:** [ClickUp AI project management tools](https://clickup.com/blog/ai-project-management-tools/). Illustrates broad category competition; use only as the vendor's positioning.
- **E9:** [Atlassian Kanban guide](https://www.atlassian.com/agile/kanban). Appeared in Brave for the Kanban/docs query. This query needs educational substance.
- **E10:** Mixedlane's own [GitHub integration guide](https://github.com/wesolves/mixedlane#github-integration) and repository implementation are the feature evidence for this keyword; search did not establish a low-competition opportunity.
- **E11:** [Atlassian epics guide](https://www.atlassian.com/agile/project-management/epics) and [milestone guide](https://www.atlassian.com/work-management/project-management/project-milestones). Support informational workflow intent, not measured search volume.
- **E12:** [Asana's AI product page](https://asana.com/product/ai). Shows established competition around human/agent collaboration.

## Landing page and technical SEO delivered

- `/` is static semantic HTML: one H1, descriptive sections, working signup/sign-in links, readable FAQs, responsive styling, keyboard focus, skip link, reduced-motion support, and an explicitly illustrative product board.
- Title: `Mixedlane — Project Tracking, Docs & AI Agents`.
- Description: `Plan projects, track issues on Kanban boards, and keep docs connected. Mixedlane brings software teams and AI agents together with MCP and self-hosting.`
- Canonical URL and social metadata use the build-time `VITE_PUBLIC_SITE_URL` origin. SoftwareApplication microdata describes only verified attributes; it makes no review/rating or rich-result eligibility claim.
- Generated sitemap lists only `/`. Robots allows the public site and its assets, excludes API crawling, and declares the sitemap. Robots is not access control.
- Auth and organization routes receive a separate `app.html` shell with `noindex, follow`. Crawlers can fetch that shell to read the noindex directive. Existing authentication continues to protect private data.
- Homepage requires no JavaScript application bundle and makes no authentication request. The application still uses React when the visitor opens an app route.
- Both nginx and the all-in-one Nest server are updated for the two HTML entry points. HTML responses are not cached permanently.
- No FAQ rich-result promise: the FAQ is for visitors. No stuffed keyword tag, hidden keyword blocks, fabricated backlinks, review schema, or location doorway pages.

## Practical path toward top-10 visibility

1. **Launch:** deploy this change at the canonical production origin; verify HTTPS, public HTTP 200, canonical, noindex boundaries, sitemap, robots, and signup. Keep staging environments protected or noindexed. Set `VITE_PUBLIC_SITE_URL` during the build; changing a runtime variable cannot alter built HTML.
2. **Establish baseline:** verify the domain/URL-prefix property in Google Search Console using the owner's account. Submit `/sitemap.xml` and inspect `/`. Record index status, Google-selected canonical, mobile usability, and rendering. Never submit private workspace URLs.
3. **Validate the shortlist:** use Keyword Planner for the intended countries and export approximate monthly demand; use an SEO tool if available for competitor links and difficulty. Use Search Console's actual queries once impressions appear. Reorder priorities if the evidence differs.
4. **Build the first supporting resource:** a tested MCP setup guide with exact supported clients, permission boundaries, real prompts, and reproducible examples. Link it from the homepage and relevant public repository docs.
5. **Build the next resource:** self-hosting setup with deployment steps, backups, updates, troubleshooting, and screenshots from a real instance. Consolidate related terms instead of making thin pages for every wording variant.
6. **Add comparisons only when useful:** a sourced Jira comparison with current feature support and limitations. Do not imply automatic import, complete Jira parity, or unverified cost savings.
7. **Earn relevant discovery:** publish accurate project documentation, useful demos, and genuine technical tutorials. Seek relevant directories and community discussions according to their rules. No purchased links or spam; external posting requires a separate instruction.
8. **Measure and improve:** compare consecutive 28-day Search Console windows by query, page, country, and device. Track impressions, organic clicks, CTR, average position, and verified signup conversions. Investigate poor CTR only after enough impressions; investigate conversion problems using real user behavior.

**Top-10 target definition:** validate an initial group of 3–5 highly relevant nonbranded queries, then track whether their intended pages consistently reach positions 1–10 in the chosen markets. Search Console's average position is an aggregate, not a fixed rank. Homepage publication, a sitemap, or a 30/60/90-day schedule cannot guarantee that target. Reassess at 30 days for indexing/early signals, 60 days for content-query fit, and 90 days for continued investment; these are review points, not ranking promises.

Google's guidance: [SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide), [JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics), and [crawling/indexing FAQ](https://developers.google.com/search/help/crawling-index-faq). Google explicitly states that crawling, indexing, and ranking are not guaranteed.

## Release status

The landing page is implemented in this checkout. Verification completed:

- `npm run typecheck` passed.
- Production web build and server build passed. Vite still warns about the existing large application JavaScript chunk; the public homepage loads none of that JavaScript.
- `npm run test:api -- hardening.test.ts`: all 7 tests passed with loopback access, including homepage/application separation, direct HTML caching, CSP, API routing, rate limits, and cookies. The first sandboxed run was blocked by localhost connection permissions; the authorized rerun passed.
- HTTP smoke checks returned 200 for the homepage, registration, login, `/app`, an organization route, sitemap, and robots. Only app routes contained `noindex`; only the homepage appeared in the sitemap.
- Brave desktop and 390px mobile inspection passed. Mobile had no horizontal page overflow. One H1, no broken internal anchors, correct canonical, and zero homepage script elements were observed. FAQ expansion and navigation to the registration form worked. No account was created as part of the check.
- GitHub's Public repository badge and MIT license link were verified in Brave. Documentation anchors were checked against the repository headings.
- nginx routing changes were inspected; nginx/Docker were not runtime-tested in this session.

The user selected **https://mixedlane.wesolves.in** as the production destination. Build defaults for canonical/social URLs, sitemap, robots, Docker, and Compose now use this origin, and a rebuild plus artifact assertions passed. The older `mixedlane.wesolves.dpdns.org` observation above remains historical research evidence, not the new target domain.

Release is prepared in [PR #13](https://github.com/wesolves/mixedlane/pull/13), based on current production `main`. The signed-in GitHub account has no merge control for the upstream repository; a maintainer must merge it. Dokploy's existing Mixedlane service builds from `main` with autodeploy enabled. The new HTTPS hostname is saved against service `web`, port `8080`, using the existing Let's Encrypt provider; Dokploy requires a redeploy to apply domain changes. The old hostname is retained.

DNS currently resolves the new hostname to `207.180.219.148`, and HTTPS returns 404. Dokploy's validator reports a mismatch against its private server/network addresses. Do **not** publish those private addresses in public DNS. The public reverse proxy/tunnel routing for the new hostname must reach the existing deployment, or the release must be deployed on the intended public host. Certificate issuance, production publication, and Search Console verification are not yet confirmed. Local build success is not evidence of publication, indexing, or a ranking improvement. See MIX-0010 for the release handoff.
