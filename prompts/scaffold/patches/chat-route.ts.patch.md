# Patch: `app/api/chat/route.ts`

After inserting the message row, write `message_topics` rows for any
`topic_slugs` returned by the classifier.

## Add this near the top
```ts
import { supabaseAdmin } from '@/lib/supabase';
```

## After the messages.insert call, add:

```ts
// Topic tagging — best-effort; never fail the chat response on this.
if (classification.topic_slugs?.length && messageRow?.id) {
  try {
    const adb = supabaseAdmin();
    const { data: topicRows } = await adb
      .from('question_topics')
      .select('id, slug')
      .in('slug', classification.topic_slugs);
    const tagRows = (topicRows ?? []).map((t) => ({
      message_id: messageRow.id,
      topic_id: t.id,
      confidence: 0.8,
      source: 'auto' as const,
    }));
    if (tagRows.length) {
      await adb.from('message_topics').upsert(tagRows, { onConflict: 'message_id,topic_id' });
    }
  } catch (e) {
    console.error('topic tagging failed:', e);
  }
}
```

The variable name (`messageRow`) may differ in the live file — substitute the
local name of the row returned by the messages insert. The pattern is: if the
classifier returned topic slugs, look up their UUIDs and upsert into
`message_topics`. Failure here must never break the chat response.
