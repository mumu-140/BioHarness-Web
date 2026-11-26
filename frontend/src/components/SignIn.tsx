import { ArrowRight, KeyRound, Microscope, ShieldCheck } from "lucide-react";
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-teal-50/40 to-slate-100 p-6">
      <form
        className="sign-in w-full max-w-sm rounded-2xl border border-slate-200/90 bg-white p-7 shadow-xl shadow-slate-900/5"
        onSubmit={submit}
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-600 to-teal-800 text-white shadow-sm">
            <Microscope className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-[10px] font-semibold tracking-widest text-teal-700 uppercase">
              BioHarness V3
            </p>
            <h1 className="text-base font-semibold text-slate-900">BioHarness 科研工作台</h1>
          </div>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="access-token"
            className="flex items-center gap-1.5 text-xs font-medium text-slate-700"
          >
            <KeyRound className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            服务访问令牌
          </label>
          <input
            id="access-token"
            type="password"
            autoComplete="off"
            placeholder="输入本地工作台访问令牌…"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-2xs transition focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 focus:outline-none"
          />
        </div>

        {failed && (
          <p
            className="error-text mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
            role="alert"
          >
            令牌未被接受
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !token}
          className="mt-5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-medium text-white shadow-xs transition hover:bg-teal-800 disabled:opacity-50"
        >
          {busy ? "正在验证…" : "进入"}
          {!busy && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
        </button>

        <div className="mt-5 flex items-center gap-2 border-t border-slate-100 pt-4 text-[11px] text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden="true" />
          <span>令牌仅用于建立本地 HttpOnly 会话，不写入前端存储。</span>
        </div>
      </form>
    </div>
  );
}
