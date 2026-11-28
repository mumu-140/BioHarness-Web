/**
 * Thin BioHarness composer adapter seated directly on LibreChat's upstream
 * ComposerFrame, ComposerField, and ComposerActions (SendButton / StopButton)
 * from `@librechat/chat/components` (not upstream LibreChat code).
 *
 * R3.2 additions: restricted research-input upload & workspace-file reference drawer,
 * everyday task model picker (separated from Provider URL/Key admin), and real host
 * execution-budget strategy selector (strictly distinct from Core task type and Memory recall mode).
 */
import React, { memo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent, MutableRefObject } from 'react';
import { Cpu, FileText, Gauge, Paperclip, Upload, X } from 'lucide-react';
import { ComposerActions, ComposerField, ComposerFrame } from '@librechat/chat/components';
import type { ComposerActionsProps } from '@librechat/chat/components';
import type {
  AvailableModelOption,
  ModelOverride,
  RunStrategyOption,
  WorkspaceInputFile,
  WorkspaceInputsResponse,
} from './bioharness';
import { formatBytes, useBhText } from './i18n';

const INACTIVE_STEERING = {
  duringRunActive: false,
} as unknown as ComposerActionsProps['steering'];

const noop = () => undefined;

export interface BioHarnessComposerProps {
  textAreaRef: MutableRefObject<HTMLTextAreaElement | null>;
  maximizeChatSpace: boolean;
  enterToSend: boolean;
  draftText: string;
  onDraftChange: (value: string) => void;
  onSubmit: (event?: FormEvent) => void;
  onCancel: () => void;
  placeholder: string;
  composerBlocked: boolean;
  isActing: boolean;
  isNewConversation: boolean;
  activeRunId: string | null;
  cancelRequested: boolean;
  activeModel: string | null;
  availableModels?: AvailableModelOption[];
  selectedModelOverride?: ModelOverride | null;
  onSelectModelOverride?: (override: ModelOverride | null) => void;
  strategies?: RunStrategyOption[];
  selectedStrategy?: RunStrategyOption['id'];
  onSelectStrategy?: (strategy: RunStrategyOption['id']) => void;
  inputsState?: WorkspaceInputsResponse | null;
  inputsLoading?: boolean;
  attachedInputs?: WorkspaceInputFile[];
  onAttachInput?: (item: WorkspaceInputFile) => void;
  onRemoveAttachedInput?: (serverPath: string) => void;
  onUploadFile?: (file: File) => Promise<void>;
  uploadingInput?: boolean;
  uploadError?: string | null;
  onClearUploadError?: () => void;
  onInputsDrawerOpenChange?: (open: boolean) => void;
}

const BioHarnessComposer = memo(function BioHarnessComposer({
  textAreaRef,
  maximizeChatSpace,
  enterToSend,
  draftText,
  onDraftChange,
  onSubmit,
  onCancel,
  placeholder,
  composerBlocked,
  isActing,
  isNewConversation,
  activeRunId,
  cancelRequested,
  activeModel,
  availableModels = [],
  selectedModelOverride = null,
  onSelectModelOverride,
  strategies = [],
  selectedStrategy = 'standard',
  onSelectStrategy,
  inputsState = null,
  inputsLoading = false,
  attachedInputs = [],
  onAttachInput,
  onRemoveAttachedInput,
  onUploadFile,
  uploadingInput = false,
  uploadError = null,
  onClearUploadError,
  onInputsDrawerOpenChange,
}: BioHarnessComposerProps) {
  const { zh, tr } = useBhText();
  const [focused, setFocused] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && enterToSend) {
      e.preventDefault();
      onSubmit();
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onUploadFile) {
      return;
    }
    await onUploadFile(file);
  };

  const currentStrategyObj = strategies.find((s) => s.id === selectedStrategy);
  const modelSelectValue = selectedModelOverride
    ? `${selectedModelOverride.provider_id}::${selectedModelOverride.model}`
    : '';
  const attachedPaths = new Set(attachedInputs.map((item) => item.server_path));

  return (
    <ComposerFrame
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(e);
      }}
      direction="auto"
      maximizeChatSpace={maximizeChatSpace}
      focused={focused}
      isTemporary={false}
      onFocusDraft={() => textAreaRef.current?.focus()}
      hints={
        <p className="text-text-tertiary mt-1 text-center text-[11px] leading-snug">
          {tr(
            '关闭页面不会中断后台运行；需点击停止并等待终态事件确认。',
            'Closing this page does not cancel a running task; click Stop and wait for the terminal event.',
          )}
        </p>
      }
    >
      <div className="flex flex-col">
        {attachedInputs.length > 0 && (
          <div
            data-testid="bh-attached-inputs"
            className="border-border-light flex flex-wrap items-center gap-1.5 border-b px-3 py-2 text-[11px]"
          >
            {attachedInputs.map((item) => (
              <span
                key={item.server_path}
                data-testid={`bh-attached-chip-${item.name}`}
                className="border-border-medium bg-surface-primary text-text-primary inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1"
                title={`${item.server_path}${item.sha256 ? ` · SHA-256: ${item.sha256}` : ''}`}
              >
                <FileText className="h-3 w-3 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                <span className="max-w-[140px] truncate font-medium">{item.name}</span>
                <span className="text-text-tertiary shrink-0">{formatBytes(item.bytes)}</span>
                <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[10px] text-amber-800 dark:text-amber-200">
                  {tr('待附带输入', 'Unverified input')}
                </span>
                {onRemoveAttachedInput && (
                  <button
                    type="button"
                    aria-label={tr(`移除资料 ${item.name}`, `Remove ${item.name}`)}
                    onClick={() => onRemoveAttachedInput(item.server_path)}
                    className="text-text-tertiary hover:text-text-primary rounded p-0.5"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {drawerOpen && (
          <div
            data-testid="bh-inputs-drawer"
            className="border-border-light bg-surface-secondary/50 space-y-2 border-b px-3 py-2.5 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-text-primary font-medium">
                {tr(
                  '添加研究资料（上传小型文件或引用服务器已有授权资料）',
                  'Attach research inputs (upload small files or reference authorized workspace files)',
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(false);
                  onInputsDrawerOpenChange?.(false);
                }}
                aria-label={tr('关闭资料面板', 'Close inputs drawer')}
                className="text-text-tertiary hover:text-text-primary rounded p-1"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            {inputsState?.upload_enabled ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  data-testid="bh-upload-input-file"
                  className="hidden"
                  accept=".csv,.tsv,.txt,.md,.fasta,.fa,.fna,.faa,.fastq,.fq,.pdf,.json,.jsonl,.png,.jpg,.jpeg,.svg"
                  disabled={uploadingInput || composerBlocked}
                  onChange={(e) => void handleFileChange(e)}
                />
                <button
                  type="button"
                  data-testid="bh-upload-trigger-btn"
                  disabled={uploadingInput || composerBlocked}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-border-medium bg-surface-primary text-text-primary hover:bg-surface-hover inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {uploadingInput
                      ? tr('上传并校验 SHA-256 中…', 'Uploading & hashing…')
                      : tr('上传资料（CSV/TSV/FASTA/PDF）', 'Upload file (CSV/TSV/FASTA/PDF)')}
                  </span>
                </button>
                <span className="text-text-tertiary text-[11px]">
                  {tr(
                    `单文件 ≤ ${Math.floor((inputsState.max_upload_bytes || 20 * 1024 * 1024) / (1024 * 1024))} MiB，禁止覆盖同名文件；上传后仍需 Core 核验方成为证据。`,
                    `Max ${Math.floor((inputsState.max_upload_bytes || 20 * 1024 * 1024) / (1024 * 1024))} MiB per file, no overwrite; uploaded inputs are not Core-verified evidence.`,
                  )}
                </span>
              </div>
            ) : (
              <div
                data-testid="bh-upload-disabled-notice"
                className="border-border-light bg-surface-primary/80 text-text-secondary rounded-lg border px-2.5 py-1.5 text-[11px]"
              >
                {inputsState?.upload_disabled_reason ||
                  tr(
                    '当前运行环境未配置授权可写上传目录（upload_root），仅支持引用下方已有授权文件。',
                    'Upload directory (upload_root) is not configured for this workspace; reference existing authorized files below.',
                  )}
              </div>
            )}

            {uploadError && (
              <div
                role="alert"
                data-testid="bh-upload-error"
                className="border-status-error-border bg-status-error-subtle text-text-primary flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]"
              >
                <span>{uploadError}</span>
                {onClearUploadError && (
                  <button
                    type="button"
                    onClick={onClearUploadError}
                    className="text-text-secondary hover:text-text-primary underline"
                  >
                    {tr('关闭', 'Dismiss')}
                  </button>
                )}
              </div>
            )}

            <div className="space-y-1">
              <div className="text-text-tertiary text-[11px]">
                {tr(
                  '已有授权服务器资料（点击附带引用，大型数据不整文件塞入上下文）',
                  'Authorized server files (click to reference without pasting full datasets)',
                )}
              </div>
              {inputsLoading ? (
                <div className="text-text-tertiary py-1 text-[11px]">
                  {tr('正在读取授权资料列表…', 'Loading authorized files…')}
                </div>
              ) : !inputsState || inputsState.files.length === 0 ? (
                <div className="text-text-tertiary py-1 text-[11px]">
                  {tr('当前授权目录中暂无可引用文件。', 'No referenceable files found in authorized directories yet.')}
                </div>
              ) : (
                <ul
                  data-testid="bh-workspace-inputs-list"
                  className="max-h-36 space-y-1 overflow-y-auto pr-1"
                >
                  {inputsState.files.map((item) => {
                    const isAttached = attachedPaths.has(item.server_path);
                    return (
                      <li
                        key={item.server_path}
                        className="border-border-light bg-surface-primary flex items-center justify-between gap-2 rounded-md border px-2 py-1"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-text-primary truncate font-medium">{item.name}</div>
                          <div className="text-text-tertiary truncate font-mono text-[10px]">
                            {item.server_path} · {formatBytes(item.bytes)}
                          </div>
                        </div>
                        <button
                          type="button"
                          data-testid={`bh-ref-input-${item.name}`}
                          disabled={isAttached}
                          onClick={() => onAttachInput?.(item)}
                          className="border-border-medium text-text-primary hover:bg-surface-hover shrink-0 rounded border px-2 py-0.5 text-[11px] disabled:opacity-50"
                        >
                          {isAttached ? tr('已附带', 'Attached') : tr('引用', 'Attach')}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        <ComposerField
          textAreaRef={textAreaRef}
          ariaLabel={tr('科研问题或回复输入', 'Message')}
          value={draftText}
          listening={false}
          dictationActive={false}
          locked={composerBlocked}
          textareaProps={{
            id: 'prompt-textarea',
            'data-testid': 'bh-composer-input',
            value: draftText,
            disabled: composerBlocked,
            placeholder,
            onFocus: () => setFocused(true),
            onBlur: () => setFocused(false),
            onChange: (e) => onDraftChange(e.target.value),
            onKeyDown: handleKeyDown,
          }}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-2.5 pt-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-testid="bh-attach-input-btn"
              aria-expanded={drawerOpen}
              disabled={activeRunId !== null}
              onClick={() =>
                setDrawerOpen((prev) => {
                  const next = !prev;
                  onInputsDrawerOpenChange?.(next);
                  return next;
                })
              }
              className="border-border-light text-text-secondary hover:bg-surface-hover hover:text-text-primary inline-flex min-h-[36px] items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50"
              title={tr('上传小型研究资料或引用服务器已有文件', 'Upload small files or reference server files')}
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{tr('资料', 'Inputs')}</span>
              {attachedInputs.length > 0 && (
                <span className="rounded-full bg-teal-500/15 px-1.5 text-[10px] text-teal-700 dark:text-teal-300">
                  {attachedInputs.length}
                </span>
              )}
            </button>

            {availableModels.length > 0 && onSelectModelOverride && (
              <label
                className="border-border-light bg-surface-primary text-text-secondary inline-flex min-h-[36px] items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px]"
                title={tr(
                  '仅在服务端已授权启用的模型中按次切换；不涉及密钥配置',
                  'Switch among server-configured models for this run without editing provider keys',
                )}
              >
                <Cpu className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="sr-only">{tr('任务模型', 'Task model')}</span>
                <select
                  aria-label={tr('任务模型', 'Task model')}
                  data-testid="bh-quick-model-select"
                  disabled={activeRunId !== null}
                  value={modelSelectValue}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) {
                      onSelectModelOverride(null);
                      return;
                    }
                    const [pid, ...rest] = val.split('::');
                    onSelectModelOverride({ provider_id: pid, model: rest.join('::') });
                  }}
                  className="text-text-primary max-w-[140px] bg-transparent text-[11px] focus:outline-none sm:max-w-[180px]"
                >
                  <option value="">
                    {activeModel
                      ? tr(`默认 (${activeModel})`, `Default (${activeModel})`)
                      : tr('默认模型', 'Default model')}
                  </option>
                  {availableModels.map((item) => (
                    <option
                      key={`${item.provider_id}::${item.model}`}
                      value={`${item.provider_id}::${item.model}`}
                    >
                      {item.model} ({item.provider_name})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {strategies.length > 0 && onSelectStrategy && (
              <label
                className="border-border-light bg-surface-primary text-text-secondary inline-flex min-h-[36px] items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px]"
                title={
                  currentStrategyObj?.description ||
                  tr(
                    '宿主运行预算策略（轮次与上下文窗口），不改变 Core 五调用或证据要求，与 Memory FAST/STANDARD 独立',
                    'Host execution budget strategy; does not alter Core mainline or Memory recall mode',
                  )
                }
              >
                <Gauge className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="sr-only">{tr('研究预算策略', 'Execution budget strategy')}</span>
                <select
                  aria-label={tr('研究预算策略', 'Execution budget strategy')}
                  data-testid="bh-strategy-select"
                  disabled={activeRunId !== null}
                  value={selectedStrategy}
                  onChange={(e) => onSelectStrategy(e.target.value as RunStrategyOption['id'])}
                  className="text-text-primary max-w-[130px] bg-transparent text-[11px] focus:outline-none"
                >
                  {strategies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {zh ? `${s.label} (${s.max_turns}轮)` : `${s.label_en} (${s.max_turns} turns)`}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <span
              className="text-text-tertiary hidden truncate text-[11px] sm:inline"
              data-testid={cancelRequested ? 'bh-cancel-requested' : 'bh-composer-status'}
            >
              {activeRunId
                ? cancelRequested
                  ? tr('已请求取消 — 等待运行终态确认…', 'Cancellation requested — awaiting run confirmation…')
                  : tr('后台科研运行进行中…', 'Backend run in progress…')
                : activeModel
                  ? tr(`当前默认：${activeModel}`, `Active model: ${activeModel}`)
                  : tr('未配置模型', 'No model configured')}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <ComposerActions
              text={draftText}
              submitButtonRef={submitButtonRef}
              isSubmitting={activeRunId !== null}
              answersAsk={false}
              hasEndpoint={true}
              steering={INACTIVE_STEERING}
              isNewConversation={isNewConversation}
              getText={() => draftText}
              onConsumed={noop}
              enterToSend={enterToSend}
              fileCount={attachedInputs.length}
              sendDisabled={composerBlocked || isActing}
              duringRunDisabled={true}
              showStopButton={activeRunId !== null}
              setShowStopButton={noop}
              stop={(e) => {
                e.preventDefault();
                onCancel();
              }}
              canStop={!cancelRequested && !isActing}
              isPreparingFromUrl={false}
            />
          </div>
        </div>
      </div>
    </ComposerFrame>
  );
});

export default BioHarnessComposer;
