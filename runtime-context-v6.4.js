(() => {
  const CONTEXT_PATCH_VERSION = "6.4-context-v1";

  const replaceOnce = (source, label, before, after) => {
    if (!source.includes(before)) {
      throw new Error(`[Context ${CONTEXT_PATCH_VERSION}] Bloc introuvable: ${label}.`);
    }
    return source.replace(before, after);
  };

  window.__applyGlobalExamV64ContextPatch = (source) => {
    let code = String(source || "");

    // Mémoire de contexte de l'activité : pages d'introduction, cours, vocabulaire
    // et transcriptions ouvertes depuis Global Exam.
    code = replaceOnce(
      code,
      "état contexte activité",
      "      providerHistory: [],\n    },",
      [
        "      providerHistory: [],",
        "      activityContextId: null,",
        "      activityContextSnippets: [],",
        "      activityContextKeys: new Set(),",
        "      transcriptCaptureBusy: false,",
        "    },"
      ].join("\n")
    );

    const contextHelpers = [
      "  // v6.4 contexte — mémoriser le sujet de l'activité et les transcriptions.",
      "  const currentActivityContextId = () => {",
      "    const m = String(location.pathname || '').match(/\\/activity\\/([^/]+)/i);",
      "    return m?.[1] || String(location.pathname || 'activity');",
      "  };",
      "",
      "  const ensureActivityContextIdentity = () => {",
      "    const id = currentActivityContextId();",
      "    if (state.agent.activityContextId !== id) {",
      "      state.agent.activityContextId = id;",
      "      state.agent.activityContextSnippets = [];",
      "      state.agent.activityContextKeys = new Set();",
      "      agentLog('Nouveau contexte d’activité : mémoire du sujet réinitialisée.');",
      "    }",
      "    return id;",
      "  };",
      "",
      "  const contextTextFromNode = (root) => {",
      "    if (!root) return '';",
      "    let clone;",
      "    try { clone = root.cloneNode(true); } catch { return ''; }",
      "    try {",
      "      clone.querySelectorAll(",
      "        '#global-exam-assistant,.global-exam-assistant-badge,button,input,textarea,select,nav,footer,[role=button],[role=navigation],script,style'",
      "      ).forEach((n) => n.remove());",
      "    } catch {}",
      "    let value = String(clone.innerText || clone.textContent || '')",
      "      .replace(/feedback_form\\.[a-z0-9_.-]+/gi, ' ')",
      "      .replace(/\\b\\d{1,2}:\\d{2}\\s*\\/\\s*\\d{1,2}:\\d{2}\\b/g, ' ')",
      "      .replace(/\\s+/g, ' ').trim();",
      "    return value.slice(0, 7000);",
      "  };",
      "",
      "  const rememberActivityContext = (kind, text, marker = currentProgressMarker()) => {",
      "    ensureActivityContextIdentity();",
      "    const cleaned = String(text || '').replace(/\\s+/g, ' ').trim();",
      "    if (cleaned.length < 25) return false;",
      "    const key = normLoose(kind + '::' + cleaned).slice(0, 1200);",
      "    if (!key || state.agent.activityContextKeys.has(key)) return false;",
      "    state.agent.activityContextKeys.add(key);",
      "    state.agent.activityContextSnippets.push({",
      "      kind: String(kind || 'CONTEXTE'),",
      "      text: cleaned.slice(0, 6500),",
      "      marker: String(marker || ''),",
      "      at: Date.now(),",
      "    });",
      "    state.agent.activityContextSnippets = state.agent.activityContextSnippets.slice(-14);",
      "    agentLog('Contexte mémorisé : ' + kind + ' (' + cleaned.length + ' caractères).');",
      "    return true;",
      "  };",
      "",
      "  const rememberPassivePageContext = () => {",
      "    if (isFeedbackPage()) return false;",
      "    const root = document.querySelector('main,[role=main]') || document.body;",
      "    const text = contextTextFromNode(root);",
      "    if (!text) return false;",
      "    return rememberActivityContext('CONTENU / SUJET DE L’ACTIVITÉ', text);",
      "  };",
      "",
      "  const transcriptControls = () => visibleControls(",
      "    'button,a,[role=button]', document",
      "  ).filter((el) => /transcript/.test(normLoose(controlText(el))));",
      "",
      "  const transcriptContainerText = () => {",
      "    const explicit = [...document.querySelectorAll(\"[class*='transcript'],[id*='transcript']\")]",
      "      .filter((el) => isVisible(el) && !isAssistantElement(el))",
      "      .map((el) => ({ el, text: contextTextFromNode(el) }))",
      "      .filter((x) => x.text.length >= 25)",
      "      .sort((a, b) => a.text.length - b.text.length);",
      "    if (explicit.length) return explicit[0].text;",
      "",
      "    const close = transcriptControls().find((el) => /^(fermer|masquer|close|hide)\\b/.test(normLoose(controlText(el))));",
      "    if (!close) return '';",
      "    const options = [];",
      "    let cur = close.parentElement;",
      "    for (let depth = 0; cur && depth < 7; depth++, cur = cur.parentElement) {",
      "      const text = contextTextFromNode(cur);",
      "      if (text.length >= 25 && text.length <= 7000) options.push(text);",
      "    }",
      "    options.sort((a, b) => a.length - b.length);",
      "    return options[0] || '';",
      "  };",
      "",
      "  const captureTranscriptContextForCurrentPage = async () => {",
      "    ensureActivityContextIdentity();",
      "    if (state.agent.transcriptCaptureBusy || isFeedbackPage()) return false;",
      "    state.agent.transcriptCaptureBusy = true;",
      "    let openedByUs = false;",
      "    try {",
      "      let controls = transcriptControls();",
      "      let close = controls.find((el) => /^(fermer|masquer|close|hide)\\b/.test(normLoose(controlText(el))));",
      "      const open = controls.find((el) => /^(voir|afficher|ouvrir|show|view|open)\\b/.test(normLoose(controlText(el))));",
      "",
      "      if (!close && open) {",
      "        agentLog('Transcription détectée : ouverture temporaire pour donner le contexte à l’IA.');",
      "        if (await clickElement(open)) {",
      "          openedByUs = true;",
      "          await waitForStablePage(250, 1800);",
      "          controls = transcriptControls();",
      "          close = controls.find((el) => /^(fermer|masquer|close|hide)\\b/.test(normLoose(controlText(el))));",
      "        }",
      "      }",
      "",
      "      const transcript = transcriptContainerText();",
      "      const saved = transcript ? rememberActivityContext('TRANSCRIPTION AUDIO', transcript) : false;",
      "",
      "      if (openedByUs && close?.isConnected) {",
      "        await clickElement(close);",
      "        await wait(180);",
      "      }",
      "      return saved;",
      "    } finally {",
      "      state.agent.transcriptCaptureBusy = false;",
      "    }",
      "  };",
      "",
      "  const currentMediaContextState = () => {",
      "    const body = String(document.body?.innerText || '');",
      "    const hasMedia = !!document.querySelector('audio,video') || /\\b\\d{1,2}:\\d{2}\\s*\\/\\s*\\d{1,2}:\\d{2}\\b/.test(body);",
      "    const marker = String(currentProgressMarker() || '');",
      "    const hasTranscript = state.agent.activityContextSnippets.some((x) =>",
      "      x.kind === 'TRANSCRIPTION AUDIO' && (!marker || x.marker === marker)",
      "    ) || transcriptControls().some((el) => /^(fermer|masquer|close|hide)\\b/.test(normLoose(controlText(el))));",
      "    return { hasMedia, hasTranscript, marker };",
      "  };",
      "",
      "  const activityContextPrompt = () => {",
      "    ensureActivityContextIdentity();",
      "    const snippets = state.agent.activityContextSnippets.slice(-10);",
      "    const media = currentMediaContextState();",
      "    const lines = [",
      "      'RÈGLE DE CONTEXTE : réponds d’abord à partir du contenu de CETTE activité Global Exam. Ne remplace pas le contenu du cours ou de la transcription par tes connaissances générales.',",
      "      'Si le contexte de l’activité contredit une connaissance générale, le contexte de l’activité est prioritaire.',",
      "    ];",
      "    if (snippets.length) {",
      "      lines.push('', 'CONTEXTE MÉMORISÉ DE L’ACTIVITÉ :');",
      "      snippets.forEach((s, i) => lines.push('[' + (i + 1) + '] ' + s.kind + (s.marker ? ' (' + s.marker + ')' : '') + ' : ' + s.text));",
      "    } else {",
      "      lines.push('', 'Aucun contexte de cours/transcription mémorisé pour le moment.');",
      "    }",
      "    if (media.hasMedia && !media.hasTranscript) {",
      "      lines.push('', 'ATTENTION : un média audio/vidéo est présent mais aucune transcription exploitable n’a été trouvée pour cette page. Ne devine pas le contenu audio. Si la réponse en dépend, donne une confiance <= 0.45.');",
      "    }",
      "    return lines.join('\\n').slice(0, 11000);",
      "  };",
      ""
    ].join("\n");

    code = replaceOnce(
      code,
      "helpers contexte avant prompt",
      "  const promptForQuestion = (q) => {\n",
      contextHelpers + "  const promptForQuestion = (q) => {\n    const contextBlock = activityContextPrompt();\n"
    );

    code = replaceOnce(
      code,
      "contexte prompt drag-drop",
      "        `Instruction: ${q.prompt}`,",
      "        contextBlock,\n        \"\",\n        `Instruction: ${q.prompt}` ,"
    );

    code = replaceOnce(
      code,
      "contexte prompt général",
      "    return [...common, formats[q.type] || 'Format: {\"confidence\":0.5,\"explanation\":\"type non géré\"}', \"\", serialized].join(\"\\n\");",
      "    return [...common, \"\", contextBlock, \"\", formats[q.type] || 'Format: {\"confidence\":0.5,\"explanation\":\"type non géré\"}', \"\", serialized].join(\"\\n\");"
    );

    code = replaceOnce(
      code,
      "system prompt ancré activité",
      "                  content: \"Tu es un moteur de résolution d'exercices. Analyse correctement la question et respecte strictement le schéma JSON imposé par le serveur.\"",
      "                  content: \"Tu es un moteur de résolution d'exercices Global Exam. Utilise en priorité le contexte de l'activité et les transcriptions fournis dans le message utilisateur. Ne réponds pas de mémoire générale si l'exercice dépend d'un contenu spécifique absent. Respecte strictement le schéma JSON imposé par le serveur.\""
    );

    // Même les QCM simples sont revérifiés : une réponse plausible de culture générale
    // n'est pas suffisante pour une activité basée sur un cours ou un audio précis.
    code = replaceOnce(
      code,
      "double vérification tous types",
      "  const needsDoubleCheck = (q) => state.config.agent.doubleCheckComplex && [\n    \"multi-choice\", \"text\", \"multi-text\", \"select\", \"multi-select\", \"drag-drop\", \"ordering\", \"matching\", \"matrix\"\n  ].includes(q.type);",
      "  const needsDoubleCheck = (q) => state.config.agent.doubleCheckComplex && [\n    \"single-choice\", \"button-choice\", \"multi-choice\", \"text\", \"multi-text\", \"select\", \"multi-select\", \"drag-drop\", \"ordering\", \"matching\", \"matrix\"\n  ].includes(q.type);"
    );

    // Si un audio est présent sans transcription, la confiance est plafonnée pour
    // empêcher l'application automatique d'une réponse inventée.
    code = replaceOnce(
      code,
      "plafond confiance audio sans transcript",
      "          result.explanation = String(result.explanation || \"\").trim();\n          result.provider = String(payload?.provider || \"inconnu\");",
      "          result.explanation = String(result.explanation || \"\").trim();\n          const mediaContext = currentMediaContextState();\n          if (mediaContext.hasMedia && !mediaContext.hasTranscript) {\n            result.confidence = Math.min(result.confidence, 0.45);\n            result.explanation = (result.explanation ? result.explanation + ' ' : '') + '[Confiance plafonnée : média présent sans transcription exploitable.]';\n          }\n          result.provider = String(payload?.provider || \"inconnu\");"
    );

    // Avant chaque analyse, essayer de récupérer la transcription de la page courante.
    code = replaceOnce(
      code,
      "capture transcript avant analyse",
      "    // Cas déterministe : un seul choix visible pour un seul trou.",
      "    ensureActivityContextIdentity();\n    await captureTranscriptContextForCurrentPage();\n\n    // Cas déterministe : un seul choix visible pour un seul trou."
    );

    // Une page de contenu est la source principale du sujet de l'activité : la mémoriser
    // AVANT de cliquer sur Suivant.
    code = replaceOnce(
      code,
      "mémorisation page passive",
      "      if (q.type === \"none\") {\n        log(\"Page sans question détectée ; vérification de stabilité avant navigation.\");",
      "      if (q.type === \"none\") {\n        rememberPassivePageContext();\n        log(\"Page sans question détectée ; vérification de stabilité avant navigation.\");"
    );

    // Pendant une reprise manuelle, ne pas spammer « Traitement non terminé » toutes les 5 s.
    // La boucle attend simplement une mutation de DOM et réessaie silencieusement.
    code = replaceOnce(
      code,
      "attente manuelle sans spam",
      "        if (!processed) {\n          if (state.agent.manualResumePending) continue;\n          const retryMs = state.agent.lastResult?.error ? state.config.agent.errorRetryMs : Math.min(5000, state.config.pageDelayMs);\n          log(`Traitement non terminé. Nouvelle vérification dans ${Math.round(retryMs / 1000)}s maximum.`);\n          await waitForWakeOrTimeout(retryMs);\n          continue;\n        }",
      "        if (!processed) {\n          if (state.agent.manualResumePending) continue;\n          if (state.agent.manualValidationHold) {\n            const phase = state.agent.manualValidationPhase || 'transition';\n            const retryMs = phase === 'validated' ? 1200 : 5000;\n            await waitForWakeOrTimeout(retryMs);\n            continue;\n          }\n          const retryMs = state.agent.lastResult?.error ? state.config.agent.errorRetryMs : Math.min(5000, state.config.pageDelayMs);\n          log(`Traitement non terminé. Nouvelle vérification dans ${Math.round(retryMs / 1000)}s maximum.`);\n          await waitForWakeOrTimeout(retryMs);\n          continue;\n        }"
    );

    // Outils de diagnostic du contexte réellement envoyé aux IA.
    code = replaceOnce(
      code,
      "debug contexte export",
      "  window.geUnblock = clearHardBlock;",
      "  window.geDebugContext = () => {\n    ensureActivityContextIdentity();\n    const media = currentMediaContextState();\n    console.table(state.agent.activityContextSnippets.map((x, i) => ({ i, kind:x.kind, marker:x.marker, chars:x.text.length, apercu:x.text.slice(0,180) })));\n    console.log('[Global Exam Assistant] Media context:', media);\n    console.log('[Global Exam Assistant] Contexte envoyé aux IA:\n' + activityContextPrompt());\n    return { activityId: state.agent.activityContextId, media, snippets: state.agent.activityContextSnippets };\n  };\n  window.geCaptureTranscript = captureTranscriptContextForCurrentPage;\n  window.geContextVersion = () => '" + CONTEXT_PATCH_VERSION + "';\n  window.geUnblock = clearHardBlock;"
    );

    return code;
  };

  window.__GLOBAL_EXAM_CONTEXT_PATCH_VERSION = CONTEXT_PATCH_VERSION;
  console.log(`[Global Exam Context] ${CONTEXT_PATCH_VERSION} prêt.`);
})();