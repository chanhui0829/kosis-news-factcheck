// 배치 파이프라인의 _clean_scraped_article_text(agent/pipeline/batch_runner.py)는 "제목
// 위치부터 3000자"만 잘라내서 화면 표시용 잡음(내비게이션 메뉴 반복, 광고/추천 콘텐츠,
// 비디오 플레이어 자막 UI 텍스트 등)은 그대로 남아있다. 이 함수는 그 잡음을 "화면에
// 보여줄 때만" 추가로 걷어낸다 — 실제 파이프라인이 모델에 넘긴 텍스트(article_text 원본)는
// 건드리지 않고, 표시 직전에만 적용한다.
//
// 검증(2026-08-10, 실제 export된 기사 16건 기준): 평균 길이 2726자 → 1714자(-37%)로
// 줄었고, 하이라이트 대상 주장 33건의 매칭 여부는 정리 전후로 동일하게 유지됨(회귀 없음).
// 타임스탬프 뒤에 댓글수 등 UI 배지 숫자가 하나 더 붙어 스크랩되는 경우가 실측 확인됨
// (예: "…06:07 0 지난달 생산자물가가…", 배지 값은 기사마다 다름 — 0/1/4/23 등). 잘라낼
// 기준 위치를 그 숫자까지 포함해서 잡아야 "0"이 본문 맨 앞에 남는 문제가 안 생긴다.
const BYLINE_TIMESTAMP_RE =
  /입력\s*\d{4}\.\d{2}\.\d{2}\.\s*\d{2}:\d{2}(\s*업데이트\s*\d{4}\.\d{2}\.\d{2}\.\s*\d{2}:\d{2})?(\s*\d+)?/g;
// video.js류 임베드 플레이어가 스크린리더용으로 넣는 자막 설정 UI 텍스트 — 사이트가
// 달라도 이 문구 자체는 라이브러리 공통이라 거의 그대로 반복된다. 닫는 문구("End of
// dialog window.")까지 스크랩됐을 때만 안쪽을 지우는 용도라, TRAILING_JUNK_RE 쪽에서
// 시작 문구만으로도 뒤를 통째로 잘라내는 것과는 역할이 다르다(원본이 max_len에 걸려
// 닫는 문구 전에 잘렸으면 이 정규식은 매치가 안 되므로 TRAILING_JUNK_RE가 대신 잡아줌).
const VIDEO_WIDGET_RE = /Video Player is loading\.[\s\S]*?End of dialog window\./g;

// 2026-09-03(20): 골든셋 원본(본문(정제됨))이 max_len(3000자)에서 그대로 잘린 채라,
// 짧은 기사는 남는 자리에 "관련기사 추천/기자 프로필 위젯/댓글창/동영상 플레이어 UI"
// 같은 잡음이 실제 기사 본문 바로 뒤에 이어붙어 있다(실측 확인 — 화면에 "구독수 151
// 100자평 ... AI 추천 오늘의 멤버십 ..." 식으로 그대로 노출됨). 아래 마커들은 전부
// 실제 기사 본문에는 등장할 일이 거의 없는(오탐 위험 낮은) 조선일보 UI 전용 문구라
// (agent/pipeline/batch_runner.py의 _JUNK_SECTION_RE와 같은 발상), 이 중 어느 것이든
// 가장 먼저 나타나는 위치를 찾아서 그 뒤를 통째로 잘라낸다.
//   - 더보기 / 기사보기: "관련기사 더보기"류 teaser 링크 라벨
//   - 구독수\s*\d+, [가-힣]{2,4}\s*기자\s*(년부터|구독): 기자 프로필 위젯("OOO 기자
//     2013년부터 기자 생활을…"/"OOO 기자 구독 …") — 앞에 해시태그 하나가 붙는 경우도
//     있어((?:#\S+\s*)?) 같이 삼킨다. "OOO 기자"만으로는 본문 중 "~ 기자간담회"처럼
//     진짜 문장에도 걸릴 수 있어(2026-09-03 실측 오탐 발견) 뒤에 년부터/구독이 붙을
//     때만 매치하도록 좁혀뒀다.
//   - 100자평 / AI 추천 / 오늘의 멤버십 / 오늘의 핫뉴스 / 많이 본 뉴스: 댓글·추천 위젯 헤더
//   - #\S+: 실측 확인된 7건 전부(코로나/트럼프/실적/금리/세금/빅테크) 예외 없이 "관련
//     키워드" 태그 목록(더보기 링크로 이어지는) 시작점이라 해시태그 1개만으로도 자른다
//     — 본문 문장 안에 '#'가 등장하는 경우는 실측상 전혀 없었음(오탐 위험 매우 낮음).
//   - 2026-09-03(21): data_set.csv에서 무작위 45건을 뽑아 같은 로직을 돌려본 결과
//     추가로 발견된 마커들 — "OOO 기자 정책팀장 경제부 정책팀장…" 식으로 년부터/구독
//     없이 바로 직함이 붙는 기자 소개, "2020년 조선일보에 입사해" 식 다른 템플릿,
//     기자상 수상 이력 나열, 비디오 위젯의 잔여 스크립트/타이머 표시.
//   - 조선일보(?:에)?\s*입사, 한국기자상|이달의\s*기자상|씨티언론인상|삼성언론상|
//     관훈언론상: "OOO 기자 [소개문구]…" 템플릿이 다양해서 년부터/구독만으론 못 잡는
//     기자 소개 카드를, 소개문 안에 거의 항상 등장하는 경력/수상 문구로 대신 잡는다.
//   - close\s*Advertisements, Technology and Trends in Gangnam,
//     \d{1,2}:\d{2}\s*/\s*\d{1,2}:\d{2}(재생 시간 표시, 예: "00:00 / 01:35"): 광고
//     스크립트·비디오 플레이어 잔여물이 그대로 스크랩된 경우.
const TRAILING_JUNK_RE =
  /By\s*Taboola|많이\s*본\s*뉴스|오늘의\s*멤버십|오늘의\s*핫뉴스|AI\s*추천|100자평|더보기|(?:English\s*)?기사보기|구독수\s*\d+|[가-힣]{2,4}\s*기자\s*(?:\d{4}년(?:도)?부터|구독)|조선일보(?:에)?\s*입사|한국기자상|이달의\s*기자상|씨티언론인상|삼성언론상|관훈언론상|close\s*Advertisements|Technology and Trends in Gangnam|\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}|Video Player is loading\.|#\S+/;

// 뉴스 사이트가 "AI 추천"/관련기사 teaser 블록을 통째로 2~3번 반복해서 내보내는 경우가
// 실측 확인됨. 특정 문구를 하드코딩하지 않고, 인접한 두 구간이 글자 단위로 완전히
// 동일하면 하나만 남기는 일반적인 방식으로 잡는다 (긴 블록부터 시도해서 우연한 짧은
// 반복 어구까지 지워지지 않게 함).
function collapseRepeatedBlocks(text: string, minLen = 20, maxLen = 300): string {
  let result = "";
  let i = 0;
  const n = text.length;

  while (i < n) {
    let collapsed = false;
    for (let len = Math.min(maxLen, Math.floor((n - i) / 2)); len >= minLen; len--) {
      const a = text.slice(i, i + len);
      const b = text.slice(i + len, i + len * 2);
      if (a === b) {
        let end = i + len;
        while (text.slice(end, end + len) === a) {
          end += len;
        }
        result += a;
        i = end;
        collapsed = true;
        break;
      }
    }
    if (!collapsed) {
      result += text[i];
      i += 1;
    }
  }

  return result;
}

// 문장 끝(.?!) 뒤 공백 다음이 숫자가 아닐 때만 경계로 본다 — "46.1%로 2023년(46.9%)"처럼
// 소수점 뒤에 곧바로 숫자/기호가 이어지는 경우(공백이 아예 없어 애초에 안 걸림)와, "…9,384,325명"
// 뒤에 공백 없이 이어지는 경우는 그대로 안전하다. 공백 뒤가 숫자로 시작하는 문장(드묾)은
// 못 쪼개고 넘어가지만, 문장 중간을 잘못 끊는 것보다 덜 쪼개는 쪽이 안전하다.
const SENTENCE_BOUNDARY_RE = /(?<=[.?!])\s+(?=[^\d])/;
const PARAGRAPH_GROUP_SIZE = 3;

// data_set.csv 스크랩 본문은 문단 구분(줄바꿈) 없이 완전히 한 줄로 저장돼 있다(팀 제공
// 원본 자체가 그렇다, 2026-08-22 확인). 프론트가 실시간으로 기사 URL에서 다시 긁어와
// 원래 문단(db/fetch_article_text.py, Fusion CMS는 \n\n 유지) 텍스트를 못 가져온 경우
// (URL 만료/네트워크 실패 등)엔 이 CSV 텍스트로 그대로 폴백하는데, 그러면 화면에 문단
// 구분 없는 벽처럼 보인다. 원래 문단 경계를 복원할 방법은 없으니(정보 자체가 유실됨),
// 대신 문장 3개 단위로 묶어 읽기 편하게라도 쪼갠다 — "진짜 문단"은 아니지만 완전히
// 이어붙은 것보다는 훨씬 읽기 쉽다.
function reconstructParagraphs(text: string): string {
  const sentences = text.split(SENTENCE_BOUNDARY_RE);
  if (sentences.length <= 1) return text;

  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += PARAGRAPH_GROUP_SIZE) {
    paragraphs.push(sentences.slice(i, i + PARAGRAPH_GROUP_SIZE).join(" "));
  }
  return paragraphs.join("\n\n");
}

export function cleanArticleTextForDisplay(text: string): string {
  let trimmed = text.replace(VIDEO_WIDGET_RE, " ");

  // 여러 언론사가 공통으로 쓰는 "입력 YYYY.MM.DD. HH:MM" 바이라인 표기 뒤부터가 실제
  // 본문 시작인 경우가 많다. 선두 내비게이션 메뉴가 반복되며 이 패턴이 여러 번 걸릴 수
  // 있어, 가장 마지막(=본문에 가장 가까운) 위치를 기준으로 그 이전을 잘라낸다.
  const matches = [...trimmed.matchAll(BYLINE_TIMESTAMP_RE)];
  if (matches.length > 0) {
    const last = matches[matches.length - 1];
    trimmed = trimmed.slice((last.index ?? 0) + last[0].length);
  }

  // 본문이 시작된 뒤(=위 바이라인 이후) 나타나는 잡음 섹션은 실제 기사 본문 뒤에
  // 이어붙은 것이므로, 첫 마커 위치에서 통째로 잘라낸다.
  const junkIndex = trimmed.search(TRAILING_JUNK_RE);
  if (junkIndex !== -1) {
    trimmed = trimmed.slice(0, junkIndex);
  }

  trimmed = collapseRepeatedBlocks(trimmed);
  trimmed = trimmed.trim();

  if (!trimmed.includes("\n")) {
    trimmed = reconstructParagraphs(trimmed);
  }

  return trimmed;
}
