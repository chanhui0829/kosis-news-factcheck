# AI 기반 뉴스 사실검증 시스템

뉴스 기사의 수치 주장을 KOSIS(국가데이터처) 공식 통계와 비교해 **일치 / 불일치 / 판단불가**로 판정하고 근거를 설명까지 생성하는 8단계 파이프라인입니다.

멋사 NLP 5기 종합 프로젝트(클라비 기업 연계) — 실전1(주장 추출·EDA) → 실전2(대화형 통계 조회 에이전트) → 종합(전체 자동화)의 마지막 단계입니다.

**연산(계산·판정)은 LLM 대신 코드가 결정론적으로 수행하도록 설계했습니다** — 선행 연구(QuanTemp 벤치마크에서 GPT-4 Macro-F1 37.0점)가 보여주듯 LLM은 비교·산술 같은 수치 추론에 체계적으로 취약하기 때문입니다. 아래 지표는 이 설계를 검증하는 과정에서 나온 단계별 개선 결과입니다.

## 검증 프로세스 (8단계)

```text
기사 원문
  → [1] 분류(classifier)          관련 기사인지(수치 기반 주장 포함 여부) 판별
  → [2] 주장 추출(claim_extractor) 검증 가능한 수치 주장 문장을 구조화해서 추출
  → [3] 통계표 매핑              keyword_search + embedding_search + reranker로 대응 KOSIS 표 탐색
  → [4] 슬롯필링/되묻기           시점·지역·계산종류 등 조회에 필요한 값 채우기
  → [5] KOSIS API 조회            공식 통계 데이터 실제 호출
  → [6] 계산                     합계/비율/증감/증감률/최댓값·최솟값검증 등 코드 연산
  → [7] 판정                     기사 수치 vs 계산값 비교 → 일치/불일치/판단불가
  → [8] 설명 생성                 근거·계산방식·판정이유·한계를 포함한 설명문 생성
```

| 판정 | 조건 |
|---|---|
| 일치 | 기사 수치가 공식 통계와 동일하거나 시점·단위가 일치 |
| 불일치 | 기사 수치가 공식 데이터와 다르거나 시점·단위·모집단 해석이 잘못됨 |
| 판단불가 | 지표·시점이 불명확하거나 대응하는 공식 데이터가 없음 |

## 평가 결과 (개선 전 → 최종)

| 지표 | 개선 전 | 최종 |
|---|---:|---:|
| 1단계 분류 정확도 | 66.0% | **90.0%** |
| 2단계 주장 추출 Recall | 28.8% | **91.3%** (긴 기사 3,000자 단위 분할 처리로 개선) |
| 3단계 Dense 검색 Recall@30 | 29.3% | **61.0%** |
| 3단계 통계표 매칭률 (조건부) | 51.4% | **57.3%** |
| 통계표 카탈로그 규모 | 64개 (수작업) | **28.7만 건** (KOSIS 전체 크롤링) |

수작업으로 고른 64개 카탈로그만으로는 새 기사 주제에 대응할 수 없다는 한계가 있어, KOSIS Open API로 전체 통계표를 크롤링해 PostgreSQL(pgvector)에 적재하고 Dense(임베딩) + Sparse(키워드) 하이브리드 검색으로 전환했습니다. 이 과정에서 8단계를 전부 연결해 실행하면 각 단계 오류가 누적되며 성능이 저하되는 현상을 확인했고, 위 개선은 그 원인을 단계별로 추적하며 나온 결과입니다. 실험 조건과 상세 로그는 [검색 실험 리포트](benchmark/search_experiment/REPORT.md), [파이프라인 연결 로그](tests/pipeline_integration_log.md)에 정리했습니다.

## 저장소 구성

| 경로 | 내용 |
|---|---|
| `agent/preprocessing/` | 1~2단계 — 분류, 주장 추출 |
| `agent/mapping/` | 3단계 — 통계표 매칭 (keyword+embedding+reranker) |
| `agent/orchestrator/` | 4단계 — 슬롯필링·되묻기 |
| `agent/kosis/` | 5~6단계 — KOSIS API 조회·계산 |
| `agent/verdict/` · `agent/explain/` | 7·8단계 — 판정·설명 생성 |
| `agent/pipeline/` | 전체 파이프라인 연결 (batch_runner.py) |
| `agent/api/` | 실시간 검증 API (FastAPI, GPU 서버 전용) |
| `data/` · `db/` | 데이터셋, 검증 결과 SQLite |
| `tests/` | 단위 테스트 + 검증/체이닝 로그 |
| `benchmark/` | 3단계 검색 전략 비교 실험 |
| `docs/` | 설계 문서, 매핑 실패 통계표 기록 |
| `frontend/` | 검증 결과 확인용 웹 UI (React + TypeScript) |

## 시작하기

```bash
pip install -r requirements.txt
```

`.env`에 `KOSIS_API_KEY`, `HCX_API_KEY` 설정 후:

```bash
python -m agent.pipeline.batch_runner          # 하드코딩 시나리오
python -m agent.pipeline.batch_runner --csv    # 실제 데이터셋 샘플
```

테스트는 `python -m tests.<파일명>` 형태로 개별 실행합니다(API 키 필요 여부는 각 파일 docstring 참고).

## Git에 포함하지 않는 자산

`.env`/API 키, 원본 스크랩 데이터셋(`data/data_set.csv`), `verifications.db`, 임베딩 인덱스·모델 캐시

## 알려진 한계

- 표 하나에 지표가 여러 개일 때 자동으로 못 고름 (예: 실업률/취업자/고용률이 한 표에 섞여 있으면 잘못된 지표를 조용히 조회)
- 분기/월 전용 통계는 연간 폴백이 없어 100% 실패 (GDP 성장률, 주택가격지수 등)
- 슬롯 되묻기(REQUIRED_SLOTS)가 표와 무관하게 고정돼 있어, 지역 축이 없는 표에도 항상 지역을 되물음
- 카탈로그가 커질 때마다 5·6단계 파라미터 커버리지가 못 따라가는 갭이 재발
- KOSIS Open API로 데이터가 열려있지 않아 검증 불가로 결론난 통계 항목 있음 — [기록](docs/PENDING_TABLES.md)
- 사람 검증 리뷰 단계는 DB 컬럼만 준비, UI/로직 없음

## 팀 역할 구분 (파이프라인 단계 기준)

- **A** — 1~2단계 전처리 (classifier, claim_extractor)
- **B** — 3~4단계 통계표 매핑·슬롯필링 (keyword_search, embedding_search, reranker, slot_filler, clarify, clarify_rules, calc_type_router)
- **C** — 5~6단계 KOSIS 연동 (api_client, calculator)
- **D** — 7·8단계 판정/설명 (judge, explainer)
