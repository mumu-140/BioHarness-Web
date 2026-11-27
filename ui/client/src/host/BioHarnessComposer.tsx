/**
 * Thin BioHarness composer adapter seated directly on LibreChat's upstream
 * ComposerFrame, ComposerField, and ComposerActions (SendButton / StopButton)
 * from `@librechat/chat/components` (not upstream LibreChat code).
 */
import React, { memo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, MutableRefObject } from 'react';
import { ComposerActions, ComposerField, ComposerFrame } from '@librechat/chat/components';
import type { ComposerActionsProps } from '@librechat/chat/components';

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
}: BioHarnessComposerProps) {
  const [focused, setFocused] = useState(false);
  const submitButtonRef = useRef<HTMLButtonElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && enterToSend) {
      e.preventDefault();
      onSubmit();
    }
  };

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
        <p className="text-text-tertiary mt-1.5 text-center text-[11px]">
          Closing this page does not cancel a running task; cancellation requires clicking Stop and
          is confirmed by the run&apos;s terminal event.
        </p>
      }
    >
      <div className="flex flex-col">
        <ComposerField
          textAreaRef={textAreaRef}
          ariaLabel="Message"
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

        <div className="flex items-center justify-between gap-2 px-3 pb-2.5 pt-1">
          <span
            className="text-text-tertiary truncate text-[11px]"
            data-testid={cancelRequested ? 'bh-cancel-requested' : 'bh-composer-status'}
          >
            {activeRunId
              ? cancelRequested
                ? 'Cancellation requested — awaiting run confirmation…'
                : 'Backend run in progress…'
              : activeModel
                ? `Active model: ${activeModel}`
                : 'No model configured'}
          </span>

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
              fileCount={0}
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
