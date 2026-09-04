import { useEffect, useState } from "react";
import type { ArticleGroup } from "../../lib/articles";
import { verdictCountLabel } from "../../lib/verdictColors";
import { kosisTableUrl } from "../../lib/kosis";
import { ScoreGauge } from "../dashboard/ScoreGauge";

interface InsightsPanelProps {
  group: ArticleGroup;
  tableOrgIds: Record<string, string>;
}

// 이 기사에서 검증에 쓰인 KOSIS 표들을 중복 없이 뽑는다.
function uniqueKosisTables(group: ArticleGroup): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const r of group.records) {
    if (r.kosis_table_id && r.kosis_table && !seen.has(r.kosis_table_id)) {
      seen.set(r.kosis_table_id, r.kosis_table);
    }
  }
  return Array.from(seen, ([id, name]) => ({ id, name }));
}

function summaryText(total: number, 일치: number, 불일치: number): string {
  if (불일치 > 0) {
    return `⚠️ 이 기사의 수치 주장 ${total}건 중 ${불일치}건이 KOSIS 공식 통계와 차이가 있습니다.`;
  }
  if (일치 > 0) {
    return `✅ 검증 가능했던 주장은 KOSIS 공식 통계와 일치합니다 (${일치}/${total}건).`;
  }
  return `🔍 이 기사의 수치 주장 ${total}건은 표 매칭 신뢰도가 낮거나 KOSIS로 검증하기 어려운 주제입니다.`;
}

export function InsightsPanel({ group, tableOrgIds }: InsightsPanelProps) {
  const total = group.records.length;
  const 일치 = group.records.filter((r) => verdictCountLabel(r.verification_result) === "일치").length;
  const 불일치 = group.records.filter((r) => verdictCountLabel(r.verification_result) === "불일치").length;
  const matchRate = total > 0 ? ((일치 + 불일치) / total) * 100 : 0;
  const scoreColorClass =
    matchRate >= 60 ? "stroke-match-500/80" : matchRate >= 30 ? "stroke-caution-500/80" : "stroke-mismatch-500/80";

  const kosisTables = uniqueKosisTables(group);

  const hasMismatch = 불일치 > 0;

  // 2026-09-03(33): 패널이 스크롤/화면 전환 시 아무 움직임 없이 그냥 나타나서 "정적이다"는
  // 피드백 — 마운트 직후 살짝 아래에서 위로 페이드인시키고, 안쪽 세 섹션(AI 분석 요약/
  // 핵심 지표/관련 KOSIS 데이터)은 순서대로 딜레이를 줘서 한 번에 툭 뜨지 않고 차례로
  // 나타나게 한다. 기사를 바꿔서 봐도 다시 재생되도록 호출부(ArticleDetail)에서
  // key={group.articleTitle}로 이 컴포넌트를 매번 새로 마운트시킨다.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const revealClass = `transition-all duration-500 ease-out ${mounted ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`;
  const revealStyle = (delayMs: number) => ({ transitionDelay: mounted ? `${delayMs}ms` : "0ms" });

  // 2026-09-03(34): 마운트 때만 한 번 움직이고 나면 그 뒤로는(sticky로 고정된 채) 계속
  // 정지 상태라 "스크롤할 때도 뭔가 움직였으면" 하는 피드백 — 스크롤량에 비례해 살짝
  // 위아래로 흔들리는 가벼운 패럴랙스를 추가했다. main이 스크롤 컨테이너라 window에
  // scroll 리스너를 캡처 단계로 걸어야 감지된다(scroll 이벤트는 버블링을 안 해서, 하위
  // 스크롤 컨테이너의 이벤트를 상위 window에서 받으려면 capture:true 필수 — 위
  // ArticleTextViewer 팝오버의 스크롤 추적과 같은 트릭). 진폭을 ±14px로 좁게 묶어둔 건
  // 너무 크게 흔들리면 sticky 패널이 옆 기사 본문과 어긋나 보이기 때문.
  const [scrollOffset, setScrollOffset] = useState(0);
  useEffect(() => {
    let rafId: number | null = null;
    const handleScroll = (e: Event) => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const scrollTop = (e.target as HTMLElement).scrollTop ?? 0;
        setScrollOffset(Math.max(-14, Math.min(14, scrollTop * 0.03)));
      });
    };
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    // 2026-09-03(3): top-24는 예전 상단 고정 Header(높이 있음) 기준 오프셋이었는데, 이제
    // 좌측 사이드바 레이아웃으로 바뀌면서 <main> 자체가 스크롤 컨테이너가 됐다 — 위쪽 여백이
    // 그만큼 필요 없어져서 top-6로 줄인다(sticky는 어떤 스크롤 컨테이너 안에서든 동일하게
    // 동작하므로 이 값만 조정하면 됨).
    <div
      className={`sticky top-6 flex h-fit flex-col gap-5 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition-[transform,opacity,box-shadow] duration-[400ms] ease-out hover:shadow-md dark:border-stone-700 dark:bg-stone-900 ${
        mounted ? "opacity-100" : "opacity-0"
      }`}
      // 등장 애니메이션(위→아래 12px)과 스크롤 패럴랙스(±14px)를 같은 transform 한 줄로
      // 합쳤다 — 마운트 전엔 12px 아래, 마운트 후엔 스크롤 오프셋을 그대로 반영. 트랜지션
      // 하나(400ms)가 스크롤로 값이 바뀔 때마다 매번 다시 걸리면서 "따라오는" 느낌을 만든다.
      style={{ transform: `translateY(${mounted ? scrollOffset : 12}px)` }}
    >
      <div className="flex items-center gap-2 border-b border-stone-100 px-5 py-4 dark:border-stone-800">
        <span className="h-2 w-2 rounded-full bg-match-600" />
        <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">Fact-Check Insights</span>
      </div>

      <div className="flex flex-col gap-5 px-5 pb-5">
        <div className={revealClass} style={revealStyle(80)}>
          <p className="mb-2 text-xs font-medium text-stone-500 dark:text-stone-400">AI 분석 요약</p>
          {/* 2026-09-03(3): 불일치가 있을 때는 그냥 문단 텍스트보다 색이 있는 콜아웃 박스로
              보여주는 게 한눈에 더 잘 띈다 — 판정색 팔레트(mismatch)를 그대로 재사용. */}
          <p
            className={`text-sm ${
              hasMismatch
                ? "rounded-lg border border-mismatch-200 bg-mismatch-50 px-3 py-2.5 font-medium text-mismatch-800 dark:border-mismatch-900/50 dark:bg-mismatch-900/20 dark:text-mismatch-300"
                : "text-stone-700 dark:text-stone-300"
            }`}
          >
            {summaryText(total, 일치, 불일치)}
          </p>
        </div>

        {/* 2026-09-03(6): "통계 기사 확실성"(1단계 classifier가 "이 기사가 통계 기사가
            맞다"고 판단한 확신도) 제거 — 이미 판정까지 끝난 기사를 보는 화면에서 이
            수치는 "그 판정이 얼마나 믿을 만한가"가 아니라 "애초에 이 기사를 왜 골랐는가"
            라는, 사용자 입장에선 의미를 알기 어려운 내부 파이프라인 지표였다. */}
        <div className={revealClass} style={revealStyle(160)}>
          <p className="mb-3 text-xs font-medium text-stone-500 dark:text-stone-400">핵심 지표</p>
          <div className="flex justify-center">
            <ScoreGauge value={matchRate} colorClass={scoreColorClass} />
          </div>
        </div>

        {kosisTables.length > 0 && (
          <div className={revealClass} style={revealStyle(240)}>
            <p className="mb-2 text-xs font-medium text-stone-500 dark:text-stone-400">
              관련 KOSIS 데이터
            </p>
            <ul className="flex flex-col gap-1.5">
              {kosisTables.map((t) => (
                <li key={t.id}>
                  <a
                    href={kosisTableUrl(t.id, tableOrgIds[t.id], t.name)}
                    target="_blank"
                    rel="noreferrer"
                    // 2026-09-03(4): 링크인 게 눈에 안 띈다는 피드백 — 회색 텍스트 대신
                    // 파란색(링크 관용색)으로 바꿔서 클릭 가능한 항목임을 바로 알 수 있게 함.
                    className="text-xs text-blue-600 hover:text-blue-700 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    🔗 {t.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
