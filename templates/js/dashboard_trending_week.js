/* =========================================================
   MOVIPILOT — TRENDING THIS WEEK

   Loads the weekly movie chart from the Go API and builds
   safe, accessible Explore links for each TMDB movie.
   ========================================================= */

(() => {
    "use strict";

    const rail = document.getElementById("dashboardWeeklyTrendingRail");
    if (!rail || rail.dataset.weeklyTrendingInitialized === "true") {
        return;
    }

    rail.dataset.weeklyTrendingInitialized = "true";

    const API_URL = "/api/dashboard/trending-week";
    const list = document.getElementById("weeklyTrendingList");
    const scrollArea = document.getElementById("weeklyTrendingScroll");
    const countLabel = document.getElementById("weeklyTrendingCount");
    const updatedLabel = document.getElementById("weeklyTrendingUpdated");
    const scrollUpButton = document.getElementById("weeklyTrendingScrollUp");
    const scrollDownButton = document.getElementById("weeklyTrendingScrollDown");

    if (!list || !scrollArea) {
        console.warn("[MoviPilot] Weekly trending markup is incomplete.");
        return;
    }

    let requestController = null;

    const starIcon = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m12 2.8 2.83 5.74 6.34.92-4.59 4.47 1.08 6.31L12 17.26l-5.66 2.98 1.08-6.31-4.59-4.47 6.34-.92L12 2.8Z"/>
        </svg>
    `;

    const arrowIcon = `
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M8 5L15 12L8 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;

    function makeElement(tagName, className, text) {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        if (text !== undefined && text !== null) {
            element.textContent = String(text);
        }
        return element;
    }

    function safeImageURL(value) {
        if (typeof value !== "string" || !value.trim()) return "";

        try {
            const url = new URL(value, window.location.origin);
            if (
                url.protocol !== "https:" ||
                url.hostname !== "image.tmdb.org" ||
                !url.pathname.startsWith("/t/p/")
            ) {
                return "";
            }
            return url.href;
        } catch (error) {
            return "";
        }
    }

    function formatUpdatedAt(value) {
        if (!value) return "Recently updated";

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "Recently updated";

        return `Updated ${new Intl.DateTimeFormat(undefined, {
            hour: "numeric",
            minute: "2-digit"
        }).format(date)}`;
    }

    function normaliseRating(value) {
        const rating = Number(value);
        if (!Number.isFinite(rating) || rating <= 0) return "NR";
        return rating.toFixed(1);
    }

    function createMovieCard(movie, index) {
        const id = Number(movie.id);
        const title = String(movie.title || "Untitled movie").trim();

        if (!Number.isSafeInteger(id) || id <= 0) {
            return null;
        }

        const href = `/explore?type=movie&id=${encodeURIComponent(id)}`;
        const card = makeElement("a", "weekly-movie-card mp-explore-button");
        card.href = href;
        card.dataset.mediaType = "movie";
        card.dataset.mediaId = String(id);
        card.setAttribute("aria-label", `Explore ${title}`);
        card.style.animationDelay = `${Math.min(index, 12) * 28}ms`;

        const poster = makeElement("span", "weekly-movie-poster");
        const fallback = makeElement("span", "weekly-movie-poster-fallback", title.charAt(0).toUpperCase());
        fallback.setAttribute("aria-hidden", "true");
        poster.appendChild(fallback);

        const posterURL = safeImageURL(movie.posterUrl);
        if (posterURL) {
            const image = document.createElement("img");
            image.src = posterURL;
            image.alt = `${title} poster`;
            image.loading = index < 4 ? "eager" : "lazy";
            image.decoding = "async";
            image.addEventListener("load", () => {
                image.classList.add("is-loaded");
                fallback.hidden = true;
            }, { once: true });
            image.addEventListener("error", () => image.remove(), { once: true });
            poster.appendChild(image);
        }

        const rank = makeElement("span", "weekly-movie-rank", String(movie.rank || index + 1).padStart(2, "0"));
        rank.setAttribute("aria-label", `Rank ${movie.rank || index + 1}`);
        poster.appendChild(rank);

        const copy = makeElement("span", "weekly-movie-copy");
        const heading = makeElement("h3", "weekly-movie-title", title);
        copy.appendChild(heading);

        const meta = makeElement("span", "weekly-movie-meta");
        if (movie.year) {
            meta.appendChild(makeElement("span", "weekly-movie-year", movie.year));
        }

        const rating = makeElement("span", "weekly-movie-rating");
        rating.innerHTML = starIcon;
        rating.appendChild(document.createTextNode(` ${normaliseRating(movie.rating)}`));
        meta.appendChild(rating);

        if (movie.language) {
            const language = String(movie.language).slice(0, 2).toUpperCase();
            meta.appendChild(makeElement("span", "weekly-movie-language", language));
        }
        copy.appendChild(meta);

        const genres = Array.isArray(movie.genres) ? movie.genres.slice(0, 2) : [];
        if (genres.length) {
            const genreContainer = makeElement("span", "weekly-movie-genres");
            genres.forEach((genre) => {
                const genreName = String(genre || "").trim();
                if (genreName) {
                    genreContainer.appendChild(makeElement("span", "weekly-movie-genre", genreName));
                }
            });
            if (genreContainer.childElementCount) copy.appendChild(genreContainer);
        }

        const overviewText = String(movie.overview || "").trim();
        const overview = makeElement(
            "p",
            "weekly-movie-overview",
            overviewText || "Open this title to discover its story, cast and more."
        );
        copy.appendChild(overview);

        const arrow = makeElement("span", "weekly-movie-arrow");
        arrow.innerHTML = arrowIcon;
        arrow.setAttribute("aria-hidden", "true");

        card.append(poster, copy, arrow);
        return card;
    }

    function renderMovies(payload) {
        const movies = Array.isArray(payload.items) ? payload.items : [];
        const fragment = document.createDocumentFragment();
        let renderedCount = 0;

        movies.forEach((movie, index) => {
            const card = createMovieCard(movie, index);
            if (card) {
                fragment.appendChild(card);
                renderedCount += 1;
            }
        });

        list.replaceChildren();
        list.setAttribute("aria-busy", "false");

        if (!renderedCount) {
            showEmptyState("No weekly movies are available yet.", "Check back shortly for the latest movie chart.", false);
            return;
        }

        list.appendChild(fragment);
        countLabel.textContent = `${renderedCount} movies in the chart`;
        updatedLabel.textContent = formatUpdatedAt(payload.updatedAt);
        updatedLabel.classList.toggle("weekly-trending-status-stale", payload.stale === true);

        if (payload.stale === true) {
            updatedLabel.textContent = "Showing last available update";
        }

        updateScrollButtons();
    }

    function showEmptyState(title, description, canRetry) {
        list.replaceChildren();
        list.setAttribute("aria-busy", "false");

        const empty = makeElement("div", "weekly-trending-empty");
        empty.appendChild(makeElement("div", "weekly-trending-empty-icon", "✦"));
        empty.appendChild(makeElement("strong", "", title));
        empty.appendChild(makeElement("p", "", description));

        if (canRetry) {
            const retry = makeElement("button", "weekly-trending-retry", "Try again");
            retry.type = "button";
            retry.addEventListener("click", loadTrendingMovies);
            empty.appendChild(retry);
        }

        list.appendChild(empty);
        countLabel.textContent = "Weekly chart";
        updatedLabel.textContent = "Unable to sync";
        updateScrollButtons();
    }

    function updateScrollButtons() {
        if (!scrollUpButton || !scrollDownButton) return;

        const maxScroll = Math.max(0, scrollArea.scrollHeight - scrollArea.clientHeight);
        scrollUpButton.disabled = scrollArea.scrollTop <= 2;
        scrollDownButton.disabled = scrollArea.scrollTop >= maxScroll - 2;
    }

    async function loadTrendingMovies() {
        if (requestController) requestController.abort();
        requestController = new AbortController();

        const timeout = window.setTimeout(() => requestController?.abort(), 15000);
        list.setAttribute("aria-busy", "true");

        try {
            const response = await fetch(API_URL, {
                method: "GET",
                headers: { "Accept": "application/json" },
                credentials: "same-origin",
                cache: "no-store",
                signal: requestController.signal
            });

            if (!response.ok) {
                throw new Error(`Weekly trends request failed (${response.status}).`);
            }

            const payload = await response.json();
            if (!payload || !Array.isArray(payload.items)) {
                throw new Error("The weekly trends response was not in the expected format.");
            }

            renderMovies(payload);

        } catch (error) {
            if (error.name === "AbortError") {
                showEmptyState(
                    "The chart is taking longer than usual.",
                    "Please try again when the connection is ready.",
                    true
                );
            } else {
                console.error("[MoviPilot] Could not load weekly movie trends:", error);
                showEmptyState(
                    "Weekly trends are unavailable.",
                    "We couldn't reach the movie chart right now.",
                    true
                );
            }
        } finally {
            window.clearTimeout(timeout);
            requestController = null;
        }
    }

    scrollUpButton?.addEventListener("click", () => {
        scrollArea.scrollBy({ top: -Math.max(220, scrollArea.clientHeight * 0.72), behavior: "smooth" });
    });

    scrollDownButton?.addEventListener("click", () => {
        scrollArea.scrollBy({ top: Math.max(220, scrollArea.clientHeight * 0.72), behavior: "smooth" });
    });

    scrollArea.addEventListener("scroll", updateScrollButtons, { passive: true });
    window.addEventListener("resize", updateScrollButtons, { passive: true });

    // A focused keyboard user can scroll using the standard arrow/page keys.
    scrollArea.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" || event.key === "PageDown") {
            event.preventDefault();
            scrollArea.scrollBy({ top: event.key === "PageDown" ? scrollArea.clientHeight * 0.8 : 90, behavior: "smooth" });
        } else if (event.key === "ArrowUp" || event.key === "PageUp") {
            event.preventDefault();
            scrollArea.scrollBy({ top: event.key === "PageUp" ? -scrollArea.clientHeight * 0.8 : -90, behavior: "smooth" });
        }
    });

    loadTrendingMovies();
})();
