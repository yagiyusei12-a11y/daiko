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
import GuestBookingPage from "./pages/GuestBookingPage";
import EmployeeInvitePage from "./pages/EmployeeInvitePage";
import DemoShowcasePage from "./pages/DemoShowcasePage";
import PlatformShell from "./layout/PlatformShell";
import PlatformInquiriesPage from "./pages/platform/PlatformInquiriesPage";
import PlatformSettingsPage from "./pages/platform/PlatformSettingsPage";
import PlatformTenantsPage from "./pages/platform/PlatformTenantsPage";

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/demo" element={<DemoShowcasePage />} />
      <Route path="/platform" element={<PlatformShell />}>
        <Route index element={<Navigate to="/platform/inquiries" replace />} />
        <Route path="inquiries" element={<PlatformInquiriesPage />} />
        <Route path="settings" element={<PlatformSettingsPage />} />
        <Route path="tenants" element={<PlatformTenantsPage />} />
      </Route>
      <Route path="/sample" element={<Navigate to="/demo" replace />} />
      <Route path="/book/:slug" element={<GuestBookingPage />} />
      <Route path="/invite/:token" element={<EmployeeInvitePage />} />
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
