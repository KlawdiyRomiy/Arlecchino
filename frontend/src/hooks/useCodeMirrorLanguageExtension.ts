import { useEffect, useRef, useState } from "react";
import type { Extension } from "@codemirror/state";

import {
  getLoadedCodeMirrorLanguageExtension,
  loadCodeMirrorLanguageExtension,
} from "../utils/codeMirrorLanguageRegistry";

export function useCodeMirrorLanguageExtension(
  language: string,
): Extension | null {
  const requestSeqRef = useRef(0);
  const [state, setState] = useState<{
    language: string;
    extension: Extension | null;
  }>(() => ({
    language,
    extension: getLoadedCodeMirrorLanguageExtension(language),
  }));

  useEffect(() => {
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;

    setState({
      language,
      extension: getLoadedCodeMirrorLanguageExtension(language),
    });

    let cancelled = false;
    void loadCodeMirrorLanguageExtension(language).then((loadedExtension) => {
      if (cancelled || requestSeqRef.current !== requestSeq) {
        return;
      }
      setState({ language, extension: loadedExtension });
    });

    return () => {
      cancelled = true;
    };
  }, [language]);

  if (state.language !== language) {
    return getLoadedCodeMirrorLanguageExtension(language);
  }

  return state.extension;
}
