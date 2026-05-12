import { Navigate, Outlet } from "react-router-dom";
import { useAuth, isStaffShiftOnlyMe } from "../auth";

export default function RequireFullNav(): JSX.Element {
  const { me, loading } = useAuth();
  if (loading) {
    return (
      <div className="app-loading">
        <div className="app-loading-spinner" aria-hidden />
        <span>読み込み中…</span>
      </div>
    );
  }
  if (!me) return <Navigate to="/login" replace />;
  if (isStaffShiftOnlyMe(me.permissions)) return <Navigate to="/workflow" replace />;
  return <Outlet />;
}
