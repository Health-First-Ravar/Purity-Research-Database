# Patch: `app/layout.tsx`

Mount `RevaClippy` once at the root layout so it persists across route
changes. Stays out of the way on mobile (the component itself hides at
< 1024px viewport).

## Import

Add near the other component imports at the top:

```ts
import { RevaClippy } from './_components/RevaClippy';
```

## Render

Inside the root `<body>` tag, after the main content but before any closing
tags, add:

```tsx
<RevaClippy />
```

Example diff (your layout's exact JSX may vary):

```diff
   <body className="min-h-screen bg-purity-cream text-purity-bean dark:bg-purity-ink dark:text-purity-paper">
     {/* nav, theme toggle, etc. */}
     <main className="...">
       {children}
     </main>
+    <RevaClippy />
   </body>
```

That's the entire integration. The widget reads its own auth state via
`/api/reva-helper`, picks up the current pathname via `usePathname()`, and
takes care of the keyboard shortcut + open/close lifecycle on its own.

## Optional: gate behind auth at the layout level

If you want non-logged-in users on a future public landing page to not see
the helper at all, wrap the render in a server-side auth check inside the
layout and only render `<RevaClippy />` for authenticated users. The
component's API call already 401s for unauthenticated requests, so this is
a polish move rather than a security need.
