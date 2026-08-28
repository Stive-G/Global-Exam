(() => {
  const PATCH_VERSION = "6.4";

  const replaceOnce = (source, label, before, after) => {
    if (!source.includes(before)) {
      throw new Error(`[Patch v${PATCH_VERSION}] Bloc introuvable: ${label}. La version de base n'est probablement plus compatible.`);
    }
    return source.replace(before, after);
  };

  window.__applyGlobalExamV64Patch = (source) => {
    let code = String(source || "");

    code = replaceOnce(
      code,
      "version",
      'const ASSISTANT_VERSION = "6.3";',
      'const ASSISTANT_VERSION = "6.4";'
    );
    code = code.replaceAll("Global Exam Assistant v6.3", "Global Exam Assistant v6.4");
    code = code.replaceAll("Démarrage v6.3 sécurisé.", "Démarrage v6.4 sécurisé.");

    code = replaceOnce(
      code,
      "filtre ordering/i18n",
`  const isOrderingNoiseText = (text) => {
    const raw = String(text || "").trim();
    if (/^[?!.,;:]+$/.test(raw)) return false;
    const t = normLoose(raw);
    if (!t) return true;
    if (/^\\d+\\s*\\/\\s*\\d+$/.test(String(text).trim())) return true;                // 3 / 13
    if (/^\\d{1,2}:\\d{2}\\s*\\/\\s*\\d{1,2}:\\d{2}$/.test(String(text).trim())) return true; // 00:00 / 02:16
    if (/^(play|pause|volume|mute|unmute|audio|sound)$/.test(t)) return true;
    if (/^(analyser|analyze|repondre|answer|auto on|auto off)$/.test(t)) return true;
    return isNavLikeText(t);
  };`,
`  const looksLikeInternalTranslationKey = (text) => {
    const raw = String(text || "").trim();
    if (!raw) return false;
    const lower = raw.toLowerCase();
    if (/feedback[_\\-.]?form|checkbox_available|available_to_discuss|translation[_\\-.]?key/.test(lower)) return true;
    if (/^[a-z0-9_]+(?:\\.[a-z0-9_]+){2,}$/.test(lower)) return true;
    if (/^[a-z0-9]+(?:_[a-z0-9]+){3,}(?:\\.label|\\.title|\\.text)?$/.test(lower)) return true;
    if (/\\.(label|title|placeholder|description|tooltip)$/.test(lower) && /[_.]/.test(lower)) return true;
    return false;
  };

  const isOrderingNoiseText = (text) => {
    const raw = String(text || "").trim();
    if (/^[?!.,;:]+$/.test(raw)) return false;
    if (looksLikeInternalTranslationKey(raw)) return true;
    const t = normLoose(raw);
    if (!t) return true;
    if (/^\\d+\\s*\\/\\s*\\d+$/.test(raw)) return true;
    if (/^\\d{1,2}:\\d{2}\\s*\\/\\s*\\d{1,2}:\\d{2}$/.test(raw)) return true;
    if (/^(play|pause|volume|mute|unmute|audio|sound)$/.test(t)) return true;
    if (/^(analyser|analyze|repondre|answer|auto on|auto off)$/.test(t)) return true;
    return isNavLikeText(t);
  };`
    );

    code = replaceOnce(
      code,
      "banque locale ordering",
`    // Preferer les plus petits descendants cliquables lorsqu'un wrapper et son bouton sont tous deux remontes.
    candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      return ar.top - br.top || ar.left - br.left || (ar.width * ar.height) - (br.width * br.height);
    });

    return dedupeByText(
      candidates.map((el) => ({ text: textOf(el).trim(), element: el })).filter((x) => norm(x.text))
    ).map((x, index) => ({ index, ...x }));`,
`    // Préférer les plus petits descendants cliquables lorsqu'un wrapper et son bouton sont tous deux remontés.
    candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      return ar.top - br.top || ar.left - br.left || (ar.width * ar.height) - (br.width * br.height);
    });

    // Sur certains PC, Global Exam expose plus bas des contrôles de feedback internes.
    // La vraie banque de mots forme le premier groupe vertical juste sous la zone pointillée.
    if (candidates.length > 1) {
      const firstTop = candidates[0].getBoundingClientRect().top;
      candidates = candidates.filter((el) => el.getBoundingClientRect().top <= firstTop + 360);
    }

    if (targetRect && candidates.length > 1) {
      const horizontalMargin = Math.max(120, Math.min(260, targetRect.width * 0.25));
      const local = candidates.filter((el) => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        return cx >= targetRect.left - horizontalMargin && cx <= targetRect.right + horizontalMargin;
      });
      if (local.length) candidates = local;
    }

    return dedupeByText(
      candidates
        .map((el) => ({ text: textOf(el).trim(), element: el }))
        .filter((x) => norm(x.text) && !looksLikeInternalTranslationKey(x.text))
    ).map((x, index) => ({ index, ...x }));`
    );

    code = replaceOnce(
      code,
      "comptage fragments sélectionnés",
`      // Les fragments places par Global Exam sont souvent numerotes 1,2,3... dans la zone.
      const chips = [...liveTarget.querySelectorAll("button,[role='button'],[class*='chip'],[class*='item'],[class*='token'],li,div,span")]
        .filter((el) => isVisible(el) && !isAssistantElement(el))
        .map((el) => textOf(el).trim())
        .filter((t) => t && t.length <= 180)
        .filter((t) => !/^\\d+$/.test(t));
      // Dedupe en conservant l'ordre DOM.
      const seen = new Set();
      selectedTexts = chips.filter((t) => {
        const k = norm(t);
        if (!k || seen.has(k)) return false;
        seen.add(k); return true;
      });

      // Si le DOM ne permet pas d'isoler les chips, on compte les badges numeriques visibles.`,
`      // Les fragments placés doivent être de vraies puces/boutons, pas des div/span génériques.
      const chips = [...liveTarget.querySelectorAll(
        "button,[role='button'],[role='option'],li,[class*='chip'],[class*='item'],[class*='token'],[class*='word'],[class*='option']"
      )]
        .filter((el) => isVisible(el) && !isAssistantElement(el))
        .map((el) => textOf(el).trim())
        .filter((t) => t && t.length <= 180)
        .filter((t) => !/^\\d+$/.test(t) && !isOrderingNoiseText(t));

      const seen = new Set();
      selectedTexts = chips.filter((t) => {
        const k = norm(t);
        if (!k || seen.has(k)) return false;
        seen.add(k); return true;
      });

      // Si le DOM ne permet pas d'isoler les puces, on compte les badges numériques visibles.`
    );

    code = replaceOnce(
      code,
      "protection avant clic ordering",
`        for (let position = 0; position < order.length; position++) {
          const idx = order[position];
          const original = q.items[idx];
          log(\`Ordering clic \${position + 1}/\${order.length}: \${idx} (\${original.text}).\`);

          const ok = await clickOrderingItemRobust(q, original);`,
`        for (let position = 0; position < order.length; position++) {
          const idx = order[position];
          const original = q.items[idx];
          if (!original || looksLikeInternalTranslationKey(original.text) || isOrderingNoiseText(original.text)) {
            log(\`Ordering refusé : candidat parasite détecté à l'index \${idx} (\${original?.text || "?"}). Aucun clic effectué.\`);
            return false;
          }
          log(\`Ordering clic \${position + 1}/\${order.length}: \${idx} (\${original.text}).\`);

          const ok = await clickOrderingItemRobust(q, original);`
    );

    code = replaceOnce(
      code,
      "commande debug ordering candidates",
`  window.geDebugButtonChoice = () => {`,
`  window.geDebugOrderingCandidates = () => {
    const root = findQuestionRoot();
    const instruction = findOrderingInstructionElement(document.body);
    const target = findOrderingTarget(document.body, instruction);
    const items = collectOrderingCandidates(document.body, instruction, target);
    console.table(items.map((x, i) => {
      const r = x.element.getBoundingClientRect();
      return {
        i,
        text: x.text,
        top: Math.round(r.top),
        left: Math.round(r.left),
        width: Math.round(r.width),
        className: String(x.element.className || "").slice(0, 90),
      };
    }));
    return { root, instruction, target, items };
  };

  window.geDebugButtonChoice = () => {`
    );

    return code;
  };

  console.log(`[Global Exam Patch] Patch runtime v${PATCH_VERSION} prêt.`);
})();
