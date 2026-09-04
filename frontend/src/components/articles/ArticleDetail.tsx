import { Fragment, useState } from "react";
import { articleDisplayDate, formatDate, type ArticleGroup } from "../../lib/articles";
import { VERDICT_COUNT_BOX_CLASS, VERDICT_ICON, verdictCountLabel } from "../../lib/verdictColors";
import { VerdictBadge } from "../claims/VerdictBadge";
import { ArticleTextViewer } from "./ArticleTextViewer";
import { InsightsPanel } from "./InsightsPanel";

interface ArticleDetailProps {
  group: ArticleGroup;
  articleText: string | undefined;
  tableOrgIds: Record<string, string>;
  articleDates: Record<string, string>;
  onDeleteArticle: (articleTitle: string) => void;
}

// 2026-09-03(5): 표시 순서를 일치→불일치→애매로 바꿈(요청 반영) — 이전엔 불일치를
// 맨 앞에 둬서 눈에 먼저 띄게 했었는데, 판정 결과를 나열하는 자리라 "정상(일치)부터
// 보여주는" 순서가 자연스럽다는 피드백.
const VERDICT_ORDER = ["일치", "불일치", "애매"] as const;

// 2026-09-03(17): 제목이 배경 위에 텍스트만 덩그러니 있어서 밋밋하다는 피드백 —
// 카드로 감싸고, 이 기사의 전체적인 판정 심각도(불일치가 하나라도 있으면 그게 가장
// 중요한 신호, 없으면 일치, 그마저 없으면 애매)에 따라 색이 바뀌는 상단 액센트 바 +
// 작은 eyebrow 라벨을 얹었다. InsightsPanel의 summaryText()가 이미 쓰는
// "불일치>0 우선, 그다음 일치, 나머지 애매" 우선순위와 같은 논리라 두 영역의 색
// 신호가 서로 어긋나지 않는다.
type OverallVerdict = (typeof VERDICT_ORDER)[number];

const ACCENT_BAR_CLASS: Record<OverallVerdict, string> = {
  일치: "bg-match-500",
  불일치: "bg-mismatch-500",
  애매: "bg-caution-500",
};

const EYEBROW_CLASS: Record<OverallVerdict, string> = {
  일치: "bg-match-50 text-match-700 dark:bg-match-900/30 dark:text-match-300",
  불일치: "bg-mismatch-50 text-mismatch-700 dark:bg-mismatch-900/30 dark:text-mismatch-300",
  애매: "bg-caution-50 text-caution-700 dark:bg-caution-900/30 dark:text-caution-300",
};

// 2026-09-03(4): "← 처음으로" 브레드크럼 버튼 제거 — 사이드바가 항상 화면에 떠 있고
// "새 통계 검증"/로고 클릭으로 언제든 홈으로 갈 수 있어서, 상세 화면 안에 또 있는 건
// 중복 내비게이션이었다(onBack prop도 이 버튼 하나 때문에 있었어서 같이 제거).
export function ArticleDetail({ group, articleText, tableOrgIds, articleDates, onDeleteArticle }: ArticleDetailProps) {
  const counts = new Map<OverallVerdict, number>();
  for (const r of group.records) {
    const label = verdictCountLabel(r.verification_result);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const overall: OverallVerdict = counts.get("불일치") ? "불일치" : counts.get("일치") ? "일치" : "애매";

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_320px] lg:gap-12">
      <div className="flex flex-col gap-4">
        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-700 dark:bg-stone-900">
          <div className={`h-1.5 w-full ${ACCENT_BAR_CLASS[overall]}`} />
          <div className="p-6">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold tracking-wide uppercase ${EYEBROW_CLASS[overall]}`}
            >
              팩트체크 결과
            </span>
            <h2 className="mt-3 text-2xl font-bold text-stone-950 dark:text-stone-50">
              {group.articleTitle}
            </h2>

            {/* 2026-09-03(5): 아이콘 뱃지(VERDICT_ICON, 20px 원형)와 "원문 보기"(이모지,
                줄 높이만 차지) 콘텐츠 높이가 서로 달라서 py-1.5로만 맞췄을 때도 미세하게
                높이가 안 맞았다 — 패딩 대신 h-7(고정 높이) + items-center로 내용물 크기와
                무관하게 4개 뱃지가 항상 정확히 같은 높이가 되도록 함. */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {group.articleUrl && (
                <a
                  href={group.articleUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-7 items-center gap-1.5 rounded-full bg-stone-100 px-3 text-xs font-medium text-stone-700 hover:bg-stone-200 dark:bg-stone-800/50 dark:text-stone-300"
                >
                  🔗 원문 보기
                </a>
              )}
              {VERDICT_ORDER.filter((label) => counts.has(label)).map((label) => (
                <span
                  key={label}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${VERDICT_COUNT_BOX_CLASS[label]}`}
                >
                  {VERDICT_ICON[label]}
                  {label} {counts.get(label)}건
                </span>
              ))}
            </div>
          </div>
        </div>

        {articleText ? (
          <ArticleTextViewer
            articleText={articleText}
            claims={group.records}
            articleDate={formatDate(articleDisplayDate(group, articleDates))}
            onDelete={() => onDeleteArticle(group.articleTitle)}
          />
        ) : (
          // 원문 텍스트를 못 구한 경우(예: 아직 export 전, 카탈로그 밖 시나리오)의 대체 화면 —
          // 하이라이트 없이 표로라도 결과를 보여준다.
          <ClaimTableFallback group={group} />
        )}
      </div>

      {/* key={group.articleTitle}: 기사를 바꿀 때마다 강제로 새로 마운트시켜서 안쪽의
          등장 애니메이션(패널 페이드인, 게이지 차오르기)이 매번 다시 재생되게 한다. */}
      <InsightsPanel key={group.articleTitle} group={group} tableOrgIds={tableOrgIds} />
    </div>
  );
}

function ClaimTableFallback({ group }: { group: ArticleGroup }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200 shadow-sm dark:border-stone-700">
      <table className="min-w-full divide-y divide-stone-200 text-sm dark:divide-stone-700">
        <thead className="bg-stone-50 dark:bg-stone-800">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-stone-500 dark:text-stone-400">
              수치 주장
            </th>
            <th className="px-3 py-2 text-left font-medium text-stone-500 dark:text-stone-400">
              매칭된 통계표
            </th>
            <th className="px-3 py-2 text-left font-medium text-stone-500 dark:text-stone-400">
              판정
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-200 bg-white dark:divide-stone-700 dark:bg-stone-900">
          {group.records.map((record) => {
            const isExpanded = expandedId === record.result_id;
            const detailText = record.evidence ?? record.ambiguity_reason;

            return (
              <Fragment key={record.result_id}>
                <tr
                  className={detailText ? "cursor-pointer" : ""}
                  onClick={() =>
                    detailText && setExpandedId(isExpanded ? null : record.result_id)
                  }
                >
                  <td className="max-w-md px-3 py-2 text-stone-900 dark:text-stone-100">
                    {record.claim_sentence}
                  </td>
                  <td className="px-3 py-2 text-stone-500 dark:text-stone-400">
                    {record.kosis_table ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <VerdictBadge verdict={record.verification_result} />
                  </td>
                </tr>
                {isExpanded && detailText && (
                  <tr className="bg-stone-50 dark:bg-stone-800">
                    <td colSpan={3} className="px-3 py-3 text-sm text-stone-700 dark:text-stone-300">
                      {detailText}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
