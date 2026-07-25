import { useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, Camera, Plus, X } from "lucide-react";
import { useAuth } from "../../global/hooks/useAuth";
import { updateProfile, uploadAvatar } from "../libs/utils/profileApi";
import { ApiRequestError } from "../../global/api/apiClient";

const AVATAR_MAX_BYTES = 10 * 1024 * 1024;
const AVATAR_MAX_DIMENSION = 2000;
const ALLOWED_AVATAR_TYPES = ["image/png", "image/jpeg"];

function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 읽을 수 없습니다."));
    };
    img.src = url;
  });
}

export function ProfileSettingsScreen() {
  const navigate = useNavigate();
  const { user, refreshMe } = useAuth();

  const [name, setName] = useState(user?.name ?? "");
  const [affiliation, setAffiliation] = useState(user?.affiliation ?? "");
  const [githubUsername, setGithubUsername] = useState(user?.githubUsername ?? "");
  const [field, setField] = useState<string[]>(user?.field ?? []);
  const [fieldInput, setFieldInput] = useState("");

  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const initials = name ? name[0] : "?";

  const addField = () => {
    const trimmed = fieldInput.trim();
    if (!trimmed || field.includes(trimmed)) {
      setFieldInput("");
      return;
    }
    setField((prev) => [...prev, trimmed]);
    setFieldInput("");
  };

  const removeField = (value: string) => {
    setField((prev) => prev.filter((f) => f !== value));
  };

  const handleAvatarPick = () => fileInputRef.current?.click();

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setAvatarError(null);
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      setAvatarError("PNG 또는 JPG 파일만 업로드할 수 있습니다.");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError("파일 용량은 10MB 이하여야 합니다.");
      return;
    }
    try {
      const { width, height } = await readImageDimensions(file);
      if (width > AVATAR_MAX_DIMENSION || height > AVATAR_MAX_DIMENSION) {
        setAvatarError(`이미지 크기는 ${AVATAR_MAX_DIMENSION}x${AVATAR_MAX_DIMENSION} 이하여야 합니다.`);
        return;
      }
    } catch {
      setAvatarError("이미지를 읽을 수 없습니다.");
      return;
    }

    setAvatarUploading(true);
    try {
      const updated = await uploadAvatar(file);
      setAvatarUrl(updated.avatarUrl);
      await refreshMe();
    } catch (err) {
      setAvatarError(err instanceof ApiRequestError ? err.message : "프로필 사진 업로드에 실패했습니다.");
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await updateProfile({
        name: name.trim(),
        affiliation: affiliation.trim() || null,
        field,
        githubUsername: githubUsername.trim() || null,
      });
      await refreshMe();
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiRequestError ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6" style={{ fontFamily: "'Inter','Noto Sans KR',sans-serif" }}>
      <div className="max-w-xl mx-auto space-y-5">
        <button
          type="button"
          onClick={() => navigate("/mypage")}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> 마이페이지로 돌아가기
        </button>

        <h1 className="text-xl font-bold text-foreground">개인정보 수정</h1>

        <div className="bg-card rounded-2xl border border-border shadow-sm p-6 space-y-6">
          {/* 프로필 사진 */}
          <div className="flex items-center gap-4">
            <div className="relative">
              {avatarUrl ? (
                <img src={avatarUrl} alt="프로필 사진" className="w-20 h-20 rounded-2xl object-cover border border-border" />
              ) : (
                <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-white font-bold text-2xl" style={{ background: "#7048E8" }}>
                  {initials}
                </div>
              )}
              <button
                type="button"
                onClick={handleAvatarPick}
                disabled={avatarUploading}
                className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-60"
                aria-label="프로필 사진 변경"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => void handleAvatarChange(e)} />
            </div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              {avatarUploading ? "업로드 중..." : "PNG, JPG 확장자를 지원하며 용량은 최대 10MB 이하입니다."}
              <br />
              이미지 크기는 2000x2000 이하여야 합니다.
              {avatarError && <div className="mt-1 text-red-500">{avatarError}</div>}
            </div>
          </div>

          {/* 이름 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground">이름</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-border bg-input-background px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {/* 소속 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground">소속</label>
            <input
              value={affiliation}
              onChange={(e) => setAffiliation(e.target.value)}
              placeholder="예: 컴퓨터공학과 3학년"
              className="w-full rounded-xl border border-border bg-input-background px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {/* 분야 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground">분야</label>
            <div className="flex gap-2">
              <input
                value={fieldInput}
                onChange={(e) => setFieldInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addField(); } }}
                placeholder="예: 백엔드"
                className="flex-1 rounded-xl border border-border bg-input-background px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={addField}
                className="flex items-center gap-1 px-3 py-2.5 rounded-xl text-xs font-semibold text-white shrink-0 hover:opacity-90 transition-opacity"
                style={{ background: "var(--primary)" }}
              >
                <Plus className="w-3.5 h-3.5" /> 추가
              </button>
            </div>
            {field.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {field.map((f) => (
                  <span key={f} className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                    {f}
                    <button type="button" onClick={() => removeField(f)} aria-label={`${f} 삭제`} className="hover:text-blue-900">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* GitHub */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground">GitHub 아이디</label>
            <input
              value={githubUsername}
              onChange={(e) => setGithubUsername(e.target.value)}
              placeholder="예: octocat"
              className="w-full rounded-xl border border-border bg-input-background px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {saveError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{saveError}</div>
          )}
          {saved && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-600">저장되었습니다.</div>
          )}

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!name.trim() || saving}
            className="w-full py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
            style={{ background: "linear-gradient(135deg, #3B5BDB 0%, #4F6EF7 100%)" }}
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
