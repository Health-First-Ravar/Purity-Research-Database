#!/usr/bin/env python3
"""Scrape Purity Coffee's FAQ + support pages into seed_questions.jsonl.

Output rows (one per line):
  {"question": str, "answer": str, "source": str, "url": str, "tags": [str]}

These become draft canon_qa rows after clustering + human review.
"""
from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": (
        "purity-dashboard-seed/0.1 (+https://puritycoffee.com; seed pipeline)"
    )
}

# Candidate pages. Add/remove as Purity's site structure evolves.
SEED_URLS = [
    "https://puritycoffee.com/pages/faq",
    "https://puritycoffee.com/pages/faqs",
    "https://puritycoffee.com/pages/about",
    "https://puritycoffee.com/pages/our-story",
    "https://puritycoffee.com/pages/shipping",
    "https://puritycoffee.com/pages/subscription",
    "https://puritycoffee.com/pages/testing",
    "https://puritycoffee.com/pages/health",
    "https://puritycoffee.com/pages/contact",
    "https://puritycoffee.com/pages/our-coffee",
    "https://puritycoffee.com/collections/coffee",
]


def fetch(url: str) -> str | None:
    try:
        r = requests.get(url, headers=HEADERS, timeout=20)
        if r.status_code == 200:
            return r.text
        print(f"[skip {r.status_code}] {url}")
    except Exception as e:
        print(f"[err] {url}: {e}")
    return None


def extract_qas(html: str, url: str) -> list[dict]:
    """Pull Q/A pairs from common FAQ markup patterns used on Shopify pages."""
    soup = BeautifulSoup(html, "lxml")
    out: list[dict] = []

    # Pattern A: <details><summary>Q</summary>A</details>
    for d in soup.find_all("details"):
        q = d.find("summary")
        if not q:
            continue
        q_text = q.get_text(" ", strip=True)
        # The answer is everything in <details> except the summary
        q.extract()
        a_text = d.get_text(" ", strip=True)
        if q_text and a_text:
            out.append({"question": q_text, "answer": a_text, "source": "purity_faq", "url": url, "tags": []})

    # Pattern B: headings followed by paragraphs (h2/h3 → p+)
    for h in soup.find_all(["h2", "h3", "h4"]):
        q_text = h.get_text(" ", strip=True)
        if not q_text or len(q_text) < 8 or not q_text.endswith("?"):
            continue
        parts: list[str] = []
        sib = h.find_next_sibling()
        while sib and sib.name not in {"h2", "h3", "h4"}:
            if sib.name in {"p", "ul", "ol", "div"}:
                t = sib.get_text(" ", strip=True)
                if t:
                    parts.append(t)
            sib = sib.find_next_sibling()
        if parts:
            out.append({"question": q_text, "answer": " ".join(parts), "source": "purity_faq", "url": url, "tags": []})

    # Pattern C: accordion-like .faq-question / .faq-answer class combos
    for q_el in soup.select(".faq-question, .accordion__question, .faq__question"):
        a_el = q_el.find_next(class_=re.compile("(faq-answer|accordion__answer|faq__answer)"))
        q_text = q_el.get_text(" ", strip=True)
        a_text = a_el.get_text(" ", strip=True) if a_el else ""
        if q_text and a_text:
            out.append({"question": q_text, "answer": a_text, "source": "purity_faq", "url": url, "tags": []})

    # Dedupe within page by normalized question
    seen: set[str] = set()
    deduped = []
    for row in out:
        key = re.sub(r"\s+", " ", row["question"].lower()).strip()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


def find_more_links(html: str, base: str) -> list[str]:
    soup = BeautifulSoup(html, "lxml")
    found: set[str] = set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        text = a.get_text(" ", strip=True).lower()
        if any(k in text for k in ("faq", "help", "shipping", "returns", "testing", "health")):
            full = urljoin(base, href)
            if "puritycoffee.com" in full:
                found.add(full.split("#")[0])
    return sorted(found)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="seed_questions.jsonl", help="Output JSONL path")
    ap.add_argument("--follow", action="store_true", help="Also follow help-like links found on seed pages")
    args = ap.parse_args()

    rows: list[dict] = []
    seen_urls: set[str] = set()

    queue = list(SEED_URLS)
    while queue:
        url = queue.pop(0)
        if url in seen_urls:
            continue
        seen_urls.add(url)
        html = fetch(url)
        if not html:
            continue
        page_rows = extract_qas(html, url)
        rows.extend(page_rows)
        print(f"[ok] {url}: {len(page_rows)} Q/A")
        if args.follow:
            for more in find_more_links(html, url):
                if more not in seen_urls:
                    queue.append(more)
        time.sleep(0.5)  # be polite

    out_path = Path(args.out)
    out_path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows))
    print(f"\n[done] {len(rows)} Q/A rows → {out_path}")


if __name__ == "__main__":
    main()
