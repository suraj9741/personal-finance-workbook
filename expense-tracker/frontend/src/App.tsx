import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { post } from "./api";
import { QuickAdd } from "./components/QuickAdd";
import { ThemeSwitch } from "./components/ThemeSwitch";
import { ToastProvider } from "./components/Toast";
import { useToasts } from "./components/toast-context";
import { useMe } from "./hooks";
import { AccountDetails } from "./pages/AccountDetails";
import { Accounts } from "./pages/Accounts";
import { Admin } from "./pages/Admin";
import { AcceptInvite, Login, ResetPassword } from "./pages/Auth";
import { Budgets } from "./pages/Budgets";
import { Dashboard } from "./pages/Dashboard";
import { Settings } from "./pages/Settings";
import { Transactions } from "./pages/Transactions";

/** A new page opens at its top. Back and Forward (POP) and links to a section (#hash) are left
 * to the browser, which puts you where you were. */
function useTopOfNewPage() {
  const { pathname, hash } = useLocation();
  const navigation = useNavigationType();
  useEffect(() => {
    if (navigation !== "POP" && !hash) window.scrollTo(0, 0);
    // Only a change of page counts: filters and months change the search, not the path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
}

function Shell() {
  useTopOfNewPage();
  const { data: me, isLoading } = useMe();
  const client = useQueryClient();
  const navigate = useNavigate();
  const toasts = useToasts();
  if (isLoading) return <p className="loading">Loading…</p>;
  if (!me) return <Navigate to="/login" replace />;

  async function logout() {
    // Send any delete still waiting for its Undo to run out, while the session still exists.
    await toasts.flush();
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
          <NavLink to="/accounts">Accounts</NavLink>
          <NavLink to="/budgets">Budgets</NavLink>
          <NavLink to="/settings">Settings</NavLink>
          {me.is_site_admin && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <span className="who">
          <ThemeSwitch />
          <span className="who-name">{me.display_name}</span>
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
    <ToastProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/invite/:token" element={<AcceptInvite />} />
        <Route path="/reset/:token" element={<ResetPassword />} />
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="accounts/:id" element={<AccountDetails />} />
          <Route path="budgets" element={<Budgets />} />
          <Route path="settings" element={<Settings />} />
          <Route path="admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
