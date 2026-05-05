// Shared sync runner used by both /api/update/cron and /api/update/manual.
// Pulls newly-modified files from the configured Drive folders, detects real
// changes via sha256, extracts text, chunks, embeds, and logs the job.
//
// Env vars required:
//   DRIVE_COA_FOLDER_ID         — Google Drive folder for COA PDFs
//   DRIVE_RESEARCH_FOLDER_ID    — Google Drive folder for research PDFs
//   DRIVE_PRODUCT_PDF_FOLDER_ID — Google Drive folder for product PDFs
//   GOOGLE_SERVICE_ACCOUNT_JSON — service-account credentials (JSON string or path)

import { google } from 'googleapis';
import { createHash } from 'node:crypto';
import { supabaseAdmin } from './supabase';
import { embed } from './voyage';

type SyncArgs = { trigger: 'cron' | 'manual'; triggered_by?: string };
type SyncResult = {
  job_id: string;
  sources_checked: number;
  sources_added: number;
  sources_updated: number;
  chunks_embedded: number;
  error?: string;
};

const FOLDERS: { id: string | undefined; kind: string }[] = [
  { id: process.env.DRIVE_COA_FOLDER_ID,         kind: 'coa' },
  { id: process.env.DRIVE_RESEARCH_FOLDER_ID,    kind: 'research_paper' },
  { id: process.env.DRIVE_PRODUCT_PDF_FOLDER_ID, kind: 'product_pdf' },
];

// Chunk size in characters (~500 words). Overlap keeps context across chunk
// boundaries so retrieval doesn't miss a sentence split across two chunks.
const CHUNK_SIZE    = 2000;
const CHUNK_OVERLAP = 200;

function driveClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set');
  const creds = raw.trim().startsWith('{')
    ? JSON.parse(raw)
    : JSON.parse(require('node:fs').readFileSync(raw, 'utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

/** Split text into overlapping chunks. */
function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end).trim());
    if (end === text.length) break;
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks.filter((c) => c.length > 80); // drop tiny trailing fragments
}

/** Extract plain text from a PDF buffer using unpdf. */
async function pdfToText(buf: Buffer): Promise<string> {
  try {
    const { extractText } = await import('unpdf');
    const result = await extractText(new Uint8Array(buf), { mergePages: true });
    // unpdf returns { text: string } or { pages: string[] }
    if (typeof result === 'string') return result;
    const r = result as { text?: string; pages?: string[] };
    return r.text ?? (r.pages ?? []).join('\n\n');
  } catch {
    return '';
  }
}

export async function runSync(args: SyncArgs): Promise<SyncResult> {
  const sb = supabaseAdmin();

  const { data: jobRow, error: jobErr } = await sb
    .from('update_jobs')
    .insert({ trigger: args.trigger, triggered_by: args.triggered_by ?? null, status: 'running' })
    .select('id').single();
  if (jobErr) throw jobErr;
  const job_id = jobRow!.id as string;

  const result: SyncResult = {
    job_id, sources_checked: 0, sources_added: 0, sources_updated: 0, chunks_embedded: 0,
  };

  try {
    const drive = driveClient();
    for (const { id, kind } of FOLDERS) {
      if (!id) continue; // env var not set — skip this folder
      let pageToken: string | undefined;
      do {
        const list = await drive.files.list({
          q: `'${id}' in parents and trashed=false`,
          fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, md5Checksum)',
          pageSize: 100,
          pageToken,
        });
        for (const f of list.data.files ?? []) {
          if (!f.id || !f.name) continue;
          result.sources_checked++;
          const r = await syncOne(sb, drive, { fileId: f.id, name: f.name, mimeType: f.mimeType ?? '', kind });
          if (r === 'new')      result.sources_added++;
          if (r === 'updated')  result.sources_updated++;
          if (typeof r === 'number') result.chunks_embedded += r;
        }
        pageToken = list.data.nextPageToken ?? undefined;
      } while (pageToken);
    }

    await sb.from('update_jobs').update({
      status: 'success',
      finished_at: new Date().toISOString(),
      sources_checked: result.sources_checked,
      sources_added: result.sources_added,
      sources_updated: result.sources_updated,
      chunks_embedded: result.chunks_embedded,
    }).eq('id', job_id);

    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from('update_jobs').update({
      status: 'error', finished_at: new Date().toISOString(), error_message: msg,
    }).eq('id', job_id);
    result.error = msg;
    return result;
  }
}

async function syncOne(
  sb: ReturnType<typeof supabaseAdmin>,
  drive: ReturnType<typeof driveClient>,
  f: { fileId: string; name: string; mimeType: string; kind: string },
): Promise<'new' | 'updated' | number | null> {
  // Only handle PDFs.
  if (!f.mimeType.includes('pdf') && !f.name.toLowerCase().endsWith('.pdf')) return null;

  // Check if we already have this file with an unchanged sha256.
  const { data: existing } = await sb
    .from('sources')
    .select('id, sha256')
    .eq('drive_file_id', f.fileId)
    .is('valid_until', null)
    .maybeSingle();

  // Download PDF.
  const dl = await drive.files.get({ fileId: f.fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  const buf = Buffer.from(dl.data as ArrayBuffer);
  const sha = createHash('sha256').update(buf).digest('hex');

  // If unchanged, skip.
  if (existing && existing.sha256 === sha) return null;

  // Retire old version if content changed.
  if (existing) {
    await sb.from('sources').update({ valid_until: new Date().toISOString() }).eq('id', existing.id);
    // Delete old chunks so they're replaced.
    await sb.from('chunks').delete().eq('source_id', existing.id);
  }

  // Insert new source row.
  const title = f.name.replace(/\.pdf$/i, '');
  const { data: sourceRow, error: srcErr } = await sb.from('sources').insert({
    kind: f.kind,
    title,
    drive_file_id: f.fileId,
    drive_url: `https://drive.google.com/file/d/${f.fileId}/view`,
    sha256: sha,
    metadata: { pdf_bytes: buf.byteLength },
    freshness_tier: f.kind === 'coa' ? 'weekly' : 'stable',
  }).select('id').single();

  if (srcErr || !sourceRow) return existing ? 'updated' : 'new';

  // Extract text from PDF.
  const text = await pdfToText(buf);
  if (!text || text.length < 100) {
    // PDF extraction failed or produced nothing (e.g. scanned image-only PDF).
    // Source row is created so the file is tracked; chunks will be empty.
    return existing ? 'updated' : 'new';
  }

  // Chunk and embed.
  const chunks = chunkText(text);
  let embedded = 0;
  for (let i = 0; i < chunks.length; i++) {
    try {
      const [embedding] = await embed([chunks[i]]);
      await sb.from('chunks').insert({
        source_id: sourceRow.id,
        chunk_index: i,
        content: chunks[i],
        embedding,
        metadata: { chunk_of: chunks.length },
      });
      embedded++;
    } catch {
      // Non-fatal: log and continue with remaining chunks.
    }
  }

  return embedded; // returns count > 0 meaning chunks were created
}
