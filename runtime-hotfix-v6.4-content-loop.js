(() => {
  const HOTFIX_VERSION = "6.4-content-loop-manual-hold";

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

    // 3) État spécifique : si l'utilisateur clique lui-même sur Valider pour bypasser
    // l'attente de rythme, AUCUNE navigation automatique Suivant/Passer n'est autorisée
    // tant qu'il n'a pas lui-même navigué ou qu'une vraie nouvelle question n'est pas détectée.
    code = replaceOnce(
      code,
      "état retenue après validation manuelle",
      "      manualResumeAt: null,\n      panelCollapsed: false,",
      "      manualResumeAt: null,\n      manualValidationHold: false,\n      manualValidationHoldProgress: null,\n      manualValidationHoldAt: null,\n      panelCollapsed: false,"
    );

    // 4) Garde universelle : tous les clics automatiques passent par clickElement().
    // Cela protège aussi les chemins qui cliquent directement sur Suivant sans passer
    // par navigatePassivePage().
    code = replaceOnce(
      code,
      "garde clic navigation après validation manuelle",
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
        "      const heldProgress = state.agent.manualValidationHoldProgress;",
        "      const currentProgress = currentProgressMarker();",
        "      const genuinelyMoved = !!heldProgress && !!currentProgress &&",
        "        currentProgress !== heldProgress && !isFeedbackPage();",
        "",
        "      if (!genuinelyMoved) {",
        "        log('Navigation automatique \"' + (clickLabel || 'Suivant/Passer') + '\" bloquée : tu as validé manuellement. Clique toi-même sur Suivant/Passer pour continuer.');",
        "        return false;",
        "      }",
        "",
        "      state.agent.manualValidationHold = false;",
        "      state.agent.manualValidationHoldProgress = null;",
        "      state.agent.manualValidationHoldAt = null;",
        "      log('Retenue après validation manuelle levée : une vraie nouvelle question a été détectée.');",
        "    }",
        "",
        "    el.scrollIntoView?.({ block: \"center\", inline: \"center\" });"
      ].join("\n")
    );

    // 5) Dès le clic MANUEL sur Valider, on arme la retenue. Un clic manuel ultérieur
    // sur Suivant/Passer/Terminer la lève immédiatement, puis l'Auto reprend sur la page suivante.
    code = replaceOnce(
      code,
      "armement retenue validation manuelle",
      "  ) => {\n    if (!state.config.agent.autoAnswer) return;\n\n    // v6.2 : armer la reprise SYNCHRONEMENT, dès le clic (listener en capture).",
      [
        "  ) => {",
        "    if (!state.config.agent.autoAnswer) return;",
        "",
        "    if (actionKind === \"validate\") {",
        "      state.agent.manualValidationHold = true;",
        "      state.agent.manualValidationHoldProgress = currentProgressMarker() || null;",
        "      state.agent.manualValidationHoldAt = Date.now();",
        "      log('Validation manuelle détectée : Suivant/Passer automatiques suspendus jusqu’à ta navigation manuelle.');",
        "    } else {",
        "      if (state.agent.manualValidationHold) {",
        "        log('Navigation manuelle détectée : retenue après validation manuelle levée.');",
        "      }",
        "      state.agent.manualValidationHold = false;",
        "      state.agent.manualValidationHoldProgress = null;",
        "      state.agent.manualValidationHoldAt = null;",
        "    }",
        "",
        "    // v6.2 : armer la reprise SYNCHRONEMENT, dès le clic (listener en capture)."
      ].join("\n")
    );

    // 6) Sur une page passive/correction, Suivant est autorisé normalement, mais JAMAIS
    // immédiatement après un Valider manuel. Dans ce cas l'utilisateur garde la main.
    const navigationReplacement = [
      "  const navigatePassivePage = async (label) => {",
      "    if (state.agent.manualValidationHold) {",
      "      const heldProgress = state.agent.manualValidationHoldProgress;",
      "      const currentProgress = currentProgressMarker();",
      "      const genuinelyMoved = !!heldProgress && !!currentProgress &&",
      "        currentProgress !== heldProgress && !isFeedbackPage();",
      "",
      "      if (!genuinelyMoved) {",
      "        log(label + ': validation faite manuellement; aucune navigation automatique. Clique toi-même sur Suivant/Passer.');",
      "        return false;",
      "      }",
      "",
      "      state.agent.manualValidationHold = false;",
      "      state.agent.manualValidationHoldProgress = null;",
      "      state.agent.manualValidationHoldAt = null;",
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
      "navigation passive sans Passer non soumis + retenue manuelle",
      "  const navigatePassivePage = async (label) => {",
      "  const validateIfPresent = async () => {",
      navigationReplacement
    );

    return code;
  };

  console.log(`[Global Exam Hotfix] ${HOTFIX_VERSION} prêt.`);
})();
