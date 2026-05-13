import { Navigate, Route, Routes } from "react-router-dom";
import Shell from "./layout/Shell";
import Login from "./pages/Login";
import Register from "./pages/Register";
import TodaySchedulePage from "./pages/TodaySchedulePage";
import DailyReportDetailPage from "./pages/DailyReportDetailPage";
import DailyReportsMenuPage from "./pages/DailyReportsMenuPage";
import AttendanceMenuPage from "./pages/AttendanceMenuPage";
import DocumentsPage from "./pages/DocumentsPage";
import DashboardPage from "./pages/DashboardPage";

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<Shell />}>
        <Route index element={<TodaySchedulePage />} />
        <Route path="schedule" element={<TodaySchedulePage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="daily-reports" element={<DailyReportsMenuPage />} />
        <Route path="daily-reports/:reportId" element={<DailyReportDetailPage />} />
        <Route path="attendance" element={<AttendanceMenuPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="settings" element={<SettingsMenuPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
