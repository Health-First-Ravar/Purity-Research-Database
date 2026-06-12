#!/usr/bin/env python3
"""
Ingest a Trugo/Farah-lab multi-coffee "grid" COA into one normalized JSON per coffee.

Accepts a .docx directly (preferred) OR the markdown-table text exported by Drive's
read_file_content. Run from the repo root:

    pip install python-docx
    python3 scripts/ingest_grid_coa.py "<doc.docx>" <report_date YYYY-MM-DD> [--matrix green|roasted] --out Processed

Examples (all four reports):
    A="Certificates of Analysis ALL TIME PURITY"
    python3 scripts/ingest_grid_coa.py "$A/Purity results october 2019 (1).docx"   2019-10-01 --out Processed
    python3 scripts/ingest_grid_coa.py "$A/Purity results - January - 2023 (1).docx" 2023-01-01 --out Processed
    python3 scripts/ingest_grid_coa.py "$A/Purity results - October 2024.docx"        2024-10-04 --out Processed
    python3 scripts/ingest_grid_coa.py "$A/Purity results - January - 2025.docx"      2025-01-01 --out Processed

Green/roasted is inferred from section headings ("Green coffee samples",
"Roasted/Ground and roasted coffee samples"); for the 2019 single-table layout it
falls back to per-row inference (a sample named "Green ..." is green). Pass
--matrix only to force a whole single-matrix doc.

Column sets vary (lactones only for roasted, units in the header or in a separate
row, optional per-serving table), so the parser keys on HEADER TEXT, not position,
and pairs summary+CGA tables by row order within a section.

Emits Processed-schema JSONs named RESEARCH-<YYYY-MM>-<slug>.json
"""
import sys, re, json, hashlib, datetime, os, argparse, unicodedata

LAB = ("Laboratorio de Quimica e Bioatividade de Alimentos & Nucleo de Pesquisa "
       "em Cafe Prof. Luiz Carlos Trugo (UFRJ)")

def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

def num(s):
    """Mean value from a 'x +/- y' / 'Nd' / '---' / '*x' cell."""
    s = s.strip().lstrip('*').strip()
    if s.lower() in ('nd', '---', '-', '', 'n/a'):
        return None
    s = s.split('±')[0].strip()
    m = re.match(r'[-+]?\d+(?:\.\d+)?', s)
    return float(m.group()) if m else None

def cells(line):
    return [c.strip() for c in line.strip().strip('|').split('|')]

def is_sep(row):
    return all(re.fullmatch(r':?-{1,}:?', c or '-') or c == '' for c in row)

def docx_to_md(path):
    """Flatten a .docx to the markdown-table text the parser consumes, preserving
    paragraph headings (for green/roasted detection) interleaved with tables."""
    import docx
    from docx.oxml.ns import qn
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    d = docx.Document(path)
    out = []
    for child in d.element.body.iterchildren():
        if child.tag == qn('w:p'):
            t = Paragraph(child, d).text.strip()
            if t:
                out.append(t)
        elif child.tag == qn('w:tbl'):
            for row in Table(child, d).rows:
                cs = [c.text.strip().replace('\n', ' ') for c in row.cells]
                out.append('| ' + ' | '.join(cs) + ' |')
            out.append('')  # blank line separates adjacent tables into distinct blocks
    return '\n'.join(out)

def analyte(name, panel, val, reported, unit):
    return {"analyte": name, "panel": panel, "value_normalized": val,
            "unit_normalized": unit, "value_as_reported": reported,
            "unit_as_reported": unit, "method": None, "loq": None,
            "retest_sequence": 0}

def parse(md, report_date, src_name, src_hash, forced_matrix=None):
    lines = md.splitlines()
    matrix = forced_matrix
    serving_next = False
    tables = []
    i = 0
    while i < len(lines):
        ln = lines[i]
        if ln.strip().startswith('|'):
            block = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                row = cells(lines[i])
                if not is_sep(row):
                    block.append(row)
                i += 1
            if not block:
                continue
            hidx = next((k for k, r in enumerate(block)
                         if r and 'coffee sample' in r[0].lower()), 0)
            header = block[hidx]
            rows = block[hidx + 1:]
            h = [c.lower() for c in header]
            if any('water content' in c for c in h):
                kind = 'summary'
            elif any(c.replace(' ', '').startswith('3-cqa') for c in h):
                kind = 'cga'
            elif serving_next or (len(header) == 4 and 'caffeine' in h[1] and 'total cga' in h[3]):
                kind = 'serving'
            else:
                kind = 'unknown'
            tables.append({'matrix': matrix, 'kind': kind, 'header': header, 'rows': rows})
            serving_next = False
            continue
        t = ln.strip().lower()
        if t:
            if 'per serving' in t:
                serving_next = True
            elif 'green' in t:
                matrix = 'green'
            elif 'roasted' in t or 'ground and roasted' in t:
                matrix = 'roasted'
        i += 1

    sections = []
    cur = None
    for t in tables:
        if t['kind'] == 'summary':
            cur = {'matrix': t['matrix'], 'summary': t, 'cga': None, 'serving': None}
            sections.append(cur)
        elif t['kind'] == 'cga' and cur is not None:
            cur['cga'] = t
        elif t['kind'] == 'serving' and cur is not None:
            cur['serving'] = t

    records = []
    for sec in sections:
        srows = sec['summary']['rows']
        shdr = sec['summary']['header']
        crows = sec['cga']['rows'] if sec['cga'] else []
        chdr = sec['cga']['header'] if sec['cga'] else []
        serving_map = {}
        if sec['serving']:
            for r in sec['serving']['rows']:
                serving_map[r[0].strip().lower()] = (sec['serving']['header'], r)
        n = len(srows)
        cmap = None
        if sec['cga'] and len(crows) != n:
            cmap = {r[0].strip().lower(): r for r in crows}
        for idx, sr in enumerate(srows):
            name = sr[0].strip()
            matrix = sec['matrix']
            if matrix is None:
                matrix = 'green' if name.lower().startswith('green') else 'roasted'
            A = []
            seen = set()
            for ci, htext in enumerate(shdr[1:], start=1):
                hl = htext.lower()
                raw = sr[ci] if ci < len(sr) else ''
                if 'water content' in hl and 'water' not in seen:
                    seen.add('water'); A.append(analyte("Water content", "moisture", num(raw), raw, "%"))
                elif 'agtron' in hl and 'agtron' not in seen:
                    seen.add('agtron')
                    if raw and raw not in ('-', ''):
                        A.append(analyte("Color by Agtron scale", "color", None, raw, ""))
                elif 'instrumental color' in hl and 'icolor' not in seen:
                    v = num(raw)
                    if v is not None:
                        seen.add('icolor'); A.append(analyte("Instrumental color", "color", v, raw, ""))
                elif 'caffeine' in hl and 'caf' not in seen:
                    seen.add('caf'); A.append(analyte("Caffeine", "alkaloids", num(raw), raw, "g/100g"))
                elif 'trigonelline' in hl and 'trig' not in seen:
                    seen.add('trig'); A.append(analyte("Trigonelline", "alkaloids", num(raw), raw, "g/100g"))
            star = False
            if sec['cga']:
                cr = cmap[name.lower()] if cmap is not None else crows[idx]
                for ci, htext in enumerate(chdr[1:], start=1):
                    raw = cr[ci] if ci < len(cr) else ''
                    if '*' in raw:
                        star = True
                    base = re.sub(r'\(.*?\)', '', htext).strip()
                    bl = base.lower().replace(' ', '')
                    if 'totalcql' in bl and '%cga' in htext.lower().replace(' ', ''):
                        m = re.match(r'\*?\s*([\d.]+)\s*/\s*([\d.]+)%', raw.strip().lstrip('*').strip())
                        if m:
                            A.append(analyte("Total CQL", "chlorogenic_acids", float(m.group(1)), raw, "mg/100g"))
                            A.append(analyte("Lactones as % of CGA", "chlorogenic_acids", float(m.group(2)), raw, "%"))
                    elif bl in ('totalcga',):
                        A.append(analyte("Total CGA", "chlorogenic_acids", num(raw), raw, "g/100g"))
                    elif base:
                        A.append(analyte(base, "chlorogenic_acids", num(raw), raw, "mg/100g"))
            serving_g = None
            if name.lower() in serving_map:
                shdr2, srv = serving_map[name.lower()]
                serving_g = 15.0
                for ci, htext in enumerate(shdr2[1:], start=1):
                    raw = srv[ci] if ci < len(srv) else ''
                    hl = htext.lower()
                    if 'caffeine' in hl:
                        A.append(analyte("Caffeine per serving", "alkaloids", num(raw), raw, "mg/serving"))
                    elif 'trigonelline' in hl:
                        A.append(analyte("Trigonelline per serving", "alkaloids", num(raw), raw, "mg/serving"))
                    elif 'total cga' in hl:
                        A.append(analyte("Total CGA per serving", "chlorogenic_acids", num(raw), raw, "mg/serving"))
            ym = report_date[:7]
            notes = ["grid COA: 1 of N coffees from a multi-sample Trugo/Farah research report",
                     "values are mean of mean+/-SD as reported"]
            if star:
                notes.append("* flagged: unusual lactone behaviour (per report footnote)")
            rec = {
                "schema_version": 1, "status": "UNRESOLVED", "product_key": None,
                "report_number": f"RESEARCH-{ym}-{slug(name)}",
                "test_date": report_date, "sample_name": name,
                "lot_or_po": None, "supersedes": None, "superseded_by": None,
                "lab": LAB, "serving_size_g": serving_g, "matrix": matrix,
                "source_file": f"COAs/{src_name}", "source_hash": src_hash,
                "parse_confidence": 0.9, "parse_notes": notes,
                "analytes": A,
                "ingested_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            }
            records.append(rec)
    return records

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('doc'); ap.add_argument('date')
    ap.add_argument('--matrix', default=None)
    ap.add_argument('--src', default=None)
    ap.add_argument('--out', default='Processed')
    a = ap.parse_args()
    if a.doc.lower().endswith('.docx'):
        md = docx_to_md(a.doc)
    else:
        md = open(a.doc, encoding='utf-8').read()
    src = a.src or os.path.basename(a.doc)
    src_hash = hashlib.sha256(md.encode()).hexdigest()[:16]
    recs = parse(md, a.date, src, src_hash, a.matrix)
    os.makedirs(a.out, exist_ok=True)
    for r in recs:
        json.dump(r, open(os.path.join(a.out, r['report_number'] + '.json'), 'w'),
                  indent=2, ensure_ascii=False)
        print(f"{r['report_number']:48} {r['matrix']:8} analytes={len(r['analytes'])}")
    print(f"TOTAL {len(recs)} records from {src} -> {a.out}/")

if __name__ == '__main__':
    main()
