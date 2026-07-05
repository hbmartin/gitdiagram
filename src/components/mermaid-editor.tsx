"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

interface MermaidEditorProps {
  /** The mermaid source currently rendered. */
  value: string;
  /** Called with valid mermaid source after debounce; drives the live preview. */
  onApply: (next: string) => void;
  onReset: () => void;
  isEdited: boolean;
}

const VALIDATE_DEBOUNCE_MS = 500;

export function MermaidEditor({
  value,
  onApply,
  onReset,
  isEdited,
}: MermaidEditorProps) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestTextRef = useRef(text);

  // Track external changes (regeneration, reset, version switch).
  useEffect(() => {
    setText(value);
    setError(null);
    latestTextRef.current = value;
  }, [value]);

  const validateAndApply = useCallback(
    (candidate: string) => {
      setValidating(true);
      void (async () => {
        try {
          await mermaid.parse(candidate);
          if (latestTextRef.current === candidate) {
            setError(null);
            onApply(candidate);
          }
        } catch (parseError) {
          if (latestTextRef.current === candidate) {
            setError(
              parseError instanceof Error
                ? parseError.message
                : "Invalid Mermaid syntax.",
            );
          }
        } finally {
          if (latestTextRef.current === candidate) {
            setValidating(false);
          }
        }
      })();
    },
    [onApply],
  );

  const handleChange = useCallback(
    (next: string) => {
      setText(next);
      latestTextRef.current = next;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        validateAndApply(next);
      }, VALIDATE_DEBOUNCE_MS);
    },
    [validateAndApply],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <div className="w-full max-w-5xl px-4">
      <div className="rounded-md border-2 border-black bg-white p-3 dark:border-neutral-600 dark:bg-neutral-900">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">
            Edit Mermaid source
            {isEdited && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                edited locally — not saved
              </span>
            )}
          </span>
          <div className="flex items-center gap-3 text-xs">
            {validating && <span className="text-gray-500">Validating…</span>}
            {!validating && !error && isEdited && (
              <span className="text-green-700 dark:text-green-400">
                Valid — preview updated
              </span>
            )}
            {isEdited && (
              <button
                type="button"
                onClick={onReset}
                className="rounded border border-purple-400 px-2 py-1 font-medium text-purple-800 hover:bg-purple-100 dark:text-purple-200 dark:hover:bg-purple-950"
              >
                Reset to generated
              </button>
            )}
          </div>
        </div>
        <textarea
          value={text}
          onChange={(event) => handleChange(event.target.value)}
          spellCheck={false}
          rows={14}
          aria-label="Mermaid diagram source"
          className="w-full resize-y rounded border border-gray-300 bg-gray-50 p-2 font-mono text-xs leading-relaxed dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200"
        />
        {error && (
          <div className="mt-2 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs whitespace-pre-wrap text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
