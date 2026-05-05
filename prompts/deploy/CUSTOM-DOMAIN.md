# Custom Domain Setup — GoDaddy → Vercel

Point a memorable URL like `dashboard.puritycoffee.com` at the deployed app
instead of the default `purity-lab-data.vercel.app`. About 15 minutes of
work and either $0 or $10-20/year depending on which path you pick.

---

## Decision tree (start here)

**You already own `puritycoffee.com` at GoDaddy.** That gives you three options.

| Option | What you get | Annual cost | Recommended? |
|---|---|---|---|
| **A. Subdomain of puritycoffee.com** | `dashboard.puritycoffee.com` (or `lab.`, `hub.`, `data.`, etc.) | **$0** | ✓ Best for internal/team-facing dashboard |
| **B. Buy a separate new domain** | `puritylabs.com` or similar | $10–22/yr | Only if you want clean marketing separation |
| **C. Use the apex `puritycoffee.com`** | The dashboard becomes the main site | $0 but you LOSE the marketing site | Don't — keeps the marketing site where it is |

**Recommendation: Option A.** A subdomain is invisible to customers if you
want it to be (no Google indexing, just for team use), and it inherits the
brand authority of the parent domain. Zero new cost.

---

## Option A — Add a subdomain (recommended path)

### Step 1: Pick a subdomain name

Some good options:

| Name | Why it works |
|---|---|
| `dashboard.puritycoffee.com` | Most descriptive; clear it's the operations app |
| `lab.puritycoffee.com` | Short, brand-aligned (Lab Data Intelligence) |
| `hub.puritycoffee.com` | Friendly, matches "Research Hub" naming |
| `data.puritycoffee.com` | Generic but clear |
| `inside.puritycoffee.com` | Hints at internal-tool status |

Pick one. The walkthrough below uses `dashboard.puritycoffee.com` as the
example; substitute your choice anywhere it appears.

### Step 2: Add the domain in Vercel first

1. Go to **vercel.com** → your project → **Settings** → **Domains**
2. Click **Add Domain**
3. Enter `dashboard.puritycoffee.com` (or your chosen name)
4. Vercel will tell you the DNS record it needs. For a subdomain, it's a
   **CNAME record** pointing at `cname.vercel-dns.com`
5. Leave this Vercel page open — you'll come back here in Step 4 to verify

### Step 3: Add the DNS record in GoDaddy

1. Log in at **godaddy.com**
2. Top-right **Account** menu → **My Products**
3. Find `puritycoffee.com` in the Domains list → click **DNS** (or three-dot menu → "Manage DNS")
4. Scroll down to the **Records** section → click **Add New Record**
5. Fill out:

   | Field | Value |
   |---|---|
   | Type | `CNAME` |
   | Name | `dashboard` (just the subdomain part — NOT the full URL) |
   | Value | `cname.vercel-dns.com` |
   | TTL | `1 Hour` (default is fine; lower = faster propagation) |

6. Click **Save**

### Step 4: Verify in Vercel

1. Go back to the Vercel Domains page (you left it open in Step 2)
2. Click the **Refresh** or **Verify** button next to your domain
3. Vercel polls DNS and confirms the CNAME is in place
4. Once verified, Vercel automatically:
   - Issues a free SSL certificate (Let's Encrypt)
   - Marks the domain as production-ready
   - Routes traffic from `dashboard.puritycoffee.com` to your app

### Step 5: Wait for propagation

DNS changes can take **5 minutes to 48 hours** to propagate globally.
GoDaddy is usually fast — most users see it working within 30 minutes.

To check status:

```bash
dig dashboard.puritycoffee.com CNAME +short
```

When this returns `cname.vercel-dns.com.` (with the trailing dot), DNS has
propagated. Visit `https://dashboard.puritycoffee.com` — you should see
the login page over HTTPS.

---

## Option B — Buy a new domain

If you decide you want a separate domain (e.g., for an external-facing
research tool that should look distinct from the main brand), here are the
options ranked by cost:

| Registrar | First year | Renewal | Notes |
|---|---|---|---|
| **Cloudflare Registrar** | ~$10 | ~$10 | At-cost pricing; need a Cloudflare account; cleanest DNS UI |
| **Namecheap** | $9–13 | $13–15 | Solid reputation, no aggressive upsells |
| **Vercel Domains** | $20+ | $20+ | Buy through Vercel CLI; auto-configures DNS; convenient but pricier |
| **GoDaddy** | $10–20 first year (often discounted), $18–22 renewal | Varies | Convenient if you keep everything in one account; aggressive upsells in checkout |
| **Squarespace Domains (was Google Domains)** | $12–20 | $12–20 | Stable, fair pricing |

**For Purity-relevant new domain ideas** (check availability before getting attached):

- `puritylabs.com` / `puritylabs.co`
- `healthgradecoffee.com`
- `circularhealthcoffee.com` (if CHC becomes its own brand surface)
- `coffeeintel.com`

**Once you buy a new domain**, the setup in Vercel is the same as Option A
except the DNS record is an **A record** (or **ALIAS/ANAME**) on the apex,
not a CNAME on a subdomain:

| Field | Value |
|---|---|
| Type | `A` |
| Name | `@` (the apex) |
| Value | `76.76.21.21` (Vercel's anycast IP — Vercel will tell you the current value when you add the domain) |

Vercel's UI will give you the exact DNS records to add. Follow what it
says rather than memorizing the IPs (Vercel changes them occasionally).

---

## Cost summary

| Scenario | Year 1 cost | Recurring |
|---|---|---|
| Subdomain of puritycoffee.com (Option A) | **$0** | $0 |
| Subdomain + cheaper registrar for puritycoffee.com renewal | -$5/yr (transfer to Cloudflare) | $10/yr saved |
| New domain via Cloudflare Registrar | $10 | $10/yr |
| New domain via GoDaddy | $10-20 (often promo) | $18-22/yr |
| Vercel app hosting (separate, FYI) | $0 (free tier) | $0 unless you exceed free tier |
| SSL certificate | $0 (Let's Encrypt via Vercel) | $0 |

---

## Optional: lower your GoDaddy renewal cost

GoDaddy typically charges $18-22/year for `.com` renewals. Cloudflare
Registrar charges at-cost (~$10/year, same domain). If you want to cut
your existing puritycoffee.com cost:

1. Sign up at **cloudflare.com** (free)
2. Add `puritycoffee.com` to your Cloudflare account (uses Cloudflare DNS
   instead of GoDaddy DNS)
3. Update GoDaddy's nameservers to point at Cloudflare's
4. Once DNS is on Cloudflare and stable, initiate a domain transfer from
   GoDaddy to Cloudflare Registrar
5. Pay one final year of registration to Cloudflare during the transfer
   (this extends your registration by one year)
6. Future renewals are at-cost

Don't do this if you're not comfortable managing DNS — keeping it at
GoDaddy is fine and the $8/year saving isn't worth the friction if DNS
isn't your thing.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Vercel says "Invalid Configuration" after adding the CNAME | Wait 30 minutes for DNS propagation. Check `dig dashboard.puritycoffee.com CNAME +short` returns `cname.vercel-dns.com.` |
| GoDaddy didn't accept the value with a trailing dot | GoDaddy strips the dot automatically. Save without it: just `cname.vercel-dns.com` |
| Browser shows "Not Secure" warning | SSL cert hasn't issued yet. Vercel takes 1-5 minutes after DNS verification. Refresh the Vercel domains page; it should show "Valid Configuration" with a lock icon |
| Browser shows old/cached version | Browser DNS cache. Quit and reopen the browser, or try in incognito/private window |
| Want to remove the subdomain later | Vercel: Settings → Domains → click the X on the domain. GoDaddy: DNS → delete the CNAME record |

---

## After it's working

Update these places to use the new URL:

- **Cheat sheet** (`prompts/sop/Purity-Lab-Data-CHEAT-SHEET.docx`) — Box 7 "Production" line
- **SOP** (`prompts/sop/Purity-Lab-Data-SOP.docx`) — Appendix B header + any URL references
- **MASTER-BUILD.md** — references to the production URL
- **Vercel project name** — purely cosmetic, but renaming makes the dashboard match
- **Email signatures, Slack profiles, internal links** — anywhere you've shared the old URL

The old `*.vercel.app` URL keeps working forever (Vercel doesn't take it
away), so nothing breaks during the transition.

---

## What this walkthrough doesn't cover

- **Email forwarding** for the new domain (e.g., `dashboard@puritycoffee.com`).
  GoDaddy includes basic email forwarding free with most domain plans;
  configure under Email & Office in your GoDaddy product list.
- **Wildcard certificates** (e.g., `*.puritycoffee.com`). Vercel supports
  these via paid Pro plan; not needed for a single subdomain.
- **www subdomain**. If you ever want `www.dashboard.puritycoffee.com`,
  add a second CNAME record with Name = `www.dashboard` pointing at
  `cname.vercel-dns.com`. Vercel will handle the redirect.
