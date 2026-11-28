import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import BioHarnessComposer from '../BioHarnessComposer';
import BioHarnessChatBanners from '../BioHarnessChatBanners';
import { buildResearchTreeNodes } from '../BioHarnessSidebarSection';
import {
  formatOpKindLabel,
  formatOpStateLabel,
  formatPhaseLabel,
  formatRunStateLabel,
} from '../i18n';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { resolvedLanguage: 'zh-Hans', language: 'zh-Hans' },
  }),
}));

describe('R3.2 Chinese localization, composer inputs/model/strategy, and guided project creation', () => {
  it('formats scientific phases, run states, and execution badges in Simplified Chinese', () => {
    expect(formatPhaseLabel('WAIT_FOR_USER', true)).toBe('待用户回应');
    expect(formatPhaseLabel('DELIVERED', true)).toBe('已交付');
    expect(formatRunStateLabel('RUNNING', true)).toBe('运行中');
    expect(formatOpKindLabel('core', true)).toBe('Core 主线');
    expect(formatOpStateLabel('REFUSED', true)).toBe('已拒绝');
  });

  it('renders everyday model picker, execution budget strategy, and inputs drawer honestly', () => {
    const onSelectModelOverride = jest.fn();
    const onSelectStrategy = jest.fn();
    const onAttachInput = jest.fn();
    const textAreaRef = { current: null };

    render(
      <BioHarnessComposer
        textAreaRef={textAreaRef}
        maximizeChatSpace={false}
        enterToSend={true}
        draftText="分析 PPGR 转录组差异表达"
        onDraftChange={jest.fn()}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
        placeholder="输入科学问题"
        composerBlocked={false}
        isActing={false}
        isNewConversation={true}
        activeRunId={null}
        cancelRequested={false}
        activeModel="gpt-fast"
        availableModels={[
          { provider_id: 'p1', provider_name: 'Primary', model: 'gpt-fast' },
          { provider_id: 'p1', provider_name: 'Primary', model: 'gpt-deep' },
        ]}
        selectedModelOverride={null}
        onSelectModelOverride={onSelectModelOverride}
        strategies={[
          {
            id: 'standard',
            label: '标准预算',
            label_en: 'Standard',
            max_turns: 40,
            context_chars: 240000,
            description: '默认',
          },
          {
            id: 'concise',
            label: '快速紧凑',
            label_en: 'Concise',
            max_turns: 12,
            context_chars: 80000,
            description: '快速',
          },
        ]}
        selectedStrategy="standard"
        onSelectStrategy={onSelectStrategy}
        inputsState={{
          workspace: 'demo',
          upload_enabled: false,
          upload_disabled_reason: '未配置 upload_root',
          max_upload_bytes: 1024,
          allowed_extensions: ['.csv', '.fasta', '.pdf'],
          files: [
            {
              name: 'counts.csv',
              server_path: '$WORKSPACE/counts.csv',
              bytes: 256,
              extension: '.csv',
              source_kind: 'workspace_file',
              evidence_verified: false,
            },
          ],
          truncated: false,
        }}
        attachedInputs={[
          {
            name: 'counts.csv',
            server_path: '$WORKSPACE/counts.csv',
            bytes: 256,
            extension: '.csv',
            source_kind: 'workspace_file',
            evidence_verified: false,
          },
        ]}
        onAttachInput={onAttachInput}
      />,
    );

    fireEvent.change(screen.getByTestId('bh-quick-model-select'), {
      target: { value: 'p1::gpt-deep' },
    });
    expect(onSelectModelOverride).toHaveBeenCalledWith({
      provider_id: 'p1',
      model: 'gpt-deep',
    });

    fireEvent.change(screen.getByTestId('bh-strategy-select'), {
      target: { value: 'concise' },
    });
    expect(onSelectStrategy).toHaveBeenCalledWith('concise');

    expect(screen.getByTestId('bh-attached-chip-counts.csv')).toHaveTextContent('待附带输入');

    fireEvent.click(screen.getByTestId('bh-attach-input-btn'));
    expect(screen.getByTestId('bh-upload-disabled-notice')).toHaveTextContent('upload_root');
  });

  it('builds project/sub-project quick actions in research tree and guided parent_id selector', () => {
    const onCreateSubproject = jest.fn();
    const { nodes } = buildResearchTreeNodes(
      [{ scope_id: 'PPGR', path: ['PPGR'], request_count: 1 }],
      { zh: true, onCreateSubproject },
    );
    expect(nodes).toHaveLength(1);

    render(
      <BioHarnessChatBanners
        problem={null}
        onDismissProblem={jest.fn()}
        stateError={null}
        needsExplicitRequestStart={false}
        selectedRequestId={null}
        runtimeEnabled={true}
        isActing={false}
        onStartRequestConversation={jest.fn()}
        stateData={undefined}
        beginReconcile={null}
        onAttachRequest={jest.fn()}
        nowData={null}
        activeRunId={null}
        onInsertIntoDraft={jest.fn()}
        onBranchFromDelivered={jest.fn()}
        isNew={true}
        branchSource={null}
        onClearBranchSource={jest.fn()}
        scopes={[{ scope_id: 'PPGR', path: ['PPGR'], request_count: 1 }]}
        scopeMode="new"
        onScopeModeChange={jest.fn()}
        selectedScopeId=""
        onSelectedScopeIdChange={jest.fn()}
        newScopeId="transcriptome"
        onNewScopeIdChange={jest.fn()}
        parentScopeId="PPGR"
        onParentScopeIdChange={jest.fn()}
        scopeProblem={null}
      />,
    );

    expect(screen.getByTestId('bh-scope-selector')).toHaveTextContent('PPGR / transcriptome');
  });
});
