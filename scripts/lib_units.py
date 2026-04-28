"""Unit normalization helpers.

Canonical units per architecture spec:
  chlorogenic acids       -> mg/100g
  heavy metals            -> ppb
  mycotoxins              -> ppb (consistent with heavy metals; override as needed)
  acrylamide              -> mcg/kg       (Eurofins default; no conversion)
  yeast / mold            -> CFU/g        (Eurofins default; no conversion)
  moisture                -> %            (pass-through)
  water activity (Aw)     -> unitless     (pass-through)
  gluten                  -> ppm          (pass-through — gluten is the one heavy-metal-ish analyte reported in ppm by convention)

Each normalization returns a tuple: (value_normalized, canonical_unit, original_value, original_unit).
Never mutate the original value — always store both alongside each other.
"""
from __future__ import annotations

import re
from typing import Optional, Tuple

Number = float
Norm = Tuple[Optional[Number], str, Optional[Number], str]


# ---------- helpers ----------

def _clean(value) -> Optional[float]:
    """Parse a numeric value; tolerate '<0.5', 'ND', '—', '10.6 (retest)', etc."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    if not s:
        return None
    low = s.lower()
    if low in {"nd", "n.d.", "not detected", "none detected", "—", "-", "na", "n/a"}:
        return 0.0  # non-detect; store as 0 but caller should preserve flag
    m = re.search(r"[-+]?\d*\.?\d+", s.replace(",", ""))
    if not m:
        return None
    return float(m.group(0))


def _unit(raw: Optional[str]) -> str:
    if not raw:
        return ""
    s = raw.strip().lower()
    # Strip Silliker-style "(w/w)" and "(v/v)" suffixes — they're concentration basis markers,
    # not part of the unit for normalization.
    s = re.sub(r"\(\s*(?:w/w|v/v|w/v)\s*\)", "", s).strip()
    return s.replace(" ", "").replace("μ", "mc")


# ---------- normalizers ----------

def normalize_cga(value, unit: str, serving_size_g: Optional[float] = None) -> Norm:
    """Chlorogenic acids -> mg/100g.

    Known inputs:
      mg/100g (canonical)
      mcg/g   (== mg/100g × 1/10 after conversion; mcg/g * 0.1 = mg/100g)
      mg/g    (== mg/100g × 10; mg/g * 100 = mg/100g... actually mg/g == 100 mg/100g)
      mg/Serving Size — requires serving_size_g (Eurofins: typically 15 g)
                         -> mg/100g = value / serving_size_g * 100
      %       (% w/w -> mg/100g: 1% = 1000 mg/100g)
    """
    v = _clean(value)
    u = _unit(unit)
    if v is None:
        return None, "mg/100g", None, unit or ""
    if u in {"mg/100g", "mg/100gram", "mg/100grams"}:
        return v, "mg/100g", v, unit
    if u in {"mcg/g", "ug/g", "μg/g"}:
        return v / 10.0, "mg/100g", v, unit
    if u in {"mg/g"}:
        return v * 100.0, "mg/100g", v, unit
    if u in {"%"}:
        return v * 1000.0, "mg/100g", v, unit
    if "servingsize" in u and serving_size_g:
        # mg/Serving Size -> mg/100g:  (mg/serving) / serving_g * 100
        if u.startswith("mcg") or u.startswith("ug"):
            return (v / 1000.0) / serving_size_g * 100.0, "mg/100g", v, unit
        if u.startswith("g/"):
            return (v * 1000.0) / serving_size_g * 100.0, "mg/100g", v, unit
        # default: mg/Serving Size
        return v / serving_size_g * 100.0, "mg/100g", v, unit
    # Silliker variants: "mg/dose", "mg/serving", "mcg/serving", "g/serving".
    # Eurofins uses 15g as the standard serving; Silliker COAs don't state one explicitly,
    # so fall back to serving_size_g if provided, otherwise 15g as the Purity-default.
    if u in {"mg/dose", "mg/serving"}:
        ssg = serving_size_g or 15.0
        return v / ssg * 100.0, "mg/100g", v, unit
    if u in {"mcg/dose", "mcg/serving", "ug/dose", "ug/serving"}:
        ssg = serving_size_g or 15.0
        return (v / 1000.0) / ssg * 100.0, "mg/100g", v, unit
    if u in {"g/dose", "g/serving"}:
        ssg = serving_size_g or 15.0
        return (v * 1000.0) / ssg * 100.0, "mg/100g", v, unit
    # unknown — pass through with original unit preserved, flag by returning raw
    return v, unit or "mg/100g", v, unit


def normalize_heavy_metal(value, unit: str) -> Norm:
    """Heavy metals -> ppb (µg/kg). ppm -> ppb is ×1000."""
    v = _clean(value)
    u = _unit(unit)
    if v is None:
        return None, "ppb", None, unit or ""
    if u in {"ppb", "mcg/kg", "ug/kg", "μg/kg"}:
        return v, "ppb", v, unit
    if u in {"ppm", "mg/kg"}:
        return v * 1000.0, "ppb", v, unit
    return v, unit or "ppb", v, unit


def normalize_mycotoxin(value, unit: str) -> Norm:
    """Mycotoxins (OTA, aflatoxins) -> ppb."""
    return normalize_heavy_metal(value, unit)


def normalize_passthrough(value, unit: str) -> Norm:
    v = _clean(value)
    return v, unit or "", v, unit or ""


ANALYTE_ROUTER = {
    # CGAs
    "chlorogenic acid": normalize_cga,
    "chlorogenic acids": normalize_cga,
    "total chlorogenic acids": normalize_cga,
    "cga": normalize_cga,
    "3-caffeoylquinic acid": normalize_cga,
    "4-caffeoylquinic acid": normalize_cga,
    "5-caffeoylquinic acid": normalize_cga,
    # heavy metals
    "lead": normalize_heavy_metal,
    "pb": normalize_heavy_metal,
    "cadmium": normalize_heavy_metal,
    "cd": normalize_heavy_metal,
    "arsenic": normalize_heavy_metal,
    "as": normalize_heavy_metal,
    "mercury": normalize_heavy_metal,
    "hg": normalize_heavy_metal,
    # mycotoxins
    "ochratoxin a": normalize_mycotoxin,
    "ota": normalize_mycotoxin,
    "aflatoxin b1": normalize_mycotoxin,
    "aflatoxin b2": normalize_mycotoxin,
    "aflatoxin g1": normalize_mycotoxin,
    "aflatoxin g2": normalize_mycotoxin,
    "total aflatoxins": normalize_mycotoxin,
}


def normalize(analyte_name: str, value, unit: str, serving_size_g: Optional[float] = None) -> Norm:
    """Dispatch by analyte name. CGA normalization accepts a serving_size_g hint
    so 'mg/Serving Size' can convert to canonical mg/100g."""
    key = (analyte_name or "").strip().lower()
    fn = ANALYTE_ROUTER.get(key)
    # Heuristic fallback: any analyte name containing 'chlorogenic' or one of the
    # Eurofins caffeoylquinic spelling variants routes to CGA normalization.
    if fn is None:
        if ("chlorogenic" in key
                or "caffeoylquinic" in key or "caffeolyquinic" in key
                or "caffeoylquiic" in key or "caffeolyquiic" in key):
            fn = normalize_cga
        elif any(m in key for m in ("lead", "cadmium", "arsenic", "mercury")):
            fn = normalize_heavy_metal
        elif "ochratoxin" in key or "aflatoxin" in key:
            fn = normalize_mycotoxin
        else:
            fn = normalize_passthrough
    if fn is normalize_cga:
        return fn(value, unit, serving_size_g)
    return fn(value, unit)
