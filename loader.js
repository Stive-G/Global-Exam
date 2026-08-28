// Petit chargeur à conserver dans un Snippet DevTools.
(async () => {
  const expectedVersion = "6.4";
  const baseVersion = "6.3";
  const expectedManualHotfix = "6.4-content-loop-manual-flow-v3";
  const expectedContextPatch = "6.4-context-v1";
  const verificationPatchVersion = "6.4-page-reality-v1";

  if (window.__globalExamPager) {
    const loaded = window.__GLOBAL_EXAM_ASSISTANT_VERSION || "ancienne/inconnue";
    console.warn(
      `[Loader Global Exam] Une version ${loaded} est déjà chargée. ` +
      `Fais Ctrl+R puis relance ce Snippet pour charger la version actuelle.`
    );
    return;
  }

  const normalizeSourceText = (source) => String(source || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");

  const repairKnownGeneratedSyntax = (source) => {
    let code = String(source || "");
    const brokenDebugLog =
      "console.log('[Global Exam Assistant] Contexte envoyé aux IA:\n' + activityContextPrompt());";
    const fixedDebugLog =
      "console.log('[Global Exam Assistant] Contexte envoyé aux IA:\\n' + activityContextPrompt());";
    if (code.includes(brokenDebugLog)) {
      code = code.replace(brokenDebugLog, fixedDebugLog);
      console.log("[Loader Global Exam] Correction syntaxique du patch contexte appliquée.");
    }
    return code;
  };

  const applyPageRealityVerificationPatch = (source) => {
    let code = String(source || "");
    if (code.includes("const PAGE_REALITY_VERIFICATION_VERSION =")) return code;

    // Toutes les décisions correction/résultat passent par une vérification
    // de la réalité visible de la page. L'ancien isFeedbackPage reste la base.
    code = code.replaceAll("isFeedbackPage()", "isRealFeedbackPage()");

    const detectMarker = "  const detectQuestion = () => {\n";
    if (!code.includes(detectMarker)) {
      throw new Error(
        `[${verificationPatchVersion}] Impossible d'injecter la vérification : detectQuestion introuvable.`
      );
    }

    const helperLines = [
      `  const PAGE_REALITY_VERIFICATION_VERSION = "${verificationPatchVersion}";`,
      "",
      "  const visibleCorrectionBannerNow = () => {",
      "    const patterns = [",
      "      'bravo', 'bonne reponse', 'pas de reponse', 'presque',",
      "      'correct answer', 'incorrect answer', 'wrong answer',",
      "      'good job', 'well done', 'vous avez renseigne', 'you have answered'",
      "    ];",
      "    const nodes = [...document.querySelectorAll(",
      "      \"h1,h2,h3,h4,p,[role='alert'],[class*='feedback'],[class*='result'],[class*='success'],[class*='error'],[class*='correct'],[class*='incorrect']\"",
      "    )].filter((el) => isVisible(el) && !isAssistantElement(el));",
      "    return nodes.some((el) => {",
      "      const text = normLoose(textOf(el));",
      "      if (!text || text.length > 320) return false;",
      "      return patterns.some((p) => text === p || text.startsWith(p + ' '));",
      "    });",
      "  };",
      "",
      "  const activeQuestionReality = () => {",
      "    const marker = String(currentProgressMarker() || '').trim();",
      "    const progressMatch = marker.match(/^(\\d+)\\s*\\/\\s*(\\d+)$/);",
      "    const current = progressMatch ? Number(progressMatch[1]) : null;",
      "    const total = progressMatch ? Number(progressMatch[2]) : null;",
      "    const progressed = !progressMatch || (current > 0 && total > 0);",
      "    const root = findQuestionRoot();",
      "    const nativeRadios = nativeChoiceControls(\"input[type='radio']\", root).length;",
      "    const nativeCheckboxes = nativeChoiceControls(\"input[type='checkbox']\", root).length;",
      "    const roleChoices = visibleControls(\"[role='radio'],[role='checkbox']\", root).length;",
      "    const writableFields = visibleControls(",
      "      \"input[type='text'],input[type='number'],input[type='email'],textarea,select,[role='combobox'],[contenteditable='true']\",",
      "      root",
      "    ).length;",
      "    const zones = getLiveZoneElements(root)",
      "      .filter((el) => isVisible(el) && !isAssistantElement(el)).length;",
      "    const choiceButtons = visibleControls(\"button,[role='button']\", root)",
      "      .filter((el) => {",
      "        const raw = controlText(el);",
      "        const text = normLoose(raw);",
      "        if (!text || raw.length > 180) return false;",
      "        if (isNavLikeText(text) || isExerciseUiNoiseText(raw)) return false;",
      "        if (state.config.validateTexts.map(normLoose).some((x) => text === x || text.startsWith(x + ' '))) return false;",
      "        if (state.config.passTexts.map(normLoose).some((x) => text === x || text.startsWith(x + ' '))) return false;",
      "        return true;",
      "      }).length;",
      "    let ordering = false;",
      "    try { ordering = !!findOrderingInstructionElement(document.body); } catch {}",
      "    const visibleCorrection = visibleCorrectionBannerNow();",
      "    const hasControls =",
      "      nativeRadios >= 2 || nativeCheckboxes >= 2 || roleChoices >= 2 ||",
      "      writableFields >= 1 || zones >= 1 || choiceButtons >= 2 || ordering;",
      "    return {",
      "      active: !!(progressed && hasControls && !visibleCorrection),",
      "      marker, current, total, progressed, nativeRadios, nativeCheckboxes,",
      "      roleChoices, writableFields, zones, choiceButtons, ordering, visibleCorrection",
      "    };",
      "  };",
      "",
      "  const hasActiveVisibleQuestionEvidence = () => activeQuestionReality().active;",
      "",
      "  const isRealFeedbackPage = () => {",
      "    const reality = activeQuestionReality();",
      "    if (reality.active) return false;",
      "    return isFeedbackPage();",
      "  };",
      ""
    ].join("\n");

    code = code.replace(detectMarker, helperLines + detectMarker);

    // Une vraie question visible a priorité sur toute navigation passive.
    const passiveMarker = "  const navigatePassivePage = async (label) => {\n";
    if (code.includes(passiveMarker)) {
      code = code.replace(
        passiveMarker,
        passiveMarker +
        "    if (hasActiveVisibleQuestionEvidence()) {\n" +
        "      log(label + ': vraie question active détectée; navigation passive interdite. Traitement requis.');\n" +
        "      return false;\n" +
        "    }\n"
      );
    }

    // Dernière barrière : pas de Suivant/Passer automatique si une vraie
    // question non soumise reste visible.
    const clickMarker = "  const clickElement = async (el) => {\n";
    if (code.includes(clickMarker)) {
      code = code.replace(
        clickMarker,
        clickMarker +
        "    if (el && typeof hasActiveVisibleQuestionEvidence === 'function' && hasActiveVisibleQuestionEvidence()) {\n" +
        "      const realityLabel = controlText(el);\n" +
        "      const realityLoose = normLoose(realityLabel);\n" +
        "      const realityIsNext = state.config.nextTexts.map(normLoose).some((x) => realityLoose === x || realityLoose.startsWith(x + ' '));\n" +
        "      const realityIsPass = state.config.passTexts.map(normLoose).some((x) => realityLoose === x || realityLoose.startsWith(x + ' '));\n" +
        "      const realitySubmitted = typeof hasSubmittedState === 'function' ? hasSubmittedState() : false;\n" +
        "      if ((realityIsNext || realityIsPass) && !realitySubmitted) {\n" +
        "        log('Navigation automatique \"' + (realityLabel || 'Suivant/Passer') + '\" bloquée : vraie question non soumise visible.');\n" +
        "        return false;\n" +
        "      }\n" +
        "    }\n"
      );
    }

    const debugMarker = "  window.geUnblock = clearHardBlock;";
    if (code.includes(debugMarker)) {
      code = code.replace(
        debugMarker,
        "  window.geDebugVerification = () => {\n" +
        "    const reality = activeQuestionReality();\n" +
        "    const detected = detectQuestion();\n" +
        "    const info = {\n" +
        "      version: PAGE_REALITY_VERIFICATION_VERSION,\n" +
        "      progress: reality.marker, detectedType: detected?.type || 'unknown',\n" +
        "      activeQuestion: reality.active, visibleCorrection: reality.visibleCorrection,\n" +
        "      feedbackBase: isFeedbackPage(), feedbackEffective: isRealFeedbackPage(),\n" +
        "      nativeRadios: reality.nativeRadios, nativeCheckboxes: reality.nativeCheckboxes,\n" +
        "      roleChoices: reality.roleChoices, writableFields: reality.writableFields,\n" +
        "      zones: reality.zones, choiceButtons: reality.choiceButtons, ordering: reality.ordering,\n" +
        "      validate: !!findActionButton(state.config.validateTexts),\n" +
        "      next: !!findActionButton(state.config.nextTexts), pass: !!findActionButton(state.config.passTexts),\n" +
        "      manualHold: !!state.agent.manualValidationHold, manualPhase: state.agent.manualValidationPhase || ''\n" +
        "    };\n" +
        "    console.table(info);\n" +
        "    return info;\n" +
        "  };\n" +
        "  window.geVerificationVersion = () => PAGE_REALITY_VERIFICATION_VERSION;\n" +
        debugMarker
      );
    }

    return code;
  };

  const assertGeneratedCodeSyntax = (code) => {
    try {
      new Function(String(code || ""));
    } catch (error) {
      console.error("[Loader Global Exam] Le code généré est syntaxiquement invalide.", error);
      throw new Error(`[Loader Global Exam] Syntaxe invalide: ${error?.message || error}`);
    }
  };

  const installFeedbackSurveyGuard = () => {
    if (window.__GLOBAL_EXAM_FEEDBACK_SURVEY_GUARD) return;
    const visible = (el) => {
      if (!el || !el.isConnected) return false;
      const r = el.getBoundingClientRect?.();
      const s = getComputedStyle(el);
      return !!r && r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
    };
    const tryCloseSurvey = () => {
      const text = String(document.body?.innerText || document.body?.textContent || "");
      if (!/feedback_form\./i.test(text)) return false;
      const roots = [...document.querySelectorAll(
        "[role='dialog'],[aria-modal='true'],[class*='modal'],[class*='dialog'],[class*='drawer'],[class*='sheet'],[class*='overlay']"
      )].filter(visible);
      for (const root of roots) {
        if (!/feedback_form\./i.test(String(root.innerText || root.textContent || ""))) continue;
        const close = [...root.querySelectorAll("button,[role='button'],a,[tabindex]")]
          .filter(visible)
          .find((el) => {
            const label = [el.getAttribute?.("aria-label"), el.getAttribute?.("title"), el.innerText, el.textContent]
              .filter(Boolean).join(" ").trim().toLowerCase();
            return /^(x|×|✕|✖)$/.test(label) || /\b(close|fermer|dismiss|quitter)\b/i.test(label);
          });
        if (close) {
          console.log("[Global Exam Guard] Popup feedback détecté : fermeture automatique.");
          close.click();
          return true;
        }
      }
      return false;
    };
    let timer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(tryCloseSurvey, 50);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    window.__GLOBAL_EXAM_FEEDBACK_SURVEY_GUARD = { observer, tryClose: tryCloseSurvey };
    tryCloseSurvey();
  };

  const cacheBust = `${expectedVersion}-${Date.now()}`;
  const [assistantResponse, patchResponse, manualHotfixResponse, contextPatchResponse] = await Promise.all([
    fetch(`http://localhost:3000/assistant.js?v=${cacheBust}`, { cache: "no-store" }),
    fetch(`http://localhost:3000/runtime-patch-v6.4.js?v=${cacheBust}`, { cache: "no-store" }),
    fetch(`http://localhost:3000/runtime-hotfix-v6.4-content-loop.js?v=${cacheBust}`, { cache: "no-store" }),
    fetch(`http://localhost:3000/runtime-context-v6.4.js?v=${cacheBust}`, { cache: "no-store" }),
  ]);

  if (!assistantResponse.ok) throw new Error(`Assistant HTTP ${assistantResponse.status}`);
  if (!patchResponse.ok) throw new Error(`Patch v6.4 HTTP ${patchResponse.status}`);
  if (!manualHotfixResponse.ok) throw new Error(`Hotfix navigation manuelle HTTP ${manualHotfixResponse.status}`);
  if (!contextPatchResponse.ok) throw new Error(`Patch contexte activité HTTP ${contextPatchResponse.status}`);

  const [baseCodeRaw, patchCode, manualHotfixCode, contextPatchCode] = await Promise.all([
    assistantResponse.text(), patchResponse.text(), manualHotfixResponse.text(), contextPatchResponse.text(),
  ]);

  const baseCode = normalizeSourceText(baseCodeRaw);
  if (!baseCode.includes(`ASSISTANT_VERSION = "${baseVersion}"`)) {
    throw new Error(`[Loader Global Exam] Base v${baseVersion} attendue.`);
  }
  if (!manualHotfixCode.includes(`HOTFIX_VERSION = "${expectedManualHotfix}"`)) {
    throw new Error(`[Loader Global Exam] Hotfix manuel obsolète: ${expectedManualHotfix} attendu.`);
  }
  if (!contextPatchCode.includes(`CONTEXT_PATCH_VERSION = "${expectedContextPatch}"`)) {
    throw new Error(`[Loader Global Exam] Patch contexte obsolète: ${expectedContextPatch} attendu.`);
  }

  (0, eval)(patchCode);
  (0, eval)(manualHotfixCode);
  (0, eval)(contextPatchCode);

  let code = window.__applyGlobalExamV64Patch(baseCode);
  code = window.__applyGlobalExamV64ContentLoopFix(code);
  code = window.__applyGlobalExamV64ContextPatch(code);
  code = repairKnownGeneratedSyntax(code);
  code = applyPageRealityVerificationPatch(code);
  assertGeneratedCodeSyntax(code);
  (0, eval)(code);
  installFeedbackSurveyGuard();

  const loaded = window.__GLOBAL_EXAM_ASSISTANT_VERSION || "inconnue";
  if (loaded !== expectedVersion) throw new Error(`Version chargée ${loaded}, v${expectedVersion} attendue.`);

  window.geRuntimeVersions = () => ({
    assistant: loaded,
    base: baseVersion,
    manualFlow: expectedManualHotfix,
    context: expectedContextPatch,
    verification: verificationPatchVersion,
  });

  console.log(
    `[Loader Global Exam] Chargé : assistant v${loaded} | ${expectedManualHotfix} | ` +
    `${expectedContextPatch} | ${verificationPatchVersion}`
  );
})();
