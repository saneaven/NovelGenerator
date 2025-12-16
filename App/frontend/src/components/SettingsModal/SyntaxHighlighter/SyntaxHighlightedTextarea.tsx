import React, { useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { templateLanguage } from './templateLanguage';
import { templateTheme } from './templateTheme';

interface SyntaxHighlightedTextareaProps
{
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}

/**
 * CodeMirror-based textarea with syntax highlighting
 * Fills its container height (parent must have defined height)
 */
const SyntaxHighlightedTextarea: React.FC<SyntaxHighlightedTextareaProps> = ({
    value,
    onChange,
    placeholder = '',
}) =>
{
    const editorRef = useRef<any>(null);

    // Custom extension for Tab handling (insert 2 spaces)
    const tabExtension = keymap.of([
        {
            key: 'Tab',
            run: (view) =>
            {
                const { state } = view;
                const changes = state.changeByRange((range) =>
                {
                    return {
                        changes: { from: range.from, to: range.to, insert: '  ' },
                        range: EditorSelection.range(range.from + 2, range.from + 2),
                    };
                });
                view.dispatch(changes);
                return true;
            },
        },
        {
            key: 'Shift-Tab',
            run: () => true, // Prevent Shift+Tab from changing focus
        },
    ]);

    // Height extension - fill container
    const heightExtension = EditorView.theme({
        '&': {
            height: '100%',
        },
        '.cm-scroller': {
            overflow: 'auto',
        },
    });

    return (
        <CodeMirror
            ref={editorRef}
            value={value}
            onChange={(value) => onChange(value)}
            placeholder={placeholder}
            extensions={[
                templateLanguage,
                templateTheme,
                tabExtension,
                heightExtension,
                EditorView.lineWrapping,
            ]}
            basicSetup={{
                lineNumbers: false,
                highlightActiveLineGutter: false,
                highlightActiveLine: true,
                foldGutter: false,
                dropCursor: true,
                allowMultipleSelections: true,
                indentOnInput: true,
                bracketMatching: true,
                closeBrackets: false,
                autocompletion: false,
                rectangularSelection: true,
                crosshairCursor: true,
                highlightSelectionMatches: false,
                closeBracketsKeymap: false,
                searchKeymap: false,
                foldKeymap: false,
                completionKeymap: false,
                lintKeymap: false,
            }}
        />
    );
};

export default SyntaxHighlightedTextarea;
