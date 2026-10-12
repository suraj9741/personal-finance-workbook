import { useQueryClient } from "@tanstack/react-query";
import { NavLink, Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { post } from "./api";
import { QuickAdd } from "./components/QuickAdd";
import { useMe } from "./hooks";
import { Admin } from "./pages/Admin";
import { AcceptInvite, Login, ResetPassword } from "./pages/Auth";
import { Budgets } from "./pages/Budgets";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";
import { Transactions } from "./pages/Transactions";

function Shell() {
  const { data: me, isLoading } = useMe();
  const client = useQueryClient();
  const navigate = useNavigate();
  if (isLoading) return <p className="loading">Loading…</p>;
  if (!me) return <Navigate to="/login" replace />;

  async function logout() {
    await post("/auth/logout").catch(() => undefined);
    client.clear();
    navigate("/login", { replace: true });
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">₹ Expense Tracker</span>
        <nav>
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/transactions">Transactions</NavLink>
          <NavLink to="/budgets">Budgets</NavLink>
          <NavLink to="/settings">Settings</NavLink>
          {me.is_site_admin && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <span className="who">
          {me.display_name}
          <button type="button" className="ghost small" onClick={logout}>
            Log out
          </button>
        </span>
      </header>
      <QuickAdd />
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/invite/:token" element={<AcceptInvite />} />
      <Route path="/reset/:token" element={<ResetPassword />} />
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="budgets" element={<Budgets />} />
        <Route path="settings" element={<Settings />} />
        <Route path="admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
