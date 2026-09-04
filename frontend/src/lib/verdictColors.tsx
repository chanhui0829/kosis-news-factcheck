import type { ReactNode } from "react";
import type { VerdictType } from "../types/verification";
import { VerdictIcon } from "../components/dashboard/VerdictIcon";

// verification_result가 null인 레코드(판정 자체가 안 된 애매/표매칭_불충분 상태)는
// "애매"로 취급 — 화면 전체(뱃지/하이라이트/카드)에서 일관되게 쓰는 색 매핑.
export type VerdictLabel = VerdictType | "애매";

export function verdictLabel(verdict: VerdictType | null): VerdictLabel {
  return verdict ?? "애매";
}

// 기사 목록 카드의 "요약 개수 박스"에서만 쓰는 라벨. 판단불가/애매(표매칭 신뢰도 낮음)는
// 색도 똑같이 주황이라 박스를 따로 두면 "1, 1"처럼 같은 색 박스 두 개가 나란히 나와
// 헷갈린다 — 둘 다 "확실하지 않음"이라는 같은 의미라 하나로 합쳐서 센다.
export function verdictCountLabel(verdict: VerdictType | null): "일치" | "불일치" | "애매" {
  if (verdict === "일치" || verdict === "불일치") return verdict;
  return "애매";
}

export const VERDICT_BADGE_CLASS: Record<VerdictLabel, string> = {
  일치: "bg-match-100 text-match-800 dark:bg-match-900/40 dark:text-match-300",
  불일치: "bg-mismatch-100 text-mismatch-800 dark:bg-mismatch-900/40 dark:text-mismatch-300",
  판단불가: "bg-caution-100 text-caution-800 dark:bg-caution-900/40 dark:text-caution-300",
  애매: "bg-caution-100 text-caution-800 dark:bg-caution-900/40 dark:text-caution-300",
};

export const VERDICT_HIGHLIGHT_CLASS: Record<VerdictLabel, string> = {
  일치:
    "bg-match-50 font-semibold text-match-900 underline decoration-match-500/80 decoration-2 underline-offset-2 dark:bg-match-900/20 dark:text-match-200",
  불일치:
    "bg-mismatch-50 font-semibold text-mismatch-900 underline decoration-mismatch-500/80 decoration-2 underline-offset-2 dark:bg-mismatch-900/20 dark:text-mismatch-200",
  판단불가:
    "bg-caution-50 font-semibold text-caution-900 underline decoration-caution-500/80 decoration-2 underline-offset-2 dark:bg-caution-900/20 dark:text-caution-200",
  애매:
    "bg-caution-50 font-semibold text-caution-900 underline decoration-caution-500/80 decoration-2 underline-offset-2 dark:bg-caution-900/20 dark:text-caution-200",
};

// 원문 하이라이트 위에 뜨는 번호 배지 색 — 하이라이트와 같은 계열 색을 써서 번호가 하이라이트와
// 분리된 별개 요소가 아니라 한 세트로 보이게 한다.
export const VERDICT_MARKER_CLASS: Record<VerdictLabel, string> = {
  일치: "bg-match-500/80 text-white",
  불일치: "bg-mismatch-500/80 text-white",
  판단불가: "bg-caution-500/80 text-white",
  애매: "bg-caution-500/80 text-white",
};

// 원문 하이라이트를 클릭했을 때 뜨는 말풍선 팝오버의 상단 액센트 바 + 꼬리(화살표) 색.
// ArticleDetail의 ACCENT_BAR_CLASS와 같은 팔레트를 재사용해 판정색 신호를 화면 전체에서
// 일관되게 유지한다.
export const VERDICT_POPOVER_ACCENT_CLASS: Record<VerdictLabel, string> = {
  일치: "bg-match-500",
  불일치: "bg-mismatch-500",
  판단불가: "bg-caution-500",
  애매: "bg-caution-500",
};

export const VERDICT_COUNT_BOX_CLASS: Record<"일치" | "불일치" | "애매", string> = {
  일치: "bg-match-100 text-match-800 dark:bg-match-900/40 dark:text-match-300",
  불일치: "bg-mismatch-100 text-mismatch-800 dark:bg-mismatch-900/40 dark:text-mismatch-300",
  애매: "bg-caution-100 text-caution-800 dark:bg-caution-900/40 dark:text-caution-300",
};

// 2026-09-03(4): h-6(24px)는 이 아이콘이 실제로 쓰이는 자리(ArticleDetail 요약 뱃지,
// text-xs=12px 라벨 옆)에 비해 너무 커서 뱃지마다 높이/여백이 들쭉날쭉해 보였다 —
// 라벨 텍스트와 어울리는 크기로 줄임.
export const VERDICT_ICON: Record<"일치" | "불일치" | "애매", ReactNode> = {
  일치: <VerdictIcon verdict="일치" className="h-5 w-5" />,
  불일치: <VerdictIcon verdict="불일치" className="h-5 w-5" />,
  애매: <VerdictIcon verdict="애매" className="h-5 w-5" />,
};
