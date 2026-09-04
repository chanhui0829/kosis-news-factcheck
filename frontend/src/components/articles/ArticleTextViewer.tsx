import { useEffect, useMemo, useRef, useState } from "react";
import type { VerificationRecord } from "../../types/verification";
import { buildArticleSegments, groupSegmentsByParagraph } from "../../lib/segments";
import { cleanArticleTextForDisplay } from "../../lib/cleanArticleText";
import {
  VERDICT_HIGHLIGHT_CLASS,
  VERDICT_MARKER_CLASS,
  VERDICT_POPOVER_ACCENT_CLASS,
  verdictLabel,
} from "../../lib/verdictColors";
import { VerdictBadge } from "../claims/VerdictBadge";

interface ArticleTextViewerProps {
  articleText: string;
  claims: VerificationRecord[];
  articleDate?: string;
  onDelete?: () => void;
}

interface HighlightedClaimProps {
  content: string;
  record: VerificationRecord;
  number: number | undefined;
  isActive: boolean;
  onClick: (el: HTMLElement) => void;
}

// 하이라이트 텍스트와 번호 배지를 한 세트로 보이게 렌더링한다. 번호를 인라인 텍스트로
// 넣으면(예전 <sup>) 하이라이트와 분리된 별개 요소처럼 보였어서, 배지를 절대 위치로
// 하이라이트 바로 위에 띄우고 같은 판정 색을 써서 시각적으로 한 덩어리로 묶었다.
function HighlightedClaim({ content, record, number, isActive, onClick }: HighlightedClaimProps) {
  const label = verdictLabel(record.verification_result);
  return (
    <span className="relative">
      <span
        aria-hidden="true"
        className={`absolute -top-3 -left-1.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] leading-none font-bold shadow-sm ${VERDICT_MARKER_CLASS[label]}`}
      >
        {number}
      </span>
      <span
        onClick={(e) => onClick(e.currentTarget)}
        // data-claim-highlight: 바깥 클릭 감지 핸들러(ArticleTextViewer의 document
        // mousedown 리스너)가 "하이라이트 자신을 다시 클릭한 경우"를 "바깥 클릭"으로
        // 오인해 먼저 닫아버리지 않게 표시해두는 마커 — 토글(같은 문장 다시 클릭 시 닫힘)은
        // 이 span의 onClick(handleClaimClick)이 전담한다.
        data-claim-highlight="true"
        // 2026-09-03(18): 근거 카드를 본문 안에 밀어넣는 인라인 블록 대신, 클릭한 자리에
        // 말풍선 팝오버로 띄우는 방식으로 교체(요청 반영) — 읽는 흐름이 안 끊기고, 지금 어떤
        // 주장을 보고 있는지도 ring으로 표시해 팝오버가 본문 어디를 가리키는지 명확히 한다.
        className={`cursor-pointer rounded px-0.5 ${VERDICT_HIGHLIGHT_CLASS[label]} ${
          isActive ? "ring-2 ring-offset-1 ring-stone-400 dark:ring-stone-500" : ""
        }`}
      >
        {content}
      </span>
    </span>
  );
}

interface PopoverState {
  record: VerificationRecord;
  top: number;
  left: number;
  arrowLeft: number;
  placement: "top" | "bottom";
}

const POPOVER_WIDTH = 460;
const VIEWPORT_MARGIN = 16;

// 클릭된 하이라이트의 getBoundingClientRect를 받아 팝오버 좌표를 계산한다. 화면 위쪽
// 공간이 부족하면 아래쪽에 띄우고, 좌우로는 뷰포트를 벗어나지 않게 클램프한다 — 클램프로
// 카드 중심이 앵커에서 벗어날 수 있어서, 화살표(arrowLeft)는 카드 기준이 아니라 원래
// 앵커 위치를 그대로 가리키도록 따로 계산해둔다.
function computePopoverPosition(anchor: DOMRect, record: VerificationRecord): PopoverState {
  const placement: PopoverState["placement"] = anchor.top > 200 ? "top" : "bottom";
  const anchorCenter = anchor.left + anchor.width / 2;
  const rawLeft = anchorCenter - POPOVER_WIDTH / 2;
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(rawLeft, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN),
  );
  const arrowLeft = Math.max(20, Math.min(anchorCenter - left, POPOVER_WIDTH - 20));
  return {
    record,
    top: placement === "top" ? anchor.top - 10 : anchor.bottom + 10,
    left,
    arrowLeft,
    placement,
  };
}

// 2026-09-03(15): "원문에서 정확한 위치를 못 찾은 주장" 박스를 완전히 뺐다(요청 반영,
// 두 번째 요청) — lib/segments.ts의 매칭 개선(공백/따옴표/말줄임표 표기 차이 허용)으로
// notFound가 이제 정말 드물어졌고, 남는 극소수 케이스까지 화면에 "문제 있음" 박스로
// 노출하기보다는 그냥 원문 하이라이트에서만 빠지는 쪽을 택했다. 대신 완전히 흔적 없이
// 사라지면 나중에 회귀를 못 알아차리니, 개발자 콘솔에만 경고를 남긴다(사용자에게는
// 안 보임, F12로 열어야 보임).
function warnUnmatchedClaims(notFound: VerificationRecord[], overlapSkipped: VerificationRecord[]): void {
  if (notFound.length > 0) {
    console.warn(
      `[ArticleTextViewer] 원문에서 위치를 못 찾은 주장 ${notFound.length}건:`,
      notFound.map((r) => r.claim_sentence),
    );
  }
  if (overlapSkipped.length > 0) {
    console.warn(
      `[ArticleTextViewer] 다른 주장과 겹쳐 인라인에 못 그린 주장 ${overlapSkipped.length}건:`,
      overlapSkipped.map((r) => r.claim_sentence),
    );
  }
}

// 기사 원문 전체를 그대로 보여주고, 그 안에서 실제로 검증한 수치 주장 부분만 판정 색으로
// 밑줄/하이라이트한다. 클릭하면 그 하이라이트 옆에 판정 근거 말풍선(팝오버)이 뜬다.
// 이렇게 원문 전체를 보여주는 이유: 2단계(claim_extractor)가 기사 속 수치 주장을 빠짐없이
// 다 뽑았는지 사람이 눈으로 바로 확인할 수 있게 하기 위함 — 하이라이트 안 된 수치가 원문에
// 남아있으면 그게 곧 추출 누락(recall) 사례다.
export function ArticleTextViewer({ articleText, claims, articleDate, onDelete }: ArticleTextViewerProps) {
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  // 클릭 시점의 좌표(DOMRect)만 저장하면 스크롤 후엔 낡은 값이 된다 — 앵커 엘리먼트 자체를
  // 들고 있다가 스크롤/리사이즈 때마다 getBoundingClientRect()를 다시 불러 위치를 따라가게 한다.
  const anchorElRef = useRef<HTMLElement | null>(null);
  const cleanedText = useMemo(() => cleanArticleTextForDisplay(articleText), [articleText]);
  // claimNumbers: 원문에 실제로 등장하는 순서(위→아래)대로 매긴 번호 — buildArticleSegments가
  // 이미 위치순으로 정렬해둔 걸 그대로 재사용한다(원문 하이라이트, 매칭 안 된 목록 둘 다 같은
  // 번호 체계를 공유).
  const { segments, notFound, overlapSkipped, claimNumbers } = useMemo(
    () => buildArticleSegments(cleanedText, claims),
    [cleanedText, claims],
  );
  const paragraphs = useMemo(() => groupSegmentsByParagraph(segments), [segments]);
  useEffect(() => warnUnmatchedClaims(notFound, overlapSkipped), [notFound, overlapSkipped]);

  const handleClaimClick = (record: VerificationRecord, el: HTMLElement) => {
    setPopover((prev) => {
      if (prev?.record.result_id === record.result_id) {
        anchorElRef.current = null;
        return null;
      }
      anchorElRef.current = el;
      return computePopoverPosition(el.getBoundingClientRect(), record);
    });
  };

  // 2026-09-03(23): 스크롤하면 팝오버가 그냥 닫혀버리던 걸 요청으로 바꿨다 — 이제 닫힘은
  // (1) 바깥 클릭 (2) Esc (3) 같은 문장 다시 클릭(토글) (4) 다른 문장 클릭(전환) 네
  // 경우로만 일어나고, 스크롤/리사이즈에는 앵커 엘리먼트의 최신 좌표를 다시 재서 팝오버가
  // 그 문장을 계속 따라가게 한다(닫지 않음). 스크롤 이벤트는 매우 잦게 발생하므로
  // requestAnimationFrame으로 한 프레임에 한 번만 재계산하도록 스로틀링한다.
  useEffect(() => {
    if (!popover) return;

    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (popoverRef.current?.contains(target)) return;
      if (target.closest("[data-claim-highlight]")) return;
      anchorElRef.current = null;
      setPopover(null);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        anchorElRef.current = null;
        setPopover(null);
      }
    };

    let rafId: number | null = null;
    const handleReposition = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const anchorEl = anchorElRef.current;
        if (!anchorEl) return;
        setPopover((prev) => (prev ? computePopoverPosition(anchorEl.getBoundingClientRect(), prev.record) : prev));
      });
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("resize", handleReposition);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleReposition);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [popover]);

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition-shadow duration-200 hover:shadow-md dark:border-stone-700 dark:bg-stone-900">
        <div className="flex items-center gap-2 border-b border-stone-100 px-6 py-4 dark:border-stone-800">
          <span className="h-2 w-2 rounded-full bg-match-600" />
          <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">기사 원문</span>
          {articleDate && (
            <>
              <span className="text-stone-300 dark:text-stone-600">·</span>
              <span className="text-sm text-stone-400 dark:text-stone-500">{articleDate}</span>
            </>
          )}
          {/* 2026-09-03(30): 검증 리스트 우클릭 삭제는 발견하기 어렵다는 피드백 — 실제로
              그 기사를 보고 있는 상세 화면에도 눈에 보이는 삭제 버튼을 둔다. */}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="ml-auto flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-stone-400 transition hover:bg-mismatch-50 hover:text-mismatch-600 dark:text-stone-500 dark:hover:bg-mismatch-900/30 dark:hover:text-mismatch-400"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none">
                <path
                  d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0-.8 12.1a1 1 0 01-1 .9H8.8a1 1 0 01-1-.9L7 7"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              삭제하기
            </button>
          )}
        </div>
        <div className="p-6 text-lg text-stone-900 dark:text-stone-100">
          {paragraphs.map((paragraphSegments, pIndex) => (
            <p key={pIndex} className="mb-5 leading-loose last:mb-0">
              {paragraphSegments.map((segment, i) => {
                if (segment.type === "text") {
                  return <span key={i}>{segment.content}</span>;
                }

                const { record } = segment;
                return (
                  <HighlightedClaim
                    key={record.result_id}
                    content={segment.content}
                    record={record}
                    number={claimNumbers.get(record.result_id)}
                    isActive={popover?.record.result_id === record.result_id}
                    onClick={(el) => handleClaimClick(record, el)}
                  />
                );
              })}
            </p>
          ))}
        </div>
      </div>

      {popover && (
        // overflow-hidden을 카드 안쪽 래퍼에만 걸어둔다 — 바깥 div까지 걸면 꼬리(화살표,
        // 카드 경계 바깥으로 6px 튀어나오게 배치됨)까지 같이 잘려나간다.
        <div
          ref={popoverRef}
          className="fixed z-50 w-[460px] max-w-[calc(100vw-2rem)]"
          style={{
            top: popover.top,
            left: popover.left,
            transform: popover.placement === "top" ? "translateY(-100%)" : undefined,
          }}
        >
          {/* 말풍선 꼬리 — 카드와 같은 배경/테두리색 정사각형을 45도 회전시켜서 만든다.
              카드가 화면 가장자리에서 클램프돼도, 꼬리는 항상 실제 앵커(클릭한 하이라이트)
              위치를 그대로 가리키도록 arrowLeft를 따로 계산해서 쓴다. */}
          <div
            aria-hidden="true"
            className="absolute h-3 w-3 rotate-45 border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900"
            style={
              popover.placement === "top"
                ? { left: popover.arrowLeft - 6, bottom: -6, borderRight: "1px solid", borderBottom: "1px solid" }
                : { left: popover.arrowLeft - 6, top: -6, borderLeft: "1px solid", borderTop: "1px solid" }
            }
          />
          <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xl dark:border-stone-700 dark:bg-stone-900">
            <div className={`h-1 w-full ${VERDICT_POPOVER_ACCENT_CLASS[verdictLabel(popover.record.verification_result)]}`} />
            <div className="p-4">
              <VerdictBadge verdict={popover.record.verification_result} />
              <p className="mt-2.5 text-base leading-relaxed text-stone-800 dark:text-stone-200">
                {popover.record.evidence ?? popover.record.ambiguity_reason ?? "판정 근거가 기록되지 않았습니다."}
              </p>
              {popover.record.kosis_table && (
                <p className="mt-3 border-t border-stone-200 pt-2.5 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
                  KOSIS 참조: {popover.record.kosis_table}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
