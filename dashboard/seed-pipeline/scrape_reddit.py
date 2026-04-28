#!/usr/bin/env python3
"""Seed-mine Reddit for real customer-style questions about coffee and health.

Pulls from r/Coffee, r/espresso, r/decaf, r/nutrition (coffee queries), r/Supplements.
Filters to question-shaped titles. Does NOT embed answers — only extracts the
*question* a real person asked, then Track-2 generate_drafts.py will produce
a Purity-voiced draft answer from the knowledge base.

Env: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT
"""
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

import praw
from dotenv import load_dotenv

QUERIES = [
    ("Coffee", "organic coffee health"),
    ("Coffee", "mold mycotoxin"),
    ("Coffee", "chlorogenic acid"),
    ("Coffee", "roast level health"),
    ("Coffee", "low acid coffee"),
    ("Coffee", "decaf swiss water"),
    ("espresso", "organic"),
    ("decaf", "healthy"),
    ("nutrition", "coffee"),
    ("Supplements", "coffee antioxidant"),
]

QUESTION_RE = re.compile(r"\?\s*$")


def is_question(title: str) -> bool:
    t = title.strip()
    if QUESTION_RE.search(t):
        return True
    lower = t.lower()
    return any(
        lower.startswith(w)
        for w in ("how ", "why ", "what ", "is ", "does ", "do ", "can ", "should ", "which ", "when ")
    )


def main() -> None:
    load_dotenv()
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="seed_reddit.jsonl")
    ap.add_argument("--limit", type=int, default=60, help="posts per query")
    args = ap.parse_args()

    reddit = praw.Reddit(
        client_id=os.environ["REDDIT_CLIENT_ID"],
        client_secret=os.environ["REDDIT_CLIENT_SECRET"],
        user_agent=os.environ.get("REDDIT_USER_AGENT", "purity-seed/0.1"),
    )

    rows: list[dict] = []
    seen: set[str] = set()
    for sub, query in QUERIES:
        try:
            for post in reddit.subreddit(sub).search(query, limit=args.limit, sort="relevance"):
                title = post.title.strip()
                if not is_question(title):
                    continue
                key = re.sub(r"\s+", " ", title.lower())
                if key in seen:
                    continue
                seen.add(key)
                rows.append({
                    "question": title,
                    "source": "reddit",
                    "subreddit": sub,
                    "url": f"https://reddit.com{post.permalink}",
                    "score": post.score,
                    "body": (post.selftext or "")[:2000],
                    "tags": [sub.lower()],
                })
            print(f"[ok] r/{sub} '{query}'")
        except Exception as e:
            print(f"[err] r/{sub} '{query}': {e}")

    Path(args.out).write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows))
    print(f"\n[done] {len(rows)} questions → {args.out}")


if __name__ == "__main__":
    main()
