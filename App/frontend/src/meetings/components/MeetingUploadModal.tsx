import { useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, FileText, Radio, Sparkles, Upload, X } from "lucide-react";
import { analyzeMeeting } from "../libs/utils/meetingAiApi";
import { ApiRequestError } from "../../global/api/apiClient";
import type { MemberResponse } from "../../global/api/projectsApi";

type UploadType = "document" | "audio";

const UPLOAD_TYPES = [
  { id: "document" as const, label: "문서 업로드", desc: "PDF, Word, PPT, TXT, HWP 등 회의록 문서", icon: FileText, accept: ".pdf,.doc,.docx,.ppt,.pptx,.txt,.hwp", color: "#3B5BDB", bg: "rgba(59,91,219,0.1)", note: "텍스트를 추출해 AI가 분석합니다." },
  { id: "audio" as const, label: "음성파일 업로드", desc: "mp3, wav, m4a 등 녹음파일", icon: Radio, accept: ".mp3,.wav,.m4a,.ogg", color: "#7048E8", bg: "rgba(112,72,232,0.1)", note: "음성을 텍스트로 변환한 뒤 분석합니다." },
];

const MEET_KINDS = ["정기회의", "중간점검", "발표준비", "개발회의", "기타"];
const PARTICIPANT_COLORS = ["#3B5BDB", "#7048E8", "#10B981", "#F59E0B", "#EC4899", "#0EA5E9"];

const getTodayIsoDate = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const stripFileExtension = (fileName: string) => fileName.replace(/\.[^/.]+$/, "");

interface MeetingUploadModalProps {
  projectId: string;
  projectMembers: MemberResponse[];
  onClose: () => void;
  /** 실제 파일 업로드(analyzeMeeting) 요청이 성공적으로 접수된 뒤 호출된다 — 이후 화면 전환은 호출부 책임. */
  onUploaded: (meetingId: string, title: string, uploadedAt: string) => void;
}

/** 대시보드 등 회의록 AI 페이지 밖에서도 쓸 수 있는 독립형 회의록 업로드 모달.
 * 파일 업로드(analyzeMeeting)가 성공적으로 접수되기 전까지는 다른 페이지로 이동하지 않는다. */
export function MeetingUploadModal({ projectId, projectMembers, onClose, onUploaded }: MeetingUploadModalProps) {
  const [modalStep, setModalStep] = useState(0);
  const [uploadType, setUploadType] = useState<UploadType | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadFileSize, setUploadFileSize] = useState("");
  const [meetTitle, setMeetTitle] = useState("");
  const [meetDate, setMeetDate] = useState(getTodayIsoDate());
  const [meetKind, setMeetKind] = useState("정기회의");
  const [partIds, setPartIds] = useState<string[]>([]);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileSelect = (file: File | undefined) => {
    if (!file) return;
    const mb = file.size / (1024 * 1024);
    setSelectedFile(file);
    setUploadFileName(file.name);
    setUploadFileSize(mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`);
    setAnalysisError(null);
    if (!meetTitle.trim()) setMeetTitle(stripFileExtension(file.name));
  };

  const handleSubmit = async () => {
    if (!selectedFile || !uploadType) {
      setAnalysisError("분석할 회의록 파일을 먼저 업로드해주세요.");
      return;
    }
    if (partIds.length === 0) {
      setAnalysisError("참석자를 1명 이상 선택해주세요.");
      return;
    }
    const uploadedAt = new Date().toISOString();
    const title = meetTitle.trim() || stripFileExtension(selectedFile.name);
    setSubmitting(true);
    setAnalysisError(null);
    try {
      const response = await analyzeMeeting({
        projectId,
        file: selectedFile,
        title,
        meetingDate: meetDate,
        meetingKind: meetKind,
        sourceType: uploadType,
        participants: partIds.map(id => projectMembers.find(member => String(member.userId) === id)?.name ?? id),
        attendeeIds: partIds.map(Number),
      });
      onUploaded(response.meetingId, title, uploadedAt);
    } catch (error) {
      setAnalysisError(
        error instanceof ApiRequestError
          ? error.message
          : "분석 서버 연결에 실패했습니다. Spring Boot와 FastAPI 서버가 실행 중인지 확인한 뒤 다시 시도해주세요."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4" onClick={e => e.stopPropagation()}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div>
              <div className="text-lg font-bold text-foreground">회의록 업로드</div>
              <div className="text-xs text-muted-foreground mt-0.5">회의 파일을 업로드하면 AI가 자동으로 분석하고 업무를 생성합니다.</div>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg transition-colors"><X className="w-5 h-5 text-muted-foreground" /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {modalStep === 0 && (
              <div>
                <div className="text-sm font-semibold text-foreground mb-3">업로드 유형 선택</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {UPLOAD_TYPES.map(t => {
                    const Icon = t.icon;
                    const sel = uploadType === t.id;
                    return (
                      <button key={t.id} onClick={() => {
                        setUploadType(t.id);
                        setSelectedFile(null);
                        setUploadFileName("");
                        setUploadFileSize("");
                        setAnalysisError(null);
                      }}
                        className={`min-h-[180px] flex flex-col items-center justify-center gap-3 p-6 rounded-xl border-2 transition-all hover:shadow-sm ${sel ? "shadow-sm" : "border-border hover:border-slate-300"}`}
                        style={sel ? { borderColor: t.color, background: t.bg } : {}}>
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: sel ? t.bg : "#F4F6FA" }}>
                          <Icon className="w-6 h-6" style={{ color: t.color }} />
                        </div>
                        <div className="text-center">
                          <div className="text-sm font-bold text-foreground">{t.label}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{t.desc}</div>
                        </div>
                        {sel && <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: t.color }}><Check className="w-3 h-3 text-white" /></div>}
                      </button>
                    );
                  })}
                </div>
                {uploadType && (
                  <div className="mt-3 px-4 py-2.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800 flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    {UPLOAD_TYPES.find(t => t.id === uploadType)?.note}
                  </div>
                )}
              </div>
            )}

            {modalStep === 1 && uploadType && (() => {
              const utype = UPLOAD_TYPES.find(t => t.id === uploadType)!;
              const Icon = utype.icon;
              return (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: utype.bg }}><Icon className="w-4 h-4" style={{ color: utype.color }} /></div>
                    <span className="text-sm font-bold text-foreground">{utype.label}</span>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={utype.accept}
                    className="hidden"
                    onChange={e => handleFileSelect(e.target.files?.[0])}
                  />
                  <div className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-blue-400 hover:bg-blue-50/30 transition-all cursor-pointer"
                    onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                    onDragEnter={e => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleFileSelect(e.dataTransfer.files?.[0]);
                    }}
                    onClick={() => fileInputRef.current?.click()}>
                    {uploadFileName ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: utype.bg }}><Icon className="w-6 h-6" style={{ color: utype.color }} /></div>
                        <div className="text-sm font-semibold text-foreground">{uploadFileName}</div>
                        <div className="text-[10px] text-muted-foreground">{uploadFileSize || "파일 선택됨"}</div>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600">업로드 완료</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <Upload className="w-8 h-8 text-muted-foreground" />
                        <div className="text-sm font-medium text-foreground">파일을 드래그하거나 클릭하여 업로드</div>
                        <div className="text-xs text-muted-foreground">{utype.accept.toUpperCase().replace(/\./g, "").replace(/,/g, ", ")} 지원</div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="text-xs font-semibold text-foreground block mb-1.5">회의 제목 <span className="text-red-500">*</span></label>
                      <input value={meetTitle} onChange={e => setMeetTitle(e.target.value)} placeholder="예: 7차 정기 회의 — 결제 연동 점검"
                        className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-foreground block mb-1.5">회의 날짜</label>
                      <input type="date" value={meetDate} onChange={e => setMeetDate(e.target.value)} className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-foreground block mb-1.5">회의 유형</label>
                      <select value={meetKind} onChange={e => setMeetKind(e.target.value)} className="w-full rounded-xl border border-border bg-input-background px-4 py-2.5 text-sm outline-none focus:border-blue-400">
                        {MEET_KINDS.map(k => <option key={k}>{k}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-foreground block mb-2">참석자</label>
                    {projectMembers.length === 0 ? (
                      <p className="text-xs text-muted-foreground">프로젝트 멤버 정보를 불러오는 중입니다.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {projectMembers.map(m => {
                          const id = String(m.userId);
                          const sel = partIds.includes(id);
                          const color = PARTICIPANT_COLORS[m.userId % PARTICIPANT_COLORS.length];
                          return (
                            <button key={id} onClick={() => setPartIds(p => sel ? p.filter(x => x !== id) : [...p, id])}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${sel ? "border-blue-400 bg-blue-50 text-blue-700" : "border-border bg-card text-muted-foreground hover:border-slate-300"}`}>
                              <div className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold" style={{ background: color }}>{m.name.slice(0, 1)}</div>
                              {m.name}
                              {sel && <Check className="w-3 h-3" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {analysisError && (
                      <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                        <span>{analysisError}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="flex items-center justify-between px-6 py-4 border-t border-border">
            <button
              onClick={() => modalStep === 0 ? onClose() : setModalStep(0)}
              disabled={submitting}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-muted-foreground border border-border rounded-xl hover:bg-muted transition-colors disabled:opacity-50"
            >
              <ArrowLeft className="w-4 h-4" />{modalStep === 0 ? "취소" : "이전"}
            </button>
            {modalStep === 0 ? (
              <button onClick={() => setModalStep(1)} disabled={!uploadType}
                className="flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white rounded-xl disabled:opacity-40 hover:opacity-90 transition-opacity"
                style={{ background: "linear-gradient(135deg,#3B5BDB,#4F6EF7)" }}>
                다음<ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button onClick={handleSubmit}
                disabled={!selectedFile || submitting}
                className="flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white rounded-xl disabled:opacity-40 hover:opacity-90 transition-opacity"
                style={{ background: "linear-gradient(135deg,#7048E8,#4F6EF7)" }}>
                <Sparkles className="w-4 h-4" />{submitting ? "업로드 중..." : "업로드 및 AI 분석 시작"}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
