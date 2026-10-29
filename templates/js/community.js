/* =========================================================
   MOVIPILOT COMMUNITY PAGE
   Loaded once by the persistent dashboard shell. The existing
   dashboard loader calls window.initCommunityPage() after it
   inserts the /community HTML fragment into #dashboardDynamicPage.
   ========================================================= */

(() => {
    "use strict";

    let activeCommunityController = null;
    let communityAnimationFrame = 0;
    let communityToastTimer = 0;
    let activeProfileRequest = 0;

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const safeText = (value, fallback = "") => {
        const text = String(value ?? "").trim();
        return text || fallback;
    };

    const getInitials = (fullName) => {
        const words = safeText(fullName, "MoviPilot member")
            .split(/\s+/)
            .filter(Boolean);

        if (words.length === 0) return "MP";
        if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
        return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    };

    const getAvatarTone = (seed) => {
        let hash = 0;
        const text = String(seed || "MoviPilot");
        for (let index = 0; index < text.length; index += 1) {
            hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
        }
        return Math.abs(hash) % 6;
    };

    const formatJoinedDate = (value) => {
        if (!value) return "Date unavailable";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "Date unavailable";
        return new Intl.DateTimeFormat(undefined, {
            month: "long",
            year: "numeric"
        }).format(date);
    };

    const requestJSON = async (url, options = {}) => {
        const response = await fetch(url, {
            credentials: "same-origin",
            cache: "no-store",
            ...options,
            headers: {
                Accept: "application/json",
                ...(options.headers || {})
            }
        });

        let payload = {};
        try {
            payload = await response.json();
        } catch (_) {
            payload = {};
        }

        if (!response.ok) {
            const message = safeText(payload.error, "The request could not be completed. Please try again.");
            const error = new Error(message);
            error.status = response.status;
            throw error;
        }

        return payload;
    };

    const showCommunityToast = (root, message, isError = false) => {
        const toast = root.querySelector("#mpCommunityToast");
        if (!toast) return;

        window.clearTimeout(communityToastTimer);
        toast.textContent = message;
        toast.classList.toggle("is-error", isError);
        toast.classList.add("is-visible");

        communityToastTimer = window.setTimeout(() => {
            toast.classList.remove("is-visible");
        }, 3000);
    };

    const setProfileStatus = (root, message, isError = false) => {
        // The Collection Hub temporarily portals the profile modal to <body>
        // to escape the Community page stacking context. Resolve globally as a
        // fallback so its status still updates while the modal is portaled.
        const status = root?.querySelector("#mpCommunityProfileStatus")
            || document.getElementById("mpCommunityProfileStatus");
        if (!status) return;
        status.textContent = message;
        status.classList.toggle("is-error", isError);
    };

    const makeSVG = (className, pathD) => {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("aria-hidden", "true");
        if (className) svg.setAttribute("class", className);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", pathD);
        path.setAttribute("stroke", "currentColor");
        path.setAttribute("stroke-width", "1.8");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        svg.appendChild(path);
        return svg;
    };

    const renderLoadingState = (root) => {
        const results = root.querySelector("#mpCommunityResults");
        const count = root.querySelector("#mpCommunityResultsCount");
        if (!results) return;
        results.setAttribute("aria-busy", "true");
        if (count) count.hidden = true;
        results.replaceChildren();

        const loading = document.createElement("div");
        loading.className = "mp-community-loading-card";
        const spinner = document.createElement("span");
        spinner.className = "mp-community-spinner";
        spinner.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.textContent = "Searching the MoviPilot community…";
        loading.append(spinner, label);
        results.appendChild(loading);
    };

    const renderEmptyState = (root, title, description, isError = false) => {
        const results = root.querySelector("#mpCommunityResults");
        if (!results) return;

        results.setAttribute("aria-busy", "false");
        results.replaceChildren();

        const empty = document.createElement("div");
        empty.className = "mp-community-results-empty";
        const symbol = document.createElement("div");
        symbol.className = "mp-community-empty-symbol";
        symbol.setAttribute("aria-hidden", "true");
        const symbolSVG = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        symbolSVG.setAttribute("viewBox", "0 0 64 64");
        symbolSVG.setAttribute("fill", "none");
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", "26"); circle.setAttribute("cy", "25"); circle.setAttribute("r", "13");
        circle.setAttribute("stroke", "currentColor"); circle.setAttribute("stroke-width", "1.6");
        const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
        line.setAttribute("d", "m36 35 12 12"); line.setAttribute("stroke", "currentColor");
        line.setAttribute("stroke-width", "1.8"); line.setAttribute("stroke-linecap", "round");
        symbolSVG.append(circle, line);
        symbol.appendChild(symbolSVG);

        const heading = document.createElement("strong");
        heading.textContent = title;
        if (isError) heading.style.color = "#ffbdcb";
        const copy = document.createElement("p");
        copy.textContent = description;
        empty.append(symbol, heading, copy);
        results.appendChild(empty);

        const count = root.querySelector("#mpCommunityResultsCount");
        if (count) count.hidden = true;
        results.setAttribute("aria-busy", "false");
    };

    const createResultCard = (root, user, openProfile) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "mp-community-result-card";
        if (user.isSelf) button.classList.add("mp-community-result-card--self");
        button.dataset.publicId = safeText(user.publicId);
        button.dataset.isSelf = String(Boolean(user.isSelf));
        button.setAttribute(
            "aria-label",
            user.isSelf
                ? "Open your existing MoviPilot profile card"
                : `Open public profile for ${safeText(user.fullName, "MoviPilot member")}`
        );

        const avatar = document.createElement("span");
        avatar.className = "mp-community-avatar";
        avatar.dataset.avatarTone = String(getAvatarTone(user.publicId || user.username || user.fullName));
        const initials = document.createElement("span");
        initials.textContent = getInitials(user.fullName);
        const dot = document.createElement("i");
        dot.setAttribute("aria-hidden", "true");
        avatar.append(initials, dot);

        const copy = document.createElement("span");
        copy.className = "mp-community-result-copy";
        const nameRow = document.createElement("span");
        nameRow.className = "mp-community-result-name-row";
        const name = document.createElement("strong");
        name.className = "mp-community-result-name";
        name.textContent = safeText(user.fullName, "MoviPilot member");
        nameRow.appendChild(name);
        if (user.isSelf) {
            const selfBadge = document.createElement("span");
            selfBadge.className = "mp-community-self-badge";
            selfBadge.textContent = "ME";
            selfBadge.setAttribute("aria-label", "This is your account");
            nameRow.appendChild(selfBadge);
        }
        const username = document.createElement("span");
        username.className = "mp-community-result-username";
        username.textContent = `@${safeText(user.username, "member")}`;
        const meta = document.createElement("span");
        meta.className = "mp-community-result-meta";
        meta.appendChild(makeSVG("", "M12 8v4l2.5 1.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"));
        const markCount = Number(user.friendCount || 0);
        meta.appendChild(document.createTextNode(`${markCount} ${markCount === 1 ? "friend mark" : "friend marks"}`));
        copy.append(nameRow, username, meta);

        const arrow = document.createElement("span");
        arrow.className = "mp-community-result-arrow";
        arrow.appendChild(makeSVG("", "M5 12h13M13 6l6 6-6 6"));
        button.append(avatar, copy, arrow);
        button.addEventListener("click", () => openProfile(user));
        return button;
    };

    const renderSearchResults = (root, users, openProfile, mode, query) => {
        const results = root.querySelector("#mpCommunityResults");
        const count = root.querySelector("#mpCommunityResultsCount");
        const title = root.querySelector("#mpCommunityResultsTitle");
        if (!results) return;

        results.replaceChildren();
        results.setAttribute("aria-busy", "false");

        if (!Array.isArray(users) || users.length === 0) {
            const byID = mode === "id";
            const isSelfShortcut = mode === "username" && query.trim().toLocaleLowerCase() === "me";
            renderEmptyState(
                root,
                isSelfShortcut
                    ? "Your account could not be found."
                    : byID
                        ? "No member matched that ID."
                        : "No members found for that username.",
                isSelfShortcut
                    ? "We could not load the account connected to your current session. Refresh the page and try again."
                    : byID
                        ? "Check the full MoviPilot ID and try again. IDs are matched exactly."
                        : `We could not find a username matching “${query}”. Check the spelling or try another search.`
            );
            if (title) title.textContent = isSelfShortcut ? "Your account" : "Search results";
            return;
        }

        if (title) {
            const isSelfShortcut = mode === "username" && query.trim().toLocaleLowerCase() === "me";
            title.textContent = isSelfShortcut
                ? "Your account"
                : mode === "id"
                    ? "Member matching this ID"
                    : "Matching members";
        }
        if (count) {
            count.hidden = false;
            count.textContent = `${users.length} ${users.length === 1 ? "member" : "members"}`;
        }

        users.forEach((user, index) => {
            const card = createResultCard(root, user, openProfile);
            card.style.animationDelay = `${Math.min(index * 45, 270)}ms`;
            results.appendChild(card);
        });
    };

    const copyText = async (text) => {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const fallback = document.createElement("textarea");
        fallback.value = text;
        fallback.setAttribute("readonly", "");
        fallback.style.position = "fixed";
        fallback.style.left = "-9999px";
        fallback.style.top = "0";
        document.body.appendChild(fallback);
        fallback.select();
        const successful = document.execCommand("copy");
        fallback.remove();
        if (!successful) throw new Error("Copying is not available in this browser. Select and copy the ID manually.");
    };

    const initializeFlowCanvas = (root, signal) => {
        const canvas = root.querySelector("#mpCommunityFlowCanvas");
        if (!canvas) return;
        const context = canvas.getContext("2d", { alpha: true });
        if (!context) return;

        let width = 0;
        let height = 0;
        let frame = 0;
        let visible = !document.hidden;
        let stopped = false;
        const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

        const resize = () => {
            const rect = canvas.getBoundingClientRect();
            width = Math.max(1, rect.width);
            height = Math.max(1, rect.height);
            canvas.width = Math.round(width * dpr());
            canvas.height = Math.round(height * dpr());
            context.setTransform(dpr(), 0, 0, dpr(), 0, 0);
            if (reducedMotionQuery.matches) draw(0);
        };

        const draw = (time) => {
            if (stopped) return;
            context.clearRect(0, 0, width, height);
            const t = time * 0.00016;
            const ribbonCount = width < 600 ? 7 : 11;
            const lineStep = width < 600 ? 13 : 10;

            for (let ribbon = 0; ribbon < ribbonCount; ribbon += 1) {
                const baseY = height * (0.13 + ribbon * (0.78 / Math.max(1, ribbonCount - 1)));
                const amplitude = height * (0.022 + (ribbon % 4) * 0.009);
                const phase = ribbon * 0.61;
                const gradient = context.createLinearGradient(0, baseY - amplitude * 1.8, width, baseY + amplitude * 1.5);
                gradient.addColorStop(0, "rgba(47, 153, 222, 0)");
                gradient.addColorStop(0.2, `rgba(72, 173, 234, ${0.08 + (ribbon % 3) * 0.022})`);
                gradient.addColorStop(0.55, `rgba(90, 231, 221, ${0.11 + (ribbon % 4) * 0.02})`);
                gradient.addColorStop(0.8, `rgba(64, 188, 199, ${0.07 + (ribbon % 2) * 0.025})`);
                gradient.addColorStop(1, "rgba(99, 179, 251, 0)");

                context.beginPath();
                for (let x = -20; x <= width + 20; x += lineStep) {
                    const progress = x / Math.max(1, width);
                    const envelope = Math.sin(Math.PI * progress) * 0.72 + 0.28;
                    const y = baseY
                        + Math.sin(progress * 7.2 + t * (2.7 + ribbon * 0.055) + phase) * amplitude * envelope
                        + Math.cos(progress * 12.5 - t * 1.65 + phase * 1.6) * amplitude * 0.32;
                    if (x <= -20) context.moveTo(x, y);
                    else context.lineTo(x, y);
                }
                context.strokeStyle = gradient;
                context.lineWidth = ribbon % 4 === 0 ? 1.5 : 0.8;
                context.shadowBlur = ribbon % 3 === 0 ? 7 : 2;
                context.shadowColor = "rgba(79, 220, 221, 0.45)";
                context.stroke();
            }

            context.shadowBlur = 0;
        };

        const animate = (time) => {
            if (stopped || !visible) return;
            draw(time);
            if (!reducedMotionQuery.matches) frame = window.requestAnimationFrame(animate);
        };

        const refresh = () => {
            if (stopped) return;
            window.cancelAnimationFrame(frame);
            if (visible) {
                if (reducedMotionQuery.matches) draw(0);
                else frame = window.requestAnimationFrame(animate);
            }
        };

        const visibilityChange = () => {
            visible = !document.hidden;
            refresh();
        };

        const motionChange = () => refresh();
        const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
        if (resizeObserver) resizeObserver.observe(canvas);
        else window.addEventListener("resize", resize, { signal });
        document.addEventListener("visibilitychange", visibilityChange, { signal });
        if (typeof reducedMotionQuery.addEventListener === "function") reducedMotionQuery.addEventListener("change", motionChange, { signal });

        signal.addEventListener("abort", () => {
            stopped = true;
            window.cancelAnimationFrame(frame);
            if (resizeObserver) resizeObserver.disconnect();
            if (typeof reducedMotionQuery.removeEventListener === "function") reducedMotionQuery.removeEventListener("change", motionChange);
        }, { once: true });

        resize();
        refresh();
    };

    const initializeCommunityPage = () => {
        if (activeCommunityController) activeCommunityController.abort();
        window.cancelAnimationFrame(communityAnimationFrame);
        activeCommunityController = new AbortController();
        const controller = activeCommunityController;
        const { signal } = controller;
        const root = document.getElementById("mpCommunityPage");
        if (!root) return;

        const searchInput = root.querySelector("#mpCommunitySearchInput");
        const searchForm = root.querySelector("#mpCommunitySearchForm");
        const searchButton = root.querySelector(".mp-community-search-submit");
        const modeButtons = Array.from(root.querySelectorAll("[data-community-mode]"));
        const modalLayer = root.querySelector("#mpCommunityModalLayer");
        const modal = root.querySelector("#mpCommunityProfileModal");
        const modalClose = root.querySelector("#mpCommunityProfileClose");
        const friendButton = root.querySelector("#mpCommunityFriendButton");
        const copyButton = root.querySelector("#mpCommunityCopyID");
        const heroCTA = root.querySelector("#mpCommunityFindPeople");
        const openChatButton = root.querySelector("#mpCommunityOpenChat");
        const chatMount = root.querySelector("#mpCommunityChatMount");

        // Do not rely on root.querySelector() for profile elements after the
        // Collection Hub portals #mpCommunityModalLayer directly under <body>.
        // The captured modalLayer reference continues to work in either location.
        const profileQuery = (selector) => modalLayer?.querySelector(selector) || root.querySelector(selector);

        let currentMode = "username";
        let latestSearchSerial = 0;
        let searchTimer = 0;
        let activeProfile = null;
        let previousFocus = null;
        let profileLoading = false;
        let profilePresenceTimer = 0;

        // Self results should use the dashboard's existing profile modal rather
        // than opening a duplicate public Community profile card.
        const openOwnDashboardProfile = () => {
            const profileButton = document.getElementById("profileButton");
            const profileOverlay = document.getElementById("profileOverlay");
            if (!profileButton || !profileOverlay) {
                showCommunityToast(root, "Your dashboard profile card is unavailable on this page.", true);
                return;
            }
            if (profileOverlay.hidden) profileButton.click();
        };

        const openSelectedCommunityProfile = (user) => {
            if (user && user.isSelf) {
                openOwnDashboardProfile();
                return;
            }
            openMemberProfile(user && user.publicId);
        };

        initializeFlowCanvas(root, signal);

        const updateSearchMode = (mode) => {
            currentMode = mode === "id" ? "id" : "username";
            modeButtons.forEach((button) => {
                const isActive = button.dataset.communityMode === currentMode;
                button.classList.toggle("is-active", isActive);
                button.setAttribute("aria-pressed", String(isActive));
            });

            if (searchInput) {
                searchInput.value = "";
                searchInput.placeholder = currentMode === "id"
                    ? "Enter the full MoviPilot ID (MP…)"
                    : "Search name, username, or type ME…";
                searchInput.setAttribute("minlength", currentMode === "id" ? "4" : "2");
                searchInput.setAttribute("maxlength", currentMode === "id" ? "22" : "64");
            }
            if (searchButton) {
                searchButton.disabled = false;
                const buttonText = searchButton.querySelector("span");
                if (buttonText) buttonText.textContent = "Search members";
            }

            latestSearchSerial += 1;
            window.clearTimeout(searchTimer);
            renderEmptyState(
                root,
                "There’s a whole community to meet.",
                currentMode === "id"
                    ? "Enter someone’s full MoviPilot ID to open their public profile."
                    : "Search a username or full name, or type ME to open your own profile card."
            );
            const title = root.querySelector("#mpCommunityResultsTitle");
            if (title) title.textContent = "People to discover";
        };

        const searchMembers = async ({ showValidation = true } = {}) => {
            const query = safeText(searchInput?.value);
            if (!query) {
                if (showValidation) {
                    searchInput?.focus();
                    showCommunityToast(root, currentMode === "id" ? "Enter a full MoviPilot ID first." : "Enter a username to start searching.", true);
                }
                return;
            }

            if (currentMode === "username" && query.length < 2) {
                if (showValidation) showCommunityToast(root, "Enter at least two characters for a username search.", true);
                return;
            }

            if (currentMode === "id" && !/^MP[A-F0-9]{20}$/i.test(query)) {
                if (showValidation) showCommunityToast(root, "That ID format looks incomplete. Enter the full MP code.", true);
                return;
            }

            const requestNumber = ++latestSearchSerial;
            if (searchButton) {
                searchButton.disabled = true;
                const text = searchButton.querySelector("span");
                if (text) text.textContent = "Searching…";
            }
            renderLoadingState(root);

            try {
                const url = new URL("/api/community/users", window.location.origin);
                url.searchParams.set("mode", currentMode);
                url.searchParams.set("q", query);
                const payload = await requestJSON(url.toString(), { signal });
                if (requestNumber !== latestSearchSerial || signal.aborted) return;

                renderSearchResults(root, payload.users || [], openSelectedCommunityProfile, currentMode, query);
            } catch (error) {
                if (signal.aborted || requestNumber !== latestSearchSerial) return;
                renderEmptyState(
                    root,
                    error.status === 401 ? "Sign in to meet the community." : "We couldn’t complete that search.",
                    error.status === 401
                        ? "Your MoviPilot session could not be verified. Sign in and return here."
                        : error.message || "Please check your connection and try again.",
                    true
                );
            } finally {
                if (requestNumber === latestSearchSerial && searchButton) {
                    searchButton.disabled = false;
                    const text = searchButton.querySelector("span");
                    if (text) text.textContent = "Search members";
                }
            }
        };

        const updateAvatar = (user) => {
            const avatar = profileQuery("#mpCommunityProfileAvatar");
            const photo = profileQuery("#mpCommunityProfilePhoto");
            const initials = profileQuery("#mpCommunityProfileInitials");
            if (!avatar || !photo || !initials) return;

            initials.textContent = getInitials(user.fullName);
            avatar.dataset.avatarTone = String(getAvatarTone(user.publicId || user.username || user.fullName));
            const avatarURL = safeText(user.avatarUrl);
            if (avatarURL) {
                photo.onload = () => { photo.hidden = false; initials.hidden = true; };
                photo.onerror = () => { photo.hidden = true; initials.hidden = false; };
                photo.hidden = true;
                initials.hidden = false;
                photo.src = avatarURL;
            } else {
                photo.removeAttribute("src");
                photo.hidden = true;
                initials.hidden = false;
            }
        };

        const updateFriendState = (marked, count) => {
            const label = friendButton?.querySelector(".mp-community-friend-button-label");
            const friendCount = profileQuery("#mpCommunityFriendCount");
            const countLabel = profileQuery("#mpCommunityFriendCountLabel");
            if (!friendButton) return;
            friendButton.classList.toggle("is-marked", Boolean(marked));
            friendButton.setAttribute("aria-pressed", String(Boolean(marked)));
            if (label) label.textContent = marked ? "Marked as friend" : "Mark as friend";
            if (friendCount) friendCount.textContent = String(Math.max(0, Number(count) || 0));
            if (countLabel) countLabel.textContent = Number(count) === 1 ? "member" : "members";

            if (activeProfile) {
                activeProfile.markedByMe = Boolean(marked);
                activeProfile.friendCount = Math.max(0, Number(count) || 0);
            }

            root.querySelectorAll(".mp-community-result-card").forEach((card) => {
                if (card.dataset.publicId !== activeProfile?.publicId) return;
                const meta = card.querySelector(".mp-community-result-meta");
                if (meta) {
                    const countText = meta.lastChild;
                    if (countText && countText.nodeType === Node.TEXT_NODE) {
                        countText.textContent = ` ${activeProfile.friendCount} ${activeProfile.friendCount === 1 ? "friend mark" : "friend marks"}`;
                    }
                }
            });
        };

        const formatPresenceLastSeen = (value) => {
            const raw = String(value || "").trim();
            if (!raw) return "recently";
            const normalized = raw.includes("T")
                ? raw
                : `${raw.replace(" ", "T")}Z`;
            const date = new Date(normalized);
            if (Number.isNaN(date.getTime())) return "recently";
            const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
            if (seconds < 60) return "just now";
            if (seconds < 3600) return `${Math.floor(seconds / 60)} minute${Math.floor(seconds / 60) === 1 ? "" : "s"} ago`;
            if (seconds < 86400) return `${Math.floor(seconds / 3600)} hour${Math.floor(seconds / 3600) === 1 ? "" : "s"} ago`;
            return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
        };

        const refreshMemberProfilePresence = async (publicID, requestNumber) => {
            const description = profileQuery("#mpCommunityProfileDescription");
            if (!description || !publicID) return;
            try {
                const url = new URL("/api/community/chat/presence", window.location.origin);
                url.searchParams.set("publicId", publicID);
                const payload = await requestJSON(url.toString(), { signal });
                if (signal.aborted || requestNumber !== activeProfileRequest || modalLayer?.hidden) return;
                const presence = payload.memberStatus || {};
                if (presence.isOnline) {
                    description.textContent = "Online now · Active in the Community chat";
                    description.dataset.presence = "online";
                    description.setAttribute("aria-label", "Online now, active in the Community chat");
                } else if (presence.hasPresence && presence.lastSeenAt) {
                    description.textContent = `Offline · Last active ${formatPresenceLastSeen(presence.lastSeenAt)}`;
                    description.dataset.presence = "offline";
                    description.removeAttribute("aria-label");
                } else {
                    description.textContent = "No recent Community chat activity";
                    description.dataset.presence = "unknown";
                    description.removeAttribute("aria-label");
                }
            } catch (_) {
                // Presence is supplementary to a public profile. Keep the profile
                // usable if chat presence is unavailable on this server instance.
                if (!signal.aborted && requestNumber === activeProfileRequest && description.isConnected) {
                    description.textContent = "A little look at their MoviPilot identity.";
                    description.dataset.presence = "unknown";
                }
            }
        };

        const renderMemberProfile = (user) => {
            activeProfile = {
                publicId: safeText(user.publicId),
                username: safeText(user.username, "member"),
                markedByMe: Boolean(user.markedByMe),
                friendCount: Math.max(0, Number(user.friendCount) || 0)
            };

            const name = safeText(user.fullName, "MoviPilot member");
            const nameElement = profileQuery("#mpCommunityProfileName");
            const usernameElement = profileQuery("#mpCommunityProfileUsername");
            const publicIDElement = profileQuery("#mpCommunityProfilePublicID");
            const joinedElement = profileQuery("#mpCommunityProfileJoined");
            if (nameElement) nameElement.textContent = name;
            if (usernameElement) usernameElement.textContent = `@${activeProfile.username}`;
            if (publicIDElement) publicIDElement.textContent = activeProfile.publicId || "ID unavailable";
            if (joinedElement) joinedElement.textContent = formatJoinedDate(user.createdAt);
            const heading = profileQuery("#mpCommunityProfileHeading");
            if (heading) heading.textContent = "Member profile";
            const description = profileQuery("#mpCommunityProfileDescription");
            if (description) {
                description.textContent = "Checking Community presence…";
                description.dataset.presence = "checking";
            }
            updateAvatar(user);
            updateFriendState(activeProfile.markedByMe, activeProfile.friendCount);
            if (copyButton) copyButton.disabled = !activeProfile.publicId;
            if (friendButton) friendButton.disabled = !activeProfile.publicId;
            setProfileStatus(root, "");
        };

        async function openMemberProfile(publicId) {
            const cleanID = safeText(publicId);
            if (!cleanID || !modalLayer || !modal) return;
            if (profilePresenceTimer) window.clearInterval(profilePresenceTimer);
            profilePresenceTimer = 0;

            previousFocus = document.activeElement;
            activeProfileRequest += 1;
            const thisProfileRequest = activeProfileRequest;
            activeProfile = null;
            profileLoading = true;
            modalLayer.hidden = false;
            document.body.classList.add("mp-community-modal-open");
            modal.scrollTop = 0;
            modal.focus({ preventScroll: true });

            const loadingName = profileQuery("#mpCommunityProfileName");
            const loadingUsername = profileQuery("#mpCommunityProfileUsername");
            const loadingPublicID = profileQuery("#mpCommunityProfilePublicID");
            const loadingJoined = profileQuery("#mpCommunityProfileJoined");
            const loadingInitials = profileQuery("#mpCommunityProfileInitials");
            const loadingFriendCount = profileQuery("#mpCommunityFriendCount");
            if (loadingName) loadingName.textContent = "Loading member…";
            if (loadingUsername) loadingUsername.textContent = "@loading";
            if (loadingPublicID) loadingPublicID.textContent = cleanID;
            if (loadingJoined) loadingJoined.textContent = "Loading date…";
            if (loadingInitials) loadingInitials.textContent = "MP";
            if (loadingFriendCount) loadingFriendCount.textContent = "—";
            if (copyButton) copyButton.disabled = true;
            if (friendButton) friendButton.disabled = true;
            setProfileStatus(root, "Loading public member details…");

            try {
                const url = new URL("/api/community/user", window.location.origin);
                url.searchParams.set("id", cleanID);
                const payload = await requestJSON(url.toString(), { signal });
                if (signal.aborted || thisProfileRequest !== activeProfileRequest) return;
                const user = payload.user || payload.profile || {};
                renderMemberProfile(user);
                void refreshMemberProfilePresence(cleanID, thisProfileRequest);
                profilePresenceTimer = window.setInterval(() => {
                    void refreshMemberProfilePresence(cleanID, thisProfileRequest);
                }, 25000);
            } catch (error) {
                if (signal.aborted || thisProfileRequest !== activeProfileRequest) return;
                setProfileStatus(root, error.message || "Could not load this public profile.", true);
                const unavailableName = profileQuery("#mpCommunityProfileName");
                const unavailableUsername = profileQuery("#mpCommunityProfileUsername");
                const unavailableJoined = profileQuery("#mpCommunityProfileJoined");
                if (unavailableName) unavailableName.textContent = "Profile unavailable";
                if (unavailableUsername) unavailableUsername.textContent = "@unavailable";
                if (unavailableJoined) unavailableJoined.textContent = "Unavailable";
                if (friendButton) friendButton.disabled = true;
                if (copyButton) copyButton.disabled = true;
            } finally {
                if (thisProfileRequest === activeProfileRequest) profileLoading = false;
            }
        }

        // Expose the existing Community public-profile modal to chat message names.
        // The chat script calls this function instead of creating a second profile UI.
        const openCommunityMemberProfileBridge = (publicID, options = {}) => {
            const description = profileQuery("#mpCommunityProfileDescription");
            if (options?.isOnline && description) {
                description.textContent = "Online now · Active in the Community chat";
                description.dataset.presence = "online";
            }
            return openMemberProfile(publicID);
        };
        window.openMoviPilotCommunityMemberProfile = openCommunityMemberProfileBridge;

        const openOrToggleCommunityChat = async () => {
            if (!openChatButton || !chatMount) return;

            if (!chatMount.hidden) {
                chatMount.hidden = true;
                chatMount.classList.remove("is-fullpage");
                root.classList.remove("is-chat-expanded");
                document.documentElement.classList.remove("mp-community-chat-fullscreen-open");
                document.body.classList.remove("mp-community-chat-fullscreen-open");
                openChatButton.setAttribute("aria-expanded", "false");
                window.destroyCommunityChat?.();
                openChatButton.focus({ preventScroll: true });
                return;
            }

            openChatButton.disabled = true;
            const buttonTitle = openChatButton.querySelector(".mp-community-chat-entry-button-copy strong");
            const originalTitle = buttonTitle?.textContent || "Enter community chat";
            if (buttonTitle) buttonTitle.textContent = "Opening the room…";

            try {
                // The chatroom HTML is a standalone fragment and is only fetched on demand.
                if (!chatMount.querySelector("#mpCommunityChatRoot")) {
                    const response = await fetch("/community/chat", {
                        method: "GET",
                        credentials: "same-origin",
                        cache: "no-store",
                        signal,
                        headers: { "X-Requested-With": "XMLHttpRequest" }
                    });
                    if (!response.ok) {
                        let message = "The community chatroom could not be opened.";
                        try { const text = await response.text(); if (text) message = text.slice(0, 240); } catch (_) {}
                        throw new Error(message);
                    }
                    chatMount.innerHTML = await response.text();
                }

                if (signal.aborted) return;
                chatMount.hidden = false;
                chatMount.classList.add("is-fullpage");
                root.classList.add("is-chat-expanded");
                document.documentElement.classList.add("mp-community-chat-fullscreen-open");
                document.body.classList.add("mp-community-chat-fullscreen-open");
                openChatButton.setAttribute("aria-expanded", "true");
                if (typeof window.initCommunityChat !== "function") {
                    throw new Error("The chatroom script has not loaded. Add community_chat.js to the persistent dashboard shell.");
                }
                await window.initCommunityChat(chatMount);
                // Consume an Explore return request only after the full chat view is restored.
                try { if (sessionStorage.getItem("movipilotCommunityChatReturn") === "1") sessionStorage.removeItem("movipilotCommunityChatReturn"); } catch (_) {}
                chatMount.scrollIntoView({ behavior: reducedMotionQuery.matches ? "auto" : "smooth", block: "start" });
            } catch (error) {
                if (!signal.aborted) {
                    showCommunityToast(root, error.message || "Could not open the community chatroom.", true);
                    chatMount.hidden = true;
                    chatMount.classList.remove("is-fullpage");
                    root.classList.remove("is-chat-expanded");
                    document.documentElement.classList.remove("mp-community-chat-fullscreen-open");
                    document.body.classList.remove("mp-community-chat-fullscreen-open");
                    openChatButton.setAttribute("aria-expanded", "false");
                }
            } finally {
                if (openChatButton) openChatButton.disabled = false;
                if (buttonTitle) buttonTitle.textContent = originalTitle;
            }
        };

        // Stable dashboard-shell entry point: callers outside the Community fragment
        // can open the existing chat implementation without duplicating its UI.
        const openCommunityChatBridge = async () => {
            if (!root.isConnected || !openChatButton || !chatMount) {
                throw new Error("The Community chatroom is not available on this page yet.");
            }
            if (!chatMount.hidden) {
                chatMount.scrollIntoView({ behavior: reducedMotionQuery.matches ? "auto" : "smooth", block: "start" });
                return true;
            }
            await openOrToggleCommunityChat();
            if (chatMount.hidden) throw new Error("The Community chatroom could not be opened. Check your connection and try again.");
            return true;
        };
        window.openMoviPilotCommunityChat = openCommunityChatBridge;

        const closeMemberProfile = () => {
            if (!modalLayer || modalLayer.hidden) return;
            if (profilePresenceTimer) window.clearInterval(profilePresenceTimer);
            profilePresenceTimer = 0;
            activeProfileRequest += 1;
            activeProfile = null;
            profileLoading = false;
            modalLayer.hidden = true;
            document.body.classList.remove("mp-community-modal-open");
            if (previousFocus && typeof previousFocus.focus === "function" && document.contains(previousFocus)) {
                previousFocus.focus({ preventScroll: true });
            }
            previousFocus = null;
        };

        const toggleFriendMark = async () => {
            if (!activeProfile || profileLoading || !friendButton) return;
            const desiredMark = !activeProfile.markedByMe;
            friendButton.disabled = true;
            setProfileStatus(root, desiredMark ? "Adding your friend mark…" : "Removing your friend mark…");

            try {
                const payload = await requestJSON("/api/community/friend", {
                    method: "POST",
                    signal,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        targetPublicId: activeProfile.publicId,
                        marked: desiredMark
                    })
                });

                if (signal.aborted || !activeProfile) return;
                updateFriendState(Boolean(payload.markedByMe), Number(payload.friendCount));
                setProfileStatus(root, payload.markedByMe ? "You’ve marked this member as a friend." : "Your friend mark has been removed.");
                showCommunityToast(root, payload.markedByMe ? "Friend mark added." : "Friend mark removed.");
            } catch (error) {
                if (!signal.aborted) {
                    setProfileStatus(root, error.message || "Could not update this friend mark.", true);
                    showCommunityToast(root, error.message || "Could not update this friend mark.", true);
                }
            } finally {
                if (friendButton && !signal.aborted) friendButton.disabled = !activeProfile;
            }
        };

        modeButtons.forEach((button) => {
            button.addEventListener("click", () => updateSearchMode(button.dataset.communityMode), { signal });
        });

        searchForm?.addEventListener("submit", (event) => {
            event.preventDefault();
            window.clearTimeout(searchTimer);
            searchMembers({ showValidation: true });
        }, { signal });

        searchInput?.addEventListener("input", () => {
            window.clearTimeout(searchTimer);
            if (currentMode !== "username") return;
            const query = searchInput.value.trim();
            if (query.length < 2) {
                if (!query) {
                    renderEmptyState(root, "There’s a whole community to meet.", "Search a username or full name, or type ME to open your own profile card.");
                    const title = root.querySelector("#mpCommunityResultsTitle");
                    if (title) title.textContent = "People to discover";
                }
                return;
            }
            searchTimer = window.setTimeout(() => searchMembers({ showValidation: false }), 380);
        }, { signal });

        heroCTA?.addEventListener("click", () => {
            root.querySelector("#mpCommunityDiscovery")?.scrollIntoView({ behavior: reducedMotionQuery.matches ? "auto" : "smooth", block: "start" });
            window.setTimeout(() => searchInput?.focus({ preventScroll: true }), reducedMotionQuery.matches ? 0 : 250);
        }, { signal });
        openChatButton?.addEventListener("click", () => { void openOrToggleCommunityChat(); }, { signal });

        modalClose?.addEventListener("click", closeMemberProfile, { signal });
        // Keep keyboard focus inside the open card. Escape intentionally does not close it.
        modal?.addEventListener("keydown", (event) => {
            if (event.key !== "Tab") return;
            const focusable = Array.from(modal.querySelectorAll(
                'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'
            )).filter((element) => !element.hasAttribute("hidden"));
            if (focusable.length === 0) {
                event.preventDefault();
                modal.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }, { signal });
        // Consistent with the dashboard profile card: backdrop clicks and Escape do not close it.
        copyButton?.addEventListener("click", async () => {
            const publicID = activeProfile?.publicId;
            if (!publicID) return;
            copyButton.disabled = true;
            try {
                await copyText(publicID);
                copyButton.textContent = "Copied!";
                setProfileStatus(root, "MoviPilot ID copied to clipboard.");
                showCommunityToast(root, "MoviPilot ID copied.");
            } catch (error) {
                setProfileStatus(root, error.message || "Could not copy that ID.", true);
            } finally {
                window.setTimeout(() => {
                    if (copyButton && document.contains(copyButton)) {
                        copyButton.textContent = "Copy ID";
                        copyButton.disabled = !activeProfile?.publicId;
                    }
                }, 1300);
            }
        }, { signal });
        friendButton?.addEventListener("click", toggleFriendMark, { signal });

        // The modal backdrop intentionally has no click-to-close listener.
        // Escape is intentionally not handled, matching the existing profile-card behavior.
        signal.addEventListener("abort", () => {
            window.clearTimeout(searchTimer);
            if (profilePresenceTimer) window.clearInterval(profilePresenceTimer);
            profilePresenceTimer = 0;
            window.clearTimeout(communityToastTimer);
            window.destroyCommunityChat?.();
            if (window.openMoviPilotCommunityMemberProfile === openCommunityMemberProfileBridge) {
                window.openMoviPilotCommunityMemberProfile = null;
            }
            if (window.openMoviPilotCommunityChat === openCommunityChatBridge) {
                window.openMoviPilotCommunityChat = null;
            }
            if (modalLayer) modalLayer.hidden = true;
            if (chatMount) { chatMount.hidden = true; chatMount.classList.remove("is-fullpage"); }
            root.classList.remove("is-chat-expanded");
            document.documentElement.classList.remove("mp-community-chat-fullscreen-open");
            document.body.classList.remove("mp-community-chat-fullscreen-open");
            if (openChatButton) openChatButton.setAttribute("aria-expanded", "false");
            document.body.classList.remove("mp-community-modal-open");
        }, { once: true });

        updateSearchMode("username");
        window.dispatchEvent(new CustomEvent("movipilotCommunityPageReady", { detail: { root } }));
        console.log("[MOVIPILOT] Community page initialized.");

        // A movie card can return the browser directly to /dashboard. If that
        // happens, the session flag restores the user to the same chatroom.
        try {
            if (sessionStorage.getItem("movipilotCommunityChatReturn") === "1") {
                window.setTimeout(() => {
                    if (!signal.aborted && openChatButton && chatMount?.hidden) void openOrToggleCommunityChat();
                }, 80);
            }
        } catch (_) { /* Private browsing may deny sessionStorage; normal back navigation still works. */ }
    };

    window.initCommunityPage = initializeCommunityPage;

    window.addEventListener("pageshow", () => {
        try {
            if (sessionStorage.getItem("movipilotCommunityChatReturn") !== "1") return;
            const mount = document.getElementById("mpCommunityChatMount");
            if (mount && !mount.hidden && document.getElementById("mpCommunityChatRoot")) {
                sessionStorage.removeItem("movipilotCommunityChatReturn");
                return;
            }
            // This is the direct-/dashboard fallback. The initializer above
            // will consume the flag after the Community fragment is loaded.
            const communityButton = document.querySelector('.nav-link[data-page="community"]');
            if (communityButton && !document.getElementById("mpCommunityPage")) communityButton.click();
        } catch (_) { /* A normal history.back() restore remains the fallback. */ }
    });
})();