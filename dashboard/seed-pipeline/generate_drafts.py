#!/usr/bin/env python3
"""Generate Purity-voiced draft answers for clustered seed questions.

Reads clusters.jsonl (from cluster_dedupe.py) and the local knowledge-base/
tree (via local Voyage embeddings against the KB .txt/.md corpus) to produce
seed_drafts.jsonl — ready for bulk-import as draft canon_qa rows.

Uses Claude Haiku 4.5 for drafts (cheap; editor reviews every draft before
promotion anyway).

Env: VOYAGE_API_KEY, ANTHROPIC_API_KEY
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import numpy as np
import voyageai
from anthropic import Anthropic
from dotenv import load_dotenv
from tqdm import tqdm

SYSTEM = """You are drafting Purity Coffee customer-service answers in the
voice Jeremy Rävar and Ildi Revi would use — precise, peer-level, warm, and
rigorous about evidence. Purity is a Certified B Corp, USDA Organic, third-
party tested. Blends: PROTECT, FLOW, EASE, CALM.

Rules:
  * Answer ONLY from the <evidence> chunks. Never invent COA numbers, prices,
    shipping dates, or study results.
  * Health language: "may support", "associated with", "research suggests".
    Never "prevents", "treats", "cures", "proven to".
  * If the evidence is insufficient, respond: "Not enough evidence in the
    current knowledge base — Ildi or Jeremy can follow up." Set
    insufficient_evidence=true.

Return ONLY JSON:
{"answer": "...", "insufficient_evidence": <bool>, "cited_sources": ["<path>", ...],
 "freshness_tier": "stable|weekly|batch"}
"""

KB_ROOT_DEFAULT = "/sessions/confident-sweet-brahmagupta/mnt/Purity-Lab-Data/knowledge-base"


def walk_kb(root: Path) -> list[tuple[str, str]]:
    """Return (rel_path, content) for every .md/.txt under root."""
    out = []
    for p in root.rglob("*"):
        if p.suffix.lower() in (".md", ".txt") and p.is_file():
            try:
                out.append((str(p.relative_to(root)), p.read_text(errors="ignore")))
            except Exception:
                pass
    return out


def chunk(text: str, max_chars: int = 3500, overlap: int = 500) -> list[str]:
    out = []
    i = 0
    while i < len(text):
        out.append(text[i : i + max_chars])
        i += max_chars - overlap
    return out


def build_index(vo: voyageai.Client, kb: list[tuple[str, str]]):
    chunks, paths = [], []
    for rel, txt in kb:
        for c in chunk(txt):
            chunks.append(c)
            paths.append(rel)
    print(f"[index] embedding {len(chunks)} chunks from {len(kb)} files")
    embs: list[list[float]] = []
    for i in tqdm(range(0, len(chunks), 32)):
        res = vo.embed(chunks[i : i + 32], model="voyage-3-large", input_type="document")
        embs.extend(res.embeddings)
    arr = np.array(embs, dtype=np.float32)
    arr = arr / np.clip(np.linalg.norm(arr, axis=1, keepdims=True), 1e-9, None)
    return chunks, paths, arr


def topk(vo: voyageai.Client, question: str, chunks: list[str], paths: list[str],
         arr: np.ndarray, k: int = 6):
    q_emb = np.array(
        vo.embed([question], model="voyage-3-large", input_type="query").embeddings[0],
        dtype=np.float32,
    )
    q_emb /= max(np.linalg.norm(q_emb), 1e-9)
    sims = arr @ q_emb
    idx = np.argsort(-sims)[:k]
    return [(paths[i], chunks[i], float(sims[i])) for i in idx]


def draft_one(client: Anthropic, question: str, evidence: list[tuple[str, str, float]]) -> dict:
    ev_block = "\n\n".join(
        f"--- {p} (sim={s:.3f}) ---\n{c}" for p, c, s in evidence
    )
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=800,
        system=SYSTEM,
        messages=[{"role": "user", "content": f"<evidence>\n{ev_block}\n</evidence>\n<question>{question}</question>"}],
    )
    text = "".join(b.text for b in msg.content if b.type == "text")
    s, e = text.find("{"), text.rfind("}")
    if s < 0 or e < 0:
        return {"answer": text.strip(), "insufficient_evidence": True,
                "cited_sources": [], "freshness_tier": "stable"}
    try:
        return json.loads(text[s : e + 1])
    except Exception:
        return {"answer": text.strip(), "insufficient_evidence": True,
                "cited_sources": [], "freshness_tier": "stable"}


def main() -> None:
    load_dotenv()
    ap = argparse.ArgumentParser()
    ap.add_argument("clusters", help="clusters.jsonl from cluster_dedupe.py")
    ap.add_argument("--kb", default=KB_ROOT_DEFAULT)
    ap.add_argument("--out", default="seed_drafts.jsonl")
    ap.add_argument("--min-members", type=int, default=1,
                    help="skip clusters with fewer members")
    ap.add_argument("--limit", type=int, default=500)
    args = ap.parse_args()

    vo = voyageai.Client(api_key=os.environ["VOYAGE_API_KEY"])
    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    kb = walk_kb(Path(args.kb))
    chunks, paths, arr = build_index(vo, kb)

    rows = []
    with open(args.clusters) as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    rows = [r for r in rows if r["member_count"] >= args.min_members][: args.limit]

    out = open(args.out, "w")
    for r in tqdm(rows, desc="draft"):
        q = r["canonical"]
        ev = topk(vo, q, chunks, paths, arr)
        draft = draft_one(client, q, ev)
        out.write(json.dumps({
            "question": q,
            "answer": draft.get("answer", ""),
            "insufficient_evidence": bool(draft.get("insufficient_evidence", False)),
            "cited_sources": draft.get("cited_sources", []),
            "freshness_tier": draft.get("freshness_tier", "stable"),
            "cluster_member_count": r["member_count"],
            "source_urls": r.get("source_urls", []),
            "retrieved_paths": [p for p, _, _ in ev],
        }, ensure_ascii=False) + "\n")
    out.close()
    print(f"[done] {len(rows)} drafts → {args.out}")


if __name__ == "__main__":
    main()
