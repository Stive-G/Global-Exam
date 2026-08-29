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

  // Le patch d'audit v2 remplace les appels isFeedbackPage() par
  // isRealFeedbackPage(). Or looksLikeQuestionPage() appelle alors
  // isRealFeedbackPage() -> pageDomAudit(). Si pageDomAudit() rappelle à son tour
  // looksLikeQuestionPage(), on obtient une récursion infinie.
  // On garde l'audit DOM complet, mais son indice "questionHint" devient une
  // heuristique DOM autonome qui ne dépend jamais de looksLikeQuestionPage().
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
      throw new Error(
        `[Loader Global Exam] ${pageAuditRecursionFixVersion}: bloc questionHint introuvable.`
      );
    }

    code = code.replace(before, after);
    console.log(
      `[Loader Global Exam] ${pageAuditRecursionFixVersion} appliqué : ` +
      `pageDomAudit ne rappelle plus looksLikeQuestionPage().`
    );
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
    if (!response.ok) {
      throw new Error(`${entries[index][0]} HTTP ${response.status}`);
    }
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

  if (!baseCode.includes(`ASSISTANT_VERSION = "${baseVersion}"`)) {
    throw new Error(`[Loader Global Exam] Base v${baseVersion} attendue.`);
  }
  if (!runtimeCode.includes("__applyGlobalExamV64Patch")) {
    throw new Error(`[Loader Global Exam] Patch runtime v${expectedRuntimePatch} absent.`);
  }
  if (!manualCode.includes(`HOTFIX_VERSION = "${expectedManualHotfix}"`)) {
    throw new Error(`[Loader Global Exam] Hotfix manuel attendu: ${expectedManualHotfix}.`);
  }
  if (!contextCode.includes(`CONTEXT_PATCH_VERSION = "${expectedContextPatch}"`)) {
    throw new Error(`[Loader Global Exam] Patch contexte attendu: ${expectedContextPatch}.`);
  }
  if (!pageAuditCode.includes(`PAGE_AUDIT_VERSION = "${expectedPageAudit}"`)) {
    throw new Error(`[Loader Global Exam] Audit de page attendu: ${expectedPageAudit}.`);
  }
  if (!finalizeCode.includes(`FINALIZE_PATCH_VERSION = "${expectedFinalizePatch}"`)) {
    throw new Error(`[Loader Global Exam] Patch de finalisation attendu: ${expectedFinalizePatch}.`);
  }
  if (!qualityCode.includes(`QUALITY_PATCH_VERSION = "${expectedQualityPatch}"`)) {
    throw new Error(`[Loader Global Exam] Patch qualité attendu: ${expectedQualityPatch}.`);
  }

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
  assertSyntax(code);
  (0, eval)(code);
  installFeedbackSurveyGuard();

  const loaded = window.__GLOBAL_EXAM_ASSISTANT_VERSION || "inconnue";
  if (loaded !== expectedVersion) {
    throw new Error(`Version chargée ${loaded}, v${expectedVersion} attendue.`);
  }

  window.geRuntimeVersions = () => ({
    assistant: loaded,
    base: baseVersion,
    manualFlow: expectedManualHotfix,
    context: expectedContextPatch,
    pageAudit: expectedPageAudit,
    pageAuditGuard: pageAuditRecursionFixVersion,
    finalize: expectedFinalizePatch,
    quality: expectedQualityPatch,
  });

  console.log(
    `[Loader Global Exam] Chargé : assistant v${loaded} | ${expectedManualHotfix} | ` +
    `${expectedContextPatch} | ${expectedPageAudit} | ${pageAuditRecursionFixVersion} | ` +
    `${expectedFinalizePatch} | ${expectedQualityPatch}`
  );
})();
