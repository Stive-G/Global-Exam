(() => {
  const QUALITY_PATCH_VERSION = "6.4-quality-v1";
  const HOLISTIC_PATCH_VERSION = "6.4-holistic-drag-passive-v4";

  const xhr = new XMLHttpRequest();
  xhr.open("GET", `http://localhost:3000/runtime-quality-base-v6.4.js?v=${Date.now()}`, false);
  try {
    xhr.send(null);
  } catch (error) {
    throw new Error(`[Global Exam Quality Wrapper] Impossible de charger la qualité de base: ${error?.message || error}`);
  }
  if (xhr.status < 200 || xhr.status >= 300 || !xhr.responseText) {
    throw new Error(`[Global Exam Quality Wrapper] Qualité de base HTTP ${xhr.status || 0}.`);
  }

  (0, eval)(xhr.responseText);
  const baseApply = window.__applyGlobalExamV64QualityPatch;
  if (typeof baseApply !== "function") {
    throw new Error("[Global Exam Quality Wrapper] Patch qualité de base chargé mais fonction principale absente.");
  }

  const replaceOnce = (source, label, before, after) => {
    if (!source.includes(before)) {
      throw new Error(`[Quality ${HOLISTIC_PATCH_VERSION}] Bloc introuvable: ${label}.`);
    }
    return source.replace(before, after);
  };

  window.__applyGlobalExamV64QualityPatch = (source) => {
    let code = baseApply(source);
    if (code.includes(`const HOLISTIC_DRAG_PASSIVE_VERSION = "${HOLISTIC_PATCH_VERSION}"`)) return code;

    const oldAuditBlock = `    const strongControls =
      radios.length >= 2 || checkboxes.length >= 2 ||
      roleRadios.length >= 2 || roleCheckboxes.length >= 2 ||
      writable.length >= 1 || zones.length >= 1 || ordering ||
      (draggables.length >= 1 && zones.length >= 1) || answerButtons.length >= 2;

    // À 0/N, les pages de transcript/vocabulaire peuvent contenir des boutons mais
    // ne sont pas encore des questions. En revanche, un vrai champ/zone/choix reste
    // un signal fort même si le compteur est atypique.
    const questionLikely = !visibleCorrection && (
      strongControls ||
      (progressed && questionHint && (validateButtons.length > 0 || passButtons.length > 0))
    );`;

    const newAuditBlock = `    const semanticStrongControls =
      radios.length >= 2 || checkboxes.length >= 2 ||
      roleRadios.length >= 2 || roleCheckboxes.length >= 2 ||
      writable.length >= 1 || zones.length >= 1 || ordering ||
      (draggables.length >= 1 && zones.length >= 1);
    const buttonResponseControls = answerButtons.length >= 2 &&
      (validateButtons.length > 0 || passButtons.length > 0);
    const strongControls = semanticStrongControls || buttonResponseControls;
    const passiveContentOnly =
      !semanticStrongControls &&
      validateButtons.length === 0 && passButtons.length === 0;

    const questionLikely = !visibleCorrection && !passiveContentOnly && (
      strongControls ||
      (progressed && questionHint && (validateButtons.length > 0 || passButtons.length > 0))
    );`;

    if (code.includes(oldAuditBlock)) {
      code = replaceOnce(code, "audit passif sans faux unknown-question", oldAuditBlock, newAuditBlock);
    } else if (
      code.includes('const PASSIVE_PAGE_RUNTIME_VERSION = "6.4-passive-page-guard-v3"') ||
      code.includes('const directResponseControls =') ||
      code.includes('const buttonResponseEvidence =') ||
      code.includes('const semanticStrongControls =')
    ) {
      console.log('[Global Exam Quality Wrapper] Garde page passive déjà appliqué; aucun repatch nécessaire.');
    } else {
      throw new Error(`[Quality ${HOLISTIC_PATCH_VERSION}] Aucun garde passif compatible détecté.`);
    }

    const enrichMarker = `  const enrichDragQuestionZoneContexts = (q) => {`;
    const holisticHelpers = String.raw`  const HOLISTIC_DRAG_PASSIVE_VERSION = "${HOLISTIC_PATCH_VERSION}";

  const dragDropCommonAncestor = (zones) => {
    const els = (zones || []).map((z) => z?.element).filter((el) => el?.isConnected);
    if (!els.length) return null;
    let node = els[0];
    while (node && !els.every((el) => node === el || node.contains(el))) node = node.parentElement;
    return node || findQuestionRoot();
  };

  const dragDropVisiblePassage = (q) => {
    if (q?.type !== 'drag-drop' || !Array.isArray(q.zones) || !q.zones.length) return '';
    let fillWords = false;
    try { fillWords = !!isFillWordsInstruction(); } catch {}
    if (!fillWords) return '';

    const root = dragDropCommonAncestor(q.zones);
    if (!root?.isConnected) return '';
    const zoneMap = new Map();
    for (const zone of q.zones) {
      if (!zone?.element?.isConnected) continue;
      const original = Number(zone.originalIndex);
      const local = Number(zone.index);
      const idx = Number.isInteger(original) ? original : (Number.isInteger(local) ? local : 0);
      zoneMap.set(zone.element, idx);
    }

    const readNode = (node) => {
      if (!node) return '';
      if (node.nodeType === Node.TEXT_NODE) return String(node.nodeValue || '');
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const el = node;
      if (isAssistantElement(el)) return '';
      if (zoneMap.has(el)) return ' [[ZONE_' + zoneMap.get(el) + ']] ';
      let visible = true;
      try { visible = isVisible(el); } catch {}
      if (!visible && el !== root) return '';
      let out = '';
      for (const child of el.childNodes) out += readNode(child);
      const tag = String(el.tagName || '').toLowerCase();
      if (/^(p|div|li|br|section|article|tr)$/.test(tag)) out += ' ';
      return out;
    };

    return readNode(root)
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .trim()
      .slice(0, 6000);
  };

`;

    if (!code.includes('const dragDropVisiblePassage = (q) => {')) {
      if (!code.includes(enrichMarker)) {
        throw new Error(`[Quality ${HOLISTIC_PATCH_VERSION}] enrichDragQuestionZoneContexts introuvable.`);
      }
      code = code.replace(enrichMarker, holisticHelpers + enrichMarker);
    }

    const oldEnrichEnd = `    for (const zone of q.zones) {
      const original = Number(zone?.originalIndex);
      const local = Number(zone?.index);
      const zoneIndex = Number.isInteger(original) ? original : (Number.isInteger(local) ? local : 0);
      const sentence = sentenceWindowForDropZone(zone?.element, zoneIndex);
      if (sentence) zone.text = sentence;
    }
    return q;
  };`;

    const newEnrichEnd = String.raw`    for (const zone of q.zones) {
      const original = Number(zone?.originalIndex);
      const local = Number(zone?.index);
      const zoneIndex = Number.isInteger(original) ? original : (Number.isInteger(local) ? local : 0);
      const sentence = sentenceWindowForDropZone(zone?.element, zoneIndex);
      if (sentence) zone.text = sentence;
    }

    const fullPassage = dragDropVisiblePassage(q);
    if (fullPassage) {
      q.fullPassage = fullPassage;
      const marker = 'PASSAGE COMPLET À RECONSTRUIRE AVANT DE RÉPONDRE:';
      if (!String(q.prompt || '').includes(marker)) {
        q.prompt = String(q.prompt || '') + '\n\n' + marker + '\n' + fullPassage;
      }
      console.log('[Global Exam Drag] Passage complet construit avant IA:', fullPassage);
    }
    return q;
  };`;

    if (!code.includes("PASSAGE COMPLET À RECONSTRUIRE AVANT DE RÉPONDRE:")) {
      if (!code.includes(oldEnrichEnd)) {
        throw new Error(`[Quality ${HOLISTIC_PATCH_VERSION}] Fin enrichissement drag-drop introuvable.`);
      }
      code = code.replace(oldEnrichEnd, newEnrichEnd);
    } else {
      console.log('[Global Exam Quality Wrapper] Construction du passage complet déjà présente; repatch ignoré.');
    }

    const oldDragPromptStart = `        "Resous cet exercice de drag and drop.",
        "Associe exactement une réponse à chaque zone.",
        "Une zone ne doit apparaitre qu'une fois et un item ne doit pas etre reutilise.",
        "Utilise uniquement les index fournis.",`;
    const newDragPromptStart = `        "Résous cet exercice de drag and drop EN ENTIER avant de produire le JSON.",
        "Ne décide jamais un trou isolément : reconstruis mentalement le passage complet avec TOUS les items et TOUS les trous, puis vérifie la cohérence globale.",
        "Pour un fill-in-the-blanks, teste chaque mot dans le contexte de la phrase complète et compare les alternatives proches avant de figer le mapping.",
        "Associe exactement une réponse à chaque zone; une zone ne doit apparaître qu'une fois et un item ne doit pas être réutilisé.",
        "Utilise uniquement les index fournis.",`;

    if (code.includes(oldDragPromptStart)) {
      code = code.replace(oldDragPromptStart, newDragPromptStart);
    } else if (
      code.includes('Résous cet exercice de drag and drop EN ENTIER avant de produire le JSON.') ||
      code.includes('MÉTHODE OBLIGATOIRE: ne résous jamais les trous un par un.')
    ) {
      console.log('[Global Exam Quality Wrapper] Prompt drag-drop global déjà renforcé; repatch ignoré.');
    } else {
      throw new Error(`[Quality ${HOLISTIC_PATCH_VERSION}] Prompt drag-drop compatible introuvable.`);
    }

    const debugMarker = "  window.geUnblock = clearHardBlock;";
    if (code.includes(debugMarker)) {
      code = code.replace(
        debugMarker,
        `  window.geHolisticDragPassiveVersion = () => HOLISTIC_DRAG_PASSIVE_VERSION;\n` +
        `  window.geDebugHolisticDrag = () => {\n` +
        `    const q = enrichDragQuestionZoneContexts(detectQuestion());\n` +
        `    const data = { type: q?.type, fullPassage: q?.fullPassage || '', items: (q?.items || []).map((x) => x.text), zones: (q?.zones || []).map((z) => z.text) };\n` +
        `    console.log('[Global Exam Drag Holistic]', data);\n` +
        `    return data;\n` +
        `  };\n` +
        debugMarker
      );
    }

    console.log(`[Global Exam Quality Wrapper] ${HOLISTIC_PATCH_VERSION} appliqué : échappements préservés via String.raw, passage complet et garde passif compatibles.`);
    return code;
  };

  console.log(`[Global Exam Quality Wrapper] ${QUALITY_PATCH_VERSION} + ${HOLISTIC_PATCH_VERSION} prêt.`);
})();
