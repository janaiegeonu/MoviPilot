/* =========================================================
   MOVIPILOT — PERSISTENT MY COLLECTION MODAL + SIDEBAR ROUTING
   The modal markup lives in dashboard.html, outside #dashboardDynamicPage.
   This script stays loaded while the Community fragment is swapped in/out.
   ========================================================= */
(() => {
    "use strict";

    if (window.__mpCollectionHubInstalled) return;
    window.__mpCollectionHubInstalled = true;

    const API = "/api/explore/collection-hub";
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let hubOpen = false;
    let openingFocus = null;
    let originalBodyOverflow = "";
    let statusTimer = 0;
    let cachedOverview = { folders: [], pending: [], sharedWithMe: [], counts: {} };
    let activeFolder = null;
    let activeShare = null;
    let activeShareFolderID = 0;
    let shareReturnFocus = null;
    let heroFrame = 0;
    let heroResizeObserver = null;
    let heroLastFrameTime = 0;
    let profilePortalState = null;
    let profilePortalObserver = null;
    let activeConfirmResolver = null;
    let confirmReturnFocus = null;
    let inboxPollTimer = 0;
    let inboxPollBusy = false;
    let lastPendingIDs = new Set();

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

    function getOverlay() { return $("#mpCommunityCollectionOverlay"); }
    function getDialog() { return $("#mpCommunityCollectionDialog"); }
    function getShareLayer() { return $("#mpCollectionShareLayer"); }

    function escapeHTML(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function safeImageURL(value) {
        const candidate = String(value ?? "").trim();
        if (!candidate) return "";
        try {
            const parsed = new URL(candidate, window.location.origin);
            if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
            return parsed.href;
        } catch (_) {
            return "";
        }
    }

    async function requestJSON(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            cache: "no-store",
            ...options,
            headers: {
                Accept: "application/json",
                ...(options.body ? { "Content-Type": "application/json" } : {}),
                ...(options.headers || {})
            }
        });
        let payload = {};
        try { payload = await response.json(); } catch (_) { /* Empty or non-JSON response. */ }
        if (!response.ok) {
            const error = new Error(payload.error || `Request failed (${response.status})`);
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    function showStatus(message, isError = false) {
        const status = $("#mpCollectionHubStatus");
        if (!status) return;
        status.textContent = String(message || "");
        status.classList.toggle("is-error", Boolean(isError));
        status.classList.toggle("is-visible", Boolean(message));
        window.clearTimeout(statusTimer);
        if (message) {
            statusTimer = window.setTimeout(() => {
                status.classList.remove("is-visible", "is-error");
            }, 4300);
        }
    }

    function showGlobalToast(message, isError = false) {
        let toast = $("#mpDashboardFeatureToast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "mpDashboardFeatureToast";
            toast.className = "mp-dashboard-feature-toast mp-collection-feedback-toast";
            toast.setAttribute("role", "status");
            toast.setAttribute("aria-live", "polite");
            document.body.appendChild(toast);
        }
        ensureCollectionEnhancementStyles();
        toast.classList.add("mp-collection-feedback-toast");
        toast.textContent = String(message || "");
        toast.classList.toggle("is-error", Boolean(isError));
        toast.classList.toggle("is-visible", Boolean(message));
        toast.hidden = !message;
        window.clearTimeout(showGlobalToast.timer);
        if (message) {
            showGlobalToast.timer = window.setTimeout(() => {
                toast.hidden = true;
                toast.classList.remove("is-error", "is-visible");
            }, 4300);
        }
    }

    function ensureCollectionEnhancementStyles() {
        if (document.getElementById("mpCollectionEnhancementStyles")) return;
        const style = document.createElement("style");
        style.id = "mpCollectionEnhancementStyles";
        style.textContent = `
            /* Collection-only UI polish. These styles are injected once so the JS upgrade is self-contained. */
            #mpDashboardFeatureToast[hidden],
            #mpCollectionConfirmLayer[hidden],
            #mpCommunityModalLayer[hidden] { display: none !important; }

            #mpDashboardFeatureToast.mp-collection-feedback-toast {
                position: fixed !important;
                z-index: 2147483100 !important;
                top: max(16px, calc(env(safe-area-inset-top, 0px) + 10px)) !important;
                right: max(16px, calc(env(safe-area-inset-right, 0px) + 10px)) !important;
                bottom: auto !important;
                left: auto !important;
                display: flex;
                width: min(420px, calc(100vw - 28px));
                align-items: center;
                gap: 12px;
                padding: 14px 17px 14px 14px;
                overflow: hidden;
                border: 1px solid rgba(111, 231, 220, .32);
                border-radius: 16px;
                color: #e8fbff;
                background: linear-gradient(135deg, rgba(5, 24, 43, .97), rgba(5, 45, 53, .97));
                box-shadow: 0 22px 70px rgba(0, 0, 0, .46), 0 0 0 1px rgba(80, 210, 213, .05), 0 0 28px rgba(49, 201, 200, .13);
                font: 600 13px/1.55 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                letter-spacing: .005em;
                -webkit-backdrop-filter: blur(20px) saturate(125%);
                backdrop-filter: blur(20px) saturate(125%);
                animation: mpCollectionToastIn .28s cubic-bezier(.2,.8,.2,1) both;
            }
            #mpDashboardFeatureToast.mp-collection-feedback-toast::before {
                content: "✓";
                display: grid;
                width: 29px;
                height: 29px;
                flex: 0 0 29px;
                place-items: center;
                border: 1px solid rgba(120, 245, 209, .44);
                border-radius: 10px;
                color: #042e37;
                background: linear-gradient(140deg, #a5ffe8, #58d9da);
                box-shadow: 0 0 22px rgba(79, 227, 202, .18);
                font-size: 16px;
                font-weight: 900;
            }
            #mpDashboardFeatureToast.mp-collection-feedback-toast.is-error {
                border-color: rgba(255, 130, 151, .42);
                background: linear-gradient(135deg, rgba(36, 15, 31, .98), rgba(42, 26, 43, .98));
            }
            #mpDashboardFeatureToast.mp-collection-feedback-toast.is-error::before {
                content: "!";
                border-color: rgba(255, 153, 166, .5);
                color: #fff0f2;
                background: linear-gradient(140deg, #ff9cae, #c96b91);
            }

            #mpCollectionConfirmLayer {
                position: fixed;
                z-index: 2147483005;
                inset: 0;
                display: grid;
                place-items: center;
                padding: max(18px, env(safe-area-inset-top, 0px)) 18px max(18px, env(safe-area-inset-bottom, 0px));
                background: rgba(0, 6, 16, .78);
                -webkit-backdrop-filter: blur(17px) saturate(115%);
                backdrop-filter: blur(17px) saturate(115%);
                animation: mpCollectionConfirmFadeIn .18s ease both;
            }
            #mpCollectionConfirmDialog {
                position: relative;
                width: min(460px, 100%);
                padding: 25px;
                overflow: hidden;
                border: 1px solid rgba(125, 220, 232, .28);
                border-radius: 23px;
                color: #e8f7ff;
                background: radial-gradient(ellipse at 92% 0%, rgba(27, 133, 161, .19), transparent 42%), linear-gradient(145deg, rgba(5, 22, 41, .99), rgba(5, 32, 43, .99));
                box-shadow: 0 35px 105px rgba(0, 0, 0, .58), 0 0 0 1px rgba(255, 255, 255, .025), 0 0 38px rgba(55, 180, 197, .08);
                animation: mpCollectionConfirmRise .25s cubic-bezier(.17,.75,.23,1) both;
                outline: none;
            }
            #mpCollectionConfirmDialog::before {
                position: absolute;
                top: 0;
                right: 18%;
                left: 18%;
                height: 1px;
                content: "";
                background: linear-gradient(90deg, transparent, rgba(112, 239, 223, .72), rgba(104, 174, 255, .42), transparent);
                pointer-events: none;
            }
            #mpCollectionConfirmMark {
                display: grid;
                width: 50px;
                height: 50px;
                margin-bottom: 20px;
                place-items: center;
                border: 1px solid rgba(255, 128, 151, .29);
                border-radius: 16px;
                color: #ffb2c0;
                background: linear-gradient(145deg, rgba(163, 53, 86, .22), rgba(15, 93, 113, .17));
                box-shadow: inset 0 1px rgba(255,255,255,.05), 0 0 24px rgba(245, 85, 125, .07);
            }
            #mpCollectionConfirmMark svg { width: 24px; height: 24px; }
            #mpCollectionConfirmEyebrow {
                display: block;
                margin-bottom: 7px;
                color: #72dedb;
                font-size: 9px;
                font-weight: 850;
                letter-spacing: .19em;
                text-transform: uppercase;
            }
            #mpCollectionConfirmTitle {
                margin: 0;
                color: #f0fbff;
                font-size: clamp(22px, 4vw, 27px);
                font-weight: 780;
                letter-spacing: -.035em;
                line-height: 1.2;
            }
            #mpCollectionConfirmMessage {
                margin: 12px 0 23px;
                color: #9cb7c6;
                font-size: 12px;
                line-height: 1.8;
                overflow-wrap: anywhere;
            }
            #mpCollectionConfirmActions {
                display: flex;
                justify-content: flex-end;
                gap: 9px;
                flex-wrap: wrap;
            }
            #mpCollectionConfirmActions button {
                min-height: 42px;
                padding: 0 16px;
                border: 1px solid rgba(122, 193, 216, .2);
                border-radius: 12px;
                color: #c6dce6;
                background: rgba(17, 43, 61, .72);
                font: 750 11px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                cursor: pointer;
                transition: transform .18s ease, border-color .18s ease, background .18s ease, box-shadow .18s ease;
            }
            #mpCollectionConfirmActions button:hover { transform: translateY(-1px); border-color: rgba(104, 224, 220, .4); background: rgba(22, 67, 82, .8); }
            #mpCollectionConfirmActions .mp-collection-confirm-danger {
                border-color: rgba(255, 130, 151, .36);
                color: #fff3f5;
                background: linear-gradient(115deg, #963d5c, #77415f 58%, #21566b);
                box-shadow: 0 7px 20px rgba(113, 37, 74, .2), inset 0 1px rgba(255,255,255,.08);
            }
            #mpCollectionConfirmActions .mp-collection-confirm-danger:hover { border-color: rgba(255, 157, 175, .62); background: linear-gradient(115deg, #b34c6b, #854565 58%, #276d7b); box-shadow: 0 9px 25px rgba(125, 41, 76, .28); }
            #mpCollectionConfirmActions button:focus-visible { outline: 2px solid #77eadf; outline-offset: 3px; }

            #mpCommunityModalLayer.mp-collection-profile-portal {
                position: fixed !important;
                z-index: 2147482002 !important;
                inset: 0 !important;
                isolation: isolate;
            }
            #mpCommunityModalLayer.mp-collection-profile-portal [hidden] { display: none !important; }
            .mp-collection-folder-card-cover {
                background:
                    radial-gradient(ellipse at 80% 10%, var(--mp-folder-glow, rgba(81,207,232,.23)), transparent 52%),
                    linear-gradient(120deg, var(--mp-folder-start, rgba(7,43,75,.9)), var(--mp-folder-end, rgba(7,60,63,.75))) !important;
            }
            .mp-collection-share-avatar--photo { padding: 0 !important; overflow: hidden; }
            .mp-collection-share-avatar--photo img { display: block; width: 100%; height: 100%; border-radius: inherit; object-fit: cover; }

            @keyframes mpCollectionToastIn { from { opacity: 0; transform: translate3d(0,-9px,0) scale(.985); } to { opacity: 1; transform: translate3d(0,0,0) scale(1); } }
            @keyframes mpCollectionConfirmFadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes mpCollectionConfirmRise { from { opacity: 0; transform: translateY(13px) scale(.985); } to { opacity: 1; transform: translateY(0) scale(1); } }
            @media (max-width: 520px) {
                #mpCollectionConfirmDialog { padding: 21px 18px 18px; border-radius: 20px; }
                #mpCollectionConfirmActions { flex-direction: column-reverse; }
                #mpCollectionConfirmActions button { width: 100%; min-height: 44px; }
            }
            @media (prefers-reduced-motion: reduce) {
                #mpDashboardFeatureToast.mp-collection-feedback-toast,
                #mpCollectionConfirmLayer,
                #mpCollectionConfirmDialog { animation: none !important; transition: none !important; }
                #mpCollectionConfirmActions button { transition: none !important; }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function ensureConfirmDialog() {
        let layer = $("#mpCollectionConfirmLayer");
        if (layer) return layer;
        ensureCollectionEnhancementStyles();
        layer = document.createElement("div");
        layer.id = "mpCollectionConfirmLayer";
        layer.hidden = true;
        layer.innerHTML = `
            <section id="mpCollectionConfirmDialog" role="alertdialog" aria-modal="true" aria-labelledby="mpCollectionConfirmTitle" aria-describedby="mpCollectionConfirmMessage" tabindex="-1">
                <span id="mpCollectionConfirmMark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5M14 11v5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
                <span id="mpCollectionConfirmEyebrow">COLLECTION CONTROL</span>
                <h2 id="mpCollectionConfirmTitle">Delete this collection?</h2>
                <p id="mpCollectionConfirmMessage"></p>
                <div id="mpCollectionConfirmActions">
                    <button type="button" data-collection-confirm-choice="cancel">Keep collection</button>
                    <button class="mp-collection-confirm-danger" type="button" data-collection-confirm-choice="confirm">Delete collection</button>
                </div>
            </section>`;
        document.body.appendChild(layer);
        return layer;
    }

    function finishConfirmDialog(confirmed) {
        const layer = $("#mpCollectionConfirmLayer");
        if (layer) layer.hidden = true;
        document.body.classList.remove("mp-collection-confirm-open");
        const resolver = activeConfirmResolver;
        activeConfirmResolver = null;
        const returnFocus = confirmReturnFocus;
        confirmReturnFocus = null;
        if (returnFocus && document.contains(returnFocus) && typeof returnFocus.focus === "function" && returnFocus.getClientRects().length > 0) {
            returnFocus.focus({ preventScroll: true });
        }
        if (resolver) resolver(Boolean(confirmed));
    }

    function showConfirmDialog({ title, message, confirmText = "Delete collection", cancelText = "Keep collection", eyebrow = "COLLECTION CONTROL" } = {}) {
        if (activeConfirmResolver) return Promise.resolve(false);
        const layer = ensureConfirmDialog();
        const dialog = $("#mpCollectionConfirmDialog", layer);
        const titleEl = $("#mpCollectionConfirmTitle", layer);
        const messageEl = $("#mpCollectionConfirmMessage", layer);
        const eyebrowEl = $("#mpCollectionConfirmEyebrow", layer);
        const cancel = $('[data-collection-confirm-choice="cancel"]', layer);
        const confirm = $('[data-collection-confirm-choice="confirm"]', layer);
        if (titleEl) titleEl.textContent = String(title || "Are you sure?");
        if (messageEl) messageEl.textContent = String(message || "This action cannot be undone.");
        if (eyebrowEl) eyebrowEl.textContent = String(eyebrow || "COLLECTION CONTROL");
        if (cancel) cancel.textContent = String(cancelText || "Cancel");
        if (confirm) confirm.textContent = String(confirmText || "Confirm");
        confirmReturnFocus = document.activeElement;
        layer.hidden = false;
        document.body.classList.add("mp-collection-confirm-open");
        return new Promise((resolve) => {
            activeConfirmResolver = resolve;
            window.requestAnimationFrame(() => {
                if (layer.hidden) return;
                (cancel || dialog)?.focus({ preventScroll: true });
            });
        });
    }

    const FOLDER_GRADIENTS = [
        { start: "#164f9a", end: "#067c91", glow: "rgba(70,198,239,.27)" },
        { start: "#075d72", end: "#149a82", glow: "rgba(70,231,203,.25)" },
        { start: "#123d7c", end: "#1779a9", glow: "rgba(69,170,255,.27)" },
        { start: "#0b675d", end: "#148b72", glow: "rgba(82,230,180,.25)" },
        { start: "#0a4c74", end: "#1686a0", glow: "rgba(70,224,237,.25)" },
        { start: "#34418a", end: "#0c829a", glow: "rgba(140,159,255,.27)" },
        { start: "#13574c", end: "#127b8c", glow: "rgba(75,220,178,.25)" },
        { start: "#154c68", end: "#267b69", glow: "rgba(87,218,201,.25)" },
        { start: "#085a82", end: "#206baf", glow: "rgba(81,172,255,.27)" },
        { start: "#215a81", end: "#0a8c91", glow: "rgba(98,238,215,.25)" },
        { start: "#273d82", end: "#176b8e", glow: "rgba(98,151,255,.27)" },
        { start: "#096b75", end: "#36785a", glow: "rgba(88,237,182,.25)" },
        { start: "#0a4778", end: "#087e74", glow: "rgba(57,216,217,.25)" },
        { start: "#18507b", end: "#3b6d9c", glow: "rgba(119,194,244,.25)" },
        { start: "#1d4e65", end: "#117e87", glow: "rgba(68,229,226,.25)" },
        { start: "#0b5a5b", end: "#087d97", glow: "rgba(55,212,224,.25)" }
    ];

    function formatDate(value, includeTime = false) {
        if (!value) return "Timestamp unavailable";
        const raw = String(value).trim();
        // SQLite datetime('now') snapshots are UTC without a trailing Z. Treat
        // those explicitly as UTC before formatting them in the member's locale.
        const isBareSQLiteUTC = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw);
        const normalized = isBareSQLiteUTC ? raw.replace(" ", "T") + "Z" : raw;
        const parsed = new Date(normalized);
        if (Number.isNaN(parsed.getTime())) return "Timestamp unavailable";
        const date = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(parsed);
        if (!includeTime) return date;
        const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(parsed);
        return `${date} · ${time}`;
    }

    function getInitials(fullName, username = "") {
        const source = String(fullName || username || "MoviPilot Member").trim();
        const parts = source.split(/[\s._-]+/).filter(Boolean);
        if (!parts.length) return "MP";
        return parts.slice(0, 2).map((part) => Array.from(part)[0] || "").join("").toUpperCase() || "MP";
    }

    function avatarTone(value) {
        const text = String(value || "member");
        let hash = 2166136261;
        for (let index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return Math.abs(hash >>> 0) % 6;
    }

    function publicAvatarButton(user, extraClass = "") {
        const publicID = escapeHTML(user?.publicId || "");
        const name = String(user?.fullName || user?.username || "MoviPilot member");
        const initials = escapeHTML(getInitials(name, user?.username));
        const tone = avatarTone(user?.publicId || user?.username || name);
        const photo = safeImageURL(user?.avatarUrl || user?.avatarURL || user?.displayPhotoUrl || user?.displayPhotoURL || user?.profileImageUrl || user?.profilePictureUrl || user?.photoUrl || user?.photoURL || user?.imageUrl || "");
        const disabled = publicID ? "" : " disabled";
        const photoClass = photo ? " mp-collection-share-avatar--photo" : "";
        const content = photo
            ? `<img src="${escapeHTML(photo)}" alt="" aria-hidden="true" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
            : initials;
        return `<button class="mp-collection-share-avatar mp-collection-share-avatar--tone-${tone}${photoClass} ${extraClass}" type="button" data-collection-public-profile="${publicID}" aria-label="Open public profile of ${escapeHTML(name)}" title="Open ${escapeHTML(name)}'s public profile" data-avatar-fallback="${initials}"${disabled}>${content}</button>`;
    }

    function iconFolder() {
        return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4l2 2h6A2.5 2.5 0 0 1 20.5 9.5v8A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5v-10Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 12h8M8 15.5h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
    }

    function iconShare() {
        return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="18" cy="5" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="6" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="18" cy="19" r="3" stroke="currentColor" stroke-width="1.5"/><path d="m8.7 10.7 6.6-4.4M8.7 13.3l6.6 4.4" stroke="currentColor" stroke-width="1.5"/></svg>`;
    }

    function iconDelete() {
        return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5M14 11v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }

    function emptyState(title, copy, icon = "folder") {
        const iconMarkup = icon === "people"
            ? `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="17" cy="9" r="2.3" stroke="currentColor" stroke-width="1.5"/><path d="M2.8 19c.4-3.3 2.1-5 5.2-5s4.8 1.7 5.2 5M14.5 14.7c2.8-.2 4.4 1.2 4.9 3.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`
            : icon === "inbox"
                ? `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4.5h16l1 11.3a2 2 0 0 1-2 2.2H5a2 2 0 0 1-2-2.2L4 4.5Z" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 13.5h5l1.4 2h4.2l1.4-2h5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`
                : iconFolder();
        return `<div class="mp-collection-empty"><span class="mp-collection-empty-mark">${iconMarkup}</span><strong>${escapeHTML(title)}</strong><span>${escapeHTML(copy)}</span></div>`;
    }

    function updateCountUI() {
        const folders = cachedOverview.folders || [];
        const pending = cachedOverview.pending || [];
        const shared = cachedOverview.sharedWithMe || [];
        const counts = cachedOverview.counts || {};
        const totalTitles = Number(counts.ownedItems ?? folders.reduce((sum, folder) => sum + Number(folder.itemCount || 0), 0));
        const setText = (selector, value) => { const el = $(selector); if (el) el.textContent = String(value); };
        setText("#mpCollectionFolderCount", folders.length);
        setText("#mpCollectionPendingCountHero", pending.length);
        setText("#mpCollectionSharedCountHero", shared.length);
        setText("#mpCollectionMineBadge", folders.length);
        setText("#mpCollectionPendingBadge", pending.length);
        setText("#mpCollectionSharedBadge", shared.length);
        setText("#mpCollectionPendingHint", `${pending.length} awaiting a decision`);
        setText("#mpCollectionAcceptedHint", `${shared.length} accepted collection${shared.length === 1 ? "" : "s"}`);
        setText("#mpCollectionOwnedTitleCount", `${totalTitles} title${totalTitles === 1 ? "" : "s"} saved`);
        const badge = $("#mpCollectionPendingBadge");
        if (badge) badge.classList.toggle("has-pending", pending.length > 0);
        const sidebarBadge = $("#mpSidebarCollectionPendingBadge");
        if (sidebarBadge) {
            sidebarBadge.textContent = pending.length > 99 ? "99+" : String(pending.length);
            sidebarBadge.hidden = pending.length === 0;
            sidebarBadge.classList.toggle("has-pending", pending.length > 0);
            sidebarBadge.setAttribute("aria-label", `${pending.length} pending incoming collection${pending.length === 1 ? "" : "s"}`);
        }
    }

    function renderFolders() {
        const grid = $("#mpCollectionFolderGrid");
        if (!grid) return;
        const folders = cachedOverview.folders || [];
        if (!folders.length) {
            grid.innerHTML = emptyState("Your story library starts here.", "Create a folder above, then add movies and series to it from the Explore page. Everything you create there will appear here too.");
            return;
        }
        grid.innerHTML = folders.map((folder, index) => {
            const id = Number(folder.id || 0);
            const count = Number(folder.itemCount || 0);
            const gradient = FOLDER_GRADIENTS[index % FOLDER_GRADIENTS.length];
            const gradientStyle = `--mp-folder-start:${gradient.start};--mp-folder-end:${gradient.end};--mp-folder-glow:${gradient.glow};`;
            return `<article class="mp-collection-folder-card" data-folder-card="${id}" data-folder-gradient="${index % FOLDER_GRADIENTS.length}" style="${gradientStyle}">
                <div class="mp-collection-folder-card-cover"><span class="mp-collection-folder-glyph">${iconFolder()}</span><span class="mp-collection-folder-count">${count} ${count === 1 ? "title" : "titles"}</span></div>
                <div class="mp-collection-folder-card-body"><strong class="mp-collection-folder-card-title" title="${escapeHTML(folder.name)}">${escapeHTML(folder.name)}</strong><p class="mp-collection-folder-card-meta">Created ${escapeHTML(formatDate(folder.createdAt))} · Saved to your library</p>
                    <div class="mp-collection-folder-card-actions"><button class="mp-collection-folder-open" type="button" data-collection-action="open-folder" data-folder-id="${id}">Open folder <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><span class="mp-collection-folder-tools"><button class="mp-collection-icon-button" type="button" data-collection-action="share-folder" data-folder-id="${id}" aria-label="Share ${escapeHTML(folder.name)}" title="Share folder">${iconShare()}</button><button class="mp-collection-icon-button is-danger" type="button" data-collection-action="delete-folder" data-folder-id="${id}" aria-label="Delete ${escapeHTML(folder.name)}" title="Delete folder">${iconDelete()}</button></span></div>
                </div>
            </article>`;
        }).join("");
    }

    function renderMediaCards(items, options = {}) {
        const shared = options.shared === true;
        if (!Array.isArray(items) || !items.length) {
            return emptyState("No titles in this folder yet.", "When you add a movie or series to this collection from Explore, it will appear here with its saved timestamp.");
        }
        return items.map((item) => {
            const title = String(item.title || `${item.mediaTypeLabel || (item.mediaType === "tv" ? "TV Series" : "Movie")} #${item.mediaId || ""}`);
            const poster = safeImageURL(item.posterUrl);
            const typeLabel = String(item.mediaTypeLabel || (item.mediaType === "tv" ? "TV Series" : "Movie"));
            const itemID = Number(item.id || 0);
            const type = String(item.mediaType || "movie");
            const mediaID = Number(item.mediaId || 0);
            return `<article class="mp-collection-title-card">
                <div class="mp-collection-title-poster">${poster ? `<img src="${escapeHTML(poster)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : `<span class="mp-collection-title-poster-fallback">${iconFolder()}</span>`}<span class="mp-collection-title-type">${escapeHTML(typeLabel)}</span></div>
                <div class="mp-collection-title-card-body"><strong class="mp-collection-title-name" title="${escapeHTML(title)}">${escapeHTML(title)}</strong><div class="mp-collection-title-year">${escapeHTML(item.year || (item.voteAverage ? `★ ${Number(item.voteAverage).toFixed(1)}` : "Saved title"))}</div><div class="mp-collection-title-timestamp"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.5"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>Added ${escapeHTML(formatDate(item.addedAt, true))}</span></div>
                    ${shared ? "" : `<div class="mp-collection-title-actions"><button class="mp-collection-danger-button" type="button" data-collection-action="delete-item" data-item-id="${itemID}" data-media-type="${escapeHTML(type)}" data-media-id="${mediaID}" aria-label="Remove ${escapeHTML(title)} from this folder">${iconDelete()} Remove title</button></div>`}
                </div>
            </article>`;
        }).join("");
    }

    function renderShareCard(share, incoming) {
        const sender = share.sender || {};
        const senderName = String(sender.fullName || sender.username || "MoviPilot member");
        const username = sender.username ? `@${sender.username}` : "MoviPilot member";
        const count = Number(share.itemCount || 0);
        const message = String(share.message || "").trim();
        const profileButton = publicAvatarButton(sender);
        const profileID = escapeHTML(sender.publicId || "");
        const base = `<article class="mp-collection-share-card" data-share-card="${Number(share.id || 0)}">
            <div class="mp-collection-share-cover">${profileButton}<div class="mp-collection-share-sender"><strong>${escapeHTML(senderName)}</strong><small>${escapeHTML(username)} · ${escapeHTML(formatDate(share.createdAt, true))}</small></div></div>
            <div class="mp-collection-share-body"><strong class="mp-collection-share-folder-name">${escapeHTML(share.name || "Shared collection")}</strong>${message ? `<p class="mp-collection-share-message">“${escapeHTML(message)}”</p>` : ""}<div class="mp-collection-share-meta"><span>${count} ${count === 1 ? "title" : "titles"}</span><strong>${incoming ? "AWAITING RESPONSE" : "ACCEPTED"}</strong></div>`;
        if (incoming) {
            return `${base}<div class="mp-collection-share-card-actions"><button class="mp-collection-secondary-button mp-collection-decline-button" type="button" data-collection-action="decline-share" data-share-id="${Number(share.id || 0)}">Decline</button><button class="mp-collection-secondary-button mp-collection-accept-button" type="button" data-collection-action="accept-share" data-share-id="${Number(share.id || 0)}">Accept collection</button></div></div></article>`;
        }
        return `${base}<button class="mp-collection-secondary-button mp-collection-share-view-button" type="button" data-collection-action="open-shared" data-share-id="${Number(share.id || 0)}" data-share-name="${escapeHTML(share.name || "Shared collection")}" data-share-from="${escapeHTML(senderName)}" data-share-public-id="${profileID}">View collection <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></article>`;
    }

    function renderPending() {
        const grid = $("#mpCollectionPendingGrid");
        if (!grid) return;
        const items = cachedOverview.pending || [];
        grid.innerHTML = items.length
            ? items.map((share) => renderShareCard(share, true)).join("")
            : emptyState("Your inbox is clear.", "When a marked friend sends you a collection, it will arrive here first. You can accept it to keep it under Shared with me, or decline it.", "inbox");
    }

    function renderShared() {
        const grid = $("#mpCollectionSharedGrid");
        if (!grid) return;
        const items = cachedOverview.sharedWithMe || [];
        grid.innerHTML = items.length
            ? items.map((share) => renderShareCard(share, false)).join("")
            : emptyState("Shared stories will live here.", "Accept a collection from Pending incoming to keep a read-only snapshot here, with the sender and original timestamps attached.", "people");
    }

    function setActiveTab(tab) {
        const safeTab = ["mine", "pending", "shared"].includes(tab) ? tab : "mine";
        $$('[data-collection-tab]').forEach((button) => {
            const active = button.dataset.collectionTab === safeTab;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-selected", String(active));
            button.tabIndex = active ? 0 : -1;
        });
        $$('[data-collection-panel]').forEach((panel) => {
            panel.hidden = panel.dataset.collectionPanel !== safeTab;
        });
        if (safeTab !== "shared") {
            const sharedDetail = $("#mpCollectionSharedDetail");
            if (sharedDetail) sharedDetail.hidden = true;
            const sharedGrid = $("#mpCollectionSharedGrid");
            if (sharedGrid) sharedGrid.hidden = false;
        }
    }

    async function loadOverview({ preserveTab = true } = {}) {
        const activeTab = $("[data-collection-tab].is-active")?.dataset.collectionTab || "mine";
        const grid = $("#mpCollectionFolderGrid");
        if (grid && !activeFolder) grid.innerHTML = `<div class="mp-collection-loading"><span class="mp-collection-spinner"></span><span>Refreshing your collection library…</span></div>`;
        try {
            const payload = await requestJSON(API);
            cachedOverview = {
                folders: Array.isArray(payload.folders) ? payload.folders : [],
                pending: Array.isArray(payload.pending) ? payload.pending : [],
                sharedWithMe: Array.isArray(payload.sharedWithMe) ? payload.sharedWithMe : [],
                counts: payload.counts || {}
            };
            updateCountUI();
            lastPendingIDs = new Set(cachedOverview.pending.map((share) => String(share.id)));
            renderFolders();
            renderPending();
            renderShared();
            if (preserveTab) setActiveTab(activeTab);
            if (activeFolder) {
                const fresh = cachedOverview.folders.find((folder) => Number(folder.id) === Number(activeFolder.id));
                if (fresh) {
                    activeFolder = fresh;
                    await loadFolderItems(fresh, { showLoading: false });
                } else {
                    showFolderGrid();
                }
            }
            return true;
        } catch (error) {
            const message = error.status === 401
                ? "Please sign in to use My Collection. Your folders and shares are protected by your MoviPilot account."
                : (error.message || "Could not load your collection library.");
            showStatus(message, true);
            if (grid) grid.innerHTML = emptyState("Your library could not load.", message, "inbox");
            return false;
        }
    }

    function showFolderGrid() {
        activeFolder = null;
        const grid = $("#mpCollectionFolderGrid");
        const form = $("#mpCollectionCreateForm");
        const detail = $("#mpCollectionFolderDetail");
        if (grid) grid.hidden = false;
        if (form) form.hidden = false;
        if (detail) detail.hidden = true;
        renderFolders();
    }

    async function loadFolderItems(folder, { showLoading = true } = {}) {
        const detail = $("#mpCollectionFolderDetail");
        const grid = $("#mpCollectionDetailItems");
        const folderGrid = $("#mpCollectionFolderGrid");
        const createForm = $("#mpCollectionCreateForm");
        if (!detail || !grid || !folder) return;
        activeFolder = folder;
        if (folderGrid) folderGrid.hidden = true;
        if (createForm) createForm.hidden = true;
        detail.hidden = false;
        $("#mpCollectionDetailTitle").textContent = folder.name || "Collection folder";
        $("#mpCollectionDetailMeta").textContent = `Created ${formatDate(folder.createdAt)} · ${Number(folder.itemCount || 0)} ${Number(folder.itemCount || 0) === 1 ? "title" : "titles"}`;
        const shareButton = $("#mpCollectionDetailShare");
        const deleteButton = $("#mpCollectionDetailDelete");
        if (shareButton) shareButton.dataset.folderId = String(folder.id);
        if (deleteButton) deleteButton.dataset.folderId = String(folder.id);
        if (showLoading) grid.innerHTML = `<div class="mp-collection-loading"><span class="mp-collection-spinner"></span><span>Opening ${escapeHTML(folder.name)}…</span></div>`;
        try {
            const payload = await requestJSON(`${API}/folder?id=${encodeURIComponent(folder.id)}`);
            const items = Array.isArray(payload.items) ? payload.items : [];
            grid.innerHTML = renderMediaCards(items);
            folder.itemCount = items.length;
            const meta = $("#mpCollectionDetailMeta");
            if (meta) meta.textContent = `Created ${formatDate(folder.createdAt)} · ${items.length} ${items.length === 1 ? "title" : "titles"}`;
        } catch (error) {
            grid.innerHTML = emptyState("Could not open this folder.", error.message || "Refresh your collection and try again.", "inbox");
        }
    }

    async function createFolder(event) {
        event.preventDefault();
        const input = $("#mpCollectionCreateName");
        const form = $("#mpCollectionCreateForm");
        const button = form?.querySelector("button[type='submit']");
        const name = String(input?.value || "").trim();
        if (!name) {
            showStatus("Enter a folder name first.", true);
            input?.focus();
            return;
        }
        if (button) button.disabled = true;
        try {
            const payload = await requestJSON(API, { method: "POST", body: JSON.stringify({ name }) });
            if (!payload.folder?.id) throw new Error("The folder was not created. Please try again.");
            if (input) input.value = "";
            showStatus(`“${payload.folder.name || name}” is ready. Add titles from Explore or open this folder now.`);
            await loadOverview({ preserveTab: true });
            const folder = cachedOverview.folders.find((item) => Number(item.id) === Number(payload.folder.id));
            if (folder) await loadFolderItems(folder);
        } catch (error) {
            showStatus(error.message || "Could not create this folder.", true);
        } finally {
            if (button) button.disabled = false;
        }
    }

    async function deleteFolder(folderID) {
        const folder = cachedOverview.folders.find((item) => Number(item.id) === Number(folderID));
        if (!folder) return;
        const confirmed = await showConfirmDialog({
            eyebrow: "REMOVE FROM YOUR LIBRARY",
            title: `Delete “${folder.name}”?`,
            message: "This removes the collection folder and its saved titles from your library. Collections you already sent to other members remain available to them as snapshots. This action cannot be undone.",
            confirmText: "Delete collection",
            cancelText: "Keep collection"
        });
        if (!confirmed) return;
        try {
            await requestJSON(`${API}/folder?id=${encodeURIComponent(folderID)}`, { method: "DELETE" });
            if (Number(activeFolder?.id) === Number(folderID)) showFolderGrid();
            showStatus(`“${folder.name}” was deleted.`);
            await loadOverview({ preserveTab: true });
        } catch (error) {
            showStatus(error.message || "Could not delete this folder.", true);
        }
    }

    async function deleteItem(itemID) {
        const card = $(`[data-collection-action="delete-item"][data-item-id="${CSS.escape(String(itemID))}"]`);
        const title = card?.closest(".mp-collection-title-card")?.querySelector(".mp-collection-title-name")?.textContent || "this title";
        const confirmed = await showConfirmDialog({
            eyebrow: "EDIT YOUR COLLECTION",
            title: `Remove “${title}”?`,
            message: "This title will be removed from the current collection folder. Your other folders and the original movie or series page will not be affected.",
            confirmText: "Remove title",
            cancelText: "Keep title"
        });
        if (!confirmed) return;
        try {
            const query = `${API}/item?id=${encodeURIComponent(itemID)}`;
            await requestJSON(query, { method: "DELETE" });
            showStatus(`“${title}” was removed from the folder.`);
            if (activeFolder) await loadFolderItems(activeFolder);
            await loadOverview({ preserveTab: true });
        } catch (error) {
            showStatus(error.message || "Could not remove this title.", true);
        }
    }

    async function openShareDialog(folderID, trigger = null) {
        const folder = cachedOverview.folders.find((item) => Number(item.id) === Number(folderID));
        if (!folder) return;
        activeShareFolderID = Number(folder.id);
        shareReturnFocus = trigger || document.activeElement;
        const layer = getShareLayer();
        if (!layer) return;
        $("#mpCollectionShareFolderName").textContent = folder.name || "Collection folder";
        $("#mpCollectionShareMessage").value = "";
        $("#mpCollectionShareMessageCount").textContent = "0";
        const send = $("#mpCollectionShareSend");
        if (send) send.disabled = true;
        layer.hidden = false;
        layer.setAttribute("aria-hidden", "false");
        const shareDialog = $(".mp-collection-share-dialog", layer);
        shareDialog?.querySelector("#mpCollectionShareClose")?.focus({ preventScroll: true });
        const friendsList = $("#mpCollectionShareFriends");
        if (friendsList) friendsList.innerHTML = `<div class="mp-collection-loading"><span class="mp-collection-spinner"></span><span>Finding your marked friends…</span></div>`;
        try {
            const payload = await requestJSON(`${API}/friends`);
            const friends = Array.isArray(payload.friends) ? payload.friends : [];
            const count = $("#mpCollectionShareFriendCount");
            if (count) count.textContent = `${friends.length} available`;
            if (!friends.length) {
                if (friendsList) friendsList.innerHTML = emptyState("No marked friends yet.", "Visit a member's public profile in Community and mark them as a friend before sharing a collection.", "people");
                return;
            }
            if (friendsList) {
                friendsList.innerHTML = friends.map((friend, index) => {
                    const publicID = escapeHTML(friend.publicId || "");
                    const name = String(friend.fullName || friend.username || "MoviPilot member");
                    const id = `mpCollectionFriendChoice${index}`;
                    return `<div class="mp-collection-share-friend-row"><input type="checkbox" id="${id}" name="collectionRecipients" value="${publicID}" aria-label="Share with ${escapeHTML(name)}">${publicAvatarButton(friend)}<label class="mp-collection-share-friend-name" for="${id}"><span>${escapeHTML(name)}</span><small>${escapeHTML(friend.username ? `@${friend.username}` : friend.publicId || "MoviPilot member")}</small></label></div>`;
                }).join("");
            }
        } catch (error) {
            if (friendsList) friendsList.innerHTML = emptyState("Could not load marked friends.", error.message || "Refresh the list and try again.", "inbox");
        }
        updateShareSendState();
    }

    function updateShareSendState() {
        const send = $("#mpCollectionShareSend");
        if (!send) return;
        const selected = $$("#mpCollectionShareFriends input[type='checkbox']:checked").length;
        const available = $$("#mpCollectionShareFriends input[type='checkbox']").length;
        const count = $("#mpCollectionShareFriendCount");
        if (count && available) {
            count.textContent = selected > 50
                ? `${selected} selected · maximum 50`
                : `${available} available · ${selected} selected`;
        }
        send.disabled = selected === 0 || selected > 50;
    }

    function closeShareDialog() {
        const layer = getShareLayer();
        if (layer) {
            layer.hidden = true;
            layer.setAttribute("aria-hidden", "true");
        }
        const trigger = shareReturnFocus;
        shareReturnFocus = null;
        activeShareFolderID = 0;
        if (hubOpen && trigger && document.contains(trigger) && trigger.getClientRects().length > 0 && typeof trigger.focus === "function") {
            closeHubFocusTo(trigger);
        } else if (hubOpen) {
            const fallback = $("#mpCollectionDetailShare");
            if (fallback && fallback.getClientRects().length > 0) closeHubFocusTo(fallback);
        }
    }

    async function sendCollectionShare() {
        const recipients = $$("#mpCollectionShareFriends input[type='checkbox']:checked").map((input) => input.value).filter(Boolean);
        const message = String($("#mpCollectionShareMessage")?.value || "").trim();
        const send = $("#mpCollectionShareSend");
        if (!recipients.length || !activeShareFolderID) {
            showStatus("Choose at least one marked friend first.", true);
            return;
        }
        if (send) send.disabled = true;
        try {
            const payload = await requestJSON(`${API}/share`, {
                method: "POST",
                body: JSON.stringify({ collectionId: activeShareFolderID, recipientPublicIDs: recipients, message })
            });
            closeShareDialog();
            const sentCount = Number(payload.sent ?? recipients.length);
            showGlobalToast(`Collection sent successfully to ${sentCount} ${sentCount === 1 ? "friend" : "friends"}. Their pending inbox is ready for them to review it.`);
            await loadOverview({ preserveTab: true });
        } catch (error) {
            showStatus(error.message || "Could not share this collection.", true);
        } finally {
            updateShareSendState();
        }
    }

    async function respondToShare(shareID, action, button) {
        if (button) button.disabled = true;
        try {
            await requestJSON(`${API}/respond`, { method: "POST", body: JSON.stringify({ shareId: Number(shareID), action }) });
            showStatus(action === "accept" ? "Collection accepted. It is now saved under Shared with me." : "Collection declined. It has been removed from your pending inbox.");
            await loadOverview({ preserveTab: false });
            if (action === "accept") setActiveTab("shared");
            else setActiveTab("pending");
        } catch (error) {
            showStatus(error.message || `Could not ${action} this collection.`, true);
            if (button) button.disabled = false;
        }
    }

    async function openSharedCollection(shareID, shareName, fromName, publicID) {
        activeShare = { id: Number(shareID), name: String(shareName || "Shared collection"), from: String(fromName || "a MoviPilot friend"), publicId: String(publicID || "") };
        const detail = $("#mpCollectionSharedDetail");
        const grid = $("#mpCollectionSharedDetailItems");
        const sharedGrid = $("#mpCollectionSharedGrid");
        if (!detail || !grid) return;
        if (sharedGrid) sharedGrid.hidden = true;
        detail.hidden = false;
        $("#mpCollectionSharedDetailTitle").textContent = activeShare.name;
        $("#mpCollectionSharedDetailMeta").textContent = `Shared by ${activeShare.from} · read-only snapshot`;
        grid.innerHTML = `<div class="mp-collection-loading"><span class="mp-collection-spinner"></span><span>Opening shared collection…</span></div>`;
        try {
            const payload = await requestJSON(`${API}/shared-items?id=${encodeURIComponent(activeShare.id)}`);
            grid.innerHTML = renderMediaCards(Array.isArray(payload.items) ? payload.items : [], { shared: true });
            $("#mpCollectionSharedDetailMeta").textContent = `Shared by ${activeShare.from} · ${Number(payload.count || 0)} ${Number(payload.count || 0) === 1 ? "title" : "titles"} · snapshot saved ${formatDate(cachedOverview.sharedWithMe.find((share) => Number(share.id) === activeShare.id)?.createdAt)}`;
        } catch (error) {
            grid.innerHTML = emptyState("Could not open this shared collection.", error.message || "Refresh Shared with me and try again.", "inbox");
        }
    }

    function closeSharedDetail() {
        const detail = $("#mpCollectionSharedDetail");
        const grid = $("#mpCollectionSharedGrid");
        if (detail) detail.hidden = true;
        if (grid) grid.hidden = false;
        activeShare = null;
    }

    function closeHubFocusTo(element) {
        if (element && typeof element.focus === "function") element.focus({ preventScroll: true });
    }

    function focusTrap(dialog, event) {
        if (event.key !== "Tab") return;
        const focusables = $$('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])', dialog)
            .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true" && element.getClientRects().length > 0);
        if (!focusables.length) {
            event.preventDefault();
            dialog.focus({ preventScroll: true });
            return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
            event.preventDefault();
            last.focus({ preventScroll: true });
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus({ preventScroll: true });
        }
    }

    async function refreshIncomingBadge() {
        if (document.hidden || inboxPollBusy || !$("#mpCommunityCollectionOverlay")) return;
        inboxPollBusy = true;
        try {
            const payload = await requestJSON(API);
            const latest = Array.isArray(payload.pending) ? payload.pending : [];
            const latestIDs = new Set(latest.map((share) => String(share.id)));
            const newItems = latest.filter((share) => !lastPendingIDs.has(String(share.id)));
            const previousSignature = Array.from(lastPendingIDs).sort().join(",");
            const nextSignature = Array.from(latestIDs).sort().join(",");
            cachedOverview.pending = latest;
            cachedOverview.counts = { ...(cachedOverview.counts || {}), pending: latest.length };
            updateCountUI();
            if (previousSignature !== nextSignature) {
                lastPendingIDs = latestIDs;
                if (hubOpen) renderPending();
                if (newItems.length) {
                    const first = newItems[0];
                    const sender = first.sender?.fullName || first.sender?.username || "A MoviPilot friend";
                    const notice = `${newItems.length === 1 ? `${sender} sent you a collection` : `${newItems.length} new collections arrived`}. Open Pending incoming to review ${newItems.length === 1 ? "it" : "them"}.`;
                    if (hubOpen) showStatus(notice);
                    else showGlobalToast(notice);
                }
            }
        } catch (_) {
            // Quiet polling must not interrupt navigation or expose request errors.
        } finally {
            inboxPollBusy = false;
        }
    }

    function ensureIncomingPolling() {
        if (inboxPollTimer || !$("#mpCommunityCollectionOverlay")) return;
        void refreshIncomingBadge();
        inboxPollTimer = window.setInterval(() => {
            if (!document.hidden) void refreshIncomingBadge();
        }, 20000);
    }

    function openHub() {
        const overlay = getOverlay();
        const dialog = getDialog();
        if (!overlay || !dialog) {
            showGlobalToast("My Collection is not mounted in dashboard.html. Add the persistent Collection modal block from the integration package.", true);
            return;
        }
        if (hubOpen) return;
        hubOpen = true;
        openingFocus = document.activeElement;
        originalBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        document.body.classList.add("mp-collection-hub-open");
        overlay.hidden = false;
        overlay.setAttribute("aria-hidden", "false");
        if (!dialog.dataset.focusTrapBound) {
            dialog.addEventListener("keydown", (event) => focusTrap(dialog, event));
            dialog.dataset.focusTrapBound = "true";
        }
        if (!dialog.dataset.tabKeyboardBound) {
            dialog.addEventListener("keydown", (event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                const tabs = $$('[data-collection-tab]', dialog);
                const index = tabs.indexOf(document.activeElement);
                if (index < 0) return;
                event.preventDefault();
                const next = (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                tabs[next].focus();
                setActiveTab(tabs[next].dataset.collectionTab);
            });
            dialog.dataset.tabKeyboardBound = "true";
        }
        setActiveTab("mine");
        showFolderGrid();
        closeSharedDetail();
        const closeButton = $("#mpCommunityCollectionClose");
        closeButton?.focus({ preventScroll: true });
        startHeroCanvas();
        void loadOverview({ preserveTab: false });
    }

    function closeHub() {
        const overlay = getOverlay();
        if (!overlay || !hubOpen) return;
        const shareLayer = getShareLayer();
        if (shareLayer) {
            shareLayer.hidden = true;
            shareLayer.setAttribute("aria-hidden", "true");
        }
        shareReturnFocus = null;
        stopHeroCanvas();
        overlay.hidden = true;
        overlay.setAttribute("aria-hidden", "true");
        document.body.classList.remove("mp-collection-hub-open");
        document.body.style.overflow = originalBodyOverflow;
        hubOpen = false;
        activeFolder = null;
        activeShare = null;
        activeShareFolderID = 0;
        if (openingFocus && document.contains(openingFocus) && typeof openingFocus.focus === "function") openingFocus.focus({ preventScroll: true });
        openingFocus = null;

                /* Clear the sidebar selection after closing My Collection. */

        window.dispatchEvent(
            new CustomEvent(
                "movipilotSidebarModalClosed",
                {
                    detail: {
                        source: "collection"
                    }
                }
            )
        );
    }



    function communityRuntimeReady() {
        const root = $("#mpCommunityPage");
        return Boolean(
            root && root.isConnected &&
            typeof window.openMoviPilotCommunityMemberProfile === "function" &&
            typeof window.openMoviPilotCommunityChat === "function"
        );
    }

    function waitForCommunityRuntime(timeoutMs = 15000) {
        return new Promise((resolve, reject) => {
            let finished = false;
            let observer = null;
            let pollTimer = 0;
            let timeoutTimer = 0;
            const cleanup = () => {
                if (observer) observer.disconnect();
                if (pollTimer) window.clearInterval(pollTimer);
                if (timeoutTimer) window.clearTimeout(timeoutTimer);
                window.removeEventListener("movipilotCommunityPageReady", check);
            };
            const finish = (error, root) => {
                if (finished) return;
                finished = true;
                cleanup();
                if (error) reject(error); else resolve(root);
            };
            const check = () => {
                if (communityRuntimeReady()) finish(null, $("#mpCommunityPage"));
            };
            window.addEventListener("movipilotCommunityPageReady", check);
            if (typeof MutationObserver === "function") {
                observer = new MutationObserver(check);
                observer.observe(document.documentElement, { childList: true, subtree: true });
            }
            pollTimer = window.setInterval(check, 80);
            timeoutTimer = window.setTimeout(() => {
                finish(new Error("Community did not finish loading. Check that dashboard.js routes data-page=community to /community and calls window.initCommunityPage()."));
            }, timeoutMs);
            check();
        });
    }

    async function ensureCommunityRuntime() {
        if (communityRuntimeReady()) return $("#mpCommunityPage");
        const navButton = $('.nav-link[data-page="community"]');
        if (!navButton) throw new Error("The Community navigation button is missing from dashboard.html.");

        const ready = waitForCommunityRuntime();
        const root = $("#mpCommunityPage");
        try {
            if (root && typeof window.initCommunityPage === "function") {
                // This covers a Community fragment that exists but has not yet been initialized.
                window.initCommunityPage();
            } else {
                navButton.click();
            }
        } catch (error) {
            // If initialization throws synchronously, avoid leaving the readiness timeout unhandled.
            ready.catch(() => {});
            throw error;
        }
        return await ready;
    }

    async function openCommunityChatFromSidebar() {
        showGlobalToast("Opening the Community Chatroom…");
        try {
            await ensureCommunityRuntime();
            if (typeof window.openMoviPilotCommunityChat !== "function") {
                throw new Error("The Community chat bridge is missing. Apply the supplied community.js integration patch.");
            }
            await window.openMoviPilotCommunityChat();
            showGlobalToast("Community Chatroom opened.");
        } catch (error) {
            console.error("[MOVIPILOT SIDEBAR CHATROOM]", error);
            showGlobalToast(error.message || "Could not open the Community Chatroom.", true);
        }
    }

    function restoreProfileLayerPortal(layer = null) {
        const state = profilePortalState;
        if (!state || (layer && state.layer !== layer)) return;
        if (profilePortalObserver) {
            profilePortalObserver.disconnect();
            profilePortalObserver = null;
        }
        const portalLayer = state.layer;
        portalLayer.classList.remove("mp-collection-profile-portal");
        portalLayer.style.zIndex = state.zIndex;
        portalLayer.style.position = state.position;
        portalLayer.style.inset = state.inset;
        if (state.parent && state.parent.isConnected) {
            if (state.nextSibling && state.nextSibling.parentNode === state.parent) {
                state.parent.insertBefore(portalLayer, state.nextSibling);
            } else {
                state.parent.appendChild(portalLayer);
            }
        } else {
            // The Community fragment was navigated away from while the profile was open.
            // Do not leave an orphaned modal with a duplicate ID in the persistent shell.
            portalLayer.remove();
        }
        profilePortalState = null;
    }

    function portalProfileLayerAboveCollection(profileLayer) {
        if (!profileLayer) return;
        if (profilePortalState && profilePortalState.layer === profileLayer && profileLayer.parentNode === document.body) {
            profileLayer.style.zIndex = "2147482002";
            return;
        }
        if (profilePortalState) restoreProfileLayerPortal(profilePortalState.layer);
        const parent = profileLayer.parentNode;
        if (!parent) return;
        profilePortalState = {
            layer: profileLayer,
            parent,
            nextSibling: profileLayer.nextSibling,
            zIndex: profileLayer.style.zIndex,
            position: profileLayer.style.position,
            inset: profileLayer.style.inset
        };
        profileLayer.classList.add("mp-collection-profile-portal");
        profileLayer.style.position = "fixed";
        profileLayer.style.inset = "0";
        profileLayer.style.zIndex = "2147482002";
        document.body.appendChild(profileLayer);
        if (typeof MutationObserver === "function") {
            profilePortalObserver = new MutationObserver(() => {
                if (profileLayer.hidden || profileLayer.getAttribute("aria-hidden") === "true") {
                    restoreProfileLayerPortal(profileLayer);
                }
            });
            profilePortalObserver.observe(profileLayer, { attributes: true, attributeFilter: ["hidden", "aria-hidden"] });
        }
    }

    async function openPublicProfile(publicID) {
        if (!publicID) return;
        try {
            await ensureCommunityRuntime();
            const opener = window.openMoviPilotCommunityMemberProfile;
            if (typeof opener !== "function") throw new Error("The Community public profile is not available right now.");
            const profileLayer = $("#mpCommunityModalLayer");
            if (hubOpen && profileLayer) {
                // The Community page uses isolation:isolate, so its modal cannot
                // out-rank the persistent collection overlay from inside that
                // stacking context. Portal the profile layer to body temporarily.
                portalProfileLayerAboveCollection(profileLayer);
            }
            opener(publicID);
        } catch (error) {
            showGlobalToast(error.message || "Could not open that public profile.", true);
        }
    }

    function startHeroCanvas() {
        const canvas = $("#mpCollectionHeroCanvas");
        if (!canvas) return;
        stopHeroCanvas();
        const context = canvas.getContext("2d", { alpha: true });
        if (!context) return;
        const hero = canvas.parentElement;
        const size = () => {
            const bounds = hero.getBoundingClientRect();
            const ratio = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.max(1, Math.round(bounds.width * ratio));
            canvas.height = Math.max(1, Math.round(bounds.height * ratio));
            canvas.style.width = `${bounds.width}px`;
            canvas.style.height = `${bounds.height}px`;
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
        };
        size();
        if (typeof ResizeObserver === "function") {
            heroResizeObserver = new ResizeObserver(size);
            heroResizeObserver.observe(hero);
        } else {
            window.addEventListener("resize", size, { passive: true });
        }
        const bounds = () => ({ width: hero.clientWidth, height: hero.clientHeight });
        const draw = (timestamp) => {
            if (!hubOpen || !document.contains(canvas)) return;
            const dims = bounds();
            const width = dims.width;
            const height = dims.height;
            if (!width || !height) {
                heroFrame = window.requestAnimationFrame(draw);
                return;
            }
            if (reducedMotion && heroLastFrameTime > 0) return;
            if (timestamp - heroLastFrameTime < (reducedMotion ? 1000 : 34)) {
                heroFrame = window.requestAnimationFrame(draw);
                return;
            }
            heroLastFrameTime = timestamp;
            context.clearRect(0, 0, width, height);
            const time = reducedMotion ? 0.55 : timestamp * 0.00012;
            const waves = [
                { color: "rgba(74, 198, 244, .26)", base: .35, amp: 26, phase: .4, freq: .008, width: 1.3 },
                { color: "rgba(92, 240, 205, .22)", base: .56, amp: 21, phase: 2.2, freq: .0068, width: 1.1 },
                { color: "rgba(127, 165, 255, .18)", base: .7, amp: 15, phase: 4.1, freq: .0102, width: 1.05 }
            ];
            for (const wave of waves) {
                context.beginPath();
                for (let x = -4; x <= width + 4; x += 5) {
                    const y = height * wave.base + Math.sin(x * wave.freq + time + wave.phase) * wave.amp + Math.sin(x * wave.freq * .43 - time * 1.7 + wave.phase) * wave.amp * .35;
                    if (x === -4) context.moveTo(x, y); else context.lineTo(x, y);
                }
                const gradient = context.createLinearGradient(0, 0, width, height);
                gradient.addColorStop(0, "rgba(59, 166, 236, 0)");
                gradient.addColorStop(.28, wave.color);
                gradient.addColorStop(.75, wave.color);
                gradient.addColorStop(1, "rgba(101, 236, 203, 0)");
                context.strokeStyle = gradient;
                context.lineWidth = wave.width;
                context.shadowColor = wave.color;
                context.shadowBlur = reducedMotion ? 0 : 8;
                context.stroke();
            }
            context.shadowBlur = 0;
            const bloom = context.createRadialGradient(width * (.74 + Math.sin(time) * .025), height * .25, 5, width * .74, height * .25, width * .28);
            bloom.addColorStop(0, "rgba(63, 192, 213, .07)");
            bloom.addColorStop(1, "rgba(63, 192, 213, 0)");
            context.fillStyle = bloom;
            context.fillRect(0, 0, width, height);
            if (!reducedMotion) heroFrame = window.requestAnimationFrame(draw);
        };
        heroLastFrameTime = 0;
        heroFrame = window.requestAnimationFrame(draw);
    }

    function stopHeroCanvas() {
        if (heroFrame) window.cancelAnimationFrame(heroFrame);
        heroFrame = 0;
        heroLastFrameTime = 0;
        if (heroResizeObserver) heroResizeObserver.disconnect();
        heroResizeObserver = null;
    }

    function bindUIOnce() {
        ensureCollectionEnhancementStyles();
        // All Collection modal markup is in the persistent dashboard shell.
        // Do not gate binding on #mpCommunityPage, which is a dynamic fragment.
        ensureIncomingPolling();
        const createForm = $("#mpCollectionCreateForm");
        if (createForm && !createForm.dataset.bound) {
            createForm.addEventListener("submit", createFolder);
            createForm.dataset.bound = "true";
        }
        const createInput = $("#mpCollectionCreateName");
        if (createInput && !createInput.dataset.bound) {
            createInput.addEventListener("input", () => {
                createInput.setCustomValidity("");
            });
            createInput.dataset.bound = "true";
        }
        const message = $("#mpCollectionShareMessage");
        if (message && !message.dataset.bound) {
            message.addEventListener("input", () => {
                const count = $("#mpCollectionShareMessageCount");
                if (count) count.textContent = String(Array.from(message.value).length);
            });
            message.dataset.bound = "true";
        }
        const friends = $("#mpCollectionShareFriends");
        if (friends && !friends.dataset.bound) {
            friends.addEventListener("change", updateShareSendState);
            friends.dataset.bound = "true";
        }
        const closeShare = $("#mpCollectionShareClose");
        if (closeShare && !closeShare.dataset.bound) {
            closeShare.addEventListener("click", closeShareDialog);
            closeShare.dataset.bound = "true";
        }
        const cancelShare = $("#mpCollectionShareCancel");
        if (cancelShare && !cancelShare.dataset.bound) {
            cancelShare.addEventListener("click", closeShareDialog);
            cancelShare.dataset.bound = "true";
        }
        const sendShare = $("#mpCollectionShareSend");
        if (sendShare && !sendShare.dataset.bound) {
            sendShare.addEventListener("click", sendCollectionShare);
            sendShare.dataset.bound = "true";
        }
        const backFolders = $("#mpCollectionBackToFolders");
        if (backFolders && !backFolders.dataset.bound) {
            backFolders.addEventListener("click", showFolderGrid);
            backFolders.dataset.bound = "true";
        }
        const detailShare = $("#mpCollectionDetailShare");
        if (detailShare && !detailShare.dataset.bound) {
            detailShare.addEventListener("click", () => openShareDialog(detailShare.dataset.folderId, detailShare));
            detailShare.dataset.bound = "true";
        }
        const detailDelete = $("#mpCollectionDetailDelete");
        if (detailDelete && !detailDelete.dataset.bound) {
            detailDelete.addEventListener("click", () => deleteFolder(detailDelete.dataset.folderId));
            detailDelete.dataset.bound = "true";
        }
        const backShared = $("#mpCollectionBackToShared");
        if (backShared && !backShared.dataset.bound) {
            backShared.addEventListener("click", closeSharedDetail);
            backShared.dataset.bound = "true";
        }
    }

    window.addEventListener("movipilotSidebarAction", (event) => {
        const action = String(event.detail?.action || "");
        if (action === "collections") {
            bindUIOnce();
            openHub();
            return;
        }
        if (action === "chatroom") {
            void openCommunityChatFromSidebar();
        }
    });

    document.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const confirmChoice = target.closest("[data-collection-confirm-choice]");
        if (confirmChoice && $("#mpCollectionConfirmLayer") && !$("#mpCollectionConfirmLayer").hidden) {
            event.preventDefault();
            finishConfirmDialog(confirmChoice.dataset.collectionConfirmChoice === "confirm");
            return;
        }
        const heroChatButton = target.closest("#mpCommunityHeroChatroom");
        if (heroChatButton) {
            event.preventDefault();
            const existingChatButton = $("#mpCommunityOpenChat");
            if (existingChatButton) existingChatButton.click();
            else void openCommunityChatFromSidebar();
            return;
        }

        const closeHubButton = target.closest("#mpCommunityCollectionClose");
        if (closeHubButton) {
            event.preventDefault();
            closeHub();
            return;
        }

        const tabButton = target.closest("[data-collection-tab]");
        if (tabButton && hubOpen) {
            setActiveTab(tabButton.dataset.collectionTab);
            return;
        }

        const actionButton = target.closest("[data-collection-action]");
        if (actionButton && hubOpen) {
            const action = actionButton.dataset.collectionAction;
            if (action === "open-folder") {
                const folder = cachedOverview.folders.find((item) => Number(item.id) === Number(actionButton.dataset.folderId));
                if (folder) void loadFolderItems(folder);
            } else if (action === "share-folder") {
                void openShareDialog(actionButton.dataset.folderId, actionButton);
            } else if (action === "delete-folder") {
                void deleteFolder(actionButton.dataset.folderId);
            } else if (action === "delete-item") {
                void deleteItem(actionButton.dataset.itemId);
            } else if (action === "accept-share") {
                void respondToShare(actionButton.dataset.shareId, "accept", actionButton);
            } else if (action === "decline-share") {
                void respondToShare(actionButton.dataset.shareId, "decline", actionButton);
            } else if (action === "open-shared") {
                setActiveTab("shared");
                void openSharedCollection(actionButton.dataset.shareId, actionButton.dataset.shareName, actionButton.dataset.shareFrom, actionButton.dataset.sharePublicId);
            }
            return;
        }

        const profileButton = target.closest("[data-collection-public-profile]");
        if (profileButton) {
            event.preventDefault();
            openPublicProfile(profileButton.dataset.collectionPublicProfile);
        }
    });

    document.addEventListener("keydown", (event) => {
        const confirmLayer = $("#mpCollectionConfirmLayer");
        if (confirmLayer && !confirmLayer.hidden) {
            if (event.key === "Escape") {
                event.preventDefault();
                finishConfirmDialog(false);
                return;
            }
            if (event.key === "Tab") {
                const confirmDialog = $("#mpCollectionConfirmDialog", confirmLayer);
                if (confirmDialog) focusTrap(confirmDialog, event);
                return;
            }
        }
        // Deliberately no Escape/backdrop-to-close for the profile and share
        // modals; only the themed confirmation dialog supports Escape to cancel.
        if (event.key === "Tab") {
            const shareLayer = getShareLayer();
            if (shareLayer && !shareLayer.hidden) {
                const dialog = $(".mp-collection-share-dialog", shareLayer);
                if (dialog) focusTrap(dialog, event);
            }
        }
    });

    document.addEventListener("error", (event) => {
        const image = event.target instanceof HTMLImageElement ? event.target : null;
        if (!image || !image.matches(".mp-collection-share-avatar--photo img")) return;
        const button = image.closest(".mp-collection-share-avatar");
        if (!button) return;
        image.remove();
        button.classList.remove("mp-collection-share-avatar--photo");
        button.textContent = button.dataset.avatarFallback || "MP";
    }, true);

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bindUIOnce, { once: true });
    } else {
        bindUIOnce();
    }

    // The Collection modal and its form controls live in the persistent shell,
    // so one initial bind is enough; folder/action buttons use delegated clicks.
})();