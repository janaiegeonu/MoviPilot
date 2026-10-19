(() => {
    "use strict";

    document.addEventListener("DOMContentLoaded", () => {
        const form = document.getElementById("smartSearchForm");
        if (!form) return;

        const modeInput = document.getElementById("searchModeInput");
        const pageInput = document.getElementById("searchPageInput");
        const modeButtons = Array.from(document.querySelectorAll(".search-mode-tab[data-search-mode]"));
        const modePanels = Array.from(document.querySelectorAll("[data-search-panel]"));
        const mediaFilter = document.getElementById("searchMediaFilter");
        const sortSelect = document.getElementById("searchResultSort");
        const resultsGrid = document.getElementById("searchResultsGrid");
        const clearButton = document.getElementById("searchClearButton");
        const toast = document.getElementById("searchToast");
        const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        const titleInput = document.getElementById("searchTitleInput");
        const genreInput = document.getElementById("searchGenreInput");
        const yearInput = document.getElementById("searchYearInput");
        const yearGenreInput = document.getElementById("searchYearGenreInput");
        const keywordInput = document.getElementById("searchKeywordInput");
        const genreIDInput = document.getElementById("searchGenreID");
        const yearGenreIDInput = document.getElementById("searchYearGenreID");
        const keywordIDInput = document.getElementById("searchKeywordID");

        // The UI key and API mode are separate so the year panel can reuse genre autocomplete.
        const suggestionInputs = {
            title: {
                input: titleInput,
                box: document.getElementById("titleSuggestions"),
                apiMode: "title",
                activeMode: "title"
            },
            genre: {
                input: genreInput,
                box: document.getElementById("genreSuggestions"),
                apiMode: "genre",
                activeMode: "genre"
            },
            yearGenre: {
                input: yearGenreInput,
                box: document.getElementById("yearGenreSuggestions"),
                apiMode: "genre",
                activeMode: "year"
            },
            keyword: {
                input: keywordInput,
                box: document.getElementById("keywordSuggestions"),
                apiMode: "keyword",
                activeMode: "keyword"
            }
        };

        const debounceTimers = new Map();
        const activeRequests = new Map();
        let toastTimer = 0;

        const showToast = (message) => {
            if (!toast) return;
            toast.textContent = message;
            toast.classList.add("is-visible");
            window.clearTimeout(toastTimer);
            toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
        };

        const currentMode = () => modeInput?.value || "title";

        const closeSuggestions = (exceptKey = "") => {
            Object.entries(suggestionInputs).forEach(([key, group]) => {
                if (key === exceptKey) return;
                if (group.box) group.box.hidden = true;
                group.input?.setAttribute("aria-expanded", "false");
                group.box?.closest(".search-input-panel")?.classList.remove("has-open-suggestions");
            });
        };

        const activateMode = (mode, focusInput = false) => {
            const safeMode = ["title", "genre", "year", "keyword"].includes(mode) ? mode : "title";
            if (modeInput) modeInput.value = safeMode;
            document.body.dataset.searchMode = safeMode;

            modeButtons.forEach((button) => {
                const active = button.dataset.searchMode === safeMode;
                button.classList.toggle("is-active", active);
                button.setAttribute("aria-pressed", String(active));
            });
            modePanels.forEach((panel) => {
                const active = panel.dataset.searchPanel === safeMode;
                panel.hidden = !active;
                panel.classList.toggle("is-active", active);
                if (!active) panel.classList.remove("has-open-suggestions");
            });
            closeSuggestions();
            if (pageInput) pageInput.value = "1";

            if (focusInput) {
                const group = safeMode === "year" ? null : suggestionInputs[safeMode];
                const target = group?.input || (safeMode === "year" ? yearInput : titleInput);
                window.setTimeout(() => target?.focus(), 25);
            }
        };

        modeButtons.forEach((button) => {
            button.addEventListener("click", () => activateMode(button.dataset.searchMode || "title", true));
        });

        const buildSuggestionButton = (groupKey, suggestion) => {
            const group = suggestionInputs[groupKey];
            const isTitle = groupKey === "title";
            const isGenre = groupKey === "genre" || groupKey === "yearGenre";
            const button = document.createElement("button");
            button.type = "button";
            button.className = "search-suggestion-item";
            button.setAttribute("role", "option");

            if (isTitle) {
                const poster = document.createElement("span");
                poster.className = "search-suggestion-poster";
                if (suggestion.posterURL) {
                    const image = document.createElement("img");
                    image.src = suggestion.posterURL;
                    image.alt = "";
                    image.loading = "lazy";
                    image.addEventListener("error", () => image.remove(), { once: true });
                    poster.appendChild(image);
                }
                button.appendChild(poster);
            }

            const copy = document.createElement("span");
            copy.className = "search-suggestion-copy";
            const name = document.createElement("strong");
            name.textContent = suggestion.name || "Untitled";
            copy.appendChild(name);

            const details = document.createElement("small");
            if (isTitle) {
                const labels = [suggestion.type === "tv" ? "Series" : "Movie"];
                if (suggestion.year) labels.push(suggestion.year);
                if (Number(suggestion.rating) > 0) labels.push(`★ ${Number(suggestion.rating).toFixed(1)}`);
                details.textContent = labels.join(" · ");
            } else if (isGenre && groupKey === "yearGenre") {
                details.textContent = "Narrow the results to this genre and year";
            } else if (isGenre) {
                details.textContent = "Discover titles in this genre";
            } else {
                details.textContent = "Find titles with this theme";
            }
            copy.appendChild(details);
            button.appendChild(copy);

            if (!isTitle) {
                const kind = document.createElement("span");
                kind.className = "search-suggestion-kind";
                kind.textContent = isGenre ? "Genre" : "Keyword";
                button.appendChild(kind);
            }

            button.addEventListener("click", () => {
                const value = suggestion.name || "";
                if (groupKey === "title") {
                    if (titleInput) titleInput.value = value;
                } else if (groupKey === "genre") {
                    if (genreInput) genreInput.value = value;
                    if (genreIDInput) genreIDInput.value = String(suggestion.id || "");
                } else if (groupKey === "yearGenre") {
                    if (yearGenreInput) yearGenreInput.value = value;
                    if (yearGenreIDInput) yearGenreIDInput.value = String(suggestion.id || "");
                } else if (groupKey === "keyword") {
                    if (keywordInput) keywordInput.value = value;
                    if (keywordIDInput) keywordIDInput.value = String(suggestion.id || "");
                }
                closeSuggestions();
                if (pageInput) pageInput.value = "1";
                form.requestSubmit ? form.requestSubmit() : form.submit();
            });
            return button;
        };

        const showSuggestionResults = (groupKey, suggestions) => {
            const group = suggestionInputs[groupKey];
            const box = group?.box;
            if (!group || !box || currentMode() !== group.activeMode) return;
            box.replaceChildren();

            if (!suggestions.length) {
                const empty = document.createElement("div");
                empty.className = "search-suggestions-empty";
                empty.textContent = groupKey === "genre" || groupKey === "yearGenre"
                    ? "No matching genre. Try a broader genre name."
                    : groupKey === "keyword"
                        ? "No matching keyword yet. Try another phrase."
                        : "No close matches yet. You can still search the full title.";
                box.appendChild(empty);
            } else {
                suggestions.forEach((suggestion) => box.appendChild(buildSuggestionButton(groupKey, suggestion)));
            }

            box.hidden = false;
            group.input?.setAttribute("aria-expanded", "true");
            box.closest(".search-input-panel")?.classList.add("has-open-suggestions");
            closeSuggestions(groupKey);
        };

        const fetchSuggestions = async (groupKey, query) => {
            const group = suggestionInputs[groupKey];
            if (!group?.box || !group.input || currentMode() !== group.activeMode) return;
            const trimmed = query.trim();
            if (trimmed.length < 2) {
                group.box.hidden = true;
                group.box.replaceChildren();
                group.input.setAttribute("aria-expanded", "false");
                group.box.closest(".search-input-panel")?.classList.remove("has-open-suggestions");
                return;
            }

            activeRequests.get(groupKey)?.abort();
            const controller = new AbortController();
            activeRequests.set(groupKey, controller);

            const params = new URLSearchParams({ mode: group.apiMode, q: trimmed });
            if (mediaFilter) params.set("media", mediaFilter.value);

            try {
                const response = await fetch(`/api/search/suggestions?${params.toString()}`, {
                    method: "GET",
                    headers: { Accept: "application/json" },
                    signal: controller.signal,
                    credentials: "same-origin"
                });
                if (!response.ok) throw new Error(`Suggestion request failed: ${response.status}`);
                const payload = await response.json();
                if (group.input.value.trim() !== trimmed || currentMode() !== group.activeMode) return;
                showSuggestionResults(groupKey, Array.isArray(payload.suggestions) ? payload.suggestions : []);
            } catch (error) {
                if (error.name !== "AbortError") {
                    group.box.hidden = true;
                    group.input.setAttribute("aria-expanded", "false");
                    group.box.closest(".search-input-panel")?.classList.remove("has-open-suggestions");
                }
            }
        };

        Object.entries(suggestionInputs).forEach(([groupKey, group]) => {
            const input = group.input;
            if (!input) return;
            input.addEventListener("input", () => {
                if (groupKey === "genre" && genreIDInput) genreIDInput.value = "";
                if (groupKey === "yearGenre" && yearGenreIDInput) yearGenreIDInput.value = "";
                if (groupKey === "keyword" && keywordIDInput) keywordIDInput.value = "";
                if (pageInput) pageInput.value = "1";
                window.clearTimeout(debounceTimers.get(groupKey));
                debounceTimers.set(groupKey, window.setTimeout(() => fetchSuggestions(groupKey, input.value), 230));
            });

            input.addEventListener("focus", () => {
                const query = input.value.trim();
                if (query.length >= 2) fetchSuggestions(groupKey, query);
            });

            input.addEventListener("keydown", (event) => {
                if (event.key === "ArrowDown") {
                    const firstOption = group.box?.querySelector(".search-suggestion-item");
                    if (firstOption && !group.box.hidden) {
                        event.preventDefault();
                        firstOption.focus();
                    }
                }
                if (event.key === "Escape" && group.box) {
                    group.box.hidden = true;
                    input.setAttribute("aria-expanded", "false");
                    group.box.closest(".search-input-panel")?.classList.remove("has-open-suggestions");
                }
            });
        });

        mediaFilter?.addEventListener("change", () => {
            if (pageInput) pageInput.value = "1";
        });
        document.getElementById("searchTitleYear")?.addEventListener("change", () => {
            if (pageInput) pageInput.value = "1";
        });
        yearInput?.addEventListener("change", () => {
            if (pageInput) pageInput.value = "1";
        });

        form.addEventListener("submit", (event) => {
            const mode = currentMode();
            if (pageInput && pageInput.value === "") pageInput.value = "1";

            if (mode === "title" && !titleInput?.value.trim()) {
                // A blank Search-page title is intentionally allowed to show the discovery shelf.
                closeSuggestions();
            }
            if (mode === "genre" && !genreInput?.value.trim()) {
                event.preventDefault();
                genreInput?.focus();
                showToast("Choose a genre or type a few letters first.");
                return;
            }
            if (mode === "year" && !yearInput?.value.trim()) {
                event.preventDefault();
                yearInput?.focus();
                showToast("Choose a year first. Genre is an optional extra filter.");
                return;
            }
            if (mode === "keyword" && !keywordInput?.value.trim()) {
                event.preventDefault();
                keywordInput?.focus();
                showToast("Type a theme or keyword to explore.");
                return;
            }
            closeSuggestions();
        });

        // Smooth disclosure interaction. The section starts collapsed so results stay visible.
        const genresToggle = document.getElementById("searchGenresToggle");
        const genrePanel = document.getElementById("searchGenreChipPanel");
        let genrePanelTimer = 0;
        genresToggle?.addEventListener("click", () => {
            if (!genrePanel) return;
            const opening = genresToggle.getAttribute("aria-expanded") !== "true";
            window.clearTimeout(genrePanelTimer);
            genresToggle.setAttribute("aria-expanded", String(opening));
            if (opening) {
                genrePanel.hidden = false;
                // Allow the zero-height starting state to paint before animating open.
                genrePanel.classList.remove("is-open");
                requestAnimationFrame(() => requestAnimationFrame(() => genrePanel.classList.add("is-open")));
            } else {
                genrePanel.classList.remove("is-open");
                genrePanelTimer = window.setTimeout(() => { genrePanel.hidden = true; }, prefersReducedMotion ? 0 : 430);
            }
        });

        // Rotate TMDB-backed hero images with a cross-fade and slow cinematic zoom.
        const heroSlides = Array.from(document.querySelectorAll("[data-hero-slide]"));
        if (heroSlides.length) {
            heroSlides.forEach((slide, index) => {
                slide.classList.toggle("is-active", index === 0);
                slide.addEventListener("error", () => {
                    slide.remove();
                    const remaining = Array.from(document.querySelectorAll("[data-hero-slide]"));
                    if (remaining.length && !remaining.some((item) => item.classList.contains("is-active"))) {
                        remaining[0].classList.add("is-active");
                    }
                }, { once: true });
            });
            let backdropIndex = 0;
            if (!prefersReducedMotion && heroSlides.length > 1) {
                window.setInterval(() => {
                    if (document.visibilityState !== "visible") return;
                    const remaining = Array.from(document.querySelectorAll("[data-hero-slide]"));
                    if (remaining.length < 2) return;
                    const currentIndex = remaining.findIndex((slide) => slide.classList.contains("is-active"));
                    backdropIndex = (currentIndex + 1 + remaining.length) % remaining.length;
                    remaining.forEach((slide, index) => slide.classList.toggle("is-active", index === backdropIndex));
                }, 7200);
            }
        }

        // Three headline messages loop forever; reduced-motion users keep the first message.
        const headlineSlides = Array.from(document.querySelectorAll("[data-title-slide]"));
        if (!prefersReducedMotion && headlineSlides.length > 1) {
            let headlineIndex = 0;
            window.setInterval(() => {
                if (document.visibilityState !== "visible") return;
                headlineSlides[headlineIndex].classList.remove("is-active");
                headlineSlides[headlineIndex].setAttribute("aria-hidden", "true");
                headlineIndex = (headlineIndex + 1) % headlineSlides.length;
                headlineSlides[headlineIndex].classList.add("is-active");
                headlineSlides[headlineIndex].removeAttribute("aria-hidden");
            }, 4700);
        }

        // Result sort is client-side and preserves the currently selected server filters.
        const sortSearchCards = () => {
            if (!resultsGrid || !sortSelect) return;
            const cards = Array.from(resultsGrid.querySelectorAll("[data-search-card]"));
            const sortMode = sortSelect.value;
            cards.sort((a, b) => {
                const getNum = (card, key) => {
                    const parsed = Number.parseFloat(card.dataset[key] || "0");
                    return Number.isFinite(parsed) ? parsed : 0;
                };
                if (sortMode === "rating") return getNum(b, "rating") - getNum(a, "rating") || getNum(b, "popularity") - getNum(a, "popularity");
                if (sortMode === "year") return getNum(b, "year") - getNum(a, "year") || getNum(b, "popularity") - getNum(a, "popularity");
                if (sortMode === "title") return String(a.dataset.title || "").localeCompare(String(b.dataset.title || ""));
                return getNum(b, "popularity") - getNum(a, "popularity") || getNum(b, "rating") - getNum(a, "rating");
            });
            cards.forEach((card) => resultsGrid.appendChild(card));
        };
        sortSelect?.addEventListener("change", sortSearchCards);

        // Pagination reuses all active form filters, including year_genre/year_genre_id.
        document.querySelectorAll("[data-search-page]").forEach((button) => {
            button.addEventListener("click", () => {
                if (button.disabled || !pageInput) return;
                pageInput.value = button.dataset.searchPage || "1";
                form.requestSubmit ? form.requestSubmit() : form.submit();
            });
        });

        clearButton?.addEventListener("click", () => window.location.assign("/search"));

        document.getElementById("searchBackButton")?.addEventListener("click", () => {
            if (window.history.length > 1) window.history.back();
            else window.location.assign("/dashboard");
        });

        document.addEventListener("pointerdown", (event) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".search-input-panel")) return;
            closeSuggestions();
        });

        document.addEventListener("keydown", (event) => {
            const target = event.target;
            const isTyping = target instanceof HTMLElement && (
                target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
            );
            if (event.key === "/" && !isTyping && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault();
                const mode = currentMode();
                const targetInput = mode === "year"
                    ? yearInput
                    : suggestionInputs[mode]?.input || titleInput;
                targetInput?.focus();
            }
            if (event.key === "Escape") closeSuggestions();
        });

        // Replace broken remote poster images without leaving a broken-image icon behind.
        document.querySelectorAll(".search-result-poster img, .search-recommendation-poster img").forEach((image) => {
            image.addEventListener("error", () => {
                const fallback = document.createElement("div");
                fallback.className = "search-poster-fallback";
                fallback.textContent = "Poster unavailable";
                image.replaceWith(fallback);
            }, { once: true });
        });

        if (!prefersReducedMotion) {
            document.querySelectorAll(".search-result-card, .search-recommendation-card").forEach((card, index) => {
                card.style.animationDelay = `${Math.min(index * 22, 240)}ms`;
            });
        }

        activateMode(currentMode(), false);
        sortSearchCards();
    });
})();
