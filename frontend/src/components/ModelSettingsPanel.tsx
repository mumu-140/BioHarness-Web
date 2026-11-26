import {
  AlertCircle,
  CheckCircle2,
  Database,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  MessageSquare,
  Mic,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { type ApiError, getJson, sendJson } from "../api/client";
import { cn } from "../lib/utils";

interface ProviderItem {
  id: string;
  name: string;
  protocol: "openai-compatible" | "anthropic" | "gemini";
  base_url: string;
  has_api_key: boolean;
  api_key_masked: string;
  models: string[];
  enabled: boolean;
  timeout_seconds: number;
  source: "env" | "user";
  /** Ephemeral browser-only input; never returned by server. */
  draft_api_key?: string;
  clear_api_key?: boolean;
}

interface SlotsState {
  chat: {
    provider_id: string | null;
    model: string;
    temperature: number | null;
    max_tokens: number | null;
  };
  vision: {
    provider_id: string | null;
    model: string;
    image_size: string;
  };
  speech: {
    provider_id: string | null;
    asr_model: string;
    tts_model: string;
    voice: string;
  };
  embedding: {
    provider_id: string | null;
    model: string;
    dimensions: number | null;
  };
}

interface PresetItem {
  id: string;
  name: string;
  protocol: "openai-compatible" | "anthropic" | "gemini";
  base_url: string;
  hint: string;
}

interface ModelConfigResponse {
  editable: boolean;
  runtime_enabled: boolean;
  active_chat_model: string | null;
  applied_chat?: boolean;
  providers: ProviderItem[];
  slots: SlotsState;
  presets: PresetItem[];
}

interface FetchModelsResult {
  ok: boolean;
  models: string[];
  latency_ms: number;
  error: string | null;
}

const EMPTY_SLOTS: SlotsState = {
  chat: { provider_id: null, model: "", temperature: null, max_tokens: null },
  vision: { provider_id: null, model: "", image_size: "1024x1024" },
  speech: { provider_id: null, asr_model: "", tts_model: "", voice: "alloy" },
  embedding: { provider_id: null, model: "", dimensions: null },
};

function ModelPickerField({
  id,
  label,
  value,
  models,
  placeholder,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  models: string[];
  placeholder: string;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const listId = `${id}-datalist`;
  return (
    <label className="grid gap-1 text-[11px] font-medium text-slate-600">
      <span>{label}</span>
      <input
        id={id}
        list={models.length > 0 ? listId : undefined}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 focus:outline-none"
      />
      {models.length > 0 && (
        <datalist id={listId}>
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      )}
    </label>
  );
}

export default function ModelSettingsPanel() {
  const { mutate } = useSWRConfig();
  const { data, error, isLoading, mutate: reload } = useSWR<ModelConfigResponse, ApiError>(
    "/api/settings/models",
    getJson,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [slots, setSlots] = useState<SlotsState>(EMPTY_SLOTS);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [modelFilter, setModelFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [fetchFeedback, setFetchFeedback] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    setProviders(data.providers.map((p) => ({ ...p, draft_api_key: "", clear_api_key: false })));
    setSlots({
      chat: { ...EMPTY_SLOTS.chat, ...(data.slots?.chat ?? {}) },
      vision: { ...EMPTY_SLOTS.vision, ...(data.slots?.vision ?? {}) },
      speech: { ...EMPTY_SLOTS.speech, ...(data.slots?.speech ?? {}) },
      embedding: { ...EMPTY_SLOTS.embedding, ...(data.slots?.embedding ?? {}) },
    });
    setSelectedProviderId((prev) =>
      prev && data.providers.some((p) => p.id === prev) ? prev : (data.providers[0]?.id ?? null),
    );
  }, [data]);

  const editable = data?.editable ?? false;
  const selectedProvider = providers.find((p) => p.id === selectedProviderId) ?? null;

  function modelsFor(providerId: string | null): string[] {
    if (!providerId) return [];
    return providers.find((p) => p.id === providerId)?.models ?? [];
  }

  function updateProvider(id: string, patch: Partial<ProviderItem>) {
    setProviders((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setStatus(null);
  }

  function addProviderFromPreset(preset?: PresetItem) {
    const baseId = preset?.id ?? "custom";
    let candidate = baseId;
    let i = 2;
    while (providers.some((p) => p.id === candidate)) {
      candidate = `${baseId}-${i++}`;
    }
    const next: ProviderItem = {
      id: candidate,
      name: preset?.name ?? "自定义服务商",
      protocol: preset?.protocol ?? "openai-compatible",
      base_url: preset?.base_url ?? "https://api.openai.com/v1",
      has_api_key: false,
      api_key_masked: "",
      models: [],
      enabled: true,
      timeout_seconds: 300,
      source: "user",
      draft_api_key: "",
      clear_api_key: false,
    };
    setProviders((list) => [...list, next]);
    setSelectedProviderId(next.id);
    setStatus(null);
  }

  function removeProvider(id: string) {
    setProviders((list) => {
      const next = list.filter((p) => p.id !== id);
      if (selectedProviderId === id) {
        setSelectedProviderId(next[0]?.id ?? null);
      }
      return next;
    });
    setSlots((s) => ({
      chat: s.chat.provider_id === id ? { ...s.chat, provider_id: null } : s.chat,
      vision: s.vision.provider_id === id ? { ...s.vision, provider_id: null } : s.vision,
      speech: s.speech.provider_id === id ? { ...s.speech, provider_id: null } : s.speech,
      embedding: s.embedding.provider_id === id ? { ...s.embedding, provider_id: null } : s.embedding,
    }));
    setStatus(null);
  }

  async function handleFetchModels(provider: ProviderItem) {
    setFetchingId(provider.id);
    setFetchFeedback((prev) => ({ ...prev, [provider.id]: { ok: true, text: "正在探测 /models…" } }));
    try {
      const res = await sendJson<FetchModelsResult>("POST", "/api/settings/models/fetch-models", {
        provider_id: provider.id,
        base_url: provider.base_url,
        api_key: provider.draft_api_key?.trim() ? provider.draft_api_key.trim() : null,
      });
      if (res.ok) {
        updateProvider(provider.id, {
          models: Array.from(new Set([...res.models, ...provider.models])).sort(),
        });
        setFetchFeedback((prev) => ({
          ...prev,
          [provider.id]: {
            ok: true,
            text: `拉取成功 · ${res.models.length} 个模型（${res.latency_ms} ms）`,
          },
        }));
      } else {
        setFetchFeedback((prev) => ({
          ...prev,
          [provider.id]: { ok: false, text: res.error ?? "拉取失败" },
        }));
      }
    } catch (err) {
      const apiErr = err as ApiError;
      setFetchFeedback((prev) => ({
        ...prev,
        [provider.id]: { ok: false, text: apiErr.message ?? "请求失败" },
      }));
    } finally {
      setFetchingId(null);
    }
  }

  async function handleSave() {
    setSaving(true);
    setStatus(null);
    try {
      const payload = {
        providers: providers.map((p) => ({
          id: p.id,
          name: p.name,
          protocol: p.protocol,
          base_url: p.base_url,
          api_key: p.draft_api_key?.trim() ? p.draft_api_key.trim() : null,
          clear_api_key: Boolean(p.clear_api_key),
          models: p.models,
          enabled: p.enabled,
          timeout_seconds: p.timeout_seconds,
        })),
        slots,
      };
      const updated = await sendJson<ModelConfigResponse>("PUT", "/api/settings/models", payload);
      await reload(updated, { revalidate: false });
      await mutate("/api/meta");
      setStatus({
        kind: "ok",
        text: updated.applied_chat
          ? `配置已保存，主对话模型已热切换为 ${updated.active_chat_model ?? "新配置"}。`
          : "配置已原子持久化到服务端（0600 权限）。",
      });
    } catch (err) {
      const apiErr = err as ApiError;
      setStatus({ kind: "err", text: apiErr.message ?? "保存失败" });
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    setStatus(null);
    try {
      const resetRes = await sendJson<ModelConfigResponse>("POST", "/api/settings/models/reset", {});
      await reload(resetRes, { revalidate: false });
      await mutate("/api/meta");
      setStatus({ kind: "ok", text: "已恢复为服务端环境变量默认模型配置。" });
    } catch (err) {
      const apiErr = err as ApiError;
      setStatus({ kind: "err", text: apiErr.message ?? "重置失败" });
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-xs text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin text-teal-700" aria-hidden="true" />
        正在读取服务端模型配置…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
        无法读取模型配置接口（{error?.code ?? "UNAVAILABLE"}）：{error?.message ?? "请稍后重试"}
      </div>
    );
  }

  const filteredModels = (selectedProvider?.models ?? []).filter((m) =>
    !modelFilter.trim() ? true : m.toLowerCase().includes(modelFilter.trim().toLowerCase()),
  );

  return (
    <div className="max-w-5xl space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">多模态模型与服务商配置</h3>
            <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-800">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              当前主模型：{data.active_chat_model ?? "未配置"}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">
            服务商连接与能力槽位完全解耦；API 密钥以 0600 权限保存在服务端，永不回显明文。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!editable || saving}
            onClick={() => void handleReset()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            恢复默认
          </button>
          <button
            type="button"
            disabled={!editable || saving}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-1.5 text-xs font-medium text-white shadow-xs transition hover:bg-teal-800 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            保存并生效
          </button>
        </div>
      </div>

      {!editable && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs text-amber-950">
          当前服务未启用可写状态目录（只读模式），模型配置仅供查看。
        </div>
      )}

      {status && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium",
            status.kind === "ok"
              ? "border-teal-200 bg-teal-50 text-teal-900"
              : "border-red-200 bg-red-50 text-red-800",
          )}
        >
          {status.kind === "ok" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
          )}
          <span>{status.text}</span>
        </div>
      )}

      {/* Section 1: Atomic Capability Slots */}
      <section aria-label="按能力分类的原子槽位" className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
            1. 能力槽位绑定（原子化分类）
          </h4>
          <span className="text-[11px] text-slate-500">
            每个模态独立绑定服务商、模型与参数，互不干扰
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
          {/* Chat / Reasoning */}
          <div className="rounded-xl border border-teal-200/90 bg-white p-4 shadow-2xs">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-900">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                </span>
                对话与推理（Chat / Reasoning）
              </span>
              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-800">
                运行时实时生效
              </span>
            </div>
            <div className="space-y-2.5">
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                服务商
                <select
                  disabled={!editable}
                  value={slots.chat.provider_id ?? ""}
                  onChange={(e) =>
                    setSlots((s) => ({
                      ...s,
                      chat: { ...s.chat, provider_id: e.target.value || null },
                    }))
                  }
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                >
                  <option value="">未绑定</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.id})
                    </option>
                  ))}
                </select>
              </label>
              <ModelPickerField
                id="slot-chat-model"
                label="主模型 ID"
                value={slots.chat.model}
                models={modelsFor(slots.chat.provider_id)}
                placeholder="如 auto/deepseek-v4.1-flash 或从下拉选择"
                disabled={!editable}
                onChange={(v) => setSlots((s) => ({ ...s, chat: { ...s.chat, model: v } }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                  温度 (Temperature)
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    disabled={!editable}
                    placeholder="默认"
                    value={slots.chat.temperature ?? ""}
                    onChange={(e) =>
                      setSlots((s) => ({
                        ...s,
                        chat: {
                          ...s.chat,
                          temperature: e.target.value === "" ? null : Number(e.target.value),
                        },
                      }))
                    }
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                  />
                </label>
                <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                  最大输出 (Max Tokens)
                  <input
                    type="number"
                    step="256"
                    min="64"
                    max="200000"
                    disabled={!editable}
                    placeholder="默认"
                    value={slots.chat.max_tokens ?? ""}
                    onChange={(e) =>
                      setSlots((s) => ({
                        ...s,
                        chat: {
                          ...s.chat,
                          max_tokens: e.target.value === "" ? null : Number(e.target.value),
                        },
                      }))
                    }
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Vision / Image */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-900">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
                  <ImageIcon className="h-4 w-4" aria-hidden="true" />
                </span>
                图像理解与生成（Vision / Image）
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                {slots.vision.model ? "已配置 · 待图像链调用" : "未配置"}
              </span>
            </div>
            <div className="space-y-2.5">
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                服务商
                <select
                  disabled={!editable}
                  value={slots.vision.provider_id ?? ""}
                  onChange={(e) =>
                    setSlots((s) => ({
                      ...s,
                      vision: { ...s.vision, provider_id: e.target.value || null },
                    }))
                  }
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                >
                  <option value="">未绑定</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.id})
                    </option>
                  ))}
                </select>
              </label>
              <ModelPickerField
                id="slot-vision-model"
                label="图像模型 ID"
                value={slots.vision.model}
                models={modelsFor(slots.vision.provider_id)}
                placeholder="如 gpt-4o / gemini-2.5-pro / gpt-image-1"
                disabled={!editable}
                onChange={(v) => setSlots((s) => ({ ...s, vision: { ...s.vision, model: v } }))}
              />
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                默认图像尺寸
                <select
                  disabled={!editable}
                  value={slots.vision.image_size}
                  onChange={(e) =>
                    setSlots((s) => ({ ...s, vision: { ...s.vision, image_size: e.target.value } }))
                  }
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                >
                  <option value="1024x1024">1024 × 1024（标准方形）</option>
                  <option value="1536x1024">1536 × 1024（科研宽幅图表）</option>
                  <option value="1024x1536">1024 × 1536（纵向排版）</option>
                </select>
              </label>
            </div>
          </div>

          {/* Speech ASR / TTS */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-900">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                  <Mic className="h-4 w-4" aria-hidden="true" />
                </span>
                语音输入与播报（Speech ASR / TTS）
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                {slots.speech.asr_model || slots.speech.tts_model ? "已配置 · 待语音链调用" : "未配置"}
              </span>
            </div>
            <div className="space-y-2.5">
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                服务商
                <select
                  disabled={!editable}
                  value={slots.speech.provider_id ?? ""}
                  onChange={(e) =>
                    setSlots((s) => ({
                      ...s,
                      speech: { ...s.speech, provider_id: e.target.value || null },
                    }))
                  }
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                >
                  <option value="">未绑定</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.id})
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <ModelPickerField
                  id="slot-speech-asr"
                  label="语音转写 (ASR)"
                  value={slots.speech.asr_model}
                  models={modelsFor(slots.speech.provider_id)}
                  placeholder="如 whisper-1"
                  disabled={!editable}
                  onChange={(v) => setSlots((s) => ({ ...s, speech: { ...s.speech, asr_model: v } }))}
                />
                <ModelPickerField
                  id="slot-speech-tts"
                  label="语音合成 (TTS)"
                  value={slots.speech.tts_model}
                  models={modelsFor(slots.speech.provider_id)}
                  placeholder="如 tts-1"
                  disabled={!editable}
                  onChange={(v) => setSlots((s) => ({ ...s, speech: { ...s.speech, tts_model: v } }))}
                />
              </div>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                默认音色 (Voice)
                <input
                  value={slots.speech.voice}
                  disabled={!editable}
                  placeholder="alloy / nova / shimmer"
                  onChange={(e) =>
                    setSlots((s) => ({ ...s, speech: { ...s.speech, voice: e.target.value } }))
                  }
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                />
              </label>
            </div>
          </div>

          {/* Embedding */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-900">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                  <Database className="h-4 w-4" aria-hidden="true" />
                </span>
                向量检索（Embedding）
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                {slots.embedding.model ? "已配置 · 待向量索引调用" : "未配置"}
              </span>
            </div>
            <div className="space-y-2.5">
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                服务商
                <select
                  disabled={!editable}
                  value={slots.embedding.provider_id ?? ""}
                  onChange={(e) =>
                    setSlots((s) => ({
                      ...s,
                      embedding: { ...s.embedding, provider_id: e.target.value || null },
                    }))
                  }
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                >
                  <option value="">未绑定</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.id})
                    </option>
                  ))}
                </select>
              </label>
              <ModelPickerField
                id="slot-embedding-model"
                label="Embedding 模型 ID"
                value={slots.embedding.model}
                models={modelsFor(slots.embedding.provider_id)}
                placeholder="如 text-embedding-3-large / bge-m3"
                disabled={!editable}
                onChange={(v) =>
                  setSlots((s) => ({ ...s, embedding: { ...s.embedding, model: v } }))
                }
              />
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                向量维度 (Dimensions)
                <input
                  type="number"
                  step="64"
                  min="64"
                  max="8192"
                  disabled={!editable}
                  placeholder="默认（如 1536 / 3072）"
                  value={slots.embedding.dimensions ?? ""}
                  onChange={(e) =>
                    setSlots((s) => ({
                      ...s,
                      embedding: {
                        ...s.embedding,
                        dimensions: e.target.value === "" ? null : Number(e.target.value),
                      },
                    }))
                  }
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                />
              </label>
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Providers & /v1/models Discovery */}
      <section aria-label="服务商连接与模型列表" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
            2. 服务商连接与模型探测（支持一键拉取 /v1/models）
          </h4>
          <div className="flex flex-wrap items-center gap-1.5">
            {data.presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                disabled={!editable}
                onClick={() => addProviderFromPreset(preset)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-900"
                title={preset.hint}
              >
                <Plus className="h-3 w-3 text-teal-700" aria-hidden="true" />
                {preset.name}
              </button>
            ))}
            <button
              type="button"
              disabled={!editable}
              onClick={() => addProviderFromPreset()}
              className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-teal-400 hover:bg-teal-50"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              自定义
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Provider list */}
          <div className="space-y-2 lg:col-span-4">
            {providers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
                暂无服务商，请点击上方预设快速添加。
              </div>
            ) : (
              providers.map((p) => {
                const active = p.id === selectedProviderId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedProviderId(p.id);
                      setModelFilter("");
                    }}
                    className={cn(
                      "flex w-full items-start justify-between gap-2 rounded-xl border p-3 text-left transition",
                      active
                        ? "border-teal-500 bg-teal-50/60 shadow-2xs"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Server
                          className={cn("h-3.5 w-3.5 shrink-0", active ? "text-teal-700" : "text-slate-400")}
                          aria-hidden="true"
                        />
                        <span className="truncate text-xs font-semibold text-slate-900">{p.name}</span>
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
                        {p.base_url}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                          {p.models.length} 模型
                        </span>
                        {p.has_api_key && (
                          <span className="rounded bg-teal-100/80 px-1.5 py-0.5 text-[10px] text-teal-800">
                            密钥已存
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "mt-1 h-2 w-2 shrink-0 rounded-full",
                        p.enabled ? "bg-emerald-500" : "bg-slate-300",
                      )}
                      title={p.enabled ? "已启用" : "已停用"}
                    />
                  </button>
                );
              })
            )}
          </div>

          {/* Provider editor */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs lg:col-span-8">
            {!selectedProvider ? (
              <p className="py-8 text-center text-xs text-slate-500">
                请在左侧选择一个服务商进行编辑或拉取模型列表。
              </p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {selectedProvider.name}
                    </div>
                    <div className="font-mono text-[11px] text-slate-500">
                      ID: {selectedProvider.id} · {selectedProvider.protocol}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        disabled={!editable}
                        checked={selectedProvider.enabled}
                        onChange={(e) =>
                          updateProvider(selectedProvider.id, { enabled: e.target.checked })
                        }
                      />
                      启用
                    </label>
                    <button
                      type="button"
                      disabled={!editable}
                      onClick={() => removeProvider(selectedProvider.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                      删除
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                    服务商名称
                    <input
                      value={selectedProvider.name}
                      disabled={!editable}
                      onChange={(e) => updateProvider(selectedProvider.id, { name: e.target.value })}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                    />
                  </label>
                  <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                    协议类型
                    <select
                      value={selectedProvider.protocol}
                      disabled={!editable}
                      onChange={(e) =>
                        updateProvider(selectedProvider.id, {
                          protocol: e.target.value as ProviderItem["protocol"],
                        })
                      }
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                    >
                      <option value="openai-compatible">OpenAI Compatible (/v1)</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="gemini">Google Gemini</option>
                    </select>
                  </label>
                </div>

                <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                  API Base URL
                  <input
                    value={selectedProvider.base_url}
                    disabled={!editable}
                    placeholder="https://api.openai.com/v1"
                    onChange={(e) =>
                      updateProvider(selectedProvider.id, { base_url: e.target.value })
                    }
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
                  />
                </label>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="grid gap-1 text-[11px] font-medium text-slate-600 sm:col-span-2">
                    <span className="inline-flex items-center gap-1">
                      <KeyRound className="h-3 w-3 text-slate-400" aria-hidden="true" />
                      API Key
                      {selectedProvider.has_api_key && (
                        <span className="font-mono text-[10px] text-teal-700">
                          （已存 {selectedProvider.api_key_masked}）
                        </span>
                      )}
                    </span>
                    <input
                      type="password"
                      autoComplete="off"
                      disabled={!editable}
                      value={selectedProvider.draft_api_key ?? ""}
                      placeholder={
                        selectedProvider.has_api_key
                          ? "留空保持服务端原密钥不变，输入新密钥则覆盖"
                          : "输入 API Key（仅存服务端）"
                      }
                      onChange={(e) =>
                        updateProvider(selectedProvider.id, {
                          draft_api_key: e.target.value,
                          clear_api_key: false,
                        })
                      }
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
                    />
                  </label>

                  <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                    请求超时 (秒)
                    <input
                      type="number"
                      min="5"
                      max="3600"
                      disabled={!editable}
                      value={selectedProvider.timeout_seconds}
                      onChange={(e) =>
                        updateProvider(selectedProvider.id, {
                          timeout_seconds: Number(e.target.value) || 300,
                        })
                      }
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                    />
                  </label>
                </div>

                {/* Fetch Models Bar */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-medium text-slate-800">
                      可用模型列表（{selectedProvider.models.length}）
                    </div>
                    <button
                      type="button"
                      disabled={fetchingId === selectedProvider.id}
                      onClick={() => void handleFetchModels(selectedProvider)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-teal-600 bg-white px-3 py-1 text-xs font-medium text-teal-800 transition hover:bg-teal-50 disabled:opacity-50"
                    >
                      {fetchingId === selectedProvider.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      测试连接并拉取模型
                    </button>
                  </div>

                  {fetchFeedback[selectedProvider.id] && (
                    <p
                      className={cn(
                        "mt-2 text-[11px] font-medium",
                        fetchFeedback[selectedProvider.id].ok ? "text-teal-800" : "text-red-700",
                      )}
                    >
                      {fetchFeedback[selectedProvider.id].text}
                    </p>
                  )}

                  {selectedProvider.models.length > 0 && (
                    <div className="mt-2.5 space-y-2">
                      <input
                        type="search"
                        value={modelFilter}
                        onChange={(e) => setModelFilter(e.target.value)}
                        placeholder="筛选已拉取的模型（点击即可设为主对话模型）…"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-900"
                      />
                      <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
                        {filteredModels.map((modelId) => {
                          const isCurrentChat =
                            slots.chat.provider_id === selectedProvider.id &&
                            slots.chat.model === modelId;
                          return (
                            <button
                              key={modelId}
                              type="button"
                              disabled={!editable}
                              onClick={() =>
                                setSlots((s) => ({
                                  ...s,
                                  chat: {
                                    ...s.chat,
                                    provider_id: selectedProvider.id,
                                    model: modelId,
                                  },
                                }))
                              }
                              title="点击将此模型绑定到主对话槽位"
                              className={cn(
                                "rounded-md border px-2 py-0.5 font-mono text-[11px] transition",
                                isCurrentChat
                                  ? "border-teal-600 bg-teal-700 text-white"
                                  : "border-slate-200 bg-white text-slate-700 hover:border-teal-400 hover:bg-teal-50",
                              )}
                            >
                              {modelId}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
