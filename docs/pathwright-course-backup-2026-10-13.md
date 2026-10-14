# Pathwright course backup, 2026-10-13 (before the Research Hub rewrite)

Course: "How to Use the Purity Dashboard: Step-by-Step Guide (SOP)"
https://puritylearningcafe.pathwright.com/library/how-to-use-the-purity-dashboard-step-by-step-guide-sop-246293/770112/path/

Plain-text copy of every step as it stood before the rewrite (formatting and
images not kept; image captions kept). Taken from the Design view.

## Sections

1. Getting Started & Everyday Use: Understand what the Purity Dashboard is, who uses it, and what you'll need before you begin.
2. For Editors: For editors: the escalation queue, Canon, Heatmap, Assign products, and the Atlas knowledge map.
3. For Admins & Troubleshooting: Admin-only tools (Ask Reva, Limits, Metrics, Users), the Manual update button, and how to fix common issues.

---

## 1.1 Read: About the Purity Dashboard (step 437475069)

Purpose: This Standard Operating Procedure (SOP) explains how to use the Purity Dashboard, Purity Coffee's internal web app, to answer customer questions, check product claims, and look up lab-test (COA) data.

Scope: Covers logging in, navigation, the Research Hub, Reports, the Customer-support snapshot, the Audit claim checker, and (for editors and admins) the answer library and research tools.

Audience: All dashboard users, Customer Service, Editors, and Admins.

Welcome to the Purity Dashboard Standard Operating Procedure (SOP). This guide teaches you how to use the Purity Dashboard, the coffee company's internal web app for answering customer questions, checking product claims, and exploring lab-test (COA) data.

What the dashboard is for: It brings together a customer-focused Research Hub (an AI assistant grounded in Purity's own knowledge base), a browser of Certificate of Analysis (COA) lab results, a claim-checking Audit tool, and editor/admin tools for maintaining the answer library and research corpus.

Roles and access (read this first): There are three roles, and each one sees a different set of pages. Knowing your role tells you which buttons you will and won't see, so you never hunt for something that isn't there. If a button seems to be missing, it is probably not missing, it is just not yours.

Customer Service: uses the Research Hub (chat), Reports (Purity products only, a smaller row count), the Customer-support snapshot, the Audit claim checker, and the Bibliography.

Editor: everything Customer Service has, plus the full Reports data, the Heatmap, Canon, the Editor queue, Assign products, and the Atlas knowledge map.

Admin: everything Editors have, plus Ask Reva, the Limits threshold editor, Metrics, and Users.

Pages you don't have access to will show a plain message such as "Admin role required" or "Editor role required." That is expected, not the app breaking. Nothing to report to IT. Throughout this guide, admin-only tools are collected in a clearly labeled appendix at the end.

---

## 1.2 Read: How to Log In and Reach the Dashboard (step 437475164)

The Purity Dashboard is a web app you reach in your browser. Sign in with your email and password.

How to log in:

Step 1: Open your browser and go to the Purity Dashboard URL your organization gave you (currently https://purity-dashboard-three.vercel.app). Bookmark it so it is easy to find next time. Your future self will thank you.

Step 2: On the login screen, enter your registered email address.

Step 3: Enter your password, then click Sign in. You will land on the Research Hub (the chat page) if you are Customer Service or Admin, or on the appropriate starting page for your role.

Forgot your password: Click the "Forgot password?" link on the login screen. The system emails you a reset link. Follow it to set a new password, then sign in again.

Getting an account (invite only): You cannot self-register. An admin invites you from the Users page using your email and assigns your role. You then receive a magic link, click it, and set your own password. After that, you sign in normally with email and password.

Good to know: There is no Google sign-in or single sign-on (SSO), and no two-factor code step. If you are shown anything beyond email and password, check with your admin, we keep this deliberately boring. To sign out, use the Sign out button at the top right of the dashboard.

---

## 1.3 Read: A Tour of the Dashboard Layout (step 437475165)

This lesson covers how to move around the dashboard and how to use the Research Hub, the daily tool for Customer Service.

[Image] Caption: The Research Hub (/chat): type a customer-service or research question and read the answer.

The top navigation: Along the top you will see the main pages you can reach. Depending on your role these include Research Hub, Reports, Assign products, and Audit, plus dropdown groups: Customer Questions (Heatmap, Canon, Editor queue), Research (Ask Reva, Bibliography, Atlas), and Admin (Metrics, Users). You only see what your role allows. The top bar also has a light/dark theme toggle, a Manual update button, and Sign out.

The Research Hub (the /chat page): This is where Customer Service and Admins ask the assistant customer-service and research questions. Type a question and read the answer. As we continue to roll out this App please remember to check your answers and never blindly accept anything the chat gives you, this is a tool not a fully vetted repository of knowledge.

How answers are built: The assistant checks a curated question-and-answer library (called Canon) first. If a good curated answer exists, it returns that for a fast, consistent reply. Otherwise it draws on Purity's research corpus (brand docs, research papers, curated Q&A) and generates an answer, with its sources listed underneath.

Giving feedback: Every turn is logged. You can give a thumbs up or thumbs down on each answer, which helps editors improve the library.

Escalation (important for Customer Service): A turn is automatically flagged when the assistant reports it does not have enough evidence, or its confidence drops below a set threshold. The reply then shows that it has been escalated to Ildi or Jeremy, and that turn moves into the Editor queue. When you see an escalation flag, treat that answer as "needs verification" before you relay anything to a customer. An escalation is the system working as intended, it is flagging its own uncertainty so a human can double-check, not breaking. Customer Service does not action the queue; editors handle it.

Other useful controls: Use Reset conversation to start fresh. The assistant only remembers roughly the last few turns of context, so for a new topic a reset keeps answers focused. If it seems to have forgotten what you were talking about, it has, and a reset is the fix, not a bug report. Suggested prompts are provided to show the kinds of questions it handles well.

---

## 1.4 Read: Reports, the Support Snapshot & the Audit Tool (step 437475185)

[Image] Caption: Reports: filter by blend, origin, lab, and date, pick analytes, then Apply or Download CSV. The matching count shown reflects the Customer Service scope (Purity products only).

[Image] Caption: Customer-support snapshot: one row per lot, showing the three value-states and OVER LIMIT / BELOW MINIMUM badges. Don't interpret a flag for a customer, send the product, lot, and date to an editor.

This lesson covers the tools you use most often to look up product facts and check claims: Reports, the Customer-support snapshot, and the Audit claim checker.

Reports (the COA browser): Reports is where lab-test results live. "COA" means Certificate of Analysis, the lab report for a coffee lot. Use it to look up results by blend, coffee, origin, lab, or date, chart one or more analytes (such as Ochratoxin A, caffeine, or CGAs), and export a CSV.

How to use Reports:
- Set the filters you need (blend, green vs. roasted, origin, lab, and date range).
- Optionally, type a term in the search box to narrow results.
- Pick one or more analytes to chart (or leave on "All analytes").
- Click Apply to run the report.
- Click Download CSV to export, or Clear filters to start over.

Note: The page displays a limited number of rows at once, narrow your filters if you need to see more.

What you will see by role: Customer Service sees Purity products only (a smaller set). Editors and Admins see everything (the full set of lab reports). Seeing fewer rows as Customer Service is an intentional safety scope, not a failure. You are seeing fewer rows on purpose. It is a guardrail, not you doing something wrong.

Reading the data correctly: A dash or "Not tested" means the analyte was not measured for that lot. It does not mean zero. "Not detected" means it was measured but fell below the lab's reporting limit. Keep these distinct when you talk to customers.

Customer-support snapshot (/reports/support): This is the Customer-Service-safe view and your go-to for customer questions. It shows one row per tested lot, Purity products only (competitor lab reports are deliberately excluded), and never combines values across lots. Each contaminant result shows in one of three states: a measured value, "Not detected" (below the reporting limit), or "Not tested" (absent). Out-of-spec results show a badge: "OVER LIMIT" or "BELOW MINIMUM".

Important rule: If you see an OVER LIMIT or BELOW MINIMUM flag, do not interpret it for the customer yourself. The page says as much. Send the product, lot, and date to an editor and let them handle it.

Audit (the Claim Auditor, /audit): Available to every role, and genuinely worth the few seconds it takes. Paste a draft health sentence (a claim you are thinking of telling a customer or putting in copy) and it runs a four-layer check (mechanism, bioavailability, evidence, and practical), lists any regulatory flags, assigns an evidence tier, and returns a compliance-safe rewrite. Use it before you publish or say a health claim.

[Image] Caption: The Claim Auditor (/audit): paste a draft health sentence and it returns regulatory flags, an evidence tier, and a compliance-safe rewrite. Use it before saying or publishing a health claim.

---

## 2.1 Read: Viewing and Exporting Reports (step 437475073)

[Image] Caption: Bibliography (/bibliography): the research catalog with full-text semantic search and citation export. Available to Customer Service too.

This lesson is for Editors (and Admins). It covers the tools that keep the answer library and research corpus healthy. Customer Service users will not see these pages.

The core editor loop: escalated question, to reviewed answer, to Canon. Most editor work flows through three linked pages in the Customer Questions group.

Editor queue (/editor): This is the escalation queue. Every turn that got flagged in the Research Hub lands here. As an editor you read each one and either label it good or bad, answer it directly, or promote a corrected version into Canon. A promoted answer is saved as a draft first, so it gets a review pass before it goes live. This loop is the heart of the system.

[Image] Caption: Editor queue (/editor): escalated turns land here with confidence scores; label good/bad, answer, or promote to Canon.

Canon (/editor/canon): The curated question-and-answer library. The Research Hub checks Canon first, so a well-written Canon entry short-circuits the model and gives customers fast, consistent answers. Keep entries accurate and clear.

Heatmap (/heatmap): Shows where customers are asking questions versus where the curated library is thin. Tiles represent topics or compounds with a 30-day question count and a coverage indicator: a filled corner means Canon exists, a hollow ring means there is a gap. Use it to decide which answers to write next.

[Image] Caption: Canon (/editor/canon): the curated Q&A library, organized into Gaps, Drafts, Active, and Deprecated. Promoted answers start as drafts and are reviewed before going live.

[Image] Caption: Heatmap (/heatmap): topic tiles show 30-day question volume and coverage. A filled corner means Canon exists; a hollow ring marks a gap to fill.

[Image] Caption: Assign products (/reports/assign): map unlinked COAs to a Purity blend, grouped into buckets. Suggestions are proposals only - confirm each, and remember a blank Blend is often correct (green-coffee and R&D lots stay unclassified).

[Image] Caption: Atlas (/atlas, staff only): the Knowledge Atlas maps the research corpus into stable branches with curated cross-links. Click a branch to expand its papers; editors can drag nodes and save the layout.

Assign products (/reports/assign): The classification queue. Many COAs are not yet linked to a Purity product, so their Blend column is blank. Use this page to map a lot or report to a blend. Important: a blank Blend is often correct. Green-coffee and R&D lots are meant to stay unclassified, so the goal is not "zero unclassified" - only classify what genuinely belongs to a Purity product. Resist the urge to classify everything, a tidy-looking zero is not the goal.

Atlas (/atlas, staff only): The Knowledge Atlas, a visual map of the research corpus. It has around two dozen stable branches (for example Mycotoxin science, Bioactives, Cardiovascular, Hepatic) with curated cross-links and papers mapped under each. Editors can drag nodes to rearrange the map and save the layout, and route unmapped sources through a triage page. Customer Service cannot open Atlas. This is a work in progress. The goal is for researcher and the learning team to realize and discover unique correlations between subjects, As an editor or admin feel free the browse.

---

## 3.1 Read: Common Issues and How to Get Help (step 437475074)

This final lesson covers the admin-only tools, the Manual update button, and common troubleshooting.

ADMIN-ONLY APPENDIX (you will only see these pages if you are an Admin)

Ask Reva (/reva): A research and content tool built around "Reva," a health-first coffee-expert persona that carries the brand voice, the evidence hierarchy, and the health-claim compliance rules. It has three modes: Create (draft newsletters, modules, or copy), Analyze (reason through a study, claim, or data question), and Challenge (pressure-test a claim). It is for internal research and content work, not for customers.

A naming note to avoid confusion: the "Reva" name appears in three places. This admin research tool; a small floating "Ask Reva" helper (the bottom-left "R") that any role can open but which only explains where to click; and the customer chat, which answers "as Reva would." They are different things.

Limits (/reports/limits): The editor for the threshold table that drives the OVER LIMIT and BELOW MINIMUM badges in the Customer-support snapshot. Changing a threshold here changes how results are flagged, so edit with care.

Metrics (/metrics): Chat-usage rollups. Be aware this currently reads a near-empty table and is not yet meaningful, so do not rely on it for decisions right now. In other words, do not read tea leaves in it yet.

Users (/editor/users): Invite people by email and role, change someone's role, and see last sign-in. This ishow new accounts are created (invite-only).

THE MANUAL UPDATE BUTTON (top bar)

The Manual update button triggers a real data ingestion/sync job. It is editor-only and rate-limited to just 3 uses per day globally, shared across everyone, resetting at midnight UTC. It is not destructive, but it spends a limited shared quota. Guidance: know what it does, but do not click it casually or just to take a screenshot. If you genuinely need to run it, click it once, knowingly. Treat it like the last slice of cake in the break room, only take it if you really mean to.

TROUBLESHOOTING

Cannot log in: Check your email and password and that Caps Lock is off. Use "Forgot password?" to reset; if the reset email does not arrive, check spam. Remember accounts are invite-only, so if you have never been invited, ask an admin to add you from Users.

A page says "Admin role required" or "Editor role required": This is normal. That page is above your role's access, not broken. Ask an admin if you believe you need access.

Customer Service sees fewer report rows than a colleague: This is expected. Customer Service is intentionally scoped to Purity products only.

Blank Blend column, dashes, or "Not tested": These are normal and meaningful. A blank Blend can be correct (green/R&D lots), and a dash or "Not tested" means not measured - not zero.

An answer shows an escalation flag: Treat it as needs-verification. Customer Service should not relay it as-is; editors handle the queue.

Getting help: For a contaminant limit flag or anything you are unsure about, route the product, lot, and date to an editor. For access or account issues, contact an admin.
