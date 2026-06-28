export type LoginPageState =
  | { state: "ready" }
  | { state: "expired" }
  | { state: "backend_unavailable" };

export function LoginPage(props: LoginPageState) {
  return (
    <main className="auth-shell">
      <section className="login-panel" aria-labelledby="login-heading">
        <p className="eyebrow">RecallBase Web</p>
        <h1 id="login-heading">Continue with Google</h1>
        <p>
          Search synced metadata, snippets, summaries, and locked encrypted conversation availability from this browser.
        </p>
        {props.state === "expired" ? <p role="alert">Your Web session expired. Continue with Google to reconnect.</p> : null}
        {props.state === "backend_unavailable" ? <p role="alert">The hosted sync service is unavailable.</p> : null}
        <a className="primary-action" href="/auth/google/start">Continue with Google</a>
        <p className="fine-print">Raw local archives are not uploaded to hosted RecallBase.</p>
      </section>
    </main>
  );
}
