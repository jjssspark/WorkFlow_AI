import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useNavigate } from "react-router";
import { motion, type Variants } from "motion/react";
import {
  ArrowRight,
  FileClock,
  Users2,
  TrendingUp,
  HelpCircle,
  Sparkles,
  Github,
} from "lucide-react";
import { cn } from "../../global/component/ui/utils";
import { useAuth } from "../../global/hooks/useAuth";
import { ScreenshotFrame } from "../components/ScreenshotFrame";
import screenshotMeetings from "../assets/screenshots/meetings-ai.png";
import screenshotBoard from "../assets/screenshots/board.png";
import screenshotDashboard from "../assets/screenshots/dashboard.png";
import screenshotAssistant from "../assets/screenshots/assistant.png";
import screenshotContribution from "../assets/screenshots/contribution.png";

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
};

const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

function Reveal({
  children,
  className,
  variants = fadeUp,
}: {
  children: ReactNode;
  className?: string;
  variants?: Variants;
}) {
  return (
    <motion.div
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-80px" }}
    >
      {children}
    </motion.div>
  );
}

const PAIN_POINTS = [
  {
    icon: FileClock,
    title: "회의록 정리 부담",
    desc: "회의가 끝나면 누가 요약·업무분장 담당자와 마감일을 다시 옮겨 적어야 합니다.",
  },
  {
    icon: Users2,
    title: "역할 분담 불명확",
    desc: "회의에서 정한 일과 업무 보드에 남아있는 \"누가 뭘 하기로 했더라\"가 분명하지 않습니다.",
  },
  {
    icon: TrendingUp,
    title: "진행 상황 파악 어려움",
    desc: "마감 임박까지 업무 진행 상황을 한눈에 볼 방법이 없습니다.",
  },
  {
    icon: HelpCircle,
    title: "기여도 판단 어려움",
    desc: "교수·심사자가 팀별로 실제 기여 근거를 확인할 방법이 없습니다.",
  },
];

const FLOW_STEPS = ["회의록", "업무", "진행률", "기여도"];

const FEATURES: {
  title: string;
  desc: string;
  panel: () => ReactNode;
}[] = [
  {
    title: "회의록 AI 분석",
    desc: "문서·음성·영상을 올리면 요약, 핵심 결정사항, 위험요소, To-Do 후보를 자동 구조화합니다. 생성된 To-Do는 담당자·마감일을 붙여 바로 업무 보드에 등록할 수 있습니다.",
    panel: () => <ScreenshotFrame src={screenshotMeetings} alt="회의록 AI 분석 화면" />,
  },
  {
    title: "업무 보드",
    desc: "할 일/진행중/검토/완료 4단계 칸반. 카테고리(AI/ML/DB/디자인)별 우선순위와 마감 임박 체크리스트를 일관되게 관리합니다.",
    panel: () => <ScreenshotFrame src={screenshotBoard} alt="업무 보드 화면" />,
  },
  {
    title: "대시보드 + ML 예측",
    desc: "진행률, 마감 임박 업무, 팀원별 업무량, 최근 활동을 한 화면에서 확인하고, 지연 위험도 예측과 업무 완수 임박까지 함께 보여줍니다.",
    panel: () => <ScreenshotFrame src={screenshotDashboard} alt="대시보드 화면" />,
  },
  {
    title: "AI 어시스턴트",
    desc: "프로젝트의 회의록·업무 컨텍스트를 정리해 질문에 답합니다. \"업무 만들어줘\" 같은 실행형 커맨드도 사용자 확인 후 바로 반영됩니다.",
    panel: () => <ScreenshotFrame src={screenshotAssistant} alt="AI 어시스턴트 화면" />,
  },
  {
    title: "기여도 분석",
    desc: "업무 수행 회의 참여 업무 연동 GitHub 활동을 정량화해 팀원별 기여 근거를 만듭니다. 심사자 입력 데이터와 함께 최종 확정을 지원합니다.",
    panel: () => <ScreenshotFrame src={screenshotContribution} alt="기여도 분석 화면" />,
  },
];

const AUDIENCES = ["대학생 팀프로젝트", "캡스톤디자인", "해커톤", "AI 경진대회", "공모전"];

export function LandingScreenA() {
  const navigate = useNavigate();
  const { isAuthenticated, loading } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!loading && isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Header */}
      <header
        className={cn(
          "sticky top-0 z-50 border-b transition-colors",
          scrolled ? "border-border bg-background/80 backdrop-blur-md" : "border-transparent bg-transparent",
        )}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs">WF</span>
            WorkFlow AI
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/login")}
              className="rounded-md px-4 py-2 text-sm font-medium text-foreground/80 hover:text-foreground transition-colors"
            >
              로그인
            </button>
            <button
              onClick={() => navigate("/signup")}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-transform hover:scale-[1.03] hover:bg-primary/90 active:scale-[0.98]"
            >
              무료로 시작하기
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-[#0B1120] text-white">
        <motion.div
          className="pointer-events-none absolute -top-40 left-1/3 size-[560px] rounded-full bg-primary/25 blur-3xl"
          animate={{ x: [0, 40, 0], y: [0, 30, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="pointer-events-none absolute top-20 right-0 size-[420px] rounded-full bg-accent/25 blur-3xl"
          animate={{ x: [0, -30, 0], y: [0, 40, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        />

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-24 md:grid-cols-2 md:py-32">
          <motion.div initial="hidden" animate="show" variants={staggerContainer}>
            <Reveal>
              <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
                팀 프로젝트의 모든 흐름을
                <br />
                <span className="bg-gradient-to-r from-sky-400 via-primary to-accent bg-clip-text text-transparent">
                  AI가 하나로 연결합니다
                </span>
              </h1>
            </Reveal>
            <Reveal>
              <p className="mt-6 max-w-md text-white/70">
                회의록을 올리면 요약·To-Do가 자동으로 만들어져 업무 보드에 반영되고, 그 기록이 그대로 기여도 근거로 이어집니다.
              </p>
            </Reveal>
            <Reveal className="mt-8 flex flex-wrap items-center gap-3">
              <button
                onClick={() => navigate("/signup")}
                className="group flex items-center gap-2 rounded-md bg-primary px-6 py-3 font-medium text-white shadow-lg shadow-primary/30 transition-transform hover:scale-[1.03] active:scale-[0.98]"
              >
                무료로 시작하기
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </button>
              <button
                onClick={() => navigate("/login")}
                className="rounded-md border border-white/20 px-6 py-3 font-medium text-white/90 transition-colors hover:bg-white/10"
              >
                로그인
              </button>
            </Reveal>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 40, rotateY: -8 }}
            animate={{ opacity: 1, x: 0, rotateY: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
            className="relative"
          >
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-2xl backdrop-blur"
            >
              <div className="overflow-hidden rounded-xl">
                <img src={screenshotDashboard} alt="대시보드 화면" className="w-full object-cover object-top" />
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Pain points */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <Reveal className="text-center">
          <h2 className="text-2xl font-semibold md:text-3xl">팀프로젝트에서 진짜 시간을 잡아먹는 건 개발이 아닙니다</h2>
          <p className="mt-3 text-muted-foreground">기록과 기록 사이의 단절이 매번 반복됩니다</p>
        </Reveal>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {PAIN_POINTS.map((p) => (
            <motion.div
              key={p.title}
              variants={fadeUp}
              whileHover={{ y: -6 }}
              className="rounded-xl border border-border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <p.icon className="size-5" />
              </span>
              <h3 className="mt-4 font-medium">{p.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{p.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Data flow */}
      <section className="border-y border-border bg-muted/40 py-24">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <Reveal>
            <h2 className="text-2xl font-semibold md:text-3xl">하나의 데이터 흐름으로 묶었습니다</h2>
            <p className="mt-3 text-muted-foreground">각 단계마다 사람이 반복하던 판단을 LLM·RAG·ML이 대신합니다</p>
          </Reveal>

          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="mt-12 flex flex-wrap items-center justify-center gap-3"
          >
            {FLOW_STEPS.map((step, i) => (
              <div key={step} className="flex items-center gap-3">
                <motion.span
                  variants={fadeUp}
                  className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm"
                >
                  {step}
                </motion.span>
                {i < FLOW_STEPS.length - 1 && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.3 + i * 0.1 }}
                  >
                    <ArrowRight className="size-4 text-primary/60" />
                  </motion.span>
                )}
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <Reveal className="text-center">
          <h2 className="text-2xl font-semibold md:text-3xl">기능 하나하나가 실제로 동작합니다</h2>
        </Reveal>

        <div className="mt-16 space-y-24">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className={cn(
                "grid items-center gap-10 md:grid-cols-2",
                i % 2 === 1 && "md:[&>*:first-child]:order-2",
              )}
            >
              <Reveal variants={{ hidden: { opacity: 0, x: i % 2 === 0 ? -30 : 30 }, show: { opacity: 1, x: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } } }}>
                {f.panel()}
              </Reveal>
              <Reveal variants={{ hidden: { opacity: 0, x: i % 2 === 0 ? 30 : -30 }, show: { opacity: 1, x: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } } }}>
                <div className="flex items-center gap-2 text-primary">
                  <Sparkles className="size-4" />
                  <span className="text-xs font-medium uppercase tracking-wide">Feature</span>
                </div>
                <h3 className="mt-3 text-xl font-semibold">{f.title}</h3>
                <p className="mt-3 text-muted-foreground leading-relaxed">{f.desc}</p>
              </Reveal>
            </div>
          ))}
        </div>
      </section>

      {/* Audiences */}
      <section className="mx-auto max-w-6xl px-6 py-20 text-center">
        <Reveal>
          <h2 className="text-2xl font-semibold md:text-3xl">이런 팀에 필요합니다</h2>
        </Reveal>
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="mt-8 flex flex-wrap justify-center gap-3"
        >
          {AUDIENCES.map((a) => (
            <motion.span
              key={a}
              variants={fadeUp}
              whileHover={{ scale: 1.06 }}
              className="rounded-full border border-border bg-card px-5 py-2 text-sm font-medium text-foreground shadow-sm"
            >
              {a}
            </motion.span>
          ))}
        </motion.div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden bg-[#0B1120] py-24 text-white">
        <motion.div
          className="pointer-events-none absolute inset-x-0 top-0 h-full bg-gradient-to-b from-primary/20 to-transparent"
          animate={{ opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
        <Reveal className="relative mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-2xl font-semibold md:text-3xl">지금 무료로 시작하세요</h2>
          <p className="mt-3 text-white/70">회의록부터 기여도 평가까지, WorkFlow AI로 팀 프로젝트를 한 곳에서 관리하세요.</p>
          <button
            onClick={() => navigate("/signup")}
            className="group mt-8 inline-flex items-center gap-2 rounded-md bg-primary px-8 py-3 font-medium text-white shadow-lg shadow-primary/30 transition-transform hover:scale-[1.03] active:scale-[0.98]"
          >
            무료로 시작하기
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </button>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-sm text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground text-[10px]">WF</span>
            WorkFlow AI
          </div>
          <div className="flex items-center gap-4">
            <a href="https://github.com" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-foreground transition-colors">
              <Github className="size-4" />
              GitHub
            </a>
            <span>© 2026 WorkFlow AI</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
