import { forwardRef } from 'react';

import ManuscriptEditor, {
  type ManuscriptEditorRef,
} from '../../pages/noveleditor/components/ManuscriptEditor';
import type { TipTapDoc } from '../../types/tiptap';

export type RichTextEditorRef = ManuscriptEditorRef;

interface RichTextEditorProps {
  initialContent: TipTapDoc;
  onChange: (doc: TipTapDoc) => void;
  placeholder?: string;
  disabled?: boolean;
  onBrowseAssets?: () => void;
  toolbarActions?: React.ReactNode;
  onSwapImage?: (currentSrc: string, imageBounds: DOMRect | null) => void;
  onRegenerateImage?: (currentSrc: string, imageBounds: DOMRect | null) => void;
}

const RichTextEditor = forwardRef<RichTextEditorRef, RichTextEditorProps>((props, ref) => (
  <ManuscriptEditor
    ref={ref}
    initialDoc={props.initialContent}
    onChange={props.onChange}
    placeholder={props.placeholder}
    disabled={props.disabled}
    onBrowseAssets={props.onBrowseAssets}
    toolbarActions={props.toolbarActions}
    onSwapImage={props.onSwapImage}
    onRegenerateImage={props.onRegenerateImage}
  />
));

RichTextEditor.displayName = 'RichTextEditor';

export default RichTextEditor;
