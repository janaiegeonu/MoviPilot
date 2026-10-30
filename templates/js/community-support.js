(() => {
    "use strict";

    // This script is loaded once by the persistent dashboard shell. The
    // notification watcher therefore stays alive while users browse other
    // dashboard pages; only the message-panel listeners are page-scoped.
    const NOTIFIED_KEY = "movipilotSupportLastNotifiedAdminMessage";
    const POLL_INTERVAL = 10000;
    let currentRoot = null;
    let currentController = null;
    let notificationTimer = 0;
    let conversationTimer = 0;
    let toastTimer = 0;
    let statusRequestBusy = false;
    let conversationRequestBusy = false;
    let lastNotifiedMessageID = readLastNotifiedID();
    let supportVisible = false;
    let supportIntersectionObserver = null;

    const textValue = (value) => String(value ?? "").trim();

    function readLastNotifiedID() {
        try { return Number(localStorage.getItem(NOTIFIED_KEY)) || 0; }
        catch (_) { return 0; }
    }

    function saveLastNotifiedID(id) {
        lastNotifiedMessageID = Math.max(lastNotifiedMessageID, Number(id) || 0);
        try { localStorage.setItem(NOTIFIED_KEY, String(lastNotifiedMessageID)); }
        catch (_) { /* Storage may be disabled; in-memory deduplication remains. */ }
    }

    async function requestJSON(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            cache: "no-store",
            ...options,
            headers: { Accept: "application/json", ...(options.headers || {}) }
        });
        let payload = {};
        try { payload = await response.json(); } catch (_) { /* handled by status below */ }
        if (!response.ok) {
            const error = new Error(payload.error || "The request could not be completed.");
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    function formatTime(seconds) {
        const date = new Date(Number(seconds) * 1000);
        if (Number.isNaN(date.getTime())) return "";
        return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
    }

    function createVerifiedBadge() {
        const badge = document.createElement("span");
        badge.className = "mp-support-verified-badge";
        badge.title = "Verified MoviPilot support account";
        badge.setAttribute("aria-label", "Verified MoviPilot support team");
        badge.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.6 12.1 3l2.5-.1 1.1 2.2 2.2 1.1-.1 2.5L19.2 11l-1.4 2.1.1 2.5-2.2 1.1-1.1 2.2-2.5-.1L10 20l-2.1-1.4-2.5.1-1.1-2.2-2.2-1.1.1-2.5L.8 11l1.4-2.1-.1-2.5 2.2-1.1 1.1-2.2 2.5.1L10 1.6Z" fill="currentColor"/><path d="m5.8 10.1 2.7 2.7 5.8-5.9" fill="none" stroke="#06232e" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        return badge;
    }

    function createSupportToast() {
        let toast = document.getElementById("mpSupportNotificationToast");
        if (toast) return toast;

        toast = document.createElement("button");
        toast.type = "button";
        toast.id = "mpSupportNotificationToast";
        toast.className = "mp-support-notification-toast";
        toast.setAttribute("aria-live", "polite");
        toast.setAttribute("aria-label", "MoviPilot support team has sent you a reply. Open your support conversation.");

        const mark = document.createElement("span");
        mark.className = "mp-support-notification-mark";
        const logo = document.createElement("img");
        logo.src = "/img/logo favicon.png";
        logo.alt = "";
        mark.appendChild(logo);

        const copy = document.createElement("span");
        copy.className = "mp-support-notification-copy";
        const title = document.createElement("strong");
        title.textContent = "MoviPilot support team has reached out to you";
        const subtitle = document.createElement("small");
        subtitle.textContent = "Tap to open your private support conversation";
        copy.append(title, subtitle);

        const arrow = document.createElement("span");
        arrow.className = "mp-support-notification-arrow";
        arrow.textContent = "↗";
        mark.setAttribute("aria-hidden", "true");
        arrow.setAttribute("aria-hidden", "true");
        toast.append(mark, copy, arrow);
        toast.addEventListener("click", () => { void openSupportConversation(); });
        document.body.appendChild(toast);
        return toast;
    }

    function showSupportToast(messageID) {
        const toast = createSupportToast();
        toast.classList.add("is-visible");
        toast.dataset.messageId = String(messageID || "");
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 9000);
    }

    function hideSupportToast() {
        document.getElementById("mpSupportNotificationToast")?.classList.remove("is-visible");
        window.clearTimeout(toastTimer);
    }

    async function pollSupportStatus() {
        if (statusRequestBusy || document.hidden) return;
        statusRequestBusy = true;
        try {
            const data = await requestJSON("/api/community/support/status");
            const latestID = Number(data.latestAdminMessageId) || 0;
            const unreadCount = Number(data.unreadCount) || 0;
            if (unreadCount > 0 && latestID > lastNotifiedMessageID) {
                saveLastNotifiedID(latestID);
                showSupportToast(latestID);
            }
            if (unreadCount === 0) {
                // Do not erase lastNotifiedMessageID: it prevents old replies from
                // appearing as fresh after the next page navigation.
            }
        } catch (error) {
            if (error.status === 401) return;
            console.warn("[MOVIPILOT SUPPORT NOTIFICATIONS]", error.message);
        } finally {
            statusRequestBusy = false;
        }
    }

    function setSupportStatus(root, message, isError = false) {
        const status = root.querySelector("#mpSupportStatus");
        if (status) {
            status.textContent = message;
            status.classList.toggle("is-error", isError);
        }
    }

    function renderMessages(root, conversation) {
        const list = root.querySelector("#mpSupportMessages");
        if (!list) return;
        const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
        const wasNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 90;
        list.replaceChildren();

        if (!messages.length) {
            const empty = document.createElement("div");
            empty.className = "mp-community-support-empty-state";
            const icon = document.createElement("span");
            icon.className = "mp-community-support-empty-icon";
            icon.textContent = "✦";
            const heading = document.createElement("strong");
            heading.textContent = "Your conversation starts here";
            const copy = document.createElement("small");
            copy.textContent = "Send a message and the MoviPilot Support Team will reply in this private space.";
            empty.append(icon, heading, copy);
            list.appendChild(empty);
        } else {
            messages.forEach((item) => {
                const isAdmin = item.senderRole === "admin";
                const row = document.createElement("article");
                row.className = "mp-community-support-message";
                row.classList.toggle("is-admin", isAdmin);
                row.dataset.messageId = String(item.id || "");

                const avatar = document.createElement("span");
                avatar.className = "mp-community-support-message-avatar";
                if (isAdmin) {
                    const logo = document.createElement("img");
                    logo.src = "/img/logo favicon.png";
                    logo.alt = "";
                    avatar.appendChild(logo);
                } else {
                    avatar.textContent = "YOU";
                }

                const content = document.createElement("div");
                content.className = "mp-community-support-message-content";
                const meta = document.createElement("div");
                meta.className = "mp-community-support-message-meta";
                if (isAdmin) {
                    const name = document.createElement("strong");
                    name.className = "mp-community-support-agent-name";
                    name.textContent = "MoviPilot Support Team";
                    meta.append(name, createVerifiedBadge());
                } else {
                    const name = document.createElement("strong");
                    name.textContent = "You";
                    meta.appendChild(name);
                }
                const time = document.createElement("time");
                time.dateTime = new Date(Number(item.createdAt) * 1000).toISOString();
                time.textContent = formatTime(item.createdAt);
                meta.appendChild(time);
                const body = document.createElement("p");
                body.textContent = item.body;
                content.append(meta, body);
                row.append(avatar, content);
                list.appendChild(row);
            });
        }

        if (wasNearBottom || messages.length <= 1) list.scrollTop = list.scrollHeight;
        list.setAttribute("aria-busy", "false");
        setSupportStatus(root, conversation?.status ? `Conversation · ${conversation.status}` : "Private support channel");
    }

    async function markSupportMessagesRead(signal) {
        try {
            await requestJSON("/api/community/support/read", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
                signal
            });
            hideSupportToast();
        } catch (error) {
            if (error.status !== 401) console.warn("[MOVIPILOT SUPPORT READ]", error.message);
        }
    }

    async function loadConversation(root, markReadAfterRender = false, signal = null) {
        if (conversationRequestBusy || !root?.isConnected) return;
        conversationRequestBusy = true;
        try {
            const data = await requestJSON("/api/community/support", { signal: signal || undefined });
            if (!root.isConnected || signal?.aborted) return;
            renderMessages(root, data.conversation || null);
            if (markReadAfterRender && supportVisible) await markSupportMessagesRead(signal || undefined);
            if (Number(data.unreadCount) > 0 && !supportVisible) {
                const latestID = Number(data.latestAdminMessageId) || 0;
                if (latestID > lastNotifiedMessageID) {
                    saveLastNotifiedID(latestID);
                    showSupportToast(latestID);
                }
            }
        } catch (error) {
            if (signal?.aborted) return;
            setSupportStatus(root, error.status === 401 ? "Sign in to use support" : (error.message || "Support is unavailable"), true);
        } finally {
            conversationRequestBusy = false;
        }
    }

    async function openSupportConversation() {
        const root = document.getElementById("mpCommunitySupport");
        if (!root) {
            if (typeof window.loadDashboardPage === "function") {
                await window.loadDashboardPage("community");
            } else {
                const nav = document.querySelector('.nav-link[data-page="community"], .mobile-page-nav-link[data-page="community"]');
                if (nav) nav.click();
            }
        }

        const deadline = Date.now() + 12000;
        let support = document.getElementById("mpCommunitySupport");
        while (!support && Date.now() < deadline) {
            await new Promise((resolve) => window.setTimeout(resolve, 100));
            support = document.getElementById("mpCommunitySupport");
        }
        if (!support) return;

        hideSupportToast();
        support.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
        window.setTimeout(() => {
            document.getElementById("mpCommunitySupportInput")?.focus({ preventScroll: true });
        }, 450);
        window.setTimeout(() => void pollSupportStatus(), 500);
    }

    function attachSupportPanel(root) {
        if (!root || root.dataset.supportReady === "true") return;
        root.dataset.supportReady = "true";
        currentRoot = root;
        const controller = new AbortController();
        currentController = controller;
        const { signal } = controller;
        const form = root.querySelector("#mpCommunitySupportForm");
        const input = root.querySelector("#mpCommunitySupportInput");
        const sendButton = root.querySelector("#mpSupportSend");
        const sendLabel = root.querySelector(".mp-community-support-send-label");
        const charCount = root.querySelector("#mpSupportCharCount");
        const contactButton = document.getElementById("mpCommunityContactSupport");

        const updateCount = () => {
            if (charCount) charCount.textContent = `${input?.value.length || 0} / 3000`;
        };
        input?.addEventListener("input", updateCount, { signal });
        updateCount();

        contactButton?.addEventListener("click", () => {
            root.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
            window.setTimeout(() => input?.focus({ preventScroll: true }), 400);
        }, { signal });

        form?.addEventListener("submit", async (event) => {
            event.preventDefault();
            const message = textValue(input?.value);
            if (!message) { input?.focus(); return; }
            if (sendButton) sendButton.disabled = true;
            if (sendLabel) sendLabel.textContent = "Sending…";
            try {
                await requestJSON("/api/community/support", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ message }),
                    signal
                });
                if (input) input.value = "";
                updateCount();
                setSupportStatus(root, "Message sent · the team will reply here");
                await loadConversation(root, true, signal);
                void pollSupportStatus();
            } catch (error) {
                setSupportStatus(root, error.message || "Your message could not be sent.", true);
            } finally {
                if (sendButton && root.isConnected) sendButton.disabled = false;
                if (sendLabel && root.isConnected) sendLabel.textContent = "Send message";
            }
        }, { signal });

        supportIntersectionObserver?.disconnect();
        supportIntersectionObserver = new IntersectionObserver((entries) => {
            const entry = entries[0];
            supportVisible = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.12);
            root.dataset.supportVisible = String(supportVisible);
            if (supportVisible) {
                void loadConversation(root, true, signal);
                window.clearInterval(conversationTimer);
                conversationTimer = window.setInterval(() => {
                    if (!document.hidden && supportVisible && root.isConnected) void loadConversation(root, true, signal);
                }, 12000);
            } else {
                window.clearInterval(conversationTimer);
                conversationTimer = 0;
            }
        }, { threshold: [0, 0.12, 0.35] });
        supportIntersectionObserver.observe(root);

        // Load the thread once to render previous messages, but don't mark replies
        // read while the support panel is still below the fold.
        void loadConversation(root, false, signal);

        root.__mpSupportCleanup = () => {
            controller.abort();
            supportIntersectionObserver?.disconnect();
            supportIntersectionObserver = null;
            window.clearInterval(conversationTimer);
            conversationTimer = 0;
            supportVisible = false;
            if (currentRoot === root) {
                currentRoot = null;
                currentController = null;
            }
            root.dataset.supportReady = "false";
        };
    }

    function scan(node) {
        if (!(node instanceof Element)) return;
        if (node.matches("#mpCommunitySupport")) attachSupportPanel(node);
        node.querySelectorAll?.("#mpCommunitySupport").forEach(attachSupportPanel);
    }

    const mutationObserver = new MutationObserver((records) => {
        records.forEach((record) => {
            record.addedNodes.forEach(scan);
            record.removedNodes.forEach((node) => {
                if (!(node instanceof Element)) return;
                if (node.matches("#mpCommunitySupport")) node.__mpSupportCleanup?.();
                node.querySelectorAll?.("#mpCommunitySupport").forEach((element) => element.__mpSupportCleanup?.());
            });
        });
    });

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
            void pollSupportStatus();
            if (currentRoot && supportVisible) void loadConversation(currentRoot, true, currentController?.signal);
        }
    });

    mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
    scan(document.documentElement);
    void pollSupportStatus();
    notificationTimer = window.setInterval(() => { void pollSupportStatus(); }, POLL_INTERVAL);
})();
