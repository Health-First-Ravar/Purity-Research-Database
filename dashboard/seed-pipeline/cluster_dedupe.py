#!/usr/bin/env python3
"""Cluster near-duplicate seed questions into canonical question families.

Input:  one or more JSONL files from scrape_faq.py / scrape_reddit.py / manual.
Output: clusters.jsonl — each row is a cluster with:
  {"canonical": str, "members": [str, ...], "source_urls": [...], "score": float}

Uses Voyage voyage-3-large embeddings + agglomerative clustering with cosine
distance. No LLM call. Next stage (generate_drafts.py) writes draft answers.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import numpy as np
import voyageai
from dotenv import load_dotenv
from sklearn.cluster import AgglomerativeClustering
from tqdm import tqdm


def load_jsonl(paths: list[str]) -> list[dict]:
    rows = []
    for p in paths:
        for line in Path(p).read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def embed_questions(vo: voyageai.Client, questions: list[str]) -> np.ndarray:
    embs: list[list[float]] = []
    for i in tqdm(range(0, len(questions), 32), desc="embed"):
        batch = questions[i : i + 32]
        res = vo.embed(batch, model="voyage-3-large", input_type="document")
        embs.extend(res.embeddings)
    return np.array(embs, dtype=np.float32)


def pick_canonical(members: list[dict]) -> str:
    """Shortest clean question usually reads best as canonical."""
    members_sorted = sorted(
        members,
        key=lambda m: (len(m["question"]), not m["question"].strip().endswith("?")),
    )
    return members_sorted[0]["question"].strip()


def main() -> None:
    load_dotenv()
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+", help="JSONL files to cluster")
    ap.add_argument("--out", default="clusters.jsonl")
    ap.add_argument("--threshold", type=float, default=0.22,
                    help="Cosine distance threshold; lower = tighter clusters")
    args = ap.parse_args()

    rows = load_jsonl(args.inputs)
    print(f"[load] {len(rows)} raw questions from {len(args.inputs)} files")

    # Dedupe exact-string
    uniq: dict[str, dict] = {}
    for r in rows:
        q = r["question"].strip()
        if q not in uniq:
            uniq[q] = r
        else:
            uniq[q].setdefault("urls", []).append(r.get("url"))
    rows = list(uniq.values())
    print(f"[dedupe] {len(rows)} after exact-string dedupe")

    vo = voyageai.Client(api_key=os.environ["VOYAGE_API_KEY"])
    embs = embed_questions(vo, [r["question"] for r in rows])

    # Normalize for cosine
    norms = np.linalg.norm(embs, axis=1, keepdims=True)
    embs_n = embs / np.clip(norms, 1e-9, None)

    # Agglomerative, cosine metric
    model = AgglomerativeClustering(
        n_clusters=None,
        distance_threshold=args.threshold,
        metric="cosine",
        linkage="average",
    )
    labels = model.fit_predict(embs_n)

    clusters: dict[int, list[dict]] = {}
    for row, label in zip(rows, labels):
        clusters.setdefault(int(label), []).append(row)

    out_rows = []
    for label, members in sorted(clusters.items(), key=lambda kv: -len(kv[1])):
        canonical = pick_canonical(members)
        urls = [m.get("url") for m in members if m.get("url")]
        sources = list({m.get("source") for m in members if m.get("source")})
        out_rows.append({
            "cluster_id": label,
            "canonical": canonical,
            "members": [m["question"] for m in members],
            "source_urls": urls,
            "sources": sources,
            "member_count": len(members),
        })

    Path(args.out).write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in out_rows))
    print(f"[done] {len(out_rows)} clusters → {args.out}")


if __name__ == "__main__":
    main()
