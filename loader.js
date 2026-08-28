// Petit chargeur à conserver dans un Snippet DevTools.
(async () => {
  const expectedVersion = "6.4";
  const baseVersion = "6.3";

  if (window.__globalExamPager) {
    const loaded = window.__GLOBAL_EXAM_ASSISTANT_VERSION || "ancienne/inconnue";
    console.warn(
      `[Loader Global Exam] Une version ${loaded} est déjà chargée. ` +
      `Fais Ctrl+R puis relance ce Snippet pour charger la v${expectedVersion}.`
    );
    return;
  }

  // Global Exam peut afficher un formulaire de feedback de fin d'activité.
  // Ce popup appartient au site, pas à l'assistant. Sur certains navigateurs,
  // ses traductions apparaissent sous forme de clés "feedback_form.*".
  // Le guard le ferme immédiatement pour éviter qu'il soit analysé comme une question.
  const installFeedbackSurveyGuard = () => {
    if (window.__GLOBAL_EXAM_FEEDBACK_SURVEY_GUARD) return;

    const isVisible = (el) => {
      if (!el || !el.isConnected) return false;
      const r = el.getBoundingClientRect?.();
      const s = getComputedStyle(el);
      return !!r && r.width > 0 && r.height > 0 &&
        s.display !== "none" && s.visibility !== "hidden" &&
        Number(s.opacity || 1) > 0;
    };

    const looksLikeSurvey = () => {
      const text = String(document.body?.innerText || document.body?.textContent || "");
      return /feedback_form\./i.test(text) &&
        /(need_question|categories|urgent|bug|typo|available_to_discuss)/i.test(text);
    };

    const findSurveyRoot = () => {
      const nodes = [...document.querySelectorAll("body *")]
        .filter((el) => isVisible(el))
        .filter((el) => /feedback_form\./i.test(String(el.innerText || el.textContent || "")));

      for (const node of nodes) {
        const explicit = node.closest?.(
          "[role='dialog'],[aria-modal='true'],[class*='modal'],[class*='dialog'],[class*='drawer'],[class*='sheet'],[class*='overlay']"
        );
        if (explicit && isVisible(explicit)) return explicit;
      }

      for (const node of nodes) {
        let cur = node;
        for (let depth = 0; cur && depth < 7; depth++, cur = cur.parentElement) {
          const r = cur.getBoundingClientRect?.();
          if (!r) continue;
          if (r.width >= Math.min(500, window.innerWidth * 0.65) &&
              r.height >= Math.min(300, window.innerHeight * 0.45)) {
            return cur;
          }
        }
      }

      return null;
    };

    const findCloseButton = (root) => {
      if (!root) return null;
      const candidates = [...root.querySelectorAll(
        "button,[role='button'],a,[tabindex]"
      )].filter((el) => isVisible(el) && !el.closest?.("#global-exam-assistant"));

      const direct = candidates.find((el) => {
        const label = [
          el.getAttribute?.("aria-label"),
          el.getAttribute?.("title"),
          el.innerText,
          el.textContent
        ].filter(Boolean).join(" ").trim().toLowerCase();

        return /^(x|×|✕|✖)$/.test(label) ||
          /\b(close|fermer|dismiss|quitter)\b/i.test(label);
      });
      if (direct) return direct;

      const rr = root.getBoundingClientRect();
      return candidates
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          return r.width <= 90 && r.height <= 90 &&
            cx >= rr.right - 140 &&
            cy <= rr.top + 140;
        })
        .sort((a, b) => {
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          return br.left - ar.left || ar.top - br.top;
        })[0] || null;
    };

    let busy = false;
    let lastLogAt = 0;

    const tryCloseSurvey = async () => {
      if (busy || !looksLikeSurvey()) return false;
      busy = true;
      try {
        const root = findSurveyRoot();
        const close = findCloseButton(root);
        if (!close) {
          const now = Date.now();
          if (now - lastLogAt > 5000) {
            lastLogAt = now;
            console.warn("[Global Exam Guard] Popup feedback détecté mais bouton fermer introuvable.");
          }
          return false;
        }

        console.log("[Global Exam Guard] Popup feedback Global Exam détecté : fermeture automatique.");
        close.click();
        return true;
      } finally {
        setTimeout(() => { busy = false; }, 250);
      }
    };

    let timer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(tryCloseSurvey, 40);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });

    window.__GLOBAL_EXAM_FEEDBACK_SURVEY_GUARD = {
      observer,
      tryClose: tryCloseSurvey
    };

    tryCloseSurvey();
  };

  installFeedbackSurveyGuard();

  const cacheBust = `${expectedVersion}-${Date.now()}`;
  const [assistantResponse, patchResponse, contentLoopHotfixResponse] = await Promise.all([
    fetch(`http://localhost:3000/assistant.js?v=${cacheBust}`, { cache: "no-store" }),
    fetch(`http://localhost:3000/runtime-patch-v6.4.js?v=${cacheBust}`, { cache: "no-store" }),
    fetch(`http://localhost:3000/runtime-hotfix-v6.4-content-loop.js?v=${cacheBust}`, { cache: "no-store" }),
  ]);

  if (!assistantResponse.ok) throw new Error(`Assistant HTTP ${assistantResponse.status}`);
  if (!patchResponse.ok) throw new Error(`Patch v6.4 HTTP ${patchResponse.status}`);
  if (!contentLoopHotfixResponse.ok) throw new Error(`Hotfix boucle contenu HTTP ${contentLoopHotfixResponse.status}`);

  const [baseCode, patchCode, contentLoopHotfixCode] = await Promise.all([
    assistantResponse.text(),
    patchResponse.text(),
    contentLoopHotfixResponse.text(),
  ]);

  if (!baseCode.includes(`ASSISTANT_VERSION = "${baseVersion}"`)) {
    throw new Error(
      `[Loader Global Exam] La base servie n'est pas la v${baseVersion}. ` +
      `Redémarre Docker depuis le dépôt à jour.`
    );
  }

  (0, eval)(patchCode);
  if (typeof window.__applyGlobalExamV64Patch !== "function") {
    throw new Error("[Loader Global Exam] Le patch v6.4 n'a pas été initialisé.");
  }

  (0, eval)(contentLoopHotfixCode);
  if (typeof window.__applyGlobalExamV64ContentLoopFix !== "function") {
    throw new Error("[Loader Global Exam] Le hotfix anti-boucle n'a pas été initialisé.");
  }

  let code = window.__applyGlobalExamV64Patch(baseCode);
  code = window.__applyGlobalExamV64ContentLoopFix(code);
  (0, eval)(code);

  const loaded = window.__GLOBAL_EXAM_ASSISTANT_VERSION || "inconnue";
  if (loaded !== expectedVersion) {
    throw new Error(`[Loader Global Exam] Version chargée ${loaded}, v${expectedVersion} attendue.`);
  }

  console.log(`[Loader Global Exam] Version chargée : ${loaded} + hotfix anti-boucle contenu`);
})();