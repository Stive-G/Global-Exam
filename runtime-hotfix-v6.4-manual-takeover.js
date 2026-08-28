(() => {
  const HOTFIX_VERSION = "6.4-manual-takeover";

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

  window.__applyGlobalExamV64ManualTakeoverFix = (source) => {
    let code = String(source || "");

    // Une action manuelle de navigation garde désormais la main jusqu'à ce qu'une
    // vraie nouvelle question soit effectivement détectée. Cela évite le cas où
    // l'utilisateur clique Suivant, le DOM reste quelques instants sur la correction,
    // puis l'Auto clique Passer tout seul pendant cette transition.
    code = replaceOnce(
      code,
      "état takeover manuel",
      [
        "      manualValidationHold: false,",
        "      manualValidationHoldProgress: null,",
        "      manualValidationHoldAt: null,",
        "      panelCollapsed: false,"
      ].join("\n"),
      [
        "      manualValidationHold: false,",
        "      manualValidationHoldProgress: null,",
        "      manualValidationHoldKey: null,",
        "      manualValidationNavigationSeen: false,",
        "      manualValidationHoldAt: null,",
        "      panelCollapsed: false,"
      ].join("\n")
    );

    // Tous les clics automatiques Suivant/Passer/Terminer sont bloqués pendant le
    // takeover manuel. La libération n'a plus lieu dans clickElement().
    code = replaceBetween(
      code,
      "garde navigation automatique takeover",
      "    if (state.agent.manualValidationHold && isAutomaticNavigation) {",
      "\n\n    el.scrollIntoView?.({ block: \"center\", inline: \"center\" });",
      [
        "    if (state.agent.manualValidationHold && isAutomaticNavigation) {",
        "      log('Navigation automatique \\\"' + (clickLabel || 'Suivant/Passer') + '\\\" bloquée : une action manuelle est en cours. Le script attend une vraie nouvelle question avant de reprendre.');",
        "      return false;",
        "    }"
      ].join("\n")
    );

    // Ne jamais lever la retenue au moment exact du clic manuel Suivant/Passer.
    // On note seulement qu'une navigation utilisateur a été demandée. Le DOM peut
    // encore afficher l'ancienne correction pendant plusieurs centaines de ms.
    code = replaceOnce(
      code,
      "armement takeover manuel",
      [
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
        "    }"
      ].join("\n"),
      [
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
        "      log('Navigation manuelle détectée : Auto reste en attente jusqu’à ce qu’une vraie nouvelle question soit chargée.');",
        "    }"
      ].join("\n")
    );

    // La seule condition qui libère le takeover est la détection d'une question
    // exploitable, distincte de la correction/page passive précédente.
    code = replaceOnce(
      code,
      "libération takeover sur vraie question",
      [
        "      let q = detectQuestion();",
        "      renderPanel(q);"
      ].join("\n"),
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

    // Tant que le takeover est actif, une correction ou une page de contenu ne peut
    // jamais déclencher de navigation automatique, même si Passer est considéré comme
    // autorisé parce que la réponse est déjà corrigée.
    code = replaceBetween(
      code,
      "navigation passive sous takeover",
      "  const navigatePassivePage = async (label) => {",
      "\n\n    let next = findActionButton(state.config.nextTexts);",
      [
        "  const navigatePassivePage = async (label) => {",
        "    if (state.agent.manualValidationHold) {",
        "      log(label + ': action manuelle en cours; Suivant/Passer automatiques désactivés jusqu’à la prochaine vraie question.');",
        "      return false;",
        "    }"
      ].join("\n")
    );

    return code;
  };

  console.log(`[Global Exam Hotfix] ${HOTFIX_VERSION} prêt.`);
})();
