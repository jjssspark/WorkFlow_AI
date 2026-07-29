import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  GraduationCap, Users, Trophy, Cpu, Zap, PenLine, Check, User,
  AlertTriangle, Mail, Shield, ArrowLeft, ArrowRight, Sparkles, Plus, Trash2, X,
} from "lucide-react";
import { StepIndicator } from "../components/StepIndicator";
import { useAuth } from "../../global/hooks/useAuth";
import { createInvitation, createProject, listProjects } from "../../global/api/projectsApi";

const DELIVERABLE_OPTIONS = ["발표자료", "보고서", "README", "시연 영상", "서비스 배포", "기타"];

const PROJECT_TYPES = [
  { id: "capstone", label: "캡스톤디자인", sub: "전공 프로젝트", icon: GraduationCap, color: "#3B5BDB" },
  { id: "team",     label: "팀프로젝트",   sub: "일반 팀프로젝트", icon: Users,           color: "#7048E8" },
  { id: "contest",  label: "공모전",        sub: "아이디어·창업",   icon: Trophy,          color: "#F59E0B" },
  { id: "ai",       label: "AI 경진대회",   sub: "모델·실험 중심",  icon: Cpu,             color: "#10B981" },
  { id: "hackathon",label: "해커톤",        sub: "단기 집중 개발",  icon: Zap,             color: "#EF4444" },
  { id: "other",    label: "기타",          sub: "직접 입력",       icon: PenLine,         color: "#8892A4" },
];

export function OnboardingScreen() {
  const navigate = useNavigate();
  const { user, refreshMe, selectProject } = useAuth();
  const userName = user?.name ?? "";

  const [step, setStep] = useState(0); // 0-3
  const [projectType, setProjectType] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [customType, setCustomType] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [teamSize, setTeamSize] = useState(4);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [midCheckDate, setMidCheckDate] = useState("");
  const [deliverables, setDeliverables] = useState<string[]>([]);
  const [techStackInput, setTechStackInput] = useState("");
  const [techStack, setTechStack] = useState<string[]>([]);
  const [goals, setGoals] = useState("");
  const [memberEmails, setMemberEmails] = useState<string[]>([""]);
  const [reviewerEmails, setReviewerEmails] = useState<string[]>([""]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    listProjects()
      .then((projects) => {
        if (projects.length === 0) return;
        const mostRecent = projects[projects.length - 1];
        const matchedType = PROJECT_TYPES.find((t) => t.label === mostRecent.type);
        if (matchedType) setProjectType(matchedType.id);
      })
      .catch(() => {
        // 프리셋은 부가 기능이므로 실패해도 빈 선택 상태로 둔다.
      });
  }, []);

  const toggleDeliverable = (item: string) => {
    setDeliverables(prev => prev.includes(item) ? prev.filter(d => d !== item) : [...prev, item]);
  };
  const addTechStackTag = () => {
    const value = techStackInput.trim();
    if (value && !techStack.includes(value)) {
      setTechStack(prev => [...prev, value]);
    }
    setTechStackInput("");
  };
  const removeTechStackTag = (tag: string) => setTechStack(prev => prev.filter(t => t !== tag));
  const dateRangeValid = !startDate || !endDate || startDate <= endDate;

  const resolvedType = projectType === "other" ? customType : PROJECT_TYPES.find(t => t.id === projectType)?.label ?? "";

  const updateEmailAt = (list: string[], setList: (v: string[]) => void, index: number, value: string) => {
    const next = [...list];
    next[index] = value;
    setList(next);
  };
  const addEmailRow = (list: string[], setList: (v: string[]) => void) => setList([...list, ""]);
  const removeEmailRow = (list: string[], setList: (v: string[]) => void, index: number) =>
    setList(list.filter((_, i) => i !== index));

  const handleFinish = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const project = await createProject({
        title: projectTitle.trim(),
        type: resolvedType || undefined,
        year,
        deadline: endDate,
        startDate: startDate || undefined,
        midCheckDate: midCheckDate || undefined,
        memberLimit: teamSize,
        deliverables: deliverables.length > 0 ? deliverables : undefined,
        techStack: techStack.length > 0 ? techStack : undefined,
        goals: goals.trim() || undefined,
      });

      const invites = [
        ...memberEmails.filter(e => e.trim()).map(email => ({ email: email.trim(), role: "팀원" as const })),
        ...reviewerEmails.filter(e => e.trim()).map(email => ({ email: email.trim(), role: "심사자" as const })),
      ];
      for (const invite of invites) {
        await createInvitation(project.id, invite.email, invite.role);
      }

      await refreshMe();
      selectProject(project.id);
      navigate("/dashboard");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "프로젝트 생성에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const onSkip = () => navigate("/dashboard");

  const STEPS = ["프로젝트 목적", "일정/인원", "산출물/목표", "팀원 초대"];
  const canGoNext =
    step === 0 ? Boolean(projectType && projectTitle.trim()) :
    step === 1 ? Boolean(endDate && dateRangeValid) :
    true;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-8" style={{ fontFamily: "'Inter', 'Noto Sans KR', sans-serif" }}>
      {/* top logo */}
      <div className="flex items-center gap-2.5 mb-10">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm" style={{ background: "linear-gradient(135deg, #7048E8, #4F6EF7)" }}>
          TF
        </div>
        <span className="font-bold text-foreground text-base">TeamFlow AI</span>
      </div>

      {/* card */}
      <div className="w-full max-w-xl bg-card rounded-2xl shadow-xl border border-border overflow-hidden">
        {/* card header */}
        <div className="px-8 pt-7 pb-5 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <StepIndicator current={step} total={4} />
            <span className="text-xs font-semibold text-muted-foreground">{step + 1} / 4 단계</span>
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{STEPS[step]}</div>
          <h2 className="text-lg font-bold text-foreground">
            {step === 0 && "어떤 목적으로 사용하시나요?"}
            {step === 1 && "일정과 인원을 알려주세요"}
            {step === 2 && "목표 산출물과 진행 목표"}
            {step === 3 && "팀을 초대하세요"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {step === 0 && "프로젝트 이름과 유형에 따라 AI 기능이 최적화됩니다."}
            {step === 1 && "최종 마감일은 필수이며, 본인 포함 전체 팀원 수를 선택해주세요."}
            {step === 2 && "목표 산출물, 기술 스택, 진행 목표는 마이페이지의 프로젝트 정보에서 나중에 수정할 수 있습니다."}
            {step === 3 && "이메일로 초대하면 팀원과 심사자는 서로 다른 접근 권한을 가집니다."}
          </p>
        </div>

        {/* card body */}
        <div className="px-8 py-7">

          {/* ── step 0: project type + title ── */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-foreground">프로젝트 이름</label>
                <input
                  value={projectTitle}
                  onChange={e => setProjectTitle(e.target.value)}
                  placeholder="예: WorkFlow AI"
                  className="w-full rounded-xl border border-border bg-input-background px-4 py-3 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                />
                <div className="mt-4">
                  <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">진행 연도</label>
                  <input
                    type="number"
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())}
                    className="w-full rounded-xl border border-border bg-input-background px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {PROJECT_TYPES.map(t => (
                  <button key={t.id} onClick={() => setProjectType(t.id)}
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border-2 text-left transition-all hover:shadow-sm ${projectType === t.id ? "shadow-sm" : "border-border hover:border-slate-300"}`}
                    style={projectType === t.id ? { borderColor: t.color, background: `${t.color}0A` } : {}}>
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: projectType === t.id ? `${t.color}20` : "#F4F6FA" }}>
                      <t.icon className="w-4.5 h-4.5" style={{ color: projectType === t.id ? t.color : "#8892A4", width: 18, height: 18 }} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">{t.label}</div>
                      <div className="text-[11px] text-muted-foreground">{t.sub}</div>
                    </div>
                    {projectType === t.id && (
                      <div className="ml-auto w-5 h-5 rounded-full flex items-center justify-center" style={{ background: t.color }}>
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
              {projectType === "other" && (
                <div className="mt-1">
                  <input
                    autoFocus
                    value={customType}
                    onChange={e => setCustomType(e.target.value)}
                    placeholder="프로젝트 유형을 직접 입력하세요"
                    className="w-full rounded-xl border border-border bg-input-background px-4 py-3 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                  />
                </div>
              )}
            </div>
          )}

          {/* ── step 1: schedule + team size ── */}
          {step === 1 && (
            <div className="flex flex-col items-center gap-6 py-2">
              <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-foreground">시작일</label>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    className="w-full rounded-xl border border-border bg-input-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-foreground">최종 마감일 <span className="text-red-500">*</span></label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                    className="w-full rounded-xl border border-border bg-input-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-foreground">중간 점검일 (선택)</label>
                  <input type="date" value={midCheckDate} onChange={e => setMidCheckDate(e.target.value)}
                    className="w-full rounded-xl border border-border bg-input-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all" />
                </div>
              </div>
              {!dateRangeValid && (
                <p className="text-xs text-red-500 -mt-3">시작일은 종료일보다 이전이어야 합니다.</p>
              )}

              <div className="flex items-center gap-6 justify-center">
                <button
                  onClick={() => setTeamSize(v => Math.max(2, v - 1))}
                  className="w-12 h-12 rounded-full border-2 border-border flex items-center justify-center text-xl font-bold text-foreground hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all disabled:opacity-30"
                  disabled={teamSize <= 2}>
                  –
                </button>
                <div className="text-center">
                  <div className="text-5xl font-bold" style={{ color: "var(--primary)" }}>{teamSize}</div>
                  <div className="text-sm text-muted-foreground mt-1">명</div>
                </div>
                <button
                  onClick={() => setTeamSize(v => Math.min(12, v + 1))}
                  className="w-12 h-12 rounded-full border-2 border-border flex items-center justify-center text-xl font-bold text-foreground hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all disabled:opacity-30"
                  disabled={teamSize >= 12}>
                  +
                </button>
              </div>

              <div className="flex gap-2">
                {[2, 3, 4, 5, 6].map(n => (
                  <button key={n} onClick={() => setTeamSize(n)}
                    className={`w-10 h-10 rounded-lg text-sm font-semibold border transition-all ${teamSize === n ? "border-blue-500 bg-blue-50 text-blue-600" : "border-border bg-muted text-muted-foreground hover:border-slate-300"}`}>
                    {n}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap justify-center gap-2 max-w-xs">
                {Array.from({ length: teamSize }).map((_, i) => (
                  <div key={i} className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold"
                    style={{ background: ["#3B5BDB", "#7048E8", "#10B981", "#F59E0B", "#EF4444", "#06B6D4"][i % 6] }}>
                    <User className="w-4 h-4" />
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground text-center">본인 포함 총 {teamSize}명 · 다음 단계에서 이메일로 초대할 수 있습니다</p>
            </div>
          )}

          {/* ── step 2: deliverables + tech stack + goals (leader is always the creator) ── */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 p-3 rounded-xl border border-blue-200 bg-blue-50">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0" style={{ background: "#3B5BDB" }}>
                  {(userName || "?")[0]}
                </div>
                <p className="text-xs text-blue-700">
                  <span className="font-semibold">{userName}</span>님이 팀장(LEADER)이 됩니다. 업무 배정, 팀 코멘트, 팀원 관리 권한을 가집니다.
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground mb-2 block">목표 산출물</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {DELIVERABLE_OPTIONS.map(option => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => toggleDeliverable(option)}
                      className={`px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                        deliverables.includes(option)
                          ? "border-blue-500 bg-blue-50 text-blue-600"
                          : "border-border bg-muted text-muted-foreground hover:border-slate-300"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">기술 스택 / 주요 기능 키워드</label>
                <div className="flex gap-2">
                  <input
                    value={techStackInput}
                    onChange={e => setTechStackInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTechStackTag(); } }}
                    placeholder="예: Spring Boot (Enter로 추가)"
                    className="flex-1 rounded-xl border border-border bg-input-background px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
                  />
                  <button type="button" onClick={addTechStackTag}
                    className="px-3 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
                    추가
                  </button>
                </div>
                {techStack.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {techStack.map(tag => (
                      <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-violet-50 text-violet-700 border border-violet-200">
                        {tag}
                        <button type="button" onClick={() => removeTechStackTag(tag)} className="hover:text-violet-900">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">진행 목표 / 메모</label>
                <textarea
                  value={goals}
                  onChange={e => setGoals(e.target.value)}
                  placeholder="예: MVP까지 목표, 매주 수요일 정기회의"
                  rows={3}
                  className="w-full rounded-xl border border-border bg-input-background px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all resize-none"
                />
              </div>
            </div>
          )}

          {/* ── step 3: real per-email invitations ── */}
          {step === 3 && (
            <div className="space-y-4">
              {submitError && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-600">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {submitError}
                </div>
              )}

              <EmailInviteGroup
                title="팀원 초대"
                description="팀원은 회의록, 업무 보드, 대시보드, 산출물에 접근할 수 있습니다."
                icon={Users}
                color="#3B5BDB"
                emails={memberEmails}
                onChange={(i, v) => updateEmailAt(memberEmails, setMemberEmails, i, v)}
                onAdd={() => addEmailRow(memberEmails, setMemberEmails)}
                onRemove={i => removeEmailRow(memberEmails, setMemberEmails, i)}
              />

              <EmailInviteGroup
                title="심사자 초대"
                description="심사자는 개인별 기여도 리포트·AI 평가 근거·최종 점수 관리에 접근할 수 있습니다."
                icon={Shield}
                color="#7048E8"
                emails={reviewerEmails}
                onChange={(i, v) => updateEmailAt(reviewerEmails, setReviewerEmails, i, v)}
                onAdd={() => addEmailRow(reviewerEmails, setReviewerEmails)}
                onRemove={i => removeEmailRow(reviewerEmails, setReviewerEmails, i)}
              />

              <p className="text-[11px] text-muted-foreground">지금 초대하지 않아도 나중에 사이드바의 프로젝트 메뉴에서 초대 코드로 팀원을 초대할 수 있습니다.</p>
            </div>
          )}
        </div>

        {/* card footer */}
        <div className="px-8 pb-7 pt-2 flex items-center justify-between">
          <button
            onClick={() => setStep(s => s - 1)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all ${step === 0 ? "invisible" : ""}`}>
            <ArrowLeft className="w-4 h-4" /> 이전
          </button>

          {step < 3 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={!canGoNext}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-white text-sm font-semibold transition-all disabled:opacity-40 hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #3B5BDB 0%, #4F6EF7 100%)" }}>
              다음 <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleFinish}
              disabled={submitting}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-white text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, #7048E8 0%, #4F6EF7 100%)" }}>
              {submitting ? (
                <><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> 생성 중...</>
              ) : (
                <><Sparkles className="w-4 h-4" /> 시작하기</>
              )}
            </button>
          )}
        </div>
      </div>

      {/* skip link */}
      <button onClick={onSkip} className="mt-5 text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2">
        나중에 설정하기
      </button>
    </div>
  );
}

function EmailInviteGroup({ title, description, icon: Icon, color, emails, onChange, onAdd, onRemove }: {
  title: string; description: string; icon: any; color: string;
  emails: string[]; onChange: (index: number, value: string) => void;
  onAdd: () => void; onRemove: (index: number) => void;
}) {
  return (
    <div className="rounded-xl border-2 p-4" style={{ borderColor: `${color}40`, background: `${color}08` }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: color }}>
          <Icon className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-sm font-semibold text-foreground">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">{description}</p>

      <div className="space-y-2">
        {emails.map((email, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 p-2.5 rounded-lg bg-white border border-border">
              <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <input
                type="email"
                value={email}
                onChange={e => onChange(i, e.target.value)}
                placeholder="name@university.ac.kr"
                className="flex-1 text-xs text-foreground outline-none bg-transparent"
              />
            </div>
            {emails.length > 1 && (
              <button onClick={() => onRemove(i)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      <button onClick={onAdd} className="mt-2 flex items-center gap-1 text-xs font-semibold" style={{ color }}>
        <Plus className="w-3.5 h-3.5" /> 이메일 추가
      </button>
    </div>
  );
}
