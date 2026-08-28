(() => {
  const HOTFIX_VERSION = "6.4-content-loop-manual-takeover-v2";

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

    // 3) Etat de prise en main manuelle.
    code = replaceOnce(
      code,
      "état takeover manuel",
      "      manualResumeAt: null,\n      panelCollapsed: false,",
      [
        "      manualResumeAt: null,",
        "      manualValidationHold: false,",
        "      manualValidationHoldProgress: null,",
        "      manualValidationHoldKey: null,",
        "      manualValidationNavigationSeen: false,",
        "      manualValidationHoldAt: null,",
        "      panelCollapsed: false,"
      ].join("\n")
    );

    // 4) Garde universelle : quand l'utilisateur a utilisé Valider/Suivant/Passer
    // manuellement, aucun clic automatique de navigation n'est permis tant qu'une vraie
    // nouvelle question n'a pas été détectée.
    code = replaceOnce(
      code,
      "garde clic navigation manuelle",
      "  const clickElement = async (el) => {\n    if (!el || !isVisible(el) || !isEnabled(el)) return false;\n    el.scrollIntoView?.({ block: \"center\", inline: \"center\" });",
      [
        "  const clickElement = async (el) => {",
        "    if (!el || !isVisible(el) || !isEnabled(el)) return false;",
        "",
        "    const clickLabel = controlText(el);",
        "    const clickLoose = normLoose(clickLabel);",
        "    const automaticNavigationTexts = [...state.config.nextTexts, ...state.config.passTexts].map(normLoose);",
        "    const isAutomaticNavigation = automaticNavigationTexts.some((wanted) =>",
        "      clickLoose === wanted || clickLoose.startsWith(wanted + ' ')",
        "    );",
        "",
        "    if (state.agent.manualValidationHold && isAutomaticNavigation) {",
        "      log('Navigation automatique \\\"' + (clickLabel || 'Suivant/Passer') + '\\\" bloquée : tu as pris la main manuellement. Attente d’une vraie nouvelle question.');",
        "      return false;",
        "    }",
        "",
        "    el.scrollIntoView?.({ block: \"center\", inline: \"center\" });"
      ].join("\n")
    );

    // 5) Le clic manuel arme la retenue. Important : un clic manuel Suivant/Passer
    // NE LEVE PAS la retenue immédiatement. Le DOM peut encore être sur l'ancienne
    // correction et c'est exactement ce qui provoquait le clic automatique sur Passer.
    code = replaceOnce(
      code,
      "armement takeover manuel",
      "  ) => {\n    if (!state.config.agent.autoAnswer) return;\n\n    // v6.2 : armer la reprise SYNCHRONEMENT, dès le clic (listener en capture).",
      [
        "  ) => {",
        "    if (!state.config.agent.autoAnswer) return;",
        "",
        "    if (actionKind === \"validate\") {",
        "      if (!state.agent.manualValidationHold) {",
        "        const manualQuestion = detectQuestion();",
        "        state.agent.manualValidationHoldProgress = currentProgressMarker() || null;",
        "        state.agent.manualValidationHoldKey = manualQuestion?.key || null;",
        "      }",
        "      state.agent.manualValidationHold = true;",
        "      state.agent.manualValidationNavigationSeen = false;",
        "      state.agent.manualValidationHoldAt = Date.now();",
        "      log('Validation manuelle détectée : aucune navigation automatique jusqu’à la prochaine vraie question.');",
        "    } else {",
        "      if (!state.agent.manualValidationHold) {",
        "        const manualQuestion = detectQuestion();",
        "        state.agent.manualValidationHoldProgress = currentProgressMarker() || null;",
        "        state.agent.manualValidationHoldKey = manualQuestion?.key || null;",
        "      }",
        "      state.agent.manualValidationHold = true;",
        "      state.agent.manualValidationNavigationSeen = true;",
        "      state.agent.manualValidationHoldAt = Date.now();",
        "      log('Navigation manuelle détectée : l’Auto attend la prochaine vraie question avant de reprendre.');",
        "    }",
        "",
        "    // v6.2 : armer la reprise SYNCHRONEMENT, dès le clic (listener en capture)."
      ].join("\n")
    );

    // 6) La retenue n'est levée qu'au début du traitement d'une vraie question.
    // Feedback/correction, page vide, page de contenu et ancienne réponse remplie ne suffisent pas.
    code = replaceOnce(
      code,
      "libération takeover sur vraie question",
      "      let q = detectQuestion();\n      renderPanel(q);",
      [
        "      let q = detectQuestion();",
        "",
        "      if (state.agent.manualValidationHold) {",
        "        const currentProgress = currentProgressMarker() || null;",
        "        const heldProgress = state.agent.manualValidationHoldProgress;",
        "        const heldKey = state.agent.manualValidationHoldKey;",
        "        const genuineQuestion = !['feedback', 'none', 'unknown-question'].includes(q.type);",
        "        const movedProgress = !!heldProgress && !!currentProgress && currentProgress !== heldProgress;",
        "        const movedKey = !!heldKey && !!q.key && q.key !== heldKey;",
        "        const navigationSeen = !!state.agent.manualValidationNavigationSeen;",
        "        const sameAnsweredPage = q.type === 'answered' && !movedProgress && !movedKey;",
        "",
        "        if (genuineQuestion && !sameAnsweredPage && (navigationSeen || movedProgress || movedKey)) {",
        "          state.agent.manualValidationHold = false;",
        "          state.agent.manualValidationHoldProgress = null;",
        "          state.agent.manualValidationHoldKey = null;",
        "          state.agent.manualValidationNavigationSeen = false;",
        "          state.agent.manualValidationHoldAt = null;",
        "          log('Nouvelle vraie question détectée : reprise automatique autorisée.');",
        "        }",
        "      }",
        "",
        "      renderPanel(q);"
      ].join("\n")
    );

    // 7) Une page passive/correction ne navigue jamais automatiquement sous takeover.
    // En fonctionnement purement automatique, la logique normale reste inchangée.
    const navigationReplacement = [
      "  const navigatePassivePage = async (label) => {",
      "    if (state.agent.manualValidationHold) {",
      "      log(label + ': action manuelle en cours; Suivant/Passer automatiques désactivés jusqu’à la prochaine vraie question.');",
      "      return false;",
      "    }",
      "",
      "    let next = findActionButton(state.config.nextTexts);",
      "    if (!next) next = await waitForActionButton(state.config.nextTexts, state.config.agent.passiveNavigationWaitMs);",
      "",
      "    if (next) {",
      "      log(label + ': navigation via ' + controlText(next) + '.');",
      "      const clicked = await clickElement(next);",
      "      if (!clicked) return false;",
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
      "      log(label + ': navigation autorisée via ' + controlText(pass) + ' car la réponse est déjà soumise/corrigée.');",
      "      const clicked = await clickElement(pass);",
      "      if (!clicked) return false;",
      "      await wait(state.config.settleDelayMs);",
      "      return true;",
      "    }",
      "",
      "    if (pass) {",
      "      log(label + ': ' + controlText(pass) + ' visible mais soumission non confirmée; Passer bloqué.');",
      "      return false;",
      "    }",
      "",
      "    log(label + ': aucun bouton de navigation fiable disponible.');",
      "    return false;",
      "  };"
    ].join("\n");

    code = replaceBetween(
      code,
      "navigation passive + takeover manuel",
      "  const navigatePassivePage = async (label) => {",
      "  const validateIfPresent = async () => {",
      navigationReplacement
    );

    return code;
  };

  console.log(`[Global Exam Hotfix] ${HOTFIX_VERSION} prêt.`);
})();
