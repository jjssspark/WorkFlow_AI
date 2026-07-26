import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, Check, X } from "lucide-react";
import {
  listReviewerApplications,
  approveReviewerApplication,
  rejectReviewerApplication,
  type ReviewerApplicationStatus,
  type ReviewerApplicationSummary,
} from "../../global/api/adminApi";
import { ApiRequestError } from "../../global/api/apiClient";

const STATUS_TABS: { value: ReviewerApplicationStatus; label: string }[] = [
  { value: "PENDING", label: "승인 대기" },
  { value: "APPROVED", label: "승인됨" },
  { value: "REJECTED", label: "거부됨" },
];

export function AdminReviewerApprovalScreen() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<ReviewerApplicationStatus>("PENDING");
  const [applications, setApplications] = useState<ReviewerApplicationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectingUserId, setRejectingUserId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listReviewerApplications(status, 0, 20);
      setApplications(result.items);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const handleApprove = async (userId: number) => {
    setActionError(null);
    try {
      await approveReviewerApplication(userId);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "승인 처리에 실패했습니다.");
    }
  };

  const openRejectForm = (userId: number) => {
    setActionError(null);
    setRejectReason("");
    setRejectingUserId(userId);
  };

  const confirmReject = async () => {
    if (rejectingUserId === null || !rejectReason.trim()) return;
    setActionError(null);
    try {
      await rejectReviewerApplication(rejectingUserId, rejectReason.trim());
      setRejectingUserId(null);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : "거부 처리에 실패했습니다.");
    }
  };

  return (
    <div className="min-h-screen bg-background px-6 py-8" style={{ fontFamily: "'Inter', 'Noto Sans KR', sans-serif" }}>
      <div className="max-w-3xl mx-auto">
        <button onClick={() => navigate("/dashboard")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4" /> 대시보드로
        </button>
        <h1 className="text-xl font-bold text-foreground mb-1">심사자 승인</h1>
        <p className="text-sm text-muted-foreground mb-6">심사자(교수)로 가입 신청한 계정을 승인하거나 거부합니다.</p>

        <div className="flex gap-2 mb-4">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatus(tab.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                status === tab.value ? "bg-blue-600 text-white" : "bg-card border border-border text-muted-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {actionError && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600">{actionError}</div>
        )}

        {loading && <div className="text-sm text-muted-foreground">불러오는 중...</div>}
        {!loading && error && <div className="text-sm text-red-600">{error}</div>}
        {!loading && !error && applications.length === 0 && (
          <div className="text-sm text-muted-foreground">
            {status === "PENDING" ? "승인 대기 중인 심사자 신청이 없습니다." : "해당 상태의 신청이 없습니다."}
          </div>
        )}

        <div className="space-y-3">
          {applications.map((application) => (
            <div key={application.userId} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-foreground">{application.name}</div>
                  <div className="text-xs text-muted-foreground">{application.email}</div>
                </div>
                {status === "PENDING" && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => void handleApprove(application.userId)}
                      aria-label="승인"
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:opacity-90"
                    >
                      <Check className="w-3.5 h-3.5" /> 승인
                    </button>
                    <button
                      onClick={() => openRejectForm(application.userId)}
                      aria-label="거부"
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-500 hover:opacity-90"
                    >
                      <X className="w-3.5 h-3.5" /> 거부
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                소속: <span>{application.affiliation ?? "-"}</span> · 교수 식별번호: <span>{application.facultyIdMasked ?? "-"}</span>
              </div>
              {application.rejectionReason && (
                <div className="mt-1 text-xs text-red-500">거부 사유: {application.rejectionReason}</div>
              )}

              {rejectingUserId === application.userId && (
                <div className="mt-3 rounded-lg border border-border bg-muted p-3">
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="거부 사유를 입력하세요"
                    className="w-full rounded-lg border border-border bg-input-background px-3 py-2 text-xs outline-none"
                    rows={2}
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button onClick={() => setRejectingUserId(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground">
                      취소
                    </button>
                    <button
                      onClick={() => void confirmReject()}
                      disabled={!rejectReason.trim()}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-500 hover:opacity-90 disabled:opacity-50"
                    >
                      거부 확정
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
