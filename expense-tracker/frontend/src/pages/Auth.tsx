import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, post } from "../api";

function useAfterLogin() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    client.clear();
    await client.invalidateQueries({ queryKey: ["me"] });
    navigate("/", { replace: true });
  };
}

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const done = useAfterLogin();
  const login = useMutation({
    mutationFn: () => post("/auth/login", { email, password }),
    onSuccess: done,
    onError: (e: Error) => setError(e.message),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    login.mutate();
  }
  return (
    <main className="auth">
      <form className="card" onSubmit={submit}>
        <h1>Expense Tracker</h1>
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary" disabled={login.isPending}>
          Log in
        </button>
        <p className="muted small">New here? Ask your household owner for an invite link.</p>
      </form>
    </main>
  );
}

export function AcceptInvite() {
  const { token = "" } = useParams();
  const info = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api<{ household_name: string | null; new_household: boolean }>(`/invites/${token}`),
    retry: false,
  });
  const [form, setForm] = useState({ email: "", display_name: "", password: "" });
  const [error, setError] = useState("");
  const done = useAfterLogin();
  const accept = useMutation({
    mutationFn: () => post(`/invites/${token}/accept`, form),
    onSuccess: done,
    onError: (e: Error) => setError(e.message),
  });
  return (
    <main className="auth">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          accept.mutate();
        }}
      >
        <h1>Join Expense Tracker</h1>
        {info.isError && <p className="error">{(info.error as Error).message}</p>}
        {info.data && (
          <p>
            {info.data.new_household
              ? `You'll get your own private household${info.data.household_name ? ` "${info.data.household_name}"` : ""}.`
              : `You're joining "${info.data.household_name}".`}
          </p>
        )}
        <label>
          Your name
          <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} required />
        </label>
        <label>
          Email
          <input type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </label>
        <label>
          Password (10+ characters)
          <input type="password" autoComplete="new-password" minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary" disabled={!info.data || accept.isPending}>
          Create account
        </button>
      </form>
    </main>
  );
}

export function ResetPassword() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const reset = useMutation({
    mutationFn: () => post(`/auth/reset/${token}`, { password }),
    onSuccess: () => navigate("/login", { replace: true }),
    onError: (e: Error) => setError(e.message),
  });
  return (
    <main className="auth">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          reset.mutate();
        }}
      >
        <h1>Set a new password</h1>
        <label>
          New password (10+ characters)
          <input type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary">
          Save password
        </button>
      </form>
    </main>
  );
}
