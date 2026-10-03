// Shown on overhaul preview deployments to signed-in non-admins (see middleware).
export default function PreviewOnly() {
  return (
    <div className="hub-card max-w-xl">
      <h2>Preview for admins</h2>
      <p className="text-sm text-purity-muted dark:text-purity-mist">
        This is a preview of the new Research Hub, open to admins while it is reviewed. Everything you use today is on the
        live app.
      </p>
    </div>
  );
}
