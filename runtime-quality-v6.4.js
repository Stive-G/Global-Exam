(() => {
  const QUALITY_PATCH_VERSION = "6.4-quality-v1";
  const INVENTORY_STATE_PATCH_VERSION = "6.4-ordering-inventory-state-v2";
  const INVENTORY_DOM_PATCH_VERSION = "6.4-ordering-dom-inventory-v3";
  const DRAG_DROP_EMPTY_ZONE_PATCH_VERSION = "6.4-dragdrop-empty-zone-v2";
  const PASSIVE_PAGE_PATCH_VERSION = "6.4-passive-page-guard-v3";
  const DRAG_RECONSTRUCTION_PATCH_VERSION = "6.4-dragdrop-full-reconstruction-v2";

  const xhr = new XMLHttpRequest();
  xhr.open("GET", `http://localhost:3000/runtime-quality-legacy-v6.4.js?v=${Date.now()}`, false);
  try {
    xhr.send(null);
  } catch (error) {
    throw new Error(`[Global Exam Quality] Impossible de charger le patch qualité existant: ${error?.message || error}`);
  }
  if (xhr.status < 200 || xhr.status >= 300 || !xhr.responseText) {
    throw new Error(`[Global Exam Quality] Patch qualité existant HTTP ${xhr.status || 0}.`);
  }

  (0, eval)(xhr.responseText);
  const legacyApply = window.__applyGlobalExamV64QualityPatch;
  if (typeof legacyApply !== "function") {
    throw new Error("[Global Exam Quality] Patch qualité existant chargé mais fonction principale absente.");
  }

  const replaceOnce = (source, label, before, after) => {
    if (!source.includes(before)) {
      throw new Error(`[Quality ${QUALITY_PATCH_VERSION}] Bloc introuvable: ${label}.`);
    }
    return source.replace(before, after);
  };

  window.__applyGlobalExamV64QualityPatch = (source) => {
    let code = legacyApply(source);

    const detectQuestionMarker = `  const detectQuestion = () => {`;
    const stateHelpers = `  const ORDERING_INVENTORY_STATE_VERSION = "${INVENTORY_STATE_PATCH_VERSION}";
  const ORDERING_DOM_INVENTORY_VERSION = "${INVENTORY_DOM_PATCH_VERSION}";
  const DRAG_DROP_EMPTY_ZONE_RUNTIME_VERSION = "${DRAG_DROP_EMPTY_ZONE_PATCH_VERSION}";
  const PASSIVE_PAGE_RUNTIME_VERSION = "${PASSIVE_PAGE_PATCH_VERSION}";
  const DRAG_RECONSTRUCTION_RUNTIME_VERSION = "${DRAG_RECONSTRUCTION_PATCH_VERSION}";

  const orderingInventoryStateKey = () => [
    String(location.pathname || ''),
    String(typeof currentProgressMarker === 'function' ? (currentProgressMarker() || '') : '')
  ].join('::');

  const rewriteOrderingPromptFromVerifiedInventory = (q) => {
    if (!q || q.type !== 'ordering' || !Array.isArray(q.items) || !q.items.length) return q;
    const count = q.items.length;
    const marker = '[INVENTAIRE ORDERING COMPLET: ' + count + ' FRAGMENTS]';
    if (!String(q.prompt || '').includes(marker)) {
      q.prompt = String(q.prompt || '') + '\\n' + marker +
        '\\nUtilise exactement les ' + count + ' fragments inventoriés, chacun une seule fois, index 0..' + (count - 1) + '.';
    }
    q.requiredCount = count;
    q.remainingCount = count;
    q.totalCount = count;
    return q;
  };

  const rememberOrderingInventoryState = (q) => {
    if (!q || q.type !== 'ordering' || !Array.isArray(q.items) || q.items.length < 2) return false;
    rewriteOrderingPromptFromVerifiedInventory(q);
    state.agent.orderingInventoryState = {
      key: orderingInventoryStateKey(),
      count: q.items.length,
      prompt: String(q.prompt || ''),
      items: q.items.map((item, index) => ({
        index,
        text: String(item.text || '').replace(/\\s+/g, ' ').trim()
      })),
      savedAt: Date.now(),
    };
    return true;
  };

  const restoreOrderingInventoryState = (q, result = null) => {
    if (!q || q.type !== 'ordering') return false;
    const cached = state.agent.orderingInventoryState;
    if (!cached || cached.key !== orderingInventoryStateKey() || !Array.isArray(cached.items) || cached.items.length < 2) return false;
    const currentCount = Array.isArray(q.items) ? q.items.length : 0;
    if (currentCount > cached.count) return false;
    if (currentCount !== cached.count) {
      q.items = cached.items.map((item, index) => ({ index, text: item.text, element: null }));
      q._orderingInventoryVerified = true;
      q._orderingCarouselScanned = true;
      q.key = makeQuestionKey(q);
      log('Ordering: inventaire complet restauré avant application (' + cached.count + ' fragments).');
    }
    q.prompt = cached.prompt || q.prompt;
    rewriteOrderingPromptFromVerifiedInventory(q);
    return true;
  };

  const orderingBroadInteractiveElement = (el) => {
    if (!el?.isConnected || !isVisible(el) || !isEnabled(el) || isAssistantElement(el)) return false;
    const raw = String(textOf(el) || '').replace(/\\s+/g, ' ').trim();
    if (!raw || raw.length > 180 || isOrderingNoiseText(raw) || isExerciseUiNoiseText(raw)) return false;
    const style = getComputedStyle(el);
    const role = String(el.getAttribute?.('role') || '').toLowerCase();
    const cls = String(el.className || '').toLowerCase();
    return el.matches("button,[draggable='true'],[aria-grabbed],[data-rbd-draggable-id],[data-draggable='true']") ||
      role === 'button' || role === 'option' || el.tabIndex >= 0 || style.cursor === 'pointer' ||
      /word|chip|token|item|option|fragment|answer|response/.test(cls);
  };

  const collectOrderingBroadCandidates = (q, instructionEl = null, target = null) => {
    const instruction = instructionEl?.isConnected
      ? instructionEl
      : (findOrderingInstructionElement(document.body) || null);
    const instructionRect = instruction?.getBoundingClientRect?.() || null;
    const liveTarget = target?.isConnected
      ? target
      : (orderingTargetLive(q) || findOrderingTarget(document.body, instruction));
    const targetRect = liveTarget?.getBoundingClientRect?.() || null;
    const minTop = targetRect
      ? targetRect.bottom - 30
      : (instructionRect ? instructionRect.bottom + 2 : -Infinity);

    const rawNodes = [...document.querySelectorAll(
      "button,[role='button'],[role='option'],[draggable='true'],[aria-grabbed],[data-rbd-draggable-id],[data-draggable='true'],[tabindex],li,div,span"
    )].filter(orderingBroadInteractiveElement);

    const nodes = deepestUniqueElements(rawNodes).filter((el) => {
      if (liveTarget && (liveTarget === el || liveTarget.contains(el))) return false;
      if (instruction && (instruction === el || instruction.contains(el) || el.contains(instruction))) return false;
      const r = el.getBoundingClientRect();
      if (r.top < minTop || r.height > 120) return false;
      if (r.width > Math.min(innerWidth * 0.82, 620) && r.height > 64) return false;
      return true;
    });

    nodes.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.top - br.top || ar.left - br.left;
    });

    const seen = new Set();
    const result = [];
    for (const el of nodes) {
      const text = String(textOf(el) || '').replace(/\\s+/g, ' ').trim();
      const key = norm(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push({ index: result.length, text, element: el });
    }
    return result;
  };

`;
    code = replaceOnce(code, 'helpers qualité v2', detectQuestionMarker, stateHelpers + detectQuestionMarker);

    const oldResolveOpen = `  const resolveLiveOrderingItem = (q, originalText) => {
    const wanted = norm(originalText);
    const root = q.root?.isConnected ? q.root : document.body;
    const instructionEl = findOrderingInstructionElement(root) || findOrderingInstructionElement(document.body);
    const target = q.orderTarget?.isConnected ? q.orderTarget : (findOrderingTarget(root, instructionEl) || findOrderingTarget(document.body, instructionEl));
    const roots = root === document.body ? [root] : [root, document.body];`;
    const newResolveOpen = `  const resolveLiveOrderingItem = (q, originalText) => {
    const wanted = norm(originalText);
    const root = q.root?.isConnected ? q.root : document.body;
    const instructionEl = findOrderingInstructionElement(root) || findOrderingInstructionElement(document.body);
    const target = q.orderTarget?.isConnected ? q.orderTarget : (findOrderingTarget(root, instructionEl) || findOrderingTarget(document.body, instructionEl));
    const broadLive = collectOrderingBroadCandidates(q, instructionEl, target)
      .find((item) => norm(item?.text || '') === wanted);
    if (broadLive?.element?.isConnected) return broadLive.element;
    const roots = root === document.body ? [root] : [root, document.body];`;
    code = replaceOnce(code, 'résolution large ordering', oldResolveOpen, newResolveOpen);

    const oldInventorySnapshot = `  const orderingInventorySnapshot = (q) => {
    const instruction = findOrderingInstructionElement(document.body);
    const target = orderingTargetLive(q) || findOrderingTarget(document.body, instruction);
    const selection = orderingSelectionState(document.body, instruction, target);
    return { instruction, target, selection, remainingItems: selection?.remainingItems || [] };
  };`;
    const newInventorySnapshot = `  const orderingInventorySnapshot = (q) => {
    const instruction = findOrderingInstructionElement(document.body);
    const target = orderingTargetLive(q) || findOrderingTarget(document.body, instruction);
    const selection = orderingSelectionState(document.body, instruction, target);
    const primary = Array.isArray(selection?.remainingItems) ? selection.remainingItems : [];
    const broad = collectOrderingBroadCandidates(q, instruction, target);
    const merged = [];
    const seen = new Set();
    const add = (item) => {
      const text = String(item?.text || '').replace(/\\s+/g, ' ').trim();
      const key = norm(text);
      if (!key || seen.has(key) || isOrderingNoiseText(text)) return;
      seen.add(key);
      merged.push({ ...item, index: merged.length, text });
    };
    primary.forEach(add);
    broad.forEach(add);
    const mergedSelection = selection ? {
      ...selection,
      remainingItems: merged,
      remainingCount: merged.length,
      totalCount: Number(selection.selectedCount || 0) + merged.length,
    } : {
      target,
      remainingItems: merged,
      remainingCount: merged.length,
      selectedCount: 0,
      selectedTexts: [],
      totalCount: merged.length,
    };
    if (broad.length > primary.length) {
      console.log('[Global Exam Ordering] Couverture DOM étendue:', primary.length, '->', broad.length, 'fragments visibles.');
    }
    return { instruction, target, selection: mergedSelection, remainingItems: merged };
  };`;
    code = replaceOnce(code, 'inventaire DOM ordering', oldInventorySnapshot, newInventorySnapshot);

    const oldInventoryShape = `    q.items = discovered.map((item, index) => ({ index, text: item.text, element: null }));
    q.remainingCount = q.items.length;
    q.totalCount = q.items.length;
    q._orderingInventoryVerified = true;
    q._orderingCarouselScanned = true;
    q._orderingCarouselPages = Math.max(Number(q._orderingCarouselPages || 1), 1);
    q.key = makeQuestionKey(q);`;
    const newInventoryShape = `    q.items = discovered.map((item, index) => ({ index, text: item.text, element: null }));
    q.remainingCount = q.items.length;
    q.requiredCount = q.items.length;
    q.totalCount = q.items.length;
    q._orderingInventoryVerified = true;
    q._orderingCarouselScanned = true;
    q._orderingCarouselPages = Math.max(Number(q._orderingCarouselPages || 1), 1);
    rewriteOrderingPromptFromVerifiedInventory(q);
    q.key = makeQuestionKey(q);`;
    code = replaceOnce(code, 'shape inventaire ordering', oldInventoryShape, newInventoryShape);

    const finalResetMarker = `    console.log('[Global Exam Ordering] Inventaire complet confirmé:', q.items.length + ' fragment(s).', q.items.map((x) => x.text));`;
    code = replaceOnce(
      code,
      'mémorisation inventaire ordering',
      finalResetMarker,
      `    rememberOrderingInventoryState(q);\n` + finalResetMarker
    );

    const applyMarker = `  const applyResult = async (q, result) => {
    clearHighlights();`;
    code = replaceOnce(
      code,
      'restauration inventaire avant apply',
      applyMarker,
      `  const applyResult = async (q, result) => {\n    if (q?.type === 'ordering') restoreOrderingInventoryState(q, result);\n    clearHighlights();`
    );

    const oldZoneFill = `  const zoneDirectText = (el) => textOf(el).replace(/\\s+/g, ' ').trim();
  const emptyZoneMarkers = ['drop here','drop','deposer ici','deposez ici','placer ici','place here','glisser ici','drag here'];
  const isZoneFilled = (el) => {
    const t = normLoose(zoneDirectText(el));
    if (!t) return false;
    if (emptyZoneMarkers.some((m) => t === normLoose(m))) return false;
    return true;
  };`;
    const newZoneFill = `  const zoneDirectText = (el) => {
    if (!el?.isConnected) return '';
    return String(el.innerText || '').replace(/\\s+/g, ' ').trim();
  };
  const emptyZoneMarkers = ['drop here','drop','deposer ici','deposez ici','placer ici','place here','glisser ici','drag here'];
  const isZoneFilled = (el) => {
    if (!el?.isConnected || !isVisible(el)) return false;
    const t = normLoose(zoneDirectText(el));
    if (!t) return false;
    if (emptyZoneMarkers.some((m) => t === normLoose(m))) return false;
    if (/^(blank|empty|empty blank|answer|response|drop zone|dropzone|slot|target|zone)$/.test(t)) return false;
    return true;
  };`;
    code = replaceOnce(code, 'lecture visuelle des zones drag-drop', oldZoneFill, newZoneFill);

    const oldCompletedFill = `    if (isFillWordsInstruction()) {
      const zones = getLiveZoneElements(document.body);
      if (zones.length) {
        const filled = zones.filter(isZoneFilled);
        if (filled.length === zones.length) {
          return {
            type: 'answered', answeredKind: 'drag-drop', root: findQuestionRoot(),
            prompt: stableInstructionText(), key: \`answered::\${id}\`,
            answerState: 'complete', detail: \`\${filled.length}/\${zones.length} zones remplies\`,
          };
        }
      }
    }`;
    const newCompletedFill = `    if (isFillWordsInstruction()) {
      const zones = getLiveZoneElements(document.body);
      if (zones.length) {
        const filled = zones.filter(isZoneFilled);
        if (filled.length === zones.length) {
          let remainingBank = [];
          try { remainingBank = collectDragItems(document.body); } catch {}
          if (!remainingBank.length) {
            return {
              type: 'answered', answeredKind: 'drag-drop', root: findQuestionRoot(),
              prompt: stableInstructionText(), key: \`answered::\${id}\`,
              answerState: 'complete', detail: \`\${filled.length}/\${zones.length} zones remplies\`,
            };
          }
          console.log('[Global Exam Drag] État répondu refusé:', remainingBank.length, 'mot(s) encore disponibles.');
        }
      }
    }`;
    code = replaceOnce(code, 'état répondu drag-drop fiable', oldCompletedFill, newCompletedFill);

    const oldPassiveLikely = `    const questionLikely = !visibleCorrection && (
      strongControls ||
      (progressed && questionHint && (validateButtons.length > 0 || passButtons.length > 0))
    );`;
    const newPassiveLikely = `    const directResponseControls =
      radios.length >= 2 || checkboxes.length >= 2 ||
      roleRadios.length >= 2 || roleCheckboxes.length >= 2 ||
      writable.length >= 1 || zones.length >= 1 || ordering ||
      (draggables.length >= 1 && zones.length >= 1);
    const buttonResponseEvidence = answerButtons.length >= 2 && (validateButtons.length > 0 || passButtons.length > 0);
    const questionLikely = !visibleCorrection && (
      directResponseControls ||
      buttonResponseEvidence ||
      (progressed && questionHint && (validateButtons.length > 0 || passButtons.length > 0))
    );`;
    code = replaceOnce(code, 'audit page passive', oldPassiveLikely, newPassiveLikely);

    const oldUnknownFallback = `    if (looksLikeQuestionPage()) {
      const r = findQuestionRoot();
      return { type: "unknown-question", root: r, prompt: inferPrompt(r), key: "unknown-question" };
    }
    return { type: "none", root: findQuestionRoot(), prompt: "", key: "none" };`;
    const newUnknownFallback = `    const fallbackHasValidate = !!findActionButton?.(state.config.validateTexts);
    const fallbackHasPass = !!findActionButton?.(state.config.passTexts);
    const fallbackHasWritable = hasWritableQuestionControl();
    if (looksLikeQuestionPage() && (fallbackHasValidate || fallbackHasPass || fallbackHasWritable)) {
      const r = findQuestionRoot();
      return { type: "unknown-question", root: r, prompt: inferPrompt(r), key: "unknown-question" };
    }
    if (looksLikeQuestionPage()) {
      console.log('[Global Exam Pager] Faux signal question ignoré: aucune surface de réponse réelle; page passive autorisée.');
    }
    return { type: "none", root: findQuestionRoot(), prompt: "", key: "none" };`;
    code = replaceOnce(code, 'fallback unknown-question réel uniquement', oldUnknownFallback, newUnknownFallback);

    const dragSchemaMarker = `        'FORMAT OBLIGATOIRE: {"placements":[{"item":0,"zone":0}],"confidence":0.92,"explanation":"courte"}',`;
    const dragSchemaReplacement = `        'FORMAT OBLIGATOIRE: {"placements":[{"item":0,"zone":0}],"confidence":0.92,"explanation":"courte"}',
        "MÉTHODE OBLIGATOIRE: ne résous jamais les trous un par un.",
        "Reconstruis d'abord mentalement le PASSAGE COMPLET avec TOUS les trous et TOUS les items disponibles, puis seulement produis placements.",
        "Compare simultanément les candidats entre toutes les zones: grammaire, sens, collocations, vocabulaire appris, singulier/pluriel et cohérence globale.",
        "Si deux mots sont localement plausibles, utilise les autres phrases et la contrainte chaque item exactement une fois pour départager.",
        "Relis mentalement chaque phrase reconstruite de bout en bout avant le JSON et cherche activement les inversions entre termes proches.",
        "Ne valide le mapping que si le paragraphe complet est naturel et cohérent.",`;
    code = replaceOnce(code, 'reconstruction globale des fill-words', dragSchemaMarker, dragSchemaReplacement);

    const debugMarker = "  window.geUnblock = clearHardBlock;";
    if (code.includes(debugMarker)) {
      code = code.replace(
        debugMarker,
        `  window.geOrderingInventoryStateVersion = () => ORDERING_INVENTORY_STATE_VERSION;\n` +
        `  window.geOrderingDomInventoryVersion = () => ORDERING_DOM_INVENTORY_VERSION;\n` +
        `  window.geDragDropEmptyZoneFixVersion = () => DRAG_DROP_EMPTY_ZONE_RUNTIME_VERSION;\n` +
        `  window.gePassivePageFixVersion = () => PASSIVE_PAGE_RUNTIME_VERSION;\n` +
        `  window.geDragDropReconstructionVersion = () => DRAG_RECONSTRUCTION_RUNTIME_VERSION;\n` +
        debugMarker
      );
    }

    console.log(
      `[Global Exam Quality] ${INVENTORY_STATE_PATCH_VERSION} | ${INVENTORY_DOM_PATCH_VERSION} | ` +
      `${DRAG_DROP_EMPTY_ZONE_PATCH_VERSION} | ${PASSIVE_PAGE_PATCH_VERSION} | ${DRAG_RECONSTRUCTION_PATCH_VERSION} appliqués.`
    );
    return code;
  };

  console.log(
    `[Global Exam Quality] ${QUALITY_PATCH_VERSION} + ${INVENTORY_STATE_PATCH_VERSION} + ` +
    `${INVENTORY_DOM_PATCH_VERSION} + ${DRAG_DROP_EMPTY_ZONE_PATCH_VERSION} + ` +
    `${PASSIVE_PAGE_PATCH_VERSION} + ${DRAG_RECONSTRUCTION_PATCH_VERSION} prêt.`
  );
})();