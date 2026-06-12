#!/usr/bin/env python3
"""Ingest a Trugo/Farah-lab multi-coffee grid COA -> one JSON per coffee.
Accepts .docx directly or read_file_content markdown. Run from repo root:
  python3 scripts/ingest_grid_coa.py "<doc.docx>" YYYY-MM-DD [--matrix green|roasted] --out Processed
"""
import re, json, hashlib, datetime, os, argparse, unicodedata

LAB = ("Laboratorio de Quimica e Bioatividade de Alimentos & Nucleo de Pesquisa "
       "em Cafe Prof. Luiz Carlos Trugo (UFRJ)")

def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

def num(s):
    s = s.strip().lstrip('*').strip()
    if s.lower() in ('nd', '---', '-', '', 'n/a'): return None
    s = s.split('±')[0].strip()
    m = re.match(r'[-+]?\d+(?:\.\d+)?', s)
    return float(m.group()) if m else None

def cells(line): return [c.strip() for c in line.strip().strip('|').split('|')]
def is_sep(row): return all(re.fullmatch(r':?-{1,}:?', c or '-') or c == '' for c in row)

def docx_to_md(path):
    import docx
    from docx.oxml.ns import qn
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    d = docx.Document(path); out = []
    for child in d.element.body.iterchildren():
        if child.tag == qn('w:p'):
            t = Paragraph(child, d).text.strip()
            if t: out.append(t)
        elif child.tag == qn('w:tbl'):
            for row in Table(child, d).rows:
                cs = [c.text.strip().replace('\n', ' ') for c in row.cells]
                out.append('| ' + ' | '.join(cs) + ' |')
            out.append('')
    return '\n'.join(out)

def analyte(name, panel, val, rep, unit):
    return {"analyte": name, "panel": panel, "value_normalized": val,
            "unit_normalized": unit, "value_as_reported": rep, "unit_as_reported": unit,
            "method": None, "loq": None, "retest_sequence": 0}

def parse(md, date, src, sh, fm=None):
    lines = md.splitlines(); matrix = fm; serving_next = False; tables = []; i = 0
    while i < len(lines):
        ln = lines[i]
        if ln.strip().startswith('|'):
            block = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                r = cells(lines[i])
                if not is_sep(r): block.append(r)
                i += 1
            if not block: continue
            hidx = next((k for k, r in enumerate(block) if r and 'coffee sample' in r[0].lower()), 0)
            header = block[hidx]; rows = block[hidx+1:]; h = [c.lower() for c in header]
            if any('water content' in c for c in h): kind = 'summary'
            elif any(c.replace(' ', '').startswith('3-cqa') for c in h): kind = 'cga'
            elif serving_next or (len(header) == 4 and 'caffeine' in h[1] and 'total cga' in h[3]): kind = 'serving'
            else: kind = 'unknown'
            tables.append({'matrix': matrix, 'kind': kind, 'header': header, 'rows': rows})
            serving_next = False; continue
        t = ln.strip().lower()
        if t:
            if 'per serving' in t: serving_next = True
            elif 'green' in t: matrix = 'green'
            elif 'roasted' in t or 'ground and roasted' in t: matrix = 'roasted'
        i += 1
    sections = []; cur = None
    for t in tables:
        if t['kind'] == 'summary':
            cur = {'matrix': t['matrix'], 'summary': t, 'cga': None, 'serving': None}; sections.append(cur)
        elif t['kind'] == 'cga' and cur: cur['cga'] = t
        elif t['kind'] == 'serving' and cur: cur['serving'] = t
    records = []
    for sec in sections:
        srows = sec['summary']['rows']; shdr = sec['summary']['header']
        crows = sec['cga']['rows'] if sec['cga'] else []; chdr = sec['cga']['header'] if sec['cga'] else []
        smap = {}
        if sec['serving']:
            for r in sec['serving']['rows']: smap[r[0].strip().lower()] = (sec['serving']['header'], r)
        cmap = {r[0].strip().lower(): r for r in crows} if (sec['cga'] and len(crows) != len(srows)) else None
        for idx, sr in enumerate(srows):
            name = sr[0].strip(); matrix = sec['matrix']
            if matrix is None: matrix = 'green' if name.lower().startswith('green') else 'roasted'
            A = []; seen = set()
            for ci, ht in enumerate(shdr[1:], start=1):
                hl = ht.lower(); raw = sr[ci] if ci < len(sr) else ''
                if 'water content' in hl and 'w' not in seen: seen.add('w'); A.append(analyte("Water content","moisture",num(raw),raw,"%"))
                elif 'agtron' in hl and 'ag' not in seen:
                    seen.add('ag')
                    if raw and raw not in ('-', ''): A.append(analyte("Color by Agtron scale","color",None,raw,""))
                elif 'instrumental color' in hl and 'ic' not in seen:
                    v = num(raw)
                    if v is not None: seen.add('ic'); A.append(analyte("Instrumental color","color",v,raw,""))
                elif 'caffeine' in hl and 'cf' not in seen: seen.add('cf'); A.append(analyte("Caffeine","alkaloids",num(raw),raw,"g/100g"))
                elif 'trigonelline' in hl and 'tg' not in seen: seen.add('tg'); A.append(analyte("Trigonelline","alkaloids",num(raw),raw,"g/100g"))
            star = False
            if sec['cga']:
                cr = cmap[name.lower()] if cmap is not None else crows[idx]
                for ci, ht in enumerate(chdr[1:], start=1):
                    raw = cr[ci] if ci < len(cr) else ''
                    if '*' in raw: star = True
                    base = re.sub(r'\(.*?\)', '', ht).strip(); bl = base.lower().replace(' ', '')
                    if 'totalcql' in bl and '%cga' in ht.lower().replace(' ', ''):
                        m = re.match(r'\*?\s*([\d.]+)\s*/\s*([\d.]+)%', raw.strip().lstrip('*').strip())
                        if m:
                            A.append(analyte("Total CQL","chlorogenic_acids",float(m.group(1)),raw,"mg/100g"))
                            A.append(analyte("Lactones as % of CGA","chlorogenic_acids",float(m.group(2)),raw,"%"))
                    elif bl == 'totalcga': A.append(analyte("Total CGA","chlorogenic_acids",num(raw),raw,"g/100g"))
                    elif base: A.append(analyte(base,"chlorogenic_acids",num(raw),raw,"mg/100g"))
            sg = None
            if name.lower() in smap:
                sh2, srv = smap[name.lower()]; sg = 15.0
                for ci, ht in enumerate(sh2[1:], start=1):
                    raw = srv[ci] if ci < len(srv) else ''; hl = ht.lower()
                    if 'caffeine' in hl: A.append(analyte("Caffeine per serving","alkaloids",num(raw),raw,"mg/serving"))
                    elif 'trigonelline' in hl: A.append(analyte("Trigonelline per serving","alkaloids",num(raw),raw,"mg/serving"))
                    elif 'total cga' in hl: A.append(analyte("Total CGA per serving","chlorogenic_acids",num(raw),raw,"mg/serving"))
            notes = ["grid COA: 1 of N coffees from a multi-sample Trugo/Farah research report",
                     "values are mean of mean+/-SD as reported"]
            if star: notes.append("* flagged: unusual lactone behaviour (per report footnote)")
            records.append({"schema_version":1,"status":"UNRESOLVED","product_key":None,
                "report_number":f"RESEARCH-{date[:7]}-{slug(name)}","test_date":date,"sample_name":name,
                "lot_or_po":None,"supersedes":None,"superseded_by":None,"lab":LAB,"serving_size_g":sg,
                "matrix":matrix,"source_file":f"COAs/{src}","source_hash":sh,"parse_confidence":0.9,
                "parse_notes":notes,"analytes":A,
                "ingested_at":datetime.datetime.now(datetime.timezone.utc).isoformat()})
    return records

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('doc'); ap.add_argument('date'); ap.add_argument('--matrix', default=None)
    ap.add_argument('--src', default=None); ap.add_argument('--out', default='Processed')
    a = ap.parse_args()
    md = docx_to_md(a.doc) if a.doc.lower().endswith('.docx') else open(a.doc, encoding='utf-8').read()
    src = a.src or os.path.basename(a.doc); sh = hashlib.sha256(md.encode()).hexdigest()[:16]
    recs = parse(md, a.date, src, sh, a.matrix); os.makedirs(a.out, exist_ok=True)
    for r in recs:
        json.dump(r, open(os.path.join(a.out, r['report_number']+'.json'), 'w'), indent=2, ensure_ascii=False)
        print(f"{r['report_number']:48} {r['matrix']:8} analytes={len(r['analytes'])}")
    print(f"TOTAL {len(recs)} records from {src} -> {a.out}/")

if __name__ == '__main__':
    main()
