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
  const orderingGrammarFixVersion = "6.4-ordering-grammar-v1";
  const orderingCarouselFixVersion = "6.4-ordering-carousel-v2";

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
      throw new Error(`[Loader Global Exam] ${pageAuditRecursionFixVersion}: bloc questionHint introuvable.`);
    }
    code = code.replace(before, after);
    console.log(
      `[Loader Global Exam] ${pageAuditRecursionFixVersion} appliqué : ` +
      `pageDomAudit ne rappelle plus looksLikeQuestionPage().`
    );
    return code;
  };

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

  const repairOrderingGrammarQuality = (source) => {
    let code = String(source || "");

    const adjudicationMarker = `  const adjudicationNote = (q, first, second) => {`;
    if (!code.includes(adjudicationMarker)) {
      throw new Error(`[Loader Global Exam] ${orderingGrammarFixVersion}: adjudicationNote introuvable.`);
    }

    const helpers = `  const ORDERING_GRAMMAR_FIX_VERSION = "${orderingGrammarFixVersion}";

  const orderingSentenceFromResult = (q, result) => {
    if (q?.type !== 'ordering' || !Array.isArray(result?.order)) return '';
    const order = result.order.map(Number);
    if (order.length !== (q.items?.length || 0) || new Set(order).size !== order.length) return '';
    if (order.some((idx) => !Number.isInteger(idx) || idx < 0 || idx >= q.items.length)) return '';
    return order
      .map((idx) => String(q.items[idx]?.text || '').trim())
      .join(' ')
      .replace(/\\s+([?.!,;:])/g, '$1')
      .replace(/\\s+/g, ' ')
      .trim();
  };

  const orderingGrammarIssues = (q, result) => {
    if (q?.type !== 'ordering') return [];
    const sentence = orderingSentenceFromResult(q, result);
    const issues = [];
    if (!sentence) return ['permutation ou phrase impossible à reconstruire'];

    const instructionLoose = normLoose(q.orderingInstruction || q.prompt || '');
    const isQuestion = instructionLoose.includes('question');
    const firstIndex = Number(result.order?.[0]);
    const firstFragment = normLoose(q.items?.[firstIndex]?.text || '');

    if (!isQuestion) {
      const suspiciousDeclarativeStart = /^(is|are|was|were|has|have|had|can|could|will|would|should|may|might|must|do|does|did)(\\b|$)/.test(firstFragment);
      if (suspiciousDeclarativeStart) {
        issues.push('phrase déclarative commençant par un auxiliaire/verbe sans sujet explicite');
      }
      if (/^(is|are|was|were)\\s+(when|a|an|the)\\b/.test(firstFragment)) {
        issues.push('définition probablement inversée: le terme/sujet doit précéder le fragment verbal');
      }
    }

    if (isQuestion) {
      const qm = (q.items || []).findIndex((item) => /^\\?+$/.test(String(item.text || '').trim()));
      if (qm >= 0 && Number(result.order?.[result.order.length - 1]) !== qm) {
        issues.push('point d’interrogation non placé en dernière position');
      }
    }
    return issues;
  };

`;
    code = code.replace(adjudicationMarker, helpers + adjudicationMarker);

    const oldOrderingFormat = `      "ordering": 'Format: {"order":[2,0,1],"confidence":0.92,"explanation":"courte"}',`;
    const newOrderingFormat = `      "ordering": 'Format: {"order":[2,0,1],"confidence":0.92,"explanation":"courte"}. MÉTHODE OBLIGATOIRE: reconstruis d’abord la phrase complète en anglais, puis seulement convertis-la en index. Identifie le sujet/terme, le verbe ou la copule, les articles, compléments et la ponctuation. Pour une phrase déclarative ou une définition, le sujet/terme doit normalement précéder is/are/means/refers to; un fragment comme "is when a" ne doit pas être placé avant le terme qu’il définit. Vérifie accord sujet-verbe, a/an, singulier/pluriel, prépositions, sens naturel et ponctuation. Utilise chaque fragment exactement une fois.',`;
    if (!code.includes(oldOrderingFormat)) {
      throw new Error(`[Loader Global Exam] ${orderingGrammarFixVersion}: format ordering introuvable.`);
    }
    code = code.replace(oldOrderingFormat, newOrderingFormat);

    const oldStructural = `    if (q.type === "ordering") {
      const a = (result.order || []).map(Number);
      return Array.isArray(result.order) && a.length === q.items.length && new Set(a).size === q.items.length && a.every((i) => Number.isInteger(i) && i >= 0 && i < q.items.length);
    }`;
    const newStructural = `    if (q.type === "ordering") {
      const a = (result.order || []).map(Number);
      const permutationOk = Array.isArray(result.order) && a.length === q.items.length && new Set(a).size === q.items.length && a.every((i) => Number.isInteger(i) && i >= 0 && i < q.items.length);
      if (!permutationOk) return false;
      const grammarIssues = orderingGrammarIssues(q, result);
      if (grammarIssues.length) {
        console.warn('[Global Exam Ordering] Candidat rejeté avant application:', orderingSentenceFromResult(q, result), grammarIssues);
        return false;
      }
      return true;
    }`;
    if (!code.includes(oldStructural)) {
      throw new Error(`[Loader Global Exam] ${orderingGrammarFixVersion}: validation structurelle ordering introuvable.`);
    }
    code = code.replace(oldStructural, newStructural);

    const oldReview = `        const review = normalizeResultForQuestion(q, await askAiAgent(q, "Refais le raisonnement indépendamment. Vérifie tous les index et renvoie la réponse finale selon le même schéma strict.", 1));`;
    const newReview = `        const reviewInstruction = q.type === 'ordering'
          ? [
              'REVISION GRAMMATICALE INDÉPENDANTE DE L’ORDERING.',
              'Reconstruis toi-même la phrase correcte à partir de TOUS les fragments avant de regarder les index du candidat A.',
              'Cherche activement une inversion sujet/verbe, un mauvais article a/an, un problème d’accord, de préposition, de singulier/pluriel ou une phrase peu naturelle.',
              'Ne confirme pas le candidat A simplement parce qu’il semble plausible.',
              'Candidat A indices: ' + JSON.stringify(result.order || []),
              'Candidat A phrase reconstruite: "' + orderingSentenceFromResult(q, result) + '"',
              'Si cette phrase est incorrecte, renvoie l’ordre corrigé. Sinon renvoie le même ordre.',
              'Utilise chaque fragment exactement une fois et renvoie uniquement le JSON strict attendu.'
            ].join('\\n')
          : "Refais le raisonnement indépendamment. Vérifie tous les index et renvoie la réponse finale selon le même schéma strict.";
        const review = normalizeResultForQuestion(q, await askAiAgent(q, reviewInstruction, 1));`;
    if (!code.includes(oldReview)) {
      throw new Error(`[Loader Global Exam] ${orderingGrammarFixVersion}: double vérification ordering introuvable.`);
    }
    code = code.replace(oldReview, newReview);

    const oldAdjudicationRule = `      q.type === "drag-drop" ? "Pour un drag-drop, lis la position [[ZONE_n]] dans chaque contexte et associe chaque item exactement une fois." : "",`;
    const newAdjudicationRule = `      q.type === "ordering"
        ? "Pour un ordering, ignore les scores de confiance et juge la grammaire/le sens de la phrase réellement reconstruite. Phrase candidate A: \\\"" + orderingSentenceFromResult(q, first) + "\\\". Phrase candidate B: \\\"" + orderingSentenceFromResult(q, second) + "\\\". Reconstruis aussi ta propre phrase depuis zéro; choisis l’ordre grammaticalement et sémantiquement correct, chaque fragment exactement une fois."
        : (q.type === "drag-drop" ? "Pour un drag-drop, lis la position [[ZONE_n]] dans chaque contexte et associe chaque item exactement une fois." : ""),`;
    if (!code.includes(oldAdjudicationRule)) {
      throw new Error(`[Loader Global Exam] ${orderingGrammarFixVersion}: règle arbitrage ordering introuvable.`);
    }
    code = code.replace(oldAdjudicationRule, newAdjudicationRule);

    const debugMarker = "  window.geUnblock = clearHardBlock;";
    if (code.includes(debugMarker)) {
      code = code.replace(
        debugMarker,
        `  window.geOrderingGrammarFixVersion = () => "${orderingGrammarFixVersion}";\n` +
        `  window.geDebugOrderingGrammar = () => {\n` +
        `    const q = detectQuestion();\n` +
        `    const result = state.agent.lastResult;\n` +
        `    const data = { type: q?.type, items: (q?.items || []).map((x) => x.text), order: result?.order || null, sentence: orderingSentenceFromResult(q, result), issues: orderingGrammarIssues(q, result) };\n` +
        `    console.log('[Global Exam Ordering Grammar]', data);\n` +
        `    return data;\n` +
        `  };\n` +
        debugMarker
      );
    }

    console.log(`[Loader Global Exam] ${orderingGrammarFixVersion} appliqué : reconstruction grammaticale vérifiée avant application.`);
    return code;
  };

  const repairOrderingCarouselRobustness = (source) => {
    let code = String(source || "");
    const clickMarker = `  const clickOrderingItemRobust = async (q, original) => {`;
    if (!code.includes(clickMarker)) {
      throw new Error(`[Loader Global Exam] ${orderingCarouselFixVersion}: clickOrderingItemRobust introuvable.`);
    }

    const helpers = `  const ORDERING_CAROUSEL_FIX_VERSION = "${orderingCarouselFixVersion}";

  const orderingPagerSnapshot = (q) => {
    const root = q?.root?.isConnected ? q.root : document.body;
    const instruction = findOrderingInstructionElement(root) || findOrderingInstructionElement(document.body);
    const target = orderingTargetLive(q) || findOrderingTarget(root, instruction) || findOrderingTarget(document.body, instruction);
    const selection = orderingSelectionState(document.body, instruction, target);
    return { root, instruction, target, selection, items: selection?.remainingItems || [] };
  };

  const orderingBankSignature = (q) => orderingPagerSnapshot(q).items
    .filter((item) => orderingFragmentActuallyReachable(item?.element))
    .map((item) => norm(item?.text || ''))
    .filter(Boolean)
    .join('||');

  const orderingPagerControls = (q) => {
    const snap = orderingPagerSnapshot(q);
    const reachableItems = snap.items.filter((item) => orderingFragmentActuallyReachable(item?.element));
    const geometryItems = reachableItems.length ? reachableItems : snap.items;
    const rects = geometryItems
      .map((item) => item?.element)
      .filter((el) => el?.isConnected && isVisible(el))
      .map((el) => el.getBoundingClientRect());
    if (!rects.length) return [];

    const minLeft = Math.min(...rects.map((r) => r.left));
    const maxRight = Math.max(...rects.map((r) => r.right));
    const minTop = Math.min(...rects.map((r) => r.top));
    const maxBottom = Math.max(...rects.map((r) => r.bottom));
    const midX = (minLeft + maxRight) / 2;

    return [...document.querySelectorAll("button,[role='button'],[tabindex]")]
      .filter((el) => el?.isConnected && isVisible(el) && isEnabled(el) && !isAssistantElement(el))
      .map((el) => {
        const r = el.getBoundingClientRect();
        const raw = String(controlText(el) || '').trim();
        const label = normLoose([raw, el.getAttribute?.('aria-label') || '', el.getAttribute?.('title') || ''].join(' '));
        const glyph = /^[←→‹›«»<>]+$/.test(raw);
        const iconOnly = !raw && !!el.querySelector?.('svg,path,i');
        const arrowWord = /(^| )(left|right|previous|prev|next|precedent|precedente|suivant|arrow)( |$)/.test(label);
        const small = r.width >= 16 && r.width <= 78 && r.height >= 16 && r.height <= 72;
        const sameBand = r.bottom >= minTop - 42 && r.top <= maxBottom + 42;
        const closeHorizontally = r.right >= minLeft - 110 && r.left <= maxRight + 110;
        if (!small || !sameBand || !closeHorizontally || !(glyph || iconOnly || arrowWord)) return null;

        let direction = 0;
        if (/(^| )(left|previous|prev|precedent|precedente)( |$)/.test(label) || /^[←‹«<]+$/.test(raw)) direction = -1;
        else if (/(^| )(right|next|suivant)( |$)/.test(label) || /^[→›»>]+$/.test(raw)) direction = 1;
        else direction = (r.left + r.width / 2) < midX ? -1 : 1;
        return { element: el, direction, label: raw || label || (direction < 0 ? '←' : '→'), left: r.left };
      })
      .filter(Boolean)
      .sort((a, b) => a.left - b.left);
  };

  const clickOrderingPagerControl = async (control) => {
    const el = control?.element;
    if (!el?.isConnected || !isVisible(el) || !isEnabled(el)) return false;
    state.agent.internalClick = true;
    try {
      el.click();
      state.clicks += 1;
    } catch {
      return false;
    } finally {
      setTimeout(() => { state.agent.internalClick = false; }, 0);
    }
    await wait(220);
    return true;
  };

  const orderingFragmentActuallyReachable = (el) => {
    if (!el?.isConnected || !isVisible(el) || !isEnabled(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
    const x = Math.max(1, Math.min(innerWidth - 2, r.left + r.width / 2));
    const y = Math.max(1, Math.min(innerHeight - 2, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  };

  const revealOrderingFragment = async (q, text) => {
    let live = resolveLiveOrderingItem(q, text);
    if (orderingFragmentActuallyReachable(live)) return live;

    for (const direction of [1, -1, 1]) {
      let stagnant = 0;
      for (let step = 0; step < 24; step += 1) {
        const control = orderingPagerControls(q).find((c) => c.direction === direction);
        if (!control) break;
        const before = orderingBankSignature(q);
        if (!await clickOrderingPagerControl(control)) break;
        live = resolveLiveOrderingItem(q, text);
        if (orderingFragmentActuallyReachable(live)) {
          console.log('[Global Exam Ordering] Fragment révélé via pagination:', text);
          return live;
        }
        const after = orderingBankSignature(q);
        stagnant = after === before ? stagnant + 1 : 0;
        if (stagnant >= 6) break;
      }
    }
    return resolveLiveOrderingItem(q, text);
  };

  const orderingCarouselItemKey = (item) => {
    const el = item?.element;
    const text = norm(item?.text || '');
    if (!text) return '';
    const stableAttrs = ['data-rbd-draggable-id','data-draggable-id','data-id','data-index','id'];
    let stable = '';
    for (const attr of stableAttrs) {
      const value = el?.getAttribute?.(attr);
      if (value) { stable = attr + '=' + value; break; }
    }
    return stable ? text + '::' + stable : text;
  };

  const enrichOrderingCarouselQuestion = async (q) => {
    if (q?.type !== 'ordering') return q;
    const initial = orderingPagerSnapshot(q);
    if (Number(initial.selection?.selectedCount || 0) > 0) return q;
    if (!orderingPagerControls(q).length) return q;

    const moveToBoundary = async (direction, collect = null) => {
      let stagnant = 0;
      for (let step = 0; step < 32; step += 1) {
        const control = orderingPagerControls(q).find((c) => c.direction === direction);
        if (!control) break;
        const before = orderingBankSignature(q);
        if (!await clickOrderingPagerControl(control)) break;
        const snap = orderingPagerSnapshot(q);
        if (collect) collect(snap.items);
        const after = orderingBankSignature(q);
        stagnant = after === before ? stagnant + 1 : 0;
        if (stagnant >= 6) break;
      }
    };

    await moveToBoundary(-1);

    const registry = new Map();
    const signatures = new Set();
    const collect = (items) => {
      const reachable = (items || []).filter((item) => orderingFragmentActuallyReachable(item?.element));
      const sig = reachable.map((item) => norm(item?.text || '')).filter(Boolean).join('||');
      if (sig) signatures.add(sig);
      for (const item of items || []) {
        const key = orderingCarouselItemKey(item);
        if (key && !registry.has(key)) registry.set(key, item);
      }
    };

    collect(orderingPagerSnapshot(q).items);
    await moveToBoundary(1, collect);
    await moveToBoundary(-1, collect);
    await moveToBoundary(1, collect);

    const allItems = [...registry.values()];
    if (allItems.length >= (q.items?.length || 0) && allItems.length > 0) {
      const previous = q.items?.length || 0;
      q.items = allItems.map((item, index) => ({ ...item, index }));
      q.remainingCount = q.items.length;
      q.totalCount = q.items.length;
      q._orderingCarouselScanned = true;
      q._orderingCarouselPages = signatures.size;
      q.key = makeQuestionKey(q);
      if (q.items.length !== previous || signatures.size > 1) {
        console.log('[Global Exam Ordering] Banque paginée lue en entier:', q.items.length + ' fragment(s), ' + signatures.size + ' vue(s) réellement accessibles.', q.items.map((x) => x.text));
      }
    }
    return q;
  };

`;
    code = code.replace(clickMarker, helpers + clickMarker);

    const oldClickOpen = `  const clickOrderingItemRobust = async (q, original) => {
    let live = resolveLiveOrderingItem(q, original.text);
    if (!live) return false;`;
    const newClickOpen = `  const clickOrderingItemRobust = async (q, original) => {
    let live = await revealOrderingFragment(q, original.text);
    if (!live) {
      log('Ordering: fragment introuvable même après parcours de la banque: ' + original.text);
      return false;
    }`;
    if (!code.includes(oldClickOpen)) {
      throw new Error(`[Loader Global Exam] ${orderingCarouselFixVersion}: ouverture clickOrderingItemRobust introuvable.`);
    }
    code = code.replace(oldClickOpen, newClickOpen);

    const oldApplyClick = `          const ok = await clickOrderingItemRobust(q, original);
          if (!ok) {
            log(\`Ordering: clic non confirmé pour \${idx} (\${original.text}); Valider/Suivant bloqués.\`);
            return false;
          }
          confirmedClicks += 1;
          state.agent.partialMutation = true;
          await wait(180);`;
    const newApplyClick = `          let ok = false;
          for (let clickAttempt = 0; clickAttempt < 3 && !ok; clickAttempt += 1) {
            ok = await clickOrderingItemRobust(q, original);
            if (!ok && clickAttempt < 2) {
              log(\`Ordering: clic non confirmé pour \${idx} (\${original.text}); nouvelle tentative \${clickAttempt + 2}/3 après recherche dans la banque.\`);
              await wait(260);
            }
          }
          if (!ok) {
            log(\`Ordering: clic non confirmé pour \${idx} (\${original.text}) après 3 tentatives; Valider/Suivant bloqués.\`);
            return false;
          }
          confirmedClicks += 1;
          state.agent.partialMutation = true;
          await wait(180);`;
    if (!code.includes(oldApplyClick)) {
      throw new Error(`[Loader Global Exam] ${orderingCarouselFixVersion}: boucle clic ordering introuvable.`);
    }
    code = code.replace(oldApplyClick, newApplyClick);

    const readingMarker = `    const questionReading = verifyQuestionReading(q);`;
    if (!code.includes(readingMarker)) {
      throw new Error(`[Loader Global Exam] ${orderingCarouselFixVersion}: contrôle lecture question introuvable.`);
    }
    code = code.replace(readingMarker, `    await enrichOrderingCarouselQuestion(q);\n` + readingMarker);

    const oldEssential = `    const essential = [
      ...(q?.choices || []).map((x) => x.text),
      ...(q?.items || []).map((x) => x.text)
    ].filter((x) => {`;
    const newEssential = `    const essential = [
      ...(q?.choices || []).map((x) => x.text),
      ...((q?.type === 'ordering' && q?._orderingCarouselScanned) ? [] : (q?.items || []).map((x) => x.text))
    ].filter((x) => {`;
    if (!code.includes(oldEssential)) {
      throw new Error(`[Loader Global Exam] ${orderingCarouselFixVersion}: contrôle présence DOM des items introuvable.`);
    }
    code = code.replace(oldEssential, newEssential);

    const debugMarker = "  window.geUnblock = clearHardBlock;";
    if (code.includes(debugMarker)) {
      code = code.replace(
        debugMarker,
        `  window.geOrderingCarouselFixVersion = () => "${orderingCarouselFixVersion}";\n` +
        `  window.geDebugOrderingCarousel = async () => {\n` +
        `    const q = detectQuestion();\n` +
        `    const before = orderingPagerSnapshot(q);\n` +
        `    const controls = orderingPagerControls(q).map((c) => ({ direction: c.direction, label: c.label }));\n` +
        `    if (q?.type === 'ordering' && Number(before.selection?.selectedCount || 0) === 0) await enrichOrderingCarouselQuestion(q);\n` +
        `    const after = orderingPagerSnapshot(q);\n` +
        `    const data = { type: q?.type, selected: before.selection?.selectedCount || 0, controls, pages: q?._orderingCarouselPages || 1, reachable: after.items.filter((x) => orderingFragmentActuallyReachable(x?.element)).map((x) => x.text), items: (q?.items || []).map((x, index) => ({ index, text: x.text })) };\n` +
        `    console.log('[Global Exam Ordering Carousel]', data);\n` +
        `    console.table(data.items);\n` +
        `    return data;\n` +
        `  };\n` +
        debugMarker
      );
    }

    console.log(`[Loader Global Exam] ${orderingCarouselFixVersion} appliqué : carrousel virtualisé parcouru par vues réellement accessibles avant IA et avant clic.`);
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
    if (!response.ok) throw new Error(`${entries[index][0]} HTTP ${response.status}`);
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

  if (!baseCode.includes(`ASSISTANT_VERSION = "${baseVersion}"`)) throw new Error(`[Loader Global Exam] Base v${baseVersion} attendue.`);
  if (!runtimeCode.includes("__applyGlobalExamV64Patch")) throw new Error(`[Loader Global Exam] Patch runtime v${expectedRuntimePatch} absent.`);
  if (!manualCode.includes(`HOTFIX_VERSION = "${expectedManualHotfix}"`)) throw new Error(`[Loader Global Exam] Hotfix manuel attendu: ${expectedManualHotfix}.`);
  if (!contextCode.includes(`CONTEXT_PATCH_VERSION = "${expectedContextPatch}"`)) throw new Error(`[Loader Global Exam] Patch contexte attendu: ${expectedContextPatch}.`);
  if (!pageAuditCode.includes(`PAGE_AUDIT_VERSION = "${expectedPageAudit}"`)) throw new Error(`[Loader Global Exam] Audit de page attendu: ${expectedPageAudit}.`);
  if (!finalizeCode.includes(`FINALIZE_PATCH_VERSION = "${expectedFinalizePatch}"`)) throw new Error(`[Loader Global Exam] Patch de finalisation attendu: ${expectedFinalizePatch}.`);
  if (!qualityCode.includes(`QUALITY_PATCH_VERSION = "${expectedQualityPatch}"`)) throw new Error(`[Loader Global Exam] Patch qualité attendu: ${expectedQualityPatch}.`);

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
  code = repairOrderingGrammarQuality(code);
  code = repairOrderingCarouselRobustness(code);
  assertSyntax(code);
  (0, eval)(code);
  installFeedbackSurveyGuard();

  const loaded = window.__GLOBAL_EXAM_ASSISTANT_VERSION || "inconnue";
  if (loaded !== expectedVersion) throw new Error(`Version chargée ${loaded}, v${expectedVersion} attendue.`);

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
    orderingGrammar: orderingGrammarFixVersion,
    orderingCarousel: orderingCarouselFixVersion,
  });

  console.log(
    `[Loader Global Exam] Chargé : assistant v${loaded} | ${expectedManualHotfix} | ` +
    `${expectedContextPatch} | ${expectedPageAudit} | ${pageAuditRecursionFixVersion} | ` +
    `${expectedFinalizePatch} | ${expectedQualityPatch} | ${questionReadingVersion} | ` +
    `${orderingStateFixVersion} | ${orderingGrammarFixVersion} | ${orderingCarouselFixVersion}`
  );
})();