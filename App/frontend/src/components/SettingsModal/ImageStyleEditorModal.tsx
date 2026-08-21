import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CustomSelect } from '../ui/CustomSelect';
import { TextButton } from '../TextButton';
import type { NaturalImageStyle, PositiveNegativeImageStyle } from '../../domain/settings';
import { generateTempId } from '../../utils/tempId';
import { confirm } from '../../store/dialogStore';
import './ImageStyleEditorModal.css';

interface NaturalProps {
  mode: 'natural';
  styles: NaturalImageStyle[];
  onChange: (styles: NaturalImageStyle[]) => void;
}

interface PairedProps {
  mode: 'positive_negative' | 'novelai';
  styles: PositiveNegativeImageStyle[];
  onChange: (styles: PositiveNegativeImageStyle[]) => void;
}

type Props = NaturalProps | PairedProps;

const ImageStyleEditorModal: React.FC<Props> = (props) => {
  const { mode } = props;
  const { t } = useTranslation();
  const tp = 'settings.imageGen.styleEditor';
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);

  const styles = props.styles as (NaturalImageStyle | PositiveNegativeImageStyle)[];

  useEffect(() => {
    if (styles.length === 0) {
      setSelectedStyleId(null);
      return;
    }
    const currentStillExists =
      selectedStyleId && styles.some((s) => s.id === selectedStyleId);
    if (!currentStillExists) {
      setSelectedStyleId(styles[0].id ?? null);
    }
  }, [styles, selectedStyleId]);

  const selectedStyle = styles.find((s) => s.id === selectedStyleId) ?? null;

  const handleCreate = () => {
    if (mode === 'natural') {
      const newStyle: NaturalImageStyle = {
        id: generateTempId(),
        name: 'New Style',
        prefix: '',
        postfix: '',
      };
      (props as NaturalProps).onChange([...(props as NaturalProps).styles, newStyle]);
      setSelectedStyleId(newStyle.id);
    } else {
      const newStyle: PositiveNegativeImageStyle = {
        id: generateTempId(),
        name: 'New Style',
        positivePrefix: '',
        positivePostfix: '',
        negativePrefix: '',
        negativePostfix: '',
      };
      (props as PairedProps).onChange([...(props as PairedProps).styles, newStyle]);
      setSelectedStyleId(newStyle.id);
    }
  };

  const handleDelete = async () => {
    if (!selectedStyleId) return;
    const confirmed = await confirm({
      title: t(`${tp}.deleteStyle`),
      message: t(`${tp}.confirmDelete`),
      variant: 'danger',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;

    if (mode === 'natural') {
      const remaining = (props as NaturalProps).styles.filter((s) => s.id !== selectedStyleId);
      (props as NaturalProps).onChange(remaining);
      setSelectedStyleId(remaining.length > 0 ? remaining[0].id : null);
    } else {
      const remaining = (props as PairedProps).styles.filter((s) => s.id !== selectedStyleId);
      (props as PairedProps).onChange(remaining);
      setSelectedStyleId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const handleUpdate = (updates: Partial<NaturalImageStyle> & Partial<PositiveNegativeImageStyle>) => {
    if (!selectedStyleId) return;
    if (mode === 'natural') {
      (props as NaturalProps).onChange(
        (props as NaturalProps).styles.map((s) =>
          s.id === selectedStyleId ? { ...s, ...updates } : s
        )
      );
    } else {
      (props as PairedProps).onChange(
        (props as PairedProps).styles.map((s) =>
          s.id === selectedStyleId ? { ...s, ...updates } : s
        )
      );
    }
  };

  const renderNaturalEditor = (style: NaturalImageStyle) => (
    <div className="style-editor-fields">
      <div className="style-editor-field">
        <label>{t('settings.imageGen.naturalStyles.styleName')}</label>
        <input
          type="text"
          value={style.name}
          onChange={(e) => handleUpdate({ name: e.target.value })}
          placeholder={t('settings.imageGen.naturalStyles.styleName')}
        />
      </div>
      <div className="style-editor-field">
        <label>{t('settings.imageGen.naturalStyles.prefix')}</label>
        <textarea
          rows={4}
          value={style.prefix}
          onChange={(e) => handleUpdate({ prefix: e.target.value })}
          placeholder={t('settings.imageGen.naturalStyles.prefixPlaceholder')}
        />
      </div>
      <div className="style-editor-field">
        <label>{t('settings.imageGen.naturalStyles.postfix')}</label>
        <textarea
          rows={4}
          value={style.postfix}
          onChange={(e) => handleUpdate({ postfix: e.target.value })}
          placeholder={t('settings.imageGen.naturalStyles.postfixPlaceholder')}
        />
      </div>
      {(style.prefix || style.postfix) && (
        <div className="style-editor-preview">
          <span className="style-editor-preview-label">{t('settings.imageGen.naturalStyles.preview')}</span>
          <span className="style-editor-preview-text">
            {style.prefix}<em>[prompt]</em>{style.postfix}
          </span>
        </div>
      )}
    </div>
  );

  const pairedStyleKey = mode === 'novelai'
    ? 'settings.imageGen.novelAIStyles'
    : 'settings.imageGen.positiveNegativeStyles';

  const renderPairedEditor = (style: PositiveNegativeImageStyle) => (
    <div className="style-editor-fields">
      <div className="style-editor-field">
        <label>{t('settings.imageGen.naturalStyles.styleName')}</label>
        <input
          type="text"
          value={style.name}
          onChange={(e) => handleUpdate({ name: e.target.value })}
          placeholder={t('settings.imageGen.naturalStyles.styleName')}
        />
      </div>
      <div className="style-editor-field-group">
        <label className="style-editor-group-label">{t(`${pairedStyleKey}.positivePrompt`)}</label>
        <div className="style-editor-field-row">
          <div className="style-editor-field">
            <label>{t('settings.imageGen.naturalStyles.prefix')}</label>
            <textarea
              rows={4}
              value={style.positivePrefix}
              onChange={(e) => handleUpdate({ positivePrefix: e.target.value })}
              placeholder={t('settings.imageGen.naturalStyles.prefixPlaceholder')}
            />
          </div>
          <div className="style-editor-field">
            <label>{t('settings.imageGen.naturalStyles.postfix')}</label>
            <textarea
              rows={4}
              value={style.positivePostfix}
              onChange={(e) => handleUpdate({ positivePostfix: e.target.value })}
              placeholder={t('settings.imageGen.naturalStyles.postfixPlaceholder')}
            />
          </div>
        </div>
      </div>
      <div className="style-editor-field-group">
        <label className="style-editor-group-label">{t(`${pairedStyleKey}.negativePrompt`)}</label>
        <div className="style-editor-field-row">
          <div className="style-editor-field">
            <label>{t('settings.imageGen.naturalStyles.prefix')}</label>
            <textarea
              rows={4}
              value={style.negativePrefix}
              onChange={(e) => handleUpdate({ negativePrefix: e.target.value })}
              placeholder={t('settings.imageGen.naturalStyles.prefixPlaceholder')}
            />
          </div>
          <div className="style-editor-field">
            <label>{t('settings.imageGen.naturalStyles.postfix')}</label>
            <textarea
              rows={4}
              value={style.negativePostfix}
              onChange={(e) => handleUpdate({ negativePostfix: e.target.value })}
              placeholder={t('settings.imageGen.naturalStyles.postfixPlaceholder')}
            />
          </div>
        </div>
      </div>
      {(style.positivePrefix || style.positivePostfix || style.negativePrefix || style.negativePostfix) && (
        <div className="style-editor-preview style-editor-preview--positive-negative">
          <div className="style-editor-preview-row">
            <span className="style-editor-preview-label style-editor-preview-label--positive">+</span>
            <span className="style-editor-preview-text">
              {style.positivePrefix}<em>[prompt]</em>{style.positivePostfix}
            </span>
          </div>
          <div className="style-editor-preview-row">
            <span className="style-editor-preview-label style-editor-preview-label--negative">−</span>
            <span className="style-editor-preview-text">
              {style.negativePrefix}<em>[prompt]</em>{style.negativePostfix}
            </span>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="style-editor-inline">
      {/* Toolbar: style selector + create/delete */}
      <div className="style-editor-toolbar">
        <CustomSelect
          value={selectedStyleId || ''}
          onChange={(value) => setSelectedStyleId(value || null)}
          options={styles.map((s) => ({ value: s.id, label: s.name }))}
          placeholder={t(`${tp}.noStyles`)}
          disabled={styles.length === 0}
        />
        <TextButton size="sm" variant="secondary" onClick={handleCreate}>
          + {t(`${tp}.addStyle`)}
        </TextButton>
      </div>

      {/* Style editor or empty state */}
      {selectedStyle ? (
        mode === 'natural'
          ? renderNaturalEditor(selectedStyle as NaturalImageStyle)
          : renderPairedEditor(selectedStyle as PositiveNegativeImageStyle)
      ) : (
        <div className="style-editor-empty">{t(`${tp}.noStyles`)}</div>
      )}

      <div className="style-editor-footer">
        <TextButton
          size="sm"
          variant="danger"
          onClick={handleDelete}
          disabled={!selectedStyleId}
        >
          {t(`${tp}.deleteStyle`)}
        </TextButton>
      </div>
    </div>
  );
};

export default ImageStyleEditorModal;
