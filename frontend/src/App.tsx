import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { ArticleDetail } from "./components/articles/ArticleDetail";
import { VerifyArticleForm } from "./components/verify/VerifyArticleForm";
import { useVerifyJobs } from "./lib/useVerifyJobs";
import { MOCK_VERIFICATIONS } from "./data/mockVerifications";
import { MOCK_ARTICLE_TEXTS } from "./data/mockArticleTexts";
import { MOCK_ARTICLE_DATES } from "./data/mockArticleDates";
import { groupByArticle } from "./lib/articles";
import type { VerificationRecord } from "./types/verification";

// 2026-08-26(5): 프론트 구조 개편 — 예전엔 이미 검증된 기사들을 목록/통계로 브라우징하는
// 화면이 메인이었는데, 이제는 "기사 URL을 입력하면 그 기사 결과를 보여주는" 단일 조회
// 도구로 바꾼다(사용자 요청). SummaryCard/ArticleListPanel/ArticleSearchBar와 그걸 위한
// 날짜 필터·검토필요 필터·검색 상태는 전부 삭제 — 더 이상 쓰이지 않는다.
const EXPORT_JSON_PATH = "/data/verifications.json";
const ARTICLES_JSON_PATH = "/data/articles.json";
const ARTICLE_DATES_JSON_PATH = "/data/articleDates.json";
const TABLE_ORG_IDS_JSON_PATH = "/data/tableOrgIds.json";

// 2026-08-21: 실시간 검증이 끝난 직후에는 로컬 정적 파일이 아니라 agent/api/server.py
// (AWS 서버)가 방금 갱신한 JSON을 직접 읽어야 한다 — 로컬 프론트와 AWS 서버는 서로 다른
// 컴퓨터라 서버가 자기 디스크에 쓴 파일이 로컬로 자동으로 오지 않기 때문(server.py가
// /data를 정적 서빙하도록 추가해둠).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function fetchJson<T>(path: string): Promise<T | null> {
  // Vite dev 서버는 없는 경로도 SPA 폴백으로 index.html(200 text/html)을 돌려주기 때문에
  // res.ok만으로는 "파일이 진짜 있는지" 못 가려서 content-type도 함께 확인한다.
  try {
    const res = await fetch(path);
    if (!res.ok || !res.headers.get("content-type")?.includes("json")) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function App() {
  const [records, setRecords] = useState<VerificationRecord[]>(MOCK_VERIFICATIONS);
  const [articleTexts, setArticleTexts] = useState<Record<string, string>>(MOCK_ARTICLE_TEXTS);
  const [articleDates, setArticleDates] = useState<Record<string, string>>(MOCK_ARTICLE_DATES);
  const [tableOrgIds, setTableOrgIds] = useState<Record<string, string>>({});
  const [selectedArticle, setSelectedArticle] = useState<string | null>(null);
  // 실행 취소 가능한 삭제 대기 중인 기사 제목 — 아래 handleDeleteArticle/handleUndoDelete 참고.
  const [pendingDeleteTitle, setPendingDeleteTitle] = useState<string | null>(null);
  // 2026-09-03(4): 반응형 대응 — lg(1024px) 미만에서는 사이드바를 상단 햄버거로 여닫는
  // 오버레이 드로어로 바꾼다(Sidebar.tsx의 isOpen prop이 이 값을 그대로 씀). lg 이상에서는
  // CSS로 항상 펼쳐두므로 이 상태 자체가 영향을 안 준다.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // db/export_json.py가 만든 실데이터가 frontend/public/data/에 있으면 그걸 쓰고, 아직
  // export 전이거나 배치를 한 번도 안 돌린 상태라면 MOCK_*로 남아있는다 — 빈 화면 대신
  // 항상 뭔가는 보이게 하기 위함. 검증이 끝난 뒤에도 같은 로직으로 다시 불러와야 해서
  // 함수로 뽑았다(마운트 시 1회 + 검증 완료 시 재호출).
  //
  // fetch 시 매번 새 URL(캐시 버스팅 쿼리)을 붙인다 — 브라우저가 이전 GET 응답을 캐싱해서
  // 검증 완료 후 재조회해도 갱신 전 데이터가 그대로 보이는 문제를 막기 위함.
  //
  // baseUrl: 마운트 시 최초 로드는 로컬 정적 파일(""), 실시간 검증 완료 후 재호출은
  // API 서버(AWS)를 baseUrl로 넘겨서 방금 그 서버가 갱신한 최신 데이터를 직접 받는다.
  const loadData = useCallback((baseUrl = "") => {
    const bust = `?t=${Date.now()}`;
    return Promise.all([
      fetchJson<VerificationRecord[]>(baseUrl + EXPORT_JSON_PATH + bust),
      fetchJson<Record<string, string>>(baseUrl + ARTICLES_JSON_PATH + bust),
      fetchJson<Record<string, string>>(baseUrl + ARTICLE_DATES_JSON_PATH + bust),
      fetchJson<Record<string, string>>(baseUrl + TABLE_ORG_IDS_JSON_PATH + bust),
    ]).then(([verifications, articles, dates, orgIds]) => {
      if (!verifications || verifications.length === 0) return;
      setRecords(verifications);
      setArticleTexts(articles ?? {});
      setArticleDates(dates ?? {});
      setTableOrgIds(orgIds ?? {});
    });
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 목록↔상세 대신 이제 "입력 화면↔결과 화면" 전환을 브라우저 히스토리(History API)와
  // 연동한다. 기사 결과로 이동할 때 pushState로 히스토리 항목을 쌓고, popstate(뒤로/
  // 앞으로가기)가 발생하면 URL의 article 쿼리를 읽어 그 상태로 복원한다. 새로고침/북마크로
  // 결과 화면에 바로 들어오는 것도 덤으로 된다(검증 링크를 남한테 공유하기도 쉬움).
  useEffect(() => {
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      setSelectedArticle(params.get("article"));
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  // pendingDeleteTitle이 있는 기사는 아직 records에는 남아있지만(실행 취소 대비) 목록/
  // 상세 화면에서는 이미 지워진 것처럼 즉시 숨긴다 — "삭제됨" 토스트가 뜬 순간 눈에 보이는
  // 피드백을 주기 위함.
  const visibleRecords = useMemo(
    () => (pendingDeleteTitle ? records.filter((r) => r.article_title !== pendingDeleteTitle) : records),
    [records, pendingDeleteTitle],
  );
  const allArticleGroups = useMemo(() => groupByArticle(visibleRecords), [visibleRecords]);
  const selectedGroup = allArticleGroups.find((g) => g.articleTitle === selectedArticle);

  const handleSelectArticle = useCallback((articleTitle: string) => {
    const url = `?article=${encodeURIComponent(articleTitle)}`;
    window.history.pushState({ articleTitle }, "", url);
    setSelectedArticle(articleTitle);
  }, []);

  // URL 검증이 끝난 뒤 그 기사 결과로 이동 — 먼저 서버가 방금 갱신한 최신 데이터를
  // 다시 불러온 다음(그래야 방금 끝난 기사가 records 안에 들어있음), 그 기사로 이동한다.
  // 순서를 반대로 하면(이동 먼저) selectedGroup을 못 찾아서 빈 화면이 뜬다.
  const handleArticleVerified = useCallback(
    (articleTitle: string) => {
      loadData(API_BASE_URL).then(() => handleSelectArticle(articleTitle));
    },
    [loadData, handleSelectArticle],
  );

  // 2026-08-26(5): useVerifyJobs를 App 최상위에서 한 번만 들고 있는다 — 메인 화면(인라인
  // 입력 폼)과 결과 화면("다른 기사 검증하기" 모달)이 같은 job 상태를 공유해야, 예를 들어
  // 메인 화면에서 URL 3개를 한꺼번에 넣고 그중 하나 결과를 먼저 보러 이동해도 나머지
  // 2개가 백그라운드에서 계속 진행되다가, 다시 메인으로 돌아오거나 모달을 열었을 때
  // 그 진행 상황이 그대로 보인다.
  const verifyJobs = useVerifyJobs({
    onJobDone: (articleTitle, isSingle) => {
      if (isSingle && articleTitle) handleArticleVerified(articleTitle);
    },
  });

  // 2026-09-03(4): 상세 화면 안에 있던 "← 처음으로" 버튼을 지웠다 — 사이드바가 항상 떠
  // 있어서 "기사 검증하기"/로고로 언제든 홈에 갈 수 있는데, 화면 안에 또 있는 건 중복
  // 내비게이션이었다. (이 버튼들만 쓰던 handleBack()도 같이 제거 — 브라우저 자체 뒤로가기는
  // 위 popstate 리스너가 별도로 계속 처리한다.)
  //
  // 2026-09-03(10): "전체보기" 전용 화면(showHistory/openHistory, RecentArticlesList)도
  // 이제 없다 — 사이드바 자체가 정렬/검색까지 갖춘 전체 목록이 돼서 별도 페이지로 이동할
  // 이유가 없어졌다(요청 반영: 페이지 전환은 UX상 손해).
  const goHome = () => {
    if (selectedArticle) window.history.pushState({}, "", window.location.pathname);
    setSelectedArticle(null);
    setSidebarOpen(false);
  };

  // 모바일 드로어에서 기사를 고르면 내비게이션과 동시에 드로어를 닫아야 결과가 바로 보인다.
  const handleSelectArticleAndClose = (articleTitle: string) => {
    handleSelectArticle(articleTitle);
    setSidebarOpen(false);
  };

  // 2026-09-03(32): 삭제를 누르자마자 바로 지워버리지 않고, "실행 취소" 토스트가 뜬
  // 5초 동안은 화면에서만 숨겨뒀다가(pendingDeleteTitle) 그 뒤에 실제로 records에서
  // 걷어낸다 — 원클릭 삭제가 되돌릴 수 없어 불안하다는 피드백 반영. commitDelete는
  // "이미 대기 중이던 삭제가 있는데 또 다른 걸 지운 경우"(undo 슬롯 1개만 유지)와
  // "타이머 만료로 확정되는 경우" 둘 다에서 쓰여서 별도 함수로 뽑았다.
  const deleteTimeoutRef = useRef<number | null>(null);

  const commitDelete = useCallback((articleTitle: string) => {
    setRecords((prev) => prev.filter((r) => r.article_title !== articleTitle));
  }, []);

  const handleDeleteArticle = (articleTitle: string) => {
    if (deleteTimeoutRef.current !== null) {
      window.clearTimeout(deleteTimeoutRef.current);
      if (pendingDeleteTitle) commitDelete(pendingDeleteTitle);
    }
    setPendingDeleteTitle(articleTitle);
    if (selectedArticle === articleTitle) goHome();
    deleteTimeoutRef.current = window.setTimeout(() => {
      commitDelete(articleTitle);
      setPendingDeleteTitle(null);
      deleteTimeoutRef.current = null;
    }, 5000);
  };

  const handleUndoDelete = () => {
    if (deleteTimeoutRef.current !== null) {
      window.clearTimeout(deleteTimeoutRef.current);
      deleteTimeoutRef.current = null;
    }
    setPendingDeleteTitle(null);
  };

  // 2026-09-03(35): "삭제하기" 클릭 즉시 지우던 걸 커스텀 확인 모달 한 단계 더 거치도록
  // 요청 반영 — Sidebar/ArticleTextViewer는 그대로 onDeleteArticle(title)만 호출하고,
  // 실제 삭제(handleDeleteArticle)는 이 모달에서 "삭제" 버튼을 눌러야만 실행된다.
  const [confirmDeleteTitle, setConfirmDeleteTitle] = useState<string | null>(null);

  const requestDeleteArticle = (articleTitle: string) => {
    setConfirmDeleteTitle(articleTitle);
  };

  const handleConfirmDelete = () => {
    if (confirmDeleteTitle) handleDeleteArticle(confirmDeleteTitle);
    setConfirmDeleteTitle(null);
  };

  useEffect(() => {
    if (!confirmDeleteTitle) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmDeleteTitle(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [confirmDeleteTitle]);

  return (
    // 2026-09-03(3): 사이드바가 페이지와 같이 스크롤되면서 스크롤을 조금만 내려도 "최근
    // 검증" 목록이 화면 밖으로 잘려나가는 문제 발견 — h-screen(고정 높이) + overflow-hidden
    // 으로 뷰포트 자체는 안 움직이게 고정하고, 사이드바/본문 각각 자기 영역 안에서만
    // 독립적으로 스크롤되게 바꾼다(사이드바는 Sidebar.tsx 내부 목록에 이미 overflow-y-auto가
    // 있음, 본문은 아래 <main>에 새로 추가).
    <div className="flex h-screen overflow-hidden bg-stone-50 dark:bg-stone-950">
      {/* 2026-09-03(4): lg 미만에서 드로어가 열려있을 때만 보이는 반투명 배경 — 탭하면 닫힘.
          lg 이상에서는 사이드바가 항상 고정 표시라 이 배경 자체가 필요 없다(lg:hidden). */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}
      <Sidebar
        groups={allArticleGroups}
        articleDates={articleDates}
        selectedArticle={selectedArticle}
        isOpen={sidebarOpen}
        onNewVerification={goHome}
        onSelectArticle={handleSelectArticleAndClose}
        onDeleteArticle={requestDeleteArticle}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 2026-09-03(4/5): lg 미만 전용 상단 바 — 사이드바가 화면 밖(드로어)으로 숨어있을
            때 열 수 있는 햄버거 버튼. lg 이상에서는 사이드바가 항상 보이니 이 바 자체가
            필요 없다(lg:hidden). 브랜드(아이콘+이름)는 relative/absolute로 바 전체 기준
            정중앙에 오게 했다 — 왼쪽 햄버거 버튼 옆에 그냥 나란히 두면 버튼 폭만큼
            오른쪽으로 치우쳐 보였음. */}
        <div className="relative flex items-center border-b border-stone-200 bg-white px-4 py-3 lg:hidden dark:border-stone-800 dark:bg-stone-950">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="메뉴 열기"
            className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg text-stone-600 transition hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-900"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
            </svg>
          </button>
          <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
            <span aria-hidden className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-match-600">
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="none">
                <path
                  d="M5 12.5l4.5 4.5L19 7"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="text-sm font-bold text-stone-900 dark:text-stone-50">AI 뉴스 사실 검증</span>
          </div>
        </div>

        <main
          // 2026-09-03(4): max-w/mx-auto를 예전엔 이 스크롤 컨테이너 자신에게 줬는데, 그러면
          // <main> 박스 자체가 max-w까지만 넓어져서 스크롤바가 화면 오른쪽 끝이 아니라 그
          // 박스 끝(가운데 근처)에 붙어버리고 오른쪽에 빈 여백이 남았다(실측 확인). 스크롤
          // 컨테이너(overflow-y-auto)는 항상 남는 폭 전체(flex-1)를 쓰게 하고, 폭 제한은
          // 안쪽 별도 div로 옮겨서 "스크롤바는 우측 끝, 내용만 가운데 정렬"이 되게 한다.
          className="flex flex-1 flex-col overflow-y-auto gap-6"
        >
          <div
            // 2026-09-03(5): max-w-6xl(1152px)이 사이드바(384px) 뺀 나머지 폭보다 훨씬
            // 좁아서(특히 넓은 모니터) 기사 원문 옆에 여백이 과하게 남았다 — 결과 화면은
            // 더 넓게 쓰도록 max-w를 키움(입력 화면은 좁은 폼이 자연스러워서 그대로 둠).
            // 2026-09-03(27): my-auto — main이 flex column이 됐으니(위 className 참고)
            // 내용이 짧으면(URL 1건 입력 화면 등) 위아래 남는 공간을 반씩 나눠 가져 정중앙에
            // 놓이고, 내용이 길어지면(기사 상세, 배치 입력 등) auto margin이 0으로 줄어들어
            // 그냥 위에서부터 자연스럽게 스크롤된다 — 조건 분기 없이 하나로 두 경우 다 처리.
            className={`mx-auto my-auto flex w-full flex-col gap-6 px-6 py-10 ${
              selectedGroup ? "max-w-[1500px]" : "max-w-3xl"
            }`}
          >
            {selectedGroup ? (
              <ArticleDetail
                group={selectedGroup}
                articleText={articleTexts[selectedGroup.articleTitle]}
                tableOrgIds={tableOrgIds}
                articleDates={articleDates}
                onDeleteArticle={requestDeleteArticle}
              />
            ) : (
              // 2026-09-03: 랜딩(입력) 화면을 히어로 + 카드형 검증 폼으로 개편(다른 팀
              // "팩트렌즈" UI 참고). 실제로 없는 기능(문장 직접 선택, 본문 붙여넣기 입력 등)은
              // 넣지 않고, 지금 파이프라인이 실제로 하는 일(자동 추출/매칭/판정근거)만
              // 문구로 반영했다.
              <div className="flex flex-col items-center gap-10 py-6 text-center">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-match-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-match-700 dark:bg-match-900/30 dark:text-match-300">
                    KOSIS × AI FACT CHECK
                  </span>
                  {/* 2026-09-03(27): URL을 여러 건 입력하는 배치 모드로 전환하면 카드가
                      세로로 길어지는데, 그 위에 큰 타이틀·설명·체크리스트까지 계속 떠 있으면
                      화면이 너무 빽빽해진다는 요청 — 배지(브랜드 표시)만 남기고 나머지는
                      숨긴다. urlInputs.length로만 조건을 걸어서, 다시 1건으로 줄이면
                      (입력칸을 지워서) 별도 상태 없이 자동으로 원래 문구가 되돌아온다. */}
                  {verifyJobs.urlInputs.length === 1 && (
                    <>
                      <h2 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight text-stone-900 dark:text-stone-50">
                        기사 속 숫자,
                        <br />
                        공식 통계로 검증하세요.
                      </h2>
                      <p className="mx-auto mt-4 max-w-md text-sm text-stone-500 dark:text-stone-400">
                        뉴스 기사 URL을 입력하면 수치 기반 주장을 자동으로 찾아 KOSIS 공식
                        통계와 대조하고, 일치/불일치/판단불가 판정과 근거까지 함께 보여드립니다.
                      </p>
                      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs font-medium text-stone-500 dark:text-stone-400">
                        <span className="inline-flex items-center gap-1">
                          <span className="text-match-600">✓</span> 수치 주장 자동 추출
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="text-match-600">✓</span> KOSIS 통계표 자동 매칭
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="text-match-600">✓</span> 판정 근거 설명 제공
                        </span>
                      </div>
                    </>
                  )}
                </div>

                <div className="w-full overflow-hidden rounded-3xl border border-stone-200 bg-white text-left shadow-sm dark:border-stone-700 dark:bg-stone-900">
                  <div className="flex items-center gap-2.5 border-b border-stone-100 bg-stone-50/60 px-8 py-5 dark:border-stone-800 dark:bg-stone-900/60">
                    <span aria-hidden className="text-match-600">
                      ↗
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-stone-800 dark:text-stone-100">
                        기사 URL 입력
                      </p>
                      <p className="text-xs text-stone-400">본문과 날짜를 자동으로 수집합니다</p>
                    </div>
                  </div>
                  <div className="p-8">
                    <VerifyArticleForm
                      urlInputs={verifyJobs.urlInputs}
                      jobs={verifyJobs.jobs}
                      isSubmitting={verifyJobs.isSubmitting}
                      isAllTerminal={verifyJobs.isAllTerminal}
                      doneCount={verifyJobs.doneCount}
                      failedCount={verifyJobs.failedCount}
                      onAddInputs={verifyJobs.handleAddInputs}
                      onRemoveInput={verifyJobs.handleRemoveInput}
                      onInputChange={verifyJobs.handleInputChange}
                      onSubmit={verifyJobs.handleSubmit}
                      onReset={verifyJobs.reset}
                      onViewArticle={handleArticleVerified}
                      autoFocus
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* 2026-09-03(32): 삭제 즉시 확정 대신 5초짜리 실행 취소 토스트 — 사이드바/기사
          상세 어느 쪽에서 삭제하든 App 최상위 한 곳에서만 관리하면 되므로 여기서 렌더. */}
      {pendingDeleteTitle && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-stone-900 px-4 py-3 text-sm text-white shadow-xl dark:bg-stone-100 dark:text-stone-900">
          <span className="max-w-[240px] truncate">'{pendingDeleteTitle}' 삭제됨</span>
          <button
            type="button"
            onClick={handleUndoDelete}
            className="shrink-0 cursor-pointer font-semibold text-match-400 transition hover:text-match-300 dark:text-match-700 dark:hover:text-match-600"
          >
            실행 취소
          </button>
        </div>
      )}

      {/* 2026-09-03(35): 네이티브 confirm() 대신 앱 톤에 맞춘 커스텀 확인 모달 —
          배경(bg-black/40)은 기존 모바일 드로어 오버레이와 같은 톤을 재사용했다.
          배경 클릭/Esc로 취소, 카드 안쪽 클릭은 전파 막아서 모달이 안 닫히게 함. */}
      {confirmDeleteTitle && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setConfirmDeleteTitle(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-stone-900"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-mismatch-50 text-mismatch-600 dark:bg-mismatch-900/30 dark:text-mismatch-400">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                  <path
                    d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0-.8 12.1a1 1 0 01-1 .9H8.8a1 1 0 01-1-.9L7 7"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">기사를 삭제할까요?</p>
                <p className="mt-1 truncate text-sm text-stone-600 dark:text-stone-500">'{confirmDeleteTitle}'</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-stone-500 dark:text-stone-600">
              삭제 후에도 잠시 동안은 "실행 취소"로 되돌릴 수 있어요.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteTitle(null)}
                className="cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold bg-stone-100 text-stone-600 transition hover:bg-stone-200 dark:text-stone-300 dark:hover:bg-stone-800"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="cursor-pointer rounded-lg bg-mismatch-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-mismatch-800"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
