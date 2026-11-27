/**
 * BioHarness R2 Model Configuration Center seated inside LibreChat's adopted Settings dialog
 * (not upstream LibreChat code).
 *
 * Preserves masked API-key custody (plaintext keys are ephemeral input only, never read back or
 * written to browser storage), server-side `/v1/models` discovery, atomic slot updates, reset,
 * and clear provider error reporting.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import { Button, Input, SecretInput, Spinner } from '@librechat/client';
import type {
  ModelConfigResponse,
  PresetItem,
  ProviderItem,
  SlotsState,
} from './bioharness';
import {
  BioHarnessApiError,
  bhKeys,
  fetchModelConfig,
  fetchRemoteModels,
  resetModelConfig,
  saveModelConfig,
} from './bioharness';
import { useBioHarnessWorkspace } from './workspace';

type EditableProvider = ProviderItem & {
  draft_api_key: string;
  clear_api_key: boolean;
};

const EMPTY_SLOTS: SlotsState = {
  chat: { provider_id: null, model: '', temperature: null, max_tokens: null },
  vision: { provider_id: null, model: '', image_size: '1024x1024' },
  speech: { provider_id: null, asr_model: '', tts_model: '', voice: 'alloy' },
  embedding: { provider_id: null, model: '', dimensions: null },
};

export default function BioHarnessModelsSettings() {
  const queryClient = useQueryClient();
  const { service } = useBioHarnessWorkspace();
  const serviceKey = service ?? 'default';

  const configQuery = useQuery<ModelConfigResponse>({
    queryKey: bhKeys.models(serviceKey),
    queryFn: fetchModelConfig,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const [providers, setProviders] = useState<EditableProvider[]>([]);
  const [slots, setSlots] = useState<SlotsState>(EMPTY_SLOTS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [fetchInfo, setFetchInfo] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const data = configQuery.data;
    if (!data) {
      return;
    }
    setProviders(
      data.providers.map((item) => ({
        ...item,
        draft_api_key: '',
        clear_api_key: false,
      })),
    );
    setSlots({
      chat: { ...EMPTY_SLOTS.chat, ...(data.slots?.chat ?? {}) },
      vision: { ...EMPTY_SLOTS.vision, ...(data.slots?.vision ?? {}) },
      speech: { ...EMPTY_SLOTS.speech, ...(data.slots?.speech ?? {}) },
      embedding: { ...EMPTY_SLOTS.embedding, ...(data.slots?.embedding ?? {}) },
    });
    setSelectedId((prev) =>
      prev && data.providers.some((p) => p.id === prev) ? prev : (data.providers[0]?.id ?? null),
    );
  }, [configQuery.data]);

  const data = configQuery.data;
  const editable = data?.editable === true;
  const selected = providers.find((p) => p.id === selectedId) ?? null;

  const updateProvider = (id: string, patch: Partial<EditableProvider>) => {
    setProviders((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setBanner(null);
  };

  const addProvider = (preset?: PresetItem) => {
    const baseId = preset?.id ?? 'custom';
    let candidate = baseId;
    let i = 2;
    while (providers.some((p) => p.id === candidate)) {
      candidate = `${baseId}-${i++}`;
    }
    const created: EditableProvider = {
      id: candidate,
      name: preset?.name ?? 'Custom Provider',
      protocol: preset?.protocol ?? 'openai-compatible',
      base_url: preset?.base_url ?? 'https://api.openai.com/v1',
      has_api_key: false,
      api_key_masked: '',
      models: [],
      enabled: true,
      timeout_seconds: 300,
      source: 'user',
      draft_api_key: '',
      clear_api_key: false,
    };
    setProviders((list) => [...list, created]);
    setSelectedId(created.id);
    setBanner(null);
  };

  const removeProvider = (id: string) => {
    setProviders((list) => {
      const next = list.filter((p) => p.id !== id);
      if (selectedId === id) {
        setSelectedId(next[0]?.id ?? null);
      }
      return next;
    });
    setSlots((s) => ({
      chat: s.chat.provider_id === id ? { ...s.chat, provider_id: null } : s.chat,
      vision: s.vision.provider_id === id ? { ...s.vision, provider_id: null } : s.vision,
      speech: s.speech.provider_id === id ? { ...s.speech, provider_id: null } : s.speech,
      embedding: s.embedding.provider_id === id ? { ...s.embedding, provider_id: null } : s.embedding,
    }));
    setBanner(null);
  };

  const handleFetchModels = async (provider: EditableProvider) => {
    setFetchingId(provider.id);
    setFetchInfo((prev) => ({ ...prev, [provider.id]: { ok: true, text: 'Discovering models…' } }));
    try {
      const res = await fetchRemoteModels({
        provider_id: provider.id,
        base_url: provider.base_url,
        api_key: provider.draft_api_key.trim() ? provider.draft_api_key.trim() : null,
      });
      if (res.ok) {
        const merged = Array.from(new Set([...res.models, ...provider.models])).sort();
        updateProvider(provider.id, { models: merged });
        setFetchInfo((prev) => ({
          ...prev,
          [provider.id]: {
            ok: true,
            text: `Discovered ${res.models.length} model(s) in ${res.latency_ms} ms`,
          },
        }));
      } else {
        setFetchInfo((prev) => ({
          ...prev,
          [provider.id]: { ok: false, text: res.error || 'Model discovery failed' },
        }));
      }
    } catch (err) {
      const msg =
        err instanceof BioHarnessApiError
          ? `${err.code}: ${err.message}`
          : (err as Error)?.message || 'Model discovery failed';
      setFetchInfo((prev) => ({ ...prev, [provider.id]: { ok: false, text: msg } }));
    } finally {
      setFetchingId(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setBanner(null);
    try {
      const saved = await saveModelConfig({
        providers: providers.map((p) => ({
          id: p.id,
          name: p.name,
          protocol: p.protocol,
          base_url: p.base_url,
          api_key: p.draft_api_key.trim() ? p.draft_api_key.trim() : null,
          clear_api_key: p.clear_api_key,
          models: p.models,
          enabled: p.enabled,
          timeout_seconds: p.timeout_seconds,
        })),
        slots,
      });
      queryClient.setQueryData(bhKeys.models(serviceKey), saved);
      void queryClient.invalidateQueries({ queryKey: bhKeys.meta() });
      setBanner({
        ok: true,
        text: saved.applied_chat
          ? `Saved and applied active chat model: ${saved.active_chat_model ?? 'updated'}`
          : 'Model configuration saved.',
      });
    } catch (err) {
      const msg =
        err instanceof BioHarnessApiError
          ? `${err.code}: ${err.message}`
          : (err as Error)?.message || 'Save failed';
      setBanner({ ok: false, text: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setBanner(null);
    try {
      const reset = await resetModelConfig();
      queryClient.setQueryData(bhKeys.models(serviceKey), reset);
      void queryClient.invalidateQueries({ queryKey: bhKeys.meta() });
      setBanner({ ok: true, text: 'Reset to environment defaults.' });
    } catch (err) {
      const msg =
        err instanceof BioHarnessApiError
          ? `${err.code}: ${err.message}`
          : (err as Error)?.message || 'Reset failed';
      setBanner({ ok: false, text: msg });
    } finally {
      setSaving(false);
    }
  };

  if (configQuery.isLoading) {
    return (
      <div className="text-text-secondary flex items-center gap-2 py-4 text-sm">
        <Spinner className="h-4 w-4" />
        <span>Loading model configuration…</span>
      </div>
    );
  }

  if (configQuery.isError || !data) {
    return (
      <div className="text-text-destructive flex items-center gap-2 py-2 text-sm" role="alert">
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          {(configQuery.error as Error)?.message || 'Could not load model configuration.'}
        </span>
      </div>
    );
  }

  const chatModels =
    providers.find((p) => p.id === slots.chat.provider_id)?.models ?? [];

  return (
    <div className="space-y-4 text-sm" data-testid="bh-models-settings">
      {/* Status summary */}
      <div className="border-border-light bg-surface-primary/60 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-xs">
        <div>
          <span className="text-text-secondary">Active chat model: </span>
          <strong className="text-text-primary font-mono" data-testid="bh-models-active-chat">
            {data.active_chat_model || 'None'}
          </strong>
          {!editable && (
            <span className="text-text-tertiary ms-2">(Read-only: no writable config path)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="bh-reset-models-btn"
            disabled={!editable || saving}
            onClick={() => void handleReset()}
            className="gap-1.5 text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Reset</span>
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="bh-save-models-btn"
            disabled={!editable || saving}
            onClick={() => void handleSave()}
            className="gap-1.5 text-xs"
          >
            {saving ? <Spinner className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />}
            <span>Save configuration</span>
          </Button>
        </div>
      </div>

      {banner && (
        <div
          role={banner.ok ? 'status' : 'alert'}
          data-testid="bh-models-banner"
          className={
            banner.ok
              ? 'border-status-success-border bg-status-success-subtle text-text-primary flex items-center gap-2 rounded-lg border px-3 py-2 text-xs'
              : 'border-status-error-border bg-status-error-subtle text-text-primary flex items-center gap-2 rounded-lg border px-3 py-2 text-xs'
          }
        >
          {banner.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>{banner.text}</span>
        </div>
      )}

      {/* Providers list + detail */}
      <div className="grid gap-3 md:grid-cols-[200px_1fr]">
        <div className="border-border-light space-y-2 rounded-xl border p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-text-secondary text-xs font-semibold">Providers</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="bh-add-provider-btn"
              disabled={!editable}
              onClick={() => addProvider()}
              className="h-7 gap-1 px-2 text-xs"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              <span>Add</span>
            </Button>
          </div>

          <ul className="space-y-1">
            {providers.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  data-testid={`bh-provider-tab-${p.id}`}
                  onClick={() => setSelectedId(p.id)}
                  className={
                    selectedId === p.id
                      ? 'bg-surface-active-alt text-text-primary flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-start text-xs font-medium'
                      : 'hover:bg-surface-hover text-text-secondary flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-start text-xs'
                  }
                >
                  <span className="truncate">{p.name}</span>
                  {p.has_api_key && <KeyRound className="h-3 w-3 shrink-0 opacity-70" aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>

          {editable && data.presets.length > 0 && (
            <div className="border-border-light border-t pt-2">
              <div className="text-text-tertiary mb-1 text-[11px]">Presets</div>
              <div className="flex flex-wrap gap-1">
                {data.presets.slice(0, 6).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => addProvider(preset)}
                    className="border-border-medium hover:bg-surface-hover rounded border px-1.5 py-0.5 text-[11px]"
                  >
                    + {preset.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Selected provider editor */}
        <div className="border-border-light space-y-3 rounded-xl border p-3">
          {!selected ? (
            <p className="text-text-secondary text-xs">Select or add a provider.</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-primary font-mono text-xs font-semibold">
                  {selected.id} ({selected.source})
                </span>
                {editable && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => removeProvider(selected.id)}
                    className="h-7 gap-1 px-2 text-xs"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                    <span>Remove</span>
                  </Button>
                )}
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2">
                <label className="grid gap-1 text-xs">
                  <span className="text-text-secondary">Display name</span>
                  <Input
                    value={selected.name}
                    disabled={!editable}
                    onChange={(e) => updateProvider(selected.id, { name: e.target.value })}
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-text-secondary">Protocol</span>
                  <select
                    value={selected.protocol}
                    disabled={!editable}
                    onChange={(e) =>
                      updateProvider(selected.id, {
                        protocol: e.target.value as EditableProvider['protocol'],
                      })
                    }
                    className="border-border-medium bg-surface-primary text-text-primary h-10 rounded-lg border px-2.5 text-xs"
                  >
                    <option value="openai-compatible">openai-compatible</option>
                    <option value="anthropic">anthropic</option>
                    <option value="gemini">gemini</option>
                  </select>
                </label>
              </div>

              <label className="grid gap-1 text-xs">
                <span className="text-text-secondary">Base URL</span>
                <Input
                  data-testid="bh-provider-base-url"
                  value={selected.base_url}
                  disabled={!editable}
                  onChange={(e) => updateProvider(selected.id, { base_url: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                />
              </label>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-secondary">API Key (stored server-side only)</span>
                  <span
                    className="text-text-tertiary font-mono text-[11px]"
                    data-testid="bh-provider-masked-key"
                  >
                    {selected.clear_api_key
                      ? 'Will clear saved key'
                      : selected.has_api_key
                        ? `Saved: ${selected.api_key_masked}`
                        : 'Not set'}
                  </span>
                </div>
                <SecretInput
                  aria-label="New API key"
                  data-testid="bh-provider-api-key-input"
                  value={selected.draft_api_key}
                  disabled={!editable}
                  placeholder={selected.has_api_key ? 'Leave blank to keep saved key' : 'Enter API key'}
                  onChange={(e) =>
                    updateProvider(selected.id, {
                      draft_api_key: e.target.value,
                      clear_api_key: false,
                    })
                  }
                />
                {editable && selected.has_api_key && (
                  <label className="text-text-secondary inline-flex items-center gap-1.5 text-[11px]">
                    <input
                      type="checkbox"
                      checked={selected.clear_api_key}
                      onChange={(e) =>
                        updateProvider(selected.id, {
                          clear_api_key: e.target.checked,
                          draft_api_key: e.target.checked ? '' : selected.draft_api_key,
                        })
                      }
                    />
                    <span>Clear stored API key on save</span>
                  </label>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="bh-fetch-models-btn"
                  disabled={fetchingId === selected.id}
                  onClick={() => void handleFetchModels(selected)}
                  className="gap-1.5 text-xs"
                >
                  {fetchingId === selected.id ? (
                    <Spinner className="h-3.5 w-3.5" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span>Fetch models</span>
                </Button>
                {fetchInfo[selected.id] && (
                  <span
                    data-testid="bh-fetch-models-status"
                    className={
                      fetchInfo[selected.id].ok
                        ? 'text-text-secondary text-xs'
                        : 'text-text-destructive text-xs'
                    }
                  >
                    {fetchInfo[selected.id].text}
                  </span>
                )}
              </div>

              {selected.models.length > 0 && (
                <div className="text-text-secondary text-[11px]" data-testid="bh-discovered-models">
                  Available models ({selected.models.length}):{' '}
                  <span className="font-mono">{selected.models.slice(0, 8).join(', ')}</span>
                  {selected.models.length > 8 ? '…' : ''}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Atomic Chat Slot Assignment */}
      <div className="border-border-light space-y-2.5 rounded-xl border p-3">
        <div className="text-text-primary text-xs font-semibold">Primary Chat Model Slot</div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <label className="grid gap-1 text-xs">
            <span className="text-text-secondary">Provider</span>
            <select
              aria-label="Chat slot provider"
              data-testid="bh-chat-slot-provider"
              value={slots.chat.provider_id ?? ''}
              disabled={!editable}
              onChange={(e) =>
                setSlots((s) => ({
                  ...s,
                  chat: { ...s.chat, provider_id: e.target.value || null },
                }))
              }
              className="border-border-medium bg-surface-primary text-text-primary h-10 rounded-lg border px-2.5 text-xs"
            >
              <option value="">— Select provider —</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.id})
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs">
            <span className="text-text-secondary">Model name</span>
            <Input
              aria-label="Chat slot model"
              data-testid="bh-chat-slot-model"
              list="bh-chat-slot-models"
              value={slots.chat.model}
              disabled={!editable}
              onChange={(e) =>
                setSlots((s) => ({
                  ...s,
                  chat: { ...s.chat, model: e.target.value },
                }))
              }
              placeholder="e.g. gpt-4o or discovered model ID"
            />
            {chatModels.length > 0 && (
              <datalist id="bh-chat-slot-models">
                {chatModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            )}
          </label>
        </div>
      </div>
    </div>
  );
}
