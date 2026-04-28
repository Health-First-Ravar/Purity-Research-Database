// Inline pre-hydration script. Runs in <head> before the DOM paints, so the
// correct theme class is already on <html> before any pixels render. This
// prevents the "light flash on load" for users with persisted dark theme
// or a dark OS preference.
//
// Server component: renders a single <script> tag with a synchronous IIFE.

export function ThemeScript() {
  const code = `(function(){try{var t=localStorage.getItem('purity-theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var dark=(t==='dark')||((t===null||t==='system')&&m);var r=document.documentElement;r.classList.toggle('dark',dark);r.classList.toggle('light',!dark&&t==='light');r.dataset.theme=t||'system';}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
