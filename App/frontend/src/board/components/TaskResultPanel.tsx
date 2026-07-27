import { useEffect, useRef, useState, type DragEvent } from "react";
import { X, Plus, Link2, Github, Figma, FileText, FileJson, Image as ImageIcon, Trash2, RotateCcw } from "lucide-react";
import { useAuth } from "../../global/hooks/useAuth";
import { DEMO_PROJECT_ID } from "../libs/utils/taskApi";
import {
  fetchTaskResult, saveTaskResult, addTaskResultLink, deleteTaskResultLink,
  uploadTaskResultFile, deleteTaskResultFile, getTaskResultFileUrl,
  type TaskResultLinkDto, type TaskResultFileDto,
} from "../libs/utils/taskResultApi";
import type { Task } from "../libs/types/task";

interface TaskResultPanelProps {
  task: Task;
  onClose: () => void;
  onShowToast: (message: string) => void;
}

// 백엔드 spring.servlet.multipart.max-file-size(application.yml)와 맞춘다.
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(fileName: string) {
  const ext = (fileName.includes(".") ? fileName.split(".").pop() : "")?.toLowerCase() ?? "";
  if (ext === "json") return FileJson;
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return ImageIcon;
  return FileText;
}

function linkIcon(url: string) {
  if (url.includes("github.com")) return Github;
  if (url.includes("figma.com")) return Figma;
  return Link2;
}

function linkDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

// 작업 내용/링크/첨부파일(Supabase Storage)을 실제로 백엔드에 저장한다. 쓰기는 담당자 본인이거나
// 팀장만 가능하다(백엔드가 403으로도 막지만, 이 패널은 애초에 입력/버튼 자체를 숨겨서 시도조차 못하게 한다).
export function TaskResultPanel({ task, onClose, onShowToast }: TaskResultPanelProps) {
  const { currentProjectId, currentProject, user } = useAuth();
  const projectId = currentProjectId ?? DEMO_PROJECT_ID;
  const isLeader = currentProject?.role === "팀장";
  const isAssignee = user != null && task.assignee === String(user.id);
  const canEdit = isLeader || isAssignee;

  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [content, setContent] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState<TaskResultFileDto[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [links, setLinks] = useState<TaskResultLinkDto[]>([]);
  const [addingLink, setAddingLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [savingLink, setSavingLink] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    fetchTaskResult(task.id, projectId)
      .then((result) => {
        if (cancelled) return;
        setContent(result.content);
        setIsSaved(Boolean(result.updatedAt));
        setLinks(result.links);
        setFiles(result.files);
        setLoadState("ready");
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  const handleSaveContent = async () => {
    if (!content.trim() || saving || !user) return;
    setSaving(true);
    const wasSaved = isSaved;
    try {
      await saveTaskResult(task.id, content, projectId);
      setIsSaved(true);
      onShowToast(wasSaved ? "작업 내용을 수정했습니다." : "작업 내용을 저장했습니다.");
    } catch (e) {
      onShowToast(errorMessage(e, "작업 내용 저장에 실패했습니다."));
    } finally {
      setSaving(false);
    }
  };

  const handleResetContent = () => {
    setContent("");
    setIsSaved(false);
  };

  const uploadFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !user) return;
    setUploadingFile(true);
    try {
      for (const file of Array.from(fileList)) {
        if (file.size > MAX_FILE_SIZE_BYTES) {
          onShowToast(`'${file.name}'은(는) 100MB를 초과해서 업로드할 수 없습니다.`);
          continue;
        }
        try {
          const uploaded = await uploadTaskResultFile(task.id, file, projectId);
          setFiles((cur) => [...cur, uploaded]);
        } catch (e) {
          onShowToast(errorMessage(e, `'${file.name}' 업로드에 실패했습니다.`));
        }
      }
    } finally {
      setUploadingFile(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    void uploadFiles(e.dataTransfer.files);
  };

  const handleRemoveFile = async (id: string) => {
    if (!user) return;
    const prev = files;
    setFiles((cur) => cur.filter((f) => f.id !== id));
    try {
      await deleteTaskResultFile(task.id, id, projectId);
    } catch (e) {
      setFiles(prev);
      onShowToast(errorMessage(e, "파일 삭제에 실패했습니다."));
    }
  };

  const handleOpenFile = async (id: string) => {
    // 클릭 핸들러 안에서 동기적으로 먼저 빈 탭을 열어야 팝업 차단을 안 받는다(URL을 기다리는
    // 동안 await가 끼면 "사용자 제스처" 체인이 끊겨서 브라우저가 새 탭 열기를 막을 수 있음).
    // noopener를 주면 window.open이 항상 null을 반환해 이 탭의 참조를 못 얻으므로(about:blank로
    // 방치됨) 여기서는 뺀다 — 우리가 만든 signed URL만 채워 넣을 거라 노출 위험도 없다.
    const tab = window.open("", "_blank");
    try {
      const url = await getTaskResultFileUrl(task.id, id, projectId);
      if (tab) {
        tab.location.href = url;
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      tab?.close();
      onShowToast(errorMessage(e, "다운로드 링크를 가져오지 못했습니다."));
    }
  };

  const handleAddLink = async () => {
    const url = linkUrl.trim();
    if (!url || savingLink || !user) return;
    setSavingLink(true);
    try {
      const created = await addTaskResultLink(task.id, url, linkTitle.trim(), projectId);
      setLinks((cur) => [...cur, created]);
      setLinkUrl("");
      setLinkTitle("");
      setAddingLink(false);
    } catch (e) {
      onShowToast(errorMessage(e, "링크 추가에 실패했습니다."));
    } finally {
      setSavingLink(false);
    }
  };

  const handleRemoveLink = async (id: string) => {
    if (!user) return;
    const prev = links;
    setLinks((cur) => cur.filter((l) => l.id !== id));
    try {
      await deleteTaskResultLink(task.id, id, projectId);
    } catch (e) {
      setLinks(prev);
      onShowToast(errorMessage(e, "링크 삭제에 실패했습니다."));
    }
  };

  return (
    <div className="w-full h-full bg-card border-l border-border flex flex-col overflow-hidden">
      <div className="p-4 border-b border-border shrink-0 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">작업 내용 작성</div>
          <div className="text-sm font-bold text-foreground leading-snug truncate">{task.title}</div>
        </div>
        <button onClick={onClose} aria-label="닫기" className="shrink-0 p-1.5 hover:bg-muted rounded-lg transition-colors">
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {loadState === "loading" && <div className="p-4 text-xs text-muted-foreground">불러오는 중...</div>}
      {loadState === "error" && <div className="p-4 text-xs text-red-600">작업 내용을 불러오지 못했습니다.</div>}

      {loadState === "ready" && (
        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-5">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-muted-foreground">작업 내용 작성</span>
              {canEdit && (
                <button
                  onClick={handleResetContent}
                  disabled={!content}
                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40"
                >
                  <RotateCcw className="w-3 h-3" />초기화
                </button>
              )}
            </div>
            <textarea
              value={content}
              onChange={(e) => { setContent(e.target.value.slice(0, 2000)); setIsSaved(false); }}
              maxLength={2000}
              rows={10}
              readOnly={!canEdit}
              placeholder={canEdit ? "이번 작업에서 무엇을 했는지 작성해주세요." : "작성된 내용이 없습니다."}
              className={`w-full text-xs rounded-lg border border-border px-3 py-2 outline-none resize-none ${canEdit ? "bg-input-background focus:border-blue-400" : "bg-muted/40 cursor-default"}`}
            />
            {canEdit && (
              <div className="flex items-center justify-between mt-1.5">
                <button
                  onClick={() => void handleSaveContent()}
                  disabled={!content.trim() || saving}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-40 transition-opacity"
                  style={{ background: "var(--primary)" }}
                >
                  {saving ? "저장 중..." : isSaved ? "수정" : "생성"}
                </button>
                <span className="text-[10px] text-muted-foreground">{content.length}/2000</span>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-muted-foreground">첨부파일</span>
              {canEdit && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingFile}
                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg hover:bg-muted transition-colors disabled:opacity-40"
                  style={{ color: "#3B5BDB" }}
                >
                  <Plus className="w-3 h-3" />파일 업로드
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => { void uploadFiles(e.target.files); e.target.value = ""; }}
              />
            </div>
            {canEdit && (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => !uploadingFile && fileInputRef.current?.click()}
                className={`rounded-lg border border-dashed px-3 py-3 text-center text-[10.5px] text-muted-foreground cursor-pointer transition-colors ${dragOver ? "border-blue-400 bg-blue-50" : "border-border"}`}
              >
                {uploadingFile ? "업로드 중..." : "드래그 앤 드롭으로 파일을 추가할 수 있습니다. (파일당 최대 100MB)"}
              </div>
            )}
            {files.length === 0 && !canEdit && (
              <div className="text-[10.5px] text-muted-foreground py-1">첨부된 파일이 없습니다.</div>
            )}
            {files.length > 0 && (
              <div className="mt-2 space-y-1">
                {files.map((f) => {
                  const Icon = fileIcon(f.fileName);
                  return (
                    <div key={f.id} className="group flex items-center gap-2 py-1">
                      <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <button onClick={() => void handleOpenFile(f.id)} className="flex-1 min-w-0 truncate text-xs text-foreground text-left hover:underline">
                        {f.fileName}
                      </button>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{formatFileSize(f.size)}</span>
                      {canEdit && (
                        <button
                          onClick={() => void handleRemoveFile(f.id)}
                          className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity"
                        >
                          <Trash2 className="w-3 h-3 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <div className="text-[11px] font-bold text-muted-foreground mb-1.5">관련 링크</div>
            {links.length === 0 && !canEdit && (
              <div className="text-[10.5px] text-muted-foreground py-1">등록된 링크가 없습니다.</div>
            )}
            {links.length > 0 && (
              <div className="space-y-1 mb-2">
                {links.map((l) => {
                  const Icon = linkIcon(l.url);
                  return (
                    <div key={l.id} className="group flex items-center gap-2 py-1">
                      <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <button onClick={() => window.open(l.url, "_blank", "noopener,noreferrer")} className="flex-1 min-w-0 text-left">
                        <div className="text-xs font-medium text-foreground truncate">{l.title}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{linkDomain(l.url)}</div>
                      </button>
                      {canEdit && (
                        <button
                          onClick={() => void handleRemoveLink(l.id)}
                          className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity"
                        >
                          <Trash2 className="w-3 h-3 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {canEdit && (addingLink ? (
              <div className="space-y-1.5 rounded-lg border border-blue-200 p-2">
                <input
                  autoFocus
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full text-xs rounded-lg border border-border bg-input-background px-2.5 py-1.5 outline-none focus:border-blue-400"
                />
                <input
                  value={linkTitle}
                  onChange={(e) => setLinkTitle(e.target.value)}
                  placeholder="제목 (선택)"
                  onKeyDown={(e) => { if (e.key === "Enter") void handleAddLink(); if (e.key === "Escape") setAddingLink(false); }}
                  className="w-full text-xs rounded-lg border border-border bg-input-background px-2.5 py-1.5 outline-none focus:border-blue-400"
                />
                <div className="flex justify-end gap-1.5">
                  <button onClick={() => setAddingLink(false)} className="text-[10px] font-medium text-muted-foreground px-2 py-1 rounded hover:bg-muted">취소</button>
                  <button
                    onClick={() => void handleAddLink()}
                    disabled={!linkUrl.trim() || savingLink}
                    className="text-[10px] font-semibold text-white px-2 py-1 rounded disabled:opacity-40"
                    style={{ background: "var(--primary)" }}
                  >
                    추가
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingLink(true)}
                className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg hover:bg-muted transition-colors"
                style={{ color: "#3B5BDB" }}
              >
                <Plus className="w-3 h-3" />링크 추가
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
