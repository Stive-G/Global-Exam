(() => {
  const QUALITY_PATCH_VERSION = "6.4-quality-v1";
  const INVENTORY_STATE_PATCH_VERSION = "6.4-ordering-inventory-state-v1";
  const INVENTORY_DOM_PATCH_VERSION = "6.4-ordering-dom-inventory-v2";
  const DRAG_DROP_EMPTY_ZONE_PATCH_VERSION = "6.4-dragdrop-empty-zone-v1";
  const PASSIVE_PAGE_PATCH_VERSION = "6.4-passive-page-guard-v2";
  const DRAG_RECONSTRUCTION_PATCH_VERSION = "6.4-dragdrop-full-reconstruction-v1";

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
    if (!source.includes(before)) throw new Error(`[Quality ${INVENTORY_STATE_PATCH_VERSION}] Bloc introuvable: ${label}.`);
    return source.replace(before, after);
  };

  window.__applyGlobalExamV64QualityPatch = (source) => {
    let code = legacyApply(source);
    if (
      code.includes(`const ORDERING_INVENTORY_STATE_VERSION = "${INVENTORY_STATE_PATCH_VERSION}"`) &&
      code.includes(`const ORDERING_DOM_INVENTORY_VERSION = "${INVENTORY_DOM_PATCH_VERSION}"`) &&
      code.includes(`const DRAG_DROP_EMPTY_ZONE_RUNTIME_VERSION = "${DRAG_DROP_EMPTY_ZONE_PATCH_VERSION}"`) &&
      code.includes(`const PASSIVE_PAGE_RUNTIME_VERSION = "${PASSIVE_PAGE_PATCH_VERSION}"`) &&
      code.includes(`const DRAG_RECONSTRUCTION_RUNTIME_VERSION = "${DRAG_RECONSTRUCTION_PATCH_VERSION}"`)
    ) return code;

    const discoverMarker = `  const discoverCompleteOrderingInventory = async (q) => {`;
    const helpers = `  const ORDERING_INVENTORY_STATE_VERSION = "${INVENTORY_STATE_PATCH_VERSION}";

  const orderingInventoryStateKey = () => [
    String(location.pathname || ''),
    String(typeof currentProgressMarker === 'function' ? (currentProgressMarker() || '') : '')
  ].join('::');

  const rewriteOrderingPromptFromInventory = (q) => {
    if (!q || q.type !== 'ordering' || !Array.isArray(q.items) || !q.items.length) return q;
    const count = q.items.length;
    let prompt = String(q.prompt || '');
    prompt = prompt
      .replace(/Nombre de fragments RESTANTS à sélectionner maintenant:\s*\d+\./gi, 'Nombre total de fragments confirmé par inventaire: ' + count + '.')
      .replace(/Tu dois retourner une permutation contenant exactement\s+\d+\s+index, chacun une seule fois, parmi\s+0\.\.\d+\./gi,
        'Tu dois retourner une permutation contenant exactement ' + count + ' index, chacun une seule fois, parmi 0..' + (count - 1) + '.')
      .replace(/Il n'y a AUCUN nombre fixe de fragments:\s*utilise seulement les\s+\d+\s+propositions actuellement disponibles\./gi,
        'Le nombre a été découvert dynamiquement: utilise exactement les ' + count + ' fragments de l inventaire complet.');
    q.prompt = prompt;
    q.requiredCount = count;
    q.remainingCount = count;
    q.totalCount = count;
    return q;
  };

  const rememberOrderingInventoryState = (q) => {
    if (!q || q.type !== 'ordering' || !Array.isArray(q.items) || q.items.length < 2) return false;
    rewriteOrderingPromptFromInventory(q);
    state.agent.orderingInventoryState = {
      key: orderingInventoryStateKey(),
      count: q.items.length,
      prompt: String(q.prompt || ''),
      items: q.items.map((item, index) => ({ index, text: String(item.text || '').replace(/\s+/g, ' ').trim() })),
      savedAt: Date.now(),
    };
    return true;
  };

  const restoreOrderingInventoryState = (q, result = null) => {
    if (!q || q.type !== 'ordering') return false;
    const cached = state.agent.orderingInventoryState;
    if (!cached || cached.key !== orderingInventoryStateKey() || !Array.isArray(cached.items) || cached.items.length < 2) return false;
    const currentCount = Array.isArray(q.items) ? q.items.length : 0;
    const resultCount = Array.isArray(result?.order) ? result.order.length : 0;
    if (currentCount > cached.count) return false;
    if (currentCount === cached.count && resultCount !== cached.count) {
      rewriteOrderingPromptFromInventory(q);
      return false;
    }

    if (currentCount !== cached.count) {
      q.items = cached.items.map((item, index) => ({ index, text: item.text, element: null }));
      q._orderingInventoryVerified = true;
      q._orderingCarouselScanned = true;
      q.prompt = cached.prompt || q.prompt;
      rewriteOrderingPromptFromInventory(q);
      q.key = makeQuestionKey(q);
      log('Ordering: inventaire complet restauré avant application (' + cached.count + ' fragments; ' + currentCount + ' visibles à cet instant).');
    } else {
      rewriteOrderingPromptFromInventory(q);
    }
    return true;
  };

`;
    code = replaceOnce(code, 'helpers état inventaire', discoverMarker, helpers + discoverMarker);

    const oldInitialReset = `    if (Number(snap.selection?.selectedCount || 0) > 0) {
      log('Ordering: état partiel présent avant inventaire; remise à zéro avant lecture complète.');
      if (!await resetOrderingSelection(q)) {
        return { ok: false, reason: 'impossible de remettre à zéro l ordering avant inventaire complet' };
      }
      await wait(220);
      snap = orderingInventorySnapshot(q);
    }`;
    const newInitialReset = `    if (Number(snap.selection?.selectedCount || 0) > 0) {
      log('Ordering: état partiel présent avant inventaire; remise à zéro avant lecture complète.');
      let preResetOk = await resetOrderingSelection(q);
      if (!preResetOk && typeof forceResetOrderingInventorySelection === 'function') {
        console.log('[Global Exam Ordering] Reset initial standard insuffisant; tentative renforcée avant inventaire.');
        preResetOk = await forceResetOrderingInventorySelection(q);
      }
      if (!preResetOk) {
        return { ok: false, reason: 'impossible de remettre à zéro l ordering avant inventaire complet, fallback renforcé inclus' };
      }
      await wait(260);
      snap = orderingInventorySnapshot(q);
      if (Number(snap.selection?.selectedCount || 0) > 0) {
        return { ok: false, reason: 'reset initial annoncé réussi mais fragments encore placés' };
      }
    }`;
    code = replaceOnce(code, 'reset initial inventaire', oldInitialReset, newInitialReset);

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
    rewriteOrderingPromptFromInventory(q);
    q.key = makeQuestionKey(q);`;
    code = replaceOnce(code, 'comptage inventaire complet', oldInventoryShape, newInventoryShape);

    const finalResetEnd = `    if (!resetOk || Number(resetState.selection?.selectedCount || 0) > 0) {
      return {
        ok: false,
        reason: 'inventaire complet trouvé (' + q.items.length + ') mais remise à zéro non confirmée après fallback renforcé v2',
        discovered: q.items.map((x) => x.text)
      };
    }`;
    code = replaceOnce(code, 'mémorisation inventaire après reset', finalResetEnd, finalResetEnd + `\n    rememberOrderingInventoryState(q);`);

    const applyMarker = `  const applyResult = async (q, result) => {
    clearHighlights();`;
    const applyReplacement = `  const applyResult = async (q, result) => {
    if (q?.type === 'ordering') restoreOrderingInventoryState(q, result);
    clearHighlights();`;
    code = replaceOnce(code, 'restauration inventaire avant application', applyMarker, applyReplacement);

    // v2 : certains fragments Global Exam sont de simples div/span cliquables.
    // Le sélecteur historique ne voyait alors que le premier fragment. On ajoute
    // un inventaire DOM géométrique, indépendant des classes React.
    const resolveMarker = `  const resolveLiveOrderingItem = (q, originalText) => {`;
    const domHelpers = `  const ORDERING_DOM_INVENTORY_VERSION = "${INVENTORY_DOM_PATCH_VERSION}";

  const orderingTargetLooksLikeRealDropZone = (target) => {
    if (!target?.isConnected || !isVisible(target) || isAssistantElement(target)) return false;
    const r = target.getBoundingClientRect();
    if (r.width < Math.min(220, innerWidth * 0.28) || r.height < 38 || r.height > 300) return false;
    const style = getComputedStyle(target);
    const borderStyles = [style.borderTopStyle, style.borderRightStyle, style.borderBottomStyle, style.borderLeftStyle, style.outlineStyle];
    const dashed = borderStyles.some((value) => value === 'dashed' || value === 'dotted');
    const borderWidth = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
      .map((value) => parseFloat(value) || 0)
      .reduce((max, value) => Math.max(max, value), 0);
    let explicit = false;
    try { explicit = !!dropZoneSelector && target.matches(dropZoneSelector); } catch {}
    const raw = String(textOf(target) || '').replace(/\s+/g, ' ').trim();
    return (explicit || dashed || borderWidth >= 2) && raw.length <= 260;
  };

  const orderingBroadInteractiveElement = (el) => {
    if (!el?.isConnected || !isVisible(el) || !isEnabled(el) || isAssistantElement(el)) return false;
    const raw = String(textOf(el) || '').replace(/\s+/g, ' ').trim();
    if (!raw || raw.length > 180 || isOrderingNoiseText(raw) || isExerciseUiNoiseText(raw)) return false;
    const loose = normLoose(raw);
    if (/^(transcript|transcription|feedback|fermer|close|dismiss|quitter)(\b|$)/.test(loose)) return false;
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
    const realTarget = orderingTargetLooksLikeRealDropZone(liveTarget) ? liveTarget : null;
    const targetRect = realTarget?.getBoundingClientRect?.() || null;
    const minTop = targetRect
      ? targetRect.bottom - 28
      : (instructionRect ? instructionRect.bottom + 2 : -Infinity);

    const rawNodes = [...document.querySelectorAll(
      "button,[role='button'],[role='option'],[draggable='true'],[aria-grabbed],[data-rbd-draggable-id],[data-draggable='true'],[tabindex],li,div,span"
    )].filter(orderingBroadInteractiveElement);

    const nodes = deepestUniqueElements(rawNodes).filter((el) => {
      if (realTarget && (realTarget === el || realTarget.contains(el))) return false;
      if (instruction && (instruction === el || instruction.contains(el) || el.contains(instruction))) return false;
      const r = el.getBoundingClientRect();
      if (r.top < minTop) return false;
      if (r.width > Math.min(innerWidth * 0.82, 620) && r.height > 64) return false;
      if (r.height > 120) return false;
      return true;
    });

    nodes.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.top - br.top || ar.left - br.left || (ar.width * ar.height) - (br.width * br.height);
    });

    const seen = new Set();
    const result = [];
    for (const el of nodes) {
      const text = String(textOf(el) || '').replace(/\s+/g, ' ').trim();
      const key = norm(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push({ index: result.length, text, element: el });
    }
    return result;
  };

`;
    code = replaceOnce(code, 'helpers inventaire DOM ordering', resolveMarker, domHelpers + resolveMarker);

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
    code = replaceOnce(code, 'résolution large des fragments ordering', oldResolveOpen, newResolveOpen);

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
      const text = String(item?.text || '').replace(/\s+/g, ' ').trim();
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
      console.log(
        '[Global Exam Ordering] Couverture DOM étendue:',
        primary.length + ' fragment(s) via sélecteurs historiques, ' +
        broad.length + ' fragment(s) interactifs visibles.'
      );
    }

    return { instruction, target, selection: mergedSelection, remainingItems: merged };
  };`;
    code = replaceOnce(code, 'snapshot inventaire DOM complet', oldInventorySnapshot, newInventorySnapshot);

    // v3 : textOf() retombe sur textContent quand innerText est vide. Sur certains
    // trous Global Exam, cela expose un texte caché React/accessibilité et faisait
    // croire que TOUS les trous visuellement vides étaient déjà remplis.
    const oldZoneFill = `  const zoneDirectText = (el) => textOf(el).replace(/\s+/g, ' ').trim();
  const emptyZoneMarkers = ['drop here','drop','deposer ici','deposez ici','placer ici','place here','glisser ici','drag here'];
  const isZoneFilled = (el) => {
    const t = normLoose(zoneDirectText(el));
    if (!t) return false;
    if (emptyZoneMarkers.some((m) => t === normLoose(m))) return false;
    return true;
  };`;
    const newZoneFill = `  const DRAG_DROP_EMPTY_ZONE_RUNTIME_VERSION = "${DRAG_DROP_EMPTY_ZONE_PATCH_VERSION}";
  const zoneDirectText = (el) => {
    if (!el?.isConnected) return '';
    // innerText représente ce qui est réellement rendu. Ne jamais retomber ici sur
    // textContent : un texte caché ne constitue pas une réponse visible.
    return String(el.innerText || '').replace(/\s+/g, ' ').trim();
  };
  const emptyZoneMarkers = ['drop here','drop','deposer ici','deposez ici','placer ici','place here','glisser ici','drag here'];
  const isZoneFilled = (el) => {
    if (!el?.isConnected || !isVisible(el)) return false;
    const raw = zoneDirectText(el);
    const t = normLoose(raw);
    if (!t) return false;
    if (emptyZoneMarkers.some((m) => t === normLoose(m))) return false;
    if (/^(blank|empty|empty blank|answer|response|drop zone|dropzone|slot|target|zone)$/.test(t)) return false;
    return true;
  };`;
    code = replaceOnce(code, 'lecture visuelle réelle des trous drag-drop', oldZoneFill, newZoneFill);

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
          if (remainingBank.length > 0) {
            console.log(
              '[Global Exam Drag] Faux état déjà répondu ignoré : ' +
              remainingBank.length + ' mot(s) restent dans la banque alors que les zones semblaient remplies.'
            );
          } else {
            return {
              type: 'answered', answeredKind: 'drag-drop', root: findQuestionRoot(),
              prompt: stableInstructionText(), key: \`answered::\${id}\`,
              answerState: 'complete', detail: \`\${filled.length}/\${zones.length} zones remplies\`,
            };
          }
        }
      }
    }`;
    code = replaceOnce(code, 'garde banque restante avant état drag-drop répondu', oldCompletedFill, newCompletedFill);

    // v4 : une page de cours/vocabulaire avec Suivant + lecteur/transcript ne doit
    // jamais devenir unknown-question uniquement parce que des boutons visuels sont
    // présents ou que le texte contient « what is », « answer », etc.
    const oldPassiveQuestionLikely = `    const questionLikely = !visibleCorrection && (
      strongControls ||
      (progressed && questionHint && (validateButtons.length > 0 || passButtons.length > 0))
    );`;
    const newPassiveQuestionLikely = `    const PASSIVE_PAGE_RUNTIME_VERSION = "${PASSIVE_PAGE_PATCH_VERSION}";
    const directResponseControls =
      radios.length >= 2 || checkboxes.length >= 2 ||
      roleRadios.length >= 2 || roleCheckboxes.length >= 2 ||
      writable.length >= 1 || zones.length >= 1 || ordering ||
      (draggables.length >= 1 && zones.length >= 1);
    const buttonResponseEvidence =
      answerButtons.length >= 2 && (validateButtons.length > 0 || passButtons.length > 0);
    const questionLikely = !visibleCorrection && (
      directResponseControls ||
      buttonResponseEvidence ||
      (progressed && questionHint && (validateButtons.length > 0 || passButtons.length > 0))
    );`;
    code = replaceOnce(code, 'audit page passive sans faux boutons de réponse', oldPassiveQuestionLikely, newPassiveQuestionLikely);

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
      console.log('[Global Exam Pager] Faux signal question ignoré : aucune surface de réponse réelle, page traitée comme contenu passif.');
    }
    return { type: "none", root: findQuestionRoot(), prompt: "", key: "none" };`;
    code = replaceOnce(code, 'fallback unknown-question réservé aux vraies surfaces de réponse', oldUnknownFallback, newUnknownFallback);

    // v5 : pour les fill-the-blanks avec banque de mots, ne jamais résoudre chaque
    // trou isolément. L'IA doit reconstruire le passage COMPLET avant de produire le
    // mapping final, puis vérifier les collisions sémantiques entre tous les trous.
    const dragSchemaMarker = `        'FORMAT OBLIGATOIRE: {"placements":[{"item":0,"zone":0}],"confidence":0.92,"explanation":"courte"}',`;
    const dragSchemaReplacement = `        'FORMAT OBLIGATOIRE: {"placements":[{"item":0,"zone":0}],"confidence":0.92,"explanation":"courte"}',
        "MÉTHODE OBLIGATOIRE POUR LES TROUS À MOTS: ne décide JAMAIS un trou séparément.",
        "Reconstruis d'abord mentalement le PASSAGE COMPLET avec TOUS les trous et TOUS les mots disponibles, puis seulement convertis cette reconstruction en placements item/zone.",
        "Compare les mots concurrents entre toutes les zones: grammaire, sens, collocations naturelles, définition du vocabulaire, singulier/pluriel et cohérence globale du paragraphe.",
        "Si deux mots semblent possibles localement, utilise les AUTRES phrases et le fait que chaque item doit être utilisé exactement une fois pour lever l'ambiguïté.",
        "Avant le JSON final, relis mentalement chaque phrase reconstruite de début à fin et cherche activement les inversions entre termes proches (ex: process/requirement, activity/outcome, etc.).",
        "La réponse n'est valide que si le passage complet est naturel et cohérent, pas seulement chaque trou pris isolément.",`;
    code = replaceOnce(code, 'reconstruction globale drag-drop avant mapping', dragSchemaMarker, dragSchemaReplacement);

    const dragRuntimeMarker = `  const normalizeDragDropPlacements = (q, result) => {`;
    code = replaceOnce(
      code,
      'marqueur runtime reconstruction drag-drop',
      dragRuntimeMarker,
      `  const DRAG_RECONSTRUCTION_RUNTIME_VERSION = "${DRAG_RECONSTRUCTION_PATCH_VERSION}";\n\n` + dragRuntimeMarker
    );

    const debugMarker = "  window.geUnblock = clearHardBlock;";
    if (code.includes(debugMarker)) {
      code = code.replace(
        debugMarker,
        `  window.geOrderingInventoryStateVersion = () => ORDERING_INVENTORY_STATE_VERSION;\n` +
        `  window.geOrderingDomInventoryVersion = () => ORDERING_DOM_INVENTORY_VERSION;\n` +
        `  window.geDragDropEmptyZoneFixVersion = () => DRAG_DROP_EMPTY_ZONE_RUNTIME_VERSION;\n` +
        `  window.gePassivePageFixVersion = () => PASSIVE_PAGE_RUNTIME_VERSION;\n` +
        `  window.geDragDropReconstructionVersion = () => DRAG_RECONSTRUCTION_RUNTIME_VERSION;\n` +
        `  window.geDebugOrderingInventoryState = () => state.agent.orderingInventoryState || null;\n` +
        `  window.geDebugOrderingDomCandidates = () => {\n` +
        `    const q = detectQuestion();\n` +
        `    const instruction = findOrderingInstructionElement(document.body);\n` +
        `    const target = orderingTargetLive(q) || findOrderingTarget(document.body, instruction);\n` +
        `    const items = collectOrderingBroadCandidates(q, instruction, target).map((item, index) => ({ index, text: item.text }));\n` +
        `    console.log('[Global Exam Ordering DOM]', items.length + ' fragment(s) visible(s).');\n` +
        `    console.table(items);\n` +
        `    return items;\n` +
        `  };\n` +
        `  window.geDebugDragDropZones = () => {\n` +
        `    const zones = getLiveZoneElements(document.body).map((el, index) => ({\n` +
        `      index,\n` +
        `      renderedText: String(el.innerText || '').replace(/\s+/g, ' ').trim(),\n` +
        `      rawTextContent: String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180),\n` +
        `      filled: isZoneFilled(el),\n` +
        `      width: Math.round(el.getBoundingClientRect().width),\n` +
        `      height: Math.round(el.getBoundingClientRect().height)\n` +
        `    }));\n` +
        `    let bank = [];\n` +
        `    try { bank = collectDragItems(document.body).map((item) => item.text); } catch {}\n` +
        `    console.table(zones);\n` +
        `    console.log('[Global Exam Drag] Banque restante:', bank);\n` +
        `    return { zones, bank };\n` +
        `  };\n` +
        debugMarker
      );
    }

    console.log(
      `[Global Exam Quality] ${INVENTORY_STATE_PATCH_VERSION} + ${INVENTORY_DOM_PATCH_VERSION} + ` +
      `${DRAG_DROP_EMPTY_ZONE_PATCH_VERSION} + ${PASSIVE_PAGE_PATCH_VERSION} + ` +
      `${DRAG_RECONSTRUCTION_PATCH_VERSION} appliqués.`
    );
    return code;
  };

  console.log(
    `[Global Exam Quality] ${QUALITY_PATCH_VERSION} + ${INVENTORY_STATE_PATCH_VERSION} + ` +
    `${INVENTORY_DOM_PATCH_VERSION} + ${DRAG_DROP_EMPTY_ZONE_PATCH_VERSION} + ` +
    `${PASSIVE_PAGE_PATCH_VERSION} + ${DRAG_RECONSTRUCTION_PATCH_VERSION} prêt.`
  );
})();