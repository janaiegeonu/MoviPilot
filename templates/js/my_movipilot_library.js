/* ================================================================
   MOVIPILOT — MY MOVIPILOT PERSONAL LIBRARY MODALS
   Hooks into the existing movipilotSidebarAction CustomEvent emitted by
   dashboard.js. Does not replace or duplicate the sidebar click handler.
   ================================================================ */
(() => {
    "use strict";

    if (window.__mpPersonalLibraryInstalled) return;
    window.__mpPersonalLibraryInstalled = true;

    const API = {
        watchlist: "/api/explore/personal/watchlist",
        history: "/api/explore/personal/history",
        ratings: "/api/explore/personal/ratings"
    };

    const CONFIG = {
        watchlist: {
            title: "Watchlist Library",
            kicker: "MY MOVIPILOT / SAVED STORIES",
            description: "Keep your next great watch close. Your saved movies and series are organized by the day you added them, ready whenever you are.",
            sectionKicker: "YOUR QUEUE",
            sectionTitle: "Saved for later",
            countLabel: "saved titles",
            footer: "Your Watchlist stays until you remove a title.",
            emptyTitle: "Your Watchlist is ready for a story.",
            emptyText: "Add movies or series from Explore and they will appear here, grouped by the day you saved them.",
            emptyIcon: "bookmark"
        },
        history: {
            title: "Recently Explored",
            kicker: "MY MOVIPILOT / YOUR TRAIL",
            description: "Pick up where curiosity took you. Your recent Explore visits stay here for seven days, then are automatically cleared to keep this shelf fresh.",
            sectionKicker: "YOUR RECENT JOURNEY",
            sectionTitle: "Titles you explored",
            countLabel: "recent titles",
            footer: "History expires seven days after your latest visit to a title.",
            emptyTitle: "Your recent journey starts here.",
            emptyText: "Open a movie or series in Explore and it will appear here while your visit is still within the seven-day window.",
            emptyIcon: "history"
        },
        ratings: {
            title: "My Ratings",
            kicker: "MY MOVIPILOT / YOUR VERDICT",
            description: "Your personal scorecard. Revisit the movies and series you have rated and see the stars you gave each story.",
            sectionKicker: "YOUR SCORECARD",
            sectionTitle: "Stories you rated",
            countLabel: "rated titles",
            footer: "Your ratings are saved to your MoviPilot account.",
            emptyTitle: "Your scorecard is waiting.",
            emptyText: "When you save a rating on an eligible Explore title, it will be listed here with your stars and the date you last rated it.",
            emptyIcon: "star"
        }
    };

    const byID = (id) => document.getElementById(id);
    const modal = byID("mpPersonalLibraryModal");
    const dialog = byID("mpPersonalLibraryDialog");
    const closeButton = byID("mpPersonalLibraryClose");
    const titleNode = byID("mpPersonalLibraryTitle");
    const kickerNode = byID("mpPersonalLibraryKicker");
    const descriptionNode = byID("mpPersonalLibraryDescription");
    const countNode = byID("mpPersonalLibraryCount");
    const countLabelNode = byID("mpPersonalLibraryCountLabel");
    const sectionKickerNode = byID("mpPersonalLibrarySectionKicker");
    const sectionTitleNode = byID("mpPersonalLibrarySectionTitle");
    const resultCountNode = byID("mpPersonalLibraryResultCount");
    const footerNoteNode = byID("mpPersonalLibraryFooterNote");
    const itemsNode = byID("mpPersonalLibraryItems");
    const statusNode = byID("mpPersonalLibraryStatus");
    const searchInput = byID("mpPersonalLibrarySearch");
    const dateInput = byID("mpPersonalLibraryDate");
    const clearFilterButton = byID("mpPersonalLibraryClearFilter");

    if (!modal || !dialog || !closeButton || !itemsNode) {
        console.error("[MOVIPILOT] Personal library modal markup is missing from dashboard.html.");
        return;
    }

    let currentMode = "watchlist";
    let currentItems = [];
    let activeRequest = null;
    let requestSerial = 0;
    let priorFocus = null;
    let previousBodyOverflow = "";
    let statusTimer = 0;
    let modalOpen = false;

    const safeText = (value, fallback = "") => {
        const text = String(value ?? "").trim();
        return text || fallback;
    };

    const createNode = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = String(text);
        return node;
    };

    const svgIcon = (name, className = "") => {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("aria-hidden", "true");
        if (className) svg.setAttribute("class", className);

        const paths = {
            open: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
            trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/>',
            bookmark: '<path d="M7 4.5A1.5 1.5 0 0 1 8.5 3h7A1.5 1.5 0 0 1 17 4.5V21l-5-3.2L7 21V4.5Z"/>',
            history: '<path d="M4 10a8 8 0 1 1-.1 4M4 4v6h6"/><path d="M12 7v5l3.5 2"/>',
            star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
            empty: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M8 5V3.5M16 5V3.5M4 9.5h16M8 13h3m-3 3h6"/>'
        };
        svg.innerHTML = paths[name] || paths.empty;
        svg.querySelectorAll("path, rect").forEach((element) => {
            element.setAttribute("stroke", "currentColor");
            element.setAttribute("stroke-width", "1.6");
            element.setAttribute("stroke-linecap", "round");
            element.setAttribute("stroke-linejoin", "round");
        });
        return svg;
    };

    const requestJSON = async (url, options = {}, signal) => {
        const response = await fetch(url, {
            credentials: "same-origin",
            cache: "no-store",
            signal,
            ...options,
            headers: {
                Accept: "application/json",
                ...(options.headers || {})
            }
        });
        let payload = {};
        try { payload = await response.json(); } catch (_) { payload = {}; }
        if (!response.ok) {
            const error = new Error(safeText(payload.error, `Request failed (${response.status}).`));
            error.status = response.status;
            throw error;
        }
        return payload;
    };

    const getActivityValue = (item) => {
        if (currentMode === "watchlist") return item.addedAt || "";
        if (currentMode === "history") return item.viewedAt || "";
        return item.ratedAt || "";
    };

    const parseDate = (value) => {
        if (!value) return null;
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const localDateKey = (value) => {
        const date = value instanceof Date ? value : parseDate(value);
        if (!date) return "";
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    };

    const formatDateHeading = (value) => {
        const date = parseDate(value);
        if (!date) return "Date unavailable";
        const todayKey = localDateKey(new Date());
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        if (localDateKey(date) === todayKey) return "Today";
        if (localDateKey(date) === localDateKey(yesterday)) return "Yesterday";
        return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(date);
    };

    const formatDateTime = (value) => {
        const date = parseDate(value);
        if (!date) return "Time unavailable";
        return new Intl.DateTimeFormat(undefined, {
            month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
        }).format(date);
    };

    const formatShortDate = (value) => {
        const date = parseDate(value);
        if (!date) return "Date unavailable";
        return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
    };

    const setStatus = (message, type = "", timeout = 0) => {
        window.clearTimeout(statusTimer);
        statusNode.replaceChildren();
        statusNode.className = "mp-library-status";
        statusNode.hidden = !message;
        if (!message) return;
        if (type) statusNode.classList.add(`is-${type}`);
        statusNode.textContent = message;
        if (timeout > 0) {
            statusTimer = window.setTimeout(() => {
                statusNode.hidden = true;
                statusNode.textContent = "";
            }, timeout);
        }
    };

    const updateModeCopy = (mode) => {
        const config = CONFIG[mode];
        modal.dataset.mode = mode;
        titleNode.textContent = config.title;
        kickerNode.textContent = config.kicker;
        descriptionNode.textContent = config.description;
        countLabelNode.textContent = config.countLabel;
        sectionKickerNode.textContent = config.sectionKicker;
        sectionTitleNode.textContent = config.sectionTitle;
        footerNoteNode.textContent = config.footer;
        searchInput.value = "";
        dateInput.value = "";
        clearFilterButton.hidden = true;
    };

    const isFilterActive = () => Boolean(searchInput.value.trim() || dateInput.value);

    const updateCounts = (filteredCount) => {
        countNode.textContent = currentItems.length.toLocaleString();
        resultCountNode.textContent = `${filteredCount.toLocaleString()} ${filteredCount === 1 ? "title" : "titles"}`;
        clearFilterButton.hidden = !isFilterActive();
    };

    const makeEmptyState = (title, description, iconName = "empty") => {
        const empty = createNode("div", "mp-library-empty-state");
        const symbol = createNode("div", "mp-library-empty-symbol");
        symbol.append(svgIcon(iconName));
        empty.append(symbol, createNode("strong", "", title), createNode("p", "", description));
        return empty;
    };

    const exploreURL = (item) => `/explore?type=${encodeURIComponent(item.mediaType === "tv" ? "tv" : "movie")}&id=${encodeURIComponent(Number(item.mediaId) || 0)}`;

    const makePoster = (item) => {
        const link = createNode("a", "mp-library-poster-link");
        link.href = exploreURL(item);
        link.setAttribute("aria-label", `Open ${safeText(item.title, "title")} in Explore`);
        if (item.posterUrl) {
            const image = createNode("img");
            image.src = item.posterUrl;
            image.alt = `${safeText(item.title, "Movie or series")} poster`;
            image.loading = "lazy";
            image.decoding = "async";
            image.referrerPolicy = "strict-origin-when-cross-origin";
            image.addEventListener("error", () => {
                const fallback = createNode("div", "mp-library-poster-fallback");
                fallback.append(svgIcon("empty"));
                image.replaceWith(fallback);
            }, { once: true });
            link.append(image);
        } else {
            const fallback = createNode("div", "mp-library-poster-fallback");
            fallback.append(svgIcon("empty"));
            link.append(fallback);
        }
        return link;
    };

    const makeRatingStars = (rating) => {
        const wrapper = createNode("span", "mp-library-rating-stars");
        wrapper.setAttribute("aria-label", `${rating} out of 5 stars`);
        for (let value = 1; value <= 5; value += 1) {
            const star = createNode("span", "", value <= rating ? "★" : "☆");
            star.setAttribute("aria-hidden", "true");
            wrapper.append(star);
        }
        return wrapper;
    };

    const makeExpiry = (item) => {
        const expires = parseDate(item.expiresAt);
        const viewed = parseDate(item.viewedAt);
        if (!expires || !viewed) return null;
        const now = Date.now();
        const remainingMs = expires.getTime() - now;
        const remainingDays = Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
        const elapsedFraction = Math.min(1, Math.max(0, (now - viewed.getTime()) / (7 * 24 * 60 * 60 * 1000)));
        const wrapper = createNode("span", `mp-library-expiry${remainingMs <= 48 * 60 * 60 * 1000 ? " is-soon" : ""}`);
        const expiryText = remainingMs <= 0 ? "Expires soon" : `Expires ${formatShortDate(item.expiresAt)}`;
        const label = createNode("span", "", expiryText);
        const bar = createNode("span", "mp-library-expiry-bar");
        const progress = createNode("span");
        progress.style.transform = `scaleX(${Math.max(0.02, 1 - elapsedFraction)})`;
        bar.append(progress);
        wrapper.append(label, createNode("strong", "", remainingMs <= 0 ? "due now" : `${remainingDays} ${remainingDays === 1 ? "day" : "days"} left`), bar);
        return wrapper;
    };

    const createLibraryCard = (item) => {
        const article = createNode("article", "mp-library-item");
        article.dataset.mediaType = item.mediaType;
        article.dataset.mediaId = String(item.mediaId);
        article.append(makePoster(item));

        const copy = createNode("div", "mp-library-item-copy");
        const tags = createNode("div", "mp-library-item-tags");
        tags.append(createNode("span", "mp-library-type-tag", safeText(item.mediaTypeLabel, item.mediaType === "tv" ? "TV Series" : "Movie")));
        if (item.year) tags.append(createNode("span", "mp-library-year-tag", item.year));
        copy.append(tags);

        const titleLink = createNode("a", "mp-library-item-title", safeText(item.title, "Untitled story"));
        titleLink.href = exploreURL(item);
        copy.append(titleLink);
        if (item.overview) copy.append(createNode("p", "mp-library-item-overview", item.overview));

        const meta = createNode("div", "mp-library-item-meta");
        if (currentMode === "watchlist") {
            meta.append(createNode("span", "", `Added ${formatDateTime(item.addedAt)}`));
        } else if (currentMode === "history") {
            meta.append(createNode("span", "", `Last explored ${formatDateTime(item.viewedAt)}`));
        } else {
            const ratingLine = createNode("span", "mp-library-rating-line");
            const rating = Math.max(0, Math.min(5, Number(item.rating) || 0));
            ratingLine.append(makeRatingStars(rating), createNode("strong", "mp-library-rating-value", `${rating}/5`));
            meta.append(ratingLine, createNode("span", "", `Rated ${formatDateTime(item.ratedAt)}`));
        }
        if (Number(item.voteAverage) > 0) {
            meta.append(createNode("span", "", `TMDB ${Number(item.voteAverage).toFixed(1)}`));
        }
        copy.append(meta);

        if (currentMode === "history") {
            const expiry = makeExpiry(item);
            if (expiry) copy.append(expiry);
        }
        article.append(copy);

        const actions = createNode("div", "mp-library-item-actions");
        const openLink = createNode("a", "mp-library-open-link");
        openLink.href = exploreURL(item);
        openLink.setAttribute("aria-label", `Open ${safeText(item.title, "title")} in Explore`);
        openLink.append(svgIcon("open"), createNode("span", "", "Explore"));
        actions.append(openLink);

        if (currentMode === "watchlist" || currentMode === "history") {
            const remove = createNode("button", "mp-library-delete");
            remove.type = "button";
            remove.dataset.libraryRemove = currentMode;
            remove.dataset.mediaType = item.mediaType;
            remove.dataset.mediaId = String(item.mediaId);
            const removeLabel = currentMode === "watchlist" ? "Remove from Watchlist" : "Remove from recent history";
            remove.setAttribute("aria-label", `${removeLabel}: ${safeText(item.title, "title")}`);
            remove.title = removeLabel;
            remove.append(svgIcon("trash"));
            actions.append(remove);
        }
        article.append(actions);
        return article;
    };

    const filteredItems = () => {
        const query = searchInput.value.trim().toLocaleLowerCase();
        const selectedDate = dateInput.value;
        return currentItems.filter((item) => {
            const title = safeText(item.title).toLocaleLowerCase();
            const overview = safeText(item.overview).toLocaleLowerCase();
            if (query && !title.includes(query) && !overview.includes(query)) return false;
            if (selectedDate && localDateKey(getActivityValue(item)) !== selectedDate) return false;
            return true;
        });
    };

    const render = () => {
        const config = CONFIG[currentMode];
        const matches = filteredItems();
        updateCounts(matches.length);
        itemsNode.replaceChildren();
        itemsNode.setAttribute("aria-busy", "false");

        if (!currentItems.length) {
            itemsNode.append(makeEmptyState(config.emptyTitle, config.emptyText, config.emptyIcon));
            return;
        }
        if (!matches.length) {
            itemsNode.append(makeEmptyState(
                "No titles match these filters.",
                "Try a different title or date, or clear your filters to see the full shelf.",
                "empty"
            ));
            return;
        }

        const groups = new Map();
        matches.forEach((item) => {
            const activity = getActivityValue(item);
            const key = localDateKey(activity) || "unknown-date";
            if (!groups.has(key)) groups.set(key, { label: formatDateHeading(activity), items: [] });
            groups.get(key).items.push(item);
        });

        groups.forEach((group) => {
            const section = createNode("section", "mp-library-day-group");
            const heading = createNode("h4", "mp-library-day-heading");
            heading.append(createNode("strong", "", group.label));
            heading.append(createNode("span", "", `${group.items.length} ${group.items.length === 1 ? "title" : "titles"}`));
            section.append(heading);
            group.items.forEach((item) => section.append(createLibraryCard(item)));
            itemsNode.append(section);
        });
    };

    const showLoading = () => {
        setStatus("Loading your personal library…", "loading");
        itemsNode.replaceChildren();
        itemsNode.setAttribute("aria-busy", "true");
        const loading = makeEmptyState("Gathering your stories…", "Your saved titles and timestamps are being loaded securely.", "history");
        itemsNode.append(loading);
    };

    const loadMode = async (mode) => {
        if (!modalOpen || !API[mode]) return;
        currentMode = mode;
        updateModeCopy(mode);
        currentItems = [];
        const serial = ++requestSerial;
        if (activeRequest) activeRequest.abort();
        activeRequest = new AbortController();
        showLoading();

        try {
            const payload = await requestJSON(API[mode], {}, activeRequest.signal);
            if (!modalOpen || serial !== requestSerial) return;
            currentItems = Array.isArray(payload.items) ? payload.items : [];
            setStatus("", "");
            render();
        } catch (error) {
            if (error.name === "AbortError" || !modalOpen || serial !== requestSerial) return;
            setStatus(error.status === 401 ? "Your session has expired. Sign in again, then reopen your library." : (error.message || "Could not load your library. Try again."), "error");
            itemsNode.replaceChildren(makeEmptyState("Your library could not load.", "Your saved data has not been removed. Use the reload button below to try again.", "empty"));
            const retry = createNode("button", "mp-library-clear-filter", "Try again");
            retry.type = "button";
            retry.addEventListener("click", () => { void loadMode(mode); });
            itemsNode.firstElementChild.append(retry);
            itemsNode.setAttribute("aria-busy", "false");
            updateCounts(0);
        }
    };

    const openModal = (mode) => {
        if (!API[mode]) return;
        const wasOpen = modalOpen;
        if (!wasOpen) {
            priorFocus = document.activeElement;
            previousBodyOverflow = document.body.style.overflow;
            document.body.style.overflow = "hidden";
            modal.hidden = false;
            modalOpen = true;
            closeButton.focus({ preventScroll: true });
        }
        void loadMode(mode);
    };

    const closeModal = () => {
        if (!modalOpen) return;
        modalOpen = false;
        requestSerial += 1;
        if (activeRequest) activeRequest.abort();
        activeRequest = null;
        window.clearTimeout(statusTimer);
        modal.hidden = true;
        document.body.style.overflow = previousBodyOverflow;
        setStatus("", "");
        currentItems = [];
        if (priorFocus && typeof priorFocus.focus === "function" && document.contains(priorFocus)) {
            priorFocus.focus({ preventScroll: true });
        }
        priorFocus = null;

                /* Notify the dashboard that the modal has closed. */

        window.dispatchEvent(
            new CustomEvent(
                "movipilotSidebarModalClosed",
                {
                    detail: {
                        source: "personal-library"
                    }
                }
            )
);
    };

    const deleteItem = async (button) => {
        if (!modalOpen || button.disabled) return;
        const mode = button.dataset.libraryRemove;
        const mediaType = button.dataset.mediaType;
        const mediaID = Number(button.dataset.mediaId);
        if (!API[mode] || !["movie", "tv"].includes(mediaType) || !Number.isInteger(mediaID) || mediaID <= 0) return;

        const item = currentItems.find((entry) => entry.mediaType === mediaType && Number(entry.mediaId) === mediaID);
        if (!item) return;
        if (mode === "watchlist" && !window.confirm(`Remove “${safeText(item.title, "this title")}” from your Watchlist?`)) return;

        button.disabled = true;
        try {
            const url = new URL(API[mode], window.location.origin);
            url.searchParams.set("type", mediaType);
            url.searchParams.set("id", String(mediaID));
            const payload = await requestJSON(url.toString(), { method: "DELETE" });
            if (payload.removed === false) {
                currentItems = currentItems.filter((entry) => !(entry.mediaType === mediaType && Number(entry.mediaId) === mediaID));
            } else {
                currentItems = currentItems.filter((entry) => !(entry.mediaType === mediaType && Number(entry.mediaId) === mediaID));
            }
            setStatus(mode === "watchlist" ? "Removed from your Watchlist." : "Removed from recent history.", "", 2600);
            render();
        } catch (error) {
            setStatus(error.message || "Could not remove this title. Please try again.", "error", 3600);
            button.disabled = false;
        }
    };

    const trapTab = (event) => {
        if (!modalOpen || event.key !== "Tab") return;
        const focusable = Array.from(dialog.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'))
            .filter((element) => !element.closest("[hidden]") && element.getClientRects().length > 0);
        if (!focusable.length) {
            event.preventDefault();
            dialog.focus();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
            event.preventDefault();
            first.focus();
        }
    };

    window.addEventListener("movipilotSidebarAction", (event) => {
        const action = event.detail && event.detail.action;
        if (API[action]) openModal(action);
    });

    closeButton.addEventListener("click", closeModal);
    itemsNode.addEventListener("click", (event) => {
        const button = event.target.closest("[data-library-remove]");
        if (button) void deleteItem(button);
    });
    searchInput.addEventListener("input", render);
    dateInput.addEventListener("change", render);
    clearFilterButton.addEventListener("click", () => {
        searchInput.value = "";
        dateInput.value = "";
        render();
        searchInput.focus({ preventScroll: true });
    });

    dialog.addEventListener("keydown", trapTab);
    dialog.addEventListener("keydown", (event) => {
        if (event.key === "/" && event.target !== searchInput && !["INPUT", "TEXTAREA"].includes(event.target.tagName)) {
            event.preventDefault();
            searchInput.focus({ preventScroll: true });
        }
        // By design, Escape and backdrop clicks do not close this modal. The X
        // control is the only close action, matching the existing profile card.
    });
})();
