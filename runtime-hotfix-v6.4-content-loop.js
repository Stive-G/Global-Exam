(() => {
  const HOTFIX_VERSION = "6.4-content-loop-manual-flow-v3";

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

    // 3) État de reprise manuelle avec deux phases distinctes :
    // - "validated" : l'utilisateur a cliqué Valider. Sur la correction, Suivant peut
    //   être automatisé, mais Passer reste interdit.
    // - "transition" : l'utilisateur a cliqué Suivant/Passer/Terminer, ou l'assistant
    //   vient de cliquer Suivant après une validation manuelle. Toute navigation auto
    //   est bloquée jusqu'à ce qu'une vraie nouvelle page soit détectée.
    code = replaceOnce(
      code,
      "état flux manuel",
      "      manualResumeAt: null,\n      panelCollapsed: false,",
      [
        "      manualResumeAt: null,",
        "      manualValidationHold: false,",
        "      manualValidationPhase: null,",
        "      manualValidationHoldProgress: null,",
        "      manualValidationHoldKey: null,",
        "      manualValidationHoldAt: null,",
        "      panelCollapsed: false,"
      ].join("\n")
    );

    // 4) Garde universelle de clickElement.
    code = replaceOnce(
      code,
      "garde clic navigation flux manuel",
      "  const clickElement = async (el) => {\n    if (!el || !isVisible(el) || !isEnabled(el)) return false;\n    el.scrollIntoView?.({ block: \"center\", inline: \"center\" });",
      [
        "  const clickElement = async (el) => {",
        "    if (!el || !isVisible(el) || !isEnabled(el)) return false;",
        "",
        "    const clickLabel = controlText(el);",
        "    const clickLoose = normLoose(clickLabel);",
        "    const nextTextsLoose = state.config.nextTexts.map(normLoose);",
        "    const passTextsLoose = state.config.passTexts.map(normLoose);",
        "    const isAutoNext = nextTextsLoose.some((wanted) => clickLoose === wanted || clickLoose.startsWith(wanted + ' '));",
        "    const isAutoPass = passTextsLoose.some((wanted) => clickLoose === wanted || clickLoose.startsWith(wanted + ' '));",
        "",
        "    if (state.agent.manualValidationHold) {",
        "      const phase = state.agent.manualValidationPhase;",
        "",
        "      if (phase === 'transition' && (isAutoNext || isAutoPass)) {",
        "        log('Navigation automatique \"' + (clickLabel || 'Suivant/Passer') + '\" bloquée : transition manuelle en cours.');",
        "        return false;",
        "      }",
        "",
        "      if (phase === 'validated' && isAutoPass) {",
        "        log('Navigation automatique \"' + (clickLabel || 'Passer') + '\" bloquée : après un Valider manuel, Passer n’est jamais utilisé automatiquement.');",
        "        return false;",
        "      }",
        "",
        "      if (phase === 'validated' && isAutoNext) {",
        "        const submitted = isFeedbackPage() || hasSubmittedState();",
        "        if (!submitted) {",
        "          log('Navigation automatique \"' + (clickLabel || 'Suivant') + '\" bloquée : soumission/correction non confirmée.');",
        "          return false;",
        "        }",
        "      }",
        "    }",
        "",
        "    el.scrollIntoView?.({ block: \"center\", inline: \"center\" });"
      ].join("\n")
    );

    // 5) Un clic manuel sur Valider arme la phase "validated".
    // Un clic manuel de navigation arme la phase "transition" et garde la retenue
    // jusqu'à la page réellement suivante.
    code = replaceOnce(
      code,
      "armement flux manuel",
      "  ) => {\n    if (!state.config.agent.autoAnswer) return;\n\n    // v6.2 : armer la reprise SYNCHRONEMENT, dès le clic (listener en capture).",
      [
        "  ) => {",
        "    if (!state.config.agent.autoAnswer) return;",
        "",
        "    const manualQuestion = detectQuestion();",
        "    state.agent.manualValidationHold = true;",
        "    state.agent.manualValidationHoldProgress = currentProgressMarker() || null;",
        "    state.agent.manualValidationHoldKey = manualQuestion?.key || null;",
        "    state.agent.manualValidationHoldAt = Date.now();",
        "",
        "    if (actionKind === \"validate\") {",
        "      state.agent.manualValidationPhase = 'validated';",
        "      log('Validation manuelle détectée : reprise Auto autorisée sur la correction via Suivant uniquement; Passer reste bloqué.');",
        "    } else {",
        "      state.agent.manualValidationPhase = 'transition';",
        "      log('Navigation manuelle détectée : attente de la vraie page suivante avant toute nouvelle navigation automatique.');",
        "    }",
        "",
        "    // v6.2 : armer la reprise SYNCHRONEMENT, dès le clic (listener en capture)."
      ].join("\n")
    );

    // 6) Lever la retenue uniquement quand on a réellement quitté la correction/page
    // depuis laquelle l'action manuelle a eu lieu.
    code = replaceOnce(
      code,
      "libération flux manuel sur nouvelle page",
      "      let q = detectQuestion();\n      renderPanel(q);",
      [
        "      let q = detectQuestion();",
        "",
        "      if (state.agent.manualValidationHold) {",
        "        const phase = state.agent.manualValidationPhase;",
        "        const currentProgress = currentProgressMarker() || null;",
        "        const heldProgress = state.agent.manualValidationHoldProgress;",
        "        const heldKey = state.agent.manualValidationHoldKey;",
        "        const movedProgress = !!heldProgress && !!currentProgress && currentProgress !== heldProgress;",
        "        const movedKey = !!heldKey && !!q.key && q.key !== heldKey;",
        "        const leftCorrection = q.type !== 'feedback';",
        "",
        "        // Une correction peut déjà afficher N+1/N avant que la page suivante soit",
        "        // chargée : le changement de progression seul ne suffit donc jamais tant",
        "        // que q.type === 'feedback'.",
        "        if (leftCorrection && (movedProgress || movedKey)) {",
        "          state.agent.manualValidationHold = false;",
        "          state.agent.manualValidationPhase = null;",
        "          state.agent.manualValidationHoldProgress = null;",
        "          state.agent.manualValidationHoldKey = null;",
        "          state.agent.manualValidationHoldAt = null;",
        "          log('Nouvelle page réelle détectée : reprise automatique complète autorisée.');",
        "        } else if (phase === 'transition' && q.type === 'feedback') {",
        "          log('Transition encore sur la correction : aucune navigation automatique supplémentaire.');",
        "        }",
        "      }",
        "",
        "      renderPanel(q);"
      ].join("\n")
    );

    // 7) Navigation passive : c'est ici que l'on différencie clairement Valider manuel
    // et navigation manuelle.
    const navigationReplacement = [
      "  const navigatePassivePage = async (label) => {",
      "    if (state.agent.manualValidationHold) {",
      "      const phase = state.agent.manualValidationPhase;",
      "",
      "      if (phase === 'transition') {",
      "        log(label + ': transition manuelle en cours; aucune navigation automatique jusqu’à la vraie page suivante.');",
      "        return false;",
      "      }",
      "",
      "      if (phase === 'validated') {",
      "        // Le Valider manuel a déjà soumis la question. Sur une correction/résultat,",
      "        // on peut reprendre automatiquement avec Suivant, mais JAMAIS avec Passer.",
      "        const submitted = isFeedbackPage() || hasSubmittedState();",
      "        if (!submitted) {",
      "          log(label + ': validation manuelle détectée mais soumission/correction non confirmée; navigation bloquée.');",
      "          return false;",
      "        }",
      "",
      "        let nextAfterManualValidate = findActionButton(state.config.nextTexts);",
      "        if (!nextAfterManualValidate) {",
      "          nextAfterManualValidate = await waitForActionButton(state.config.nextTexts, state.config.agent.passiveNavigationWaitMs);",
      "        }",
      "",
      "        if (nextAfterManualValidate) {",
      "          const transitionProgress = currentProgressMarker() || null;",
      "          const transitionQuestion = detectQuestion();",
      "          const transitionKey = transitionQuestion?.key || null;",
      "          log(label + ': validation manuelle confirmée; reprise automatique via ' + controlText(nextAfterManualValidate) + '.');",
      "          const clicked = await clickElement(nextAfterManualValidate);",
      "          if (!clicked) return false;",
      "",
      "          // Le clic est maintenant parti : passer en phase transition afin d'empêcher",
      "          // tout second Suivant/Passer sur un DOM de correction encore présent.",
      "          state.agent.manualValidationPhase = 'transition';",
      "          state.agent.manualValidationHoldProgress = transitionProgress;",
      "          state.agent.manualValidationHoldKey = transitionKey;",
      "          state.agent.manualValidationHoldAt = Date.now();",
      "          await wait(state.config.settleDelayMs);",
      "          return true;",
      "        }",
      "",
      "        const passAfterManualValidate = findActionButton(state.config.passTexts);",
      "        if (passAfterManualValidate) {",
      "          log(label + ': ' + controlText(passAfterManualValidate) + ' visible mais volontairement ignoré après validation manuelle; attente de Suivant.');",
      "        } else {",
      "          log(label + ': aucun bouton Suivant disponible après validation manuelle; attente.');",
      "        }",
      "        return false;",
      "      }",
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
      "navigation passive + flux manuel",
      "  const navigatePassivePage = async (label) => {",
      "  const validateIfPresent = async () => {",
      navigationReplacement
    );

    return code;
  };

  console.log(`[Global Exam Hotfix] ${HOTFIX_VERSION} prêt.`);
})();