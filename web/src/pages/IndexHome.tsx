import { Navigate } from "react-router-dom";
import { useAuth, isStaffShiftOnlyMe } from "../auth";
import Dashboard from "./Dashboard";

export default function IndexHome(): JSX.Element {
  const { me, loading } = useAuth();
  if (loading) {
    return (
      <div className="app-loading">
        <div className="app-loading-spinner" aria-hidden />
        <span>読み込み中…</span>
      </div>
    );
  }
  if (me && isStaffShiftOnlyMe(me.permissions)) {
    return <Navigate to="/workflow" replace />;
  }
  return <Dashboard />;
}
