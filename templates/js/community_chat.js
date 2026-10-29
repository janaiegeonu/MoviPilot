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
        const onlineButton = byID("mpChatOnlineButton");
        const onlineCountLabel = byID("mpChatOnlineCount");
        const mentionButton = byID("mpChatMentionButton");
        const mentionCountLabel = byID("mpChatMentionCount");
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

        // Body-level tooltip portal prevents tooltip text being clipped by the
        // chat history, message stacks, or other ancestors with overflow rules.
        let globalTooltip = null;
        let globalTooltipTarget = null;
        const ensureGlobalTooltip = () => {
            if (globalTooltip?.isConnected) return globalTooltip;
            globalTooltip = makeElement("div", "mp-chat-global-tooltip");
            globalTooltip.hidden = true;
            globalTooltip.setAttribute("role", "tooltip");
            document.body.append(globalTooltip);
            return globalTooltip;
        };
        const hideGlobalTooltip = () => {
            if (globalTooltip) globalTooltip.hidden = true;
            globalTooltipTarget = null;
        };
        const positionGlobalTooltip = () => {
            if (!globalTooltip || globalTooltip.hidden || !globalTooltipTarget?.isConnected) {
                hideGlobalTooltip();
                return;
            }
            const targetRect = globalTooltipTarget.getBoundingClientRect();
            globalTooltip.style.left = "0px";
            globalTooltip.style.top = "0px";
            globalTooltip.style.visibility = "hidden";
            const tooltipRect = globalTooltip.getBoundingClientRect();
            const gutter = 12;
            const left = Math.max(gutter, Math.min(targetRect.left + targetRect.width / 2 - tooltipRect.width / 2, window.innerWidth - tooltipRect.width - gutter));
            let top = targetRect.bottom + 8;
            if (top + tooltipRect.height > window.innerHeight - gutter) top = targetRect.top - tooltipRect.height - 8;
            top = Math.max(gutter, Math.min(top, window.innerHeight - tooltipRect.height - gutter));
            globalTooltip.style.left = `${left}px`;
            globalTooltip.style.top = `${top}px`;
            globalTooltip.style.visibility = "visible";
        };
        const tooltipTargetFrom = (target) => target instanceof Element ? target.closest("[data-chat-tooltip]") : null;
        const showGlobalTooltip = (target) => {
            if (!(target instanceof Element)) return;
            const tooltipText = safeString(target.getAttribute("data-chat-tooltip"));
            if (!tooltipText) { hideGlobalTooltip(); return; }
            const tooltip = ensureGlobalTooltip();
            if (globalTooltipTarget === target && !tooltip.hidden) return;
            globalTooltipTarget = target;
            tooltip.textContent = tooltipText;
            tooltip.hidden = false;
            tooltip.style.visibility = "hidden";
            requestAnimationFrame(positionGlobalTooltip);
        };
        document.addEventListener("pointerover", (event) => {
            const target = tooltipTargetFrom(event.target);
            if (target) showGlobalTooltip(target);
        }, { signal });
        document.addEventListener("pointerout", (event) => {
            const previous = tooltipTargetFrom(event.target);
            if (!previous || previous !== globalTooltipTarget) return;
            if (event.relatedTarget instanceof Node && previous.contains(event.relatedTarget)) return;
            hideGlobalTooltip();
        }, { signal });
        document.addEventListener("focusin", (event) => {
            const target = tooltipTargetFrom(event.target);
            if (target) showGlobalTooltip(target);
        }, { signal });
        document.addEventListener("focusout", (event) => {
            const previous = tooltipTargetFrom(event.target);
            if (!previous || previous !== globalTooltipTarget) return;
            if (event.relatedTarget instanceof Node && previous.contains(event.relatedTarget)) return;
            hideGlobalTooltip();
        }, { signal });
        document.addEventListener("scroll", positionGlobalTooltip, { capture: true, passive: true, signal });
        window.addEventListener("resize", positionGlobalTooltip, { passive: true, signal });

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
            presenceTimer: 0,
            mentionTimer: 0,
            mentionSearchTimer: 0,
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
            if (toast.classList.contains("is-mention-toast") && toast.classList.contains("is-visible")) {
                // Keep the unread mention visible until the user opens or dismisses it.
                console.info("[MOVIPILOT] A chat notice was deferred while a mention alert is visible:", message);
                return;
            }
            window.clearTimeout(state.toastTimer);
            toast.classList.remove("is-mention-toast");
            toast.textContent = message;
            toast.classList.toggle("is-error", Boolean(isError));
            toast.classList.add("is-visible");
            state.toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3300);
        };

        // Presence and mention UI are created by this chat instance so they are
        // removed cleanly when the room closes. No external UI library is required.
        let onlineModal = null;
        let onlineModalReturnFocus = null;
        let mentionMenu = null;
        let mentionQueryStart = -1;
        let mentionQueryEnd = -1;
        let mentionSelectedIndex = 0;
        let mentionCandidates = [];
        const seenMentionIDs = new Set();
        let chatClientID = "";
        // Filled by the authenticated presence response. Never infer the current
        // member from a display name; public IDs are the stable identity key.
        let currentUserPublicID = "";

        const ensureChatClientID = () => {
            if (chatClientID) return chatClientID;
            try {
                const bytes = new Uint8Array(16);
                crypto.getRandomValues(bytes);
                chatClientID = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
            } catch (_) {
                chatClientID = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
            }
            return chatClientID;
        };

        const normalizeSeenTime = (value) => {
            const raw = String(value || "");
            const date = new Date(raw.includes("T") || raw.endsWith("Z") ? raw : `${raw.replace(" ", "T")}Z`);
            if (Number.isNaN(date.getTime())) return "Recently";
            const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
            if (seconds < 60) return "Just now";
            if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
            if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
            return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
        };

        const formatSeenTimestamp = (value) => {
            const raw = String(value || "");
            const date = new Date(raw.includes("T") || raw.endsWith("Z") ? raw : `${raw.replace(" ", "T")}Z`);
            if (Number.isNaN(date.getTime())) return "Timestamp unavailable";
            return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric", hour: "numeric", minute: "2-digit" }).format(date);
        };

        const ensureOnlineModal = () => {
            if (onlineModal?.isConnected) return onlineModal;
            const overlay = makeElement("section", "mp-chat-online-modal");
            overlay.id = "mpChatOnlineModal";
            overlay.hidden = true;
            overlay.setAttribute("role", "dialog");
            overlay.setAttribute("aria-modal", "true");
            overlay.setAttribute("aria-labelledby", "mpChatOnlineModalTitle");
            const backdrop = makeElement("button", "mp-chat-online-backdrop");
            backdrop.type = "button"; backdrop.setAttribute("aria-label", "Close online members");
            const panel = makeElement("div", "mp-chat-online-panel");
            const header = makeElement("header", "mp-chat-online-modal-header");
            const titleWrap = makeElement("div", "");
            titleWrap.append(makeElement("span", "mp-chat-overline", "COMMUNITY PRESENCE"), makeElement("h3", "", "Members online"));
            titleWrap.querySelector("h3").id = "mpChatOnlineModalTitle";
            const close = makeElement("button", "mp-chat-online-close", "×");
            close.type = "button"; close.setAttribute("aria-label", "Close online members");
            header.append(titleWrap, close);
            const summary = makeElement("p", "mp-chat-online-summary", "People here now and members who were recently active.");
            const onlineSection = makeElement("section", "mp-chat-online-section");
            const onlineHeading = makeElement("h4", "", "Online now");
            const onlineList = makeElement("div", "mp-chat-online-list"); onlineList.dataset.list = "online";
            onlineSection.append(onlineHeading, onlineList);
            const recentSection = makeElement("section", "mp-chat-online-section");
            const recentHeading = makeElement("h4", "", "Recently online · last 24 hours");
            const recentList = makeElement("div", "mp-chat-online-list"); recentList.dataset.list = "recent";
            recentSection.append(recentHeading, recentList);
            const footer = makeElement("p", "mp-chat-online-footnote", "Presence updates automatically while a member keeps the chat open.");
            panel.append(header, summary, onlineSection, recentSection, footer);
            overlay.append(backdrop, panel);
            root.append(overlay);
            const closeModal = () => {
                overlay.hidden = true;
                onlineButton?.setAttribute("aria-expanded", "false");
                if (onlineModalReturnFocus?.isConnected) onlineModalReturnFocus.focus({ preventScroll: true });
            };
            backdrop.addEventListener("click", closeModal, { signal });
            close.addEventListener("click", closeModal, { signal });
            overlay.addEventListener("keydown", (event) => {
                if (event.key === "Escape") { event.preventDefault(); closeModal(); }
            }, { signal });
            onlineModal = overlay;
            return overlay;
        };

        const openOwnPrivateProfile = () => {
            const profileButton = document.getElementById("profileButton");
            const profileOverlay = document.getElementById("profileOverlay");
            if (!profileButton || !profileOverlay) {
                announce("Your personal profile is unavailable on this page.", true);
                return;
            }
            // The dashboard's private profile is a separate modal from the public
            // Community member card. Open it only if it is currently closed.
            if (profileOverlay.hidden) {
                profileButton.click();
            } else {
                const focusTarget = profileOverlay.querySelector(
                    '[autofocus], [role="dialog"], button:not([disabled]), [tabindex="0"]'
                );
                focusTarget?.focus?.({ preventScroll: true });
            }
        };

        const openMemberProfileByPublicID = (publicID, options = {}) => {
            const cleanID = safeString(publicID);
            if (!cleanID) {
                announce("This member's profile is unavailable.", true);
                return;
            }
            if (currentUserPublicID && cleanID.toLowerCase() === currentUserPublicID.toLowerCase()) {
                openOwnPrivateProfile();
                return;
            }
            if (typeof window.openMoviPilotCommunityMemberProfile === "function") {
                window.openMoviPilotCommunityMemberProfile(cleanID, options);
            } else {
                announce("The Community profile service is not ready yet.", true);
            }
        };

        const renderPresenceMember = (member, isOnline) => {
            const publicID = safeString(member.publicId);
            const isSelf = Boolean(member.isSelf) || Boolean(currentUserPublicID && publicID &&
                publicID.toLowerCase() === currentUserPublicID.toLowerCase());
            const row = makeElement("button", `mp-chat-online-member${isOnline ? " is-online" : " is-recent"}${isSelf ? " is-self" : ""}`);
            row.type = "button";
            const avatar = makeElement("span", "mp-chat-online-avatar", initials(member.fullName));
            const tone = avatarColorsFor(publicID || member.username || member.fullName);
            avatar.style.setProperty("--mp-avatar-hue", String(tone.primary));
            avatar.style.setProperty("--mp-avatar-hue-two", String(tone.secondary));
            avatar.style.setProperty("--mp-avatar-hue-three", String(tone.tertiary));
            const copy = makeElement("span", "mp-chat-online-member-copy");
            const nameLine = makeElement("span", "mp-chat-online-member-name-line");
            nameLine.append(makeElement("strong", "", member.fullName || member.username || "MoviPilot member"));
            if (isSelf) nameLine.append(makeElement("span", "mp-chat-online-me-badge", "ME"));
            copy.append(nameLine);
            if (member.username) copy.append(makeElement("small", "", `@${member.username}`));
            const status = makeElement("span", "mp-chat-online-member-status");
            status.append(makeElement("i", "", ""), makeElement("span", "", isOnline ? (isSelf ? "You · Online now" : "Online now") : `Last seen ${normalizeSeenTime(member.lastSeenAt)}`));
            if (!isOnline) status.append(makeElement("small", "", formatSeenTimestamp(member.lastSeenAt)));
            row.append(avatar, copy, status);
            row.setAttribute("aria-label", isSelf
                ? `You, ${isOnline ? "online now" : "recently online"}. Open your personal profile.`
                : `${member.fullName || member.username || "Member"}, ${isOnline ? "online now" : "recently online"}. Open public profile.`);
            row.addEventListener("click", () => {
                onlineModal.hidden = true;
                onlineButton?.setAttribute("aria-expanded", "false");
                if (isSelf) {
                    openOwnPrivateProfile();
                    return;
                }
                openMemberProfileByPublicID(publicID, { source: "chat-presence", isOnline });
            }, { signal });
            return row;
        };

        const loadPresence = async (openModal = false, options = {}) => {
            try {
                // Touch the current user's presence before showing the roster. This
                // avoids the initial race where a solo user saw a count of zero.
                if (options.touchFirst) {
                    try {
                        await requestJSON("/api/community/chat/presence", {
                            method: "POST", signal,
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ clientId: ensureChatClientID() })
                        });
                    } catch (heartbeatError) {
                        if (signal.aborted) return;
                        console.warn("[MOVIPILOT] Presence preflight failed; roster GET will retry the self-presence update.", heartbeatError);
                    }
                }
                const url = new URL("/api/community/chat/presence", window.location.origin);
                // The authenticated GET also refreshes the current viewer's per-tab
                // presence server-side before calculating the count. This avoids a
                // zero-user race if the separate POST heartbeat is delayed or blocked.
                url.searchParams.set("clientId", ensureChatClientID());
                const payload = await requestJSON(url.toString(), { signal });
                if (signal.aborted) return;
                const selfRecord = payload?.self && typeof payload.self === "object" ? payload.self : null;
                const selfID = safeString(payload?.selfPublicId || selfRecord?.publicId);
                if (selfID) currentUserPublicID = selfID;
                const reportedCount = Number(payload?.onlineCount);
                if (payload?.onlineCount == null || !Number.isSafeInteger(reportedCount) || reportedCount < 0) {
                    throw new Error("The presence endpoint did not return a valid online count. Check the Community Chat presence route.");
                }
                if (payload?.selfOnline === false) {
                    throw new Error("The server did not confirm your account as online. Check the presence heartbeat and database.");
                }
                // When the backend confirms the current authenticated user is active,
                // a legitimate count cannot be zero, even if a concurrent roster read
                // briefly missed that user's row.
                const onlineCount = Math.max(reportedCount, payload?.selfOnline === true ? 1 : 0);
                if (onlineCountLabel) onlineCountLabel.textContent = String(onlineCount);
                if (onlineButton) {
                    onlineButton.removeAttribute("data-presence-error");
                    onlineButton.removeAttribute("title");
                    onlineButton.setAttribute("aria-label", `${onlineCount} members online. Open member list.`);
                }
                if (openModal || (onlineModal && !onlineModal.hidden)) {
                    const overlay = ensureOnlineModal();
                    const onlineList = overlay.querySelector('[data-list="online"]');
                    const recentList = overlay.querySelector('[data-list="recent"]');
                    let onlineMembers = Array.isArray(payload.online) ? payload.online.map((member) => ({ ...member })) : [];
                    let recentMembers = Array.isArray(payload.recent) ? payload.recent.map((member) => ({ ...member })) : [];
                    const selfMember = selfRecord || onlineMembers.find((member) => currentUserPublicID &&
                        String(member.publicId).toLowerCase() === currentUserPublicID.toLowerCase()) || null;
                    if (currentUserPublicID) {
                        onlineMembers = onlineMembers.map((member) => ({
                            ...member,
                            isSelf: Boolean(member.isSelf) || String(member.publicId).toLowerCase() === currentUserPublicID.toLowerCase()
                        }));
                        recentMembers = recentMembers.map((member) => ({
                            ...member,
                            isSelf: Boolean(member.isSelf) || String(member.publicId).toLowerCase() === currentUserPublicID.toLowerCase()
                        }));
                    }
                    // If the server's paginated roster omitted the authenticated user,
                    // append the server-confirmed self record without duplicating them.
                    if (payload?.selfOnline === true && selfMember?.publicId) {
                        const alreadyListed = onlineMembers.some((member) => String(member.publicId).toLowerCase() === String(selfMember.publicId).toLowerCase());
                        if (!alreadyListed) onlineMembers.unshift({ ...selfMember, isOnline: true, isSelf: true });
                        else onlineMembers = onlineMembers.map((member) => String(member.publicId).toLowerCase() === String(selfMember.publicId).toLowerCase()
                            ? { ...member, isOnline: true, isSelf: true } : member);
                    }
                    onlineList.replaceChildren();
                    recentList.replaceChildren();
                    if (!onlineMembers.length) onlineList.append(makeElement("p", "mp-chat-online-empty", "No members are active right now. Check your connection and try again."));
                    onlineMembers.forEach((member) => onlineList.append(renderPresenceMember(member, true)));
                    const onlineIDs = new Set(onlineMembers.map((member) => String(member.publicId).toLowerCase()));
                    const recentOnly = recentMembers.filter((member) => !onlineIDs.has(String(member.publicId).toLowerCase()));
                    if (!recentOnly.length) recentList.append(makeElement("p", "mp-chat-online-empty", "No other recent visits yet."));
                    recentOnly.forEach((member) => recentList.append(renderPresenceMember(member, false)));
                }
            } catch (error) {
                if (signal.aborted) return;
                // Never disguise a failed endpoint as a legitimate count of zero.
                // An em dash makes broken routing/auth visible instead of misleading.
                if (onlineCountLabel) onlineCountLabel.textContent = "—";
                if (onlineButton) {
                    onlineButton.dataset.presenceError = "true";
                    onlineButton.title = error.status === 401 ? "Sign in again to see online members." : "Online status could not be refreshed. Check the Community Chat routes and try again.";
                    onlineButton.setAttribute("aria-label", "Online status unavailable. Activate to retry.");
                }
                if (error.status !== 401) console.warn("[MOVIPILOT] Presence roster request failed.", error);
                if (openModal) announce(error.message || "Could not load member presence.", true);
            }
        };

        const updateMentionBadge = (count) => {
            if (!mentionCountLabel || !mentionButton) return;
            const safeCount = Math.max(0, Number(count) || 0);
            mentionCountLabel.textContent = safeCount > 99 ? "99+" : String(safeCount);
            mentionCountLabel.hidden = safeCount === 0;
            mentionButton.setAttribute("aria-label", safeCount ? `${safeCount} unread mentions` : "No unread mentions");
        };

        let activeMentionAlertID = 0;
        const showMentionAlert = (mention) => {
            if (!toast || !mention) return;
            window.clearTimeout(state.toastTimer);
            activeMentionAlertID = Number(mention.id) || 0;
            const card = makeElement("div", "mp-chat-mention-toast-card");
            const button = makeElement("button", "mp-chat-mention-toast-action");
            button.type = "button";
            const sender = safeString(mention.senderFullName, mention.senderUsername || "A member");
            button.append(makeElement("strong", "", `${sender} mentioned you`));
            button.append(makeElement("span", "", safeString(mention.messageBody, "Tap to view the message")));
            button.append(makeElement("small", "", "Tap to jump to the conversation ↗"));
            const dismiss = makeElement("button", "mp-chat-mention-toast-dismiss", "×");
            dismiss.type = "button";
            dismiss.setAttribute("aria-label", "Dismiss mention alert. It will remain unread.");
            dismiss.addEventListener("click", (event) => {
                event.stopPropagation();
                toast.classList.remove("is-visible", "is-mention-toast");
                activeMentionAlertID = 0;
                // Dismissing the visual alert does not mark the notification read.
                // A later poll may surface the next unread mention.
                void pollMentions(true);
            }, { signal });
            button.addEventListener("click", async () => {
                toast.classList.remove("is-visible", "is-mention-toast");
                activeMentionAlertID = 0;
                await jumpToMessageAsync(Number(mention.messageId));
                try {
                    await requestJSON("/api/community/chat/mentions/read", {
                        method: "POST", signal,
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ id: Number(mention.id) })
                    });
                    seenMentionIDs.add(Number(mention.id));
                    void pollMentions(true);
                } catch (error) { if (!signal.aborted) announce(error.message || "Could not update mention status.", true); }
            }, { signal });
            card.append(button, dismiss);
            toast.replaceChildren(card);
            toast.classList.remove("is-error");
            toast.classList.add("is-visible", "is-mention-toast");
            // This is an inbox alert, not a fleeting toast: it stays until opened or
            // dismissed, so people returning to the room can actually see it.
            void playTone("incoming");
        };

        const pollMentions = async (showNewAlert = true) => {
            try {
                const payload = await requestJSON("/api/community/chat/mentions", { signal });
                if (signal.aborted) return;
                const mentions = Array.isArray(payload.mentions) ? payload.mentions : [];
                updateMentionBadge(Number(payload.unreadCount) || mentions.length);
                const unseen = mentions.find((item) => !seenMentionIDs.has(Number(item.id)));
                const alertIsOpen = toast?.classList.contains("is-mention-toast") && toast.classList.contains("is-visible");
                if (showNewAlert && unseen && !alertIsOpen) {
                    seenMentionIDs.add(Number(unseen.id));
                    showMentionAlert(unseen);
                }
            } catch (error) {
                if (!signal.aborted && error.status !== 401) console.warn("[MOVIPILOT] Mention notifications could not be refreshed.", error);
            }
        };

        const createMentionMenu = () => {
            if (mentionMenu?.isConnected) return mentionMenu;
            mentionMenu = makeElement("div", "mp-chat-mention-menu");
            mentionMenu.hidden = true;
            mentionMenu.setAttribute("role", "listbox");
            mentionMenu.setAttribute("aria-label", "Mention a community member");
            document.body.append(mentionMenu);
            return mentionMenu;
        };

        const closeMentionMenu = () => {
            if (state.mentionSearchTimer) window.clearTimeout(state.mentionSearchTimer);
            if (mentionMenu) mentionMenu.hidden = true;
            mentionCandidates = [];
            mentionSelectedIndex = 0;
            input?.removeAttribute("aria-activedescendant");
            input?.setAttribute("aria-expanded", "false");
        };

        const positionMentionMenu = () => {
            if (!mentionMenu || !input || mentionMenu.hidden) return;
            const bounds = input.getBoundingClientRect();
            const width = Math.min(360, Math.max(230, bounds.width));
            mentionMenu.style.width = `${Math.min(width, window.innerWidth - 20)}px`;
            mentionMenu.style.left = `${Math.max(10, Math.min(bounds.left, window.innerWidth - width - 10))}px`;
            mentionMenu.style.bottom = `${Math.max(10, window.innerHeight - bounds.top + 8)}px`;
        };

        const renderMentionCandidates = (members) => {
            const menu = createMentionMenu();
            mentionCandidates = members;
            mentionSelectedIndex = 0;
            menu.replaceChildren();
            if (!members.length) {
                closeMentionMenu();
                return;
            } else {
                members.forEach((member, index) => {
                    const option = makeElement("button", `mp-chat-mention-option${index === 0 ? " is-selected" : ""}`);
                    option.type = "button"; option.id = `mpChatMentionOption${index}`;
                    option.setAttribute("role", "option"); option.setAttribute("aria-selected", String(index === 0));
                    const avatar = makeElement("span", "mp-chat-mention-avatar", initials(member.fullName));
                    const copy = makeElement("span", "mp-chat-mention-option-copy");
                    copy.append(makeElement("strong", "", member.fullName || member.username));
                    copy.append(makeElement("small", "", `@${member.username}`));
                    option.append(avatar, copy);
                    option.addEventListener("mousedown", (event) => event.preventDefault(), { signal });
                    option.addEventListener("click", () => insertMention(member), { signal });
                    menu.append(option);
                });
            }
            menu.hidden = false;
            input?.setAttribute("aria-expanded", "true");
            if (mentionCandidates.length) input?.setAttribute("aria-activedescendant", "mpChatMentionOption0");
            positionMentionMenu();
        };

        const searchMentionCandidates = async (query) => {
            // Create the menu before the request. The old version required an
            // existing menu in the response guard, so its very first request
            // was silently discarded and autocomplete never opened.
            const menu = createMentionMenu();
            try {
                const url = new URL("/api/community/chat/members", window.location.origin);
                url.searchParams.set("q", query);
                const payload = await requestJSON(url.toString(), { signal });
                if (signal.aborted || !input || !menu.isConnected) return;
                const current = findMentionQuery();
                if (!current || current.query.toLowerCase() !== query.toLowerCase()) return;
                renderMentionCandidates(Array.isArray(payload.members) ? payload.members : []);
            } catch (error) {
                if (!signal.aborted && error.status !== 401) closeMentionMenu();
            }
        };

        const findMentionQuery = () => {
            if (!input) return null;
            const cursor = input.selectionStart ?? input.value.length;
            const beforeCursor = input.value.slice(0, cursor);
            const at = beforeCursor.lastIndexOf("@");
            if (at < 0) return null;
            const before = at > 0 ? beforeCursor[at - 1] : "";
            if (before && /[\p{L}\p{N}_.+-]/u.test(before)) return null;
            const query = beforeCursor.slice(at + 1);
            // Usernames are single tokens; scope the search to the active handle.
            if (query.length > 80 || /[\s!?;:,@]/u.test(query)) return null;
            if (query && !/^[\p{L}\p{N}_]+$/u.test(query)) return null;
            return { start: at, end: cursor, query };
        };

        const insertMention = (member) => {
            if (!input || !member?.username) return;
            const current = findMentionQuery();
            if (!current) { closeMentionMenu(); return; }
            const value = input.value;
            const replacement = `@${member.username} `;
            input.value = value.slice(0, current.start) + replacement + value.slice(current.end);
            const cursor = current.start + replacement.length;
            input.setSelectionRange(cursor, cursor);
            adjustTextarea();
            closeMentionMenu();
            input.focus({ preventScroll: true });
        };

        const updateMentionSuggestions = () => {
            const current = findMentionQuery();
            if (!current) { closeMentionMenu(); return; }
            mentionQueryStart = current.start; mentionQueryEnd = current.end;
            if (state.mentionSearchTimer) window.clearTimeout(state.mentionSearchTimer);
            state.mentionSearchTimer = window.setTimeout(() => void searchMentionCandidates(current.query), 180);
        };

        const startPresenceAndMentions = () => {
            const clientId = ensureChatClientID();
            const heartbeat = () => {
                if (signal.aborted) return;
                // Do not intentionally stop heartbeats for background tabs. Browsers
                // may throttle timers, but leaving the chat tab open should not itself
                // mark a signed-in member offline.
                void requestJSON("/api/community/chat/presence", {
                    method: "POST", signal,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ clientId })
                }).then((payload) => {
                    if (signal.aborted) return;
                    const selfID = safeString(payload?.selfPublicId || payload?.self?.publicId);
                    if (selfID) currentUserPublicID = selfID;
                    const rawCount = Number(payload?.onlineCount);
                    if (payload?.onlineCount == null || !Number.isSafeInteger(rawCount) || rawCount < 0 || payload?.selfOnline === false) {
                        throw new Error("The presence heartbeat response did not confirm an active user and a valid onlineCount.");
                    }
                    const count = Math.max(rawCount, payload?.selfOnline === true ? 1 : 0);
                    if (onlineCountLabel) onlineCountLabel.textContent = String(count);
                    if (onlineButton) {
                        onlineButton.removeAttribute("data-presence-error");
                        onlineButton.removeAttribute("title");
                        onlineButton.setAttribute("aria-label", `${count} members online. Open member list.`);
                    }
                    // Roster details are fetched only while its modal is open; ordinary
                    // heartbeats return the authoritative count in the same response.
                    if (onlineModal && !onlineModal.hidden) void loadPresence(false);
                }).catch((error) => {
                    if (signal.aborted) return;
                    if (error.status !== 401) console.warn("[MOVIPILOT] Presence POST heartbeat failed; attempting roster self-refresh.", error);
                    // GET refreshes this user's presence before counting, so a POST
                    // failure should not leave this user's count stuck at zero.
                    void loadPresence(false);
                });
            };
            heartbeat();
            state.presenceTimer = window.setInterval(heartbeat, 15000);
            void pollMentions(true);
            state.mentionTimer = window.setInterval(() => {
                if (!signal.aborted && !document.hidden) void pollMentions(true);
            }, 5000);
            document.addEventListener("visibilitychange", () => {
                if (document.hidden) {
                    // Do not mark offline just because a tab is backgrounded; the heartbeat
                    // pauses and the server's 90-second freshness window handles stale tabs.
                    return;
                }
                heartbeat(); void pollMentions(true);
            }, { signal });
            window.addEventListener("pagehide", () => {
                if (!chatClientID) return;
                try {
                    fetch("/api/community/chat/presence", {
                        method: "DELETE", credentials: "same-origin", keepalive: true,
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ clientId: chatClientID })
                    }).catch(() => {});
                } catch (_) {}
            }, { signal });
        };

        onlineButton?.addEventListener("click", () => {
            const overlay = ensureOnlineModal();
            onlineModalReturnFocus = document.activeElement;
            overlay.hidden = false;
            onlineButton.setAttribute("aria-expanded", "true");
            void loadPresence(true, { touchFirst: true });
            overlay.querySelector(".mp-chat-online-close")?.focus({ preventScroll: true });
        }, { signal });

        mentionButton?.addEventListener("click", async () => {
            try {
                const payload = await requestJSON("/api/community/chat/mentions", { signal });
                if (signal.aborted) return;
                const mentions = Array.isArray(payload.mentions) ? payload.mentions : [];
                updateMentionBadge(Number(payload.unreadCount) || mentions.length);
                if (mentions.length) {
                    const target = mentions.find((item) => !seenMentionIDs.has(Number(item.id))) || mentions[0];
                    seenMentionIDs.add(Number(target.id));
                    showMentionAlert(target);
                } else announce("You're all caught up. No unread mentions.");
            } catch (error) { if (!signal.aborted) announce(error.message || "Could not load mentions.", true); }
        }, { signal });

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
                reactionPeekCache.delete(String(Number(message.id)));
                const payload = await requestJSON("/api/community/chat/reaction", {
                    method: "POST", signal, headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ messageId: Number(message.id), reaction })
                });
                if (signal.aborted) return;
                if (payload.message) upsertMessage(payload.message, { playIncoming: false });
                closeAllMenus();
                closeReactionPeek();
            } catch (error) { if (!signal.aborted) announce(error.message || "Could not save that reaction.", true); }
        };

        const closeAllMenus = () => {
            document.querySelectorAll(".mp-chat-context-menu[data-chat-context-menu='true'], .mp-chat-floating-reaction-picker").forEach((node) => node.remove());
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

        // Portal the complete emoji bar to <body>, keeping it outside the message
        // row's overflow/transform ancestors. A 9-column grid lets all reactions fit
        // on small screens without a clipped edge or an inner horizontal scrollbar.
        const openFloatingReactionPicker = (anchor, message) => {
            const existing = document.querySelector(".mp-chat-floating-reaction-picker");
            if (existing && existing.dataset.messageId === String(Number(message.id))) {
                existing.remove();
                return;
            }
            closeAllMenus();
            closeReactionPeek();
            const picker = makeReactionButtons(message, "mp-chat-reaction-picker mp-chat-floating-reaction-picker");
            picker.dataset.messageId = String(Number(message.id));
            picker.style.position = "fixed";
            picker.style.left = "0px";
            picker.style.top = "0px";
            picker.style.visibility = "hidden";
            picker.style.zIndex = "10060";
            document.body.append(picker);
            const anchorRect = anchor.getBoundingClientRect();
            const pickerRect = picker.getBoundingClientRect();
            const gutter = 8;
            const maxLeft = Math.max(gutter, window.innerWidth - pickerRect.width - gutter);
            const left = Math.max(gutter, Math.min(anchorRect.left + anchorRect.width / 2 - pickerRect.width / 2, maxLeft));
            let top = anchorRect.top - pickerRect.height - 8;
            if (top < gutter) top = anchorRect.bottom + 8;
            top = Math.max(gutter, Math.min(top, window.innerHeight - pickerRect.height - gutter));
            picker.style.left = `${Math.round(left)}px`;
            picker.style.top = `${Math.round(top)}px`;
            picker.style.visibility = "visible";
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
            const id = Number(message.id);
            const original = state.messages.get(id) || message;
            const optimisticDeleted = {
                ...original, deleted: true, kind: "deleted", body: "",
                attachmentUrl: "", attachmentMime: "", attachmentName: "",
                attachmentSize: 0, movie: null
            };
            // Optimistically replace the row; no confirmation popup and no
            // success toast. Restore only if the server refuses the deletion.
            upsertMessage(optimisticDeleted, { silentUpdate: true });
            try {
                await requestJSON(`/api/community/chat/messages?id=${encodeURIComponent(id)}`, { method: "DELETE", signal });
                await refreshLatest({ silent: true, preserveScroll: true });
            } catch (error) {
                if (!signal.aborted) {
                    upsertMessage(original, { silentUpdate: true });
                    announce(error.message || "Could not delete that message.", true);
                }
            }
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

        // Reaction details are fetched from the server on demand, then briefly
        // cached per message. The popover is rendered under document.body so a
        // message-history overflow container can never clip the member list.
        let reactionPeekElement = null;
        let reactionPeekTrigger = null;
        let reactionPeekHideTimer = 0;
        let reactionPeekHoverTimer = 0;
        let reactionPeekSequence = 0;
        const reactionPeekCache = new Map();

        const clearReactionPeekHideTimer = () => {
            if (reactionPeekHideTimer) window.clearTimeout(reactionPeekHideTimer);
            reactionPeekHideTimer = 0;
        };
        const closeReactionPeek = () => {
            clearReactionPeekHideTimer();
            if (reactionPeekHoverTimer) window.clearTimeout(reactionPeekHoverTimer);
            reactionPeekHoverTimer = 0;
            reactionPeekSequence += 1;
            if (reactionPeekElement) reactionPeekElement.remove();
            reactionPeekElement = null;
            reactionPeekTrigger = null;
        };
        const scheduleReactionPeekClose = (delay = 220) => {
            clearReactionPeekHideTimer();
            reactionPeekHideTimer = window.setTimeout(() => {
                if (reactionPeekElement?.matches(":hover")) return;
                closeReactionPeek();
            }, delay);
        };
        const positionReactionPeek = (anchor) => {
            if (!reactionPeekElement || reactionPeekElement.hidden || !anchor?.isConnected) return;
            const bounds = anchor.getBoundingClientRect();
            const popup = reactionPeekElement.getBoundingClientRect();
            const gutter = 10;
            const popupWidth = Math.min(popup.width || 320, Math.max(220, window.innerWidth - gutter * 2));
            reactionPeekElement.style.width = `${Math.round(popupWidth)}px`;
            let left = bounds.left + bounds.width / 2 - popupWidth / 2;
            left = Math.max(gutter, Math.min(left, window.innerWidth - popupWidth - gutter));
            let top = bounds.top - popup.height - 9;
            if (top < gutter) top = bounds.bottom + 9;
            top = Math.max(gutter, Math.min(top, window.innerHeight - popup.height - gutter));
            reactionPeekElement.style.left = `${Math.round(left)}px`;
            reactionPeekElement.style.top = `${Math.round(top)}px`;
        };
        const ensureReactionPeek = () => {
            if (reactionPeekElement?.isConnected) return reactionPeekElement;
            const popup = makeElement("section", "mp-chat-reaction-people-popover");
            popup.hidden = true;
            popup.setAttribute("role", "dialog");
            popup.setAttribute("aria-label", "People who reacted to this message");
            const header = makeElement("header", "mp-chat-reaction-people-header");
            const title = makeElement("strong", "", "People who reacted");
            const close = makeElement("button", "mp-chat-reaction-people-close", "×");
            close.type = "button";
            close.setAttribute("aria-label", "Close reaction details");
            close.addEventListener("click", closeReactionPeek, { signal });
            header.append(title, close);
            const body = makeElement("div", "mp-chat-reaction-people-body");
            popup.append(header, body);
            popup.addEventListener("pointerenter", clearReactionPeekHideTimer, { signal });
            popup.addEventListener("pointerleave", () => scheduleReactionPeekClose(300), { signal });
            document.body.append(popup);
            reactionPeekElement = popup;
            return popup;
        };
        const showReactionPeek = async (anchor, message, reaction) => {
            if (!anchor?.isConnected || !message || !reaction || signal.aborted) return;
            clearReactionPeekHideTimer();
            const sequence = ++reactionPeekSequence;
            reactionPeekTrigger = anchor;
            const popup = ensureReactionPeek();
            popup.hidden = false;
            popup.dataset.messageId = String(message.id);
            popup.dataset.reaction = reaction.key;
            popup.querySelector(".mp-chat-reaction-people-header strong").textContent = `${reaction.emoji} ${reaction.label}`;
            const body = popup.querySelector(".mp-chat-reaction-people-body");
            body.replaceChildren(makeElement("p", "mp-chat-reaction-people-loading", "Loading people…"));
            positionReactionPeek(anchor);

            try {
                const cacheKey = String(Number(message.id));
                let record = reactionPeekCache.get(cacheKey);
                if (!record || Date.now() - record.savedAt > 2000) {
                    const url = new URL("/api/community/chat/reactions", window.location.origin);
                    url.searchParams.set("messageId", String(Number(message.id)));
                    const payload = await requestJSON(url.toString(), { signal });
                    record = { savedAt: Date.now(), reactors: Array.isArray(payload.reactors) ? payload.reactors : [] };
                    reactionPeekCache.set(cacheKey, record);
                }
                if (signal.aborted || sequence !== reactionPeekSequence || !popup.isConnected) return;
                const reactors = record.reactors.filter((member) => member.reaction === reaction.key);
                body.replaceChildren();
                const heading = makeElement("p", "mp-chat-reaction-people-count", reactors.length ? `${reactors.length} ${reactors.length === 1 ? "person" : "people"}` : "No one has selected this reaction yet.");
                body.append(heading);
                if (reactors.length) {
                    const list = makeElement("div", "mp-chat-reaction-people-list");
                    reactors.forEach((member) => {
                        const memberPublicID = safeString(member.publicId);
                        // The server marks the authenticated reactor with isSelf.
                        // The public-ID comparison is retained as a compatibility
                        // fallback for an older reaction endpoint response.
                        const isSelf = member.isSelf === true || member.isSelf === 1 ||
                            (Boolean(currentUserPublicID) && Boolean(memberPublicID) &&
                                memberPublicID.toLowerCase() === currentUserPublicID.toLowerCase());
                        const person = makeElement("button", `mp-chat-reaction-person${isSelf ? " is-self" : ""}`);
                        person.type = "button";
                        person.setAttribute("aria-label", isSelf
                            ? "You reacted to this message. Open your personal profile."
                            : `Open ${safeString(member.fullName, member.username || "member")}'s public profile`);
                        const avatar = makeElement("span", "mp-chat-reaction-person-avatar", initials(member.fullName || member.username));
                        const colors = avatarColorsFor(memberPublicID || member.username || member.fullName);
                        avatar.style.setProperty("--mp-avatar-hue", String(colors.primary));
                        avatar.style.setProperty("--mp-avatar-hue-two", String(colors.secondary));
                        avatar.style.setProperty("--mp-avatar-hue-three", String(colors.tertiary));
                        const copy = makeElement("span", "mp-chat-reaction-person-copy");
                        const nameLine = makeElement("span", "mp-chat-reaction-person-name-line");
                        nameLine.append(makeElement("strong", "", member.fullName || member.username || "MoviPilot member"));
                        if (isSelf) nameLine.append(makeElement("span", "mp-chat-reaction-me-badge", "ME"));
                        copy.append(nameLine);
                        if (member.username) copy.append(makeElement("small", "", `@${member.username}`));
                        person.append(avatar, copy);
                        person.addEventListener("click", () => {
                            closeReactionPeek();
                            if (isSelf) {
                                openOwnPrivateProfile();
                            } else if (memberPublicID) {
                                openMemberProfileByPublicID(memberPublicID, { source: "chat-reaction" });
                            } else {
                                announce("This member's profile is unavailable.", true);
                            }
                        }, { signal });
                        list.append(person);
                    });
                    body.append(list);
                    if (record.reactors.length >= 100) body.append(makeElement("small", "mp-chat-reaction-people-note", "Showing the 100 most recent reactions."));
                }
                positionReactionPeek(anchor);
            } catch (error) {
                if (signal.aborted || sequence !== reactionPeekSequence) return;
                body.replaceChildren(makeElement("p", "mp-chat-reaction-people-error", error.message || "Could not load reaction details."));
                positionReactionPeek(anchor);
            }
        };
        const bindReactionPeek = (pill, message, reaction) => {
            let holdTimer = 0;
            let holdTriggered = false;
            pill.addEventListener("pointerdown", (event) => {
                if (event.button !== undefined && event.button !== 0) return;
                holdTriggered = false;
                if (holdTimer) window.clearTimeout(holdTimer);
                holdTimer = window.setTimeout(() => {
                    holdTimer = 0;
                    holdTriggered = true;
                    void showReactionPeek(pill, message, reaction);
                }, event.pointerType === "touch" || event.pointerType === "pen" ? 430 : 620);
            }, { signal });
            pill.addEventListener("pointerup", () => {
                if (holdTimer) window.clearTimeout(holdTimer);
                holdTimer = 0;
                if (holdTriggered) scheduleReactionPeekClose(6000);
            }, { signal });
            pill.addEventListener("pointercancel", () => {
                if (holdTimer) window.clearTimeout(holdTimer);
                holdTimer = 0;
            }, { signal });
            pill.addEventListener("pointerenter", (event) => {
                if (event.pointerType === "touch") return;
                clearReactionPeekHideTimer();
                if (reactionPeekHoverTimer) window.clearTimeout(reactionPeekHoverTimer);
                reactionPeekHoverTimer = window.setTimeout(() => {
                    reactionPeekHoverTimer = 0;
                    void showReactionPeek(pill, message, reaction);
                }, 520);
            }, { signal });
            pill.addEventListener("pointerleave", () => {
                if (holdTimer) window.clearTimeout(holdTimer);
                holdTimer = 0;
                if (reactionPeekHoverTimer) window.clearTimeout(reactionPeekHoverTimer);
                reactionPeekHoverTimer = 0;
                if (!holdTriggered) scheduleReactionPeekClose(260);
            }, { signal });
            pill.addEventListener("contextmenu", (event) => {
                event.preventDefault();
                holdTriggered = true;
                void showReactionPeek(pill, message, reaction);
                scheduleReactionPeekClose(6000);
            }, { signal });
            pill.addEventListener("click", (event) => {
                if (!holdTriggered) return;
                event.preventDefault();
                event.stopPropagation();
                holdTriggered = false;
                scheduleReactionPeekClose(6000);
            }, { signal });
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
                if (message.body) {
                    const messageText = makeElement("p", "mp-chat-message-text");
                    const mentionPattern = /(^|[^\p{L}\p{N}_.+-])@([\p{L}\p{N}_]+)/gu;
                    let lastIndex = 0;
                    for (const match of message.body.matchAll(mentionPattern)) {
                        const matchStart = match.index || 0;
                        const prefix = match[1] || "";
                        const mentionStart = matchStart + prefix.length;
                        const username = match[2];
                        const mentionText = `@${username}`;
                        if (mentionStart > lastIndex) messageText.append(document.createTextNode(message.body.slice(lastIndex, mentionStart)));
                        const mentionLink = makeElement("button", "mp-chat-inline-mention", mentionText);
                        mentionLink.type = "button";
                        mentionLink.dataset.mentionUsername = username;
                        mentionLink.dataset.chatTooltip = `Open @${username}'s public profile`;
                        mentionLink.setAttribute("aria-label", `Open @${username}'s public profile`);
                        mentionLink.addEventListener("click", () => void openMentionProfile(username), { signal });
                        messageText.append(mentionLink);
                        lastIndex = mentionStart + mentionText.length;
                    }
                    if (lastIndex < message.body.length) messageText.append(document.createTextNode(message.body.slice(lastIndex)));
                    bubble.append(messageText);
                }
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
                    event.preventDefault();
                    event.stopPropagation();
                    openFloatingReactionPicker(reactButton, message);
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
                bindReactionPeek(pill, message, reaction);
                pill.addEventListener("click", (event) => {
                    if (event.defaultPrevented) return;
                    // Normal tap/click still adds/removes the current viewer's reaction;
                    // long-press and hover are reserved for the reactor roster.
                    void addReaction(message, reaction.key);
                }, { signal });
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
                openOwnPrivateProfile();
                return;
            }
            const publicId = safeString(message?.sender?.publicId);
            if (publicId) openMemberProfileByPublicID(publicId, { source: "chat-message" });
        };

        const openMentionProfile = async (username) => {
            const cleanUsername = String(username || "").replace(/^@/, "").trim();
            if (!cleanUsername) return;
            try {
                const url = new URL("/api/community/chat/members", window.location.origin);
                url.searchParams.set("username", cleanUsername);
                const payload = await requestJSON(url.toString(), { signal });
                if (signal.aborted) return;
                const publicID = safeString(payload.member?.publicId);
                if (!publicID) throw new Error("That member's public profile is unavailable.");
                openMemberProfileByPublicID(publicID, { source: "chat-mention" });
            } catch (error) {
                if (!signal.aborted) announce(error.message || "Could not open that member's profile.", true);
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

        const jumpToMessageAsync = async (id) => {
            const targetID = Number(id);
            if (!targetID) return;
            let target = root.querySelector(`[data-message-id="${targetID}"]`);
            let attempts = 0;
            while (!target && state.oldestID > 0 && targetID < state.oldestID && attempts < 20 && !signal.aborted) {
                const previousOldest = state.oldestID;
                await loadOlderMessages();
                attempts += 1;
                if (state.oldestID >= previousOldest) break;
                target = root.querySelector(`[data-message-id="${targetID}"]`);
            }
            target = target || root.querySelector(`[data-message-id="${targetID}"]`);
            if (!target) { announce("That mention is older than the available chat history.", true); return; }
            target.scrollIntoView({ behavior: "smooth", block: "center" });
            target.classList.remove("is-highlighted");
            requestAnimationFrame(() => target.classList.add("is-highlighted"));
            window.setTimeout(() => target.classList.remove("is-highlighted"), 1800);
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
            if (exists && reactionPeekCache) reactionPeekCache.delete(String(id));
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
            if (state.presenceTimer) window.clearInterval(state.presenceTimer);
            if (state.mentionTimer) window.clearInterval(state.mentionTimer);
            if (state.mentionSearchTimer) window.clearTimeout(state.mentionSearchTimer);
            if (state.toastTimer) window.clearTimeout(state.toastTimer);
            if (state.movieSearchTimer) window.clearTimeout(state.movieSearchTimer);
            closeReactionPeek();
            if (reactionPeekHoverTimer) window.clearTimeout(reactionPeekHoverTimer);
            if (reactionPeekHideTimer) window.clearTimeout(reactionPeekHideTimer);
            if (mentionMenu) mentionMenu.remove();
            if (onlineModal) onlineModal.remove();
            if (globalTooltip) globalTooltip.remove();
            globalTooltip = null;
            globalTooltipTarget = null;
            if (chatClientID) {
                try { fetch("/api/community/chat/presence", { method: "DELETE", credentials: "same-origin", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: chatClientID }) }).catch(() => {}); } catch (_) {}
            }
            if (state.recordTimer) window.clearInterval(state.recordTimer);
            pointerTimers.forEach((timer) => window.clearTimeout(timer)); pointerTimers.clear();
            if (state.recorder && state.recorder.state !== "inactive") { state.recordStopRequested = false; try { state.recorder.stop(); } catch (_) {} }
            if (state.recordStream) state.recordStream.getTracks().forEach((track) => track.stop());
            if (state.audioContext && state.audioContext.state !== "closed") void state.audioContext.close().catch(() => {});
            document.querySelectorAll(".mp-chat-context-menu[data-chat-context-menu='true'], .mp-chat-floating-reaction-picker").forEach((node) => node.remove());
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
        input?.addEventListener("input", () => { adjustTextarea(); updateMentionSuggestions(); }, { signal });
        input?.addEventListener("click", updateMentionSuggestions, { signal });
        input?.addEventListener("keyup", (event) => {
            if (["ArrowUp", "ArrowDown", "Escape"].includes(event.key)) return;
            updateMentionSuggestions();
        }, { signal });
        input?.addEventListener("keydown", (event) => {
            const activeMentionQuery = findMentionQuery();
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing && activeMentionQuery && (!mentionMenu || mentionMenu.hidden) && activeMentionQuery.query.length > 0) {
                event.preventDefault();
                if (state.mentionSearchTimer) window.clearTimeout(state.mentionSearchTimer);
                void searchMentionCandidates(activeMentionQuery.query);
                return;
            }
            if (mentionMenu && !mentionMenu.hidden && mentionCandidates.length) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    mentionSelectedIndex = (mentionSelectedIndex + (event.key === "ArrowDown" ? 1 : -1) + mentionCandidates.length) % mentionCandidates.length;
                    mentionMenu.querySelectorAll(".mp-chat-mention-option").forEach((option, index) => {
                        option.classList.toggle("is-selected", index === mentionSelectedIndex);
                        option.setAttribute("aria-selected", String(index === mentionSelectedIndex));
                    });
                    input.setAttribute("aria-activedescendant", `mpChatMentionOption${mentionSelectedIndex}`);
                    return;
                }
                if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
                    event.preventDefault(); insertMention(mentionCandidates[mentionSelectedIndex]); return;
                }
                if (event.key === "Escape") { event.preventDefault(); closeMentionMenu(); return; }
            }
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void sendMessage(); }
        }, { signal });
        window.addEventListener("resize", positionMentionMenu, { passive: true, signal });
        history?.addEventListener("scroll", positionMentionMenu, { passive: true, signal });
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
        document.addEventListener("pointerdown", (event) => {
            if (!reactionPeekElement) return;
            if (reactionPeekElement.contains(event.target) || reactionPeekTrigger?.contains(event.target)) return;
            closeReactionPeek();
        }, { capture: true, signal });

        document.addEventListener("click", (event) => {
            if (attachMenu && !attachMenu.hidden && !attachMenu.contains(event.target) && !attachButton?.contains(event.target)) closeAttachMenu();
            if (moviePicker && !moviePicker.hidden && !moviePicker.contains(event.target) && !event.target.closest("[data-chat-attach='movie']")) moviePicker.hidden = true;
            // Keyboard-activated clicks do not necessarily emit pointerdown.
            if (event.detail === 0 && !isMessagePopupOrTrigger(event.target)) closeAllMenus();
        }, { signal });
        document.addEventListener("pointerdown", (event) => {
            if (mentionMenu && !mentionMenu.hidden && !mentionMenu.contains(event.target) && !input?.contains(event.target)) closeMentionMenu();
        }, { capture: true, signal });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && onlineModal && !onlineModal.hidden) {
                event.preventDefault(); onlineModal.hidden = true; onlineButton?.setAttribute("aria-expanded", "false"); onlineButton?.focus({ preventScroll: true }); return;
            }
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

        startPresenceAndMentions();
        input?.focus({ preventScroll: true });
        console.log("[MOVIPILOT] Community chatroom initialized.");
    };

    window.initCommunityChat = initializeChat;
    window.destroyCommunityChat = () => {
        if (activeChatController) activeChatController.abort();
        if (activeChatCleanup) activeChatCleanup();
    };
})();