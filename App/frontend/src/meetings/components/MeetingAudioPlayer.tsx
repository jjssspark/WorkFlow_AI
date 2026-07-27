import { useEffect, useState } from "react";
import { Music } from "lucide-react";
import { API_BASE_URL } from "../../global/api/apiClient";
import { tokenStore } from "../../global/api/tokenStore";

interface MeetingAudioPlayerProps {
  projectId: string;
  meetingId: string;
}

/**
 * 회의록 음성 파일 재생기.
 *
 * 음성 엔드포인트는 Authorization 헤더를 요구하는데 <audio src>로는 헤더를 붙일 수 없다.
 * 토큰을 쿼리스트링에 실으면 URL과 로그에 남으므로, 헤더로 받아 blob URL로 재생한다.
 *
 * 한계: 이 방식은 파일 전체를 받은 뒤 재생을 시작하므로 서버가 지원하는 Range 부분 전송의
 * 이점(즉시 재생·구간만 내려받기)을 활용하지 못한다. 긴 녹음에서 첫 재생이 느릴 수 있다.
 * 이를 없애려면 헤더 없이 접근 가능한 단기 서명 URL이 필요하다.
 */
export function MeetingAudioPlayer({ projectId, meetingId }: MeetingAudioPlayerProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    const controller = new AbortController();

    setObjectUrl(null);
    setError(null);

    const accessToken = tokenStore.getAccessToken();
    fetch(`${API_BASE_URL}/projects/${projectId}/meetings/${meetingId}/audio`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      signal: controller.signal,
    })
      .then(response => {
        if (!response.ok) throw new Error(String(response.status));
        return response.blob();
      })
      .then(blob => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      })
      .catch((e: unknown) => {
        if (cancelled || (e instanceof DOMException && e.name === "AbortError")) return;
        setError("음성 파일을 불러오지 못했습니다.");
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [projectId, meetingId]);

  if (error) {
    return <div className="text-[10px] text-amber-600">{error}</div>;
  }

  return (
    <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground mb-1.5">
        <Music className="w-3 h-3" />녹음 파일
      </div>
      {objectUrl ? (
        <audio controls src={objectUrl} className="w-full h-8" aria-label="회의 녹음 재생" />
      ) : (
        <div className="text-[10px] text-muted-foreground">불러오는 중...</div>
      )}
    </div>
  );
}
