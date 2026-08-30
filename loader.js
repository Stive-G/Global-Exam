// Global Exam Assistant — loader léger pour le Snippet DevTools.
(async () => {
  const expectedVersion = "6.4";
  const baseVersion = "6.3";
  const expectedRuntimePatch = "6.4";
  const expectedManualHotfix = "6.4-content-loop-manual-flow-v3";
  const expectedContextPatch = "6.4-context-v1";
  const expectedPageAudit = "6.4-page-audit-v2";
  const pageAuditRecursionFixVersion = "6.4-page-audit-recursion-fix-v1";
  const expectedFinalizePatch = "6.4-finalize-v1";
  const expectedQualityPatch = "6.4-quality-v1";
  const questionReadingVersion = "6.4-question-reading-v1";
  const orderingStateFixVersion = "6.4-ordering-empty-target-v1";

  if (window.__globalExamPager) {
    const loaded = window.__GLOBAL_EXAM_ASSISTANT_VERSION || "ancienne/inconnue";
    console.warn(
      `[Loader Global Exam] Une version ${loaded} est déjà chargée. ` +
      `Fais Ctrl+R puis relance le Snippet.`
    );
    return;
  }

  const normalize = (value) => String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");

  const repairKnownGeneratedSyntax = (source) => {
    let code = String(source || "");
    const broken = "console.log('[Global Exam Assistant] Contexte envoyé aux IA:\n' + activityContextPrompt());";
    const fixed = "console.log('[Global Exam Assistant] Contexte envoyé aux IA:\\n' + activityContextPrompt());";
    if (code.includes(broken)) {
      code = code.replace(broken, fixed);
      console.log("[Loader Global Exam] Correction syntaxique du patch contexte appliquée.");
    }
    return code;
  };

  // Le patch d'audit v2 remplace les appels isFeedbackPage() par
  // isRealFeedbackPage(). Or looksLikeQuestionPage() appelle alors
  // isRealFeedbackPage() -> pageDomAudit(). Si pageDomAudit() rappelle à son tour
  // looksLikeQuestionPage(), on obtient une récursion infinie.
  const repairPageAuditRecursion = (source) => {
    let code = String(source || "");
    const before = [
      "    let questionHint = false;",
      "    try { questionHint = !!looksLikeQuestionPage(); } catch {}",
      "    const visibleCorrection = visibleCorrectionBannerNow();"
    ].join("\n");

    const after = [
      "    const auditInstruction = bodyInstruction();",
      "    const auditQuestionMarkers = [",
      "      'fill in the blank', 'fill in the blanks', 'match the',",
      "      'place the words', 'put the words', 'choose', 'select',",
      "      'which of', 'what is', 'who are', 'complete the', 'answer the',",
      "      'true or false', 'vrai ou faux', 'fill in', 'drag', 'drop'",
      "    ].map(normLoose);",
      "    const questionHint = auditQuestionMarkers.some((m) => auditInstruction.includes(m));",
      "    const visibleCorrection = visibleCorrectionBannerNow();"
    ].join("\n");

    if (!code.includes(before)) {
      throw new Error(
        `[Loader Global Exam] ${pageAuditRecursionFixVersion}: bloc questionHint introuvable.`
      );
    }

    code = code.replace(before, after);
    console.log(
      `[Loader Global Exam] ${pageAuditRecursionFixVersion} appliqué : ` +
      `pageDomAudit ne rappelle plus looksLikeQuestionPage().`
    );
    return code;
  };

  // Global Exam peut laisser dans la zone d'ordering vide un badge/élément interne
  // (souvent numérique). L'ancien comptage le prenait pour un fragment déjà placé,
  // puis tentait de l'annuler et bloquait toute la question. On exige désormais une
  // preuve textuelle/visuelle sémantique avant de déclarer selectedCount > 0.
  const repairOrderingFalsePartialState = (source) => {
    let code = String(source || "");
    const before = `    return {
      target: liveTarget,
      remainingItems,
      remainingCount: remainingItems.length,
      selectedCount,
      selectedTexts,
      totalCount: selectedCount + remainingItems.length,
    };
  };

  const detectInstructionOrdering = (root) => {`;

    const after = `    if (liveTarget && selectedCount > 0) {
      const isMeaningfulOrderingPlacedText = (value) => {
        const raw = String(value || '').replace(/\\s+/g, ' ').trim();
        const loose = normLoose(raw);
        if (!raw || !loose || /^\\d{1,2}$/.test(raw)) return false;
        if (isExerciseUiNoiseText(raw)) return false;
        if (/^(drop|drag|place|answer|response|your answer|your response|votre reponse|zone|target|result|resultat|phrase|sentence|here|ici)(\\b|$)/.test(loose)) return false;
        return true;
      };

      const directText = String(zoneDirectText(liveTarget) || '').replace(/\\s+/g, ' ').trim();
      const semanticSelected = (selectedTexts || []).filter(isMeaningfulOrderingPlacedText);
      const visualSemantic = orderingVisualSelectedTexts(liveTarget).filter(isMeaningfulOrderingPlacedText);
      const hasSemanticEvidence =
        isMeaningfulOrderingPlacedText(directText) ||
        semanticSelected.length > 0 ||
        visualSemantic.length > 0;

      if (!hasSemanticEvidence) {
        console.log('[Global Exam Ordering] Faux fragment déjà placé ignoré : cible visuellement vide.');
        selectedCount = 0;
        selectedTexts = [];
      }
    }

    return {
      target: liveTarget,
      remainingItems,
      remainingCount: remainingItems.length,
      selectedCount,
      selectedTexts,
      totalCount: selectedCount + remainingItems.length,
    };
  };

  const detectInstructionOrdering = (root) => {`;

    if (!code.includes(before)) {
      throw new Error(`[Loader Global Exam] ${orderingStateFixVersion}: bloc orderingSelectionState introuvable.`);
    }
    code = code.replace(before, after);

    const debugMarker = "  window.geUnblock = clearHardBlock;";
    if (code.includes(debugMarker)) {
      code = code.replace(
        debugMarker,
        `  window.geOrderingStateFixVersion = () => "${orderingStateFixVersion}";\n` + debugMarker
      );
    }

    console.log(`[Loader Global Exam] ${orderingStateFixVersion} appliqué : cible ordering vide ≠ fragment déjà placé.`);
    return code;
  };

  // Lecture complète de la question avant chaque appel IA. Le modèle reçoit désormais
  // non seulement q.prompt, mais aussi le texte visible du bloc de question, tous les
  // choix/items/zones/champs et la progression courante. Si cette lecture est incomplète,
  // l'automatisation se bloque au lieu de deviner ou de passer la question.
  const applyQuestionReadingGuard = (source) => {
    let code = String(source || "");
    const analyzeMarker = "  const analyzeCurrentQuestion = async () => {\n";
    if (!code.includes(analyzeMarker)) {
      throw new Error(`[Loader Global Exam] ${questionReadingVersion}: analyzeCurrentQuestion introuvable.`);
    }

    const helpers = `  const QUESTION_READING_VERSION = "${questionReadingVersion}";

  const questionReadingSnapshot = (q) => {
    const root = q?.root?.isConnected ? q.root : findQuestionRoot();
    const pageRoot = root || document.body;
    const rootText = String(textOf(pageRoot) || '')
      .replace(/\\b\\d{1,2}:\\d{2}\\s*\\/\\s*\\d{1,2}:\\d{2}\\b/g, ' ')
      .replace(/\\b\\d{1,3}\\s*\\/\\s*\\d{1,3}\\b/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim()
      .slice(0, 9000);

    return {
      marker: String(currentProgressMarker() || ''),
      type: q?.type || '',
      instruction: String(q?.prompt || '').trim(),
      visibleQuestionText: rootText,
      choices: (q?.choices || []).map((c) => ({ index: c.index, text: String(c.text || '').trim() })),
      items: (q?.items || []).map((i) => ({ index: i.index, text: String(i.text || '').trim() })),
      zones: (q?.zones || []).map((z) => ({ index: z.index, originalIndex: z.originalIndex, text: String(z.text || '').trim() })),
      fields: (q?.fields || []).map((f) => ({
        index: f.index,
        label: String(f.label || '').trim(),
        options: (f.options || []).map((o) => ({ index: o.index, text: String(o.text || '').trim() }))
      })),
      rows: (q?.rows || []).map((r) => ({
        rowIndex: r.rowIndex,
        text: String(r.rowText || '').trim(),
        choices: (r.choices || []).map((c) => ({ index: c.index, text: String(c.text || '').trim() }))
      }))
    };
  };

  const verifyQuestionReading = (q) => {
    const snapshot = questionReadingSnapshot(q);
    const issues = [];
    const instruction = normLoose(snapshot.instruction);
    if (!instruction || instruction.length < 4) issues.push('énoncé/consigne vide ou trop court');

    const requireTexts = (name, values) => {
      const missing = values.filter((value) => !String(value || '').trim());
      if (missing.length) issues.push(name + ': ' + missing.length + ' texte(s) vide(s)');
    };

    if (q?.choices?.length) requireTexts('choix', q.choices.map((x) => x.text));
    if (q?.items?.length) requireTexts('items', q.items.map((x) => x.text));
    if (q?.zones?.length) requireTexts('zones', q.zones.map((x) => x.text));
    if (q?.fields?.length) requireTexts('champs', q.fields.map((x) => x.label));

    if (q?.type === 'single-choice' && (q.choices?.length || 0) < 2) issues.push('single-choice: moins de 2 choix');
    if (q?.type === 'multi-choice' && (q.choices?.length || 0) < 2) issues.push('multi-choice: moins de 2 choix');
    if (q?.type === 'ordering' && (q.items?.length || 0) < 2) issues.push('ordering: moins de 2 fragments lus');
    if (q?.type === 'drag-drop' && (!(q.items?.length) || !(q.zones?.length))) issues.push('drag-drop: items ou zones manquants');
    if ((q?.type === 'text' || q?.type === 'multi-text') && !(q.fields?.length)) issues.push('fill-text: aucun champ lu');

    const pageText = normLoose(String(textOf(document.body) || ''));
    const essential = [
      ...(q?.choices || []).map((x) => x.text),
      ...(q?.items || []).map((x) => x.text)
    ].filter((x) => {
      const raw = String(x || '').trim();
      return raw.length >= 2 && !/^[?!.,;:]+$/.test(raw);
    });
    const absent = essential.filter((x) => {
      const t = normLoose(x);
      return t && !pageText.includes(t);
    });
    if (absent.length) issues.push('éléments non retrouvés dans le DOM visible: ' + absent.slice(0, 4).join(' | '));

    if (!snapshot.visibleQuestionText || snapshot.visibleQuestionText.length < 8) {
      issues.push('texte visible du bloc question insuffisant');
    }

    return { ok: issues.length === 0, issues, snapshot };
  };

  const logQuestionReading = (q, reading) => {
    const s = reading.snapshot;
    console.log(
      '[Global Exam Lecture] ' + (s.marker || '?') +
      ' | type=' + (q?.type || '?') +
      ' | énoncé=' + (s.instruction ? 'OK' : 'MANQUANT') +
      ' | choix=' + s.choices.length +
      ' | items=' + s.items.length +
      ' | zones=' + s.zones.length +
      ' | champs=' + s.fields.length +
      ' | lecture=' + (reading.ok ? 'OK' : 'INCOMPLÈTE')
    );
    console.log('[Global Exam Lecture] Énoncé:', s.instruction || '(vide)');
    if (s.choices.length) console.table(s.choices);
    if (s.items.length) console.table(s.items);
    if (s.zones.length) console.table(s.zones);
    if (!reading.ok) console.warn('[Global Exam Lecture] Problèmes:', reading.issues);
  };

`;

    code = code.replace(analyzeMarker, helpers + analyzeMarker);

    const readCheckMarker = "    // Cas déterministe : un seul choix visible pour un seul trou.\n";
    if (!code.includes(readCheckMarker)) {
      throw new Error(`[Loader Global Exam] ${questionReadingVersion}: point de contrôle lecture introuvable.`);
    }
    code = code.replace(
      readCheckMarker,
      "    const questionReading = verifyQuestionReading(q);\n" +
      "    logQuestionReading(q, questionReading);\n" +
      "    if (!questionReading.ok) {\n" +
      "      const readingReason = 'Lecture DOM incomplète: ' + questionReading.issues.join(' | ');\n" +
      "      hardBlock(q.key, readingReason);\n" +
      "      state.agent.lastResult = { error: readingReason, questionKey: q.key, questionPrompt: q.prompt };\n" +
      "      renderPanel(q);\n" +
      "      return state.agent.lastResult;\n" +
      "    }\n\n" +
      readCheckMarker
    );

    // Toutes les questions générales transportent un snapshot DOM explicite dans
    // le JSON envoyé à l'IA. Ainsi q.prompt ne peut plus être la seule source lue.
    const serializedMarker = "    const serialized = JSON.stringify(serializeQuestion(q), null, 2);";
    if (!code.includes(serializedMarker)) {
      throw new Error(`[Loader Global Exam] ${questionReadingVersion}: sérialisation question introuvable.`);
    }
    code = code.replace(
      serializedMarker,
      "    const serializedQuestion = serializeQuestion(q);\n" +
      "    serializedQuestion.page_dom_reading = questionReadingSnapshot(q);\n" +
      "    const serialized = JSON.stringify(serializedQuestion, null, 2);"
    );

    // Le drag-drop a un prompt spécial qui retourne avant la sérialisation générale.
    // On lui injecte donc lui aussi la lecture complète du DOM.
    const dragInstructionA = "        `Instruction: ${q.prompt}` ,";
    const dragInstructionB = "        `Instruction: ${q.prompt}`,";
    const dragInjected =
      "        'LECTURE DOM COMPLÈTE DE LA QUESTION ACTUELLE:',\n" +
      "        JSON.stringify(questionReadingSnapshot(q), null, 2),\n" +
      "        '',\n";
    if (code.includes(dragInstructionA)) {
      code = code.replace(dragInstructionA, dragInjected + dragInstructionA);
    } else if (code.includes(dragInstructionB)) {
      code = code.replace(dragInstructionB, dragInjected + dragInstructionB);
    } else {
      throw new Error(`[Loader Global Exam] ${questionReadingVersion}: instruction drag-drop introuvable.`);
    }

    // Forcer une vraie relecture sémantique, particulièrement importante pour les
    // ordering où tous les fragments doivent être utilisés exactement une fois.
    const commonMarker = "      \"Tu analyses une question d'exercice.\",\n";
    if (!code.includes(commonMarker)) {
      throw new Error(`[Loader Global Exam] ${questionReadingVersion}: règles prompt communes introuvables.`);
    }
    code = code.replace(
      commonMarker,
      commonMarker +
      "      \"Lis d'abord EN ENTIER page_dom_reading, l'énoncé, puis tous les choix/items/zones/champs avant de proposer une réponse.\",\n" +
      "      \"N'invente aucun fragment absent et n'ignore aucun élément fourni par le DOM.\",\n" +
      "      q.type === \"ordering\" ? \"Pour un ordering, reconstruis mentalement la phrase/question complète avec TOUS les fragments exactement une fois; vérifie grammaire, sens et ponctuation avant de renvoyer l'ordre.\" : \"Vérifie que la réponse est directement justifiée par l'énoncé et le DOM actuel.\",\n"
    );

    const debugMarker = "  window.geUnblock = clearHardBlock;";
    if (code.includes(debugMarker)) {
      code = code.replace(
        debugMarker,
        "  window.geQuestionReadingVersion = () => QUESTION_READING_VERSION;\n" +
        "  window.geDebugQuestionReading = () => {\n" +
        "    const q = detectQuestion();\n" +
        "    const reading = verifyQuestionReading(q);\n" +
        "    logQuestionReading(q, reading);\n" +
        "    console.log('[Global Exam Lecture] Texte visible complet:', reading.snapshot.visibleQuestionText);\n" +
        "    return reading;\n" +
        "  };\n" +
        debugMarker
      );
    }

    console.log(`[Loader Global Exam] ${questionReadingVersion} appliqué : lecture DOM complète obligatoire avant IA.`);
    return code;
  };

  const assertSyntax = (code) => {
    try {
      new Function(String(code || ""));
    } catch (error) {
      console.error("[Loader Global Exam] Code généré invalide.", error);
      throw new Error(`Syntaxe du code généré invalide: ${error?.message || error}`);
    }
  };

  const installFeedbackSurveyGuard = () => {
    if (window.__GLOBAL_EXAM_FEEDBACK_SURVEY_GUARD) return;

    const visible = (el) => {
      if (!el || !el.isConnected) return false;
      const r = el.getBoundingClientRect?.();
      const s = getComputedStyle(el);
      return !!r && r.width > 0 && r.height > 0 &&
        s.display !== "none" && s.visibility !== "hidden";
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
            const label = [
              el.getAttribute?.("aria-label"), el.getAttribute?.("title"),
              el.innerText, el.textContent
            ].filter(Boolean).join(" ").trim().toLowerCase();
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

  installFeedbackSurveyGuard();

  const cacheBust = `${expectedVersion}-${Date.now()}`;
  const urls = {
    assistant: `http://localhost:3000/assistant.js?v=${cacheBust}`,
    runtime: `http://localhost:3000/runtime-patch-v6.4.js?v=${cacheBust}`,
    manual: `http://localhost:3000/runtime-hotfix-v6.4-content-loop.js?v=${cacheBust}`,
    context: `http://localhost:3000/runtime-context-v6.4.js?v=${cacheBust}`,
    pageAudit: `http://localhost:3000/runtime-page-audit-v6.4.js?v=${cacheBust}`,
    finalize: `http://localhost:3000/runtime-finalize-v6.4.js?v=${cacheBust}`,
    quality: `http://localhost:3000/runtime-quality-v6.4.js?v=${cacheBust}`,
  };

  const entries = Object.entries(urls);
  const responses = await Promise.all(entries.map(([, url]) => fetch(url, { cache: "no-store" })));
  responses.forEach((response, index) => {
    if (!response.ok) {
      throw new Error(`${entries[index][0]} HTTP ${response.status}`);
    }
  });

  const texts = await Promise.all(responses.map((response) => response.text()));
  const [baseRaw, runtimeRaw, manualRaw, contextRaw, pageAuditRaw, finalizeRaw, qualityRaw] = texts;
  const baseCode = normalize(baseRaw);
  const runtimeCode = normalize(runtimeRaw);
  const manualCode = normalize(manualRaw);
  const contextCode = normalize(contextRaw);
  const pageAuditCode = normalize(pageAuditRaw);
  const finalizeCode = normalize(finalizeRaw);
  const qualityCode = normalize(qualityRaw);

  if (!baseCode.includes(`ASSISTANT_VERSION = "${baseVersion}"`)) {
    throw new Error(`[Loader Global Exam] Base v${baseVersion} attendue.`);
  }
  if (!runtimeCode.includes("__applyGlobalExamV64Patch")) {
    throw new Error(`[Loader Global Exam] Patch runtime v${expectedRuntimePatch} absent.`);
  }
  if (!manualCode.includes(`HOTFIX_VERSION = "${expectedManualHotfix}"`)) {
    throw new Error(`[Loader Global Exam] Hotfix manuel attendu: ${expectedManualHotfix}.`);
  }
  if (!contextCode.includes(`CONTEXT_PATCH_VERSION = "${expectedContextPatch}"`)) {
    throw new Error(`[Loader Global Exam] Patch contexte attendu: ${expectedContextPatch}.`);
  }
  if (!pageAuditCode.includes(`PAGE_AUDIT_VERSION = "${expectedPageAudit}"`)) {
    throw new Error(`[Loader Global Exam] Audit de page attendu: ${expectedPageAudit}.`);
  }
  if (!finalizeCode.includes(`FINALIZE_PATCH_VERSION = "${expectedFinalizePatch}"`)) {
    throw new Error(`[Loader Global Exam] Patch de finalisation attendu: ${expectedFinalizePatch}.`);
  }
  if (!qualityCode.includes(`QUALITY_PATCH_VERSION = "${expectedQualityPatch}"`)) {
    throw new Error(`[Loader Global Exam] Patch qualité attendu: ${expectedQualityPatch}.`);
  }

  (0, eval)(runtimeCode);
  (0, eval)(manualCode);
  (0, eval)(contextCode);
  (0, eval)(pageAuditCode);
  (0, eval)(finalizeCode);
  (0, eval)(qualityCode);

  if (typeof window.__applyGlobalExamV64Patch !== "function") throw new Error("Patch runtime non initialisé.");
  if (typeof window.__applyGlobalExamV64ContentLoopFix !== "function") throw new Error("Hotfix manuel non initialisé.");
  if (typeof window.__applyGlobalExamV64ContextPatch !== "function") throw new Error("Patch contexte non initialisé.");
  if (typeof window.__applyGlobalExamV64PageAuditPatch !== "function") throw new Error("Audit DOM non initialisé.");
  if (typeof window.__applyGlobalExamV64FinalizePatch !== "function") throw new Error("Patch finalisation non initialisé.");
  if (typeof window.__applyGlobalExamV64QualityPatch !== "function") throw new Error("Patch qualité non initialisé.");

  let code = window.__applyGlobalExamV64Patch(baseCode);
  code = window.__applyGlobalExamV64ContentLoopFix(code);
  code = window.__applyGlobalExamV64ContextPatch(code);
  code = repairKnownGeneratedSyntax(code);
  code = window.__applyGlobalExamV64PageAuditPatch(code);
  code = repairPageAuditRecursion(code);
  code = window.__applyGlobalExamV64FinalizePatch(code);
  code = window.__applyGlobalExamV64QualityPatch(code);
  code = repairOrderingFalsePartialState(code);
  code = applyQuestionReadingGuard(code);
  assertSyntax(code);
  (0, eval)(code);
  installFeedbackSurveyGuard();

  const loaded = window.__GLOBAL_EXAM_ASSISTANT_VERSION || "inconnue";
  if (loaded !== expectedVersion) {
    throw new Error(`Version chargée ${loaded}, v${expectedVersion} attendue.`);
  }

  window.geRuntimeVersions = () => ({
    assistant: loaded,
    base: baseVersion,
    manualFlow: expectedManualHotfix,
    context: expectedContextPatch,
    pageAudit: expectedPageAudit,
    pageAuditGuard: pageAuditRecursionFixVersion,
    finalize: expectedFinalizePatch,
    quality: expectedQualityPatch,
    questionReading: questionReadingVersion,
    orderingState: orderingStateFixVersion,
  });

  console.log(
    `[Loader Global Exam] Chargé : assistant v${loaded} | ${expectedManualHotfix} | ` +
    `${expectedContextPatch} | ${expectedPageAudit} | ${pageAuditRecursionFixVersion} | ` +
    `${expectedFinalizePatch} | ${expectedQualityPatch} | ${questionReadingVersion} | ${orderingStateFixVersion}`
  );
})();