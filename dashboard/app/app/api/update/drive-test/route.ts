// GET /api/update/drive-test — temporary diagnostic endpoint.
// Tests Drive connectivity step by step so we can see exactly where it hangs.
// Protected by CRON_SECRET. Remove this file once Drive sync is working.

import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';

export const dynamic   = 'force-dynamic';
export const maxDuration = 30; // 30s max — we just want to know where it hangs

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const steps: Record<string, unknown> = {};

  try {
    // Step 1: read + parse env var
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '';
    steps.env_length     = raw.length;
    steps.env_starts     = raw.trim().slice(0, 10);
    const creds = JSON.parse(raw);
    steps.client_email   = creds.client_email;
    steps.has_private_key = typeof creds.private_key === 'string' && creds.private_key.length > 100;

    // Step 2: create JWT auth object
    const auth = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    steps.jwt_created = true;

    // Step 3: fetch access token (makes HTTPS call to oauth2.googleapis.com)
    const tok = await Promise.race([
      auth.getAccessToken(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('token fetch timed out after 20s')), 20000)),
    ]);
    steps.token_ok = !!tok;
    steps.token_length = typeof tok === 'string' ? tok.length : 'object';

    // Step 4: list files from the research folder
    const drive = google.drive({ version: 'v3', auth });
    const folderId = process.env.DRIVE_RESEARCH_FOLDER_ID ?? '';
    steps.folder_id = folderId ? folderId.slice(0, 8) + '…' : '(not set)';

    const list = await Promise.race([
      drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id,name)',
        pageSize: 3,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('files.list timed out after 20s')), 20000)),
    ]);
    steps.files_listed = list.data.files?.length ?? 0;
    steps.first_file   = list.data.files?.[0]?.name ?? null;

  } catch (e) {
    steps.error = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({ ok: true, steps });
}
