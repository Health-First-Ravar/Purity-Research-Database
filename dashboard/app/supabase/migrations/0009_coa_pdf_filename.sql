-- Track the source PDF filename so the detail page can show editors which
-- file in Drive a given COA row came from. Filename only (no path) — the
-- user finds the file via Drive search by name.

alter table public.coas
  add column if not exists pdf_filename text;

create index if not exists coas_pdf_filename_idx on public.coas(pdf_filename);
