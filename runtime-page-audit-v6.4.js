(() => {
  const PAGE_AUDIT_VERSION = "6.4-page-audit-v2";

  const replaceOnce = (source, label, before, after) => {
    if (!source.includes(before)) {
      throw new Error(`[PageAudit ${PAGE_AUDIT_VERSION}] Bloc introuvable: ${label}.`);
    }
    return source.replace(before, after);
  };

  window.__applyGlobalExamV64PageAuditPatch = (source) => {
    let code = String(source || "");
    if (code.includes(`const PAGE_AUDIT_VERSION = "${PAGE_AUDIT_VERSION}"`)) return code;

    // Tous les anciens tests de page de correction passent désormais par un
    // contrôle de la réalité visible du DOM. On effectue ce remplacement AVANT
    // d'injecter isRealFeedbackPage() afin d'éviter une récursion.
    code = code.replaceAll("isFeedbackPage()", "isRealFeedbackPage()");

    const detectMarker = "  const detectQuestion = () => {\n";
    if (!code.includes(detectMarker)) {
      throw new Error(`[PageAudit ${PAGE_AUDIT_VERSION}] detectQuestion introuvable.`);
    }

    const helpers = `
  const PAGE_AUDIT_VERSION = "${PAGE_AUDIT_VERSION}";
  let pageAuditLastFingerprint = null;

  const visibleCorrectionBannerNow = () => {
    const patterns = [
      'bravo', 'bonne reponse', 'pas de reponse', 'presque',
      'correct answer', 'incorrect answer', 'wrong answer',
      'good job', 'well done', 'vous avez renseigne', 'you have answered'
    ];
    const nodes = [...document.querySelectorAll(
      "h1,h2,h3,h4,p,[role='alert'],[class*='feedback'],[class*='result'],[class*='success'],[class*='error'],[class*='correct'],[class*='incorrect']"
    )].filter((el) => isVisible(el) && !isAssistantElement(el));
    return nodes.some((el) => {
      const text = normLoose(textOf(el));
      if (!text || text.length > 320) return false;
      return patterns.some((p) => text === p || text.startsWith(p + ' '));
    });
  };

  const pageDomAudit = () => {
    const root = findQuestionRoot();
    const scanRoot = document.body;
    const marker = String(currentProgressMarker() || '').trim();
    const progressMatch = marker.match(/^(\\d+)\\s*\\/\\s*(\\d+)$/);
    const current = progressMatch ? Number(progressMatch[1]) : null;
    const total = progressMatch ? Number(progressMatch[2]) : null;
    const progressed = !progressMatch || current > 0;

    const radios = nativeChoiceControls("input[type='radio']", scanRoot);
    const checkboxes = nativeChoiceControls("input[type='checkbox']", scanRoot);
    const roleRadios = visibleControls("[role='radio']", scanRoot);
    const roleCheckboxes = visibleControls("[role='checkbox']", scanRoot);
    const writable = visibleControls(
      "input[type='text'],input[type='number'],input[type='email'],textarea,select,[role='combobox'],[contenteditable='true']",
      scanRoot
    );
    const zones = getLiveZoneElements(scanRoot)
      .filter((el) => isVisible(el) && !isAssistantElement(el));
    const draggables = visibleControls("[draggable='true']", scanRoot);

    const buttons = visibleControls("button,[role='button'],a[role='button']", scanRoot);
    const matchesTexts = (el, texts) => {
      const t = normLoose(controlText(el));
      return texts.map(normLoose).some((x) => t === x || t.startsWith(x + ' '));
    };
    const validateButtons = buttons.filter((el) => matchesTexts(el, state.config.validateTexts));
    const nextButtons = buttons.filter((el) => matchesTexts(el, state.config.nextTexts));
    const passButtons = buttons.filter((el) => matchesTexts(el, state.config.passTexts));
    const transcriptButtons = buttons.filter((el) => /\\b(transcript|transcription)\\b/.test(normLoose(controlText(el))));
    const answerButtons = buttons.filter((el) => {
      const raw = controlText(el);
      const t = normLoose(raw);
      if (!t || raw.length > 220) return false;
      if (matchesTexts(el, state.config.validateTexts) || matchesTexts(el, state.config.nextTexts) || matchesTexts(el, state.config.passTexts)) return false;
      if (isNavLikeText(t) || isExerciseUiNoiseText(raw)) return false;
      if (/\\b(transcript|transcription|fermer|close|feedback)\\b/.test(t)) return false;
      return true;
    });

    let ordering = false;
    try { ordering = !!findOrderingInstructionElement(document.body); } catch {}
    let questionHint = false;
    try { questionHint = !!looksLikeQuestionPage(); } catch {}
    const visibleCorrection = visibleCorrectionBannerNow();

    const promptNodes = [...root.querySelectorAll(
      "h1,h2,h3,h4,legend,[role='heading'],[class*='title'],[class*='prompt'],[class*='question'],[class*='instruction'],[class*='statement'],p"
    )]
      .filter((el) => isVisible(el) && !isAssistantElement(el))
      .map((el) => textOf(el).trim())
      .filter((t) => t.length >= 3 && t.length <= 1400);
    const promptText = [...new Set(promptNodes)].slice(0, 12).join(' | ').slice(0, 5000);

    const selectedRadios = radios.filter(({ input, surface }) => input.checked || isControlSelected(surface)).length;
    const selectedCheckboxes = checkboxes.filter(({ input, surface }) => input.checked || isControlSelected(surface)).length;
    const emptyWritable = writable.filter((el) => {
      if (el.matches('select')) return !String(el.value || '').trim();
      return !String(el.value ?? el.textContent ?? '').trim();
    }).length;
    const emptyZones = zones.filter((z) => !isZoneFilled(z)).length;

    const strongControls =
      radios.length >= 2 || checkboxes.length >= 2 ||
      roleRadios.length >= 2 || roleCheckboxes.length >= 2 ||
      writable.length >= 1 || zones.length >= 1 || ordering ||
      (draggables.length >= 1 && zones.length >= 1) || answerButtons.length >= 2;

    // À 0/N, les pages de transcript/vocabulaire peuvent contenir des boutons mais
    // ne sont pas encore des questions. En revanche, un vrai champ/zone/choix reste
    // un signal fort même si le compteur est atypique.
    const questionLikely = !visibleCorrection && (strongControls || (progressed && questionHint));
    // Ne pas appeler hasSubmittedState() ici : ce helper dépend lui-même de
    // isRealFeedbackPage() après patch et provoquerait une récursion pageDomAudit ->
    // hasSubmittedState -> isRealFeedbackPage -> pageDomAudit.
    const submittedControl =
      typeof findSubmittedStateControl === 'function' ? !!findSubmittedStateControl() : false;
    const submitted = submittedControl || visibleCorrection;
    const fingerprint = pageFingerprint();

    return {
      version: PAGE_AUDIT_VERSION,
      fingerprint,
      marker,
      current,
      total,
      progressed,
      questionLikely,
      questionHint,
      visibleCorrection,
      submitted,
      radios: radios.length,
      checkboxes: checkboxes.length,
      roleRadios: roleRadios.length,
      roleCheckboxes: roleCheckboxes.length,
      writable: writable.length,
      emptyWritable,
      zones: zones.length,
      emptyZones,
      draggables: draggables.length,
      ordering,
      answerButtons: answerButtons.length,
      validateButtons: validateButtons.length,
      nextButtons: nextButtons.length,
      passButtons: passButtons.length,
      transcriptButtons: transcriptButtons.length,
      selectedRadios,
      selectedCheckboxes,
      promptText,
    };
  };

  const activeQuestionReality = () => {
    const audit = pageDomAudit();
    return {
      active: audit.questionLikely,
      marker: audit.marker,
      current: audit.current,
      total: audit.total,
      progressed: audit.progressed,
      nativeRadios: audit.radios,
      nativeCheckboxes: audit.checkboxes,
      roleChoices: audit.roleRadios + audit.roleCheckboxes,
      writableFields: audit.writable,
      zones: audit.zones,
      choiceButtons: audit.answerButtons,
      ordering: audit.ordering,
      visibleCorrection: audit.visibleCorrection,
    };
  };

  const hasActiveVisibleQuestionEvidence = () => pageDomAudit().questionLikely;

  const isRealFeedbackPage = () => {
    const audit = pageDomAudit();
    if (audit.questionLikely) return false;
    if (!audit.visibleCorrection) return false;
    return isFeedbackPage();
  };

  const logPageDomAudit = (audit, detectedType) => {
    if (!audit) return;
    if (audit.fingerprint === pageAuditLastFingerprint) return;
    pageAuditLastFingerprint = audit.fingerprint;
    console.log(
      '[Global Exam DOM] ' + (audit.marker || '?') +
      ' | type=' + (detectedType || '?') +
      ' | question=' + (audit.questionLikely ? 'OUI' : 'NON') +
      ' | correction=' + (audit.visibleCorrection ? 'OUI' : 'NON') +
      ' | radios=' + audit.radios +
      ' | checkboxes=' + audit.checkboxes +
      ' | champs=' + audit.writable +
      ' | zones=' + audit.zones +
      ' | ordering=' + (audit.ordering ? 'OUI' : 'NON') +
      ' | Valider=' + audit.validateButtons +
      ' | Suivant=' + audit.nextButtons +
      ' | Passer=' + audit.passButtons +
      ' | transcript=' + audit.transcriptButtons
    );
    if (audit.promptText) {
      console.log('[Global Exam DOM] Texte lu : ' + audit.promptText.slice(0, 1600));
    }
  };

  const reconcilePageDomAudit = (audit, q) => {
    if (!audit || !q) return q;

    if (audit.questionLikely && (q.type === 'none' || q.type === 'feedback')) {
      const reason = 'Audit DOM: contrôles de question visibles mais détection=' + q.type + '.';
      log(reason + ' Navigation automatique interdite.');
      return {
        type: 'unknown-question',
        root: findQuestionRoot(),
        prompt: audit.promptText || reason,
        key: 'page-audit::' + audit.fingerprint.slice(0, 600),
      };
    }

    if (q.type === 'feedback' && !audit.visibleCorrection) {
      const reason = 'Audit DOM: feedback détecté sans bannière de correction visible.';
      log(reason + ' Navigation automatique interdite.');
      return {
        type: 'unknown-question',
        root: findQuestionRoot(),
        prompt: audit.promptText || reason,
        key: 'page-audit::' + audit.fingerprint.slice(0, 600),
      };
    }

    return q;
  };

`;

    code = code.replace(detectMarker, helpers + detectMarker);

    // Chaque cycle de traitement commence par un scan du DOM COMPLET de la page.
    const processMarker =
      "      await waitForStablePage(450);\n" +
      "      let q = detectQuestion();";
    code = replaceOnce(
      code,
      "audit DOM au début de processCurrentPage",
      processMarker,
      "      await waitForStablePage(450);\n" +
      "      const pageAudit = pageDomAudit();\n" +
      "      let q = detectQuestion();\n" +
      "      q = reconcilePageDomAudit(pageAudit, q);\n" +
      "      logPageDomAudit(pageAudit, q?.type || 'unknown');"
    );

    // Juste avant toute navigation passive, re-scan du DOM : une question non
    // soumise visible interdit Suivant/Passer, même si un ancien état dit "none".
    const passiveMarker = "  const navigatePassivePage = async (label) => {\n";
    code = replaceOnce(
      code,
      "garde audit DOM navigation passive",
      passiveMarker,
      passiveMarker +
      "    const passiveAudit = pageDomAudit();\n" +
      "    if (passiveAudit.questionLikely && !passiveAudit.submitted) {\n" +
      "      log(label + ': audit DOM détecte une question non soumise; navigation bloquée.');\n" +
      "      logPageDomAudit(passiveAudit, 'navigation-bloquée');\n" +
      "      return false;\n" +
      "    }\n"
    );

    // Dernière barrière globale au niveau du clic automatique : même si une autre
    // branche du script tente Suivant/Passer, le DOM est revalidé immédiatement.
    const clickMarker = "  const clickElement = async (el) => {\n";
    code = replaceOnce(
      code,
      "garde audit DOM clic navigation",
      clickMarker,
      clickMarker +
      "    if (el) {\n" +
      "      const auditBeforeClick = pageDomAudit();\n" +
      "      const clickAuditLabel = controlText(el);\n" +
      "      const clickAuditLoose = normLoose(clickAuditLabel);\n" +
      "      const clickAuditNext = state.config.nextTexts.map(normLoose).some((x) => clickAuditLoose === x || clickAuditLoose.startsWith(x + ' '));\n" +
      "      const clickAuditPass = state.config.passTexts.map(normLoose).some((x) => clickAuditLoose === x || clickAuditLoose.startsWith(x + ' '));\n" +
      "      if ((clickAuditNext || clickAuditPass) && auditBeforeClick.questionLikely && !auditBeforeClick.submitted) {\n" +
      "        log('Clic automatique ' + (clickAuditLabel || 'Suivant/Passer') + ' bloqué par audit DOM: question non soumise visible.');\n" +
      "        return false;\n" +
      "      }\n" +
      "    }\n"
    );

    const debugMarker = "  window.geUnblock = clearHardBlock;";
    if (code.includes(debugMarker)) {
      code = code.replace(
        debugMarker,
        "  window.geDebugDomPage = () => {\n" +
        "    const audit = pageDomAudit();\n" +
        "    const detected = reconcilePageDomAudit(audit, detectQuestion());\n" +
        "    const result = { ...audit, detectedType: detected?.type || 'unknown' };\n" +
        "    console.table(result);\n" +
        "    if (audit.promptText) console.log('[Global Exam DOM] Texte lu complet:', audit.promptText);\n" +
        "    return result;\n" +
        "  };\n" +
        "  window.gePageAuditVersion = () => PAGE_AUDIT_VERSION;\n" +
        "  window.geDebugVerification = window.geDebugDomPage;\n" +
        debugMarker
      );
    }

    return code;
  };

  console.log(`[Global Exam PageAudit] ${PAGE_AUDIT_VERSION} prêt.`);
})();
