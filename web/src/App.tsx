import { Navigate, Route, Routes } from "react-router-dom";
import Shell from "./layout/Shell";
import Login from "./pages/Login";
import Register from "./pages/Register";
import TodaySchedulePage from "./pages/TodaySchedulePage";
import DailyReportsMenuPage from "./pages/DailyReportsMenuPage";
import AttendanceMenuPage from "./pages/AttendanceMenuPage";
import SettingsMenuPage from "./pages/SettingsMenuPage";

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<Shell />}>
        <Route index element={<TodaySchedulePage />} />
        <Route path="schedule" element={<TodaySchedulePage />} />
        <Route path="daily-reports" element={<DailyReportsMenuPage />} />
        <Route path="attendance" element={<AttendanceMenuPage />} />
        <Route path="settings" element={<SettingsMenuPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
