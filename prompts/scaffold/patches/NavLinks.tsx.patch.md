# Patch: `app/_components/NavLinks.tsx`

Add three new entries to `ITEMS`. The page-side guards already enforce
editor-only on `/heatmap` and `/reva`, so we don't need to gate the link
itself — non-editors hitting it will just see the editor-required notice.

```diff
 const ITEMS: Item[] = [
   { href: '/chat',          label: 'Research Hub' },
   { href: '/reports',       label: 'Reports' },
   { href: '/bibliography',  label: 'Bibliography' },
   { href: '/atlas',         label: 'Atlas' },
+  { href: '/audit',         label: 'Audit' },
+  { href: '/heatmap',       label: 'Heatmap' },
+  { href: '/reva',          label: 'Ask Reva' },
   { href: '/editor/canon',  label: 'Canon' },
   { href: '/editor',        label: 'Editor' },
   { href: '/metrics',       label: 'Metrics' },
 ];
```

(If you want to gate the `Heatmap` and `Ask Reva` links visually, fetch the
caller's role in a server wrapper and pass an `isEditor` prop down. Optional
polish, not required.)
