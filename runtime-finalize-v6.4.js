(() => {
  const FINALIZE_PATCH_VERSION = "6.4-finalize-v1";

  const replaceOnce = (source, label, before, after) => {
    if (!source.includes(before)) {
      throw new Error(`[Finalize ${FINALIZE_PATCH_VERSION}] Bloc introuvable: ${label}.`);
    }
    return source.replace(before, after);
  };

  window.__applyGlobalExamV64FinalizePatch = (source) => {
    let code = String(source || "");
    if (code.includes(`const FINALIZE_RUNTIME_VERSION = "${FINALIZE_PATCH_VERSION}"`)) return code;

    const detectMarker = "  const detectQuestion = () => {\n";
    code = replaceOnce(
      code,
      "marqueur version finalisation",
      detectMarker,
      `  const FINALIZE_RUNTIME_VERSION = "${FINALIZE_PATCH_VERSION}";\n\n` + detectMarker
    );

    // Rythme par défaut : 15 minutes.
    const oldPacingDefaults = `      activityPacing: {
        enabled: true,
        minMinutes: 30,
        maxMinutes: 30,
      },`;
    const newPacingDefaults = `      activityPacing: {
        enabled: true,
        minMinutes: 15,
        maxMinutes: 15,
      },`;
    code = replaceOnce(code, "rythme par défaut 15 minutes", oldPacingDefaults, newPacingDefaults);

    // Un lecteur audio présent sur la page ne signifie pas que l'exercice courant
    // dépend de cet audio. Les matching/drag-drop entièrement lisibles dans le DOM
    // sont autonomes sauf si la consigne demande explicitement d'écouter/regarder.
    const oldMediaCap = `          const mediaContext = currentMediaContextState();
          if (mediaContext.hasMedia && !mediaContext.hasTranscript) {
            result.confidence = Math.min(result.confidence, 0.45);
            result.explanation = (result.explanation ? result.explanation + ' ' : '') + '[Confiance plafonnée : média présent sans transcription exploitable.]';
          }`;
    const newMediaCap = `          const mediaContext = currentMediaContextState();
          let visibleExerciseSelfContained = false;
          try {
            const promptLoose = normLoose(q?.prompt || '');
            const mediaExplicitlyRequired = [
              'listen', 'listening', 'audio', 'recording', 'hear', 'speaker',
              'watch the video', 'watch this video', 'video clip', 'dialogue', 'conversation'
            ].some((marker) => promptLoose.includes(normLoose(marker)));
            visibleExerciseSelfContained = !mediaExplicitlyRequired && (
              (q?.type === 'drag-drop' && (q.items?.length || 0) > 0 && (q.zones?.length || 0) > 0) ||
              (q?.type === 'ordering' && (q.items?.length || 0) >= 2)
            );
          } catch {}
          if (mediaContext.hasMedia && !mediaContext.hasTranscript && !visibleExerciseSelfContained) {
            result.confidence = Math.min(result.confidence, 0.45);
            result.explanation = (result.explanation ? result.explanation + ' ' : '') + '[Confiance plafonnée : média présent sans transcription exploitable.]';
          } else if (mediaContext.hasMedia && !mediaContext.hasTranscript && visibleExerciseSelfContained) {
            result.explanation = (result.explanation ? result.explanation + ' ' : '') + '[Question textuelle autonome : le média sans transcription n’est pas requis pour résoudre cet exercice.]';
          }`;
    code = replaceOnce(code, "média non requis pour exercice textuel autonome", oldMediaCap, newMediaCap);

    // Le prompt drag-drop spécial ne contenait pas le format JSON concret. Groq et
    // Gemini sont contraints côté API, mais Mistral ne reçoit qu'un json_object.
    // On impose donc le format et les index 0-based directement dans le prompt.
    const oldDragSchemaInstruction = `        "Reponds uniquement selon le schema JSON impose par le serveur.",`;
    const newDragSchemaInstruction = `        "Reponds uniquement avec un objet JSON valide, sans Markdown ni texte autour.",
        'FORMAT OBLIGATOIRE: {"placements":[{"item":0,"zone":0}],"confidence":0.92,"explanation":"courte"}',
        "placements doit contenir EXACTEMENT une entrée par zone.",
        "item et zone sont des ENTIERS indexés à partir de 0, uniquement avec les index affichés ci-dessous.",
        "Chaque item et chaque zone doivent être utilisés exactement une fois; aucun libellé texte à la place des index.",`;
    code = replaceOnce(code, "schéma JSON explicite drag-drop", oldDragSchemaInstruction, newDragSchemaInstruction);

    // Normalisation tolérante des réponses drag-drop : certains fournisseurs
    // renvoient malgré tout des index 1-based, des libellés (RJ45/WiFi) ou des clés
    // source/target. On les ramène au schéma canonique item/zone 0-based AVANT le
    // calcul de signature et l'arbitrage.
    const normalizeMarker = `  const normalizeResultForQuestion = (q, raw) => {`;
    const dragNormalizeHelpers = `  const dragDropZoneLabel = (text) => String(text || '')
    .replace(/^\\s*zone\\s+\\d+\\s*[—:=-]?\\s*/i, '')
    .replace(/^\\s*(?:cible|target|contexte|context|phrase)\\s*[:=-]?\\s*/i, '')
    .replace(/\\[\\[ZONE_\\d+\\]\\]/gi, ' ')
    .replace(/\\s+/g, ' ')
    .trim();

  const dragDropSemanticIndex = (entries, value, kind = 'item') => {
    if (value && typeof value === 'object') {
      value = value.index ?? value.item ?? value.zone ?? value.text ?? value.label ?? value.name ?? value.value;
    }
    const wantedRaw = String(value ?? '').trim();
    const wanted = normLoose(wantedRaw);
    if (!wanted) return null;

    if (kind === 'zone') {
      const zoneNumber = wantedRaw.match(/^\\s*zone\\s*(\\d+)\\s*$/i);
      if (zoneNumber) {
        const idx = Number(zoneNumber[1]) - 1;
        if (Number.isInteger(idx) && idx >= 0 && idx < entries.length) return idx;
      }
    }

    const candidates = (entries || []).map((entry, index) => {
      const raw = String(entry?.text || '');
      const simplified = kind === 'zone' ? dragDropZoneLabel(raw) : raw;
      return { index, full: normLoose(raw), simple: normLoose(simplified) };
    });

    const exact = candidates.find((c) => c.simple === wanted || c.full === wanted);
    if (exact) return exact.index;
    const contained = candidates.find((c) =>
      (c.simple && (c.simple.includes(wanted) || wanted.includes(c.simple))) ||
      (c.full && (c.full.includes(wanted) || wanted.includes(c.full)))
    );
    if (contained) return contained.index;

    let best = null;
    let bestScore = 0;
    for (const c of candidates) {
      const score = Math.max(
        c.simple ? promptSimilarity(wanted, c.simple) : 0,
        c.full ? promptSimilarity(wanted, c.full) : 0
      );
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best && bestScore >= 0.55 ? best.index : null;
  };

  const dragDropRawPlacements = (result) => {
    if (Array.isArray(result?.placements)) return result.placements;
    if (result?.placements && typeof result.placements === 'object') {
      return Object.entries(result.placements).map(([zone, item]) => ({ zone, item }));
    }
    if (Array.isArray(result?.pairs)) return result.pairs;
    if (Array.isArray(result?.matches)) return result.matches;
    if (result?.mapping && typeof result.mapping === 'object') {
      return Object.entries(result.mapping).map(([zone, item]) => ({ zone, item }));
    }
    return [];
  };

  const dragDropField = (placement, side) => {
    if (!placement || typeof placement !== 'object') return undefined;
    if (side === 'item') {
      return placement.item ?? placement.itemIndex ?? placement.item_index ??
        placement.source ?? placement.sourceIndex ?? placement.source_index ??
        placement.word ?? placement.answer ?? placement.definition ?? placement.left;
    }
    return placement.zone ?? placement.zoneIndex ?? placement.zone_index ??
      placement.target ?? placement.targetIndex ?? placement.target_index ??
      placement.destination ?? placement.label ?? placement.right;
  };

  const dragDropOneBased = (values, count) => {
    if (!count || values.length !== count) return false;
    const nums = values.map((v) => Number(v));
    return nums.every((n) => Number.isInteger(n) && n >= 1 && n <= count) &&
      new Set(nums).size === count && !nums.includes(0);
  };

  const normalizeDragDropPlacements = (q, result) => {
    const raw = dragDropRawPlacements(result);
    if (!raw.length) return [];

    const rawItems = raw.map((p) => dragDropField(p, 'item'));
    const rawZones = raw.map((p) => dragDropField(p, 'zone'));
    const itemOneBased = dragDropOneBased(rawItems, q.items?.length || 0);
    const zoneOneBased = dragDropOneBased(rawZones, q.zones?.length || 0);

    const numericOrSemantic = (entries, value, kind, oneBased) => {
      const n = Number(value);
      if (Number.isInteger(n)) {
        const idx = oneBased ? n - 1 : n;
        if (idx >= 0 && idx < entries.length) return idx;
      }
      return dragDropSemanticIndex(entries, value, kind);
    };

    return raw.map((placement) => {
      const rawItem = dragDropField(placement, 'item');
      const rawZone = dragDropField(placement, 'zone');
      let item = numericOrSemantic(q.items || [], rawItem, 'item', itemOneBased);
      let zone = numericOrSemantic(q.zones || [], rawZone, 'zone', zoneOneBased);

      // Certains modèles inversent source/target malgré le prompt. N'inverser que
      // si la lecture directe échoue et que l'inversion est, elle, non ambiguë.
      if (!Number.isInteger(item) || !Number.isInteger(zone)) {
        const swappedItem = numericOrSemantic(q.items || [], rawZone, 'item', zoneOneBased);
        const swappedZone = numericOrSemantic(q.zones || [], rawItem, 'zone', itemOneBased);
        if (Number.isInteger(swappedItem) && Number.isInteger(swappedZone)) {
          item = swappedItem;
          zone = swappedZone;
        }
      }
      return { item, zone };
    });
  };

`;
    code = replaceOnce(code, "helpers normalisation drag-drop", normalizeMarker, dragNormalizeHelpers + normalizeMarker);

    const oldNormalizeStart = `  const normalizeResultForQuestion = (q, raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const result = {...raw};`;
    const newNormalizeStart = `  const normalizeResultForQuestion = (q, raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const result = {...raw};
    if (q.type === "drag-drop") {
      result.placements = normalizeDragDropPlacements(q, result);
    }`;
    code = replaceOnce(code, "normalisation réponse drag-drop", oldNormalizeStart, newNormalizeStart);

    // Les fill-in-the-blanks en drag/drop ont besoin de la phrase autour du trou,
    // pas seulement du morceau de texte placé avant la zone. On enrichit q.zones
    // juste après detectQuestion(), avant toute lecture DOM ou requête IA.
    const analyzeMarker = "  const analyzeCurrentQuestion = async () => {\n";
    const dragSentenceHelpers = `  const sentenceWindowForDropZone = (el, index) => {
    if (!el?.isConnected) return '';

    const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const clipBefore = (value) => {
      let raw = String(value || '').replace(/\\r/g, '');
      const matches = [...raw.matchAll(/[.!?;:\\n]/g)];
      if (matches.length) raw = raw.slice(matches[matches.length - 1].index + 1);
      let text = clean(raw);
      if (text.length > 180) text = text.slice(-180).replace(/^\\S*\\s+/, '');
      return text;
    };
    const clipAfter = (value) => {
      let raw = String(value || '').replace(/\\r/g, '').replace(/^\\s+/, '');
      const match = raw.match(/[.!?;\\n]/);
      if (match && Number.isInteger(match.index)) raw = raw.slice(0, match.index + 1);
      let text = clean(raw);
      if (text.length > 220) text = text.slice(0, 220).replace(/\\s+\\S*$/, '');
      return text;
    };

    const root = findQuestionRoot();
    let node = el.parentElement;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      if (root && node !== root && !root.contains(node)) break;
      try {
        const beforeRange = document.createRange();
        beforeRange.selectNodeContents(node);
        beforeRange.setEndBefore(el);
        const afterRange = document.createRange();
        afterRange.selectNodeContents(node);
        afterRange.setStartAfter(el);

        const before = clipBefore(beforeRange.toString());
        const after = clipAfter(afterRange.toString());
        const usefulBefore = normLoose(before).length >= 2;
        const usefulAfter = normLoose(after).length >= 2;
        if (usefulBefore && usefulAfter) {
          return 'Zone ' + (Number(index) + 1) + ' — phrase: ' + before + ' [[ZONE_' + index + ']] ' + after;
        }
      } catch {}
      if (node === root) break;
    }
    return '';
  };

  const enrichDragQuestionZoneContexts = (q) => {
    if (q?.type !== 'drag-drop' || !Array.isArray(q.zones) || !q.zones.length) return q;
    let fillWords = false;
    try { fillWords = !!isFillWordsInstruction(); } catch {}
    if (!fillWords) return q;

    for (const zone of q.zones) {
      const original = Number(zone?.originalIndex);
      const local = Number(zone?.index);
      const zoneIndex = Number.isInteger(original) ? original : (Number.isInteger(local) ? local : 0);
      const sentence = sentenceWindowForDropZone(zone?.element, zoneIndex);
      if (sentence) zone.text = sentence;
    }
    return q;
  };

`;
    code = replaceOnce(code, "contexte phrase des trous drag-drop", analyzeMarker, dragSentenceHelpers + analyzeMarker);

    const analyzeStart = `  const analyzeCurrentQuestion = async () => {
    if (state.agent.analyzing) { agentLog("Analyse déjà en cours."); return null; }
    const q = detectQuestion();`;
    const analyzeStartEnriched = `  const analyzeCurrentQuestion = async () => {
    if (state.agent.analyzing) { agentLog("Analyse déjà en cours."); return null; }
    const q = enrichDragQuestionZoneContexts(detectQuestion());`;
    code = replaceOnce(code, "enrichissement drag-drop avant IA", analyzeStart, analyzeStartEnriched);

    // Dernière question : Terminer/Finish peut être l'action de soumission finale.
    const beforeFinalWait = `      if (submissionState.pass) {
        log(\`"\${controlText(submissionState.pass)}" est visible: la question n'est PAS soumise. Aucun clic automatique; attente de Valider/Validée.\`);
        return false;
      }

      log("Réponse appliquée et vérifiée, mais soumission encore non confirmée. Attente de Valider/Validée; aucune navigation.");`;

    const afterFinalWait = `      const finalProgressRaw = String(currentProgressMarker() || '').trim();
      const finalProgressMatch = finalProgressRaw.match(/^(\\d+)\\s*\\/\\s*(\\d+)$/);
      const finalCurrent = finalProgressMatch ? Number(finalProgressMatch[1]) : null;
      const finalTotal = finalProgressMatch ? Number(finalProgressMatch[2]) : null;
      const finalButton = submissionState.next;
      const finalButtonText = finalButton ? controlText(finalButton) : '';
      const finalButtonLoose = normLoose(finalButtonText);
      const isLastQuestion = Number.isFinite(finalCurrent) && Number.isFinite(finalTotal) && finalTotal > 0 && finalCurrent === finalTotal;
      const isFinishButton = !!finalButton && /^(terminer|finish)(\\b|$)/.test(finalButtonLoose);
      const finalExistingState = existingResponseState(q);
      const finalResponseComplete = q.type === 'answered' || finalExistingState?.state === 'complete';

      if (!submissionState.validate && !submissionState.pass && isLastQuestion && isFinishButton && state.agent.lastApplyVerified && finalResponseComplete) {
        if (!(await auditAndPaceBeforeSubmit(q, \`finalisation "\${finalButtonText}"\`))) return false;

        const refreshedFinish = findActionButton(state.config.nextTexts);
        const refreshedFinishText = refreshedFinish ? controlText(refreshedFinish) : '';
        if (!refreshedFinish || !/^(terminer|finish)(\\b|$)/.test(normLoose(refreshedFinishText))) {
          hardBlock(q.key, 'Dernière question vérifiée mais le bouton Terminer/Finish a disparu avant la finalisation.');
          return false;
        }

        log(\`Dernière question \${finalCurrent}/\${finalTotal}: réponse complète et auditée; finalisation via "\${refreshedFinishText}".\`);
        if (!(await clickElement(refreshedFinish))) {
          hardBlock(q.key, 'Le bouton Terminer/Finish est visible mais le clic final n’a pas été confirmé.');
          return false;
        }
        await wait(state.config.settleDelayMs);
        return true;
      }

      if (submissionState.pass) {
        log(\`"\${controlText(submissionState.pass)}" est visible: la question n'est PAS soumise. Aucun clic automatique; attente de Valider/Validée.\`);
        return false;
      }

      log("Réponse appliquée et vérifiée, mais soumission encore non confirmée. Attente de Valider/Validée; aucune navigation.");`;

    code = replaceOnce(code, "finalisation dernière question", beforeFinalWait, afterFinalWait);

    // Le garde DOM global laisse Terminer/Finish passer uniquement sur la dernière
    // question complète et vérifiée.
    const oldClickGuard = `      if ((clickAuditNext || clickAuditPass) && auditBeforeClick.questionLikely && !auditBeforeClick.submitted) {
        log('Clic automatique ' + (clickAuditLabel || 'Suivant/Passer') + ' bloqué par audit DOM: question non soumise visible.');
        return false;
      }`;

    const newClickGuard = `      const clickAuditIsFinalProgress = Number.isFinite(auditBeforeClick.current) && Number.isFinite(auditBeforeClick.total) && auditBeforeClick.total > 0 && auditBeforeClick.current === auditBeforeClick.total;
      const clickAuditIsFinish = /^(terminer|finish)(\\b|$)/.test(clickAuditLoose);
      const clickAuditFinalComplete =
        auditBeforeClick.emptyWritable === 0 &&
        auditBeforeClick.emptyZones === 0 &&
        (auditBeforeClick.radios === 0 || auditBeforeClick.selectedRadios > 0) &&
        (auditBeforeClick.checkboxes === 0 || auditBeforeClick.selectedCheckboxes > 0);
      const clickAuditSafeFinal =
        clickAuditIsFinalProgress && clickAuditIsFinish && clickAuditFinalComplete &&
        auditBeforeClick.validateButtons === 0 && auditBeforeClick.passButtons === 0 &&
        state.agent.lastApplyVerified;

      if ((clickAuditNext || clickAuditPass) && auditBeforeClick.questionLikely && !auditBeforeClick.submitted && !clickAuditSafeFinal) {
        log('Clic automatique ' + (clickAuditLabel || 'Suivant/Passer') + ' bloqué par audit DOM: question non soumise visible.');
        return false;
      }
      if (clickAuditSafeFinal) {
        log('Audit DOM final: Terminer/Finish autorisé uniquement car dernière question complète et réponse vérifiée.');
      }`;

    code = replaceOnce(code, "exception Terminer garde DOM", oldClickGuard, newClickGuard);

    const debugMarker = "  window.geUnblock = clearHardBlock;";
    if (code.includes(debugMarker)) {
      code = code.replace(
        debugMarker,
        "  window.geFinalizePatchVersion = () => FINALIZE_RUNTIME_VERSION;\n" +
        "  window.geDebugDragSentenceContexts = () => {\n" +
        "    const q = enrichDragQuestionZoneContexts(detectQuestion());\n" +
        "    const zones = (q?.zones || []).map((z) => ({ index: z.index, originalIndex: z.originalIndex, text: z.text }));\n" +
        "    console.table(zones);\n" +
        "    return zones;\n" +
        "  };\n" +
        "  window.geDebugNormalizeDrag = (raw) => {\n" +
        "    const q = enrichDragQuestionZoneContexts(detectQuestion());\n" +
        "    const normalized = normalizeResultForQuestion(q, raw);\n" +
        "    console.log('[Global Exam Drag Normalize]', { raw, normalized, valid: structurallyValidResult(q, normalized) });\n" +
        "    return normalized;\n" +
        "  };\n" +
        debugMarker
      );
    }

    return code;
  };

  console.log(`[Global Exam Finalize] ${FINALIZE_PATCH_VERSION} prêt.`);
})();