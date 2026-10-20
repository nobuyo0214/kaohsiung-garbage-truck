/* DOM adapter; all batch eligibility, freshness and undo checks live in review-batch. */
(function (root) {
  "use strict";
  root.GarbageBatchUI = { create };
  function create({ getState, onChange, navigate }) {
    const $ = (id) => document.getElementById(id),
      B = root.GarbageBatch,
      T = root.GarbageTriage;
    let selectedGroup = null,
      lastActiveGroup = null,
      selections = new Set(),
      plan = null;
    const actionText = {
      accept: "已接受建議（日期待查）",
      reject: "已拒絕",
      pending: "待查",
    };
    function invalidate() {
      plan = null;
      $("batch-preview").hidden = true;
      $("batch-apply").disabled = true;
      $("batch-attest").checked = false;
    }
    function group() {
      return B.groups(getState().entries).find((g) => g.key === selectedGroup);
    }
    function render() {
      invalidate();
      const state = getState(),
        counts = B.counts(state.entries, state.marks, state.decisions),
        all = B.groups(state.entries);
      $("review-counts").textContent =
        `候選狀態（官方紀錄計）：已接受 ${counts.accepted}、全數拒絕 ${counts.rejected}、待處理 ${counts.pending}。本次日期：已人工確認 ${counts.confirmed}、仍待查證 ${counts.pendingDates}；正式既有 ${state.existingCount} 條規則另行保留。候選組數：接受 ${counts.pairAccepted}、拒絕 ${counts.pairRejected}、待查 ${counts.pairPending}。接受候選不是確認日期。`;
      const activeKey = state.active && B.routeKey(state.active);
      if (activeKey && activeKey !== lastActiveGroup) {
        selectedGroup = activeKey;
        selections.clear();
      }
      lastActiveGroup = activeKey;
      if (!all.some((g) => g.key === selectedGroup))
        selectedGroup = all[0]?.key;
      $("route-group").replaceChildren();
      for (const g of all)
        $("route-group").add(
          new Option(
            `${g.official["官方路線名稱"] || "未提供路線名"}（${g.official["官方路線序號"] || "無路線ID"}）｜責任區${g.official["責任區"]}｜${g.entries.length}筆`,
            g.key,
          ),
        );
      if (selectedGroup) $("route-group").value = selectedGroup;
      const g = all.find((g) => g.key === selectedGroup);
      $("group-rows").replaceChildren();
      const eligible = new Set();
      for (const row of g?.rows || []) {
        const e = row.entry,
          s = row.candidate;
        const problem = g.duplicateOrder
          ? "官方清運序重複，請逐筆查證"
          : B.unavailable(e, s, state.marks, state.decisions);
        if (!problem) eligible.add(e.id);
        const tr = document.createElement("tr"),
          pick = document.createElement("td"),
          input = document.createElement("input");
        input.type = "checkbox";
        input.disabled = !!problem;
        input.checked = !problem && selections.has(e.id);
        input.setAttribute(
          "aria-label",
          `勾選 #${e.sequence} ${e.official["停留地點"]}`,
        );
        input.dataset.sequence = e.sequence;
        input.onchange = () => {
          if (input.checked) selections.add(e.id);
          else selections.delete(e.id);
          invalidate();
        };
        pick.append(input);
        tr.append(pick);
        const mark = s && T.current(e, s, state.marks);
        const fields = [
          `清運序 ${e.official["官方清運序"] || "未知"}｜#${e.sequence} ${e.official["停留地點"]}`,
          `${e.official["停留時間"]}｜${e.official["一般垃圾日"] || "未提供一般垃圾日"}`,
          s
            ? `車次${s.row["車次"]} ${s.row["停留地點"]} ${s.row["停留時間"]}｜Seq ${s.row.Seq || "未知"}`
            : e.suggestions.length
              ? "有時間／地點不同的候選，請逐筆比較"
              : "沒有候選，保留待查",
          `${row.continuity}；${mark ? actionText[mark.action] : "尚未處理"}。${problem}`,
        ];
        for (const text of fields) {
          const td = document.createElement("td");
          td.textContent = text;
          tr.append(td);
        }
        const button = document.createElement("button");
        button.textContent = "逐筆查看";
        button.setAttribute("aria-label", `逐筆查看 #${e.sequence}`);
        button.onclick = () => navigate(e.sequence);
        tr.lastChild.append(button);
        $("group-rows").append(tr);
      }
      for (const id of selections) if (!eligible.has(id)) selections.delete(id);
      $("group-summary").textContent = g
        ? `整條官方路線 ${g.entries.length} 筆；可批次選取 ${eligible.size} 筆。中間的無候選、時間不同與舊證據仍保留，不從行車順序推測班次。`
        : "沒有路線可比較";
      $("batch-select").disabled = !eligible.size;
      $("batch-history").replaceChildren();
      for (const b of [...state.history].reverse().filter((b) => !b.undone))
        $("batch-history").add(
          new Option(
            `${Number.isFinite(Date.parse(b.createdAt)) ? new Date(b.createdAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : "未知時間"}（台北）｜${b.changes.length}筆候選｜${b.reason}`,
            b.id,
          ),
        );
      $("batch-undo").disabled = !$("batch-history").options.length;
    }
    $("route-group").onchange = () => {
      selectedGroup = $("route-group").value;
      selections.clear();
      render();
    };
    $("batch-reason").oninput = invalidate;
    $("batch-clear").onclick = () => {
      selections.clear();
      render();
    };
    $("batch-select").onclick = () => {
      const { marks, decisions } = getState();
      for (const e of group()?.entries || []) {
        const s = B.preferred(e);
        if (!B.unavailable(e, s, marks, decisions)) selections.add(e.id);
      }
      render();
    };
    $("batch-preview-button").onclick = () => {
      try {
        const state = getState(),
          g = group();
        const chosen = (g?.entries || [])
          .filter((e) => selections.has(e.id))
          .map((e) => ({ recordId: e.id, candidateKey: B.preferred(e).key }));
        plan = B.preview(
          state.entries,
          state.marks,
          state.decisions,
          chosen,
          $("batch-reason").value,
          new Date().toISOString(),
          crypto.randomUUID(),
        );
        $("batch-preview-rows").replaceChildren();
        for (const c of plan.changes) {
          const e = state.entries.find((e) => e.id === c.recordId),
            s = B.preferred(e),
            li = document.createElement("li");
          li.textContent = `#${e.sequence} ${e.official["停留地點"]} ${e.official["停留時間"]} → CSV車次${s.row["車次"]} ${s.row["停留時間"]}（僅接受建議）`;
          $("batch-preview-rows").append(li);
        }
        $("batch-preview-summary").textContent =
          `將接受 ${plan.changes.length} 筆候選，新增日期 0 筆。已接受或拒絕的紀錄不覆蓋。共同理由：${plan.reason}`;
        $("batch-preview").hidden = false;
        $("batch-attest").checked = false;
        $("batch-apply").disabled = true;
        $("batch-status").textContent = "請閱讀預覽，再勾選確認並套用。";
      } catch (e) {
        invalidate();
        $("batch-status").textContent = e.message;
      }
    };
    $("batch-attest").onchange = () => {
      $("batch-apply").disabled = !plan || !$("batch-attest").checked;
    };
    $("batch-apply").onclick = () => {
      try {
        if (!plan || !$("batch-attest").checked)
          throw Error("請重新預覽並勾選確認");
        const state = getState(),
          batch = plan;
        const next = B.apply(
          state.entries,
          state.marks,
          state.decisions,
          batch,
        );
        onChange({ marks: next, history: [...state.history, batch] });
        $("batch-status").textContent =
          `已接受 ${batch.changes.length} 筆候選建議，新增日期 0 筆；進度及撤銷歷程已保存。`;
      } catch (e) {
        $("batch-status").textContent = e.message;
      }
    };
    $("batch-undo").onclick = () => {
      try {
        const state = getState(),
          result = B.undo(
            state.entries,
            state.marks,
            state.history,
            $("batch-history").value,
            new Date().toISOString(),
          );
        onChange({ marks: result.marks, history: result.history });
        $("batch-status").textContent =
          `已撤銷 ${result.restored} 筆；${result.skipped} 筆因後續逐筆修改或資料變更而保留。日期確認未變更。`;
      } catch (e) {
        $("batch-status").textContent = e.message;
      }
    };
    return { render };
  }
})(globalThis);
