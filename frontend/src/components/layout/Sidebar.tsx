import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArticleGroup } from "../../lib/articles";
import { articleDisplayDate, formatDate } from "../../lib/articles";
import { verdictCountLabel } from "../../lib/verdictColors";

// 2026-09-03: 상단 고정 Header 대신 좌측 고정 사이드바로 레이아웃을 바꾼다(다른 팀
// "팩트렌즈" UI 참고). 사이드바가 브랜드(로고/타이틀)와 "새 통계 검증"/"최근 검증" 내비게이션을
// 전부 들고 있어서, App.tsx의 메인 영역은 이제 랜딩(입력) 화면과 결과 화면만 그리면 된다.
//
// 2026-09-03(10): "전체보기"로 별도 페이지 이동하는 구조를 버리고, 이 사이드바 안에서
// 정렬/검색까지 끝내는 쪽으로 바꿨다(요청 반영) — 페이지 전환 자체가 UX적으로 손해라는
// 판단. 그래서 이제 미리보기 개수 제한(RECENT_PREVIEW_COUNT)도 없고, showHistory 화면
// (App.tsx)과 RecentArticlesList.tsx는 이 변경으로 완전히 안 쓰이게 돼서 같이 지웠다.

// 2026-09-03(13): 원래 일치/불일치/애매 4종을 비율(%) 기준으로 다 뒀었는데, 두 가지
// 문제로 최신순+불일치순 2종으로 줄였다(사용자와 상의 후 결정) —
//   1) 비율 정렬은 표본이 작을수록 왜곡된다: 주장 1건짜리 기사가 그 1건만 불일치여도
//      "불일치율 100%"로 주장 10건 중 9건 불일치(90%)인 기사보다 위로 올라간다.
//   2) "애매순"은 기사 내용에 대한 신호가 아니라 우리 파이프라인 신호다(표매칭/판정이
//      애매했다는 뜻) — 전에 뺀 "통계 기사 확실성"(classifier_score)과 같은 종류의 문제.
// 불일치는 비율이 아니라 건수로 정렬한다 — 팩트체크 도구의 핵심 가치가 "문제 있는 기사
// 찾기"라서, 절대적으로 문제(불일치)가 많은 기사를 위로 올리는 게 더 실용적이라고 판단.
type SortMode = "latest" | "mismatch";

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "latest", label: "최신순" },
  { value: "mismatch", label: "불일치 많은순" },
];

// 행 컨텍스트 메뉴(우클릭/⋮ 버튼 공용) 카드 크기 — 화면 가장자리 클램프 계산에 둘 다 씀.
const MENU_WIDTH = 140;
const MENU_HEIGHT = 44;

// 2026-09-03(2): 목록 항목 왼쪽의 판정색 점 하나 대신, 일치/불일치/애매 건수를 날짜 옆에
// 뱃지로 보여준다 — 점 하나(첫 레코드 판정만 반영)보다 그 기사에 판정이 몇 건씩 섞여있는지
// 한눈에 더 정확히 보여줌.
function verdictCounts(records: ArticleGroup["records"]) {
  let 일치 = 0;
  let 불일치 = 0;
  let 애매 = 0;
  for (const r of records) {
    const label = verdictCountLabel(r.verification_result);
    if (label === "일치") 일치 += 1;
    else if (label === "불일치") 불일치 += 1;
    else 애매 += 1;
  }
  return { 일치, 불일치, 애매 };
}

function mismatchCount(records: ArticleGroup["records"]): number {
  return records.filter((r) => verdictCountLabel(r.verification_result) === "불일치").length;
}

function byDateDesc(a: ArticleGroup, b: ArticleGroup, articleDates: Record<string, string>): number {
  const da = articleDisplayDate(a, articleDates);
  const db = articleDisplayDate(b, articleDates);
  return db > da ? 1 : db < da ? -1 : 0;
}

function sortGroups(groups: ArticleGroup[], articleDates: Record<string, string>, mode: SortMode): ArticleGroup[] {
  if (mode === "latest") {
    return [...groups].sort((a, b) => byDateDesc(a, b, articleDates));
  }
  return [...groups].sort((a, b) => {
    const diff = mismatchCount(b.records) - mismatchCount(a.records);
    // 불일치 건수가 같으면 최신순으로 타이브레이크.
    return diff !== 0 ? diff : byDateDesc(a, b, articleDates);
  });
}

// 기사 제목 또는 표시 날짜(YYYY.MM.DD)에 검색어가 포함되면 통과.
function matchesSearch(group: ArticleGroup, articleDates: Record<string, string>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (group.articleTitle.toLowerCase().includes(q)) return true;
  return formatDate(articleDisplayDate(group, articleDates)).includes(q);
}

// 2026-09-03(14): 검색/정렬 결과를 한 번에 다 렌더링하면 검증 건수가 많아질수록 부담이
// 커진다 — IntersectionObserver로 목록 맨 아래 sentinel이 보일 때마다 PAGE_SIZE씩 더
// 보여주는 무한스크롤(예전 RecentArticlesList.tsx에서 쓰던 것과 같은 패턴, 사이드바로
// 옮기면서 한 번 빠졌다가 다시 추가). 검색어/정렬을 바꾸면 결과 구성 자체가 달라지므로
// visibleCount를 PAGE_SIZE로 리셋한다 — 안 그러면 예를 들어 검색으로 3건만 남았는데
// visibleCount가 60이었던 게 그대로 남아있는 식의 혼란은 없지만(어차피 3건뿐이라
// 문제는 없음), 반대로 검색을 지웠을 때 처음부터 다시 10개만 보여야 자연스럽다.
const PAGE_SIZE = 15;

interface CountBadgeProps {
  label: string;
  count: number;
  colorClass: string;
}

function CountBadge({ label, count, colorClass }: CountBadgeProps) {
  if (count === 0) return null;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${colorClass}`}>
      {label} {count}
    </span>
  );
}

interface SidebarProps {
  groups: ArticleGroup[];
  articleDates: Record<string, string>;
  selectedArticle: string | null;
  // 2026-09-03(4): lg(1024px) 미만에서는 이 사이드바가 항상 떠 있는 대신 좌측에서
  // 슬라이드로 여닫히는 드로어가 된다 — isOpen/onClose는 그 열림 상태를 App.tsx의
  // sidebarOpen state와 연결하는 용도. lg 이상에서는 CSS(lg:translate-x-0)가 이 값과
  // 무관하게 항상 펼쳐두므로 두 prop 다 영향이 없다.
  isOpen: boolean;
  onNewVerification: () => void;
  onSelectArticle: (articleTitle: string) => void;
  onDeleteArticle: (articleTitle: string) => void;
  onClose: () => void;
}

export function Sidebar({
  groups,
  articleDates,
  selectedArticle,
  isOpen,
  onNewVerification,
  onSelectArticle,
  onDeleteArticle,
  onClose,
}: SidebarProps) {
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filteredSorted = useMemo(() => {
    const filtered = groups.filter((g) => matchesSearch(g, articleDates, searchQuery));
    return sortGroups(filtered, articleDates, sortMode);
  }, [groups, articleDates, searchQuery, sortMode]);

  const visible = filteredSorted.slice(0, visibleCount);
  const remaining = filteredSorted.length - visible.length;

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setVisibleCount(PAGE_SIZE);
  };

  const handleSortChange = (mode: SortMode) => {
    setSortMode(mode);
    setVisibleCount(PAGE_SIZE);
  };

  // 2026-09-03(19): 네이티브 <select>는 옵션 목록 자체가 OS 스타일이라(브라우저마다
  // 다르고, 색·둥근모서리 등 커스텀 불가) 앱 전체 톤과 겉돌았다 — 버튼 + 직접 그린
  // 옵션 패널로 바꿔서, 선택된 항목 강조색까지 다른 곳(뱃지/포인트 컬러)과 통일했다.
  const [sortOpen, setSortOpen] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sortOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSortOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [sortOpen]);

  // 2026-09-03(29): 목록 삭제 관리 — 행마다 삭제 버튼을 상시 노출하는 대신, 요청대로
  // 우클릭(컨텍스트 메뉴)으로 정렬 드롭다운과 같은 카드 스타일의 미니 메뉴를 띄운다.
  // position:fixed로 렌더링해서 목록의 overflow-y-auto에 안 잘리게 하고(위 tooltip과
  // 동일한 이유), 커서 좌표(clientX/clientY)에 그대로 띄운 뒤 화면 아래쪽에 붙어야 하면
  // top을 살짝 당겨 클램프한다.
  const [contextMenu, setContextMenu] = useState<{ articleTitle: string; top: number; left: number } | null>(
    null,
  );
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  const handleRowContextMenu = (e: React.MouseEvent, articleTitle: string) => {
    e.preventDefault();
    setContextMenu({
      articleTitle,
      top: Math.min(e.clientY, window.innerHeight - MENU_HEIGHT - 8),
      left: Math.min(e.clientX, window.innerWidth - MENU_WIDTH - 8),
    });
  };

  // 터치 기기는 우클릭 자체가 없어 컨텍스트 메뉴에 접근할 방법이 없다 — 항상 탭 가능한
  // "⋮" 버튼에서도 같은 메뉴를 띄운다(좌표만 커서 대신 버튼 위치 기준으로 계산).
  // stopPropagation: 이 버튼이 행 안에 있어서 클릭이 부모로 버블링되면 안 됨(부모엔 없지만,
  // 나중에 행 자체에 클릭 핸들러가 붙을 가능성을 열어두기 위해 안전하게 막아둔다).
  const handleMenuButtonClick = (e: React.MouseEvent, articleTitle: string) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({
      articleTitle,
      top: Math.min(rect.bottom + 4, window.innerHeight - MENU_HEIGHT - 8),
      left: Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
    });
  };

  useEffect(() => {
    if (!contextMenu) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleDismiss = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleDismiss();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleDismiss, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleDismiss, true);
    };
  }, [contextMenu]);

  // 콜백 ref로 구현 — sentinel div는 remaining>0일 때만 렌더링되므로(더 볼 게 없으면
  // 사라짐), 마운트/언마운트 시점에 자동으로 관찰을 시작/해제할 수 있어 useEffect 없이도
  // 정확하다.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!node) return;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => c + PAGE_SIZE);
        }
      },
      { rootMargin: "200px" },
    );
    observerRef.current.observe(node);
  }, []);

  // 2026-09-03(16): 브라우저 기본 title 툴팁 대신 커스텀 툴팁 — 요청 반영 3가지:
  //   1) 트리거 영역을 제목 텍스트뿐 아니라 행 전체(버튼)로 넓힘 — 작은 제목 글자에만
  //      정확히 올려야 하는 게 불편하다는 피드백.
  //   2) 지연 시간을 브라우저 기본(보통 ~800ms~1s)의 절반 수준인 400ms로 줄임.
  //   3) 스타일을 직접 꾸밈(어두운 배경 pill + 그림자).
  // position:fixed로 렌더링해서 목록의 overflow-y-auto(가로도 같이 클리핑됨)에
  // 안 잘리게 하고, getBoundingClientRect로 좌표를 잡아 목록이 스크롤돼 있어도 정확한
  // 위치에 뜬다. 첫 몇 줄처럼 위쪽 여백이 부족하면 자동으로 아래쪽에 띄운다.
  const [tooltip, setTooltip] = useState<{ title: string; top: number; left: number; placement: "top" | "bottom" } | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  const handleRowEnter = (e: React.MouseEvent<HTMLButtonElement>, title: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      const placement = rect.top > 70 ? "top" : "bottom";
      setTooltip({
        title,
        left: rect.left,
        top: placement === "top" ? rect.top - 8 : rect.bottom + 8,
        placement,
      });
    }, 400);
  };

  const handleRowLeave = () => {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    setTooltip(null);
  };

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex h-full w-96 max-w-[85vw] shrink-0 flex-col border-r border-stone-200 bg-white transition-transform duration-200 ease-out lg:static lg:z-auto lg:translate-x-0 dark:border-stone-800 dark:bg-stone-950 ${
        isOpen ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <div className="flex items-center justify-between pr-3">
        {/* 2026-09-03(25): 로고 클릭도 홈 이동, 아래 "기사 검증하기" 버튼도 홈 이동 —
            같은 동작을 하는 진입점이 두 개일 필요 없다는 요청으로 로고는 그냥
            브랜드 표시로만 두고(비클릭) 이동 기능은 뺐다. */}
        <div className="flex items-center gap-3 px-6 py-6">
          <span
            aria-hidden
            className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-match-600 shadow-sm"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none">
              <path
                d="M5 12.5l4.5 4.5L19 7"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-stone-900 dark:text-stone-50">
              AI 뉴스 사실 검증
            </h1>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-match-600 dark:text-match-400">
              KOSIS Fact Check
            </p>
          </div>
        </div>
        {/* lg 이상에서는 드로어가 아니라 항상 펼쳐진 고정 사이드바라 닫기 버튼이 의미 없음 */}
        <button
          type="button"
          onClick={onClose}
          aria-label="메뉴 닫기"
          className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-stone-400 transition hover:bg-stone-100 hover:text-stone-600 lg:hidden dark:hover:bg-stone-900"
        >
          ✕
        </button>
      </div>

      {/* 2026-09-03(13): "기사 검증하기" 버튼을 로고 바로 아래에서 목록 맨 아래로 옮겼다
          (요청 반영) — 로고 → 버튼 → 라벨/정렬 → 검색으로 이어지는 상단이 너무 빽빽하고
          산만해 보인다는 피드백. 목록(검색/정렬 포함)이 먼저 나오고, 항상 필요한 주
          액션(새 검증)은 화면 하단에 고정된 형태로 마무리되는 게 더 자연스럽다. */}
      <div className="mt-2 flex min-h-0 flex-1 flex-col px-4 pb-4">
        <div className="flex items-center justify-between px-2 pb-3">
          {/* 2026-09-03(12): "최근 검증"은 이제 최근 것만 보여주는 게 아니라(정렬/검색
              가능한 전체 목록) 이름이 안 맞아서 "검증 리스트"로 바꿈.
              2026-09-03(18): 괄호 숫자("(15)")가 성의 없어 보인다는 피드백 — 작은
              카운트 배지(pill)로 바꿈. */}
          <span className="flex items-center gap-1.5 text-xs font-semibold text-stone-400 dark:text-stone-500">
            검증 리스트
            {groups.length > 0 && (
              <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-stone-100 px-1.5 py-0.5 text-[12px] font-bold text-match-700 dark:bg-match-900/40 dark:text-match-300">
                {groups.length}
              </span>
            )}
          </span>
          {/* 2026-09-03(11/12): 정렬 드롭다운을 별도 줄 대신 라벨 오른쪽에 작게 붙였다
              (요청 반영) — 일치/불일치/애매는 건수가 아니라 비율 기준(verdictRatio 참고),
              동률이면 최신순으로 타이브레이크한다.
              2026-09-03(19): 네이티브 select를 커스텀 드롭다운으로 교체(요청 반영). 옵션
              패널은 앱 전체에서 쓰는 카드 스타일(둥근 모서리+그림자)로 그렸다.
              2026-09-03(19-2): 기본(닫힌) 상태 버튼이 너무 밋밋하다는 피드백 — 사각
              미니박스 대신, ArticleDetail의 "🔗 원문 보기" 뱃지와 같은 rounded-full
              필(h-7) 톤으로 맞추고 정렬 아이콘을 추가해서 존재감을 줬다. */}
          <div className="relative" ref={sortDropdownRef}>
            <button
              type="button"
              onClick={() => setSortOpen((v) => !v)}
              className="flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-600 shadow-sm transition hover:border-match-300 hover:text-match-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-match-700 dark:hover:text-match-300"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none">
                <path
                  d="M6 5v14M6 5l-3 3M6 5l3 3M18 19V5M18 19l-3-3M18 19l3-3"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {SORT_OPTIONS.find((opt) => opt.value === sortMode)?.label}
              <svg
                viewBox="0 0 24 24"
                className={`h-3 w-3 text-stone-400 transition-transform duration-150 ${sortOpen ? "rotate-180" : ""}`}
                fill="none"
              >
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {sortOpen && (
              <div className="absolute top-full right-0 z-20 mt-1.5 w-40 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900">
                {SORT_OPTIONS.map((opt) => {
                  const isSelected = opt.value === sortMode;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        handleSortChange(opt.value);
                        setSortOpen(false);
                      }}
                      className={`flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-xs font-medium transition ${
                        isSelected
                          ? "bg-match-50 text-match-700 dark:bg-match-900/30 dark:text-match-300"
                          : "text-stone-600 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-800"
                      }`}
                    >
                      {opt.label}
                      {isSelected && (
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none">
                          <path
                            d="M5 12.5l4.5 4.5L19 7"
                            stroke="currentColor"
                            strokeWidth={2.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 기사 제목 또는 날짜(2025.07 같은 부분 문자열도 매칭)로 검색 */}
        <div className="relative mb-2">
          <svg
            viewBox="0 0 24 24"
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-stone-400"
            fill="none"
          >
            <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth={2} />
            <path d="M19 19l-4-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="제목 또는 날짜로 검색"
            className="w-full rounded-lg border border-stone-200 bg-white py-2 pr-3 pl-9 text-sm text-stone-700 outline-none placeholder:text-stone-400 focus:border-match-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
          />
        </div>

        {/* 2026-09-03(13): flex-1 min-h-0 wrapper — 목록이 짧든 비어있든 이 영역이 항상
            남는 세로 공간을 다 차지해야, 그 아래 "기사 검증하기" 버튼이 목록 바로 뒤가
            아니라 사이드바 맨 아래에 자연스럽게 붙는다. */}
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
          {groups.length === 0 ? (
            <p className="px-2 py-3 text-xs text-stone-400 dark:text-stone-500">
              완료된 검증이 여기에 표시됩니다.
            </p>
          ) : visible.length === 0 ? (
            <p className="px-2 py-3 text-xs text-stone-400 dark:text-stone-500">
              "{searchQuery}"에 맞는 기사가 없습니다.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {visible.map((group) => {
                const { 일치, 불일치, 애매 } = verdictCounts(group.records);
                return (
                  <li key={group.articleTitle}>
                    {/* 2026-09-03(31): 삭제가 우클릭 메뉴 하나뿐이면 터치 기기(모바일/태블릿)
                        에서는 접근할 방법이 없다(우클릭 자체가 없음) — 요청 반영으로 항상
                        탭 가능한 "⋮" 버튼을 같은 행에 둔다. 버튼 두 개를 한 행에 두려면
                        <button> 중첩이 안 되니(무효한 HTML) 행 자체는 <div>로 바꾸고, 제목
                        영역만 별도 <button>으로 분리했다. */}
                    <div
                      className={`group/row flex w-full items-center gap-0.5 rounded-lg pr-1.5 transition hover:bg-stone-100 dark:hover:bg-stone-900 ${
                        selectedArticle === group.articleTitle ? "bg-stone-100 dark:bg-stone-900" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectArticle(group.articleTitle)}
                        onContextMenu={(e) => handleRowContextMenu(e, group.articleTitle)}
                        onMouseEnter={(e) => handleRowEnter(e, group.articleTitle)}
                        onMouseLeave={handleRowLeave}
                        className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 py-2.5 pl-3 text-left"
                      >
                        <span className="block truncate text-base text-stone-700 dark:text-stone-200">
                          {group.articleTitle}
                        </span>
                        <span className="flex items-center gap-1.5 text-xs text-stone-400">
                          {formatDate(articleDisplayDate(group, articleDates))}
                          <CountBadge label="일치" count={일치} colorClass="bg-match-100 text-sm text-match-800 dark:bg-match-900/40 dark:text-match-300" />
                          <CountBadge label="불일치" count={불일치} colorClass="bg-mismatch-100 text-sm text-mismatch-800 dark:bg-mismatch-900/40 dark:text-mismatch-300" />
                          <CountBadge label="애매" count={애매} colorClass="bg-caution-100 text-sm text-caution-800 dark:bg-caution-900/40 dark:text-caution-300" />
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleMenuButtonClick(e, group.articleTitle)}
                        aria-label="메뉴 더보기"
                        className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full text-stone-300 transition hover:bg-stone-200 hover:text-stone-600 dark:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                          <circle cx="12" cy="5" r="1.4" />
                          <circle cx="12" cy="12" r="1.4" />
                          <circle cx="12" cy="19" r="1.4" />
                        </svg>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {remaining > 0 && (
            <div ref={sentinelRef} className="flex justify-center py-3">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-transparent dark:border-stone-600" />
            </div>
          )}
        </div>

        <div className="mt-3 border-t border-stone-100 pt-3 dark:border-stone-800">
          {/* 2026-09-03(7/13): 라벨을 "새 통계 검증"→"기사 검증하기"로 바꾸고(실제로
              입력받는 건 통계가 아니라 기사 URL), 위치도 로고 아래에서 목록 맨 아래로
              옮겼다(요청 반영). */}
          <button
            type="button"
            onClick={onNewVerification}
            // 2026-09-03(19): hover:bg-stone-800는 원래 배경(stone-900)과 색이 너무
            // 비슷해서(둘 다 거의 검정) 눈에 안 띈다는 피드백 — 브랜드 그린으로 바꿔서
            // 확실히 티 나게 하고, 겸사겸사 사이드바 전체의 그린 포인트 컬러와도 연결됨.
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-stone-900 px-4 py-3 text-base font-semibold text-white transition hover:bg-match-600 dark:bg-white dark:text-stone-900 dark:hover:bg-match-100"
          >
            기사 검증하기
          </button>
        </div>
      </div>

      {tooltip && (
        <div
          className="pointer-events-none fixed z-50 max-w-xs rounded-lg bg-stone-900 px-3 py-2 text-sm leading-snug text-white shadow-lg dark:bg-stone-100 dark:text-stone-900"
          style={{
            top: tooltip.top,
            left: tooltip.left,
            transform: tooltip.placement === "top" ? "translateY(-100%)" : undefined,
          }}
        >
          {tooltip.title}
        </div>
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 w-[140px] overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900"
          style={{ top: contextMenu.top, left: contextMenu.left }}
        >
          <button
            type="button"
            onClick={() => {
              onDeleteArticle(contextMenu.articleTitle);
              setContextMenu(null);
            }}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs font-medium text-mismatch-600 transition hover:bg-mismatch-50 dark:text-mismatch-400 dark:hover:bg-mismatch-900/30"
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
        </div>
      )}
    </aside>
  );
}
