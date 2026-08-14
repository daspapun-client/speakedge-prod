import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { homeFor, useAuth, type Role } from '@/lib/auth';
import { PublicLayout } from '@/app/layouts/PublicLayout';
import { StudentLayout } from '@/app/layouts/StudentLayout';
import { AdminLayout } from '@/app/layouts/AdminLayout';
import { HomePage } from '@/features/public/HomePage';
import { PlansPage } from '@/features/public/PlansPage';
import { DemoPage } from '@/features/public/DemoPage';
import { VerifyPage } from '@/features/public/VerifyPage';
import {
  PrivacyPage, TermsPage, FaqPage, CommunityRulesPage, SafetyPolicyPage, RefundPolicyPage,
} from '@/features/public/LegalPages';
import { ShopPage } from '@/features/shop/ShopPage';
import { ProductPage } from '@/features/shop/ProductPage';
import { TrackPage } from '@/features/shop/TrackPage';
import { CheckoutPage } from '@/features/checkout/CheckoutPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { ActivatePage } from '@/features/membership/ActivatePage';
import { StatusPage } from '@/features/membership/StatusPage';
import { DashboardHome } from '@/features/dashboard/DashboardHome';
import { ProfilePage } from '@/features/dashboard/ProfilePage';
import { PaymentsPage } from '@/features/dashboard/PaymentsPage';
import { SubscriptionPage } from '@/features/dashboard/SubscriptionPage';
import { VideosPage } from '@/features/dashboard/VideosPage';
import { StudyMaterialPage } from '@/features/dashboard/StudyMaterialPage';
import { LearningPage } from '@/features/dashboard/LearningPage';
import { PromptLibraryPage } from '@/features/dashboard/PromptLibraryPage';
import { AISessionPage } from '@/features/dashboard/AISessionPage';
import { AttendancePage } from '@/features/dashboard/AttendancePage';
import { CommunityPage } from '@/features/dashboard/CommunityPage';
import { OrientationPage } from '@/features/dashboard/OrientationPage';
import { MemberProfilePage } from '@/features/dashboard/MemberProfilePage';
import { ExploreProfilesPage } from '@/features/dashboard/ExploreProfilesPage';
import { TeamChatPage } from '@/features/dashboard/TeamChatPage';
import { DirectChatPage } from '@/features/dashboard/DirectChatPage';
import { ExamsPage } from '@/features/dashboard/ExamsPage';
import { BatchesPage } from '@/features/dashboard/BatchesPage';
import { ReportsPage } from '@/features/dashboard/ReportsPage';
import { NotificationsPage } from '@/features/dashboard/NotificationsPage';
import { OffersPage } from '@/features/dashboard/OffersPage';
import { SettingsPage } from '@/features/dashboard/SettingsPage';
import { TeacherApplyPage } from '@/features/teacher/TeacherApplyPage';
import { TeacherDirectoryPage } from '@/features/teacher/TeacherDirectoryPage';
import { TeacherHome } from '@/features/teacher/TeacherHome';
import { TeacherBatchesPage } from '@/features/teacher/TeacherBatchesPage';
import { TeacherRemunerationPage } from '@/features/teacher/TeacherRemunerationPage';
import { TeacherReviewsPage } from '@/features/teacher/TeacherReviewsPage';
import { TeacherOrientationPage } from '@/features/teacher/TeacherOrientationPage';
import { TeacherProfilePage } from '@/features/teacher/TeacherProfilePage';
import { PartnerApplyPage } from '@/features/partner/PartnerApplyPage';
import { PartnerDirectoryPage } from '@/features/partner/PartnerDirectoryPage';
import { PartnerMicrositePage } from '@/features/partner/PartnerMicrositePage';
import { PartnerHome } from '@/features/partner/PartnerHome';
import { PartnerLeadsPage } from '@/features/partner/PartnerLeadsPage';
import { PartnerReportsPage } from '@/features/partner/PartnerReportsPage';
import { PartnerProfilePage } from '@/features/partner/PartnerProfilePage';
import { ExaminerHome } from '@/features/examiner/ExaminerHome';
import { AdminOverview } from '@/features/admin/AdminOverview';
import { AdminCodes } from '@/features/admin/AdminCodes';
import { AdminVerification } from '@/features/admin/AdminVerification';
import { AdminStudents } from '@/features/admin/AdminStudents';
import { AdminStudentProfile } from '@/features/admin/AdminStudentProfile';
import { AdminBooks } from '@/features/admin/AdminBooks';
import { AdminPayments } from '@/features/admin/AdminPayments';
import { AdminTeacherPayouts } from '@/features/admin/AdminTeacherPayouts';
import { AdminPartners } from '@/features/admin/AdminPartners';
import { AdminTeachers } from '@/features/admin/AdminTeachers';
import { AdminTeacherProfile } from '@/features/admin/AdminTeacherProfile';
import { AdminCommunity } from '@/features/admin/AdminCommunity';
import { AdminExams } from '@/features/admin/AdminExams';
import { AdminOrientation } from '@/features/admin/AdminOrientation';
import { AdminVideos } from '@/features/admin/AdminVideos';
import { AdminPromptLibrary } from '@/features/admin/AdminPromptLibrary';
import { AdminInstructions } from '@/features/admin/AdminInstructions';
import { AdminClassAttendance } from '@/features/admin/AdminClassAttendance';
import { AdminNotifications } from '@/features/admin/AdminNotifications';
import { AdminReports } from '@/features/admin/AdminReports';
import { AdminArchive } from '@/features/admin/AdminArchive';
import { AdminActivityLogs } from '@/features/admin/AdminActivityLogs';
import { AdminRoles } from '@/features/admin/AdminRoles';
import { AdminBatches } from '@/features/admin/AdminBatches';
import { AdminCompletedBatches } from '@/features/admin/AdminCompletedBatches';
import { AdminBatchProfile } from '@/features/admin/AdminBatchProfile';
import { AdminBatchSeriesPage } from '@/features/admin/AdminBatchSeriesPage';
import { AdminOffers } from '@/features/admin/AdminOffers';
import { AdminPlans } from '@/features/admin/AdminPlans';
import { AdminLeads } from '@/features/admin/AdminLeads';

function RequireAuth({ children, admin, roles }: { children: JSX.Element; admin?: boolean; roles?: Role[] }) {
  const { isAuthenticated, isAdmin, role } = useAuth();
  const location = useLocation();
  if (!isAuthenticated()) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (admin && !isAdmin()) return <Navigate to={homeFor(role)} replace />;
  if (roles && !(role && roles.includes(role))) return <Navigate to={homeFor(role)} replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/demo" element={<DemoPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/faq" element={<FaqPage />} />
        <Route path="/community-rules" element={<CommunityRulesPage />} />
        <Route path="/safety-policy" element={<SafetyPolicyPage />} />
        <Route path="/refund-policy" element={<RefundPolicyPage />} />
        <Route path="/activate" element={<ActivatePage />} />
        <Route path="/status/:studentId" element={<StatusPage />} />
        <Route path="/verify" element={<VerifyPage />} />
        <Route path="/shop" element={<ShopPage />} />
        <Route path="/shop/product/:id" element={<ProductPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/track" element={<TrackPage />} />
        <Route path="/login" element={<LoginPage />} />
        {/* Teacher & Partner public pages */}
        <Route path="/teachers" element={<TeacherDirectoryPage />} />
        <Route path="/apply/teacher" element={<TeacherApplyPage />} />
        <Route path="/partners" element={<PartnerDirectoryPage />} />
        <Route path="/partners/:slug" element={<PartnerMicrositePage />} />
        <Route path="/apply/partner" element={<PartnerApplyPage />} />
      </Route>

      <Route
        element={
          <RequireAuth>
            <StudentLayout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<DashboardHome />} />
        <Route path="/dashboard/orientation" element={<OrientationPage />} />
        <Route path="/dashboard/profile" element={<ProfilePage />} />
        <Route path="/dashboard/subscription" element={<SubscriptionPage />} />
        <Route path="/dashboard/learning" element={<LearningPage />} />
        <Route path="/dashboard/learning/:week/:day/:stage" element={<AISessionPage />} />
        <Route path="/dashboard/prompt-library" element={<PromptLibraryPage />} />
        <Route path="/dashboard/attendance" element={<AttendancePage />} />
        <Route path="/dashboard/videos" element={<VideosPage />} />
        <Route path="/dashboard/study-material" element={<StudyMaterialPage />} />
        <Route path="/dashboard/community" element={<CommunityPage />} />
        <Route path="/dashboard/community/friends" element={<CommunityPage />} />
        <Route path="/dashboard/explore" element={<ExploreProfilesPage />} />
        <Route path="/dashboard/community/chat/:studentId" element={<DirectChatPage />} />
        <Route path="/dashboard/community/member/:studentId" element={<MemberProfilePage />} />
        <Route path="/dashboard/community/:teamId" element={<TeamChatPage />} />
        <Route path="/dashboard/exams" element={<ExamsPage />} />
        <Route path="/dashboard/batches" element={<BatchesPage />} />
        <Route path="/dashboard/reports" element={<ReportsPage />} />
        <Route path="/dashboard/notifications" element={<NotificationsPage />} />
        <Route path="/dashboard/offers" element={<OffersPage />} />
        <Route path="/dashboard/payments" element={<PaymentsPage />} />
        <Route path="/dashboard/settings" element={<SettingsPage />} />
      </Route>

      {/* Teacher portal */}
      <Route
        element={
          <RequireAuth roles={['teacher']}>
            <StudentLayout />
          </RequireAuth>
        }
      >
        <Route path="/teacher" element={<TeacherHome />} />
        <Route path="/teacher/batches" element={<TeacherBatchesPage />} />
        <Route path="/teacher/orientation" element={<TeacherOrientationPage />} />
        <Route path="/teacher/attendance" element={<Navigate to="/teacher/batches" replace />} />
        <Route path="/teacher/remuneration" element={<TeacherRemunerationPage />} />
        <Route path="/teacher/reviews" element={<TeacherReviewsPage />} />
        <Route path="/teacher/profile" element={<TeacherProfilePage />} />
      </Route>

      {/* Partner portal */}
      <Route
        element={
          <RequireAuth roles={['partner']}>
            <StudentLayout />
          </RequireAuth>
        }
      >
        <Route path="/partner" element={<PartnerHome />} />
        <Route path="/partner/leads" element={<PartnerLeadsPage />} />
        <Route path="/partner/reports" element={<PartnerReportsPage />} />
        <Route path="/partner/profile" element={<PartnerProfilePage />} />
      </Route>

      {/* Examiner portal */}
      <Route
        element={
          <RequireAuth roles={['examiner']}>
            <StudentLayout />
          </RequireAuth>
        }
      >
        <Route path="/examiner" element={<ExaminerHome />} />
      </Route>

      <Route
        element={
          <RequireAuth admin>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route path="/admin" element={<AdminOverview />} />
        <Route path="/admin/codes" element={<AdminCodes />} />
        <Route path="/admin/verification" element={<AdminVerification />} />
        <Route path="/admin/students" element={<AdminStudents />} />
        <Route path="/admin/students/:studentId" element={<AdminStudentProfile />} />
        <Route path="/admin/memberships" element={<Navigate to="/admin/students" replace />} />
        <Route path="/admin/payments" element={<AdminPayments />} />
        <Route path="/admin/payments/teacher-payouts" element={<AdminTeacherPayouts />} />
        <Route path="/admin/books" element={<AdminBooks />} />
        <Route path="/admin/partners" element={<AdminPartners />} />
        <Route path="/admin/teachers" element={<AdminTeachers />} />
        <Route path="/admin/teachers/:teacherId" element={<AdminTeacherProfile />} />
        <Route path="/admin/batches" element={<AdminBatches />} />
        <Route path="/admin/batches/completed" element={<AdminCompletedBatches />} />
        <Route path="/admin/batches/:batchId/series" element={<AdminBatchSeriesPage />} />
        <Route path="/admin/batches/:batchId" element={<AdminBatchProfile />} />
        <Route path="/admin/community" element={<AdminCommunity />} />
        <Route path="/admin/community/:teamId" element={<TeamChatPage />} />
        <Route path="/admin/exams" element={<AdminExams />} />
        <Route path="/admin/orientation" element={<AdminOrientation />} />
        <Route path="/admin/prompt-library" element={<AdminPromptLibrary />} />
        <Route path="/admin/videos" element={<AdminVideos />} />
        <Route path="/admin/instructions" element={<AdminInstructions />} />
        <Route path="/admin/attendance" element={<AdminClassAttendance />} />
        <Route path="/admin/notifications" element={<AdminNotifications />} />
        <Route path="/admin/offers" element={<AdminOffers />} />
        <Route path="/admin/plans" element={<AdminPlans />} />
        <Route path="/admin/leads" element={<AdminLeads />} />
        <Route path="/admin/reports" element={<AdminReports />} />
        <Route path="/admin/archive" element={<AdminArchive />} />
        <Route path="/admin/activity-logs" element={<AdminActivityLogs />} />
        <Route path="/admin/roles" element={<AdminRoles />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
