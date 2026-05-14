import { Navigate, Route, Routes } from "react-router-dom";
import Shell from "./layout/Shell";
import Login from "./pages/Login";
import Register from "./pages/Register";
import TodaySchedulePage from "./pages/TodaySchedulePage";
import DailyReportDetailPage from "./pages/DailyReportDetailPage";
import DailyReportsMenuPage from "./pages/DailyReportsMenuPage";
import AttendanceMenuPage from "./pages/AttendanceMenuPage";
import ComplaintsPage from "./pages/ComplaintsPage";
import DocumentsPage from "./pages/DocumentsPage";
import InstructionRecordsPage from "./pages/InstructionRecordsPage";
import DashboardPage from "./pages/DashboardPage";
import SettingsMenuPage from "./pages/SettingsMenuPage";

export default function App(): JSX.Element {
  // #region agent log
  fetch("http://127.0.0.1:7838/ingest/f37b4987-1b77-43d9-b411-9367fa4c8525", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "57fb34" },
    body: JSON.stringify({
      sessionId: "57fb34",
      hypothesisId: "H1",
      location: "App.tsx:entry",
      message: "App function entered",
      data: {},
      timestamp: Date.now(),
      runId: "post-fix-verify",
    }),
  }).catch(() => {});
  // #endregion

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<Shell />}>
        <Route index element={<TodaySchedulePage />} />
        <Route path="complaints" element={<ComplaintsPage />} />
        <Route path="schedule" element={<TodaySchedulePage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="daily-reports" element={<DailyReportsMenuPage />} />
        <Route path="daily-reports/:reportId" element={<DailyReportDetailPage />} />
        <Route path="attendance" element={<AttendanceMenuPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="instruction-records" element={<InstructionRecordsPage />} />
        <Route path="settings" element={<SettingsMenuPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
