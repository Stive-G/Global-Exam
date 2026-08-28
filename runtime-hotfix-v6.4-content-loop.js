(() => {
  const HOTFIX_VERSION = "6.4-content-loop";

  const replaceOnce = (source, label, before, after) => {
    if (!source.includes(before)) {
      throw new Error(`[Hotfix ${HOTFIX_VERSION}] Bloc introuvable: ${label}.`);
    }
    return source.replace(before, after);
  };

  const replaceBetween = (source, label, startMarker, endMarker, replacement) => {
    const start = source.indexOf(startMarker);
    if (start < 0) throw new Error(`[Hotfix ${HOTFIX_VERSION}] Début introuvable: ${label}.`);
    const end = source.indexOf(endMarker, start + startMarker.length);
    if (end < 0) throw new Error(`[Hotfix ${HOTFIX_VERSION}] Fin introuvable: ${label}.`);
    return source.slice(0, start) + replacement + "\n\n" + source.slice(end);
  };

  window.__applyGlobalExamV64ContentLoopFix = (source) => {
    let code = String(source || "");

    // 1) Les contrôles de transcript / média / zoom / feedback ne sont jamais des réponses.
    const noiseReplacement = [
      "  // Les contrôles de média, transcript, zoom et feedback ne sont jamais des réponses.",
      "  const isExerciseUiNoiseText = (text) => {",
      "    const raw = String(text || \"\").trim();",
      "    const t = normLoose(raw);",
      "    if (!t) return true;",
      "    if (/^\\d{1,3}\\s*\\/\\s*\\d{1,3}$/.test(raw)) return true;",
      "    if (/^\\d{1,2}:\\d{2}\\s*\\/\\s*\\d{1,2}:\\d{2}$/.test(raw)) return true;",
      "",
      "    const exact = [",
      "      'play','pause','volume','mute','unmute','audio','sound','video',",
      "      'lire la video','lire la vidéo','ecouter','écouter','ecouter audio','écouter audio',",
      "      'listen','listen audio','play video','play audio','replay','restart','back','previous',",
      "      'voir le transcript','afficher le transcript','fermer le transcript','masquer le transcript',",
      "      'show transcript','view transcript','open transcript','close transcript','hide transcript',",
      "      'zoomer','dezoomer','dézoomer','zoom in','zoom out',",
      "      'ouvrir le formulaire de retour','open feedback form','feedback'",
      "    ].map(normLoose);",
      "",
      "    if (exact.includes(t)) return true;",
      "    if (/^(play|pause|listen|lire|ecouter|volume|mute|audio|video)\\b/.test(t)) return true;",
      "    if (/\\btranscript\\b/.test(t)) return true;",
      "    if (/^(zoomer|dezoomer|zoom in|zoom out)$/.test(t)) return true;",
      "    if (/feedback form|formulaire de retour/.test(t)) return true;",
      "    if (/feedback[_\\-.]?form|checkbox_available|available_to_discuss/.test(raw.toLowerCase())) return true;",
      "    return false;",
      "  };"
    ].join("\n");

    code = replaceBetween(
      code,
      "bruit UI transcript/zoom",
      "  // v5.5 - Les contrôles du lecteur audio/video ne sont jamais des réponses.",
      "  const collectDragItems = (root) => {",
      noiseReplacement
    );

    // 2) Les pages 0/N de support (transcript, vocabulaire, média) sont du contenu passif.
    const passiveHelper = [
      "  const isPassiveZeroProgressContentPage = () => {",
      "    const marker = String(currentProgressMarker() || \"\").trim();",
      "    const m = marker.match(/^(\\d+)\\s*\\/\\s*(\\d+)$/);",
      "    if (!m || Number(m[1]) !== 0 || Number(m[2]) <= 0) return false;",
      "",
      "    if (getLiveZoneElements(document.body).length > 0) return false;",
      "    if (hasWritableQuestionControl()) return false;",
      "    if (findActionButton?.(state.config.validateTexts)) return false;",
      "    return true;",
      "  };",
      ""
    ].join("\n");

    code = replaceOnce(
      code,
      "helper page contenu 0/N",
      "  const detectQuestion = () => {\n",
      passiveHelper + "  const detectQuestion = () => {\n"
    );

    code = replaceOnce(
      code,
      "détection page contenu 0/N",
      "  const detectQuestion = () => {\n    if (isFeedbackPage()) return { type: \"feedback\", root: findQuestionRoot(), prompt: \"\", key: \"feedback\" };\n",
      "  const detectQuestion = () => {\n    if (isFeedbackPage()) return { type: \"feedback\", root: findQuestionRoot(), prompt: \"\", key: \"feedback\" };\n\n    if (isPassiveZeroProgressContentPage()) {\n      return { type: \"none\", root: findQuestionRoot(), prompt: \"\", key: \"content::\" + pageIdentity() };\n    }\n"
    );

    // 3) Sur une page passive, Suivant est autorisé. Passer ne l'est que si la réponse est déjà soumise/corrigée.
    const navigationReplacement = [
      "  const navigatePassivePage = async (label) => {",
      "    let next = findActionButton(state.config.nextTexts);",
      "    if (!next) next = await waitForActionButton(state.config.nextTexts, state.config.agent.passiveNavigationWaitMs);",
      "",
      "    if (next) {",
      "      log(label + ': navigation via \\\"' + controlText(next) + '\\\".');",
      "      await clickElement(next);",
      "      await wait(state.config.settleDelayMs);",
      "      return true;",
      "    }",
      "",
      "    const pass = findActionButton(state.config.passTexts);",
      "    const labelLoose = normLoose(label);",
      "    const passAllowed = !!pass && (",
      "      isFeedbackPage() ||",
      "      hasSubmittedState() ||",
      "      labelLoose.includes('correction') ||",
      "      labelLoose.includes('resultat') ||",
      "      labelLoose.includes('apres validation')",
      "    );",
      "",
      "    if (passAllowed) {",
      "      log(label + ': navigation autorisée via \\\"' + controlText(pass) + '\\\" car la réponse est déjà soumise/corrigée.');",
      "      await clickElement(pass);",
      "      await wait(state.config.settleDelayMs);",
      "      return true;",
      "    }",
      "",
      "    if (pass) {",
      "      log(label + ': \\\"' + controlText(pass) + '\\\" visible mais soumission non confirmée; Passer bloqué.');",
      "      return false;",
      "    }",
      "",
      "    log(label + ': aucun bouton de navigation fiable disponible.');",
      "    return false;",
      "  };"
    ].join("\n");

    code = replaceBetween(
      code,
      "navigation passive sans Passer non soumis",
      "  const navigatePassivePage = async (label) => {",
      "  const validateIfPresent = async () => {",
      navigationReplacement
    );

    return code;
  };

  console.log(`[Global Exam Hotfix] ${HOTFIX_VERSION} prêt.`);
})();
