import React, { useCallback, useMemo, useState } from 'react';
import AuthenticatedImage from '../../../components/common/AuthenticatedImage';
import { TextButton } from '../../../components/TextButton';
import { assetService } from '../../../api/assetService';
import { useImageRun, upsertImageRunInCache } from '../../../data/imageRuns';
import { FunctionCallCardShell } from '../FunctionCallCardShell';
import type { GenerateOperationVM } from '../vmTypes';
import type { ImageCardProps } from './types';

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
  imageUrl?: string | null;
  alt: string;
  promptSections: GenerateOperationVM['promptSections'];
  targetLabel?: string;
  requestedRatio: string;
  requestedImageSize?: string;
  resolvedRatio?: string | null;
  provider?: string | null;
  model?: string | null;
}) {
  const { imageUrl, alt, promptSections, targetLabel, requestedRatio, requestedImageSize, resolvedRatio, provider, model } = props;
  return (
    <div className="function-call-image-panel">
      {imageUrl ? (
        <div className="function-call-image-preview">
          <AuthenticatedImage src={imageUrl} alt={alt} />
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
        {promptSections.length > 0 ? promptSections.map((section) => (
          <React.Fragment key={section.label}>
            <div className="function-call-image-meta__label">{section.label}</div>
            <div className="function-call-image-meta__value">{section.text || '(empty)'}</div>
          </React.Fragment>
        )) : (
          <>
            <div className="function-call-image-meta__label">Prompt</div>
            <div className="function-call-image-meta__value">Waiting for prompt...</div>
          </>
        )}
        <div className="function-call-image-meta__label">Ratio</div>
        <div className="function-call-image-meta__value">
          {resolvedRatio && resolvedRatio !== requestedRatio
            ? `${requestedRatio} -> ${resolvedRatio}`
            : requestedRatio || '-'}
        </div>
        {requestedImageSize && (
          <>
            <div className="function-call-image-meta__label">Image size</div>
            <div className="function-call-image-meta__value">{requestedImageSize}</div>
          </>
        )}
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
  scopeKey,
  projectId,
  operation,
  showDecisionButtons,
  decisionDisabled = false,
  onAccept,
  onReject,
}) => {
  const [loadingAction, setLoadingAction] = useState<'accept' | 'reject' | null>(null);
  const imageRun = useImageRun(projectId, operation.imageRunId);

  const buttonsDisabled = decisionDisabled || loadingAction !== null;
  const previewTitle = operation.imageKind === 'scene' ? 'Generated scene image' : 'Generated object image';
  const subtitle = operation.isUserRejectedFailure
    ? 'Generated image was rejected by the user.'
    : operation.status === 'failed' && operation.reason
      ? operation.reason
      : undefined;

  const runDecision = useCallback(async (decision: 'accept' | 'reject') => {
    if (!operation.imageRunId || !projectId || buttonsDisabled) return;
    setLoadingAction(decision);
    try {
      const updated = await assetService.decideImageRun(projectId, operation.imageRunId, decision);
      upsertImageRunInCache(updated);
    } finally {
      setLoadingAction(null);
    }
  }, [buttonsDisabled, operation.imageRunId, projectId]);

  const actionIsland = useMemo(() => {
    if (operation.status === 'collecting' || operation.status === 'streaming' || operation.status === 'validating') {
      return (
        <div className="function-call-image-panel function-call-image-panel--note">
          {operation.status === 'validating' ? 'Validating image request...' : 'Receiving image request...'}
        </div>
      );
    }

    if (operation.status === 'pending') {
      return (
        <div className="function-call-image-panel function-call-image-panel--note">
          Accept to start image generation, or reject the request.
        </div>
      );
    }

    if (operation.status === 'processing') {
      return (
        <div className="function-call-image-panel">
          <div className="function-call-image-status-note">Starting image generation...</div>
        </div>
      );
    }

    if (operation.status === 'working') {
      if (!imageRun || imageRun.status === 'queued' || imageRun.status === 'running') {
        return (
          <div className="function-call-image-panel">
            <div className="function-call-image-status-note">Generating image preview...</div>
          </div>
        );
      }
      if (imageRun.status === 'applying') {
        return (
          <div className="function-call-image-panel">
            <div className="function-call-image-status-note">Applying generated image...</div>
          </div>
        );
      }
      if (imageRun.status === 'review') {
        return (
          <div className="function-call-image-panel">
            <div className="function-call-image-status-note">Preview ready. Apply it or reject it.</div>
            <ActionRow
              loadingAction={loadingAction}
              disabled={buttonsDisabled}
              acceptLabel={operation.imageKind === 'object' ? 'Apply as main image' : 'Apply'}
              onAccept={() => void runDecision('accept')}
              onReject={() => void runDecision('reject')}
            />
          </div>
        );
      }
    }

    if (operation.status === 'applied' || (operation.status === 'working' && imageRun?.status === 'applied')) {
      return (
        <div className="function-call-image-panel">
          <div className="function-call-image-status-note">
            {operation.result?.message || 'Generated image applied successfully.'}
          </div>
        </div>
      );
    }

    if (operation.isUserRejectedFailure || (operation.status === 'working' && imageRun?.status === 'rejected')) {
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

    if (operation.status === 'working' && imageRun?.status === 'canceled') {
      return (
        <div className="function-call-image-panel">
          <div className="function-call-image-status-note">Image generation was canceled.</div>
        </div>
      );
    }

    return (
      <div className="function-call-image-panel">
        <div className="function-call-image-status-note">
          {operation.reason || imageRun?.error_message || operation.result?.error || 'Image workflow failed.'}
        </div>
      </div>
    );
  }, [buttonsDisabled, imageRun, loadingAction, operation, runDecision]);

  const defaultExpanded = operation.status === 'collecting'
    || operation.status === 'streaming'
    || operation.status === 'validating'
    || operation.status === 'pending'
    || operation.status === 'working'
    || operation.status === 'processing'
    || operation.status === 'failed';

  if (operation.imageKind === 'scene') {
    return (
      <FunctionCallCardShell
        scopeKey={scopeKey}
        cardId={operation.id}
        category={operation.category}
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
            <div className="function-call-image-meta__label">Before image</div>
            <div>{operation.anchor?.before || 'Waiting for preceding text...'}</div>
          </div>,
          <div className="function-call-image-middle-island" key="middle">
            <PreviewIsland
              imageUrl={imageRun?.preview_asset_url}
              alt={previewTitle}
              promptSections={operation.promptSections}
              targetLabel={operation.targetLabel}
              requestedRatio={operation.requestedRatio}
              requestedImageSize={operation.requestedImageSize}
              resolvedRatio={imageRun?.resolved_aspect_ratio}
              provider={imageRun?.provider}
              model={imageRun?.model}
            />
            {actionIsland}
          </div>,
          <div className="function-call-image-excerpt" key="after">
            <div className="function-call-image-meta__label">After image</div>
            <div>{operation.anchor?.after || 'Waiting for following text...'}</div>
          </div>,
        ]}
      />
    );
  }

  const firstIsland = (
    <PreviewIsland
      imageUrl={imageRun?.preview_asset_url}
      alt={previewTitle}
      promptSections={operation.promptSections}
      targetLabel={operation.targetLabel}
      requestedRatio={operation.requestedRatio}
      requestedImageSize={operation.requestedImageSize}
      resolvedRatio={imageRun?.resolved_aspect_ratio}
      provider={imageRun?.provider}
      model={imageRun?.model}
    />
  );

  return (
    <FunctionCallCardShell
      scopeKey={scopeKey}
      cardId={operation.id}
      category={operation.category}
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
