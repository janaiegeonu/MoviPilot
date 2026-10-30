(() => {
    "use strict";

    const app = document.getElementById("mpAdminApp");
    if (!app) return;

    const state = { range: "30d", view: "overview", selectedConversation: 0, overview: null, toastTimer: 0 };
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
    const number = (value) => new Intl.NumberFormat().format(Number(value) || 0);
    const dateTime = (value) => {
        const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
        return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
    };
    const setText = (selector, value) => { const node = $(selector); if (node) node.textContent = value == null ? "—" : String(value); };

    async function api(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            cache: "no-store",
            ...options,
            headers: { Accept: "application/json", ...(options.headers || {}) }
        });
        let payload = {};
        try { payload = await response.json(); } catch (_) { /* handled below */ }
        if (!response.ok) {
            const error = new Error(payload.error || "The request could not be completed.");
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    function postJSON(url, body) {
        return api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }

    function toast(message, isError = false) {
        const node = $("#adminToast");
        if (!node) return;
        window.clearTimeout(state.toastTimer);
        node.textContent = message;
        node.classList.toggle("is-error", isError);
        node.classList.add("is-visible");
        state.toastTimer = window.setTimeout(() => node.classList.remove("is-visible"), 3200);
    }

    function setView(name) {
        const allowed = ["overview", "users", "analytics", "support", "system"];
        if (!allowed.includes(name)) return;
        state.view = name;
        $$ ("[data-admin-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.adminView === name));
        $$ ("[data-admin-panel]").forEach((panel) => panel.classList.toggle("is-visible", panel.dataset.adminPanel === name));
        setText("#adminBreadcrumbCurrent", name === "support" ? "Support inbox" : name === "system" ? "System health" : name.charAt(0).toUpperCase() + name.slice(1));
        $("#adminSidebar")?.classList.remove("is-open");
        if (name === "users") loadUsers();
        if (name === "support") loadSupportQueue();
        if (name === "system") { loadHealth(); loadErrors(); }
        if (name === "analytics" && state.overview) renderChart("#adminAnalyticsChart", state.overview.chart);
    }

    function addCell(row, text, className) {
        const cell = document.createElement("td");
        if (className) cell.className = className;
        cell.textContent = text == null || text === "" ? "—" : String(text);
        row.appendChild(cell);
        return cell;
    }

    function addMemberCell(row, name, email) {
        const cell = document.createElement("td");
        const strong = document.createElement("strong");
        strong.textContent = name || "MoviPilot member";
        const small = document.createElement("small");
        small.textContent = email || "";
        cell.append(strong, small);
        row.appendChild(cell);
    }

    function renderRecentUsers(users) {
        const body = $("#recentUsersBody");
        if (!body) return;
        body.replaceChildren();
        if (!users?.length) {
            const row = body.insertRow();
            const cell = row.insertCell(); cell.colSpan = 3; cell.className = "table-placeholder"; cell.textContent = "No registered accounts yet.";
            return;
        }
        users.forEach((user) => {
            const row = body.insertRow();
            addMemberCell(row, user.fullName, user.maskedEmail);
            const provider = addCell(row, "");
            const pill = document.createElement("span"); pill.className = "provider-pill"; pill.textContent = user.authProvider || "local"; provider.appendChild(pill);
            addCell(row, dateTime(user.createdAt));
        });
    }

    function renderTopPages(selector, pages) {
        const root = $(selector);
        if (!root) return;
        root.replaceChildren();
        if (!pages?.length) {
            const empty = document.createElement("div"); empty.className = "table-placeholder"; empty.textContent = "No page views have been recorded for this period."; root.appendChild(empty); return;
        }
        const max = Math.max(...pages.map((p) => Number(p.views) || 0), 1);
        pages.forEach((page) => {
            const row = document.createElement("div"); row.className = "top-page-row";
            const copy = document.createElement("div"); copy.className = "top-page-copy";
            const title = document.createElement("strong"); title.textContent = page.path;
            const meta = document.createElement("small"); meta.textContent = `${number(page.visitors)} unique visitors`;
            const bar = document.createElement("div"); bar.className = "top-page-bar";
            const fill = document.createElement("span"); fill.className = "top-page-bar-fill";
            fill.dataset.level = String(Math.max(1, Math.min(10, Math.ceil((Number(page.views) / max) * 10))));
            bar.appendChild(fill); copy.append(title, meta, bar);
            const count = document.createElement("span"); count.className = "top-page-number"; count.textContent = number(page.views);
            row.append(copy, count); root.appendChild(row);
        });
    }

    function renderErrors(errors, selector) {
        const body = $(selector);
        if (!body) return;
        body.replaceChildren();
        if (!errors?.length) {
            const row = body.insertRow(); const cell = row.insertCell(); cell.colSpan = selector === "#allErrorsBody" ? 6 : 4; cell.className = "table-placeholder"; cell.textContent = "No server-side 5xx errors have been recorded."; return;
        }
        errors.forEach((item) => {
            const row = body.insertRow();
            addCell(row, dateTime(item.occurredAt));
            if (selector === "#allErrorsBody") addCell(row, item.method);
            addCell(row, item.route);
            const statusCell = addCell(row, "");
            const badge = document.createElement("span"); badge.className = "status-pill status-error"; badge.textContent = String(item.status); statusCell.appendChild(badge);
            addCell(row, item.message);
            if (selector === "#allErrorsBody") addCell(row, item.requestId || "—");
        });
    }

    function renderChart(selector, points) {
        const canvas = $(selector);
        if (!canvas) return;
        const parent = canvas.parentElement;
        const empty = selector === "#adminGrowthChart" ? $("#adminChartEmpty") : null;
        const hasValues = (points || []).some((p) => Number(p.signups) + Number(p.visitors) + Number(p.pageViews) > 0);
        if (empty) empty.hidden = hasValues;
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(280, Math.floor(rect.width || parent?.clientWidth || 600));
        const height = Math.max(180, Math.floor(rect.height || 230));
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);
        const left = 34, right = 12, top = 12, bottom = 30;
        const chartW = width - left - right, chartH = height - top - bottom;
        const series = [
            { key: "signups", color: "#8bdcbf" },
            { key: "visitors", color: "#5eafff" },
            { key: "pageViews", color: "#50d7d9" }
        ];
        const maxValue = Math.max(5, ...(points || []).flatMap((p) => series.map((s) => Number(p[s.key]) || 0)));
        ctx.font = "9px system-ui";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        for (let i = 0; i <= 4; i += 1) {
            const y = top + chartH * i / 4;
            ctx.strokeStyle = "rgba(117,177,195,.12)";
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width - right, y); ctx.stroke();
            ctx.fillStyle = "#597b8c";
            ctx.fillText(String(Math.round(maxValue * (4 - i) / 4)), left - 8, y);
        }
        if (!points?.length) return;
        const xFor = (index) => left + (points.length <= 1 ? chartW / 2 : (chartW * index / (points.length - 1)));
        series.forEach((item) => {
            ctx.beginPath();
            points.forEach((point, index) => {
                const value = Number(point[item.key]) || 0;
                const x = xFor(index), y = top + chartH - (value / maxValue) * chartH;
                if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.strokeStyle = item.color; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke();
            points.forEach((point, index) => {
                const value = Number(point[item.key]) || 0;
                const x = xFor(index), y = top + chartH - (value / maxValue) * chartH;
                ctx.beginPath(); ctx.arc(x, y, 2.3, 0, Math.PI * 2); ctx.fillStyle = item.color; ctx.fill();
            });
        });
        const labelCount = Math.min(6, points.length);
        ctx.fillStyle = "#5e8090"; ctx.textAlign = "center"; ctx.textBaseline = "top";
        for (let i = 0; i < labelCount; i += 1) {
            const index = labelCount === 1 ? 0 : Math.round(i * (points.length - 1) / (labelCount - 1));
            ctx.fillText(points[index].label || points[index].date, xFor(index), height - 19);
        }
    }

    async function loadOverview() {
        try {
            const data = await api(`/api/admin/overview?range=${encodeURIComponent(state.range)}`);
            state.overview = data;
            const s = data.summary || {};
            setText("#statTotalUsers", number(s.totalUsers)); setText("#statNewToday", number(s.newToday));
            setText("#statNewWeek", number(s.newThisWeek)); setText("#statNewMonth", number(s.newThisMonth));
            setText("#statUniqueVisitors", number(s.uniqueVisitors)); setText("#statPageViews", number(s.pageViews));
            setText("#statSessions", number(s.sessions)); setText("#statActiveVisitors", number(s.activeVisitors));
            setText("#analyticsUnique", number(s.uniqueVisitors)); setText("#analyticsNew", number(s.newVisitors));
            setText("#analyticsReturning", number(s.returningVisitors)); setText("#analyticsViews", number(s.pageViews));
            setText("#navUserCount", number(s.totalUsers));
            setText("#adminUpdatedAt", `Updated ${dateTime(data.generatedAt)}`);
            setText("#adminFooterTime", dateTime(data.generatedAt));
            setText("#chartRangeLabel", `Last ${state.range.replace("d", " days")}`);
            renderRecentUsers(data.recentUsers); renderTopPages("#topPagesList", data.topPages); renderTopPages("#analyticsTopPages", data.topPages);
            renderChart("#adminGrowthChart", data.chart); renderChart("#adminAnalyticsChart", data.chart);
        } catch (error) { toast(error.message || "Could not load overview metrics.", true); }
    }

    async function loadUsers() {
        const body = $("#allUsersBody");
        if (body && !body.dataset.loaded) body.textContent = "Loading users…";
        try {
            const data = await api("/api/admin/users?limit=100");
            const users = data.users || [];
            if (!body) return;
            body.replaceChildren(); body.dataset.loaded = "true";
            setText("#usersCountPill", `${number(users.length)} accounts shown`);
            if (!users.length) { const row = body.insertRow(); const cell = row.insertCell(); cell.colSpan = 4; cell.className = "table-placeholder"; cell.textContent = "No accounts found."; return; }
            users.forEach((user) => {
                const row = body.insertRow(); addMemberCell(row, user.fullName, `Account #${user.id}`); addCell(row, user.email);
                const providerCell = addCell(row, ""); const pill = document.createElement("span"); pill.className = "provider-pill"; pill.textContent = user.authProvider || "local"; providerCell.appendChild(pill);
                addCell(row, dateTime(user.createdAt));
            });
        } catch (error) { if (body) body.textContent = error.message; toast(error.message, true); }
    }

    async function loadErrors() {
        try {
            const data = await api("/api/admin/errors");
            renderErrors(data.errors || [], "#recentErrorsBody"); renderErrors(data.errors || [], "#allErrorsBody");
        } catch (error) { toast(error.message, true); }
    }

    async function loadActivity() {
        const root = $("#adminActivityFeed");
        if (!root) return;
        try {
            const data = await api("/api/admin/activity");
            root.replaceChildren();
            const events = data.activity || [];
            if (!events.length) { const empty = document.createElement("div"); empty.className = "table-placeholder"; empty.textContent = "No platform events have been recorded yet."; root.appendChild(empty); return; }
            events.forEach((item) => {
                const row = document.createElement("article"); row.className = "admin-activity-row"; row.dataset.kind = item.kind;
                const icon = document.createElement("span"); icon.className = "admin-activity-icon"; icon.textContent = item.kind === "signup" ? "＋" : item.kind === "support" ? "✉" : "!";
                const copy = document.createElement("div"); copy.className = "admin-activity-copy";
                const title = document.createElement("strong"); title.textContent = item.kind === "error" ? `${item.title} · ${item.detail}` : item.title;
                const detail = document.createElement("small"); detail.textContent = item.kind === "error" ? "Application error" : item.detail;
                const when = document.createElement("span"); when.className = "admin-activity-time"; when.textContent = dateTime(item.occurredAt);
                copy.append(title, detail); row.append(icon, copy, when); root.appendChild(row);
            });
        } catch (error) { root.textContent = error.message; }
    }

    async function loadHealth() {
        const root = $("#healthServices");
        try {
            const data = await api("/api/admin/health");
            if (root) {
                root.replaceChildren();
                (data.services || []).forEach((service) => {
                    const card = document.createElement("article"); card.className = "health-card"; card.dataset.status = service.status;
                    const pulse = document.createElement("span"); pulse.className = "health-pulse";
                    const copy = document.createElement("div"); const title = document.createElement("strong"); title.textContent = service.name;
                    const detail = document.createElement("small"); detail.textContent = service.detail; const status = document.createElement("small"); status.className = "health-status-label"; status.textContent = service.status;
                    copy.append(title, detail, status); card.append(pulse, copy); root.appendChild(card);
                });
            }
            setText("#errors24hCount", `${number(data.errorsLast24Hours)} errors`);
        } catch (error) { if (root) root.textContent = error.message; toast(error.message, true); }
    }

    let supportQueue = [];
    let supportFilter = "all";
    let latestUnreadConversationID = 0;
    let lastAdminInboxNotifiedID = 0;
    try { lastAdminInboxNotifiedID = Number(sessionStorage.getItem("movipilotAdminSupportLastNotified")) || 0; } catch (_) { /* session storage may be blocked */ }

    function supportInitials(name) {
        const parts = String(name || "MoviPilot member").trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return "MP";
        return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    function setSupportInboxCounts(data = {}) {
        const unread = Math.max(0, Number(data.unreadCount) || supportQueue.filter((item) => item.unread).length);
        const openCount = Math.max(0, Number(data.openCount) || supportQueue.length);
        const badge = $("#supportUnreadCount");
        if (badge) {
            badge.hidden = unread === 0;
            badge.textContent = unread > 99 ? "99+" : String(unread);
        }
        const navButton = $("[data-admin-view='support']");
        navButton?.classList.toggle("has-unread", unread > 0);
        setText("#supportQueueCount", String(openCount));
        setText("#supportUnreadSummary", `${unread} unread ${unread === 1 ? "conversation" : "conversations"}`);
        setText("#supportLastChecked", `Updated ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date())}`);
    }

    function hideAdminInboxNotification() {
        $("#adminInboxNotification")?.classList.remove("is-visible");
    }

    function showAdminInboxNotification(unreadCount) {
        const notification = $("#adminInboxNotification");
        if (!notification) return;
        setText("#adminInboxNotificationTitle", unreadCount === 1 ? "A member has sent MoviPilot a new message" : `${number(unreadCount)} new support conversations need your attention`);
        notification.classList.add("is-visible");
    }

    function createAdminVerifiedBadge() {
        const badge = document.createElement("span");
        badge.className = "admin-support-verified";
        badge.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 1.6 2.1 1.4 2.5-.1 1.1 2.2 2.2 1.1-.1 2.5 1.4 2.1-1.4 2.1.1 2.5-2.2 1.1-1.1 2.2-2.5-.1L10 20l-2.1-1.4-2.5.1-1.1-2.2-2.2-1.1.1-2.5L.8 11l1.4-2.1-.1-2.5 2.2-1.1 1.1-2.2 2.5.1L10 1.6Z" fill="currentColor"/><path d="m5.8 10.1 2.7 2.7 5.8-5.9" fill="none" stroke="#06232e" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>Verified';
        badge.title = "Official MoviPilot Support Team";
        return badge;
    }

    function renderSupportQueue() {
        const root = $("#supportThreadList");
        if (!root) return;
        const query = $("#supportSearchInput")?.value.trim().toLocaleLowerCase() || "";
        let visible = supportQueue.filter((item) => {
            if (supportFilter === "unread" && !item.unread) return false;
            if (!query) return true;
            return `${item.userName || ""} ${item.lastMessage || ""} ${item.status || ""}`.toLocaleLowerCase().includes(query);
        });
        root.replaceChildren();
        if (!visible.length) {
            const empty = document.createElement("div");
            empty.className = "table-placeholder";
            empty.textContent = supportQueue.length
                ? (supportFilter === "unread" ? "No unread conversations. You're all caught up." : "No conversations match your search.")
                : "No open support conversations yet. New member messages will appear here.";
            root.appendChild(empty);
            return;
        }
        visible.forEach((item) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "support-thread-card";
            if (item.id === state.selectedConversation) button.classList.add("is-selected");
            if (item.unread) button.classList.add("is-unread");
            button.dataset.conversationId = String(item.id);

            const head = document.createElement("div");
            head.className = "support-thread-card-head";
            const name = document.createElement("strong");
            name.textContent = item.userName || "MoviPilot member";
            const when = document.createElement("small");
            when.className = "support-thread-preview-time";
            when.textContent = dateTime(item.updatedAt);
            head.append(name, when);

            const preview = document.createElement("p");
            preview.textContent = item.lastMessage || "No message preview";
            const meta = document.createElement("div");
            meta.className = "support-thread-card-meta";
            const status = document.createElement("small");
            status.textContent = `${String(item.status || "open").toUpperCase()} · ${dateTime(item.updatedAt)}`;
            meta.appendChild(status);
            if (item.unread) {
                const unread = document.createElement("span");
                unread.className = "support-thread-unread-label";
                unread.textContent = "New message";
                meta.appendChild(unread);
            }
            button.append(head, preview, meta);
            button.addEventListener("click", () => openSupportConversation(item.id, item.userName));
            root.appendChild(button);
        });
    }

    async function refreshSupportData({ render = state.view === "support", notify = true, silent = false } = {}) {
        try {
            const data = await api("/api/admin/support");
            supportQueue = data.conversations || [];
            latestUnreadConversationID = Number(data.latestUnreadConversationId) || 0;
            const unreadCount = Number(data.unreadCount) || 0;
            setSupportInboxCounts({ ...data, openCount: supportQueue.length });
            if (render) renderSupportQueue();

            const latestUnreadID = Number(data.latestUnreadMessageId) || 0;
            if (notify && unreadCount > 0 && latestUnreadID > lastAdminInboxNotifiedID) {
                lastAdminInboxNotifiedID = latestUnreadID;
                try { sessionStorage.setItem("movipilotAdminSupportLastNotified", String(latestUnreadID)); } catch (_) { /* optional dedupe */ }
                showAdminInboxNotification(unreadCount);
            }
            return data;
        } catch (error) {
            if (!silent) toast(error.message, true);
            throw error;
        }
    }

    async function loadSupportQueue() {
        try { await refreshSupportData({ render: true, notify: true, silent: false }); }
        catch (_) { /* toast is handled by refreshSupportData */ }
    }

    async function pollAdminSupportNotifications() {
        if (document.hidden) return;
        try {
            await refreshSupportData({ render: state.view === "support", notify: true, silent: true });
            if (state.view === "support" && state.selectedConversation) {
                void loadSupportMessages();
            }
        } catch (_) { /* avoid repeated toast errors during background polling */ }
    }

    async function openSupportConversation(id, name) {
        state.selectedConversation = Number(id);
        const empty = $("#supportEmpty"), thread = $("#supportThread");
        if (empty) empty.hidden = true;
        if (thread) thread.hidden = false;
        setText("#supportMemberName", name || "MoviPilot member");
        setText("#supportMemberAvatar", supportInitials(name));
        await loadSupportMessages();
        await loadSupportQueue();
    }

    async function loadSupportMessages() {
        if (!state.selectedConversation) return;
        try {
            const data = await api(`/api/admin/support/messages?conversation_id=${state.selectedConversation}`);
            const root = $("#supportMessageList");
            if (!root) return;
            const wasNearBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 100;
            root.replaceChildren();
            (data.messages || []).forEach((item) => {
                const isAdmin = item.senderRole === "admin";
                const bubble = document.createElement("article");
                bubble.className = "support-message";
                if (isAdmin) bubble.classList.add("is-admin");

                const avatar = document.createElement("span");
                avatar.className = "support-message-avatar";
                if (isAdmin) {
                    const image = document.createElement("img");
                    image.src = "/img/logo favicon.png";
                    image.alt = "";
                    avatar.appendChild(image);
                } else {
                    avatar.textContent = "MEM";
                }

                const content = document.createElement("div");
                content.className = "support-message-content";
                const meta = document.createElement("div");
                meta.className = "support-message-meta";
                const sender = document.createElement("strong");
                sender.textContent = isAdmin ? "MoviPilot Support Team" : "Member";
                meta.appendChild(sender);
                if (isAdmin) meta.appendChild(createAdminVerifiedBadge());
                const time = document.createElement("time");
                time.textContent = dateTime(item.createdAt);
                meta.appendChild(time);
                const body = document.createElement("p");
                body.textContent = item.body;
                content.append(meta, body);
                bubble.append(avatar, content);
                root.appendChild(bubble);
            });
            if (wasNearBottom || root.children.length < 2) root.scrollTop = root.scrollHeight;
            const selected = supportQueue.find((item) => item.id === state.selectedConversation);
            setText("#supportThreadStatus", selected?.status || "Open");
            setSupportInboxCounts({ unreadCount: supportQueue.filter((item) => item.unread).length, openCount: supportQueue.length });
        } catch (error) { toast(error.message, true); }
    }

    async function loadSelectedSupport() {
        if (state.selectedConversation) await loadSupportMessages();
    }

    const supportReplyForm = $("#supportReplyForm");
    const supportReplyInput = $("#supportReplyInput");
    const supportReplyCharCount = $("#supportReplyCharCount");
    supportReplyInput?.addEventListener("input", () => {
        if (supportReplyCharCount) supportReplyCharCount.textContent = `${supportReplyInput.value.length} / 3000`;
    });
    supportReplyForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const input = $("#supportReplyInput"), button = $("#sendSupportReply");
        const message = input?.value.trim() || "";
        if (!state.selectedConversation || !message) return;
        if (button) button.disabled = true;
        try {
            await postJSON("/api/admin/support/reply", { conversationId: state.selectedConversation, message });
            if (input) input.value = "";
            if (supportReplyCharCount) supportReplyCharCount.textContent = "0 / 3000";
            toast("Verified MoviPilot Support Team reply sent to the member.");
            await loadSupportMessages();
            await loadSupportQueue();
            await pollAdminSupportNotifications();
        } catch (error) { toast(error.message, true); }
        finally { if (button) button.disabled = false; }
    });

    $("#resolveSupport")?.addEventListener("click", async () => {
        if (!state.selectedConversation) return;
        try {
            await postJSON("/api/admin/support/resolve", { conversationId: state.selectedConversation });
            state.selectedConversation = 0;
            $("#supportThread").hidden = true;
            $("#supportEmpty").hidden = false;
            toast("Conversation marked as resolved.");
            await loadSupportQueue();
        } catch (error) { toast(error.message, true); }
    });

    $("#supportSearchInput")?.addEventListener("input", renderSupportQueue);
    $$ ("[data-support-filter]").forEach((button) => button.addEventListener("click", () => {
        supportFilter = button.dataset.supportFilter === "unread" ? "unread" : "all";
        $$ ("[data-support-filter]").forEach((item) => item.classList.toggle("is-active", item === button));
        renderSupportQueue();
    }));

    $("#adminInboxNotification")?.addEventListener("click", async () => {
        hideAdminInboxNotification();
        setView("support");
        await loadSupportQueue();
        if (latestUnreadConversationID) {
            const item = supportQueue.find((conversation) => conversation.id === latestUnreadConversationID);
            if (item) await openSupportConversation(item.id, item.userName);
        }
    });
    $$ ("[data-admin-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.adminView)));
    $$ ("[data-open-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.openView)));
    $$ ("[data-range]").forEach((button) => button.addEventListener("click", () => {
        state.range = button.dataset.range;
        $$ ("[data-range]").forEach((item) => item.classList.toggle("is-active", item.dataset.range === state.range));
        loadOverview();
    }));
    $("#adminRefresh")?.addEventListener("click", async () => { await loadOverview(); await loadErrors(); await loadActivity(); toast("Dashboard data refreshed."); });
    $("#refreshUsers")?.addEventListener("click", loadUsers);
    $("#refreshSupport")?.addEventListener("click", loadSupportQueue);
    $("#refreshHealth")?.addEventListener("click", async () => { await loadHealth(); await loadErrors(); toast("System checks completed."); });
    $("#adminMobileMenu")?.addEventListener("click", () => $("#adminSidebar")?.classList.toggle("is-open"));

    const now = new Date();
    setText("#adminTopbarDate", new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(now));
    loadOverview(); loadErrors(); loadHealth(); loadActivity();
    const resizeObserver = new ResizeObserver(() => {
        if (!state.overview?.chart) return;
        renderChart("#adminGrowthChart", state.overview.chart);
        if (state.view === "analytics") renderChart("#adminAnalyticsChart", state.overview.chart);
    });
    if ($("#adminGrowthChart")) resizeObserver.observe($("#adminGrowthChart").parentElement);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadOverview(); pollAdminSupportNotifications(); if (state.view === "support") { loadSupportQueue(); loadSelectedSupport(); } } });
    window.setInterval(() => { if (!document.hidden) { loadOverview(); loadErrors(); loadActivity(); pollAdminSupportNotifications(); if (state.view === "support") loadSelectedSupport(); } }, 30000);
    // Monitor for new member messages even while the owner is on Overview,
    // Users, Analytics, or System Health.
    window.setInterval(() => { if (!document.hidden) pollAdminSupportNotifications(); }, 12000);
    void pollAdminSupportNotifications();
})();