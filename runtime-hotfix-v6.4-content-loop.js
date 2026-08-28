(() => {
  const HOTFIX_VERSION = "6.4-content-loop";

  const replaceOnce = (source, label, before, after) => {
    if (!source.includes(before)) {
      throw new Error(`[Hotfix ${HOTFIX_VERSION}] Bloc introuvable: ${label}.`);
    }
    return source.replace(before, after);
  };

  window.__applyGlobalExamV64ContentLoopFix = (source) => {
    let code = String(source || "");

    code = replaceOnce(
      code,
      "bruit UI transcript/zoom",
`  // v5.5 - Les contrôles du lecteur audio/video ne sont jamais des réponses.
  const isExerciseUiNoiseText = (text) => {
    const t = normLoose(text);
    if (!t) return true;
    if (/^\\d{1,3}\\s*\\/\\s*\\d{1,3}$/.test(String(text).trim())) return true;
    if (/^\\d{1,2}:\\d{2}\\s*\\/\\s*\\d{1,2}:\\d{2}$/.test(String(text).trim())) return true;
    const exact = [
      'play','pause','volume','mute','unmute','audio','sound','video',
      'lire la video','lire la vidéo','ecouter','écouter','ecouter audio','écouter audio',
      'listen','listen audio','play video','play audio','replay','restart','back','previous'
    ].map(normLoose);
    if (exact.includes(t)) return true;
    if (/^(play|pause|listen|lire|ecouter|volume|mute|audio|video)\\b/.test(t)) return true;
    return false;
  };`,
`  // Les contrôles de média, transcript, zoom et feedback ne sont jamais des réponses.
  const isExerciseUiNoiseText = (text) => {
    const raw = String(text || "").trim();
    const t = normLoose(raw);
    if (!t) return true;
    if (/^\\d{1,3}\\s*\\/\\s*\\d{1,3}$/.test(raw)) return true;
    if (/^\\d{1,2}:\\d{2}\\s*\\/\\s*\\d{1,2}:\\d{2}$/.test(raw)) return true;

    const exact = [
      'play','pause','volume','mute','unmute','audio','sound','video',
      'lire la video','lire la vidéo','ecouter','écouter','ecouter audio','écouter audio',
      'listen','listen audio','play video','play audio','replay','restart','back','previous',
      'voir le transcript','afficher le transcript','fermer le transcript','masquer le transcript',
      'show transcript','view transcript','open transcript','close transcript','hide transcript',
      'zoomer','dezoomer','dézoomer','zoom in','zoom out',
      'ouvrir le formulaire de retour','open feedback form','feedback'
    ].map(normLoose);

    if (exact.includes(t)) return true;
    if (/^(play|pause|listen|lire|ecouter|volume|mute|audio|video)\\b/.test(t)) return true;
    if (/\\btranscript\\b/.test(t)) return true;
    if (/^(zoomer|dezoomer|zoom in|zoom out)$/.test(t)) return true;
    if (/feedback form|formulaire de retour/.test(t)) return true;
    if (/feedback[_\\-.]?form|checkbox_available|available_to_discuss/.test(raw.toLowerCase())) return true;
    return false;
  };`
    );

    code = replaceOnce(
      code,
      "page contenu 0/N",
`  const detectQuestion = () => {
    if (isFeedbackPage()) return { type: "feedback", root: findQuestionRoot(), prompt: "", key: "feedback" };`,
`  const isPassiveZeroProgressContentPage = () => {
    const marker = String(currentProgressMarker() || "").trim();
    const m = marker.match(/^(\\d+)\\s*\\/\\s*(\\d+)$/);
    if (!m || Number(m[1]) !== 0 || Number(m[2]) <= 0) return false;

    // Sur Global Exam, 0/N correspond aux pages de contenu/support avant la première question
    // du bloc (transcript, vocabulaire, consigne, média...). Elles ne doivent jamais être
    // analysées comme un QCM à cause de boutons comme "Voir le transcript" ou "Zoomer".
    if (getLiveZoneElements(document.body).length > 0) return false;
    if (hasWritableQuestionControl()) return false;
    if (findActionButton?.(state.config.validateTexts)) return false;

    return true;
  };

  const detectQuestion = () => {
    if (isFeedbackPage()) return { type: "feedback", root: findQuestionRoot(), prompt: "", key: "feedback" };

    if (isPassiveZeroProgressContentPage()) {
      return { type: "none", root: findQuestionRoot(), prompt: "", key: `content::${pageIdentity()}` };
    }`
    );

    code = replaceOnce(
      code,
      "navigation passive sans Passer non soumis",
`  const navigatePassivePage = async (label) => {
    let btn = findActionButton(state.config.nextTexts) || findActionButton(state.config.passTexts);
    if (!btn) {
      btn = await waitForActionButton([...state.config.nextTexts, ...state.config.passTexts]);
    }
    if (!btn) {
      log(\`${label}: aucun bouton de navigation disponible.\`);
      return false;
    }
    log(\`${label}: navigation via "\${controlText(btn)}"\`);
    await clickElement(btn);
    await wait(state.config.settleDelayMs);
    return true;
  };`,
`  const navigatePassivePage = async (label) => {
    // Toujours préférer Suivant/Continuer sur une page de contenu.
    let next = findActionButton(state.config.nextTexts);
    if (!next) next = await waitForActionButton(state.config.nextTexts, state.config.agent.passiveNavigationWaitMs);

    if (next) {
      log(\`${label}: navigation via "\${controlText(next)}".\`);
      await clickElement(next);
      await wait(state.config.settleDelayMs);
      return true;
    }

    const pass = findActionButton(state.config.passTexts);
    const labelLoose = normLoose(label);
    const passAllowed = !!pass && (
      isFeedbackPage() ||
      hasSubmittedState() ||
      labelLoose.includes('correction') ||
      labelLoose.includes('resultat') ||
      labelLoose.includes('apres validation')
    );

    if (passAllowed) {
      log(\`${label}: navigation autorisée via "\${controlText(pass)}" car la réponse est déjà soumise/corrigée.\`);
      await clickElement(pass);
      await wait(state.config.settleDelayMs);
      return true;
    }

    if (pass) {
      log(\`${label}: "\${controlText(pass)}" visible mais soumission non confirmée; Passer bloqué.\`);
      return false;
    }

    log(\`${label}: aucun bouton de navigation fiable disponible.\`);
    return false;
  };`
    );

    return code;
  };

  console.log(`[Global Exam Hotfix] ${HOTFIX_VERSION} prêt.`);
})();