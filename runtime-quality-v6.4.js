(() => {
  const QUALITY_PATCH_VERSION = "6.4-quality-v1";
  const INVENTORY_RESET_PATCH_VERSION = "6.4-ordering-inventory-reset-v1";

  const xhr = new XMLHttpRequest();
  xhr.open("GET", `http://localhost:3000/runtime-quality-core-v6.4.js?v=${Date.now()}`, false);
  try {
    xhr.send(null);
  } catch (error) {
    throw new Error(`[Global Exam Quality] Impossible de charger le core qualité: ${error?.message || error}`);
  }
  if (xhr.status < 200 || xhr.status >= 300 || !xhr.responseText) {
    throw new Error(`[Global Exam Quality] Core qualité HTTP ${xhr.status || 0}.`);
  }

  (0, eval)(xhr.responseText);
  const coreApply = window.__applyGlobalExamV64QualityPatch;
  if (typeof coreApply !== "function") {
    throw new Error("[Global Exam Quality] Core qualité chargé mais patch principal absent.");
  }

  window.__applyGlobalExamV64QualityPatch = (source) => {
    let code = coreApply(source);
    if (code.includes(`const ORDERING_INVENTORY_RESET_VERSION = "${INVENTORY_RESET_PATCH_VERSION}"`)) return code;

    const discoverMarker = `  const discoverCompleteOrderingInventory = async (q) => {`;
    if (!code.includes(discoverMarker)) {
      throw new Error(`[Quality ${INVENTORY_RESET_PATCH_VERSION}] discoverCompleteOrderingInventory introuvable.`);
    }

    const helpers = `  const ORDERING_INVENTORY_RESET_VERSION = "${INVENTORY_RESET_PATCH_VERSION}";

  const orderingInventoryResetChanged = (before, after) => {
    const bSelected = Number(before?.selection?.selectedCount || 0);
    const aSelected = Number(after?.selection?.selectedCount || 0);
    const bRemaining = Number(before?.selection?.remainingCount || 0);
    const aRemaining = Number(after?.selection?.remainingCount || 0);
    return aSelected < bSelected || aRemaining > bRemaining;
  };

  const forceResetOrderingInventorySelection = async (q) => {
    const snapshot = () => orderingInventorySnapshot(q);

    for (let step = 0; step < 48; step += 1) {
      let before = snapshot();
      if (Number(before.selection?.selectedCount || 0) <= 0) return true;
      const target = before.target;
      if (!target?.isConnected) return false;

      let changed = false;
      const selected = orderingSelectedElements(target);
      const last = selected[selected.length - 1] || null;
      const expectedText = String(last ? textOf(last) : '').replace(/\\s+/g, ' ').trim();
      const candidates = [];
      const add = (el) => {
        if (!el?.isConnected || !isVisible(el) || !isEnabled(el) || isAssistantElement(el) || candidates.includes(el)) return;
        const r = el.getBoundingClientRect?.();
        if (r && (r.width > Math.max(820, innerWidth * 0.92) || r.height > 280)) return;
        candidates.push(el);
      };

      if (last) {
        add(last);
        try { sourceVariants(last, expectedText).forEach(add); } catch {}
        add(last.closest?.("button,[role='button'],[role='option'],[tabindex],li,[class*='word'],[class*='chip'],[class*='token'],[class*='item'],[class*='option']"));
        add(last.parentElement);
        try { [...last.querySelectorAll("button,[role='button'],[tabindex]")].forEach(add); } catch {}
      }

      for (const candidate of candidates.slice(0, 10)) {
        before = snapshot();
        await clickElement(candidate);
        await wait(220);
        let after = snapshot();
        if (orderingInventoryResetChanged(before, after)) { changed = true; break; }

        const fresh = candidate?.isConnected ? candidate : null;
        if (fresh) {
          const r = fresh.getBoundingClientRect();
          const x = r.left + r.width / 2, y = r.top + r.height / 2;
          try {
            state.agent.internalClick = true;
            dispatchPointer(fresh, 'pointerdown', x, y, 1);
            dispatchMouse(fresh, 'mousedown', x, y, 1);
            await wait(55);
            dispatchPointer(fresh, 'pointerup', x, y, 0);
            dispatchMouse(fresh, 'mouseup', x, y, 0);
            fresh.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, composed:true, view:window, clientX:x, clientY:y, button:0, buttons:0 }));
          } catch {} finally {
            setTimeout(() => { state.agent.internalClick = false; }, 0);
          }
          await wait(220);
          after = snapshot();
          if (orderingInventoryResetChanged(before, after)) { changed = true; break; }
        }

        if (await invokeReactClickDirect(candidate, expectedText || textOf(candidate))) {
          await wait(220);
          after = snapshot();
          if (orderingInventoryResetChanged(before, after)) { changed = true; break; }
        }
      }

      if (!changed) {
        const root = q?.root?.isConnected ? q.root : document.body;
        const tr = target.getBoundingClientRect();
        const controls = [...root.querySelectorAll("button,[role='button'],[aria-label],[title],[tabindex]")]
          .filter((el) => el?.isConnected && isVisible(el) && isEnabled(el) && !isAssistantElement(el))
          .filter((el) => {
            const raw = String(controlText(el) || '').trim();
            const label = normLoose([raw, el.getAttribute?.('aria-label') || '', el.getAttribute?.('title') || ''].join(' '));
            if (matchesActionText(raw, state.config.validateTexts) || matchesActionText(raw, state.config.nextTexts) || matchesActionText(raw, state.config.passTexts)) return false;
            const r = el.getBoundingClientRect();
            const small = r.width >= 12 && r.width <= 96 && r.height >= 12 && r.height <= 84;
            const dx = Math.max(tr.left-r.right, r.left-tr.right, 0);
            const dy = Math.max(tr.top-r.bottom, r.top-tr.bottom, 0);
            const nearby = Math.hypot(dx,dy) <= 420;
            const explicit = /undo|remove|reset|back|retour|annul|precedent|previous|revenir/.test(label);
            const leftGlyph = /^[←‹«<]+$/.test(raw);
            return small && nearby && (explicit || leftGlyph);
          });

        for (const control of controls.slice(0, 8)) {
          before = snapshot();
          await clickElement(control);
          await wait(220);
          const after = snapshot();
          if (orderingInventoryResetChanged(before, after)) { changed = true; break; }
        }
      }

      if (!changed) {
        const keyTargets = [last, target].filter(Boolean);
        for (const keyTarget of keyTargets) {
          before = snapshot();
          try { keyTarget.focus?.({ preventScroll:true }); } catch { try { keyTarget.focus?.(); } catch {} }
          for (const key of ['Backspace','Delete']) {
            try {
              keyTarget.dispatchEvent(new KeyboardEvent('keydown', { key, code:key, bubbles:true, cancelable:true }));
              keyTarget.dispatchEvent(new KeyboardEvent('keyup', { key, code:key, bubbles:true, cancelable:true }));
            } catch {}
            await wait(180);
            const after = snapshot();
            if (orderingInventoryResetChanged(before, after)) { changed = true; break; }
          }
          if (changed) break;
        }
      }

      if (!changed) {
        console.warn('[Global Exam Ordering] Reset inventaire renforcé sans effet; arrêt pour éviter une navigation dangereuse.');
        return false;
      }
    }

    return Number(snapshot().selection?.selectedCount || 0) <= 0;
  };

`;

    code = code.replace(discoverMarker, helpers + discoverMarker);

    const oldReset = `    const resetOk = await resetOrderingSelection(q);
    await wait(260);
    const resetState = orderingInventorySnapshot(q);
    if (!resetOk || Number(resetState.selection?.selectedCount || 0) > 0) {
      return {
        ok: false,
        reason: 'inventaire complet trouvé (' + q.items.length + ') mais remise à zéro non confirmée',
        discovered: q.items.map((x) => x.text)
      };
    }`;

    const newReset = `    let resetOk = await resetOrderingSelection(q);
    if (!resetOk) {
      console.log('[Global Exam Ordering] Reset standard insuffisant après inventaire; tentative renforcée.');
      resetOk = await forceResetOrderingInventorySelection(q);
    }
    await wait(260);
    const resetState = orderingInventorySnapshot(q);
    if (!resetOk || Number(resetState.selection?.selectedCount || 0) > 0) {
      return {
        ok: false,
        reason: 'inventaire complet trouvé (' + q.items.length + ') mais remise à zéro non confirmée après fallback renforcé',
        discovered: q.items.map((x) => x.text)
      };
    }`;

    if (!code.includes(oldReset)) {
      throw new Error(`[Quality ${INVENTORY_RESET_PATCH_VERSION}] bloc reset inventaire introuvable.`);
    }
    code = code.replace(oldReset, newReset);

    const debugMarker = "  window.geUnblock = clearHardBlock;";
    if (code.includes(debugMarker)) {
      code = code.replace(
        debugMarker,
        `  window.geOrderingInventoryResetVersion = () => ORDERING_INVENTORY_RESET_VERSION;\n` +
        `  window.geForceResetOrderingInventory = async () => { const q = detectQuestion(); return await forceResetOrderingInventorySelection(q); };\n` +
        debugMarker
      );
    }

    console.log(`[Global Exam Quality] ${INVENTORY_RESET_PATCH_VERSION} appliqué : reset robuste après inventaire dynamique.`);
    return code;
  };

  console.log(`[Global Exam Quality] ${QUALITY_PATCH_VERSION} + ${INVENTORY_RESET_PATCH_VERSION} prêt.`);
})();