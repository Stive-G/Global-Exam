(() => {
  const QUALITY_PATCH_VERSION = "6.4-quality-v1";

  const replaceOnce = (source, label, before, after) => {
    if (!source.includes(before)) {
      throw new Error(`[Quality ${QUALITY_PATCH_VERSION}] Bloc introuvable: ${label}.`);
    }
    return source.replace(before, after);
  };

  window.__applyGlobalExamV64QualityPatch = (source) => {
    let code = String(source || "");
    if (code.includes(`const QUALITY_RUNTIME_VERSION = "${QUALITY_PATCH_VERSION}"`)) return code;

    const detectMarker = "  const detectQuestion = () => {\n";
    code = replaceOnce(
      code,
      "marqueur version qualité",
      detectMarker,
      `  const QUALITY_RUNTIME_VERSION = "${QUALITY_PATCH_VERSION}";\n\n` + detectMarker
    );

    // -------------------------------------------------------------------------
    // 1) CONTEXTE : ne plus envoyer les 10 derniers blocs sans discernement.
    // -------------------------------------------------------------------------
    const oldContextStart = `  const activityContextPrompt = () => {
    ensureActivityContextIdentity();
    const snippets = state.agent.activityContextSnippets.slice(-10);`;

    const newContextStart = `  const contextStopWords = new Set([
    'the','a','an','and','or','of','to','in','on','for','with','is','are','was','were','be','been','being',
    'this','that','these','those','it','its','as','at','by','from','into','than','then','what','which','who',
    'how','when','where','why','do','does','did','can','could','should','would','will','may','might','must',
    'le','la','les','un','une','des','de','du','et','ou','dans','sur','pour','avec','est','sont','ce','cette',
    'ces','qui','que','quoi','comment','quand','ou','pourquoi','faire','fait','par','au','aux'
  ]);

  const contextTerms = (value) => [...new Set(
    normLoose(value).split(' ').filter((x) => x.length >= 3 && !contextStopWords.has(x))
  )];

  const questionContextText = (q) => {
    if (!q) return '';
    const parts = [q.prompt || ''];
    for (const c of q.choices || []) parts.push(c.text || '');
    for (const i of q.items || []) parts.push(i.text || '');
    for (const z of q.zones || []) parts.push(z.text || '');
    for (const f of q.fields || []) parts.push(f.label || '', ...(f.options || []).map((o) => o.text || ''));
    for (const r of q.rows || []) parts.push(r.rowText || '', ...(r.choices || []).map((c) => c.text || ''));
    return parts.join(' ');
  };

  const selectRelevantActivityContext = (q = null) => {
    ensureActivityContextIdentity();
    const all = state.agent.activityContextSnippets || [];
    if (!all.length) return [];
    if (!q) return all.slice(-8);

    const marker = String(currentProgressMarker() || '');
    const terms = contextTerms(questionContextText(q));
    const termSet = new Set(terms);

    const scored = all.map((snippet, index) => {
      const text = normLoose(snippet.text || '');
      const snippetTerms = new Set(contextTerms(text));
      let overlap = 0;
      for (const term of termSet) if (snippetTerms.has(term)) overlap += 1;

      const denom = Math.max(1, Math.min(termSet.size || 1, 14));
      let score = (overlap / denom) * 12;
      const sameMarker = !!marker && String(snippet.marker || '') === marker;
      if (sameMarker) score += snippet.kind === 'TRANSCRIPTION AUDIO' ? 10 : 5;
      if (snippet.kind === 'TRANSCRIPTION AUDIO' && snippet.marker && !sameMarker) score -= 4;
      if (index >= all.length - 3) score += 0.4;
      return { snippet, index, score, overlap, sameMarker };
    });

    let selected = scored
      .filter((x) => x.sameMarker || x.overlap > 0 || x.score >= 1.5)
      .sort((a, b) => b.score - a.score || b.index - a.index)
      .slice(0, 5);

    if (!selected.length) {
      const baseline = [...scored].reverse().find((x) => x.snippet.kind !== 'TRANSCRIPTION AUDIO');
      if (baseline) selected = [baseline];
    }

    return selected.sort((a, b) => a.index - b.index).map((x) => x.snippet);
  };

  const activityContextPrompt = (q = null) => {
    ensureActivityContextIdentity();
    const snippets = selectRelevantActivityContext(q);`;

    code = replaceOnce(code, "contexte pertinent par question", oldContextStart, newContextStart);
    code = replaceOnce(
      code,
      "question transmise au sélecteur de contexte",
      "    const contextBlock = activityContextPrompt();",
      "    const contextBlock = activityContextPrompt(q);"
    );

    // -------------------------------------------------------------------------
    // 2) RYTHME : l'état 30 min est lié à l'ID réel de l'activité dans l'URL.
    // -------------------------------------------------------------------------
    const oldPacingStart = `  const ensureActivityPacing = () => {
    if (!state.config.activityPacing.enabled) return null;
    const progress = parseProgressMarker();`;

    const newPacingStart = `  const ensureActivityPacing = () => {
    if (!state.config.activityPacing.enabled) return null;
    const routeActivityId = typeof currentActivityContextId === 'function'
      ? currentActivityContextId()
      : String(location.pathname || 'activity');
    if (state.activity.routeActivityId !== routeActivityId) {
      const previousRouteActivityId = state.activity.routeActivityId;
      state.activity.routeActivityId = routeActivityId;
      state.activity.targetDurationMs = null;
      state.activity.inferredStartedAt = null;
      state.activity.totalQuestions = null;
      state.activity.lastCurrent = null;
      state.activity.id = null;
      if (previousRouteActivityId) log('Nouvelle activité détectée : rythme 30 min réinitialisé.');
    }
    const progress = parseProgressMarker();`;

    code = replaceOnce(code, "rythme lié à l'activité URL", oldPacingStart, newPacingStart);

    // -------------------------------------------------------------------------
    // 3) DÉSACCORD IA : majorité stricte 3/5 après deux votes de secours.
    // -------------------------------------------------------------------------
    const analyzeMarker = "  const analyzeCurrentQuestion = async () => {\n";
    const consensusHelpers = `  const rescuePersistentConsensus = async (q, seedCandidates = []) => {
    const pool = seedCandidates
      .map((c) => normalizeResultForQuestion(q, c))
      .filter((c) => structurallyValidResult(q, c));

    const rescueInstruction = [
      'VOTE DE SECOURS INDÉPENDANT.',
      'Résous entièrement la question depuis zéro. Ne choisis pas une réponse juste parce qu’un candidat précédent la proposait.',
      'Utilise uniquement la question actuelle, ses choix/items/zones et le CONTEXTE PERTINENT fourni.',
      'Ignore tout ancien contenu ou transcript qui ne parle pas du sujet de cette question.',
      q.type === 'drag-drop' ? 'Pour chaque trou, lis précisément le texte avant/après [[ZONE_n]] et construis une bijection complète item -> zone.' : '',
      'Renvoie uniquement le JSON strict attendu.'
    ].filter(Boolean).join('\\n');

    for (const slot of [3, 4]) {
      try {
        const vote = normalizeResultForQuestion(q, await askAiAgent(q, rescueInstruction, slot));
        if (structurallyValidResult(q, vote)) pool.push(vote);
      } catch (error) {
        console.warn('[Global Exam Assistant] Vote de secours slot ' + slot + ' en erreur:', error);
      }
    }

    const groups = new Map();
    for (const candidate of pool) {
      const signature = resultSignature(q, candidate);
      if (!signature) continue;
      if (!groups.has(signature)) groups.set(signature, []);
      groups.get(signature).push(candidate);
    }

    const ranking = [...groups.entries()]
      .map(([signature, candidates]) => ({
        signature,
        candidates,
        count: candidates.length,
        avgConfidence: candidates.reduce((sum, c) => sum + Number(c.confidence || 0.5), 0) / candidates.length,
      }))
      .sort((a, b) => b.count - a.count || b.avgConfidence - a.avgConfidence);

    const winner = ranking[0];
    if (!winner || winner.count < 3) {
      agentLog('Vote de secours sans majorité 3/' + pool.length + ' pour ' + q.type + '.');
      return null;
    }

    const selected = [...winner.candidates]
      .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))[0];
    const merged = { ...selected };
    merged.confidence = Math.max(
      state.config.agent.consensusConfidenceFloor,
      Math.min(0.92, Number(winner.avgConfidence || 0.5))
    );
    merged.consensus = winner.count + '/' + pool.length + ' secours';
    merged.providers = mergeProviders(...winner.candidates);
    return merged;
  };

`;
    code = replaceOnce(code, "helpers consensus secours", analyzeMarker, consensusHelpers + analyzeMarker);

    const oldPersistentBlock = `              } else {
                hardBlock(q.key, \`Desaccord IA persistant pour \${q.type} (arbitrage \${Math.round(finalConfidence * 100)}%). Aucune réponse appliquée.\`);
                state.agent.lastResult = { error: state.agent.blockReason };
                return state.agent.lastResult;
              }`;

    const newPersistentBlock = `              } else {
                agentLog(\`Désaccord persistant pour \${q.type}; lancement de deux votes de secours indépendants...\`);
                const rescued = await rescuePersistentConsensus(q, [result, review, finalReview]);
                if (rescued) {
                  result = rescued;
                  agentLog(\`Consensus de secours obtenu pour \${q.type} (\${result.consensus}).\`);
                } else {
                  hardBlock(q.key, \`Désaccord IA persistant pour \${q.type} après 5 votes; aucune majorité 3/5. Aucune réponse appliquée.\`);
                  state.agent.lastResult = { error: state.agent.blockReason };
                  return state.agent.lastResult;
                }
              }`;

    code = replaceOnce(code, "majorité 3/5 après désaccord", oldPersistentBlock, newPersistentBlock);

    // -------------------------------------------------------------------------
    // 4) DRAG-DROP FILL-WORDS : ne jamais déclarer une question complète tant que
    //    detectDragDrop() retourne encore des zones à remplir. L'ancien contrôle
    //    relisait document.body et pouvait sélectionner des wrappers textuels plus
    //    larges que les vrais trous; isZoneFilled() les considérait alors remplis.
    // -------------------------------------------------------------------------
    const oldDragExistingState = `    if (q.type === 'drag-drop' && isFillWordsInstruction()) {
      const all = getLiveZoneElements(document.body);
      const filled = all.filter(isZoneFilled).length;
      return { state: filled === all.length && all.length > 0 ? 'complete' : filled > 0 ? 'partial' : 'empty', detail: \`${'${filled}/${all.length}'} zone(s)\` };
    }`;

    const newDragExistingState = `    if (q.type === 'drag-drop' && isFillWordsInstruction()) {
      const localRoot = q.root?.isConnected ? q.root : findQuestionRoot();
      const localZones = getLiveZoneElements(localRoot);
      const remaining = Array.isArray(q.zones) ? q.zones.length : 0;
      const total = localZones.length;
      const inferredFilled = Math.max(0, total - remaining);

      // Tant que le détecteur de drag-drop expose au moins une zone restante,
      // l'exercice ne peut JAMAIS être considéré comme complet.
      if (remaining > 0) {
        const stateName = inferredFilled > 0 ? 'partial' : 'empty';
        return {
          state: stateName,
          detail: inferredFilled + '/' + total + ' zone(s) locale(s), ' + remaining + ' restante(s)'
        };
      }

      const filled = localZones.filter(isZoneFilled).length;
      return {
        state: filled === total && total > 0 ? 'complete' : filled > 0 ? 'partial' : 'empty',
        detail: filled + '/' + total + ' zone(s) locale(s)'
      };
    }`;

    code = replaceOnce(
      code,
      "état drag-drop basé sur les zones réellement restantes",
      oldDragExistingState,
      newDragExistingState
    );

    const debugMarker = "  window.geUnblock = clearHardBlock;";
    if (code.includes(debugMarker)) {
      code = code.replace(
        debugMarker,
        `  window.geQualityPatchVersion = () => QUALITY_RUNTIME_VERSION;\n` +
        `  window.geDebugRelevantContext = () => {\n` +
        `    const q = detectQuestion();\n` +
        `    const snippets = selectRelevantActivityContext(q);\n` +
        `    console.table(snippets.map((s, i) => ({ i, kind: s.kind, marker: s.marker, text: String(s.text || '').slice(0, 240) })));\n` +
        `    return { questionType: q?.type, prompt: q?.prompt, snippets };\n` +
        `  };\n` +
        `  window.geDebugAiProviders = async () => {\n` +
        `    const response = await fetch('http://localhost:3000/providers', { cache: 'no-store' });\n` +
        `    const data = await response.json();\n` +
        `    console.table(data.providers || []);\n` +
        `    return data;\n` +
        `  };\n` +
        `  window.geDebugDragFillState = () => {\n` +
        `    const q = detectQuestion();\n` +
        `    const root = q?.root?.isConnected ? q.root : findQuestionRoot();\n` +
        `    const localZones = getLiveZoneElements(root);\n` +
        `    const data = { type: q?.type, remaining: q?.zones?.length || 0, items: q?.items?.length || 0, localZones: localZones.length, localFilledByLegacyHeuristic: localZones.filter(isZoneFilled).length };\n` +
        `    console.log('[Global Exam Drag State]', data);\n` +
        `    return data;\n` +
        `  };\n` +
        debugMarker
      );
    }

    return code;
  };

  console.log(`[Global Exam Quality] ${QUALITY_PATCH_VERSION} prêt.`);
})();