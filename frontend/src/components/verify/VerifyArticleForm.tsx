import type { JobEntry, JobStatus } from "../../lib/useVerifyJobs";

// 2026-08-26(5): 프론트 구조 개편 — "기사 목록에서 골라 보기"에서 "URL을 입력하면 그 기사를
// 보여주기"로 바뀌면서, 원래 모달 안에 있던 입력 폼을 독립 컴포넌트로 뽑았다.
// App.tsx의 메인(입력) 화면에서 인라인으로 쓰인다.
//
// 2026-09-03(4): 결과 화면의 "다른 기사 검증하기" 플로팅 버튼(VerifyAnotherArticleButton)을
// 제거했다 — 사이드바의 "새 통계 검증"이 이미 항상 떠 있어서 같은 동작을 하는 진입점이
// 두 개일 필요가 없었음. 그래서 지금은 이 화면 한 군데에서만 쓰인다.
//
// useVerifyJobs 훅은 이 컴포넌트가 아니라 App.tsx가 직접 들고 있는다 — 순수 표시
// (presentational) 컴포넌트로만 두고, 상태/핸들러는 전부 props로 받는다.
const ADD_BATCH_SIZE = 5;

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "대기 중",
  fetching: "원문 수집 중",
  processing: "1~8단계 처리 중",
  done: "완료",
  failed: "실패",
};

interface VerifyArticleFormProps {
  urlInputs: string[];
  jobs: JobEntry[];
  isSubmitting: boolean;
  isAllTerminal: boolean;
  doneCount: number;
  failedCount: number;
  onAddInputs: (batchSize?: number) => void;
  onRemoveInput: (index: number) => void;
  onInputChange: (index: number, value: string) => void;
  onSubmit: () => void;
  onReset: () => void;
  // 완료된 job 옆의 "결과 보기"를 눌렀을 때 호출 — 자동 이동(단일 제출)은 호출부(App.tsx)가
  // useVerifyJobs의 onJobDone 콜백에서 직접 처리하므로 이 컴포넌트는 신경 쓰지 않는다.
  onViewArticle: (articleTitle: string) => void;
  autoFocus?: boolean;
}

export function VerifyArticleForm({
  urlInputs,
  jobs,
  isSubmitting,
  isAllTerminal,
  doneCount,
  failedCount,
  onAddInputs,
  onRemoveInput,
  onInputChange,
  onSubmit,
  onReset,
  onViewArticle,
  autoFocus,
}: VerifyArticleFormProps) {
  return (
    <div className="flex flex-col gap-3">
      {!isSubmitting && (
        // 2026-09-03(21): 색만 바꾸는 걸 넘어서 구조 자체를 갈아엎었다 — 대부분은 URL
        // 하나만 검증할 텐데(urlInputs 기본값이 [""] 하나) 그 흔한 경우까지 "번호 원 +
        // 입력 + 별도 제출 버튼" 3단 구성으로 보여줄 필요가 없었다. 1건일 때는 검색창
        // 형태(입력 안에 화살표 버튼 내장, Enter로도 제출)로 크고 트렌디하게, 여러 건
        // 배치 검증은 "+ 여러 건 한 번에" 텍스트 링크를 눌러야 나오는 보조 기능으로
        // 격을 낮췄다. 2건 이상이 되면 기존처럼 번호 매긴 리스트 + 하단 제출 버튼으로
        // 전환된다(그 경우는 화살표 인라인 버튼이 어색해서).
        <div className="flex flex-col gap-3">
          {urlInputs.length === 1 ? (
            <>
              <div className="relative">
                <input
                  type="url"
                  value={urlInputs[0]}
                  onChange={(e) => onInputChange(0, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && urlInputs[0].trim()) onSubmit();
                  }}
                  placeholder="기사 URL을 붙여넣어 주세요"
                  className="h-16 w-full rounded-2xl border border-stone-300 bg-stone-50/60 pr-16 pl-5 text-base outline-none transition focus:border-match-500 focus:bg-white focus:ring-4 focus:ring-match-500/15 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:focus:bg-stone-800"
                  autoFocus={autoFocus}
                />
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={!urlInputs[0].trim()}
                  aria-label="검증 시작"
                  className="absolute top-1/2 right-2.5 grid h-11 w-11 -translate-y-1/2 cursor-pointer place-items-center rounded-xl bg-stone-900 text-white transition hover:bg-match-600 disabled:cursor-default disabled:bg-stone-200 disabled:text-stone-400 dark:bg-white dark:text-stone-900 dark:hover:bg-match-100 dark:disabled:bg-stone-700 dark:disabled:text-stone-500"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                    <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              {/* 2026-09-03(28): 텍스트만 있던 링크가 너무 밋밋하다는 피드백 — 크기를
                  한 단계 키우고, 위 단일 입력창 제출 버튼과 같은 화살표 아이콘을 붙여서
                  폼 안에서 아이콘 언어를 통일했다. 호버 시 화살표가 살짝 오른쪽으로
                  밀리는 인터랙션으로 "다음으로 이어지는" 느낌을 살림. */}
              <button
                type="button"
                onClick={() => onAddInputs(ADD_BATCH_SIZE)}
                className="group cursor-pointer ml-2 mt-1 flex items-center gap-1 self-start text-sm font-semibold text-stone-400 transition hover:text-match-600 dark:text-stone-500 dark:hover:text-match-400"
              >
                여러 건 한 번에 검증하기
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5"
                  fill="none"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </>
          ) : (
            <>
              {/* 2026-09-03(24): "번호가 삭제 버튼으로 변신" 아이디어는 재밌긴 한데
                  아무 표시가 없다가 우연히 호버해야만 발견되는 게 문제라는 피드백 —
                  Linear/Notion/Gmail류가 실제로 쓰는, 훨씬 검증된 패턴으로 바꿨다:
                  아이콘을 처음부터 옅게 보여주고(있다는 건 바로 알 수 있음), 그 행에
                  마우스를 올리면(행 전체가 그룹) 색이 진해지면서 빨간 톤으로 바뀐다.
                  "숨겨뒀다 놀래키기"가 아니라 "있는 건 보이되 힘을 뺐다가, 다가가면
                  반응하는" 쪽이라 훨씬 더 안전하게 익숙하다.
                  2026-09-03(26): 휴지통 아이콘 대신 미니멀한 "–"(마이너스) 한 줄로
                  바꿨다(요청 반영, 더 심플하고 깔끔함) — 버튼 자체가 rounded-full이라
                  hover:bg-mismatch-50가 걸리면 자동으로 원 배경 안에 들어간 것처럼
                  보인다(마우스를 그 아이콘에 직접 올렸을 때만). */}
              {/* 2026-09-03(27): 입력칸이 늘어날 때마다 페이지 전체가 길어져 스크롤되던 걸,
                  카드 안쪽(이 리스트)만 자체 스크롤하도록 바꿨다(요청 반영) — 헤더의 "기사
                  URL 입력"이나 아래 "+5개 더 추가"/"검증 시작" 버튼이 화면 밖으로 밀려나지
                  않고 항상 보인다. thin-scrollbar는 index.css에 이미 있는 커스텀 스크롤바. */}
              <div className="thin-scrollbar flex max-h-[340px] flex-col gap-2.5 overflow-y-auto pr-1">
                {urlInputs.map((value, i) => (
                  <div key={i} className="group flex items-center gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-stone-100 text-xs font-semibold text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                      {i + 1}
                    </span>
                    <input
                      type="url"
                      value={value}
                      onChange={(e) => onInputChange(i, e.target.value)}
                      placeholder="기사 URL을 입력해주세요"
                      className="h-11 w-full rounded-xl border border-stone-300 px-3.5 text-sm outline-none transition focus:border-match-500 focus:ring-4 focus:ring-match-500/15 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                      autoFocus={autoFocus && i === 0}
                    />
                    <button
                      type="button"
                      onClick={() => onRemoveInput(i)}
                      aria-label="이 입력칸 삭제"
                      className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full text-stone-300 transition group-hover:text-stone-400 hover:!bg-mismatch-50 hover:!text-mismatch-500 dark:text-stone-600 dark:group-hover:text-stone-500 dark:hover:!bg-mismatch-900/30 dark:hover:!text-mismatch-400"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
                        <path d="M6 12h12" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onAddInputs(ADD_BATCH_SIZE)}
                className="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-stone-300 py-2.5 text-xs font-medium text-stone-500 transition hover:border-stone-400 hover:text-stone-700 dark:border-stone-700 dark:text-stone-400 dark:hover:border-stone-500 dark:hover:text-stone-300"
              >
                + {ADD_BATCH_SIZE}개 더 추가
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={urlInputs.every((u) => !u.trim())}
                className="cursor-pointer rounded-xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-match-600 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-stone-900 dark:bg-white dark:text-stone-900 dark:hover:bg-match-100 dark:disabled:hover:bg-white"
              >
                검증 시작
              </button>
            </>
          )}
        </div>
      )}

      {isSubmitting && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {isAllTerminal
              ? `전체 ${jobs.length}건 처리 완료 (성공 ${doneCount}건, 실패 ${failedCount}건)`
              : `전체 ${jobs.length}건 중 완료 ${doneCount + failedCount}건 — 서버가 순서대로 처리 중...`}
          </p>
          {/* 2026-09-03(27): 입력 리스트와 같은 이유로, job 진행 목록도 카드 안쪽만 자체
              스크롤하게 통일했다 — 상단 진행 요약 문구와 하단 "새로 검증하기" 버튼이 항상
              보인다. */}
          <div className="thin-scrollbar flex max-h-[340px] flex-col gap-2 overflow-y-auto pr-1">
            {jobs.map((job, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-lg border border-stone-200 px-3 py-2 text-xs dark:border-stone-700"
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-stone-100 text-[10px] font-semibold text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                  {i + 1}
                </span>
                <span className="mt-0.5 shrink-0">
                  {job.status === "done" && (
                    <span className="grid h-4 w-4 place-items-center rounded-full bg-match-100 text-match-600 dark:bg-match-900/40">
                      ✓
                    </span>
                  )}
                  {job.status === "failed" && (
                    <span className="grid h-4 w-4 place-items-center rounded-full bg-mismatch-100 text-mismatch-600 dark:bg-mismatch-900/40">
                      ✕
                    </span>
                  )}
                  {(job.status === "queued" || job.status === "fetching" || job.status === "processing") && (
                    <span className="block h-4 w-4 animate-spin rounded-full border-2 border-stone-500 border-t-transparent" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-stone-700 dark:text-stone-200">
                    {job.article_title ?? job.url}
                  </p>
                  <p className="text-stone-400 dark:text-stone-500">
                    {job.status === "done"
                      ? job.claim_count
                        ? `주장 ${job.claim_count}건 처리됨`
                        : "검증 가능한 수치 주장을 찾지 못했습니다"
                      : job.status === "failed"
                        ? (job.error ?? "검증 중 오류가 발생했습니다.")
                        : STATUS_LABEL[job.status]}
                  </p>
                </div>
                {/* claim_count가 0이면 DB에 아무 레코드도 안 남아서 볼 결과 자체가 없다 —
                    2026-08-28: 이 경우에도 버튼을 보여주면 눌러도 반응이 없는 것처럼 보인다
                    (실제 버그로 발견됨). */}
                {job.status === "done" && job.article_title && !!job.claim_count && (
                  <button
                    type="button"
                    onClick={() => onViewArticle(job.article_title!)}
                    className="shrink-0 cursor-pointer self-center rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-700 transition hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
                  >
                    결과 보기 →
                  </button>
                )}
              </div>
            ))}
          </div>
          {isAllTerminal ? (
            <button
              type="button"
              onClick={onReset}
              className="cursor-pointer rounded-lg bg-stone-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700"
            >
              새로 검증하기
            </button>
          ) : (
            <p className="text-xs text-stone-400">
              창을 닫아도 백그라운드에서 계속 진행돼요. 끝나는 대로 반영됩니다.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
