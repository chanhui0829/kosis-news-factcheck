import { useEffect, useState } from "react";

interface ScoreGaugeProps {
  value: number; // 0-100
  colorClass: string; // Tailwind stroke-* class for the progress arc
}

// 2026-09-03(5): 원(96px, strokeWidth 9)이 "100%" 같은 3자리 숫자 텍스트(text-2xl)보다
// 작아서 %가 링 밖으로 삐져나오는 문제 발견 — index.css가 640px 이상에서 루트 폰트를
// 16px→18px로 올리는데, SVG는 rem이 아니라 고정 px라 이 확대에 안 따라가서 실제로는
// 원래 설계 때보다 텍스트가 상대적으로 더 커져 있었다. 원 자체를 키워서 확실히 여유를
// 두고, 감싸는 div 크기(h-[120px] w-[120px])도 SVG 실제 크기와 맞춘다(달라지면 SVG가
// 컨테이너 밖으로 밀려나 중앙정렬이 깨짐).
export function ScoreGauge({ value, colorClass }: ScoreGaugeProps) {
  const size = 120;
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // 2026-09-03(33): 처음부터 최종 값으로 그려지면 아래 transition-all이 있어도 "값이
  // 바뀐 적"이 없어서 애니메이션이 재생되지 않는다(정적으로 보인다는 피드백의 원인) —
  // 0에서 시작해 마운트 한 프레임 뒤에 실제 값으로 바꿔서 링이 실제로 차오르게 한다.
  // (기사를 바꿀 때마다 다시 재생되려면 호출부에서 key={articleTitle}로 리마운트시켜야 함)
  const [displayValue, setDisplayValue] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDisplayValue(value));
    return () => cancelAnimationFrame(id);
  }, [value]);

  const offset = circumference * (1 - Math.min(100, Math.max(0, displayValue)) / 100);

  return (
    <div className="relative h-[120px] w-[120px] shrink-0">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          className="fill-none stroke-stone-100 dark:stroke-stone-800"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={`fill-none transition-all duration-700 ease-out ${colorClass}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl leading-none font-bold text-stone-900 dark:text-stone-50">
          {Math.round(value)}%
        </span>
        <span className="mt-1 text-[10px] leading-none text-stone-400">매칭률</span>
      </div>
    </div>
  );
}
