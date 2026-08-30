(() => {
  const FINALIZE_PATCH_VERSION = "6.4-finalize-v1";

  const replaceOnce = (source, label, before, after) => {
    if (!source.includes(before)) {
      throw new Error(`[Finalize ${FINALIZE_PATCH_VERSION}] Bloc introuvable: ${label}.`);
    }
    return source.replace(before, after);
  };

  window.__applyGlobalExamV64FinalizePatch = (source) => {
    let code = String(source || "");
    if (code.includes(`const FINALIZE_RUNTIME_VERSION = "${FINALIZE_PATCH_VERSION}"`)) return code;

    const detectMarker = "  const detectQuestion = () => {\n";
    code = replaceOnce(
      code,
      "marqueur version finalisation",
      detectMarker,
      `  const FINALIZE_RUNTIME_VERSION = "${FINALIZE_PATCH_VERSION}";\n\n` + detectMarker
    );

    // Rythme par défaut : une activité vise désormais 15 minutes au lieu de 30.
    const oldPacingDefaults = `      activityPacing: {
        enabled: true,
        minMinutes: 30,
        maxMinutes: 30,
      },`;
    const newPacingDefaults = `      activityPacing: {
        enabled: true,
        minMinutes: 15,
        maxMinutes: 15,
      },`;
    code = replaceOnce(code, "rythme par défaut 15 minutes", oldPacingDefaults, newPacingDefaults);

    // Exception strictement limitée à la dernière question : sur Global Exam,
    // certains exercices n'affichent pas Valider à N/N. Le bouton Terminer/Finish
    // est alors l'action de soumission finale. On ne l'autorise que si la réponse
    // est complète, déjà appliquée/vérifiée et après l'audit de pré-validation.
    const beforeFinalWait = `      if (submissionState.pass) {
        log(\`"\${controlText(submissionState.pass)}" est visible: la question n'est PAS soumise. Aucun clic automatique; attente de Valider/Validée.\`);
        return false;
      }

      log("Réponse appliquée et vérifiée, mais soumission encore non confirmée. Attente de Valider/Validée; aucune navigation.");`;

    const afterFinalWait = `      const finalProgressRaw = String(currentProgressMarker() || '').trim();
      const finalProgressMatch = finalProgressRaw.match(/^(\\d+)\\s*\\/\\s*(\\d+)$/);
      const finalCurrent = finalProgressMatch ? Number(finalProgressMatch[1]) : null;
      const finalTotal = finalProgressMatch ? Number(finalProgressMatch[2]) : null;
      const finalButton = submissionState.next;
      const finalButtonText = finalButton ? controlText(finalButton) : '';
      const finalButtonLoose = normLoose(finalButtonText);
      const isLastQuestion = Number.isFinite(finalCurrent) && Number.isFinite(finalTotal) && finalTotal > 0 && finalCurrent === finalTotal;
      const isFinishButton = !!finalButton && /^(terminer|finish)(\\b|$)/.test(finalButtonLoose);
      const finalExistingState = existingResponseState(q);
      const finalResponseComplete = q.type === 'answered' || finalExistingState?.state === 'complete';

      if (!submissionState.validate && !submissionState.pass && isLastQuestion && isFinishButton && state.agent.lastApplyVerified && finalResponseComplete) {
        if (!(await auditAndPaceBeforeSubmit(q, \`finalisation "\${finalButtonText}"\`))) return false;

        const refreshedFinish = findActionButton(state.config.nextTexts);
        const refreshedFinishText = refreshedFinish ? controlText(refreshedFinish) : '';
        if (!refreshedFinish || !/^(terminer|finish)(\\b|$)/.test(normLoose(refreshedFinishText))) {
          hardBlock(q.key, 'Dernière question vérifiée mais le bouton Terminer/Finish a disparu avant la finalisation.');
          return false;
        }

        log(\`Dernière question \${finalCurrent}/\${finalTotal}: réponse complète et auditée; finalisation via "\${refreshedFinishText}".\`);
        if (!(await clickElement(refreshedFinish))) {
          hardBlock(q.key, 'Le bouton Terminer/Finish est visible mais le clic final n’a pas été confirmé.');
          return false;
        }
        await wait(state.config.settleDelayMs);
        return true;
      }

      if (submissionState.pass) {
        log(\`"\${controlText(submissionState.pass)}" est visible: la question n'est PAS soumise. Aucun clic automatique; attente de Valider/Validée.\`);
        return false;
      }

      log("Réponse appliquée et vérifiée, mais soumission encore non confirmée. Attente de Valider/Validée; aucune navigation.");`;

    code = replaceOnce(code, "finalisation dernière question", beforeFinalWait, afterFinalWait);

    // Le garde DOM global bloque normalement tout Suivant/Passer lorsqu'une
    // question non soumise est encore visible. Il doit laisser passer uniquement
    // Terminer/Finish dans le cas final sécurisé ci-dessus.
    const oldClickGuard = `      if ((clickAuditNext || clickAuditPass) && auditBeforeClick.questionLikely && !auditBeforeClick.submitted) {
        log('Clic automatique ' + (clickAuditLabel || 'Suivant/Passer') + ' bloqué par audit DOM: question non soumise visible.');
        return false;
      }`;

    const newClickGuard = `      const clickAuditIsFinalProgress = Number.isFinite(auditBeforeClick.current) && Number.isFinite(auditBeforeClick.total) && auditBeforeClick.total > 0 && auditBeforeClick.current === auditBeforeClick.total;
      const clickAuditIsFinish = /^(terminer|finish)(\\b|$)/.test(clickAuditLoose);
      const clickAuditFinalComplete =
        auditBeforeClick.emptyWritable === 0 &&
        auditBeforeClick.emptyZones === 0 &&
        (auditBeforeClick.radios === 0 || auditBeforeClick.selectedRadios > 0) &&
        (auditBeforeClick.checkboxes === 0 || auditBeforeClick.selectedCheckboxes > 0);
      const clickAuditSafeFinal =
        clickAuditIsFinalProgress && clickAuditIsFinish && clickAuditFinalComplete &&
        auditBeforeClick.validateButtons === 0 && auditBeforeClick.passButtons === 0 &&
        state.agent.lastApplyVerified;

      if ((clickAuditNext || clickAuditPass) && auditBeforeClick.questionLikely && !auditBeforeClick.submitted && !clickAuditSafeFinal) {
        log('Clic automatique ' + (clickAuditLabel || 'Suivant/Passer') + ' bloqué par audit DOM: question non soumise visible.');
        return false;
      }
      if (clickAuditSafeFinal) {
        log('Audit DOM final: Terminer/Finish autorisé uniquement car dernière question complète et réponse vérifiée.');
      }`;

    code = replaceOnce(code, "exception Terminer garde DOM", oldClickGuard, newClickGuard);

    const debugMarker = "  window.geUnblock = clearHardBlock;";
    if (code.includes(debugMarker)) {
      code = code.replace(
        debugMarker,
        "  window.geFinalizePatchVersion = () => FINALIZE_RUNTIME_VERSION;\n" + debugMarker
      );
    }

    return code;
  };

  console.log(`[Global Exam Finalize] ${FINALIZE_PATCH_VERSION} prêt.`);
})();