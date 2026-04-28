// Voyage embeddings wrapper. voyage-3-large produces 1024-dim vectors —
// the pgvector column width in 0001_initial.sql.

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const MODEL = process.env.VOYAGE_MODEL ?? 'voyage-3-large';

type InputType = 'query' | 'document';

export async function embed(
  texts: string[],
  inputType: InputType = 'document',
): Promise<number[][]> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error('VOYAGE_API_KEY not set');

  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      input: texts,
      model: MODEL,
      input_type: inputType,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage embed ${res.status}: ${body}`);
  }
  const json = await res.json();
  return (json.data ?? []).map((d: { embedding: number[] }) => d.embedding);
}

export async function embedOne(text: string, inputType: InputType = 'query'): Promise<number[]> {
  const [v] = await embed([text], inputType);
  return v;
}
