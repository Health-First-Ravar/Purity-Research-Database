// Shared sync runner used by both /api/update/cron and /api/update/manual.
// Pulls newly-modified files from the configured Drive folders, detects real
// changes via sha256, ingests text, re-embeds, and logs the job in update_jobs.

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
  { id: process.env.DRIVE_COA_FOLDER_ID,        kind: 'coa' },
  { id: process.env.DRIVE_RESEARCH_FOLDER_ID,   kind: 'research_paper' },
  { id: process.env.DRIVE_PRODUCT_PDF_FOLDER_ID, kind: 'product_pdf' },
];

function driveClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set');
  const creds = raw.trim().startsWith('{') ? JSON.parse(raw) : JSON.parse(require('node:fs').readFileSync(raw, 'utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
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
      if (!id) continue;
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
          const added = await syncOne(sb, drive, { fileId: f.id, name: f.name, mimeType: f.mimeType ?? '', kind });
          if (added === 'new')    result.sources_added++;
          if (added === 'updated') result.sources_updated++;
          if (typeof added === 'number') result.chunks_embedded += added;
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
  // Check if we already have this fileId with the same sha
  const { data: existing } = await sb
    .from('sources')
    .select('id, sha256')
    .eq('drive_file_id', f.fileId)
    .is('valid_until', null)
    .maybeSingle();

  // Download (PDF-only at MVP; skip other mimeTypes until we add a converter)
  if (!f.mimeType.includes('pdf') && !f.name.toLowerCase().endsWith('.pdf')) return null;

  const dl = await drive.files.get({ fileId: f.fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  const buf = Buffer.from(dl.data as ArrayBuffer);
  const sha = createHash('sha256').update(buf).digest('hex');

  if (existing && existing.sha256 === sha) return null;

  // Minimal PDF→text: pdf parsing will live in a dedicated helper; at MVP we just
  // store the source metadata and rely on the ingest script to produce .txt.
  // Retire old version if content changed.
  if (existing) {
    await sb.from('sources').update({ valid_until: new Date().toISOString() }).eq('id', existing.id);
  }

  await sb.from('sources').insert({
    kind: f.kind,
    title: f.name.replace(/\.pdf$/i, ''),
    drive_file_id: f.fileId,
    drive_url: `https://drive.google.com/file/d/${f.fileId}/view`,
    sha256: sha,
    metadata: { pdf_bytes: buf.byteLength },
    freshness_tier: f.kind === 'coa' ? 'weekly' : 'stable',
  });

  return existing ? 'updated' : 'new';
}
