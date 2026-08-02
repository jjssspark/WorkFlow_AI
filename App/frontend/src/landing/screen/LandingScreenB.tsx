import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useNavigate } from "react-router";
import { AnimatePresence, motion, type Variants } from "motion/react";
import {
  ArrowRight,
  Mic,
  KanbanSquare,
  Bot,
  Award,
  LineChart,
  GraduationCap,
  Hammer,
  Rocket,
  Trophy,
  Users,
  Sparkles,
  Github,
  Check,
  Quote,
} from "lucide-react";
import { cn } from "../../global/component/ui/utils";
import { useAuth } from "../../global/hooks/useAuth";
import { HeroIllustration } from "../components/HeroIllustration";
import screenshotMeetings from "../assets/screenshots/meetings-ai.png";
import screenshotBoard from "../assets/screenshots/board.png";
import screenshotDashboard from "../assets/screenshots/dashboard.png";
import screenshotAssistant from "../assets/screenshots/assistant.png";
import screenshotContribution from "../assets/screenshots/contribution.png";

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
};

const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09 } },
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

const ROTATING_WORDS = ["회의", "업무", "기여도"];

function RotatingWord() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % ROTATING_WORDS.length), 1800);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="relative inline-flex h-[1.15em] w-[3.4em] align-bottom overflow-hidden rounded-lg bg-primary/15 px-2">
      <AnimatePresence mode="wait">
        <motion.span
          key={ROTATING_WORDS[index]}
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -24, opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-0 flex items-center justify-center text-primary"
        >
          {ROTATING_WORDS[index]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "About", href: "#about" },
  { label: "Reviews", href: "#reviews" },
];

const FEATURE_CARDS = [
  { icon: Mic, title: "회의록 AI 분석", desc: "업로드만 하면 요약·To-Do가 자동 생성됩니다.", screenshot: screenshotMeetings },
  { icon: KanbanSquare, title: "업무 보드", desc: "4단계 칸반으로 우선순위를 한눈에 관리합니다.", screenshot: screenshotBoard },
  { icon: Bot, title: "AI 어시스턴트", desc: "프로젝트 데이터를 근거로 질문에 답합니다.", screenshot: screenshotAssistant },
  { icon: LineChart, title: "대시보드 + ML 예측", desc: "지연 위험도와 진행률을 함께 보여줍니다.", screenshot: screenshotDashboard },
  { icon: Award, title: "기여도 분석", desc: "회의 참여·업무 수행·GitHub 활동을 정량화해 기여 근거를 제공합니다.", screenshot: screenshotContribution },
];


const AUDIENCE_GRID = [
  { icon: GraduationCap, title: "대학생 팀프로젝트", desc: "회의부터 발표까지 한 곳에서" },
  { icon: Hammer, title: "캡스톤디자인", desc: "장기 프로젝트 진행률 관리" },
  { icon: Rocket, title: "해커톤", desc: "빠른 속도로 결과 정리" },
  { icon: Sparkles, title: "AI 경진대회", desc: "실험 기록과 기여도 정리" },
  { icon: Trophy, title: "공모전", desc: "발표자료 초안까지 자동 생성" },
  { icon: Users, title: "동아리 프로젝트", desc: "역할 분담과 일정 공유" },
];

const REVIEWS = [
  {
    quote: "회의만 끝내면 업무 보드가 알아서 채워져서, 회의록 정리에 쓰던 시간이 거의 사라졌어요.",
    name: "허영주",
    role: "팀장 · 캡스톤디자인",
  },
  {
    quote: "누가 뭘 하기로 했는지 항상 헷갈렸는데, 담당자·마감일이 자동으로 붙으니 헷갈릴 일이 없어졌어요.",
    name: "박상준",
    role: "팀원 · AI 경진대회",
  },
  {
    quote: "심사할 때 팀원별 기여 근거를 따로 요청 안 해도 대시보드에서 바로 확인할 수 있어 좋았습니다.",
    name: "고무서",
    role: "심사자",
  },
  {
    quote: "해커톤 특성상 기록할 시간이 없었는데, 회의록만 올려도 To-Do가 정리돼서 개발에만 집중할 수 있었어요.",
    name: "이은주",
    role: "팀원 · 해커톤",
  },
  {
    quote: "발표 직전까지 흩어져 있던 자료를 대시보드 하나로 관리하니 팀원들 보고가 훨씬 줄었어요.",
    name: "박지수",
    role: "팀장 · 공모전",
  },
  {
    quote: "지연 위험도 예측 덕분에 마감 임박한 업무를 미리 챙길 수 있어서 일정 관리가 편해졌습니다.",
    name: "유소은",
    role: "팀원 · 캡스톤디자인",
  },
  {
    quote: "동아리 프로젝트라 역할 분담이 늘 애매했는데, 업무 보드로 담당자가 명확해졌어요.",
    name: "홍길동",
    role: "팀원 · 동아리 프로젝트",
  },
  {
    quote: "여러 팀을 동시에 심사하다 보니 기여도 리포트가 큰 도움이 됐습니다. 근거 자료를 따로 요청할 필요가 없었어요.",
    name: "정민아",
    role: "심사자",
  },
];

const PLAN_CARDS = [
  {
    name: "Start",
    tagline: "팀 프로젝트를 지금 바로 시작해보세요.",
    price: "무료",
    period: "",
    features: ["업무 보드 참여", "회의록 자동 요약 열람", "AI 어시스턴트 질의 (월 20회)"],
    cta: "시작하기",
    paid: false,
  },
  {
    name: "Pro",
    tagline: "성장하는 팀을 위한 자동화와 예측 기능.",
    price: "₩9,900",
    period: "/월",
    features: ["업무 보드 생성·배정", "대시보드 + ML 예측", "AI 어시스턴트 무제한 질의", "팀 전체 진행률 관리"],
    cta: "결제하기",
    paid: true,
    highlight: true,
  },
  {
    name: "Max",
    tagline: "다수 프로젝트와 심사 워크플로우를 위한 올인원.",
    price: "₩19,900",
    period: "/월",
    features: ["Pro의 모든 기능", "팀별 기여도 리포트", "심사 의견 입력", "다중 프로젝트 관리"],
    cta: "결제하기",
    paid: true,
  },
];

export function LandingScreenB() {
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
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      {/* Hero */}
      <div className="relative overflow-hidden bg-[#0B0A1A] text-white">
        <motion.div
          className="pointer-events-none absolute -top-52 left-1/4 size-[620px] rounded-full bg-fuchsia-600/25 blur-3xl"
          animate={{ x: [0, 60, 0], y: [0, 40, 0] }}
          transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="pointer-events-none absolute top-0 right-0 size-[500px] rounded-full bg-primary/25 blur-3xl"
          animate={{ x: [0, -50, 0], y: [0, 50, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="pointer-events-none absolute bottom-0 left-1/2 size-[420px] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl"
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Nav */}
        <header
          className={cn(
            "sticky top-0 z-50 border-b transition-colors",
            scrolled ? "border-white/10 bg-[#0B0A1A]/80 backdrop-blur-md" : "border-transparent",
          )}
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-2 font-semibold">
              <motion.span
                animate={{ y: [0, -4, 0] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs"
              >
                TF
              </motion.span>
              WorkFlow AI
            </div>
            <nav className="hidden items-center gap-8 text-sm text-white/70 md:flex">
              {NAV_LINKS.map((l) => (
                <a key={l.label} href={l.href} className="transition-colors hover:text-white">
                  {l.label}
                </a>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate("/login")}
                className="hidden rounded-md px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:text-white sm:block"
              >
                로그인
              </button>
              <button
                onClick={() => navigate("/signup")}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition-transform hover:scale-[1.03] active:scale-[0.98]"
              >
                가입하기
              </button>
            </div>
          </div>
        </header>

        {/* Hero content */}
        <div className="relative mx-auto max-w-3xl px-6 pb-16 pt-16 text-center md:pt-24">
          <motion.div initial="hidden" animate="show" variants={staggerContainer}>
            <Reveal variants={fadeUp}>
              <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
                팀 프로젝트의
                <br />
                모든 [ <RotatingWord /> ]를 연결합니다
              </h1>
            </Reveal>
            <Reveal variants={fadeUp}>
              <p className="mx-auto mt-6 max-w-md text-white/70">
                AI로 회의 기록을 바로 업무로 만드세요. <br/> 회의록부터 기여도 평가까지 하나의 플랫폼에서 이어집니다.
              </p>
            </Reveal>
            <Reveal variants={fadeUp} className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => navigate("/signup")}
                className="group flex items-center gap-2 rounded-md bg-primary px-6 py-3 font-medium text-white shadow-lg shadow-primary/30 transition-transform hover:scale-[1.03] active:scale-[0.98]"
              >
                무료로 시작하기
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </button>
            </Reveal>
          </motion.div>
        </div>

        {/* Dashboard illustration rising up, cropped at the bottom */}
        <div className="relative mx-auto max-w-5xl px-6 pb-0">
          <motion.div
            initial={{ opacity: 0, y: 140 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ type: "spring", stiffness: 90, damping: 13, mass: 0.9 }}
            className="h-[280px] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-3 shadow-2xl backdrop-blur sm:h-[340px] md:h-[400px]"
          >
            <div className="h-full overflow-hidden rounded-xl">
              <HeroIllustration className="h-full w-full" />
            </div>
          </motion.div>
        </div>
      </div>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-24">
        <Reveal className="text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">Features</span>
          <h2 className="mt-3 text-2xl font-semibold md:text-3xl">
            팀 프로젝트를 더 스마트하게
            <br />
            운영하는 데 필요한 모든 것
          </h2>
          <p className="mt-3 text-muted-foreground">
            WorkFlow AI는 회의·업무·기여도를 위한 스마트 도구를 하나로 묶었습니다.
          </p>
        </Reveal>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {FEATURE_CARDS.map((f) => (
            <motion.div
              key={f.title}
              variants={fadeUp}
              whileHover={{ y: -6, boxShadow: "0 12px 24px -8px rgba(59,91,219,0.25)" }}
              className="rounded-xl border border-border bg-card p-6 shadow-sm"
            >
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <f.icon className="size-5" />
              </span>
              <div className="mt-4 h-24 overflow-hidden rounded-lg border border-border">
                <img src={f.screenshot} alt={f.title} className="w-full object-cover object-top" loading="lazy" />
              </div>
              <h3 className="mt-4 font-medium">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* About / audience */}
      <section id="about" className="relative overflow-hidden bg-[#171233] py-24 text-white">
        <motion.div
          className="pointer-events-none absolute -bottom-40 right-0 size-[520px] rounded-full bg-fuchsia-500/20 blur-3xl"
          animate={{ x: [0, -40, 0], y: [0, 30, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="pointer-events-none absolute -top-32 left-0 size-[420px] rounded-full bg-primary/20 blur-3xl"
          animate={{ x: [0, 30, 0], y: [0, -20, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        />

        <div className="relative mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-[1fr_1.4fr]">
          <Reveal className="w-full">
            <span className="text-xs font-semibold uppercase tracking-widest text-primary/80">About</span>
            <h2 className="mt-3 w-full text-2xl font-semibold md:text-3xl">이런 팀에 필요합니다</h2>
            <p className="mt-3 w-full text-white/60">기록과 기록 사이가 끊기지 않아야 하는 모든 팀 활동에 어울려요.</p>
          </Reveal>

          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="grid grid-cols-2 gap-3 sm:grid-cols-3"
          >
            {AUDIENCE_GRID.map((a) => (
              <motion.div
                key={a.title}
                variants={fadeUp}
                whileHover={{ y: -4 }}
                className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur"
              >
                <span className="flex size-8 items-center justify-center rounded-lg bg-white/10 text-white">
                  <a.icon className="size-4" />
                </span>
                <h3 className="mt-3 text-sm font-medium">{a.title}</h3>
                <p className="mt-1 text-xs text-white/50 leading-relaxed">{a.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Reviews */}
      <section id="reviews" className="mx-auto max-w-6xl px-6 py-24">
        <Reveal className="text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">Reviews</span>
          <h2 className="mt-3 text-2xl font-semibold md:text-3xl">사용자 후기</h2>
          <p className="mt-3 text-muted-foreground">팀장, 팀원, 심사자가 WorkFlow AI를 이렇게 쓰고 있습니다.</p>
        </Reveal>

        <Reveal className="mt-12 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_5%,black_95%,transparent)]">
          <motion.div
            className="flex w-max gap-4"
            animate={{ x: ["0%", "-50%"] }}
            transition={{ duration: 32, repeat: Infinity, ease: "linear" }}
          >
            {[...REVIEWS, ...REVIEWS].map((r, i) => (
              <div
                key={`${r.name}-${i}`}
                className="w-80 shrink-0 rounded-xl border border-border bg-card p-6 shadow-sm"
              >
                <Quote className="size-5 text-primary/40" />
                <p className="mt-3 text-sm leading-relaxed text-foreground">{r.quote}</p>
                <div className="mt-5 flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                    {r.name.slice(0, 1)}
                  </span>
                  <div className="text-xs">
                    <div className="font-medium text-foreground">{r.name}</div>
                    <div className="text-muted-foreground">{r.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        </Reveal>
      </section>

      {/* Sign up / plans */}
      <section className="relative overflow-hidden bg-[#0B0A1A] py-24 text-white">
        <motion.div
          className="pointer-events-none absolute inset-x-0 top-0 h-full bg-gradient-to-b from-primary/15 to-transparent"
          animate={{ opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
        <Reveal className="relative mx-auto max-w-2xl px-6 text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-primary/80">Sign up</span>
          <h2 className="mt-3 text-2xl font-semibold md:text-3xl">WorkFlow AI와 함께 더 스마트하게 시작하세요</h2>
          <p className="mt-3 text-white/60">팀 규모와 필요에 맞는 플랜을 선택하세요. Start는 언제나 무료입니다.</p>
        </Reveal>

        <div className="relative mx-auto mt-12 grid max-w-5xl gap-6 px-6 md:grid-cols-3">
          {PLAN_CARDS.map((p) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              whileHover={{ y: -6 }}
              transition={{ duration: 0.4 }}
              className="group relative"
            >
              <div
                className={cn(
                  "pointer-events-none absolute -inset-10 rounded-[2.5rem] opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100",
                  "bg-[conic-gradient(from_140deg,#d946ef,#a855f7,#38bdf8,#d946ef)]",
                  p.highlight && "opacity-50",
                )}
              />
              <div className="relative flex h-full flex-col rounded-3xl border border-white/15 bg-white/[0.06] p-6 text-left backdrop-blur-xl">
                {p.highlight && (
                  <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-[10px] font-semibold text-white">
                    가장 인기
                  </span>
                )}
                <div className="text-sm font-semibold text-white/70">{p.name}</div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-semibold">{p.price}</span>
                  {p.period && <span className="text-sm text-white/50">{p.period}</span>}
                </div>
                <p className="mt-2 text-xs text-white/50">{p.tagline}</p>
                <ul className="mt-5 flex-1 space-y-2 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <Check className="size-4 shrink-0 text-primary" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={p.paid ? undefined : () => navigate("/signup")}
                  title={p.paid ? "결제 기능은 준비 중입니다" : undefined}
                  className={cn(
                    "mt-6 w-full rounded-full py-2.5 text-sm font-semibold transition-transform hover:scale-[1.02] active:scale-[0.98]",
                    p.paid ? "cursor-not-allowed bg-white text-[#0B0A1A]" : "bg-primary text-white",
                  )}
                >
                  {p.cta}
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#171233] py-16 text-white">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-10 border-b border-white/10 pb-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <div className="flex items-center gap-2 font-semibold">
                <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs">TF</span>
                WorkFlow AI
              </div>
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-white/50">
                회의부터 업무, 기여도 평가까지 팀 프로젝트의 모든 기록을 AI로 연결하는 팀 협업 플랫폼입니다.
              </p>
              <a
                href="https://github.com"
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 text-sm text-white/50 transition-colors hover:text-white"
              >
                <Github className="size-4" />
                GitHub
              </a>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-white">제품</h4>
              <ul className="mt-4 space-y-2.5 text-sm text-white/50">
                <li><a href="#features" className="transition-colors hover:text-white">기능</a></li>
                <li><a href="#about" className="transition-colors hover:text-white">소개</a></li>
                <li><a href="#reviews" className="transition-colors hover:text-white">후기</a></li>
                <li><button onClick={() => navigate("/signup")} className="transition-colors hover:text-white">요금제</button></li>
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-white">회사 정보</h4>
              <ul className="mt-4 space-y-2.5 text-sm text-white/50">
                <li>WorkFlow AI 팀</li>
                <li>대표자 고무서</li>
                <li>개인정보 보호책임자 박지수</li>
                <li>휴먼 3조 AI 파이널 프로젝트 · 2026</li>
                <li>
                  <a href="mailto:contact@workflow.ai" className="transition-colors hover:text-white">
                    contact@workflow.ai
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-white">약관</h4>
              <ul className="mt-4 space-y-2.5 text-sm text-white/50">
                <li><a href="#" className="transition-colors hover:text-white">이용약관</a></li>
                <li><a href="#" className="transition-colors hover:text-white">개인정보처리방침</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-8 flex flex-col items-center justify-between gap-4 text-xs text-white/40 sm:flex-row">
            <span>© 2026 WorkFlow AI. All rights reserved.</span>
            <span>본 서비스는 캡스톤디자인 프로젝트로 제작되었습니다.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
