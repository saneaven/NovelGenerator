import React, { useCallback, useMemo, useState } from 'react';
import { TextButton } from '../../../components/TextButton';
import { FunctionCallCardShell } from '../FunctionCallCardShell';
import { applyImageToolAction } from '../../../runtime/threadCommands';
import type { ImageCardProps } from './types';

function summarizeExcerpt(text: string | undefined, position: 'before' | 'after'): string {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) {
    return position === 'before' ? '...[previous text]' : '[following text]...';
  }
  return position === 'before' ? `...${trimmed}` : `${trimmed}...`;
}

function ActionRow(props: {
  loadingAction: 'accept' | 'reject' | null;
  disabled: boolean;
  onAccept?: () => void;
  onReject?: () => void;
  acceptLabel?: string;
}) {
  const { loadingAction, disabled, onAccept, onReject, acceptLabel } = props;
  return (
    <div className="function-call-image-actions">
      {onAccept && (
        <TextButton
          size="sm"
          variant="primary"
          onClick={onAccept}
          disabled={disabled}
          loading={loadingAction === 'accept'}
        >
          {acceptLabel || 'Apply'}
        </TextButton>
      )}
      {onReject && (
        <TextButton
          size="sm"
          variant="danger"
          onClick={onReject}
          disabled={disabled}
          loading={loadingAction === 'reject'}
        >
          Reject
        </TextButton>
      )}
    </div>
  );
}

function PreviewIsland(props: {
  imageUrl?: string;
  alt: string;
  prompt: string;
  targetLabel?: string;
  requestedRatio: string;
  resolvedRatio?: string;
  provider?: string;
  model?: string;
}) {
  const { imageUrl, alt, prompt, targetLabel, requestedRatio, resolvedRatio, provider, model } = props;
  return (
    <div className="function-call-image-panel">
      {imageUrl ? (
        <div className="function-call-image-preview">
          <img src={imageUrl} alt={alt} />
        </div>
      ) : (
        <div className="function-call-image-preview function-call-image-preview--placeholder">
          Preview not generated yet
        </div>
      )}
      <div className="function-call-image-meta">
        {targetLabel && (
          <>
            <div className="function-call-image-meta__label">Target</div>
            <div className="function-call-image-meta__value">{targetLabel}</div>
          </>
        )}
        <div className="function-call-image-meta__label">Prompt</div>
        <div className="function-call-image-meta__value">{prompt || '(empty prompt)'}</div>
        <div className="function-call-image-meta__label">Ratio</div>
        <div className="function-call-image-meta__value">
          {resolvedRatio && resolvedRatio !== requestedRatio
            ? `${requestedRatio} -> ${resolvedRatio}`
            : requestedRatio || '-'}
        </div>
        {(provider || model) && (
          <>
            <div className="function-call-image-meta__label">Preset</div>
            <div className="function-call-image-meta__value">
              {[provider, model].filter(Boolean).join(' / ')}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export const ImageToolCard: React.FC<ImageCardProps> = ({
  threadId,
  scopeKey,
  operation,
  showDecisionButtons,
  decisionDisabled = false,
  onAccept,
  onReject,
}) => {
  const [loadingAction, setLoadingAction] = useState<'accept' | 'reject' | null>(null);

  const buttonsDisabled = decisionDisabled || loadingAction !== null;
  const previewTitle = operation.imageKind === 'scene' ? 'Generated scene image' : 'Generated object image';
  const subtitle = operation.isUserRejectedFailure
    ? 'Generated image was rejected by the user.'
    : operation.status === 'failed' && operation.reason
      ? operation.reason
      : undefined;

  const runImageAction = useCallback(async (action: 'accept' | 'reject') => {
    if (buttonsDisabled) return;
    setLoadingAction(action);
    try {
      await applyImageToolAction({
        threadId,
        toolCallId: operation.id,
        action,
      });
    } finally {
      setLoadingAction(null);
    }
  }, [buttonsDisabled, operation.id, threadId]);

  const actionIsland = useMemo(() => {
    if (operation.status === 'pending') {
      return (
        <div className="function-call-image-panel function-call-image-panel--note">
          Generate image from this prompt, or reject the request.
        </div>
      );
    }
    if (operation.status === 'working' && operation.imageState === 'generating') {
      return (
        <div className="function-call-image-panel">
          <div className="function-call-image-status-note">Generating image preview...</div>
        </div>
      );
    }
    if (operation.status === 'working' && operation.imageState === 'generated') {
      return (
        <div className="function-call-image-panel">
          <div className="function-call-image-status-note">Preview ready. Apply it or reject it.</div>
          <ActionRow
            loadingAction={loadingAction}
            disabled={buttonsDisabled}
            acceptLabel={operation.imageKind === 'object' ? 'Apply as main image' : 'Apply'}
            onAccept={() => void runImageAction('accept')}
            onReject={() => void runImageAction('reject')}
          />
        </div>
      );
    }
    if (operation.status === 'processing') {
      return (
        <div className="function-call-image-panel">
          <div className="function-call-image-status-note">
            {operation.previewAssetUrl ? 'Applying generated image...' : 'Generating image preview...'}
          </div>
        </div>
      );
    }
    if (operation.status === 'applied') {
      return (
        <div className="function-call-image-panel">
          <div className="function-call-image-status-note">
            {operation.result?.message || 'Generated image applied successfully.'}
          </div>
        </div>
      );
    }
    if (operation.isUserRejectedFailure) {
      return (
        <div className="function-call-image-panel">
          <div className="function-call-image-status-note">Generated image was rejected by the user.</div>
        </div>
      );
    }
    if (operation.status === 'rejected') {
      return (
        <div className="function-call-image-panel">
          <div className="function-call-image-status-note">Image workflow was rejected before generation.</div>
        </div>
      );
    }
    return (
      <div className="function-call-image-panel">
        <div className="function-call-image-status-note">
          {operation.reason || operation.result?.error || 'Image workflow failed.'}
        </div>
      </div>
    );
  }, [buttonsDisabled, loadingAction, operation, runImageAction]);

  const defaultExpanded = operation.status === 'pending'
    || operation.status === 'working'
    || operation.status === 'processing'
    || operation.status === 'failed';

  if (operation.imageKind === 'scene') {
    return (
      <FunctionCallCardShell
        scopeKey={scopeKey}
        cardId={operation.id}
        category="image"
        status={operation.status}
        title={operation.title}
        subtitle={subtitle}
        showDecisionButtons={showDecisionButtons}
        decisionDisabled={decisionDisabled}
        onAccept={onAccept}
        onReject={onReject}
        defaultExpanded={defaultExpanded}
        islands={[
          <div className="function-call-image-excerpt" key="before">
            {summarizeExcerpt(operation.beforeExcerpt, 'before')}
          </div>,
          <div className="function-call-image-middle-island" key="middle">
            <PreviewIsland
              imageUrl={operation.previewAssetUrl}
              alt={previewTitle}
              prompt={operation.prompt}
              targetLabel={operation.targetLabel}
              requestedRatio={operation.requestedRatio}
              resolvedRatio={operation.resolvedRatio}
              provider={operation.provider}
              model={operation.model}
            />
            {actionIsland}
          </div>,
          <div className="function-call-image-excerpt" key="after">
            {summarizeExcerpt(operation.afterExcerpt, 'after')}
          </div>,
        ]}
      />
    );
  }

  const firstIsland = (
    <PreviewIsland
      imageUrl={operation.previewAssetUrl}
      alt={previewTitle}
      prompt={operation.prompt}
      targetLabel={operation.targetLabel}
      requestedRatio={operation.requestedRatio}
      resolvedRatio={operation.resolvedRatio}
      provider={operation.provider}
      model={operation.model}
    />
  );

  return (
    <FunctionCallCardShell
      scopeKey={scopeKey}
      cardId={operation.id}
      category="image"
      status={operation.status}
      title={operation.title}
      subtitle={subtitle}
      showDecisionButtons={showDecisionButtons}
      decisionDisabled={decisionDisabled}
      onAccept={onAccept}
      onReject={onReject}
      defaultExpanded={defaultExpanded}
      islands={[firstIsland, actionIsland]}
    />
  );
};

export default ImageToolCard;
