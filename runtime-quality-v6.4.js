(() => {
  const QUALITY_PATCH_VERSION = "6.4-quality-v1";
  const INVENTORY_STATE_PATCH_VERSION = "6.4-ordering-inventory-state-v1";

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
    if (code.includes(`const ORDERING_INVENTORY_STATE_VERSION = "${INVENTORY_STATE_PATCH_VERSION}"`)) return code;

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
      .replace(/Nombre de fragments RESTANTS à sélectionner maintenant:\\s*\\d+\\./gi, 'Nombre total de fragments confirmé par inventaire: ' + count + '.')
      .replace(/Tu dois retourner une permutation contenant exactement\\s+\\d+\\s+index, chacun une seule fois, parmi\\s+0\\.\\.\\d+\\./gi,
        'Tu dois retourner une permutation contenant exactement ' + count + ' index, chacun une seule fois, parmi 0..' + (count - 1) + '.')
      .replace(/Il n'y a AUCUN nombre fixe de fragments:\\s*utilise seulement les\\s+\\d+\\s+propositions actuellement disponibles\\./gi,
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
      items: q.items.map((item, index) => ({ index, text: String(item.text || '').replace(/\\s+/g, ' ').trim() })),
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

    const debugMarker = "  window.geUnblock = clearHardBlock;";
    if (code.includes(debugMarker)) {
      code = code.replace(
        debugMarker,
        `  window.geOrderingInventoryStateVersion = () => ORDERING_INVENTORY_STATE_VERSION;\n` +
        `  window.geDebugOrderingInventoryState = () => state.agent.orderingInventoryState || null;\n` +
        debugMarker
      );
    }

    console.log(`[Global Exam Quality] ${INVENTORY_STATE_PATCH_VERSION} appliqué : le nombre total découvert est conservé jusqu'à l'application.`);
    return code;
  };

  console.log(`[Global Exam Quality] ${QUALITY_PATCH_VERSION} + ${INVENTORY_STATE_PATCH_VERSION} prêt.`);
})();