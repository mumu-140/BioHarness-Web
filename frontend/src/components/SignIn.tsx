import { type FormEvent, useState } from "react";

import { signIn } from "../api/client";

export default function SignIn({ onSignedIn }: { onSignedIn(): void }) {
  const [token, setToken] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const accepted = await signIn(token).catch(() => false);
    setBusy(false);
    setFailed(!accepted);
    if (accepted) onSignedIn();
  }

  return (
    <form className="sign-in" onSubmit={submit}>
      <h1>BioHarness 科研工作台</h1>
      <label htmlFor="access-token">服务访问令牌</label>
      <input
        id="access-token"
        type="password"
        autoComplete="off"
        value={token}
        onChange={(event) => setToken(event.target.value)}
      />
      <button type="submit" disabled={busy || !token}>
        进入
      </button>
      {failed && (
        <p className="error-text" role="alert">
          令牌未被接受
        </p>
      )}
    </form>
  );
}
