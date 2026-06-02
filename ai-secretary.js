const riskRules = [
  { key: "客户催货", category: "客户催货", priority: "urgent", words: ["urgent", "催货", "today shipment", "need shipment", "ship today", "kirim hari ini"] },
  { key: "缺料", category: "缺料", priority: "urgent", words: ["缺料", "stok kosong", "material kosong", "shortage", "rm kosong", "no stock", "not enough"] },
  { key: "QC HOLD", category: "QC HOLD", priority: "urgent", words: ["qc hold", "hold", "belum release", "not release", "未放行", "未release", "release label belum"] },
  { key: "设备异常", category: "设备异常", priority: "urgent", words: ["forklift rusak", "forklift breakdown", "forklift mati", "叉车故障", "设备故障", "mesin rusak"] },
  { key: "WO异常", category: "WO异常", priority: "high", words: ["work order", "改单", "late wo", "wo terlambat", "切单"], patterns: [/\bwo\b/i, /\bwo[-\s]?\d+/i] },
  { key: "来料延迟", category: "来料延迟", priority: "high", words: ["delay", "delayed", "tertunda", "belum datang", "late arrival", "来料延迟", "到货延迟"] },
  { key: "库存差异", category: "库存差异", priority: "high", words: ["selisih", "差异", "variance", "beda stock", "stok beda", "库存不符"] },
  { key: "BPOM/PIB", category: "BPOM/PIB", priority: "high", words: ["bpom", "pib", "customs", "清关", "bea cukai"] },
  { key: "容器到货", category: "容器到货", priority: "normal", words: ["container", "kontainer", "柜", "到柜", "卸柜", "unloading"] },
  { key: "加班", category: "加班", priority: "high", words: ["overtime", "lembur", "加班"] },
  { key: "紧急放货", category: "紧急放货", priority: "urgent", words: ["release label", "urgent release", "紧急放货", "放行"] }
];

const samples = [
  { source: "WhatsApp", group: "出货群", text: "MOSSERU customer urgent. Need shipment today. Please confirm FG stock and release status.", time: "08:20" },
  { source: "WhatsApp", group: "仓库管理群", text: "Forklift rusak, unloading container NR016 tertunda sampai teknisi datang.", time: "09:05" },
  { source: "Feishu", group: "PMC群", text: "TO Ceramela Sunscreen WO terlambat, RM belum release dari QC. Warehouse perlu prepare ulang.", time: "10:30" },
  { source: "Feishu", group: "QC群", text: "QC HOLD 2 item, label release belum ada. Deni follow up today.", time: "11:10" },
  { source: "WeChat", group: "仓库管理群", text: "Ada selisih stock packaging material 12 pcs, Lingga sedang cek lokasi.", time: "13:15" },
  { source: "WhatsApp", group: "仓库管理群", text: "OK noted, thanks.", time: "14:00" }
];

let messages = [];
let completedTasks = JSON.parse(localStorage.getItem("warehouse-ai-completed-tasks") || "{}");

const viewTitles = {
  dashboard: "总览",
  intake: "消息入口",
  analysis: "归类分析",
  tasks: "任务提醒",
  daily: "今日日报"
};

function analyzeMessage(item) {
  const text = item.text.trim();
  const normalizedText = text.replace(/\b(no|not)\s+urgent\b/gi, "").replace(/\b(tidak|bukan)\s+urgent\b/gi, "");
  const lower = normalizedText.toLowerCase();
  const matched = riskRules.filter(rule => {
    const wordMatched = rule.words.some(word => lower.includes(word.toLowerCase()));
    const patternMatched = (rule.patterns || []).some(pattern => pattern.test(normalizedText));
    return wordMatched || patternMatched;
  });
  const top = chooseTopRule(matched, text);
  const important = matched.length > 0 || /asap|today|hari ini|今天|马上|紧急/i.test(normalizedText);
  const category = top?.category || (important ? "普通任务" : "无需处理");
  const priority = top?.priority || (important ? "normal" : "ignore");

  return {
    id: item.id || buildMessageId(item),
    ...item,
    important,
    priority,
    category,
    summary: buildSummary(text, category),
    translation: translateLite(text),
    action: suggestAction(category),
    owner: detectOwner(text, category),
    deadline: detectDeadline(text),
    matched: matched.map(rule => rule.key)
  };
}

function chooseTopRule(matched, text) {
  if (!matched.length) return null;
  if (/\bwo\b|work order|wo terlambat|late wo|改单|切单/i.test(text)) {
    return matched.find(rule => rule.category === "WO异常") || matched[0];
  }
  if (/customer|shipment|ship today|kirim hari ini|催货/i.test(text)) {
    return matched.find(rule => rule.category === "客户催货") || matched[0];
  }
  return matched.find(rule => rule.priority === "urgent") || matched.find(rule => rule.priority === "high") || matched[0];
}

function buildMessageId(item) {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const raw = `${item.source || "MSG"}|${item.group || ""}|${item.time || ""}|${item.text || ""}`;
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) >>> 0;
  }
  return `${item.source || "MSG"}-${stamp}-${hash.toString(16).slice(0, 6).toUpperCase()}`;
}

function detectDeadline(text) {
  if (/asap|urgent|马上|紧急/i.test(text)) return "ASAP";
  if (/today|hari ini|今天|今日/i.test(text)) return "今天";
  if (/tomorrow|besok|明天/i.test(text)) return "明天";
  const date = text.match(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/);
  return date ? date[0] : "未提到";
}

function buildSummary(text, category) {
  const customer = text.match(/\b[A-Z]{3,}\b/)?.[0];
  const product = text.match(/\b(?:TO|NR|WO)[\w-]+\b/i)?.[0];
  const target = product ? `（${product}）` : "";

  if (category === "客户催货") return `客户${customer ? ` ${customer}` : ""}有紧急出货需求，需要确认库存、放行和出货安排。`;
  if (category === "缺料") return `出现缺料或库存不足风险${target}，可能影响生产或出货。`;
  if (category === "设备异常") return `设备或叉车故障，可能影响卸柜、移库或装车。`;
  if (category === "QC HOLD") return `存在 QC HOLD 或未放行物料，需要确认 release 时间。`;
  if (category === "WO异常") return `WO 或计划变更影响仓库备料节奏，可能需要重新备料。`;
  if (category === "库存差异") return `发现库存差异，需要复盘实物、库位、批号和系统数量。`;
  if (category === "来料延迟") return `来料或卸货延迟，可能影响生产或出货计划。`;
  if (category === "BPOM/PIB") return `涉及 BPOM、PIB 或清关状态，需要确认文件和放行时间。`;
  if (category === "容器到货") return `有容器/柜到货或卸柜安排，需要确认人手和设备。`;
  if (category === "加班") return `消息涉及加班安排，需要确认原因、人员和审批状态。`;
  if (category === "紧急放货") return `消息涉及紧急放货或 release label，需要优先确认。`;
  if (category === "普通任务") return "消息包含需要跟进的普通事项，建议记录并确认负责人。";
  return "普通沟通消息，暂不需要处理。";
}

function translateLite(text) {
  return text
    .replace(/rusak/gi, "故障")
    .replace(/tertunda/gi, "延迟")
    .replace(/belum release/gi, "尚未放行")
    .replace(/lembur/gi, "加班")
    .replace(/selisih/gi, "差异")
    .replace(/stok/gi, "库存")
    .replace(/hari ini/gi, "今天")
    .replace(/besok/gi, "明天")
    .replace(/kirim/gi, "发货");
}

function suggestAction(category) {
  const actions = {
    客户催货: "确认 FG 库存、QC 状态、出货单和车辆安排。",
    缺料: "确认缺料品名、批号、数量、替代料和预计到料时间。",
    设备异常: "确认是否影响卸柜/装车，必要时安排维修或临时租叉车。",
    "QC HOLD": "追踪 QC release 时间，并同步 PMC 与出货负责人。",
    WO异常: "确认最新 WO、物料 release 状态和是否需要重新备料。",
    库存差异: "安排复盘，核对批号、库位、系统账和实物数量。",
    来料延迟: "确认 ETA、PIB/清关状态，并评估生产或出货影响。",
    "BPOM/PIB": "确认文件状态、预计完成时间和是否影响放行。",
    容器到货: "确认卸柜时间、人手、月台和叉车可用状态。",
    加班: "确认加班原因、人员、时段和审批状态。",
    紧急放货: "确认 release label、放行人和优先处理批次。",
    普通任务: "记录事项，确认负责人和完成时间。"
  };
  return actions[category] || "无需处理。";
}

function detectOwner(text, category) {
  const name = text.match(/\b(Deni|Lingga|Agus|Rina|Sari|Budi|Hanson|Eddie)\b/i)?.[0];
  if (name) return name;
  if (category === "QC HOLD") return "QC / Warehouse";
  if (category === "WO异常") return "PMC / Warehouse";
  if (category === "设备异常" || category === "容器到货") return "Warehouse";
  if (category === "客户催货") return "Warehouse / Shipping";
  return "待分配";
}

function priorityLabel(priority) {
  if (priority === "urgent") return "紧急";
  if (priority === "high") return "重要";
  if (priority === "normal") return "普通";
  return "忽略";
}

function render() {
  document.querySelector("#urgentCount").textContent = messages.filter(m => m.priority === "urgent").length;
  document.querySelector("#warehouseCount").textContent = messages.filter(m => ["设备异常", "库存差异", "缺料", "来料延迟", "容器到货"].includes(m.category)).length;
  document.querySelector("#taskCount").textContent = messages.filter(m => m.important).length;
  document.querySelector("#messageCount").textContent = messages.length;
  renderAlerts();
  renderKeywords();
  renderMessages();
  renderTasks();
  renderDaily();
}

function renderAlerts() {
  const alerts = messages.filter(m => m.important).slice(0, 8);
  document.querySelector("#alertList").innerHTML = alerts.length
    ? alerts.map(m => `
      <article class="alert-item ${m.priority}">
        <div class="alert-title"><span>${m.category}</span><span class="badge ${m.priority}">${priorityLabel(m.priority)}</span></div>
        <p>${m.summary}</p>
        <p class="muted">${m.action}</p>
      </article>`).join("")
    : `<p class="muted">暂无重要消息。可以先点“载入示例”，或到“消息入口”粘贴一条消息。</p>`;
}

function renderKeywords() {
  const used = new Set(messages.flatMap(m => m.matched || []));
  const keys = used.size ? [...used] : riskRules.map(rule => rule.key);
  document.querySelector("#keywordCloud").innerHTML = keys.map(key => `<span class="keyword">${key}</span>`).join("");
}

function renderMessages() {
  document.querySelector("#messageList").innerHTML = messages.length
    ? messages.map(m => `
      <article class="message-item ${m.priority}">
        <div class="message-title"><span>${m.id} · ${m.source} · ${m.group} · ${m.time}</span><span class="badge ${m.priority}">${m.category}</span></div>
        <p>${escapeHtml(m.text)}</p>
        <p><strong>中文摘要：</strong>${m.summary}</p>
        <p><strong>快速翻译：</strong>${m.translation}</p>
        <p class="muted"><strong>建议动作：</strong>${m.action}</p>
      </article>`).join("")
    : `<p class="muted">暂无消息。</p>`;
}

function renderTasks() {
  const taskMessages = messages.filter(m => m.important);
  const rows = taskMessages.map(m => `
    <tr class="${completedTasks[m.id] ? "task-done" : ""}">
      <td>
        <label class="task-check">
          <input type="checkbox" data-task-id="${m.id}" ${completedTasks[m.id] ? "checked" : ""} />
          <span>${completedTasks[m.id] ? "已完成" : "未完成"}</span>
        </label>
      </td>
      <td><span class="badge ${m.priority}">${priorityLabel(m.priority)}</span></td>
      <td>${m.owner}</td>
      <td>${m.action}</td>
      <td>${m.deadline}</td>
      <td>${m.source} · ${m.group} · ${m.category}</td>
    </tr>
  `).join("");
  document.querySelector("#taskTable").innerHTML = rows || `<tr><td colspan="6" class="muted">暂无自动任务。</td></tr>`;
  document.querySelectorAll("[data-task-id]").forEach(input => {
    input.addEventListener("change", event => {
      const id = event.target.dataset.taskId;
      completedTasks[id] = event.target.checked;
      localStorage.setItem("warehouse-ai-completed-tasks", JSON.stringify(completedTasks));
      render();
    });
  });
}

function renderDaily() {
  const important = messages.filter(m => m.important);
  const pending = important.filter(m => !completedTasks[m.id]);
  const done = important.filter(m => completedTasks[m.id]);
  const urgent = important.filter(m => m.priority === "urgent");
  const ignored = messages.filter(m => !m.important);
  const lines = [
    "【仓库AI日报】",
    `日期：${new Date().toLocaleDateString("zh-CN")}`,
    "",
    `今日消息：${messages.length} 条`,
    `紧急事项：${urgent.length} 条`,
    `待跟进任务：${pending.length} 项`,
    `已完成任务：${done.length} 项`,
    `已忽略普通沟通：${ignored.length} 条`,
    "",
    "一、今日重要事项"
  ];

  if (important.length) important.forEach((m, index) => lines.push(`${index + 1}. 【${m.category}】${m.summary}`));
  else lines.push("暂无重要事项。");

  lines.push("", "二、待跟进任务");
  if (pending.length) pending.forEach((m, index) => lines.push(`${index + 1}. ${m.owner}：${m.action}（截止：${m.deadline}）`));
  else lines.push("保持正常监控。");

  lines.push("", "三、已完成任务");
  if (done.length) done.forEach((m, index) => lines.push(`${index + 1}. ${m.owner}：${m.action}`));
  else lines.push("暂无已完成任务。");

  lines.push("", "四、风险预警");
  const risks = [...new Set(important.map(m => m.category))];
  lines.push(risks.length ? risks.join("、") : "暂无风险预警。");

  document.querySelector("#dailyReport").textContent = lines.join("\n");
}

function loadSamples() {
  messages = samples.map(analyzeMessage);
  render();
}

function addMessage() {
  const textarea = document.querySelector("#messageInput");
  const text = textarea.value.trim();
  if (!text) return;
  messages.unshift(analyzeMessage({
    source: document.querySelector("#sourceSelect").value,
    group: document.querySelector("#groupSelect").value,
    text,
    time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  }));
  textarea.value = "";
  render();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
    document.querySelectorAll(".view").forEach(view => view.classList.remove("active"));
    button.classList.add("active");
    document.querySelector(`#${button.dataset.view}`).classList.add("active");
    document.querySelector("#viewTitle").textContent = viewTitles[button.dataset.view];
  });
});

document.querySelector("#loadSamples").addEventListener("click", loadSamples);
document.querySelector("#analyzeAll").addEventListener("click", render);
document.querySelector("#addMessage").addEventListener("click", addMessage);
document.querySelector("#copyDaily").addEventListener("click", async () => {
  await navigator.clipboard.writeText(document.querySelector("#dailyReport").textContent);
  document.querySelector("#copyDaily").textContent = "已复制";
  setTimeout(() => (document.querySelector("#copyDaily").textContent = "复制日报"), 1200);
});

loadSamples();
