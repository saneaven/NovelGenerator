import React, { useCallback, useRef } from 'react';
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
    const lastEmittedValueRef = useRef(value);

    const emitChangeIfNeeded = useCallback((nextValue: string) =>
    {
        if (nextValue === lastEmittedValueRef.current) return;
        lastEmittedValueRef.current = nextValue;
        onChange(nextValue);
    }, [onChange]);

    // Detect mobile devices
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

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

    return (
        <CodeMirror
            ref={editorRef}
            value={value}
            height="100%"
            className="syntax-highlighted-textarea"
            onChange={(nextValue) => emitChangeIfNeeded(nextValue)}
            placeholder={placeholder}
            extensions={[
                templateLanguage,
                templateTheme,
                tabExtension,
                EditorView.lineWrapping,
            ]}
            basicSetup={{
                lineNumbers: false,
                highlightActiveLineGutter: false,
                highlightActiveLine: true,
                foldGutter: false,
                dropCursor: true,
                indentOnInput: true,
                bracketMatching: true,
                closeBrackets: false,
                autocompletion: false,
                highlightSelectionMatches: false,
                closeBracketsKeymap: false,
                searchKeymap: false,
                foldKeymap: false,
                completionKeymap: false,
                lintKeymap: false,
                // Disable desktop-only features on mobile for better touch selection
                allowMultipleSelections: !isMobile,
                rectangularSelection: !isMobile,
                crosshairCursor: !isMobile,
            }}
        />
    );
};

export default SyntaxHighlightedTextarea;
