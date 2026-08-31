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

    // 1) CONTEXTE : sélectionner seulement les extraits utiles à la question courante.
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
    const termSet = new Set(contextTerms(questionContextText(q)));
    const scored = all.map((snippet, index) => {
      const snippetTerms = new Set(contextTerms(snippet.text || ''));
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

    // 2) RYTHME : réinitialiser le chrono quand l'activité URL change.
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
      if (previousRouteActivityId) log('Nouvelle activité détectée : rythme activité réinitialisé.');
    }
    const progress = parseProgressMarker();`;

    code = replaceOnce(code, "rythme lié à l'activité URL", oldPacingStart, newPacingStart);

    // 2b) PAGE DE COURS / VOCABULAIRE : du texte qui ressemble à une question ne
    // suffit pas à déclarer une question active. Sans contrôle de réponse fort,
    // Valider ou Passer doit être présent. Un simple bouton Suivant correspond aux
    // pages passives de cours et doit rester navigable automatiquement.
    const oldQuestionLikely = `    const questionLikely = !visibleCorrection && (strongControls || (progressed && questionHint));`;
    const newQuestionLikely = `    const questionLikely = !visibleCorrection && (
      strongControls ||
      (progressed && questionHint && (validateButtons.length > 0 || passButtons.length > 0))
    );`;
    code = replaceOnce(code, "page passive sans faux unknown-question", oldQuestionLikely, newQuestionLikely);

    // 3) MATCH/DRAG-DROP : conserver le mot-cible placé juste avant chaque zone.
    // Global Exam affiche souvent : "feature" -> [zone vide]. L'ancien zoneContext
    // ne voyait que "Zone 1", ce qui rendait l'association définition -> mot impossible.
    const oldZoneContext = `  const zoneContext = (el, index) => {
    const container = el.closest("p,li,[class*='sentence'],[class*='row'],[class*='line'],[class*='statement']") || el.parentElement;
    if (!container) return \`Zone \${index + 1}\`;

    // Conserver la position exacte du trou dans la phrase. Deux zones presentes
    // dans le meme bloc ne doivent pas envoyer le meme contexte a l'IA.
    try {
      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(container);
      beforeRange.setEndBefore(el);
      const afterRange = document.createRange();
      afterRange.selectNodeContents(container);
      afterRange.setStartAfter(el);

      const before = String(beforeRange.toString() || "").replace(/\\s+/g, " ").trim().slice(-220);
      const after = String(afterRange.toString() || "").replace(/\\s+/g, " ").trim().slice(0, 220);
      const positioned = \`\${before} [[ZONE_\${index}]] \${after}\`.replace(/\\s+/g, " ").trim();
      if (positioned.replace(\`[[ZONE_\${index}]]\`, "").trim()) {
        return \`Zone \${index + 1} — \${positioned}\`;
      }
    } catch {}

    const context = textOf(container).replace(/\\s+/g, " ").trim().slice(0, 420);
    return context ? \`Zone \${index + 1} — contexte: \${context}\` : \`Zone \${index + 1}\`;
  };`;

    const newZoneContext = `  const semanticLabelForDropZone = (el) => {
    if (!el?.isConnected) return '';
    const reject = (text) => {
      const raw = String(text || '').replace(/\\s+/g, ' ').trim();
      const loose = normLoose(raw);
      if (!raw || raw.length > 120 || loose.length < 2) return true;
      if (/^[^a-z0-9]+$/i.test(raw)) return true;
      if (isNavLikeText(raw) || isExerciseUiNoiseText(raw)) return true;
      if (dragInstructionMarkers.some((m) => loose.includes(normLoose(m)))) return true;
      return false;
    };

    const readCandidate = (node) => {
      if (!node || !isVisible(node) || isAssistantElement(node)) return '';
      if (node === el || node.contains(el) || node.querySelector?.(dropZoneSelector)) return '';
      const text = textOf(node).replace(/\\s+/g, ' ').trim();
      return reject(text) ? '' : text;
    };

    // Priorité au DOM : chercher les blocs frères immédiatement précédents.
    let node = el;
    for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
      let prev = node.previousElementSibling;
      for (let hop = 0; prev && hop < 4; hop += 1, prev = prev.previousElementSibling) {
        const text = readCandidate(prev);
        if (text) return text;
      }
    }

    // Fallback géométrique : texte court juste au-dessus de la zone et aligné avec elle.
    const zr = el.getBoundingClientRect();
    const candidates = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,div,strong,b,label')]
      .filter((x) => x !== el && isVisible(x) && !isAssistantElement(x))
      .map((x) => ({ x, text: readCandidate(x), r: x.getBoundingClientRect() }))
      .filter((c) => c.text)
      .filter((c) => {
        const gap = zr.top - c.r.bottom;
        const overlap = Math.max(0, Math.min(zr.right, c.r.right) - Math.max(zr.left, c.r.left));
        const minWidth = Math.max(1, Math.min(zr.width, c.r.width));
        return gap >= -8 && gap <= 180 && overlap / minWidth >= 0.35;
      })
      .sort((a, b) => {
        const gapA = Math.max(0, zr.top - a.r.bottom);
        const gapB = Math.max(0, zr.top - b.r.bottom);
        const centerA = Math.abs((a.r.left + a.r.right) / 2 - (zr.left + zr.right) / 2);
        const centerB = Math.abs((b.r.left + b.r.right) / 2 - (zr.left + zr.right) / 2);
        return gapA - gapB || centerA - centerB || a.text.length - b.text.length;
      });
    return candidates[0]?.text || '';
  };

  const zoneContext = (el, index) => {
    const container = el.closest("p,li,[class*='sentence'],[class*='row'],[class*='line'],[class*='statement']") || el.parentElement;
    if (container) {
      try {
        const beforeRange = document.createRange();
        beforeRange.selectNodeContents(container);
        beforeRange.setEndBefore(el);
        const afterRange = document.createRange();
        afterRange.selectNodeContents(container);
        afterRange.setStartAfter(el);

        const before = String(beforeRange.toString() || '').replace(/\\s+/g, ' ').trim().slice(-220);
        const after = String(afterRange.toString() || '').replace(/\\s+/g, ' ').trim().slice(0, 220);
        const surrounding = (before + ' ' + after).replace(/\\s+/g, ' ').trim();
        const positioned = (before + ' [[ZONE_' + index + ']] ' + after).replace(/\\s+/g, ' ').trim();
        if (normLoose(surrounding).length >= 2) {
          return 'Zone ' + (index + 1) + ' — ' + positioned;
        }
      } catch {}
    }

    const label = semanticLabelForDropZone(el);
    if (label) return 'Zone ' + (index + 1) + ' — cible: ' + label;

    const context = container ? textOf(container).replace(/\\s+/g, ' ').trim().slice(0, 420) : '';
    return context ? 'Zone ' + (index + 1) + ' — contexte: ' + context : 'Zone ' + (index + 1);
  };`;

    code = replaceOnce(code, "contexte sémantique des zones de matching", oldZoneContext, newZoneContext);

    // 4) DÉSACCORD IA : ne demander des votes supplémentaires que s'il existe
    // réellement des fournisseurs encore non utilisés après les slots 0/1/2.
    const analyzeMarker = "  const analyzeCurrentQuestion = async () => {\n";
    const consensusHelpers = `  const rescuePersistentConsensus = async (q, seedCandidates = []) => {
    const pool = seedCandidates
      .map((c) => normalizeResultForQuestion(q, c))
      .filter((c) => structurallyValidResult(q, c));

    const providerProfile = await getAdaptiveProviderProfile();
    const configuredCount = Number(providerProfile?.configured_count || 0);
    if (configuredCount <= 3) {
      agentLog(configuredCount + ' fournisseur(s) configuré(s): les slots 0/1/2 ont déjà utilisé toutes les opinions indépendantes; aucun vote répété inutile.');
      return null;
    }

    const rescueInstruction = [
      'VOTE DE SECOURS INDÉPENDANT.',
      'Résous entièrement la question depuis zéro. Ne choisis pas une réponse juste parce qu’un candidat précédent la proposait.',
      'Utilise uniquement la question actuelle, ses choix/items/zones et le CONTEXTE PERTINENT fourni.',
      'Ignore tout ancien contenu ou transcript qui ne parle pas du sujet de cette question.',
      q.type === 'drag-drop' ? 'Pour chaque zone, utilise explicitement son texte cible/contexte et construis une bijection complète item -> zone.' : '',
      'Renvoie uniquement le JSON strict attendu.'
    ].filter(Boolean).join('\\n');

    const maxVotes = Math.min(5, configuredCount);
    for (let slot = 3; slot < maxVotes; slot += 1) {
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
                agentLog(\`Désaccord persistant pour \${q.type}; vérification des fournisseurs indépendants encore disponibles...\`);
                const rescued = await rescuePersistentConsensus(q, [result, review, finalReview]);
                if (rescued) {
                  result = rescued;
                  agentLog(\`Consensus de secours obtenu pour \${q.type} (\${result.consensus}).\`);
                } else {
                  hardBlock(q.key, \`Désaccord IA persistant pour \${q.type} après les vérifications indépendantes disponibles. Aucune réponse appliquée.\`);
                  state.agent.lastResult = { error: state.agent.blockReason };
                  return state.agent.lastResult;
                }
              }`;

    code = replaceOnce(code, "majorité après désaccord", oldPersistentBlock, newPersistentBlock);

    // 5) DRAG-DROP FILL-WORDS : ne jamais déclarer complet tant que q.zones existe.
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
      if (remaining > 0) {
        return {
          state: inferredFilled > 0 ? 'partial' : 'empty',
          detail: inferredFilled + '/' + total + ' zone(s) locale(s), ' + remaining + ' restante(s)'
        };
      }
      const filled = localZones.filter(isZoneFilled).length;
      return {
        state: filled === total && total > 0 ? 'complete' : filled > 0 ? 'partial' : 'empty',
        detail: filled + '/' + total + ' zone(s) locale(s)'
      };
    }`;

    code = replaceOnce(code, "état drag-drop basé sur les zones réellement restantes", oldDragExistingState, newDragExistingState);

    // 6) STRATÉGIE IA ADAPTATIVE.
    const adaptiveHelpers = `  const getAdaptiveProviderProfile = async (force = false) => {
    const cached = state.agent.adaptiveProviderProfile;
    const fresh = cached && Date.now() - Number(cached.fetchedAt || 0) < 60000;
    if (!force && fresh) return cached;
    try {
      const response = await fetch('http://localhost:3000/providers', { cache: 'no-store' });
      if (!response.ok) throw new Error('providers HTTP ' + response.status);
      const data = await response.json();
      const profile = {
        ...data,
        configured_count: Number(data?.configured_count || 0),
        configuredProviders: (data?.providers || []).filter((p) => p?.configured).map((p) => p.name),
        fetchedAt: Date.now(),
      };
      state.agent.adaptiveProviderProfile = profile;
      return profile;
    } catch (error) {
      console.warn('[Global Exam Assistant] Profil fournisseurs indisponible; vérifications conservatrices maintenues.', error);
      return state.agent.adaptiveProviderProfile || { configured_count: 2, configuredProviders: [], mode: 'unknown', fetchedAt: Date.now() };
    }
  };

  const adaptiveComplexTypes = new Set(['multi-choice','text','multi-text','select','multi-select','drag-drop','ordering','matching','matrix']);

  const adaptiveShouldDoubleCheck = async (q, result) => {
    if (!needsDoubleCheck(q)) return false;
    const profile = await getAdaptiveProviderProfile();
    const count = Number(profile?.configured_count || 0);
    const confidence = Number(result?.confidence || 0);
    const valid = structurallyValidResult(q, result);
    const explanation = normLoose(result?.explanation || '');
    const mediaMissing = confidence <= 0.45 && explanation.includes('media present sans transcription');

    if (mediaMissing && count <= 1) {
      result.consensus = '1/1 contexte incomplet';
      agentLog('Média sans transcription et fournisseur unique: répéter le même modèle ne crée pas une preuve indépendante; réponse laissée sous le seuil automatique.');
      return false;
    }
    if (mediaMissing && count > 1) {
      agentLog('Média sans transcription, mais ' + count + ' fournisseurs distincts sont configurés: contre-vérification indépendante maintenue.');
      return true;
    }
    if (count <= 1) {
      const threshold = adaptiveComplexTypes.has(q.type) ? 0.94 : 0.90;
      if (valid && confidence >= threshold) {
        result.consensus = '1/1 adaptatif';
        result.providers = mergeProviders(result);
        agentLog('Fournisseur unique (' + (profile?.configuredProviders?.[0] || 'IA') + '): réponse valide à ' + Math.round(confidence * 100) + '%; seconde requête évitée pour préserver le quota.');
        return false;
      }
      agentLog('Fournisseur unique: confiance/structure insuffisante pour un appel unique; une vérification supplémentaire est autorisée.');
      return true;
    }
    agentLog('Plusieurs fournisseurs configurés (' + count + '): contre-vérification par un autre fournisseur maintenue.');
    return true;
  };

`;

    code = replaceOnce(code, "helpers stratégie adaptative", analyzeMarker, adaptiveHelpers + analyzeMarker);

    const oldAdaptiveEntry = `      let result = normalizeResultForQuestion(q, await askAiAgent(q, "", 0));
      if (needsDoubleCheck(q)) {`;
    const newAdaptiveEntry = `      let result = normalizeResultForQuestion(q, await askAiAgent(q, "", 0));
      if (await adaptiveShouldDoubleCheck(q, result)) {`;
    code = replaceOnce(code, "double vérification adaptative", oldAdaptiveEntry, newAdaptiveEntry);

    const oldLowConfidence = `      const low = (state.agent.lowConfidenceRetries.get(q.key) || 0) + 1;
      state.agent.lowConfidenceRetries.set(q.key, low);
      log(\`Confiance trop faible (\${Math.round(Number(result.confidence || 0) * 100)}%). Réanalyse \${low}/\${state.config.agent.lowConfidenceMaxRéanalyses}.\`);
      state.agent.lastResult = null;
      if (low >= state.config.agent.lowConfidenceMaxRéanalyses) {`;
    const newLowConfidence = `      const providerCount = Number(state.agent.adaptiveProviderProfile?.configured_count || 0);
      const adaptiveLowMax = providerCount === 1 ? 1 : state.config.agent.lowConfidenceMaxRéanalyses;
      const low = (state.agent.lowConfidenceRetries.get(q.key) || 0) + 1;
      state.agent.lowConfidenceRetries.set(q.key, low);
      log(\`Confiance trop faible (\${Math.round(Number(result.confidence || 0) * 100)}%). Réanalyse \${low}/\${adaptiveLowMax}.\`);
      state.agent.lastResult = null;
      if (low >= adaptiveLowMax) {`;
    code = replaceOnce(code, "limite réanalyse fournisseur unique", oldLowConfidence, newLowConfidence);

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
        `    const data = await getAdaptiveProviderProfile(true);\n` +
        `    console.table(data.providers || []);\n` +
        `    return data;\n` +
        `  };\n` +
        `  window.geAdaptiveAiProfile = () => state.agent.adaptiveProviderProfile || null;\n` +
        `  window.geDebugDragFillState = () => {\n` +
        `    const q = detectQuestion();\n` +
        `    const root = q?.root?.isConnected ? q.root : findQuestionRoot();\n` +
        `    const localZones = getLiveZoneElements(root);\n` +
        `    const data = { type: q?.type, remaining: q?.zones?.length || 0, items: q?.items?.length || 0, localZones: localZones.length, localFilledByLegacyHeuristic: localZones.filter(isZoneFilled).length, zones: (q?.zones || []).map((z) => z.text) };\n` +
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