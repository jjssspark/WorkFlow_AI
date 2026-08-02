import { motion } from "motion/react";
import { cn } from "../../global/component/ui/utils";

/**
 * 실제 스크린샷 대신, 각 기능을 상징하는 미니 대시보드 목업을 CSS로 구성한다.
 * 스크린샷 자산이 없는 상태에서도 시안의 "카드 안에 카드" 느낌을 재현하기 위함.
 */
function Dot({ className }: { className?: string }) {
  return <span className={cn("inline-block size-2 rounded-full", className)} />;
}

function Bar({ w, className }: { w: string; className?: string }) {
  return <div className={cn("h-2 rounded-full bg-current/10", className)} style={{ width: w }} />;
}

export function MeetingMockPanel() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Dot className="bg-destructive" />
        <span>REC 12:04</span>
      </div>
      <div className="space-y-1.5">
        {["요약", "핵심 결정사항", "위험요소", "To-Do"].map((label, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, x: -8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08, duration: 0.4 }}
            className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2"
          >
            <span className="text-xs font-medium text-primary">{label}</span>
            <div className="h-1.5 flex-1 rounded-full bg-border" />
          </motion.div>
        ))}
      </div>
      <motion.div
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.3 }}
        className="h-8 origin-left rounded-lg bg-primary/10 flex items-center px-3 text-xs text-primary"
      >
        업무 보드로 3건 등록 →
      </motion.div>
    </div>
  );
}

export function BoardMockPanel() {
  const cols = [
    { title: "요청", color: "bg-muted-foreground", items: 2 },
    { title: "진행중", color: "bg-primary", items: 3 },
    { title: "검토", color: "bg-accent", items: 1 },
    { title: "완료", color: "bg-chart-3", items: 4 },
  ];
  return (
    <div className="grid grid-cols-4 gap-2">
      {cols.map((c, ci) => (
        <div key={c.title} className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
            <Dot className={c.color} />
            {c.title}
          </div>
          {Array.from({ length: c.items }).map((_, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: (ci * c.items + i) * 0.05 }}
              className="rounded-md bg-muted/70 p-1.5 space-y-1"
            >
              <Bar w="80%" className="text-foreground" />
              <Bar w="50%" className="text-foreground" />
            </motion.div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function DashboardMockPanel() {
  const bars = [40, 65, 50, 80, 60, 90, 70];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {["진행률", "위험도", "완료 임박"].map((label, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
            className="rounded-lg bg-muted/60 p-2"
          >
            <div className="text-[10px] text-muted-foreground">{label}</div>
            <div className="text-sm font-semibold text-foreground">{[72, 24, 6][i]}{i === 2 ? "건" : "%"}</div>
          </motion.div>
        ))}
      </div>
      <div className="flex items-end gap-1.5 h-16 rounded-lg bg-muted/40 p-2">
        {bars.map((h, i) => (
          <motion.div
            key={i}
            initial={{ height: 0 }}
            whileInView={{ height: `${h}%` }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.06, duration: 0.5, ease: "easeOut" }}
            className="flex-1 rounded-t-sm bg-gradient-to-t from-primary to-accent"
          />
        ))}
      </div>
    </div>
  );
}

export function AssistantMockPanel() {
  const bubbles = [
    { me: false, text: "이번 주 지연 위험이 큰 업무가 뭐야?" },
    { me: true, text: "'API 연동' 업무가 마감 2일 전, 진행률 30%로 위험도가 높습니다." },
  ];
  return (
    <div className="space-y-2">
      {bubbles.map((b, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.15 }}
          className={cn("max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed", b.me ? "ml-auto bg-primary text-primary-foreground" : "bg-muted text-foreground")}
        >
          {b.text}
        </motion.div>
      ))}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ delay: 0.4 }}
        className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] text-muted-foreground"
      >
        업무 만들어줘
        <span className="ml-auto flex gap-0.5">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
              className="size-1 rounded-full bg-primary"
            />
          ))}
        </span>
      </motion.div>
    </div>
  );
}

export function ContributionMockPanel() {
  const people = [
    { name: "허영주", pct: 32 },
    { name: "박상준", pct: 26 },
    { name: "유소은", pct: 22 },
    { name: "이은주", pct: 20 },
  ];
  return (
    <div className="space-y-2">
      {people.map((p, i) => (
        <div key={p.name} className="flex items-center gap-2 text-xs">
          <span className="w-12 shrink-0 text-muted-foreground">{p.name}</span>
          <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              whileInView={{ width: `${p.pct}%` }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.6, ease: "easeOut" }}
              className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
            />
          </div>
          <span className="w-8 text-right text-muted-foreground">{p.pct}%</span>
        </div>
      ))}
    </div>
  );
}
