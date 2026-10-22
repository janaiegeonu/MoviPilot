/* ========================================================================
   MOVIPILOT COMMUNITY CHATROOM
   - Loads through window.initCommunityChat(mount) after the chat fragment is
     inserted into the existing dashboard's #dashboardDynamicPage.
   - Uses authenticated JSON APIs plus Server-Sent Events (SSE) for live updates.
   - Cleans up streams, timers, listeners, and microphone tracks when closed.
   ======================================================================== */
(() => {
    "use strict";

    let activeChatController = null;
    let activeChatCleanup = null;

    const REACTIONS = [
        { key: "like", emoji: "👍", label: "Like" },
        { key: "love", emoji: "❤️", label: "Love" },
        { key: "dislike", emoji: "👎", label: "Dislike" },
        { key: "fire", emoji: "🔥", label: "Fire" },
        { key: "laugh", emoji: "😂", label: "Laughing" },
        { key: "cry", emoji: "😭", label: "Crying" },
        { key: "wow", emoji: "😮", label: "Wow" },
        { key: "angry", emoji: "😡", label: "Angry" },
        { key: "awful", emoji: "🤮", label: "Awful" }
    ];

    const icon = (name) => {
        const paths = {
            reaction: '<circle cx="12" cy="12" r="9"/><path d="M8 14.5s1.3 2 4 2 4-2 4-2M8.5 9.5h.01M15.5 9.5h.01"/>',
            reply: '<path d="M9 14 4 9l5-5"/><path d="M4 9h9a7 7 0 0 1 7 7v3"/>',
            copy: '<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
            edit: '<path d="m4 16.5-.8 3.3 3.3-.8L19 6.5 16.5 4 4 16.5Z"/><path d="m14.8 5.7 2.5 2.5"/>',
            trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/>',
            external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
            movie: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="m8 4 4 5m2-5 4 5M8 20l4-5m2 5 4-5M3 10h18"/>',
            check: '<path d="m5 12 4 4L19 6"/>',
            mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3m-4 0h8"/>',
            play: '<path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor" stroke="none"/>',
            pause: '<path d="M7 5.5h3.8v13H7zM13.2 5.5H17v13h-3.8z" fill="currentColor" stroke="none"/>',
            back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
            more: '<circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none"/>'
        };
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "1.7");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        svg.setAttribute("aria-hidden", "true");
        svg.innerHTML = paths[name] || "";
        return svg;
    };

    const initials = (name) => {
        const bits = String(name || "MoviPilot member").trim().split(/\s+/).filter(Boolean);
        if (!bits.length) return "MP";
        if (bits.length === 1) return Array.from(bits[0]).slice(0, 2).join("").toUpperCase();
        return (Array.from(bits[0])[0] + Array.from(bits[bits.length - 1])[0]).toUpperCase();
    };

    const safeString = (value, fallback = "") => {
        const text = String(value ?? "").trim();
        return text || fallback;
    };

    const makeElement = (tag, className, text) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = String(text);
        return element;
    };

    const requestJSON = async (url, options = {}) => {
        const response = await fetch(url, {
            credentials: "same-origin",
            cache: "no-store",
            ...options,
            headers: { Accept: "application/json", ...(options.headers || {}) }
        });
        let payload = {};
        try { payload = await response.json(); } catch (_) { payload = {}; }
        if (!response.ok) {
            const error = new Error(safeString(payload.error, "The request could not be completed. Please try again."));
            error.status = response.status;
            throw error;
        }
        return payload;
    };

    const formatTime = (value) => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "now";
        return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
    };

    const formatDay = (value) => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        const now = new Date();
        if (date.toDateString() === now.toDateString()) return "Today";
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
        return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" }).format(date);
    };

    const exploreURLFor = (movie) => {
        let url = movie && movie.exploreUrl && movie.exploreUrl.startsWith("/")
            ? movie.exploreUrl
            : `/explore?type=movie&id=${encodeURIComponent(Number(movie?.id) || 0)}`;
        // The Explore back action can use history.back(); this flag also lets
        // /dashboard fallback navigation reopen the Community chat view.
        try {
            const parsed = new URL(url, window.location.origin);
            parsed.searchParams.set("from", "community-chat");
            url = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        } catch (_) {}
        return url;
    };

    const initializeChat = async (mount) => {
        if (activeChatController) activeChatController.abort();
        if (activeChatCleanup) activeChatCleanup();
        const controller = new AbortController();
        activeChatController = controller;
        const { signal } = controller;
        const root = mount?.querySelector("#mpCommunityChatRoot") || document.getElementById("mpCommunityChatRoot");
        if (!root) return;
        root.classList.add("is-fullpage");

        // Keep the room aligned to the dashboard's actual content column.
        // This leaves the dashboard navbar/sidebar usable and tracks sidebar
        // width changes instead of hard-coding a 100vw overlay.
        let viewportResizeObserver = null;
        let viewportClassObserver = null;
        let viewportAnimationFrame = 0;
        let viewportSyncUntil = 0;
        const dashboardMain = document.getElementById("dashboardMain");
        const dashboardSidebar = document.getElementById("dashboardSidebar");
        const dashboardLayout = document.querySelector(".dashboard-layout");
        const dashboardNavbar = document.querySelector(".dashboard-navbar");
        const sidebarToggle = document.getElementById("sidebarToggle");

        const clampViewport = (value, minimum, maximum) => {
            const safeMaximum = Math.max(minimum, maximum);
            return Math.min(Math.max(Number(value) || 0, minimum), safeMaximum);
        };

        const syncChatViewportBounds = () => {
            if (!mount || !mount.classList.contains("is-fullpage")) return;
            const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
            const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
            let top = 0;
            let left = 0;
            let width = viewportWidth;
            let height = viewportHeight;
            const navbarRect = dashboardNavbar?.getBoundingClientRect();
            const navbarBottom = clampViewport(navbarRect?.bottom || 0, 0, viewportHeight - 1);

            // Keep the global navbar visible on both desktop and mobile. On
            // mobile the sidebar is an overlay menu, not a content column.
            // Desktop uses #dashboardMain's live box so its width follows the
            // expanded/collapsed sidebar exactly.
            if (window.matchMedia("(min-width: 721px)").matches) {
                const mainRect = dashboardMain?.getBoundingClientRect();

                if (mainRect && mainRect.width > 0) {
                    left = clampViewport(mainRect.left, 0, viewportWidth - 1);
                    const right = clampViewport(mainRect.right, left + 1, viewportWidth);
                    width = Math.max(1, right - left);
                    top = clampViewport(Math.max(navbarBottom, mainRect.top || 0), 0, viewportHeight - 80);
                    height = Math.max(80, viewportHeight - top);
                } else {
                    const sidebarRect = dashboardSidebar?.getBoundingClientRect();
                    left = clampViewport(sidebarRect?.right || 0, 0, viewportWidth - 1);
                    width = Math.max(1, viewportWidth - left);
                    top = clampViewport(navbarBottom, 0, viewportHeight - 80);
                    height = Math.max(80, viewportHeight - top);
                }
            } else {
                top = clampViewport(navbarBottom, 0, viewportHeight - 80);
                height = Math.max(80, viewportHeight - top);
            }

            mount.style.setProperty("--mp-chat-viewport-top", `${Math.round(top)}px`);
            mount.style.setProperty("--mp-chat-viewport-left", `${Math.round(left)}px`);
            mount.style.setProperty("--mp-chat-viewport-width", `${Math.round(width)}px`);
            mount.style.setProperty("--mp-chat-viewport-height", `${Math.round(height)}px`);
        };

        const scheduleChatViewportSync = () => {
            syncChatViewportBounds();
            viewportSyncUntil = Math.max(viewportSyncUntil, performance.now() + 650);
            if (viewportAnimationFrame) return;
            const followLayoutTransition = () => {
                syncChatViewportBounds();
                if (performance.now() < viewportSyncUntil) {
                    viewportAnimationFrame = window.requestAnimationFrame(followLayoutTransition);
                } else {
                    viewportAnimationFrame = 0;
                }
            };
            viewportAnimationFrame = window.requestAnimationFrame(followLayoutTransition);
        };

        syncChatViewportBounds();
        if (typeof ResizeObserver === "function") {
            viewportResizeObserver = new ResizeObserver(scheduleChatViewportSync);
            [dashboardMain, dashboardSidebar, dashboardLayout].filter(Boolean).forEach((element) => viewportResizeObserver.observe(element));
        }
        if (dashboardSidebar && typeof MutationObserver === "function") {
            viewportClassObserver = new MutationObserver(scheduleChatViewportSync);
            viewportClassObserver.observe(dashboardSidebar, { attributes: true, attributeFilter: ["class", "style"] });
        }

        const byID = (id) => root.querySelector(`#${id}`);
        const history = byID("mpChatHistory");
        const messageHost = byID("mpChatMessages");
        const form = byID("mpChatComposerForm");
        const input = byID("mpChatComposerInput");
        const sendButton = byID("mpChatSendButton");
        const loadOlderButton = byID("mpChatLoadOlder");
        const closeButton = byID("mpChatCloseButton");
        const connectionLabel = byID("mpChatConnectionLabel");
        const voiceButton = byID("mpChatVoiceButton");
        const recordTime = byID("mpChatRecordTime");
        const attachButton = byID("mpChatAttachButton");
        const attachMenu = byID("mpChatAttachMenu");
        const moviePicker = byID("mpChatMoviePicker");
        const movieForm = byID("mpChatMovieSearchForm");
        const movieInput = byID("mpChatMovieSearchInput");
        const movieResults = byID("mpChatMovieResults");
        const composerContext = byID("mpChatComposerContext");
        const contextLabel = byID("mpChatComposerContextLabel");
        const contextText = byID("mpChatComposerContextText");
        const pendingAttachmentBar = byID("mpChatPendingAttachment");
        const uploadProgress = byID("mpChatUploadProgress");
        const uploadProgressLabel = byID("mpChatUploadProgressLabel");
        const toast = byID("mpChatToast");
        const mediaViewer = byID("mpChatMediaViewer");
        const mediaViewerPanel = mediaViewer?.querySelector(".mp-chat-media-viewer-panel");
        const mediaViewerTitle = byID("mpChatMediaViewerTitle");
        const mediaViewerMeta = byID("mpChatMediaViewerMeta");
        const mediaViewerCounter = byID("mpChatMediaViewerCounter");
        const mediaViewerImageTools = byID("mpChatMediaViewerImageTools");
        const mediaViewerImageWrap = byID("mpChatMediaImageWrap");
        const mediaViewerImage = byID("mpChatMediaViewerImage");
        const mediaViewerVideo = byID("mpChatMediaViewerVideo");
        const mediaViewerStage = byID("mpChatMediaViewerStage");
        const mediaViewerLoading = byID("mpChatMediaViewerLoading");
        const mediaViewerSender = byID("mpChatMediaViewerSender");
        const mediaViewerCaption = byID("mpChatMediaViewerCaption");
        const mediaViewerInfo = byID("mpChatMediaViewerInfo");
        const mediaViewerPrevious = byID("mpChatMediaViewerPrevious");
        const mediaViewerNext = byID("mpChatMediaViewerNext");
        const mediaViewerZoomOut = byID("mpChatMediaViewerZoomOut");
        const mediaViewerZoomIn = byID("mpChatMediaViewerZoomIn");
        const mediaViewerFit = byID("mpChatMediaViewerFit");
        const mediaViewerCopy = byID("mpChatMediaViewerCopy");
        const mediaViewerFullscreen = byID("mpChatMediaViewerFullscreen");
        const mediaViewerDownload = byID("mpChatMediaViewerDownload");
        const mediaViewerClose = byID("mpChatMediaViewerClose");

        const state = {
            messages: new Map(),
            latestID: 0,
            oldestID: 0,
            replyToID: 0,
            editingID: 0,
            pendingMedia: null,
            pendingMovie: null,
            eventSource: null,
            pollTimer: 0,
            toastTimer: 0,
            movieSearchTimer: 0,
            recordTimer: 0,
            recordStart: 0,
            recorder: null,
            recordStream: null,
            recordChunks: [],
            recordStopRequested: false,
            audioContext: null,
            mediaBusy: false,
            keepScroll: false,
            destroyed: false
        };
        const pointerTimers = new Set();
        let mediaViewerMessageID = 0;
        let mediaViewerReturnFocus = null;
        let mediaViewerZoom = 1;
        let mediaViewerPanX = 0;
        let mediaViewerPanY = 0;
        let mediaViewerPanning = false;
        let mediaViewerPanPointer = 0;
        let mediaViewerPanStartX = 0;
        let mediaViewerPanStartY = 0;
        let mediaViewerPanOriginX = 0;
        let mediaViewerPanOriginY = 0;
        let mediaViewerCurrentURL = "";
        let mediaViewerStatusTimer = 0;
        const observer = new MutationObserver(() => {
            if (!document.contains(root)) cleanup();
        });
        observer.observe(document.body, { childList: true, subtree: true });

        const announce = (message, isError = false) => {
            if (!toast) return;
            window.clearTimeout(state.toastTimer);
            toast.textContent = message;
            toast.classList.toggle("is-error", Boolean(isError));
            toast.classList.add("is-visible");
            state.toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3300);
        };

        const showNotice = (message, isError = false) => {
            const notice = byID("mpChatNotice");
            if (!notice) return;
            notice.textContent = message;
            notice.classList.toggle("is-error", Boolean(isError));
            notice.hidden = !message;
        };

        const setConnection = (text, connected = false) => {
            if (connectionLabel) connectionLabel.textContent = text;
            const pulse = root.querySelector(".mp-chat-live-pulse");
            if (pulse) {
                pulse.style.background = connected ? "#8af0d1" : "#e6be83";
                pulse.style.boxShadow = connected ? "0 0 12px rgba(138,240,209,.66)" : "0 0 12px rgba(230,190,131,.48)";
            }
        };

        const playTone = async (kind) => {
            if (document.hidden) return;
            try {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (!AudioContextClass) return;
                if (!state.audioContext) state.audioContext = new AudioContextClass();
                if (state.audioContext.state === "suspended") await state.audioContext.resume();
                const ctx = state.audioContext;
                const oscillator = ctx.createOscillator();
                const gain = ctx.createGain();
                const time = ctx.currentTime;
                oscillator.type = "sine";
                oscillator.frequency.setValueAtTime(kind === "send" ? 770 : 610, time);
                oscillator.frequency.exponentialRampToValueAtTime(kind === "send" ? 940 : 760, time + .075);
                gain.gain.setValueAtTime(.0001, time);
                gain.gain.exponentialRampToValueAtTime(.045, time + .012);
                gain.gain.exponentialRampToValueAtTime(.0001, time + .13);
                oscillator.connect(gain);
                gain.connect(ctx.destination);
                oscillator.start(time);
                oscillator.stop(time + .14);
            } catch (_) { /* Browsers may block sound until a gesture; chat stays usable. */ }
        };

        const setContextBar = () => {
            const message = state.messages.get(Number(state.replyToID));
            const editing = state.editingID > 0;
            if (!state.replyToID && !editing) {
                if (composerContext) composerContext.hidden = true;
                return;
            }
            if (composerContext) composerContext.hidden = false;
            if (contextLabel) contextLabel.textContent = editing ? "Editing your message" : "Replying to a message";
            if (contextText) {
                contextText.textContent = editing
                    ? "Update your message, then press Update."
                    : `${safeString(message?.sender?.fullName, "Community member")}: ${safeString(message?.body, message?.kind === "movie" ? `Movie: ${message?.movie?.title || "shared title"}` : message?.kind === "voice" ? "Voice note" : message?.kind === "image" ? "Photo" : message?.kind === "video" ? "Video" : "Message")}`;
            }
            if (sendButton) {
                const label = sendButton.querySelector(".mp-chat-send-label");
                if (label) label.textContent = editing ? "Update" : "Send";
                sendButton.setAttribute("aria-label", editing ? "Update message" : "Send message");
            }
        };

        const clearComposerContext = () => {
            state.replyToID = 0;
            state.editingID = 0;
            if (input) input.value = "";
            adjustTextarea();
            setContextBar();
            const label = sendButton?.querySelector(".mp-chat-send-label");
            if (label) label.textContent = "Send";
            if (sendButton) sendButton.setAttribute("aria-label", "Send message");
        };

        const adjustTextarea = () => {
            if (!input) return;
            input.style.height = "auto";
            input.style.height = `${Math.min(input.scrollHeight, 125)}px`;
            const count = byID("mpChatCharCount");
            if (count) {
                count.textContent = `${Array.from(input.value).length}/3000`;
                count.classList.toggle("is-near-limit", input.value.length > 2700);
            }
        };

        const updatePendingBar = () => {
            const hasMedia = Boolean(state.pendingMedia || state.pendingMovie);
            if (pendingAttachmentBar) pendingAttachmentBar.hidden = !hasMedia;
            if (!hasMedia) return;
            const name = byID("mpChatPendingAttachmentName");
            const meta = byID("mpChatPendingAttachmentMeta");
            const iconHost = byID("mpChatPendingAttachmentIcon");
            if (state.pendingMovie) {
                if (name) name.textContent = state.pendingMovie.title;
                if (meta) meta.textContent = "Movie card ready to share";
                if (iconHost) { iconHost.replaceChildren(icon("movie")); }
            } else if (state.pendingMedia) {
                const media = state.pendingMedia;
                if (name) name.textContent = media.fileName || (media.kind === "image" ? "Photo ready" : media.kind === "video" ? "Video ready" : "Voice note ready");
                if (meta) meta.textContent = `${media.kind === "voice" ? "Voice note" : media.kind === "image" ? "Photo" : "Video"} · ${formatBytes(media.fileSize)}`;
                if (iconHost) { iconHost.replaceChildren(icon(media.kind === "voice" ? "mic" : media.kind === "video" ? "external" : "movie")); }
            }
        };

        const formatBytes = (bytes) => {
            const value = Math.max(0, Number(bytes) || 0);
            if (value < 1024) return `${value} B`;
            if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
            return `${(value / (1024 * 1024)).toFixed(1)} MB`;
        };

        const formatAudioTime = (seconds) => {
            const total = Number.isFinite(Number(seconds)) ? Math.max(0, Math.floor(Number(seconds))) : 0;
            return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
        };

        // Produce a stable multi-hue gradient from the member's public identity.
        // Using a full 0-359° hue range avoids the old eight-colour avatar limit.
        const avatarColorsFor = (seed) => {
            const value = String(seed || "MoviPilot member");
            let hash = 2166136261;
            for (let index = 0; index < value.length; index += 1) {
                hash ^= value.charCodeAt(index);
                hash = Math.imul(hash, 16777619);
            }
            const stableHash = hash >>> 0;
            const primary = stableHash % 360;
            // Independent hash slices give every user a varied colour pairing,
            // while the final stop stays close to hue two for a cleaner gradient.
            const secondary = (stableHash >>> 8) % 360;
            const tertiary = (secondary + 18 + ((stableHash >>> 16) % 12)) % 360;
            return { primary, secondary, tertiary };
        };

        const unlockChatAudio = async () => {
            try {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (!AudioContextClass) return;
                if (!state.audioContext) state.audioContext = new AudioContextClass();
                if (state.audioContext.state === "suspended") await state.audioContext.resume();
            } catch (_) { /* A browser may defer audio until a later user gesture. */ }
        };

        const scrollToBottom = (behavior = "smooth") => {
            if (!history) return;
            history.scrollTo({ top: history.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : behavior });
        };

        const isNearBottom = () => !history || history.scrollHeight - history.scrollTop - history.clientHeight < 110;

        const createMovieCard = (movie) => {
            const anchor = makeElement("a", "mp-chat-movie-card");
            anchor.href = exploreURLFor(movie);
            anchor.dataset.chatTooltip = `Open ${safeString(movie.title, "movie")} in Explore`;
            anchor.setAttribute("aria-label", `Open ${safeString(movie.title, "movie")} in Explore`);
            anchor.target = "_self";
            anchor.addEventListener("click", () => {
                try {
                    sessionStorage.setItem("movipilotCommunityChatReturn", "1");
                    sessionStorage.setItem("movipilotCommunityChatReturnAt", String(Date.now()));
                } catch (_) { /* Normal browser history still returns to this room. */ }
            }, { signal });
            if (movie.posterUrl) {
                const poster = makeElement("img", "mp-chat-movie-poster");
                poster.src = movie.posterUrl;
                poster.alt = "";
                poster.loading = "lazy";
                poster.referrerPolicy = "strict-origin-when-cross-origin";
                poster.onerror = () => {
                    const fallback = makeElement("div", "mp-chat-movie-poster-fallback");
                    fallback.append(icon("movie"));
                    poster.replaceWith(fallback);
                };
                anchor.append(poster);
            } else {
                const fallback = makeElement("div", "mp-chat-movie-poster-fallback");
                fallback.append(icon("movie"));
                anchor.append(fallback);
            }
            const copy = makeElement("span", "mp-chat-movie-copy");
            copy.append(makeElement("small", "mp-chat-movie-kicker", "MOVIPILOT TITLE SHARE"));
            copy.append(makeElement("strong", "", safeString(movie.title, "Untitled movie")));
            if (movie.releaseDate) copy.append(makeElement("small", "", movie.releaseDate.slice(0, 4)));
            if (movie.overview) copy.append(makeElement("span", "mp-chat-movie-overview", movie.overview));
            const open = makeElement("span", "mp-chat-movie-open", "Open in Explore");
            open.append(icon("external"));
            copy.append(open);
            anchor.append(copy);
            return anchor;
        };

        const openReply = (message) => {
            if (!message || message.deleted) { announce("That message is no longer available to reply to.", true); return; }
            state.editingID = 0;
            state.replyToID = Number(message.id);
            setContextBar();
            input?.focus({ preventScroll: true });
            closeAllMenus();
        };

        const addReaction = async (message, reaction) => {
            try {
                const payload = await requestJSON("/api/community/chat/reaction", {
                    method: "POST", signal, headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ messageId: Number(message.id), reaction })
                });
                if (signal.aborted) return;
                if (payload.message) upsertMessage(payload.message, { playIncoming: false });
                closeAllMenus();
            } catch (error) { if (!signal.aborted) announce(error.message || "Could not save that reaction.", true); }
        };

        const closeAllMenus = () => {
            document.querySelectorAll(".mp-chat-context-menu[data-chat-context-menu='true']").forEach((node) => node.remove());
            root.querySelectorAll(".mp-chat-reaction-picker").forEach((node) => node.remove());
            root.querySelectorAll(".mp-chat-message-row.is-tools-open").forEach((node) => node.classList.remove("is-tools-open"));
        };

        const makeReactionButtons = (message, className) => {
            const picker = makeElement("div", className);
            picker.setAttribute("aria-label", "Choose a message reaction");
            REACTIONS.forEach((reaction) => {
                const button = makeElement("button", "", reaction.emoji);
                button.type = "button";
                button.dataset.chatTooltip = reaction.label;
                button.setAttribute("aria-label", reaction.label);
                button.setAttribute("aria-pressed", String(message.myReaction === reaction.key));
                button.addEventListener("click", () => addReaction(message, reaction.key), { signal });
                picker.append(button);
            });
            return picker;
        };

        const beginEdit = (message) => {
            if (!message?.isMine || message.kind !== "text" || message.deleted) return;
            state.replyToID = 0;
            state.editingID = Number(message.id);
            if (input) input.value = message.body || "";
            adjustTextarea();
            setContextBar();
            input?.focus({ preventScroll: true });
            closeAllMenus();
        };

        const deleteMessage = async (message) => {
            if (!message?.isMine || message.deleted) { announce("You can only delete your own active messages.", true); closeAllMenus(); return; }
            closeAllMenus();
            const confirmed = window.confirm("Delete this message for everyone in the community room?");
            if (!confirmed) return;
            try {
                await requestJSON(`/api/community/chat/messages?id=${encodeURIComponent(message.id)}`, { method: "DELETE", signal });
                announce("Message deleted.");
                await refreshLatest({ silent: true, preserveScroll: true });
            } catch (error) { if (!signal.aborted) announce(error.message || "Could not delete that message.", true); }
        };

        const copyMessage = async (message) => {
            if (!message?.body) { announce("There is no text to copy.", true); return; }
            try {
                if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(message.body);
                else {
                    const area = document.createElement("textarea"); area.value = message.body; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0"; document.body.append(area); area.select();
                    const copied = document.execCommand("copy"); area.remove(); if (!copied) throw new Error("Clipboard unavailable");
                }
                announce("Message text copied.");
            } catch (_) { announce("This browser blocked copying. Select the message text instead.", true); }
            closeAllMenus();
        };

        const openContextMenu = (row, message) => {
            if (!row || !message) return;
            closeAllMenus();
            row.classList.add("is-tools-open");
            const bubble = row.querySelector(".mp-chat-bubble");
            if (!bubble) return;
            const menu = makeElement("div", "mp-chat-context-menu");
            menu.dataset.chatContextMenu = "true";
            menu.setAttribute("role", "menu");
            menu.setAttribute("aria-label", "Message actions");
            menu.append(makeReactionButtons(message, "mp-chat-context-reactions"));
            const addAction = (label, iconName, callback, danger = false) => {
                const button = makeElement("button", danger ? "is-danger" : "", label);
                button.type = "button"; button.setAttribute("role", "menuitem");
                button.prepend(icon(iconName));
                button.addEventListener("click", callback, { signal });
                menu.append(button);
            };
            addAction("Reply to message", "reply", () => openReply(message));
            if (message.isMine && message.kind === "text" && !message.deleted) addAction("Edit message", "edit", () => beginEdit(message));
            if (message.isMine && !message.deleted) addAction("Delete message", "trash", () => deleteMessage(message), true);
            if (message.body && !message.deleted) addAction("Copy message text", "copy", () => copyMessage(message));

            // Render at the document's top layer so ancestors' overflow and
            // neighbouring bubbles cannot clip or cover the menu.
            menu.style.position = "fixed";
            menu.style.left = "0px";
            menu.style.top = "0px";
            menu.style.visibility = "hidden";
            document.body.append(menu);
            const bounds = menu.getBoundingClientRect();
            const bubbleBounds = bubble.getBoundingClientRect();
            const gutter = 12;
            let left = row.classList.contains("is-mine") ? bubbleBounds.right - bounds.width : bubbleBounds.left;
            left = Math.max(gutter, Math.min(left, window.innerWidth - bounds.width - gutter));
            let top = bubbleBounds.bottom + 8;
            if (top + bounds.height > window.innerHeight - gutter) top = bubbleBounds.top - bounds.height - 8;
            top = Math.max(gutter, Math.min(top, window.innerHeight - bounds.height - gutter));
            menu.style.left = `${left}px`;
            menu.style.top = `${top}px`;
            menu.style.visibility = "visible";
        };

        const resolvedMediaURL = (value) => {
            try {
                const parsed = new URL(String(value || ""), window.location.href);
                return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
            } catch (_) { return ""; }
        };

        const getViewerMediaItems = () => [...state.messages.values()]
            .filter((message) => message && !message.deleted && ["image", "video"].includes(message.kind) && resolvedMediaURL(message.attachmentUrl))
            .sort((a, b) => Number(a.id) - Number(b.id));

        const activeViewerMessage = () => getViewerMediaItems().find((message) => Number(message.id) === mediaViewerMessageID) || null;

        const setViewerInfo = (message) => {
            if (!mediaViewerInfo) return;
            window.clearTimeout(mediaViewerStatusTimer);
            if (!message) { mediaViewerInfo.textContent = "Media preview"; return; }
            const type = message.kind === "video" ? "Video" : "Image";
            if (message.kind === "image" && mediaViewerImage?.naturalWidth && mediaViewerImage?.naturalHeight) {
                mediaViewerInfo.textContent = `${mediaViewerImage.naturalWidth} × ${mediaViewerImage.naturalHeight} · ${Math.round(mediaViewerZoom * 100)}% zoom`;
            } else {
                mediaViewerInfo.textContent = message.kind === "image" ? `${type} · ${Math.round(mediaViewerZoom * 100)}% zoom` : `${type} · Use the player controls to seek`;
            }
        };

        const applyViewerImageTransform = () => {
            if (!mediaViewerImage) return;
            mediaViewerImage.style.transform = `translate3d(${mediaViewerPanX}px, ${mediaViewerPanY}px, 0) scale(${mediaViewerZoom})`;
            mediaViewerImage.classList.toggle("is-zoomed", mediaViewerZoom > 1.01);
            mediaViewerImage.style.cursor = mediaViewerPanning ? "grabbing" : mediaViewerZoom > 1.01 ? "grab" : "zoom-in";
            if (mediaViewerFit) mediaViewerFit.setAttribute("data-chat-tooltip", `Fit to screen · ${Math.round(mediaViewerZoom * 100)}%`);
            setViewerInfo(activeViewerMessage());
        };

        const setViewerZoom = (nextZoom, resetPan = false) => {
            mediaViewerZoom = Math.max(0.5, Math.min(4, Math.round(nextZoom * 100) / 100));
            if (resetPan || mediaViewerZoom <= 1) { mediaViewerPanX = 0; mediaViewerPanY = 0; }
            applyViewerImageTransform();
        };

        const safeMediaFileName = (message) => {
            let name = String(message?.attachmentName || "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").trim().slice(0, 120);
            if (name) return name;
            const url = resolvedMediaURL(message?.attachmentUrl);
            let extension = "";
            try { extension = new URL(url).pathname.match(/\.[a-z0-9]{2,5}$/i)?.[0] || ""; } catch (_) {}
            if (!extension) extension = message?.kind === "video" ? ".mp4" : ".jpg";
            return `movipilot-${message?.kind === "video" ? "video" : "photo"}-${Number(message?.id) || Date.now()}${extension}`;
        };

        const updateViewerNavigation = () => {
            const items = getViewerMediaItems();
            const index = items.findIndex((message) => Number(message.id) === mediaViewerMessageID);
            if (mediaViewerCounter) mediaViewerCounter.textContent = index >= 0 ? `${index + 1} / ${items.length}` : `0 / ${items.length}`;
            if (mediaViewerPrevious) mediaViewerPrevious.disabled = index <= 0;
            if (mediaViewerNext) mediaViewerNext.disabled = index < 0 || index >= items.length - 1;
        };

        const renderMediaViewer = (message) => {
            if (!mediaViewer || !message || !["image", "video"].includes(message.kind)) return;
            const url = resolvedMediaURL(message.attachmentUrl);
            if (!url) { announce("This attachment does not have a valid media URL.", true); return; }
            mediaViewerMessageID = Number(message.id);
            mediaViewerCurrentURL = url;
            mediaViewerZoom = 1;
            mediaViewerPanX = 0;
            mediaViewerPanY = 0;
            mediaViewerPanning = false;
            if (mediaViewerVideo) { mediaViewerVideo.pause(); mediaViewerVideo.removeAttribute("src"); mediaViewerVideo.load(); }
            if (mediaViewerImage) {
                mediaViewerImage.onload = null;
                mediaViewerImage.onerror = null;
                mediaViewerImage.removeAttribute("src");
                mediaViewerImage.alt = safeString(message.attachmentName, message.kind === "image" ? "Shared community photo" : "Shared community video poster");
                mediaViewerImage.style.opacity = "0";
            }
            const isImage = message.kind === "image";
            if (mediaViewerTitle) mediaViewerTitle.textContent = safeString(message.attachmentName, isImage ? "Shared photo" : "Shared video");
            if (mediaViewerMeta) mediaViewerMeta.textContent = `${isImage ? "Photo" : "Video"} · ${formatTime(message.createdAt)}`;
            if (mediaViewerSender) mediaViewerSender.textContent = safeString(message.sender?.fullName, "Community member");
            if (mediaViewerCaption) mediaViewerCaption.textContent = safeString(message.body, isImage ? "Shared a photo with the community." : "Shared a video with the community.");
            if (mediaViewerImageTools) mediaViewerImageTools.hidden = !isImage;
            if (mediaViewerImageWrap) mediaViewerImageWrap.hidden = !isImage;
            if (mediaViewerImage) mediaViewerImage.hidden = !isImage;
            if (mediaViewerVideo) mediaViewerVideo.hidden = isImage;
            if (mediaViewerLoading) {
                mediaViewerLoading.hidden = false;
                const loadingText = mediaViewerLoading.querySelector("small");
                if (loadingText) loadingText.textContent = isImage ? "Loading photo…" : "Loading video…";
            }
            if (isImage && mediaViewerImage) {
                mediaViewerImage.onload = () => {
                    if (mediaViewerMessageID !== Number(message.id)) return;
                    if (mediaViewerLoading) mediaViewerLoading.hidden = true;
                    mediaViewerImage.style.opacity = "1";
                    if (mediaViewerInfo) mediaViewerInfo.textContent = mediaViewerImage.naturalWidth && mediaViewerImage.naturalHeight
                        ? `${mediaViewerImage.naturalWidth} × ${mediaViewerImage.naturalHeight} · 100%` : "Image preview";
                    applyViewerImageTransform();
                };
                mediaViewerImage.onerror = () => {
                    if (mediaViewerMessageID !== Number(message.id)) return;
                    if (mediaViewerLoading) {
                        mediaViewerLoading.hidden = false;
                        const text = mediaViewerLoading.querySelector("small");
                        if (text) text.textContent = "This image could not be loaded.";
                    }
                    mediaViewerImage.style.opacity = "0";
                };
                mediaViewerImage.src = url;
                // Cached images may complete before the onload handler paints a fresh frame.
                if (mediaViewerImage.complete && mediaViewerImage.naturalWidth > 0) mediaViewerImage.onload();
            } else if (mediaViewerVideo) {
                mediaViewerVideo.onloadedmetadata = () => {
                    if (mediaViewerMessageID !== Number(message.id)) return;
                    if (mediaViewerLoading) mediaViewerLoading.hidden = true;
                    if (mediaViewerInfo) {
                        const dimensions = mediaViewerVideo.videoWidth && mediaViewerVideo.videoHeight ? ` · ${mediaViewerVideo.videoWidth} × ${mediaViewerVideo.videoHeight}` : "";
                        mediaViewerInfo.textContent = `Video${dimensions} · ${formatAudioTime(mediaViewerVideo.duration)} available`;
                    }
                };
                mediaViewerVideo.onerror = () => {
                    if (mediaViewerMessageID !== Number(message.id)) return;
                    if (mediaViewerLoading) {
                        mediaViewerLoading.hidden = false;
                        const text = mediaViewerLoading.querySelector("small");
                        if (text) text.textContent = "This video could not be loaded.";
                    }
                };
                mediaViewerVideo.src = url;
                mediaViewerVideo.load();
            }
            applyViewerImageTransform();
            updateViewerNavigation();
        };

        const openMediaViewer = (message) => {
            if (!mediaViewer || !message) return;
            if (mediaViewer.hidden) mediaViewerReturnFocus = document.activeElement;
            renderMediaViewer(message);
            mediaViewer.hidden = false;
            root.classList.add("is-media-viewer-open");
            document.documentElement.classList.add("mp-chat-media-viewer-open");
            if (mediaViewerClose) mediaViewerClose.focus({ preventScroll: true });
        };

        const closeMediaViewer = (restoreFocus = true) => {
            if (!mediaViewer || mediaViewer.hidden) return;
            if (mediaViewerVideo) { mediaViewerVideo.pause(); mediaViewerVideo.removeAttribute("src"); mediaViewerVideo.load(); mediaViewerVideo.onloadedmetadata = null; mediaViewerVideo.onerror = null; }
            if (mediaViewerImage) { mediaViewerImage.onload = null; mediaViewerImage.onerror = null; mediaViewerImage.removeAttribute("src"); }
            mediaViewer.hidden = true;
            root.classList.remove("is-media-viewer-open");
            document.documentElement.classList.remove("mp-chat-media-viewer-open");
            mediaViewerMessageID = 0;
            mediaViewerCurrentURL = "";
            mediaViewerZoom = 1;
            mediaViewerPanX = 0;
            mediaViewerPanY = 0;
            mediaViewerPanning = false;
            window.clearTimeout(mediaViewerStatusTimer);
            if (document.fullscreenElement === mediaViewerPanel && document.exitFullscreen) {
                void document.exitFullscreen().catch(() => {});
            }
            if (restoreFocus && mediaViewerReturnFocus?.isConnected) mediaViewerReturnFocus.focus({ preventScroll: true });
            mediaViewerReturnFocus = null;
        };

        const navigateViewerMedia = (direction) => {
            const items = getViewerMediaItems();
            const index = items.findIndex((message) => Number(message.id) === mediaViewerMessageID);
            const nextIndex = index + direction;
            if (nextIndex < 0 || nextIndex >= items.length) return;
            renderMediaViewer(items[nextIndex]);
        };

        const downloadViewerMedia = async () => {
            const message = activeViewerMessage();
            const url = resolvedMediaURL(message?.attachmentUrl);
            if (!message || !url || !mediaViewerDownload) return;
            const fileName = safeMediaFileName(message);
            mediaViewerDownload.disabled = true;
            mediaViewerDownload.setAttribute("aria-busy", "true");
            try {
                const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
                if (!response.ok) throw new Error(`Download failed (${response.status}).`);
                const blob = await response.blob();
                if (!blob.size || blob.type === "text/html") throw new Error("The server did not return a media file.");
                const objectURL = URL.createObjectURL(blob);
                const link = makeElement("a");
                link.href = objectURL;
                link.download = fileName;
                link.rel = "noopener";
                link.style.display = "none";
                document.body.append(link);
                link.click();
                link.remove();
                window.setTimeout(() => URL.revokeObjectURL(objectURL), 30000);
                if (mediaViewerInfo) mediaViewerInfo.textContent = `Saved ${fileName}`;
            } catch (error) {
                // A same-origin anchor is a safe fallback when streaming the response to a Blob is unavailable.
                if (new URL(url).origin === window.location.origin) {
                    const link = makeElement("a");
                    link.href = url;
                    link.download = fileName;
                    link.rel = "noopener noreferrer";
                    link.style.display = "none";
                    document.body.append(link);
                    link.click();
                    link.remove();
                    if (mediaViewerInfo) mediaViewerInfo.textContent = `Download requested · ${fileName}`;
                } else {
                    announce(error?.message || "The browser could not download this media.", true);
                }
            } finally {
                mediaViewerDownload.disabled = false;
                mediaViewerDownload.removeAttribute("aria-busy");
            }
        };

        const copyViewerMediaLink = async () => {
            const url = mediaViewerCurrentURL;
            if (!url) return;
            try {
                if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(url);
                else {
                    const temporary = makeElement("textarea");
                    temporary.value = url;
                    temporary.setAttribute("readonly", "");
                    temporary.style.position = "fixed";
                    temporary.style.opacity = "0";
                    document.body.append(temporary);
                    temporary.select();
                    const copied = document.execCommand("copy");
                    temporary.remove();
                    if (!copied) throw new Error("Clipboard unavailable");
                }
                if (mediaViewerInfo) mediaViewerInfo.textContent = "Media link copied to clipboard";
                window.clearTimeout(mediaViewerStatusTimer);
                mediaViewerStatusTimer = window.setTimeout(() => setViewerInfo(activeViewerMessage()), 2200);
            } catch (_) { announce("This browser blocked copying the media link.", true); }
        };

        const toggleViewerFullscreen = async () => {
            try {
                if (document.fullscreenElement === mediaViewerPanel) await document.exitFullscreen();
                else if (mediaViewerPanel?.requestFullscreen) await mediaViewerPanel.requestFullscreen();
                else { if (mediaViewerInfo) mediaViewerInfo.textContent = "Full screen is not supported in this browser."; return; }
                const isFullscreen = document.fullscreenElement === mediaViewerPanel;
                mediaViewerFullscreen?.setAttribute("aria-label", isFullscreen ? "Exit full screen" : "Enter full screen");
                mediaViewerFullscreen?.setAttribute("data-chat-tooltip", isFullscreen ? "Exit full screen" : "Full screen");
            } catch (_) { announce("The browser could not enter full-screen mode.", true); }
        };

        const createMessageRow = (message) => {
            const row = makeElement("article", `mp-chat-message-row${message.isMine ? " is-mine" : ""}`);
            row.dataset.messageId = String(message.id);
            const avatar = makeElement("button", "mp-chat-avatar-button", initials(message.sender?.fullName));
            avatar.type = "button";
            const avatarColors = avatarColorsFor(message.sender?.publicId || message.sender?.username || message.sender?.fullName);
            avatar.style.setProperty("--mp-avatar-hue", String(avatarColors.primary));
            avatar.style.setProperty("--mp-avatar-hue-two", String(avatarColors.secondary));
            avatar.style.setProperty("--mp-avatar-hue-three", String(avatarColors.tertiary));
            avatar.dataset.avatarTone = String(avatarColors.primary);
            avatar.dataset.chatTooltip = `View ${safeString(message.sender?.fullName, "member")}'s profile`;
            avatar.setAttribute("aria-label", `View ${safeString(message.sender?.fullName, "member")}'s profile`);
            avatar.addEventListener("click", () => openSenderProfile(message), { signal });

            const stack = makeElement("div", "mp-chat-message-stack");
            const meta = makeElement("div", "mp-chat-message-meta");
            const senderName = makeElement("button", "mp-chat-sender-name", safeString(message.sender?.fullName, "MoviPilot member"));
            senderName.type = "button";
            senderName.dataset.chatTooltip = "Open public profile";
            senderName.setAttribute("aria-label", `Open ${safeString(message.sender?.fullName, "member")}'s profile`);
            senderName.addEventListener("click", () => openSenderProfile(message), { signal });
            meta.append(senderName);
            if (message.sender?.username) meta.append(makeElement("span", "mp-chat-sender-handle", `@${message.sender.username}`));
            stack.append(meta);

            const bubble = makeElement("div", "mp-chat-bubble");
            bubble.dataset.messageBody = "true";
            if (message.replyTo && !message.deleted) {
                const quote = makeElement("button", "mp-chat-reply-quote");
                quote.type = "button";
                quote.append(makeElement("strong", "", message.replyTo.sender?.fullName || "Reply"));
                quote.append(makeElement("span", "", message.replyTo.deleted ? "This message was deleted" : (message.replyTo.body || describeKind(message.replyTo.kind))));
                quote.addEventListener("click", () => jumpToMessage(message.replyTo.id), { signal });
                bubble.append(quote);
            }

            if (message.deleted || message.kind === "deleted") {
                bubble.append(makeElement("p", "mp-chat-deleted-bubble", "This message was deleted"));
            } else {
                if (message.kind === "image" && message.attachmentUrl) {
                    const trigger = makeElement("button", "mp-chat-media-trigger mp-chat-media-trigger--image");
                    trigger.type = "button";
                    trigger.setAttribute("aria-label", `View photo ${message.attachmentName || "shared in chat"} at full size`);
                    trigger.dataset.chatTooltip = "Open full-size photo";
                    const image = makeElement("img", "mp-chat-attachment-image");
                    image.src = message.attachmentUrl;
                    image.alt = message.attachmentName || "Community image";
                    image.loading = "lazy";
                    image.decoding = "async";
                    image.referrerPolicy = "strict-origin-when-cross-origin";
                    image.addEventListener("error", () => trigger.classList.add("is-media-unavailable"), { signal });
                    trigger.append(image);
                    const badge = makeElement("span", "mp-chat-media-trigger-badge");
                    badge.append(icon("external"), makeElement("span", "", "View photo"));
                    trigger.append(badge);
                    trigger.addEventListener("click", () => openMediaViewer(message), { signal });
                    bubble.append(trigger);
                } else if (message.kind === "video" && message.attachmentUrl) {
                    const trigger = makeElement("button", "mp-chat-media-trigger mp-chat-media-trigger--video");
                    trigger.type = "button";
                    trigger.setAttribute("aria-label", `Preview video ${message.attachmentName || "shared in chat"}`);
                    trigger.dataset.chatTooltip = "Play video in the preview";
                    const video = makeElement("video", "mp-chat-attachment-video");
                    video.src = message.attachmentUrl;
                    video.muted = true;
                    video.playsInline = true;
                    video.preload = "metadata";
                    video.setAttribute("aria-label", message.attachmentName || "Community video preview");
                    video.setAttribute("tabindex", "-1");
                    video.addEventListener("error", () => trigger.classList.add("is-media-unavailable"), { signal });
                    trigger.append(video);
                    const shade = makeElement("span", "mp-chat-media-trigger-shade");
                    const badge = makeElement("span", "mp-chat-media-trigger-badge mp-chat-media-trigger-badge--play");
                    badge.append(icon("play"), makeElement("span", "", "Play video"));
                    shade.append(badge);
                    trigger.append(shade);
                    trigger.addEventListener("click", () => openMediaViewer(message), { signal });
                    bubble.append(trigger);
                } else if (message.kind === "voice" && message.attachmentUrl) {
                    const player = makeElement("div", "mp-chat-voice-player");
                    const playButton = makeElement("button", "mp-chat-voice-play");
                    playButton.type = "button";
                    playButton.append(icon("play"));
                    playButton.setAttribute("aria-label", "Play voice note");
                    playButton.dataset.chatTooltip = "Play voice note";

                    const waveform = makeElement("button", "mp-chat-voice-waveform");
                    waveform.type = "button";
                    waveform.setAttribute("role", "slider");
                    waveform.setAttribute("aria-label", "Seek voice note");
                    waveform.setAttribute("aria-valuemin", "0");
                    waveform.setAttribute("aria-valuemax", "100");
                    waveform.setAttribute("aria-valuenow", "0");
                    const waveBars = [];
                    const voiceSeed = Number(message.id) || 1;
                    for (let index = 0; index < 38; index += 1) {
                        const bar = makeElement("span", "mp-chat-voice-wave-bar");
                        bar.style.setProperty("--wave-index", String(index % 9));
                        const mix = Math.abs(Math.sin((index + 3) * (voiceSeed % 17 + 3)) * 0.55 + Math.cos(index * 0.77 + voiceSeed) * 0.45);
                        bar.style.height = `${Math.round(19 + mix * 76)}%`;
                        waveBars.push(bar);
                        waveform.append(bar);
                    }
                    const timeLabel = makeElement("span", "mp-chat-voice-time", "0:00 / 0:00");
                    const audio = makeElement("audio", "mp-chat-attachment-audio");
                    audio.src = message.attachmentUrl;
                    audio.preload = "metadata";
                    audio.setAttribute("aria-label", `Voice note from ${message.sender?.fullName || "member"}`);
                    audio.hidden = true;

                    const updateVoiceUI = () => {
                        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
                        const progress = duration > 0 ? Math.max(0, Math.min(1, audio.currentTime / duration)) : 0;
                        const isPlaying = !audio.paused && !audio.ended;
                        const currentBar = Math.min(waveBars.length - 1, Math.floor(progress * waveBars.length));
                        waveform.style.setProperty("--voice-progress", `${(progress * 100).toFixed(2)}%`);
                        waveBars.forEach((bar, index) => {
                            bar.classList.toggle("is-played", index < progress * waveBars.length || audio.ended);
                            bar.classList.toggle("is-current", isPlaying && Math.abs(index - currentBar) <= 2);
                        });
                        waveform.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
                        timeLabel.textContent = `${formatAudioTime(audio.currentTime)} / ${formatAudioTime(duration)}`;
                        playButton.replaceChildren(icon(isPlaying ? "pause" : "play"));
                        playButton.setAttribute("aria-label", isPlaying ? "Pause voice note" : "Play voice note");
                        playButton.dataset.chatTooltip = isPlaying ? "Pause voice note" : "Play voice note";
                        player.classList.toggle("is-playing", isPlaying);
                        player.classList.toggle("is-ended", Boolean(audio.ended));
                    };
                    playButton.addEventListener("click", async () => {
                        await unlockChatAudio();
                        if (audio.paused || audio.ended) {
                            // Keep playback single-voice-at-a-time, as users expect in a chatroom.
                            root.querySelectorAll(".mp-chat-attachment-audio").forEach((otherAudio) => {
                                if (otherAudio !== audio) otherAudio.pause();
                            });
                            if (audio.ended) audio.currentTime = 0;
                            try { await audio.play(); } catch (_) { announce("This voice note could not be played by your browser.", true); }
                        } else audio.pause();
                        updateVoiceUI();
                    }, { signal });
                    waveform.addEventListener("click", (event) => {
                        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
                        if (!duration) return;
                        const bounds = waveform.getBoundingClientRect();
                        audio.currentTime = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * duration;
                        updateVoiceUI();
                    }, { signal });
                    waveform.addEventListener("keydown", (event) => {
                        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
                        if (!duration) return;
                        event.preventDefault();
                        if (event.key === "Home") audio.currentTime = 0;
                        else if (event.key === "End") audio.currentTime = duration;
                        else audio.currentTime = Math.max(0, Math.min(duration, audio.currentTime + (event.key === "ArrowRight" ? 5 : -5)));
                        updateVoiceUI();
                    }, { signal });
                    ["loadedmetadata", "durationchange", "timeupdate", "play", "playing", "pause", "ended", "seeking", "seeked"].forEach((name) => audio.addEventListener(name, updateVoiceUI, { signal }));
                    audio.addEventListener("error", () => announce("This voice note is unavailable or uses an unsupported audio format.", true), { signal });
                    waveform.addEventListener("pointerdown", (event) => {
                        if (event.pointerType === "touch") waveform.setPointerCapture?.(event.pointerId);
                    }, { signal });
                    player.append(playButton, waveform, timeLabel);
                    bubble.append(player, audio);
                } else if (message.kind === "movie" && message.movie) {
                    bubble.append(createMovieCard(message.movie));
                }
                if (message.body) bubble.append(makeElement("p", "mp-chat-message-text", message.body));
                if (!message.body && ["image", "video", "voice"].includes(message.kind) && !message.attachmentUrl) bubble.append(makeElement("p", "mp-chat-message-text", "Attachment unavailable"));
            }

            const foot = makeElement("div", "mp-chat-message-foot");
            if (message.editedAt && !message.deleted) foot.append(makeElement("span", "mp-chat-edited-label", "edited"));
            foot.append(makeElement("time", "", formatTime(message.createdAt)));
            if (message.isMine && !message.deleted) { const tick = makeElement("span", "mp-chat-tick", "✓"); tick.setAttribute("aria-label", "Sent"); foot.append(tick); }
            bubble.append(foot);
            stack.append(bubble);

            if (!message.deleted) {
                const tools = makeElement("div", "mp-chat-hover-tools");
                const reactButton = makeElement("button", "mp-chat-tool-button"); reactButton.type = "button"; reactButton.dataset.chatTooltip = "React to message"; reactButton.setAttribute("aria-label", "React to message"); reactButton.append(icon("reaction"));
                reactButton.addEventListener("click", (event) => {
                    event.stopPropagation();
                    const previous = tools.querySelector(".mp-chat-reaction-picker");
                    if (previous) { previous.remove(); return; }
                    // Only one message popup should be open at a time.
                    closeAllMenus();
                    const picker = makeReactionButtons(message, "mp-chat-reaction-picker");
                    tools.append(picker);
                }, { signal });
                const replyButton = makeElement("button", "mp-chat-tool-button"); replyButton.type = "button"; replyButton.dataset.chatTooltip = "Reply to message"; replyButton.setAttribute("aria-label", "Reply to message"); replyButton.append(icon("reply"));
                replyButton.addEventListener("click", () => openReply(message), { signal });
                const moreButton = makeElement("button", "mp-chat-tool-button mp-chat-more-button"); moreButton.type = "button"; moreButton.dataset.chatTooltip = "More message actions"; moreButton.setAttribute("aria-label", "More message actions"); moreButton.append(icon("more"));
                moreButton.addEventListener("click", () => openContextMenu(row, message), { signal });
                tools.append(reactButton, replyButton, moreButton);
                stack.append(tools);
            }

            const reactions = makeElement("div", "mp-chat-reaction-summary");
            REACTIONS.forEach((reaction) => {
                const count = Number(message.reactionCounts?.[reaction.key]) || 0;
                if (count <= 0) return;
                const pill = makeElement("button", `mp-chat-reaction-pill${message.myReaction === reaction.key ? " is-mine" : ""}`);
                pill.type = "button"; pill.dataset.chatTooltip = reaction.label; pill.setAttribute("aria-label", reaction.label); pill.setAttribute("aria-pressed", String(message.myReaction === reaction.key));
                pill.append(makeElement("span", "", reaction.emoji)); pill.append(makeElement("small", "", count));
                pill.addEventListener("click", () => addReaction(message, reaction.key), { signal });
                reactions.append(pill);
            });
            if (reactions.childElementCount) stack.append(reactions);

            row.append(avatar, stack);
            attachMessageGestures(row, bubble, message);
            return row;
        };

        const describeKind = (kind) => ({ image: "Photo", video: "Video", voice: "Voice note", movie: "Movie card", deleted: "This message was deleted" }[kind] || "Message");

        const openSenderProfile = (message) => {
            if (message?.isMine) {
                document.getElementById("profileButton")?.click();
                return;
            }
            const publicId = safeString(message?.sender?.publicId);
            if (publicId && typeof window.openMoviPilotCommunityMemberProfile === "function") {
                window.openMoviPilotCommunityMemberProfile(publicId);
            } else if (publicId) {
                announce("Return to the Community page to open this member profile.", true);
            }
        };

        const jumpToMessage = (id) => {
            const target = root.querySelector(`[data-message-id="${Number(id)}"]`);
            if (!target) { announce("That message is outside the currently loaded history."); return; }
            target.scrollIntoView({ behavior: "smooth", block: "center" });
            target.classList.remove("is-highlighted");
            requestAnimationFrame(() => target.classList.add("is-highlighted"));
            window.setTimeout(() => target.classList.remove("is-highlighted"), 1300);
        };

        const attachMessageGestures = (row, bubble, message) => {
            let startX = 0, startY = 0, lastX = 0, lastY = 0, pointerType = "mouse", longTriggered = false, moved = false, holdTimer = 0;
            const clearHold = () => { if (holdTimer) window.clearTimeout(holdTimer); holdTimer = 0; };
            bubble.addEventListener("pointerdown", (event) => {
                if (event.button !== 0) return;
                pointerType = event.pointerType || "mouse";
                startX = lastX = event.clientX; startY = lastY = event.clientY;
                longTriggered = false; moved = false;
                clearHold();
                holdTimer = window.setTimeout(() => {
                    if (moved || signal.aborted) return;
                    longTriggered = true;
                    if (pointerType === "touch" || pointerType === "pen" || pointerType === "mouse") openContextMenu(row, message);
                }, pointerType === "touch" || pointerType === "pen" ? 520 : 720);
            }, { signal });
            bubble.addEventListener("pointermove", (event) => {
                lastX = event.clientX; lastY = event.clientY;
                if (Math.abs(lastX - startX) > 12 || Math.abs(lastY - startY) > 12) { moved = true; clearHold(); }
            }, { signal, passive: true });
            bubble.addEventListener("pointerup", (event) => {
                clearHold();
                if (longTriggered) { event.preventDefault(); return; }
                const dx = event.clientX - startX;
                const dy = event.clientY - startY;
                if (Math.abs(dx) > 76 && Math.abs(dx) > Math.abs(dy) * 1.25) {
                    if (dx > 0) openReply(message);
                    else if (message.isMine) void deleteMessage(message);
                    else announce("You can delete only messages you sent.", true);
                }
            }, { signal });
            bubble.addEventListener("pointercancel", clearHold, { signal });
            bubble.addEventListener("dblclick", (event) => {
                event.preventDefault();
                if (message.deleted) return;
                openReply(message);
            }, { signal });
            bubble.addEventListener("contextmenu", (event) => {
                event.preventDefault();
                openContextMenu(row, message);
            }, { signal });
        };

        const upsertMessage = (message, options = {}) => {
            if (!message || !Number(message.id)) return false;
            const id = Number(message.id);
            const exists = state.messages.has(id);
            const wasAtBottom = isNearBottom();
            state.messages.set(id, message);
            state.latestID = Math.max(state.latestID, id);
            state.oldestID = state.oldestID ? Math.min(state.oldestID, id) : id;
            const existing = root.querySelector(`[data-message-id="${id}"]`);
            const row = createMessageRow(message);
            if (existing) {
                // Background refreshes should not replay the message entrance animation.
                if (options.silentUpdate) row.classList.add("is-chat-silent-refresh");
                existing.replaceWith(row);
            } else {
                const welcome = byID("mpChatWelcome");
                if (welcome) welcome.remove();
                messageHost?.append(row);
            }
            if (!exists && !message.isMine && options.playIncoming) void playTone("incoming");
            if (wasAtBottom || options.forceBottom) scrollToBottom(exists ? "auto" : "smooth");
            if (loadOlderButton) loadOlderButton.hidden = state.messages.size < 60;
            return !exists;
        };

        const renderFullWindow = (messages, options = {}) => {
            const wasAtBottom = isNearBottom();
            const oldScrollTop = history?.scrollTop || 0;
            state.messages.clear();
            messageHost?.replaceChildren();
            const fragment = document.createDocumentFragment();
            const sorted = [...(messages || [])].sort((a, b) => Number(a.id) - Number(b.id));
            let previousDay = "";
            for (const message of sorted) {
                const day = formatDay(message.createdAt);
                if (day && day !== previousDay) { fragment.append(makeElement("div", "mp-chat-day-divider", day)); previousDay = day; }
                state.messages.set(Number(message.id), message);
                fragment.append(createMessageRow(message));
            }
            messageHost?.append(fragment);
            if (sorted.length) {
                state.latestID = Math.max(state.latestID, Number(sorted[sorted.length - 1].id));
                state.oldestID = Number(sorted[0].id);
                const welcome = byID("mpChatWelcome"); if (welcome) welcome.remove();
            } else {
                state.latestID = 0; state.oldestID = 0;
                if (!byID("mpChatWelcome")) {
                    const welcome = makeElement("div", "mp-chat-welcome"); welcome.id = "mpChatWelcome";
                    const symbol = makeElement("div", "mp-chat-welcome-symbol"); symbol.setAttribute("aria-hidden", "true"); symbol.append(makeElement("span"), makeElement("span"), makeElement("span"));
                    welcome.append(symbol, makeElement("span", "mp-chat-welcome-kicker", "YOU'RE IN THE ROOM"), makeElement("h3", "", "Every story has a voice."), makeElement("p", "", "Say hello, share a recommendation, or start a conversation. Keep it kind, keep it cinematic."));
                    messageHost?.append(welcome);
                }
            }
            if (loadOlderButton) loadOlderButton.hidden = sorted.length < 60;
            if (wasAtBottom || !options.preserveScroll) scrollToBottom("auto");
            else if (history) history.scrollTop = oldScrollTop;
        };

        const fetchMessages = async (parameters = {}) => {
            const url = new URL("/api/community/chat/messages", window.location.origin);
            if (parameters.after) url.searchParams.set("after", String(parameters.after));
            if (parameters.before) url.searchParams.set("before", String(parameters.before));
            if (parameters.limit) url.searchParams.set("limit", String(parameters.limit));
            const payload = await requestJSON(url.toString(), { signal });
            return Array.isArray(payload.messages) ? payload.messages : [];
        };

        const refreshLatest = async ({ silent = true, preserveScroll = true, notifyNew = false } = {}) => {
            const knownLatestID = state.latestID;
            try {
                const messages = await fetchMessages({ limit: 60 });
                if (signal.aborted) return;
                if (silent) {
                    // Polling/SSE refreshes must never clear and rebuild the message list.
                    // Reconcile only new or changed records so the conversation does not blink.
                    if (notifyNew && messages.some((message) => Number(message.id) > knownLatestID && !message.isMine)) {
                        void playTone("incoming");
                    }
                    const orderedMessages = [...messages].sort((a, b) => Number(a.id) - Number(b.id));
                    for (const message of orderedMessages) {
                        const id = Number(message?.id);
                        if (!id) continue;
                        const current = state.messages.get(id);
                        if (!current || JSON.stringify(current) !== JSON.stringify(message)) {
                            upsertMessage(message, {
                                playIncoming: false,
                                silentUpdate: Boolean(current)
                            });
                        }
                    }
                } else {
                    for (const message of messages) upsertMessage(message, { playIncoming: true });
                }
            } catch (error) { if (!signal.aborted && error.status !== 401) announce(error.message || "Could not refresh the chat.", true); }
        };

        const loadNewMessages = async () => {
            try {
                const messages = await fetchMessages({ after: state.latestID, limit: 100 });
                if (signal.aborted) return;
                for (const message of messages) upsertMessage(message, { playIncoming: true });
            } catch (error) { if (!signal.aborted && error.status === 401) setConnection("Please sign in again"); }
        };

        const startLiveEvents = () => {
            if (!window.EventSource) { setConnection("Using periodic refresh"); startFallbackPolling(); return; }
            if (state.eventSource) state.eventSource.close();
            const source = new EventSource(`/api/community/chat/events?after=${encodeURIComponent(state.latestID)}`);
            state.eventSource = source;
            source.onopen = () => { setConnection("Live room · connected", true); if (state.pollTimer) { window.clearInterval(state.pollTimer); state.pollTimer = 0; } };
            source.onmessage = (event) => {
                let payload = {};
                try { payload = JSON.parse(event.data); } catch (_) { return; }
                if (signal.aborted) return;
                if (payload.type === "new") void loadNewMessages();
                else if (payload.type === "sync") void loadNewMessages();
                else if (payload.type === "refresh") void refreshLatest({ silent: true, preserveScroll: true });
            };
            source.onerror = () => {
                if (signal.aborted) return;
                setConnection("Reconnecting · backup refresh active");
                startFallbackPolling();
            };
        };

        const startFallbackPolling = () => {
            if (state.pollTimer) return;
            state.pollTimer = window.setInterval(() => {
                if (signal.aborted || document.hidden) return;
                void refreshLatest({ silent: true, preserveScroll: true, notifyNew: true });
            }, 7000);
        };

        const setPendingMedia = (media) => {
            state.pendingMedia = media;
            state.pendingMovie = null;
            updatePendingBar();
        };

        const removePendingAttachment = () => {
            state.pendingMedia = null;
            state.pendingMovie = null;
            updatePendingBar();
            const imageInput = byID("mpChatImageInput"); const videoInput = byID("mpChatVideoInput");
            if (imageInput) imageInput.value = "";
            if (videoInput) videoInput.value = "";
        };

        const setUploading = (active, label = "Preparing attachment…") => {
            state.mediaBusy = active;
            if (uploadProgress) uploadProgress.hidden = !active;
            if (uploadProgressLabel) uploadProgressLabel.textContent = label;
            if (sendButton) sendButton.disabled = active;
        };

        const uploadFile = async (file, kind, autoSend = false) => {
            const maximum = kind === "image" ? 18 * 1024 * 1024 : kind === "voice" ? 12 * 1024 * 1024 : 24 * 1024 * 1024;
            if (!file || file.size <= 0) { announce("Choose a non-empty file.", true); return; }
            if (file.size > maximum) { announce(`This ${kind} is too large. Maximum: ${formatBytes(maximum)}.`, true); return; }
            setUploading(true, `Uploading ${kind === "voice" ? "voice note" : kind}…`);
            let shouldAutoSend = false;
            const formData = new FormData();
            formData.append("file", file, file.name || `community-${kind}.${kind === "voice" ? "webm" : kind === "video" ? "mp4" : "jpg"}`);
            try {
                const payload = await requestJSON("/api/community/chat/upload", { method: "POST", signal, body: formData });
                if (signal.aborted) return;
                setPendingMedia({ kind, url: payload.url, mimeType: payload.mimeType, fileName: payload.fileName || file.name || kind, fileSize: Number(payload.fileSize) || file.size });
                shouldAutoSend = autoSend;
                announce(autoSend ? "Voice note uploaded. Sending it to the room…" : "Attachment ready. Add a caption or send it.");
            } catch (error) { if (!signal.aborted) announce(error.message || "Upload failed.", true); }
            finally { setUploading(false); }
            // Voice-note stop is an immediate send action; photos/videos remain
            // pending so the user can add a caption and explicitly send them.
            if (shouldAutoSend && !signal.aborted) await sendMessage();
        };

        const sendMessage = async () => {
            if (state.mediaBusy) return;
            const body = String(input?.value || "").trim();
            if (state.editingID) {
                if (!body) { announce("A message cannot be empty.", true); input?.focus(); return; }
                sendButton.disabled = true;
                try {
                    await requestJSON(`/api/community/chat/messages?id=${encodeURIComponent(state.editingID)}`, { method: "PATCH", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
                    announce("Message updated.");
                    clearComposerContext();
                    await refreshLatest({ silent: true, preserveScroll: true });
                } catch (error) { if (!signal.aborted) announce(error.message || "Could not edit the message.", true); }
                finally { if (sendButton && !signal.aborted) sendButton.disabled = false; }
                return;
            }
            if (!body && !state.pendingMedia && !state.pendingMovie) { input?.focus(); return; }
            const message = { body, replyToId: Number(state.replyToID) || 0 };
            if (state.pendingMovie) {
                message.kind = "movie";
                message.movieId = state.pendingMovie.id;
                message.movieTitle = state.pendingMovie.title;
                message.moviePosterUrl = state.pendingMovie.posterUrl || "";
                message.movieOverview = state.pendingMovie.overview || "";
                message.movieReleaseDate = state.pendingMovie.releaseDate || "";
            } else if (state.pendingMedia) {
                message.kind = state.pendingMedia.kind;
                message.attachmentUrl = state.pendingMedia.url;
                message.attachmentMime = state.pendingMedia.mimeType;
                message.attachmentName = state.pendingMedia.fileName;
                message.attachmentSize = state.pendingMedia.fileSize;
            } else message.kind = "text";

            if (sendButton) sendButton.disabled = true;
            try {
                const payload = await requestJSON("/api/community/chat/messages", { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(message) });
                if (signal.aborted) return;
                if (payload.message) { upsertMessage(payload.message, { forceBottom: true }); void playTone("send"); }
                input.value = ""; adjustTextarea(); clearComposerContext(); removePendingAttachment();
                if (moviePicker) moviePicker.hidden = true;
                closeAttachMenu();
                scrollToBottom();
            } catch (error) { if (!signal.aborted) announce(error.message || "Message could not be sent.", true); }
            finally { if (sendButton && !signal.aborted) sendButton.disabled = false; }
        };

        const loadOlderMessages = async () => {
            if (!state.oldestID || !loadOlderButton) return;
            const oldHeight = history.scrollHeight;
            const oldTop = history.scrollTop;
            loadOlderButton.disabled = true;
            loadOlderButton.textContent = "Loading earlier messages…";
            try {
                const messages = await fetchMessages({ before: state.oldestID, limit: 60 });
                if (signal.aborted) return;
                if (!messages.length) { loadOlderButton.hidden = true; return; }
                const fragment = document.createDocumentFragment();
                for (const message of messages) {
                    if (state.messages.has(Number(message.id))) continue;
                    state.messages.set(Number(message.id), message);
                    fragment.append(createMessageRow(message));
                }
                const firstMessageRow = messageHost.querySelector(".mp-chat-message-row");
                if (firstMessageRow) messageHost.insertBefore(fragment, firstMessageRow); else messageHost.prepend(fragment);
                state.oldestID = Math.min(...messages.map((item) => Number(item.id)));
                history.scrollTop = oldTop + (history.scrollHeight - oldHeight);
                loadOlderButton.hidden = messages.length < 60;
            } catch (error) { if (!signal.aborted) announce(error.message || "Could not load earlier messages.", true); }
            finally { if (loadOlderButton && !signal.aborted) { loadOlderButton.disabled = false; loadOlderButton.textContent = "Load earlier messages"; } }
        };

        const closeAttachMenu = () => {
            if (attachMenu) attachMenu.hidden = true;
            if (attachButton) attachButton.setAttribute("aria-expanded", "false");
        };

        const searchMovies = async () => {
            const query = String(movieInput?.value || "").trim();
            if (query.length < 2) { announce("Enter at least two characters of a movie title.", true); movieInput?.focus(); return; }
            if (movieResults) movieResults.replaceChildren(makeElement("p", "mp-chat-picker-hint", "Searching titles…"));
            try {
                const url = new URL("/api/community/chat/movies", window.location.origin);
                url.searchParams.set("q", query);
                const payload = await requestJSON(url.toString(), { signal });
                if (signal.aborted || !movieResults) return;
                movieResults.replaceChildren();
                if (!Array.isArray(payload.movies) || !payload.movies.length) { movieResults.append(makeElement("p", "mp-chat-picker-hint", "No matching titles found. Try another spelling.")); return; }
                payload.movies.forEach((movie) => {
                    const button = makeElement("button", "mp-chat-movie-result"); button.type = "button";
                    if (movie.posterUrl) {
                        const poster = makeElement("img"); poster.src = movie.posterUrl; poster.alt = ""; poster.loading = "lazy"; poster.referrerPolicy = "strict-origin-when-cross-origin";
                        poster.onerror = () => { const fallback = makeElement("span", "mp-chat-movie-result-poster"); fallback.append(icon("movie")); poster.replaceWith(fallback); };
                        button.append(poster);
                    } else { const poster = makeElement("span", "mp-chat-movie-result-poster"); poster.append(icon("movie")); button.append(poster); }
                    const copy = makeElement("span", "mp-chat-movie-result-copy"); copy.append(makeElement("strong", "", safeString(movie.title, "Untitled movie")));
                    copy.append(makeElement("small", "", safeString(movie.releaseDate, "Release date unavailable").slice(0, 4)));
                    if (movie.overview) copy.append(makeElement("span", "", movie.overview));
                    button.append(copy);
                    const action = makeElement("span", "mp-chat-movie-result-action"); action.append(icon("check")); button.append(action);
                    button.addEventListener("click", () => {
                        state.pendingMovie = { id: Number(movie.id), title: safeString(movie.title), posterUrl: safeString(movie.posterUrl), overview: safeString(movie.overview), releaseDate: safeString(movie.releaseDate), exploreUrl: exploreURLFor(movie) };
                        state.pendingMedia = null; updatePendingBar(); moviePicker.hidden = true; announce(`${movie.title} added to your message. Press Send to share it.`); input?.focus({ preventScroll: true });
                    }, { signal });
                    movieResults.append(button);
                });
            } catch (error) { if (!signal.aborted && movieResults) movieResults.replaceChildren(makeElement("p", "mp-chat-picker-hint", error.message || "Movie search is unavailable.")); }
        };

        const startRecording = async () => {
            if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { announce("Voice recording is not supported by this browser. Try a current browser on HTTPS or localhost.", true); return; }
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
                if (signal.aborted) { stream.getTracks().forEach((track) => track.stop()); return; }
                state.recordStream = stream; state.recordChunks = []; state.recordStopRequested = false;
                const mimeCandidates = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
                const mimeType = mimeCandidates.find((type) => MediaRecorder.isTypeSupported?.(type));
                state.recorder = mimeType ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 }) : new MediaRecorder(stream, { audioBitsPerSecond: 128000 });
                state.recorder.ondataavailable = (event) => { if (event.data && event.data.size) state.recordChunks.push(event.data); };
                state.recorder.onerror = () => announce("Recording had a problem. Please try again.", true);
                state.recorder.onstop = async () => {
                    window.clearInterval(state.recordTimer); state.recordTimer = 0;
                    if (voiceButton) { voiceButton.classList.remove("is-recording"); voiceButton.setAttribute("aria-label", "Record a voice note"); voiceButton.dataset.chatTooltip = "Record a voice note"; }
                    if (recordTime) recordTime.hidden = true;
                    if (state.recordStream) { state.recordStream.getTracks().forEach((track) => track.stop()); state.recordStream = null; }
                    const chunks = state.recordChunks.slice(); state.recordChunks = [];
                    if (state.recordStopRequested && chunks.length) {
                        const actualType = state.recorder?.mimeType || mimeType || "audio/webm";
                        const blob = new Blob(chunks, { type: actualType });
                        if (blob.size > 0) {
                            const extension = actualType.includes("ogg") ? "ogg" : actualType.includes("mp4") ? "m4a" : "webm";
                            const file = new File([blob], `movipilot-voice-${Date.now()}.${extension}`, { type: actualType });
                            await uploadFile(file, "voice", true);
                        } else announce("The voice note was empty. Try recording again.", true);
                    }
                    state.recorder = null;
                };
                state.recordStart = Date.now();
                state.recorder.start(250);
                if (voiceButton) { voiceButton.classList.add("is-recording"); voiceButton.setAttribute("aria-label", "Stop recording and prepare voice note"); voiceButton.dataset.chatTooltip = "Stop recording and send voice note"; }
                if (recordTime) recordTime.hidden = false;
                const updateTime = () => {
                    const seconds = Math.floor((Date.now() - state.recordStart) / 1000);
                    if (recordTime) recordTime.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
                    if (seconds >= 180 && state.recorder?.state === "recording") { state.recordStopRequested = true; state.recorder.stop(); announce("The 3-minute voice-note limit was reached. Uploading it now."); }
                };
                updateTime(); state.recordTimer = window.setInterval(updateTime, 250);
                announce("Recording… tap the glowing orb to stop and prepare your voice note.");
            } catch (error) {
                if (!signal.aborted) announce(error?.name === "NotAllowedError" ? "Microphone access was denied. Allow microphone access in your browser to record a voice note." : "Could not access the microphone. Check your device and browser permissions.", true);
            }
        };

        const stopRecording = () => {
            if (state.recorder && state.recorder.state === "recording") {
                state.recordStopRequested = true;
                state.recorder.stop();
            }
        };

        const cleanup = () => {
            if (state.destroyed) return;
            state.destroyed = true;
            closeMediaViewer(false);
            window.clearTimeout(mediaViewerStatusTimer);
            observer.disconnect();
            if (viewportResizeObserver) viewportResizeObserver.disconnect();
            if (viewportClassObserver) viewportClassObserver.disconnect();
            if (viewportAnimationFrame) window.cancelAnimationFrame(viewportAnimationFrame);
            if (mount) {
                mount.style.removeProperty("--mp-chat-viewport-top");
                mount.style.removeProperty("--mp-chat-viewport-left");
                mount.style.removeProperty("--mp-chat-viewport-width");
                mount.style.removeProperty("--mp-chat-viewport-height");
            }
            if (state.eventSource) state.eventSource.close();
            if (state.pollTimer) window.clearInterval(state.pollTimer);
            if (state.toastTimer) window.clearTimeout(state.toastTimer);
            if (state.movieSearchTimer) window.clearTimeout(state.movieSearchTimer);
            if (state.recordTimer) window.clearInterval(state.recordTimer);
            pointerTimers.forEach((timer) => window.clearTimeout(timer)); pointerTimers.clear();
            if (state.recorder && state.recorder.state !== "inactive") { state.recordStopRequested = false; try { state.recorder.stop(); } catch (_) {} }
            if (state.recordStream) state.recordStream.getTracks().forEach((track) => track.stop());
            if (state.audioContext && state.audioContext.state !== "closed") void state.audioContext.close().catch(() => {});
            document.querySelectorAll(".mp-chat-context-menu[data-chat-context-menu='true']").forEach((node) => node.remove());
            root.classList.remove("is-fullpage");
            document.documentElement.classList.remove("mp-community-chat-fullscreen-open");
            document.body.classList.remove("mp-community-chat-fullscreen-open");
            if (activeChatController === controller) activeChatController = null;
            if (activeChatCleanup === cleanup) activeChatCleanup = null;
        };
        activeChatCleanup = cleanup;
        signal.addEventListener("abort", cleanup, { once: true });

        root.addEventListener("pointerdown", () => { void unlockChatAudio(); }, { once: true, signal });
        root.addEventListener("keydown", () => { void unlockChatAudio(); }, { once: true, signal });
        window.addEventListener("resize", closeAllMenus, { passive: true, signal });
        window.addEventListener("resize", scheduleChatViewportSync, { passive: true, signal });
        window.addEventListener("orientationchange", scheduleChatViewportSync, { passive: true, signal });
        window.addEventListener("scroll", closeAllMenus, { passive: true, capture: true, signal });
        sidebarToggle?.addEventListener("click", scheduleChatViewportSync, { signal });
        dashboardSidebar?.addEventListener("transitionrun", scheduleChatViewportSync, { signal });
        dashboardSidebar?.addEventListener("transitionend", scheduleChatViewportSync, { signal });
        dashboardMain?.addEventListener("transitionrun", scheduleChatViewportSync, { signal });
        dashboardMain?.addEventListener("transitionend", scheduleChatViewportSync, { signal });

        form?.addEventListener("submit", (event) => { event.preventDefault(); void sendMessage(); }, { signal });
        input?.addEventListener("input", adjustTextarea, { signal });
        input?.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void sendMessage(); }
        }, { signal });
        closeButton?.addEventListener("click", () => {
            // Return to the Community landing view, preserving the persistent
            // dashboard shell and the member-search state.
            controller.abort();
            if (mount) { mount.hidden = true; mount.classList.remove("is-fullpage"); }
            const communityPage = mount?.closest("#mpCommunityPage") || document.getElementById("mpCommunityPage");
            communityPage?.classList.remove("is-chat-expanded");
            document.documentElement.classList.remove("mp-community-chat-fullscreen-open");
            document.body.classList.remove("mp-community-chat-fullscreen-open");
            const opener = document.getElementById("mpCommunityOpenChat");
            if (opener) { opener.setAttribute("aria-expanded", "false"); opener.focus({ preventScroll: true }); }
        }, { signal });
        attachButton?.addEventListener("click", () => {
            const expanded = attachButton.getAttribute("aria-expanded") === "true";
            attachButton.setAttribute("aria-expanded", String(!expanded));
            if (attachMenu) attachMenu.hidden = expanded;
            if (moviePicker && !moviePicker.hidden) moviePicker.hidden = true;
        }, { signal });
        attachMenu?.querySelectorAll("[data-chat-attach]").forEach((button) => button.addEventListener("click", () => {
            const kind = button.dataset.chatAttach;
            closeAttachMenu();
            if (kind === "image") byID("mpChatImageInput")?.click();
            else if (kind === "video") byID("mpChatVideoInput")?.click();
            else if (kind === "movie") { if (moviePicker) moviePicker.hidden = false; movieInput?.focus(); }
        }, { signal }));
        byID("mpChatImageInput")?.addEventListener("change", (event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file, "image"); }, { signal });
        byID("mpChatVideoInput")?.addEventListener("change", (event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file, "video"); }, { signal });
        byID("mpChatRemoveAttachment")?.addEventListener("click", removePendingAttachment, { signal });
        byID("mpChatCancelContext")?.addEventListener("click", clearComposerContext, { signal });
        byID("mpChatLoadOlder")?.addEventListener("click", () => void loadOlderMessages(), { signal });
        byID("mpChatMoviePickerClose")?.addEventListener("click", () => { if (moviePicker) moviePicker.hidden = true; }, { signal });
        movieForm?.addEventListener("submit", (event) => { event.preventDefault(); void searchMovies(); }, { signal });
        movieInput?.addEventListener("input", () => {
            window.clearTimeout(state.movieSearchTimer);
            const query = movieInput.value.trim();
            if (query.length < 2) return;
            state.movieSearchTimer = window.setTimeout(() => void searchMovies(), 420);
        }, { signal });
        voiceButton?.addEventListener("click", () => {
            if (state.recorder && state.recorder.state === "recording") stopRecording();
            else if (!state.mediaBusy) void startRecording();
        }, { signal });
        mediaViewerClose?.addEventListener("click", () => closeMediaViewer(), { signal });
        mediaViewer?.querySelectorAll("[data-media-viewer-close='true']").forEach((button) => button.addEventListener("click", () => closeMediaViewer(), { signal }));
        mediaViewerPrevious?.addEventListener("click", () => navigateViewerMedia(-1), { signal });
        mediaViewerNext?.addEventListener("click", () => navigateViewerMedia(1), { signal });
        mediaViewerZoomOut?.addEventListener("click", () => setViewerZoom(mediaViewerZoom - 0.25), { signal });
        mediaViewerZoomIn?.addEventListener("click", () => setViewerZoom(mediaViewerZoom + 0.25), { signal });
        mediaViewerFit?.addEventListener("click", () => setViewerZoom(1, true), { signal });
        mediaViewerCopy?.addEventListener("click", () => void copyViewerMediaLink(), { signal });
        mediaViewerDownload?.addEventListener("click", () => void downloadViewerMedia(), { signal });
        mediaViewerFullscreen?.addEventListener("click", () => void toggleViewerFullscreen(), { signal });
        mediaViewerImage?.addEventListener("dblclick", (event) => {
            event.preventDefault();
            setViewerZoom(mediaViewerZoom > 1.01 ? 1 : 2, true);
        }, { signal });
        mediaViewerImage?.addEventListener("pointerdown", (event) => {
            if (mediaViewerZoom <= 1.01 || event.button !== 0) return;
            mediaViewerPanning = true;
            mediaViewerPanPointer = event.pointerId;
            mediaViewerPanStartX = event.clientX;
            mediaViewerPanStartY = event.clientY;
            mediaViewerPanOriginX = mediaViewerPanX;
            mediaViewerPanOriginY = mediaViewerPanY;
            mediaViewerImage.classList.add("is-panning");
            mediaViewerImage.setPointerCapture?.(event.pointerId);
            event.preventDefault();
        }, { signal });
        mediaViewerImage?.addEventListener("pointermove", (event) => {
            if (!mediaViewerPanning || event.pointerId !== mediaViewerPanPointer) return;
            mediaViewerPanX = mediaViewerPanOriginX + event.clientX - mediaViewerPanStartX;
            mediaViewerPanY = mediaViewerPanOriginY + event.clientY - mediaViewerPanStartY;
            applyViewerImageTransform();
        }, { signal });
        const endViewerPan = (event) => {
            if (event.pointerId !== mediaViewerPanPointer) return;
            mediaViewerPanning = false;
            mediaViewerImage?.classList.remove("is-panning");
            applyViewerImageTransform();
        };
        mediaViewerImage?.addEventListener("pointerup", endViewerPan, { signal });
        mediaViewerImage?.addEventListener("pointercancel", endViewerPan, { signal });
        mediaViewerStage?.addEventListener("wheel", (event) => {
            if (mediaViewer.hidden || mediaViewerImageWrap?.hidden || !event.ctrlKey) return;
            event.preventDefault();
            setViewerZoom(mediaViewerZoom + (event.deltaY < 0 ? 0.15 : -0.15));
        }, { passive: false, signal });
        mediaViewer?.addEventListener("keydown", (event) => {
            if (event.key === "Tab") {
                const focusable = [...mediaViewer.querySelectorAll("button:not([disabled]):not([hidden]), video:not([hidden])")]
                    .filter((element) => !element.classList.contains("mp-chat-media-viewer-backdrop") && element.getClientRects().length > 0);
                if (!focusable.length) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && (document.activeElement === first || document.activeElement === mediaViewer)) {
                    event.preventDefault(); last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault(); first.focus();
                }
                return;
            }
            if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && event.target === mediaViewerStage && mediaViewerImageWrap && !mediaViewerImageWrap.hidden) {
                event.preventDefault(); navigateViewerMedia(event.key === "ArrowRight" ? 1 : -1);
            } else if ((event.key === "+" || event.key === "=") && mediaViewerImageWrap && !mediaViewerImageWrap.hidden) {
                event.preventDefault(); setViewerZoom(mediaViewerZoom + 0.25);
            } else if (event.key === "-" && mediaViewerImageWrap && !mediaViewerImageWrap.hidden) {
                event.preventDefault(); setViewerZoom(mediaViewerZoom - 0.25);
            }
        }, { signal });
        document.addEventListener("fullscreenchange", () => {
            const isFullscreen = document.fullscreenElement === mediaViewerPanel;
            mediaViewerFullscreen?.setAttribute("aria-label", isFullscreen ? "Exit full screen" : "Enter full screen");
            mediaViewerFullscreen?.setAttribute("data-chat-tooltip", isFullscreen ? "Exit full screen" : "Full screen");
        }, { signal });

        const isMessagePopupOrTrigger = (target) => {
            if (!(target instanceof Element)) return false;
            return Boolean(target.closest(
                ".mp-chat-context-menu[data-chat-context-menu='true'], " +
                ".mp-chat-reaction-picker, .mp-chat-context-reactions, " +
                ".mp-chat-more-button, .mp-chat-tool-button[aria-label='React to message']"
            ));
        };

        // Pointer-down closes message actions immediately when the user taps/clicks
        // anywhere outside the popup and its trigger, including elsewhere in a row.
        document.addEventListener("pointerdown", (event) => {
            if (isMessagePopupOrTrigger(event.target)) return;
            closeAllMenus();
        }, { capture: true, signal });

        document.addEventListener("click", (event) => {
            if (attachMenu && !attachMenu.hidden && !attachMenu.contains(event.target) && !attachButton?.contains(event.target)) closeAttachMenu();
            if (moviePicker && !moviePicker.hidden && !moviePicker.contains(event.target) && !event.target.closest("[data-chat-attach='movie']")) moviePicker.hidden = true;
            // Keyboard-activated clicks do not necessarily emit pointerdown.
            if (event.detail === 0 && !isMessagePopupOrTrigger(event.target)) closeAllMenus();
        }, { signal });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && mediaViewer && !mediaViewer.hidden) {
                event.preventDefault();
                closeMediaViewer();
                return;
            }
            if (event.key === "Escape") {
                closeAttachMenu();
                if (moviePicker) moviePicker.hidden = true;
                closeAllMenus();
            }
        }, { signal });
        history?.addEventListener("dragover", (event) => {
            if ([...event.dataTransfer?.items || []].some((item) => item.kind === "file")) { event.preventDefault(); history.classList.add("is-drop-target"); }
        }, { signal });
        history?.addEventListener("dragleave", () => history.classList.remove("is-drop-target"), { signal });
        history?.addEventListener("drop", (event) => {
            history.classList.remove("is-drop-target");
            const file = event.dataTransfer?.files?.[0]; if (!file) return; event.preventDefault();
            if (file.type.startsWith("image/")) void uploadFile(file, "image");
            else if (file.type.startsWith("video/")) void uploadFile(file, "video");
            else announce("Drop an image or video. To send audio, use the voice-note recorder.", true);
        }, { signal });

        adjustTextarea();
        showNotice("");
        setConnection("Loading recent messages…");
        try {
            const initial = await fetchMessages({ limit: 60 });
            if (signal.aborted) return;
            renderFullWindow(initial, { preserveScroll: false });
            setConnection("Live room · saved messages", true);
            startLiveEvents();
        } catch (error) {
            if (!signal.aborted) {
                setConnection("Unable to connect");
                showNotice(error.status === 401 ? "Your session has expired. Sign in again to enter the Community chat." : (error.message || "Could not load the chatroom. Please try again."), true);
                const retry = makeElement("button", "mp-chat-load-older", "Try loading messages again");
                retry.type = "button"; retry.addEventListener("click", () => { retry.remove(); void initializeChat(mount); }, { signal });
                messageHost?.prepend(retry);
            }
        }

        input?.focus({ preventScroll: true });
        console.log("[MOVIPILOT] Community chatroom initialized.");
    };

    window.initCommunityChat = initializeChat;
    window.destroyCommunityChat = () => {
        if (activeChatController) activeChatController.abort();
        if (activeChatCleanup) activeChatCleanup();
    };
})();